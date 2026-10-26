// Edge Function: recuperar-contrasena
// "Olvidé mi contraseña" de la pantalla de ingreso. Se puede llamar sin sesión (verify_jwt
// apagado), así que está hecha para no revelar nada: SIEMPRE responde lo mismo, exista o no
// el correo, y solo envía si es un miembro activo de una empresa, con máximo 5 envíos por
// hora y por persona. El enlace de un solo uso se genera con admin.auth.admin.generateLink y
// se envía por el SMTP de la empresa (el del correo de citas), no por el correo integrado de
// Supabase (límite ~2 por hora y solo a miembros del equipo de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_ENVIOS_POR_HORA = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function escaparHtml(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }
  const correo = String(body.correo || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(correo)) {
    return json({ ok: false, error: 'Escribe un correo válido.' }, 400);
  }
  const redirectSolicitado = body.redirect_to ? String(body.redirect_to) : '';

  // Respuesta única: nunca se dice si el correo existe, si se envió o si hubo un error.
  const respuestaGenerica = () => json({ ok: true });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Primer paso: saber si existe esa persona (sin redirección todavía).
    const sondeo = await admin.auth.admin.generateLink({ type: 'recovery', email: correo });
    const usuario = sondeo.data?.user;
    if (!usuario) return respuestaGenerica();

    const { data: miembro } = await admin
      .from('agenda_miembros')
      .select('empresa_id, nombre')
      .eq('usuario_id', usuario.id)
      .eq('activo', true)
      .limit(1)
      .maybeSingle();
    if (!miembro) return respuestaGenerica();
    const empresaId = miembro.empresa_id as string;

    // Límite de envíos por hora para esta persona.
    const hace1h = new Date(Date.now() - 3600000).toISOString();
    const { count } = await admin
      .from('agenda_correos_log')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('destinatario_tipo', 'interno')
      .eq('detalle_error', 'acceso:' + usuario.id)
      .gte('creado_en', hace1h);
    if ((count || 0) >= MAX_ENVIOS_POR_HORA) return respuestaGenerica();

    const { data: config } = await admin
      .from('agenda_configuracion')
      .select(
        'nombre_comercial, dominio_publico, correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion',
      )
      .eq('empresa_id', empresaId)
      .maybeSingle();
  const marca = marcaCorreo(config);
    if (!config?.correo_smtp_host || !config.correo_remitente_email) return respuestaGenerica();
    const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
    if (!password) return respuestaGenerica();

    // Solo se acepta una redirección hacia el dominio de la empresa (o local, para desarrollo).
    let redirectTo: string | undefined;
    try {
      const u = new URL(redirectSolicitado);
      const host = u.hostname.toLowerCase();
      const dominio = String(config.dominio_publico || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if ((dominio && host === dominio) || host === 'localhost' || host === '127.0.0.1') redirectTo = u.origin + '/';
    } catch {
      // sin redirección válida: Supabase usará su "Site URL"
    }

    const { data: enlace } = await admin.auth.admin.generateLink({ type: 'recovery', email: correo, options: { redirectTo } });
    const accion = enlace?.properties?.action_link;
    if (!accion) return respuestaGenerica();

    const modoPruebas = config.correo_modo_pruebas !== false;
    const destino = modoPruebas ? config.correo_pruebas_destino || correo : correo;
    const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Patrimonios Inmobiliarios';
    const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${
    modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(correo)}</div>`
      : ''
  }
  <div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
    ${encabezadoImagen(marca, `${escaparHtml(remitente)}`, 'ninguna')}
    <div style="padding:28px 26px 26px;text-align:center">
      <h1 style="color:${marca.principal};font-size:26px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-.01em;margin:0 0 8px">Restablece tu contraseña 🔑</h1>
      <p style="color:#4d4d4d;text-align:justify;font-size:15px;line-height:1.65;margin:0 0 22px">Hola ${escaparHtml(miembro.nombre || '')}, pulsa el botón para elegir una contraseña nueva.</p>
      <a href="${escaparHtml(accion)}" style="display:inline-block;background:${marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:16px 30px;border-radius:999px">🔑 Elegir contraseña nueva</a>
      <p style="color:#4d4d4d;text-align:justify;font-size:12.5px;margin:22px 0 0">El enlace es de un solo uso. Si no lo pediste, ignora este correo: tu contraseña sigue igual.</p>
    </div>
  </div>
  <p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${escaparHtml(remitente)}</p>
</div>
</body>
</html>`;

    const asunto = 'Restablece tu contraseña';
    const registrar = (estado: 'enviado' | 'fallido', detalle: string | null) =>
      admin.from('agenda_correos_log').insert({
        empresa_id: empresaId,
        cita_id: null,
        destinatario_tipo: 'interno',
        destinatario_email: destino,
        asunto,
        estado,
        detalle_error: detalle,
        modo_pruebas: modoPruebas,
      });

    try {
      const transporte = nodemailer.createTransport({
        host: config.correo_smtp_host,
        port: config.correo_smtp_puerto || 587,
        secure: config.correo_smtp_seguridad === 'ssl',
        auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
      });
      await transporte.sendMail({ from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html });
      await registrar('enviado', 'acceso:' + usuario.id);
    } catch (e) {
      await registrar('fallido', e instanceof Error ? e.message : String(e));
    }
  } catch {
    // Cualquier error interno se traga a propósito: la respuesta siempre es la misma.
  }
  return respuestaGenerica();
});
