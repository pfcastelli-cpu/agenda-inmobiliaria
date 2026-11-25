// Edge Function: whatsapp-webhook (PÚBLICA: se despliega con --no-verify-jwt; la credencial es la firma de Meta o el secreto del reenvío).
// Recibe los mensajes de WhatsApp, los guarda en la bandeja de la plataforma y, según el interruptor de la empresa
// (agenda_whatsapp_config.modo), responde con Claude:
//   anterior   → no hace nada (responde el bot de Apps Script).
//   observador → guarda copia; no responde.
//   pruebas    → responde SOLO a los números de prueba; al resto solo guarda copia.
//   nuevo      → responde a todos.
// Entradas aceptadas:
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…        (verificación de Meta)
//   POST con cabecera x-hub-signature-256 válida                      (Meta directo)
//   POST con cabecera x-reenvio-secret = secreto BOT_REENVIO_SECRET   (reenvío desde el Apps Script; mismo JSON de Meta, o
//        { bot_anterior: { phone_number_id, telefono, texto } } para guardar lo que contestó el bot anterior)
// Secretos de la función: WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, BOT_REENVIO_SECRET, ANTHROPIC_API_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { contextoInmuebles, ejecutarEtiquetas, responderConIA, type MensajeHist } from '../_shared/bot-ia.ts';
import { registrarFallo } from '../_shared/fallos.ts';
import { descargarMedia, enviarTexto, extensionDe, extraerEntrantes, firmaValida, secretoIgual, soloDigitos, type EntranteWA } from '../_shared/whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const ESPERA_AGRUPAR_MS = 4000; // espera por si el cliente manda varios mensajes seguidos
const RESPUESTAS_FIJAS: Record<string, string> = {
  audio: 'Hola 👋 Por este medio no alcanzo a escuchar audios. ¿Me escribes tu mensaje, por favor?',
  voice: 'Hola 👋 Por este medio no alcanzo a escuchar audios. ¿Me escribes tu mensaje, por favor?',
  sticker: '',
  reaction: '',
};

function texto(cuerpo: unknown, status = 200) {
  return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status });
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

async function cargarEmpresa(phoneNumberId: string): Promise<{ cfgWA: Fila; empresaId: string; cfgEmpresa: Fila; slug: string } | null> {
  const { data: cfgWA } = await admin.from('agenda_whatsapp_config').select('*').eq('phone_number_id', phoneNumberId).maybeSingle();
  if (!cfgWA) return null;
  const { data: cfgEmpresa } = await admin.from('agenda_configuracion')
    .select('dominio_publico, plantilla_enlace_inmueble, nombre_comercial, empresa:agenda_empresas(slug)').eq('empresa_id', cfgWA.empresa_id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const rel: any = cfgEmpresa?.empresa;
  const slug: string = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug) || '';
  return { cfgWA, empresaId: cfgWA.empresa_id, cfgEmpresa: cfgEmpresa || {}, slug };
}

function debeResponderLaPlataforma(cfgWA: Fila, telefono: string): boolean {
  if ((cfgWA.numeros_bloqueados || []).includes(telefono)) return false;
  if (cfgWA.modo === 'nuevo') return true;
  if (cfgWA.modo === 'pruebas') return (cfgWA.numeros_prueba || []).includes(telefono);
  return false;
}

// Descarga el archivo del cliente y lo guarda en el almacenamiento privado (los enlaces de Meta caducan). Si falla, queda anotado y el chat sigue.
async function guardarArchivo(mensajeId: string, empresaId: string, convId: string, e: EntranteWA) {
  try {
    const d = await descargarMedia(e.media!.id);
    if (!d.ok) { await admin.from('agenda_wa_mensajes').update({ media_error: d.error.slice(0, 200) }).eq('id', mensajeId); return; }
    const ruta = `${empresaId}/${convId}/${mensajeId}.${extensionDe(d.mime, e.media!.nombre)}`;
    const { error } = await admin.storage.from('whatsapp-media').upload(ruta, d.bytes, { contentType: d.mime.split(';')[0], upsert: true });
    if (error) { await admin.from('agenda_wa_mensajes').update({ media_error: error.message.slice(0, 200) }).eq('id', mensajeId); return; }
    await admin.from('agenda_wa_mensajes').update({ media_path: ruta, media_mime: d.mime.split(';')[0], media_bytes: d.bytes.length, media_nombre: e.media!.nombre }).eq('id', mensajeId);
  } catch (err) {
    await admin.from('agenda_wa_mensajes').update({ media_error: String(err instanceof Error ? err.message : err).slice(0, 200) }).eq('id', mensajeId);
  }
}

async function guardarEntrante(e: EntranteWA, empresaId: string, cfgWA: Fila): Promise<{ conv: Fila; nuevo: boolean } | null> {
  const ahora = new Date().toISOString();
  const ETIQ: Record<string, string> = { audio: '🎤 Nota de voz', voice: '🎤 Nota de voz', image: '📷 Foto', document: '📄 Documento', video: '🎥 Video', sticker: 'Sticker', location: '📍 Ubicación' };
  const resumen = e.texto || ETIQ[e.tipo] || `[${e.tipo}]`;
  const esPrueba = (cfgWA.numeros_prueba || []).includes(e.telefono);
  const { data: previa } = await admin.from('agenda_wa_conversaciones').select('*').eq('empresa_id', empresaId).eq('telefono', e.telefono).maybeSingle();
  let conv = previa;
  if (!conv) {
    const { data, error } = await admin.from('agenda_wa_conversaciones').insert({
      empresa_id: empresaId, telefono: e.telefono, nombre: e.nombre, numero_oculto: e.oculto, es_prueba: esPrueba, ultimo_texto: resumen.slice(0, 200),
      ultimo_en: ahora, ultimo_cliente_en: ahora, sin_leer: 1,
    }).select('*').single();
    if (error || !data) {
      // carrera con otro mensaje que la creó primero
      const { data: otra } = await admin.from('agenda_wa_conversaciones').select('*').eq('empresa_id', empresaId).eq('telefono', e.telefono).maybeSingle();
      if (!otra) return null;
      conv = otra;
    } else conv = data;
  }
  const { data: msgNuevo, error: errMsg } = await admin.from('agenda_wa_mensajes').insert({
    conversacion_id: conv.id, empresa_id: empresaId, wa_id: e.wa_id || null, direccion: 'entrada', origen: 'cliente', tipo: e.tipo, texto: e.texto || null, creado_en: new Date(e.momento).toISOString(),
  }).select('id').single();
  if (errMsg || !msgNuevo) return null; // duplicado (Meta reintenta): ya estaba guardado
  if (e.media) await guardarArchivo(msgNuevo.id, empresaId, conv.id, e);
  if (previa) {
    await admin.from('agenda_wa_conversaciones').update({
      nombre: e.nombre || previa.nombre, ultimo_texto: resumen.slice(0, 200), ultimo_en: ahora, ultimo_cliente_en: ahora,
      sin_leer: (previa.sin_leer || 0) + 1, es_prueba: esPrueba || previa.es_prueba,
    }).eq('id', conv.id);
    conv = { ...previa, nombre: e.nombre || previa.nombre, ultimo_cliente_en: ahora };
  }
  return { conv, nuevo: !previa };
}

async function guardarSalida(convId: string, empresaId: string, origen: 'ia' | 'sistema', textoSalida: string, wa: { ok: boolean; wa_id?: string; error?: string }) {
  await admin.from('agenda_wa_mensajes').insert({
    conversacion_id: convId, empresa_id: empresaId, wa_id: wa.wa_id || null, direccion: 'salida', origen, tipo: 'text', texto: textoSalida,
    estado_envio: wa.ok ? 'enviado' : 'fallido', error: wa.ok ? null : wa.error || 'No se pudo enviar',
  });
  await admin.from('agenda_wa_conversaciones').update({ ultimo_texto: textoSalida.slice(0, 200), ultimo_en: new Date().toISOString() }).eq('id', convId);
}

const PERFILES_VALIDOS = ['interesado_arriendo', 'interesado_compra', 'propietario', 'arrendatario', 'consignacion'];

// Instrucciones internas para que la IA clasifique la conversación (se agregan al bloque variable del prompt, no al fijo).
function instruccionesClasificacion(temas: Fila[], conv: Fila): string {
  const l: string[] = ['CLASIFICACIÓN INTERNA (las etiquetas entre corchetes no las ve el cliente):'];
  if (temas.length) {
    l.push('- Cuando identifiques de qué trata la consulta emite [TEMA:clave] con UNA de estas claves (solo estas):');
    for (const t of temas) l.push(`  · ${t.clave} = ${t.nombre}${t.descripcion ? ` — ${t.descripcion}` : ''}`);
  }
  l.push(`- Cuando sepas quién es el contacto emite [PERFIL:valores|número de inmueble]. Valores (separados por coma, solo estos): ${PERFILES_VALIDOS.join(', ')}. «consignacion» = propietario que quiere ofrecernos su inmueble. El número de inmueble (solo dígitos) es opcional y solo si lo conoces con certeza.`);
  l.push('- Si el cliente habla de un inmueble concreto (enlace, código, dirección o «el que vi») y NO logras identificarlo con buscar_inmuebles, NO inventes uno: emite [SIN_INMUEBLE:lo que dijo el cliente, en pocas palabras] y [HUMANO:no se identificó el inmueble].');
  const actual = [conv.perfiles?.length ? `perfiles ${conv.perfiles.join(', ')}` : '', conv.inmueble_numero ? `inmueble ${conv.inmueble_numero}` : ''].filter(Boolean).join(' · ');
  if (actual) l.push(`Ya registrado en esta conversación: ${actual}. Vuelve a emitir la etiqueta solo si cambia.`);
  return l.join('\n');
}

// Aplica las etiquetas internas de la IA a los cambios de la conversación.
async function clasificar(empresaId: string, conv: Fila, temas: Fila[], etiquetas: { tipo: string; datos: string }[], cambios: Fila) {
  const ultima = (tipo: string) => [...etiquetas].reverse().find((t) => t.tipo === tipo);
  const tema = ultima('TEMA');
  if (tema) { const t = temas.find((x) => x.clave === tema.datos.trim().toLowerCase()); if (t) cambios.tema_id = t.id; }
  const perfil = ultima('PERFIL');
  if (perfil) {
    const [vals, num] = perfil.datos.split('|');
    const nuevos = String(vals || '').split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter((v) => PERFILES_VALIDOS.includes(v));
    if (nuevos.length) cambios.perfiles = [...new Set([...(conv.perfiles || []), ...nuevos])];
    const n = parseInt(String(num || '').replace(/\D/g, ''), 10);
    if (n > 0) {
      const { data: inm } = await admin.from('agenda_inmuebles').select('numero_inmueble').eq('empresa_id', empresaId).eq('numero_inmueble', n).maybeSingle();
      if (inm) cambios.inmueble_numero = n;
    }
  }
  if (etiquetas.some((t) => t.tipo === 'SIN_INMUEBLE')) {
    cambios.alerta = 'inmueble_no_identificado';
    cambios.requiere_atencion = true;
    // Queda como error para corregir (sin datos del cliente): se ve en Soporte → Fallos.
    await registrarFallo(admin, { empresaId, modulo: 'whatsapp', codigo: 'bot_no_identifico_inmueble', operacion: 'identificar_inmueble', nivel: 'aviso' });
  }
}

async function procesarEntrante(e: EntranteWA) {
  const emp = await cargarEmpresa(e.phone_number_id);
  if (!emp || emp.cfgWA.modo === 'anterior') return;
  const guardado = await guardarEntrante(e, emp.empresaId, emp.cfgWA);
  if (!guardado) return;
  let conv = guardado.conv;
  // Si estaba resuelta y el cliente vuelve a escribir, se reabre sola.
  if (conv.estado === 'cerrada') {
    const reabre = conv.ia_activa ? 'ia' : 'humano';
    await admin.from('agenda_wa_conversaciones').update({ estado: reabre, resuelta_en: null, resuelta_por: null, nota_cierre: null, requiere_atencion: !conv.ia_activa }).eq('id', conv.id);
    conv = { ...conv, estado: reabre };
  }
  if (!debeResponderLaPlataforma(emp.cfgWA, e.telefono)) return;

  // Reactivación automática de la IA tras N horas sin que un asesor escriba.
  if (!conv.ia_activa && emp.cfgWA.reactivar_ia_horas) {
    const { data: ult } = await admin.from('agenda_wa_mensajes').select('creado_en').eq('conversacion_id', conv.id).eq('origen', 'asesor').order('creado_en', { ascending: false }).limit(1).maybeSingle();
    const desde = new Date(ult?.creado_en || conv.pausada_en || conv.creado_en).getTime();
    if (Date.now() - desde > emp.cfgWA.reactivar_ia_horas * 3600 * 1000) {
      await admin.from('agenda_wa_conversaciones').update({ ia_activa: true, estado: 'ia', motivo_pausa: null, pausada_en: null }).eq('id', conv.id);
      conv = { ...conv, ia_activa: true, estado: 'ia' };
    }
  }
  if (!conv.ia_activa) {
    await admin.from('agenda_wa_conversaciones').update({ requiere_atencion: true }).eq('id', conv.id);
    return;
  }

  // Tipos sin texto: respuesta fija (o silencio) y listo.
  if (!e.texto && e.tipo in RESPUESTAS_FIJAS) {
    const fija = RESPUESTAS_FIJAS[e.tipo];
    if (fija) {
      const r = await enviarTexto(e.phone_number_id, e.telefono, fija);
      await guardarSalida(conv.id, emp.empresaId, 'ia', fija, r);
    }
    return;
  }
  if (!e.texto) {
    // foto, documento sin texto, video: se avisa a una persona (puede ser un comprobante)
    await admin.from('agenda_wa_conversaciones').update({ requiere_atencion: true }).eq('id', conv.id);
    const aviso = 'Recibí tu archivo 👍 Para revisarlo bien, lo verá una persona del equipo. Si necesitas algo más, escríbeme.';
    const r = await enviarTexto(e.phone_number_id, e.telefono, aviso);
    await guardarSalida(conv.id, emp.empresaId, 'ia', aviso, r);
    return;
  }

  // Agrupar mensajes seguidos: solo responde la invocación que recibió el ÚLTIMO mensaje del cliente.
  await dormir(ESPERA_AGRUPAR_MS);
  const { data: ultimoEntrante } = await admin.from('agenda_wa_mensajes').select('wa_id').eq('conversacion_id', conv.id).eq('direccion', 'entrada').order('creado_en', { ascending: false }).limit(1).maybeSingle();
  if (ultimoEntrante && e.wa_id && ultimoEntrante.wa_id !== e.wa_id) return;
  // Un asesor pudo pausar la IA mientras tanto.
  const { data: fresca } = await admin.from('agenda_wa_conversaciones').select('ia_activa').eq('id', conv.id).maybeSingle();
  if (!fresca?.ia_activa) return;

  const { data: filas } = await admin.from('agenda_wa_mensajes').select('direccion, origen, tipo, texto, creado_en')
    .eq('conversacion_id', conv.id).neq('tipo', 'evento').order('creado_en', { ascending: false }).limit(40);
  const historial: MensajeHist[] = (filas || []).reverse().filter((m: Fila) => m.texto).map((m: Fila) => ({
    rol: m.direccion === 'entrada' ? 'user' : 'assistant',
    texto: m.origen === 'asesor' ? `[Un asesor humano escribió]: ${m.texto}` : m.texto,
  }));

  // Temas de la empresa (tabla agenda_wa_temas): la IA clasifica la conversación en uno y el reparto por asesor sale de ahí.
  const { data: temasDb } = await admin.from('agenda_wa_temas').select('id, clave, nombre, descripcion').eq('empresa_id', emp.empresaId).eq('activo', true).order('orden');
  const temas: Fila[] = temasDb || [];
  const ia = await responderConIA({
    admin, empresaId: emp.empresaId, cfgWA: emp.cfgWA, cfgEmpresa: emp.cfgEmpresa, slug: emp.slug, historial,
    cliente: { nombre: conv.nombre || e.nombre, telefono: e.telefono },
    extraVariable: `${instruccionesClasificacion(temas, conv)}\n${await contextoInmuebles(admin, emp.empresaId, emp.cfgEmpresa, emp.cfgWA, [...(conv.inmuebles_ofrecidos || []), ...(conv.inmueble_numero ? [conv.inmueble_numero] : [])])}`.trim(),
  });
  if (!ia.ok) {
    await admin.from('agenda_wa_conversaciones').update({ requiere_atencion: true }).eq('id', conv.id);
    await registrarFallo(admin, { empresaId: emp.empresaId, modulo: 'whatsapp', codigo: ia.bloqueada ? 'ia_cuenta_bloqueada' : 'ia_sin_respuesta', operacion: 'responder_cliente', nivel: 'error' });
    return;
  }
  const dominio = String(emp.cfgEmpresa.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const aviso = await ejecutarEtiquetas(admin, emp.empresaId, emp.cfgWA, ia.r.etiquetas, { nombre: conv.nombre || e.nombre, telefono: e.telefono }, `https://${dominio}/`);
  if (ia.r.texto) {
    const r = await enviarTexto(e.phone_number_id, e.telefono, ia.r.texto);
    await guardarSalida(conv.id, emp.empresaId, 'ia', ia.r.texto, r);
  }
  const visibles = ia.r.etiquetas.filter((t) => t.tipo !== 'TEMA' && t.tipo !== 'PERFIL');
  const cambios: Fila = { ultima_etiqueta: visibles.length ? { tipo: visibles[visibles.length - 1].tipo, en: new Date().toISOString() } : conv.ultima_etiqueta ?? null };
  if (visibles.length) cambios.etiquetas = [...new Set([...(conv.etiquetas || []), ...visibles.map((t) => t.tipo)])];
  if (aviso.pasarAHumano) Object.assign(cambios, { requiere_atencion: true, motivo_pausa: aviso.motivo });
  await clasificar(emp.empresaId, conv, temas, ia.r.etiquetas, cambios);
  await admin.from('agenda_wa_conversaciones').update(cambios).eq('id', conv.id);
}

// Lo que contestó el bot anterior (Apps Script): solo se guarda para que el historial esté completo.
async function guardarDelBotAnterior(b: Fila) {
  const emp = await cargarEmpresa(String(b.phone_number_id || ''));
  if (!emp || emp.cfgWA.modo === 'anterior') return;
  const tel = soloDigitos(b.telefono);
  const t = String(b.texto || '').slice(0, 4000);
  if (!tel || !t) return;
  // Los números ocultos se guardan como identificador de Meta (ej. «CO.1234…»): se busca primero tal cual, luego solo por dígitos.
  const crudo = String(b.telefono || '').trim();
  let { data: conv } = await admin.from('agenda_wa_conversaciones').select('id').eq('empresa_id', emp.empresaId).eq('telefono', crudo).maybeSingle();
  if (!conv) ({ data: conv } = await admin.from('agenda_wa_conversaciones').select('id').eq('empresa_id', emp.empresaId).eq('telefono', tel).maybeSingle());
  if (!conv) return;
  await admin.from('agenda_wa_mensajes').insert({ conversacion_id: conv.id, empresa_id: emp.empresaId, direccion: 'salida', origen: 'bot_anterior', tipo: 'text', texto: t, estado_envio: 'enviado' });
  await admin.from('agenda_wa_conversaciones').update({ ultimo_texto: t.slice(0, 200), ultimo_en: new Date().toISOString() }).eq('id', conv.id);
}

// Avisos de entrega de Meta: si un mensaje que la plataforma envió NO se entregó (ej. pasaron 24 h), se marca en rojo y la conversación pide atención.
// deno-lint-ignore no-explicit-any
async function procesarEstados(payload: any) {
  // deno-lint-ignore no-explicit-any
  const estados: any[] = (payload?.entry || []).flatMap((e: any) => (e?.changes || []).flatMap((c: any) => c?.value?.statuses || []));
  for (const s of estados) {
    if (s?.status !== 'failed' || !s?.id) continue;
    const er = (s.errors || [])[0] || {};
    const motivo = er.code === 131047 || er.code === 131049
      ? 'No se entregó: pasaron más de 24 horas desde el último mensaje del cliente. Usa una plantilla aprobada.'
      : er.code === 131026 ? 'No se entregó: el número no tiene WhatsApp o no puede recibir el mensaje.'
      : `No se entregó: ${String(er.error_data?.details || er.message || er.title || 'WhatsApp no pudo entregarlo').slice(0, 200)}`;
    const { data: m } = await admin.from('agenda_wa_mensajes').select('id, conversacion_id, direccion').eq('wa_id', String(s.id)).maybeSingle();
    if (!m || m.direccion !== 'salida') continue;
    await admin.from('agenda_wa_mensajes').update({ estado_envio: 'fallido', error: motivo }).eq('id', m.id);
    await admin.from('agenda_wa_conversaciones').update({ requiere_atencion: true, motivo_pausa: motivo }).eq('id', m.conversacion_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const esperado = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (u.searchParams.get('hub.mode') === 'subscribe' && esperado && secretoIgual(u.searchParams.get('hub.verify_token'), esperado)) {
      return texto(u.searchParams.get('hub.challenge') || '');
    }
    return texto('Verificación rechazada', 403);
  }
  if (req.method !== 'POST') return texto('Método no permitido', 405);

  const cuerpo = await req.text();
  const viaReenvio = secretoIgual(req.headers.get('x-reenvio-secret'), Deno.env.get('BOT_REENVIO_SECRET'));
  const viaMeta = !viaReenvio && await firmaValida(cuerpo, req.headers.get('x-hub-signature-256'), Deno.env.get('WHATSAPP_APP_SECRET') || '');
  if (!viaReenvio && !viaMeta) return texto('Firma no válida', 401);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(cuerpo); } catch { return texto('JSON inválido', 400); }

  // Al reenvío del Apps Script se le dice YA si la plataforma atiende a ese número («atiende»): si sí, el bot anterior se calla.
  // Cualquier otra cosa (error, modo anterior/observador, número que no es de prueba) → el bot anterior responde como siempre.
  let atiende = false;
  if (viaReenvio && !payload?.bot_anterior) {
    try {
      const primero = extraerEntrantes(payload)[0];
      const emp = primero ? await cargarEmpresa(primero.phone_number_id) : null;
      atiende = !!(emp && primero && emp.cfgWA.modo !== 'anterior' && debeResponderLaPlataforma(emp.cfgWA, primero.telefono));
    } catch { atiende = false; }
  }

  // Se contesta a Meta de inmediato; el trabajo sigue en segundo plano (si algo falla, queda en la bandeja como «requiere atención»).
  // deno-lint-ignore no-explicit-any
  const tarea = (async () => {
    try {
      if (payload?.bot_anterior) { await guardarDelBotAnterior(payload.bot_anterior); return; }
      await procesarEstados(payload).catch((err) => console.error('whatsapp-webhook estados', err instanceof Error ? err.message : err));
      const entrantes = extraerEntrantes(payload);
      await Promise.all(entrantes.map((e) => procesarEntrante(e).catch((err) => console.error('whatsapp-webhook', err instanceof Error ? err.message : err))));
    } catch (err) {
      console.error('whatsapp-webhook', err instanceof Error ? err.message : err);
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(tarea); else await tarea;
  return viaReenvio ? new Response(JSON.stringify({ ok: true, atiende }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : texto('ok');
});
