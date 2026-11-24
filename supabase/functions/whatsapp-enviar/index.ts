// Edge Function: whatsapp-enviar (exige sesión: verify_jwt activo).
// Un asesor escribe al cliente DESDE la plataforma. Requiere el permiso «whatsapp.responder».
//   { conversacion_id, texto }                                   → mensaje libre (solo dentro de las 24 h desde el último mensaje del cliente)
//   { conversacion_id, plantilla: { nombre, idioma, parametros } } → plantilla aprobada por Meta (la única forma fuera de las 24 h)
// Al escribir, la IA de esa conversación queda en pausa (el asesor toma el control); se reactiva con el botón «Reactivar IA».
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { dentroDeVentana, enviarPlantilla, enviarTexto } from '../_shared/whatsapp.ts';
import { baseEnlaces } from '../_shared/bot-ia.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo inválido.' }, 400); }
  const convId = String(body.conversacion_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(convId)) return json({ ok: false, error: 'Falta la conversación.' }, 400);

  const auth = req.headers.get('Authorization') || '';
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  const usuario = u?.user;
  if (!usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: conv } = await admin.from('agenda_wa_conversaciones').select('*').eq('id', convId).maybeSingle();
  if (!conv) return json({ ok: false, error: 'Conversación no encontrada.' }, 404);
  // El permiso se evalúa con la sesión de quien llama (la función de permisos usa auth.uid()).
  const yo = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data: puede } = await yo.rpc('agenda_tiene_permiso', { p_empresa_id: conv.empresa_id, p_permiso: 'whatsapp.responder' });
  if (puede !== true) return json({ ok: false, error: 'No tienes permiso para escribir en WhatsApp.' }, 403);
  // Con asesores y colas: solo se escribe en conversaciones que la persona puede ver (propias, de su cola o con «ver todas»).
  const { data: visible } = await yo.rpc('agenda_wa_puede_ver_conv', { p_conv: conv.id });
  if (visible !== true) return json({ ok: false, error: 'Esta conversación no está asignada a ti.' }, 403);

  const { data: cfg } = await admin.from('agenda_whatsapp_config').select('phone_number_id, modo, plantillas, enlaces_base').eq('empresa_id', conv.empresa_id).maybeSingle();
  if (!cfg?.phone_number_id) return json({ ok: false, error: 'Falta configurar el número de WhatsApp.' }, 400);
  if (cfg.modo === 'anterior') return json({ ok: false, error: 'El bot nuevo está apagado (modo anterior). Enciende «observador», «pruebas» o «nuevo» para escribir desde aquí.' }, 400);

  const { data: asesor } = await admin.from('agenda_asesores').select('id, nombre').eq('empresa_id', conv.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).limit(1).maybeSingle();
  const autorNombre = asesor?.nombre || usuario.email || 'Asesor';

  // «Pasar información del inmueble N»: el asesor ofrece uno o varios inmuebles por su número. Se envía la ficha de cada uno con su enlace
  // de reserva de visita, se guardan en la conversación y la IA SIGUE atendiendo con esos inmuebles como contexto (no se pausa).
  if (body.enlace?.tipo === 'ficha') {
    if (!dentroDeVentana(conv.ultimo_cliente_en)) {
      return json({ ok: false, error: 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada.', requiere_plantilla: true }, 409);
    }
    const crudos: unknown[] = Array.isArray(body.enlace.inmuebles) ? body.enlace.inmuebles : String(body.enlace.inmuebles || '').split(/[\s,;y]+/);
    const nums = [...new Set(crudos.map((x) => parseInt(String(x).replace(/\D/g, ''), 10)).filter((n) => n > 0))].slice(0, 5);
    if (!nums.length) return json({ ok: false, error: 'Escribe el número de uno o más inmuebles (por ejemplo: 500, 501).' }, 400);
    const { data: cfgEmp } = await admin.from('agenda_configuracion').select('dominio_publico').eq('empresa_id', conv.empresa_id).maybeSingle();
    const base = baseEnlaces(cfg, String(cfgEmp?.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, ''));
    const plata = (v: unknown) => (Number(v) > 0 ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v)) : '');
    const ofrecidos: number[] = []; const noDisponibles: number[] = [];
    for (const n of nums) {
      const { data: rb } = await admin.rpc('agenda_wa_buscar_inmuebles', { p_empresa_id: conv.empresa_id, p_codigo: n, p_limite: 1 });
      // deno-lint-ignore no-explicit-any
      const i: any = rb?.inmuebles?.[0];
      if (!i) { noDisponibles.push(n); continue; }
      const venta = i.tipo_oferta === 'Venta';
      const texto = [
        `🏠 *${i.tipo_inmueble || 'Inmueble'} en ${venta ? 'venta' : 'arriendo'}* — Nº ${n}`,
        `📍 ${[i.barrio, i.localidad].filter(Boolean).join(' · ') || i.direccion || ''}${i.ciudad ? `, ${i.ciudad}` : ''}`,
        [i.habitaciones ? `🛏 ${i.habitaciones} alcobas` : '', i.banos ? `🚿 ${i.banos} baños` : '', i.parqueaderos ? `🚗 ${i.parqueaderos} parq.` : ''].filter(Boolean).join(' · '),
        plata(venta ? i.valor_venta : i.valor_canon) ? `💰 ${venta ? 'Valor' : 'Canon'}: ${plata(venta ? i.valor_venta : i.valor_canon)}` : '',
        `Mira la ficha y reserva tu visita aquí:\n${base}/inmuebles/${n}`,
      ].filter(Boolean).join('\n');
      const env = await enviarTexto(cfg.phone_number_id, conv.telefono, texto);
      await admin.from('agenda_wa_mensajes').insert({
        conversacion_id: conv.id, empresa_id: conv.empresa_id, wa_id: env.wa_id || null, direccion: 'salida', origen: 'asesor', tipo: 'text', texto,
        estado_envio: env.ok ? 'enviado' : 'fallido', error: env.ok ? null : env.error || 'No se pudo enviar', autor_id: usuario.id, autor_nombre: autorNombre,
      });
      if (env.ok) ofrecidos.push(n);
    }
    if (ofrecidos.length) {
      await admin.from('agenda_wa_mensajes').insert({
        conversacion_id: conv.id, empresa_id: conv.empresa_id, direccion: 'salida', origen: 'sistema', tipo: 'evento',
        texto: `${autorNombre} ofreció ${ofrecidos.length > 1 ? 'los inmuebles' : 'el inmueble'} ${ofrecidos.map((x) => `Nº ${x}`).join(', ')}. La IA sigue atendiendo con esa información.`,
        autor_id: usuario.id, autor_nombre: autorNombre,
      });
      const cambiosF: Record<string, unknown> = {
        inmueble_numero: ofrecidos[ofrecidos.length - 1], inmuebles_ofrecidos: [...new Set([...(conv.inmuebles_ofrecidos || []), ...ofrecidos])],
        ultimo_en: new Date().toISOString(), sin_leer: 0, requiere_atencion: false,
      };
      if (conv.alerta === 'inmueble_no_identificado') cambiosF.alerta = null;
      if (!conv.asesor_id && asesor?.id) Object.assign(cambiosF, { asesor_id: asesor.id, asignada_en: new Date().toISOString(), asignada_por: usuario.id });
      await admin.from('agenda_wa_conversaciones').update(cambiosF).eq('id', conv.id);
    }
    if (!ofrecidos.length) return json({ ok: false, error: `No encontré ${noDisponibles.length > 1 ? 'esos inmuebles disponibles' : 'ese inmueble disponible'} (${noDisponibles.map((x) => `Nº ${x}`).join(', ')}).` }, 404);
    return json({ ok: true, ofrecidos, no_disponibles: noDisponibles });
  }

  let textoGuardar = '';
  let enlaceInmueble: number | null = null;
  let envio;
  if (body.plantilla?.nombre) {
    const catalogo = Array.isArray(cfg.plantillas) ? cfg.plantillas : [];
    const def = catalogo.find((p: { nombre?: string }) => p?.nombre === body.plantilla.nombre);
    if (!def) return json({ ok: false, error: 'Esa plantilla no está registrada en los ajustes de WhatsApp.' }, 400);
    const params: string[] = Array.isArray(body.plantilla.parametros) ? body.plantilla.parametros.map((x: unknown) => String(x)) : [];
    envio = await enviarPlantilla(cfg.phone_number_id, conv.telefono, def.nombre, def.idioma || 'es', params);
    textoGuardar = String(def.texto || `Plantilla ${def.nombre}`).replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] ?? '');
  } else {
    let t = String(body.texto || '').trim();
    // Botones rápidos: «enlace para consignar» o «enlace para agendar cita» de un inmueble. El asesor solo escribe el número.
    if (body.enlace?.tipo) {
      const { data: cfgEmp } = await admin.from('agenda_configuracion').select('dominio_publico, empresa:agenda_empresas(slug)').eq('empresa_id', conv.empresa_id).maybeSingle();
      // deno-lint-ignore no-explicit-any
      const rel: any = cfgEmp?.empresa;
      const slug: string = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug) || '';
      const dominio = String(cfgEmp?.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
      const base = baseEnlaces(cfg, dominio);
      const saludo = conv.nombre ? `Hola, ${String(conv.nombre).split(' ')[0]} 👋 ` : 'Hola 👋 ';
      if (body.enlace.tipo === 'consignar') {
        t = `${saludo}Con gusto. Para ofrecernos tu inmueble, llena este formulario y elige el horario en que prefieres la visita del asesor:\n${base}/consignar?empresa=${encodeURIComponent(slug)}`;
      } else if (body.enlace.tipo === 'cita') {
        const n = parseInt(String(body.enlace.inmueble || '').replace(/\D/g, ''), 10);
        if (!(n > 0)) return json({ ok: false, error: 'Escribe el número del inmueble.' }, 400);
        const { data: inm } = await admin.from('agenda_inmuebles').select('numero_inmueble, disponible').eq('empresa_id', conv.empresa_id).eq('numero_inmueble', n).maybeSingle();
        if (!inm) return json({ ok: false, error: `No existe el inmueble Nº ${n}.` }, 404);
        if (!inm.disponible) return json({ ok: false, error: `El inmueble Nº ${n} no está disponible.` }, 409);
        t = `${saludo}Aquí puedes ver el inmueble Nº ${n} y reservar tu visita en el horario que prefieras:\n${base}/inmuebles/${n}`;
        enlaceInmueble = n;
      } else return json({ ok: false, error: 'Tipo de enlace no válido.' }, 400);
    }
    if (!t) return json({ ok: false, error: 'Escribe el mensaje.' }, 400);
    if (!dentroDeVentana(conv.ultimo_cliente_en)) {
      return json({ ok: false, error: 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada.', requiere_plantilla: true }, 409);
    }
    textoGuardar = t.slice(0, 4000);
    envio = await enviarTexto(cfg.phone_number_id, conv.telefono, textoGuardar);
  }

  await admin.from('agenda_wa_mensajes').insert({
    conversacion_id: conv.id, empresa_id: conv.empresa_id, wa_id: envio.wa_id || null, direccion: 'salida', origen: 'asesor', tipo: body.plantilla?.nombre ? 'template' : 'text',
    texto: textoGuardar, estado_envio: envio.ok ? 'enviado' : 'fallido', error: envio.ok ? null : envio.error || 'No se pudo enviar', autor_id: usuario.id, autor_nombre: autorNombre,
  });
  const cambios: Record<string, unknown> = { ultimo_texto: textoGuardar.slice(0, 200), ultimo_en: new Date().toISOString(), sin_leer: 0, requiere_atencion: false };
  // Los enlaces rápidos (consignar, agendar visita) son un recurso: no sacan a la IA de la conversación.
  if (envio.ok && body.pausar_ia !== false && !body.enlace?.tipo && conv.ia_activa) {
    Object.assign(cambios, { ia_activa: false, estado: 'humano', motivo_pausa: `Atiende ${autorNombre}`, pausada_en: new Date().toISOString(), asesor_id: asesor?.id ?? conv.asesor_id });
  }
  // Quien le contesta primero a una conversación sin asignar se queda con ella.
  if (envio.ok && !conv.asesor_id && asesor?.id && !cambios.asesor_id) Object.assign(cambios, { asesor_id: asesor.id, asignada_en: new Date().toISOString(), asignada_por: usuario.id });
  // Si la IA no había identificado el inmueble y el asesor lo resolvió con un enlace, queda constancia en la conversación y se quita la alerta.
  if (envio.ok && body.enlace?.tipo) {
    if (conv.alerta === 'inmueble_no_identificado') cambios.alerta = null;
    if (enlaceInmueble) cambios.inmueble_numero = enlaceInmueble;
    await admin.from('agenda_wa_mensajes').insert({
      conversacion_id: conv.id, empresa_id: conv.empresa_id, direccion: 'salida', origen: 'sistema', tipo: 'evento',
      texto: `${autorNombre} envió el enlace ${body.enlace.tipo === 'cita' ? `para agendar visita del inmueble Nº ${enlaceInmueble}` : 'para consignar un inmueble'}${conv.alerta === 'inmueble_no_identificado' ? ' (la IA no había identificado el inmueble; queda como caso para corregir)' : ''}.`,
      autor_id: usuario.id, autor_nombre: autorNombre,
    });
  }
  await admin.from('agenda_wa_conversaciones').update(cambios).eq('id', conv.id);
  return envio.ok ? json({ ok: true }) : json({ ok: false, error: envio.error || 'WhatsApp no aceptó el mensaje.' }, 502);
});
