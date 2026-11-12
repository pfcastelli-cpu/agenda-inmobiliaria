// Edge Function: portal-negociacion (verify_jwt = false: el token de cada parte es la credencial)
// Negociación del VALOR de compra de un inmueble en venta entre el comprador interesado y el propietario (sql/082). Solo se intercambian valores:
// nada de texto libre ni teléfonos. Acciones (cuerpo JSON):
//   { accion: 'iniciar', encuesta_token }      → la usa la página de la encuesta y avisar-encuesta-respondida cuando el cliente marca «avanzar» en un inmueble en venta.
//   { accion: 'ver', token }                   → estado de la negociación para el comprador o el propietario (según el token).
//   { accion: 'responder', token, decision: 'proponer'|'aceptar'|'rechazar', valor? }
//   { accion: 'promesa', token, datos, autoriza } → datos del comprador para preparar la promesa (solo con valor acordado y token del comprador).
// Cada movimiento avisa por correo a la otra parte y SIEMPRE al asesor de la visita y a quienes lo supervisan. Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoNegociacion, pesos, type TipoCorreoNegociacion } from '../_shared/negociacion-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;
type Admin = ReturnType<typeof createClient>;

const correosDe = (t: unknown) => String(t || '').split(/[;,\s]+/).map((c) => c.trim()).filter((c) => /^\S+@\S+\.\S+$/.test(c));
const TEXTO_AUTORIZACION = (empresa: string, correo: string) => `Autorizo de manera previa, expresa e informada a ${empresa} para tratar mis datos personales con el fin de preparar la promesa de compraventa, contactarme y transmitir mi propuesta al propietario del inmueble. Conozco mis derechos (conocer, actualizar, rectificar, suprimir y revocar esta autorización) y la política de tratamiento de datos de la empresa; puedo ejercerlos escribiendo a ${correo || 'el correo de contacto de la empresa'}. No suministraré datos sensibles.`;

async function configuracion(admin: Admin, empresaId: string): Promise<Cfg | null> {
  const { data } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, encuesta_aviso_correos, empresa:agenda_empresas(slug)')
    .eq('empresa_id', empresaId).maybeSingle();
  return data;
}

async function enviar(admin: Admin, empresaId: string, citaId: string | null, config: Cfg, destinos: string[], tipo: TipoCorreoNegociacion, ctxBase: Omit<Parameters<typeof correoNegociacion>[1], 'marca' | 'modoPruebas' | 'destinatarioReal'>, tipoDest: 'cliente' | 'propietario' | 'interno') {
  if (!destinos.length || !config?.correo_smtp_host || !config.correo_remitente_email) return 0;
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
  if (!password) return 0;
  const marca = marcaCorreo(config);
  const modoPruebas = config.correo_modo_pruebas !== false;
  const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string } });
  let enviados = 0;
  for (const real of [...new Set(destinos.map((d) => d.toLowerCase()))]) {
    // En modo de pruebas nunca se escribe a personas reales: si no hay correo de pruebas, no se envía.
    if (modoPruebas && !config.correo_pruebas_destino) continue;
    const destino = modoPruebas ? config.correo_pruebas_destino : real;
    const { asunto, html } = correoNegociacion(tipo, { ...ctxBase, marca, modoPruebas, destinatarioReal: real });
    let estado: 'enviado' | 'fallido' = 'enviado'; let detalle: string | null = null;
    try {
      await transporte.sendMail({ from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html });
      enviados++;
    } catch (e) { estado = 'fallido'; detalle = e instanceof Error ? e.message : String(e); }
    try { await admin.from('agenda_correos_log').insert({ empresa_id: empresaId, cita_id: citaId, destinatario_tipo: tipoDest, destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas }); } catch { /* sin registro no hay más que hacer */ }
  }
  return enviados;
}

// Asesor de la visita + sus supervisores (+ correos de Configuración para avisos de encuesta). Si no hay ninguno, los administradores activos.
async function destinatariosInternos(admin: Admin, empresaId: string, config: Cfg, asesorId: string | null): Promise<string[]> {
  const set = new Set<string>(correosDe(config?.encuesta_aviso_correos));
  if (asesorId) {
    const { data: a } = await admin.from('agenda_asesores').select('correo, correos_adicionales').eq('id', asesorId).maybeSingle();
    for (const c of [...correosDe(a?.correo), ...correosDe(a?.correos_adicionales)]) set.add(c);
    const { data: rel } = await admin.from('agenda_asesor_supervisores').select('supervisor_usuario_id').eq('asesor_id', asesorId);
    for (const r of rel || []) { const { data } = await admin.auth.admin.getUserById(r.supervisor_usuario_id); if (data?.user?.email) set.add(data.user.email); }
  }
  if (!set.size) {
    const { data: m } = await admin.from('agenda_miembros').select('usuario_id').eq('empresa_id', empresaId).eq('rol', 'administrador').eq('activo', true);
    for (const x of m || []) { const { data } = await admin.auth.admin.getUserById(x.usuario_id); if (data?.user?.email) set.add(data.user.email); }
  }
  return [...set];
}

async function contexto(admin: Admin, negId: string) {
  const { data: n } = await admin.from('agenda_negociaciones').select('id, empresa_id, cita_id, inmueble_id, numero_inmueble, cliente_email, valor_publicado, valor_vigente, valor_acordado, token_comprador, token_propietario').eq('id', negId).maybeSingle();
  if (!n) return null;
  const [{ data: cita }, { data: inm }, { data: movs }, config] = await Promise.all([
    admin.from('agenda_citas').select('asesor_id').eq('id', n.cita_id).maybeSingle(),
    admin.from('agenda_inmuebles').select('direccion, barrio').eq('id', n.inmueble_id).maybeSingle(),
    admin.from('agenda_negociacion_movimientos').select('de, accion, valor').eq('negociacion_id', n.id).order('creado_en'),
    configuracion(admin, n.empresa_id),
  ]);
  const { data: props } = await admin.from('agenda_propietarios').select('email').eq('empresa_id', n.empresa_id).eq('numero_inmueble', n.numero_inmueble);
  const dominio = config?.dominio_publico || 'citas.patrimonios.co';
  const sitio = `https://${String(dominio).replace(/^https?:\/\//, '')}`;
  return {
    n, config, asesorId: cita?.asesor_id ?? null, sitio,
    propietarios: [...new Set((props || []).flatMap((p) => correosDe(p.email)))],
    base: { numero: String(n.numero_inmueble || ''), direccion: [inm?.direccion, inm?.barrio].filter(Boolean).join(', '), valorPublicado: Number(n.valor_publicado), historial: movs || [], correoDocumentos: config?.correo_contacto || undefined },
  };
}

async function avisarMovimiento(admin: Admin, negId: string, r: { evento: string; de: string; estado: string; valor?: number }) {
  const c = await contexto(admin, negId);
  if (!c) return;
  const { n, config, asesorId, sitio, propietarios, base } = c;
  const urlComp = `${sitio}/negociacion/${n.token_comprador}`;
  const urlProp = `${sitio}/negociacion/${n.token_propietario}`;
  const valor = r.valor ?? Number(n.valor_acordado ?? n.valor_vigente ?? 0);
  const interno = await destinatariosInternos(admin, n.empresa_id, config || {}, asesorId);
  const textos: Record<string, string> = {
    propuesta: `El comprador propuso ${pesos(valor)}. El propietario ya recibió el aviso.`,
    contrapropuesta: `El propietario propuso otro valor: ${pesos(valor)}. El comprador ya recibió el aviso.`,
    acepta: `Se acordó el valor ${pesos(valor)}. El comprador recibió el enlace para dejar los datos de la promesa.`,
    rechaza: `${r.de === 'comprador' ? 'El comprador' : 'El propietario'} dio por terminada la conversación sin acuerdo.`,
  };
  const comun = { ...base, valor, evento: textos[r.evento] };
  const cfg = config || {};
  if (r.evento === 'propuesta') await enviar(admin, n.empresa_id, n.cita_id, cfg, propietarios, 'propietario_propuesta', { ...comun, url: urlProp }, 'propietario');
  else if (r.evento === 'contrapropuesta') await enviar(admin, n.empresa_id, n.cita_id, cfg, correosDe(n.cliente_email), 'comprador_contrapropuesta', { ...comun, url: urlComp }, 'cliente');
  else if (r.evento === 'acepta') {
    await enviar(admin, n.empresa_id, n.cita_id, cfg, correosDe(n.cliente_email), 'comprador_acuerdo', { ...comun, url: urlComp }, 'cliente');
    await enviar(admin, n.empresa_id, n.cita_id, cfg, propietarios, 'propietario_acuerdo', comun, 'propietario');
  } else if (r.evento === 'rechaza') {
    if (r.de === 'comprador') await enviar(admin, n.empresa_id, n.cita_id, cfg, propietarios, 'propietario_cierre', { ...comun, evento: undefined }, 'propietario');
    else await enviar(admin, n.empresa_id, n.cita_id, cfg, correosDe(n.cliente_email), 'comprador_cierre', { ...comun, evento: undefined }, 'cliente');
  }
  await enviar(admin, n.empresa_id, n.cita_id, cfg, interno, 'interno_movimiento', { ...comun, urlAgenda: `${sitio}/` }, 'interno');
}

function parseValor(v: unknown): number | null {
  const s = String(v ?? '').replace(/[\s$.,]/g, '');
  if (!/^\d{1,13}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const TIPOS_DOC = ['CC', 'CE', 'PA', 'NIT', 'TI', 'otro'];
const ESTADOS_CIVIL = ['soltero', 'casado', 'union_libre', 'divorciado', 'viudo'];
const FORMAS_PAGO = ['contado', 'credito_hipotecario', 'subsidio', 'mixto', 'otro'];
const limpia = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Solicitud no válida.' }, 400); }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const accion = String(body.accion || '');

  try {
    // ---- Iniciar: el cliente marcó «avanzar» en un inmueble en venta -----------------------------------------------------
    if (accion === 'iniciar') {
      const t = String(body.encuesta_token || '');
      if (!UUID.test(t)) return json({ ok: false, error: 'Enlace no válido.' }, 400);
      const { data: enc } = await admin.from('agenda_encuestas_cliente').select('cita_id, intencion, respondido_en').eq('token', t).maybeSingle();
      if (!enc || !enc.respondido_en || enc.intencion !== 'avanzar') return json({ ok: false, error: 'Esta encuesta no permite iniciar una propuesta.' }, 400);
      const { data: r } = await admin.rpc('agenda_negociacion_crear', { p_cita_id: enc.cita_id });
      if (!r?.ok) return json({ ok: false, error: r?.error || 'No se pudo iniciar.' }, 400);
      if (r.creada) {
        const c = await contexto(admin, r.id);
        if (c) {
          const cfg = c.config || {};
          await enviar(admin, c.n.empresa_id, c.n.cita_id, cfg, correosDe(c.n.cliente_email), 'comprador_inicio', { ...c.base, url: `${c.sitio}/negociacion/${c.n.token_comprador}` }, 'cliente');
          const interno = await destinatariosInternos(admin, c.n.empresa_id, cfg, c.asesorId);
          await enviar(admin, c.n.empresa_id, c.n.cita_id, cfg, interno, 'interno_movimiento', { ...c.base, valor: Number(c.n.valor_publicado), evento: 'El cliente quiere avanzar y recibió el enlace para proponer un valor.', urlAgenda: `${c.sitio}/` }, 'interno');
        }
      }
      return json({ ok: true, creada: !!r.creada, token: r.token_comprador });
    }

    const token = String(body.token || '');
    if (!UUID.test(token)) return json({ ok: false, error: 'Este enlace no funciona o ya venció.' }, 400);

    if (accion === 'ver') {
      const { data } = await admin.rpc('agenda_negociacion_ver', { p_token: token });
      if (!data || data.error) return json({ ok: false, error: 'Este enlace no funciona o ya venció.' }, 404);
      const salida = { ...data }; delete salida.empresa_id;
      if (data.rol === 'comprador' && data.estado === 'acordada') {
        const config = await configuracion(admin, data.empresa_id);
        salida.texto_autorizacion = TEXTO_AUTORIZACION(config?.nombre_comercial || 'la inmobiliaria', config?.correo_contacto || '');
        salida.correo_documentos = config?.correo_contacto || null;
      }
      return json({ ok: true, ...salida });
    }

    if (accion === 'responder') {
      const decision = String(body.decision || '');
      const map: Record<string, string> = { proponer: 'proponer', aceptar: 'aceptar', rechazar: 'rechazar' };
      if (!map[decision]) return json({ ok: false, error: 'Opción no válida.' }, 400);
      let valor: number | null = null;
      if (decision === 'proponer') { valor = parseValor(body.valor); if (!valor) return json({ ok: false, error: 'Escribe solo el valor, con números.' }, 400); }
      const { data: r } = await admin.rpc('agenda_negociacion_mover', { p_token: token, p_accion: decision, p_valor: valor });
      if (!r?.ok) {
        const msg: Record<string, string> = { valor_invalido: 'El valor está fuera del rango permitido. Revisa que sea una cifra razonable respecto al valor publicado.', no_es_su_turno: 'Ahora le toca responder a la otra parte. Te avisaremos por correo.', cerrada: 'Esta conversación ya se cerró.', no_encontrada: 'Este enlace no funciona o ya venció.', sin_valor: 'Primero debe haber un valor propuesto.' };
        return json({ ok: false, error: msg[r?.error] || 'No se pudo registrar tu respuesta.', codigo: r?.error }, 400);
      }
      // Los avisos no deben bloquear la respuesta del usuario.
      await avisarMovimiento(admin, r.negociacion_id, { evento: r.evento, de: r.de, estado: r.estado, valor: r.valor }).catch((e) => console.error('portal-negociacion avisos:', e instanceof Error ? e.message : e));
      return json({ ok: true, estado: r.estado });
    }

    if (accion === 'promesa') {
      if (body.autoriza !== true) return json({ ok: false, error: 'Para continuar debes aceptar el tratamiento de tus datos.' }, 400);
      const d = (body.datos || {}) as Record<string, unknown>;
      const datos = {
        tipo_persona: d.tipo_persona === 'juridica' ? 'juridica' : 'natural',
        nombre_completo: limpia(d.nombre_completo, 160), tipo_documento: String(d.tipo_documento || ''), numero_documento: limpia(d.numero_documento, 30),
        representante_legal: limpia(d.representante_legal, 160), estado_civil: ESTADOS_CIVIL.includes(String(d.estado_civil)) ? String(d.estado_civil) : '',
        email: limpia(d.email, 160).toLowerCase(), celular: limpia(d.celular, 20), direccion: limpia(d.direccion, 200),
        compra_con_otros: d.compra_con_otros === true, otros_compradores: limpia(d.otros_compradores, 400), forma_pago: String(d.forma_pago || ''),
      };
      if (datos.nombre_completo.length < 3 || !TIPOS_DOC.includes(datos.tipo_documento) || !/^[A-Za-z0-9.\-]{4,30}$/.test(datos.numero_documento)
        || !/^\S+@\S+\.\S+$/.test(datos.email) || !/^[0-9+\s\-]{7,20}$/.test(datos.celular) || !FORMAS_PAGO.includes(datos.forma_pago)
        || (datos.tipo_persona === 'juridica' && datos.representante_legal.length < 3)) {
        return json({ ok: false, error: 'Revisa los datos: hay campos incompletos o con formato no válido.' }, 400);
      }
      const { data: v } = await admin.rpc('agenda_negociacion_ver', { p_token: token });
      if (!v || v.error || v.rol !== 'comprador') return json({ ok: false, error: 'Este enlace no funciona o ya venció.' }, 404);
      const config = await configuracion(admin, v.empresa_id);
      const texto = TEXTO_AUTORIZACION(config?.nombre_comercial || 'la inmobiliaria', config?.correo_contacto || '');
      const { data: r } = await admin.rpc('agenda_negociacion_promesa_guardar', { p_token: token, p_datos: datos, p_texto: texto });
      if (!r?.ok) return json({ ok: false, error: r?.error === 'no_acordada' ? 'Primero deben acordar el valor.' : r?.error === 'limite' ? 'Ya corregiste tus datos varias veces. Escríbele a tu asesor para cambiarlos.' : 'No se pudieron guardar los datos. Revisa el formulario.' }, 400);
      const c = r.nuevo ? await contexto(admin, r.negociacion_id) : null; // el aviso interno sale solo la primera vez
      if (c) {
        const interno = await destinatariosInternos(admin, c.n.empresa_id, c.config || {}, c.asesorId);
        await enviar(admin, c.n.empresa_id, c.n.cita_id, c.config || {}, interno, 'interno_promesa', { ...c.base, valor: Number(c.n.valor_acordado), urlAgenda: `${c.sitio}/` }, 'interno').catch(() => 0);
      }
      return json({ ok: true });
    }
    return json({ ok: false, error: 'Acción no válida.' }, 400);
  } catch (e) {
    console.error('portal-negociacion:', e instanceof Error ? e.message : e);
    return json({ ok: false, error: 'No se pudo completar la solicitud. Inténtalo de nuevo.' }, 500);
  }
});
