// Edge Function: enviar-estudio-mercado (lleva JWT: solo administrador/coordinador de la empresa)
// Envía al propietario el PDF del estudio de mercado ya cargado en la lista (agenda_estudios_mercado) y lo marca «enviado».
// Respeta correo_modo_pruebas: en pruebas el correo va a correo_pruebas_destino con el PDF adjunto.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase, filaCorreo } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ ok: false, error: 'Sesión no válida' }, 401);

  let body: { estudio_id?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo no válido' }, 400); }
  if (!body.estudio_id) return json({ ok: false, error: 'Falta estudio_id' }, 400);

  const { data: est } = await admin.from('agenda_estudios_mercado').select('*').eq('id', body.estudio_id).maybeSingle();
  if (!est) return json({ ok: false, error: 'Estudio no encontrado' }, 404);
  const { data: miembro } = await admin.from('agenda_miembros').select('rol, activo').eq('empresa_id', est.empresa_id).eq('usuario_id', u.user.id).maybeSingle();
  if (!miembro?.activo || !['administrador', 'coordinador'].includes(miembro.rol)) return json({ ok: false, error: 'No tienes permiso' }, 403);
  if (!est.archivo_path) return json({ ok: false, error: 'Primero carga el PDF del estudio.' }, 400);
  if (!est.propietario_email) return json({ ok: false, error: 'Falta el correo del propietario. Escríbelo en la lista y guarda.' }, 400);

  const { data: pdf, error: errPdf } = await admin.storage.from('estudios-mercado').download(est.archivo_path);
  if (errPdf || !pdf) return json({ ok: false, error: 'No se pudo leer el PDF cargado.' }, 500);

  const { data: config } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', est.empresa_id).maybeSingle();
  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) return json({ ok: false, error: 'El correo de la empresa no está configurado.' }, 400);
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: est.empresa_id });
  if (!password) return json({ ok: false, error: 'No se pudo leer la contraseña del correo.' }, 500);

  const marca = marcaCorreo(config);
  const modoPruebas = config.correo_modo_pruebas !== false;
  const real = est.propietario_email as string;
  const to = modoPruebas ? (config.correo_pruebas_destino || real) : real;
  const nombre = (est.propietario_nombre || '').trim();
  const html = correoBase(marca, {
    titulo: `Tu estudio de mercado ${est.numero_inmueble ? `· inmueble Nº ${est.numero_inmueble}` : ''}`.trim(),
    tema: 'informe',
    cuerpo: `<p>${nombre ? `Hola ${esc(nombre)}, ` : 'Hola, '}como te prometimos, te enviamos el <b>estudio de mercado sin costo</b> de tu inmueble${est.numero_inmueble ? ` Nº ${est.numero_inmueble}` : ''}. Va adjunto en PDF.</p>
<table style="width:100%;border-collapse:collapse;margin-top:18px">${filaCorreo(marca, 'Qué incluye', '📊 Comparables de la zona y rango de valor sugerido')}${filaCorreo(marca, 'Siguiente paso', '📞 Si quieres, lo revisamos juntos en una llamada')}</table>`,
    modoPruebas, destinatarioReal: real,
  });
  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });
  const asunto = `Tu estudio de mercado${est.numero_inmueble ? ` — inmueble Nº ${est.numero_inmueble}` : ''}`;
  let estadoLog: 'enviado' | 'fallido' = 'enviado', detalleError: string | null = null;
  try {
    await transporte.sendMail({
      from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`,
      to, subject: asunto, html,
      attachments: [{ filename: est.archivo_nombre || `estudio-de-mercado-${est.numero_inmueble || ''}.pdf`, content: new Uint8Array(await pdf.arrayBuffer()), contentType: 'application/pdf' }],
    });
  } catch (e) { estadoLog = 'fallido'; detalleError = e instanceof Error ? e.message : String(e); }
  try { await admin.from('agenda_correos_log').insert({ empresa_id: est.empresa_id, cita_id: null, destinatario_tipo: 'estudio_mercado', destinatario_email: to, asunto, estado: estadoLog, detalle_error: detalleError, modo_pruebas: modoPruebas }); } catch { /* sin registro no hay nada más que hacer */ }
  if (estadoLog === 'fallido') return json({ ok: false, error: 'No se pudo enviar el correo.' }, 502);

  await admin.from('agenda_estudios_mercado').update({ estado: 'enviado', enviado_en: new Date().toISOString(), enviado_por: u.user.id }).eq('id', est.id);
  return json({ ok: true, enviado_a: to, modo_pruebas: modoPruebas });
});
