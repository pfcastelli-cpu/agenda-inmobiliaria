// Edge Function: avisar-inspeccion
// Avisa al arrendatario de una INSPECCIÓN programada (tipo_cita = 'inspeccion'): fecha, hora, quién va, para qué, y el enlace donde verá
// el día de la visita el código de llegada y el de salida. Requiere sesión de un miembro activo de la empresa de la cita.
// El destinatario sale siempre de agenda_arrendatarios (nunca del cuerpo de la solicitud). Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { botonesCorreo, type BotonCorreo } from '../_shared/plantilla-correo.ts';
import { correoVisita } from '../_shared/visita-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fechaTexto = (f: string) => { const [a, m, d] = f.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
const horaTexto = (h: string) => { const [H, M] = h.split(':').map(Number); return `${H % 12 === 0 ? 12 : H % 12}:${String(M).padStart(2, '0')} ${H >= 12 ? 'p. m.' : 'a. m.'}`; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400); }
  const citaId = String(body.cita_id || '');
  if (!citaId) return json({ ok: false, error: 'Falta cita_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const interno = jwt.length > 20 && jwt === SERVICE_ROLE_KEY;
  const { data: usuarioData } = interno ? { data: null } : await admin.auth.getUser(jwt);
  const usuario = usuarioData?.user ?? null;
  if (!interno && !usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin.from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, titulo, tipo_cita, estado, token_arrendatario')
    .eq('id', citaId).maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);
  if (!interno && usuario) {
    const { data: miembro } = await admin.from('agenda_miembros').select('usuario_id').eq('empresa_id', cita.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
    if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  }
  if (cita.tipo_cita !== 'inspeccion' || !cita.inmueble_id || cita.estado === 'cancelada') {
    return json({ ok: true, enviado: false, motivo: 'Solo se avisa de inspecciones activas sobre un inmueble.' });
  }

  const { data: inmueble } = await admin.from('agenda_inmuebles').select('numero_inmueble, direccion, barrio, ciudad').eq('id', cita.inmueble_id).maybeSingle();
  if (!inmueble) return json({ ok: false, error: 'Inmueble no encontrado.' }, 404);
  const { data: config } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', cita.empresa_id).maybeSingle();
  const modoPruebas = config?.correo_modo_pruebas !== false;
  const marca = marcaCorreo(config);

  const { data: arr } = await admin.from('agenda_arrendatarios').select('nombre, email').eq('empresa_id', cita.empresa_id).eq('numero_inmueble', inmueble.numero_inmueble).maybeSingle();
  let correos = String(arr?.email || '').split(/[;,\s]+/).map((c) => c.trim()).filter((c) => /\S+@\S+\.\S+/.test(c));
  if (!correos.length && modoPruebas && config?.correo_pruebas_destino) correos = ['(este inmueble no tiene correo de arrendatario registrado)'];
  if (!correos.length) return json({ ok: true, enviado: false, motivo: `No hay correo registrado del arrendatario del inmueble Nº ${inmueble.numero_inmueble}. Avísale directamente.` });
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return json({ ok: true, enviado: false, motivo: 'El correo de la empresa no está configurado.' });
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id });
  if (!password) return json({ ok: true, enviado: false, motivo: 'Falta guardar la contraseña SMTP.' });

  let quien = '';
  let celular = '';
  if (cita.asesor_id) {
    const { data: a } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', cita.asesor_id).maybeSingle();
    quien = a?.nombre || '';
    celular = String(a?.celular || '').replace(/\D/g, '');
  }
  const celWa = celular.length === 10 && celular.startsWith('3') ? '57' + celular : celular;
  const lugar = [inmueble.direccion, inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const enlace = `${SITIO_URL}/inspeccion/${cita.token_arrendatario}`;
  const asunto = `Inspección programada · Inmueble ${inmueble.numero_inmueble} · ${fechaTexto(cita.fecha)}`;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const botones: BotonCorreo[] = [
    { texto: 'Ver mis códigos de seguridad', url: enlace, variante: 'principal' },
    ...(celWa.length >= 11 && quien ? [{ texto: `Escribir a ${quien} por WhatsApp`, url: `https://wa.me/${celWa}`, variante: 'whatsapp' as const }, { texto: `Llamar a ${quien}`, url: `tel:+${celWa}`, variante: 'llamar' as const }] : []),
  ];

  const html = (real: string) => correoVisita(marca, {
    tema: 'arrendatario',
    titulo: 'Tienes una inspección programada',
    preheader: `Inmueble ${inmueble.numero_inmueble}: ${fechaTexto(cita.fecha)}, ${horaTexto(cita.hora_inicio.slice(0, 5))}. El día de la visita verás tus códigos de seguridad.`,
    modoPruebas, destinatarioReal: real,
    cuerpo: `<p style="margin:0 0 12px">Hola${arr?.nombre ? ' ' + esc(arr.nombre) : ''}. Vamos a hacer una inspección en tu inmueble${cita.titulo ? ` para: <b>${esc(cita.titulo)}</b>` : ''}.</p>
      <p style="margin:0 0 12px"><b>${esc(fechaTexto(cita.fecha))}, ${esc(horaTexto(cita.hora_inicio.slice(0, 5)))}</b><br>${esc(lugar)}${quien ? `<br>Irá: <b>${esc(quien)}</b>` : ''}</p>
      <div style="margin:0 0 12px;padding:12px 14px;border-left:4px solid ${marca.accion};background:#f4f6f8;border-radius:4px"><p style="margin:0 0 4px;font-weight:700">Para tu seguridad: códigos de la visita</p><p style="margin:0;font-size:14px;line-height:1.55">El día de la inspección, en el botón de abajo verás un <b>código de llegada</b>. Dáselo a la persona de ${esc(marca.nombre || 'la inmobiliaria')} <b>solo cuando llegue</b>. Al terminar verás un <b>código de salida</b>, que le das cuando se vaya. Si te piden los códigos antes, o no te los piden, avísanos.</p></div>`,
    despues: botonesCorreo(marca, botones),
  });

  const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string } });
  let enviados = 0;
  for (const correo of correos) {
    const destino = modoPruebas ? config.correo_pruebas_destino || correo : correo;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({ from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html: html(correo) });
      enviados++;
    } catch (e) { estado = 'fallido'; detalle = e instanceof Error ? e.message : String(e); }
    try {
      await admin.from('agenda_correos_log').insert({ empresa_id: cita.empresa_id, cita_id: cita.id, destinatario_tipo: 'arrendatario', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
    } catch { /* sin registro no hay nada más que hacer */ }
  }
  if (!enviados) return json({ ok: true, enviado: false, motivo: 'Falló el envío del correo. Revisa la bitácora de correos.' });
  await admin.from('agenda_citas').update({ arrendatario_avisado_en: new Date().toISOString(), arrendatario_avisado_por: usuario?.id ?? null }).eq('id', cita.id);
  return json({ ok: true, enviado: true, enviados });
});
