// Edge Function: responder-propietario
// Un miembro de la empresa le escribe al propietario que hizo una solicitud (asesoría, cambio de precio...) desde el sistema; el propietario
// recibe un correo con el diseño de la empresa y, si responde, la respuesta llega al correo de quien escribió (Reply-To).
// El destinatario sale de la solicitud guardada, nunca del cuerpo. Requiere sesión de un miembro activo. Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TIPOS: Record<string, string> = { asesoria: 'asesoría', cambio_precio: 'cambio de precio' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Solicitud inválida.' }, 400); }
  const solicitudId = String(body.solicitud_id || '');
  const mensaje = String(body.mensaje || '').trim().slice(0, 2000);
  if (!solicitudId || mensaje.length < 3) return json({ ok: false, error: 'Escribe el mensaje.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(jwt);
  const usuario = u?.user;
  if (!usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: sol } = await admin.from('agenda_solicitudes_propietario').select('id, empresa_id, inmueble_id, tipo, propietario_nombre, propietario_email').eq('id', solicitudId).maybeSingle();
  if (!sol) return json({ ok: false, error: 'Solicitud no encontrada.' }, 404);
  const { data: miembro } = await admin.from('agenda_miembros').select('nombre').eq('empresa_id', sol.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
  if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  const real = String(sol.propietario_email || '').split(/[;,\s]+/).map((c) => c.trim()).find((c) => /\S+@\S+\.\S+/.test(c));
  if (!real) return json({ ok: false, error: 'La solicitud no tiene correo del propietario.' }, 400);

  const { data: inmueble } = sol.inmueble_id ? await admin.from('agenda_inmuebles').select('numero_inmueble, direccion').eq('id', sol.inmueble_id).maybeSingle() : { data: null };
  const { data: config } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', sol.empresa_id).maybeSingle();
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return json({ ok: false, error: 'El correo de la empresa no está configurado.' }, 400);
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: sol.empresa_id });
  if (!password) return json({ ok: false, error: 'Falta guardar la contraseña SMTP.' }, 400);

  const modoPruebas = config.correo_modo_pruebas !== false;
  const destino = modoPruebas ? config.correo_pruebas_destino || real : real;
  const marca = marcaCorreo(config);
  const quien = miembro.nombre || 'Tu asesor';
  const parrafos = mensaje.split(/\n+/).map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('');
  const html = correoBase(marca, {
    tema: 'sala',
    etiqueta: `Respuesta a tu solicitud de ${TIPOS[sol.tipo] || 'información'}${inmueble ? ` · Inmueble Nº ${inmueble.numero_inmueble}` : ''}`,
    motivo: 'Te escribimos porque hiciste una solicitud desde el informe de tu inmueble. Para responder, solo responde a este correo.',
    titulo: `${quien} te respondió`,
    cuerpo: `<p style="margin:0 0 12px">Hola${sol.propietario_nombre ? ' ' + esc(sol.propietario_nombre) : ''},</p>${parrafos}<p style="margin:16px 0 0;font-weight:700">${esc(quien)}</p>`,
    modoPruebas, destinatarioReal: real,
  });
  const asunto = `Respuesta a tu solicitud${inmueble ? ` · Inmueble Nº ${inmueble.numero_inmueble}` : ''}`;
  const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string } });
  let estado: 'enviado' | 'fallido' = 'enviado';
  let detalle: string | null = null;
  try {
    await transporte.sendMail({ from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`, to: destino, replyTo: usuario.email || undefined, subject: asunto, html });
  } catch (e) { estado = 'fallido'; detalle = e instanceof Error ? e.message : String(e); }
  try {
    await admin.from('agenda_correos_log').insert({ empresa_id: sol.empresa_id, destinatario_tipo: 'propietario', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
  } catch { /* sin registro no hay nada más que hacer */ }
  if (estado === 'fallido') return json({ ok: false, error: 'No se pudo enviar el correo. Revisa la bitácora de correos.' }, 502);
  return json({ ok: true });
});
