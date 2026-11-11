// Edge Function: avisar-solicitud-hecha
// Cuando alguien del equipo marca como «hecha» una solicitud del propietario (cambio de precio, de fotos, asesoría) en la
// agenda, esta función le manda al propietario un correo avisándole. La llama la agenda con la sesión de quien la marcó
// (lleva JWT): se verifica que sea miembro activo de la misma empresa de la solicitud. Respeta el modo de pruebas de la
// empresa (el correo va a correo_pruebas_destino) y deja registro en agenda_correos_log.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase, filaCorreo } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function esc(v: string | null | undefined): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const QUE_SE_HIZO: Record<string, string> = {
  cambio_precio: 'actualizamos el precio de tu inmueble',
  cambio_fotos: 'actualizamos las fotos de tu inmueble',
  asesoria: 'atendimos tu solicitud de asesoría',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!jwt) return json({ ok: false, error: 'Falta autenticación.' }, 401);
  const solicitudId = String(body.solicitud_id || '');
  if (!solicitudId) return json({ ok: false, error: 'Falta la solicitud.' }, 400);
  const reenviar = body.reenviar === true;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: quien, error: errorQuien } = await admin.auth.getUser(jwt);
  if (errorQuien || !quien?.user) return json({ ok: false, error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' }, 401);

  const { data: sol } = await admin
    .from('agenda_solicitudes_propietario')
    .select('id, empresa_id, inmueble_id, tipo, estado, propietario_nombre, propietario_email, nota_cierre, propietario_avisado_en, valor_propuesto, detalle, creado_en')
    .eq('id', solicitudId)
    .maybeSingle();
  if (!sol) return json({ ok: false, error: 'Esa solicitud no existe.' }, 404);

  // Solo miembros activos de la empresa de la solicitud.
  const { data: miembro } = await admin
    .from('agenda_miembros')
    .select('activo')
    .eq('empresa_id', sol.empresa_id)
    .eq('usuario_id', quien.user.id)
    .maybeSingle();
  if (!miembro?.activo) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);

  if (sol.estado !== 'hecha') return json({ ok: false, error: 'La solicitud todavía no está marcada como hecha.' }, 400);
  if (sol.propietario_avisado_en && !reenviar) return json({ ok: true, ya_avisado: true });
  const correoReal = String(sol.propietario_email || '').trim().toLowerCase();
  if (!correoReal) return json({ ok: false, error: 'Esta solicitud no trae el correo del propietario, no se le pudo avisar.' }, 400);

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('numero_inmueble, direccion, ciudad')
    .eq('id', sol.inmueble_id)
    .eq('empresa_id', sol.empresa_id)
    .maybeSingle();

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'nombre_comercial, correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, dominio_publico, empresa:agenda_empresas(slug)',
    )
    .eq('empresa_id', sol.empresa_id)
    .maybeSingle();
  if (!config?.correo_smtp_host || !config.correo_remitente_email) {
    return json({ ok: false, error: 'El correo de la empresa no está configurado (Administración → Correo).' }, 400);
  }
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: sol.empresa_id });
  if (!password) return json({ ok: false, error: 'Falta guardar la contraseña SMTP del correo de la empresa.' }, 400);

  const marca = marcaCorreo(config);
  const modoPruebas = config.correo_modo_pruebas !== false;
  const destino = modoPruebas ? config.correo_pruebas_destino || correoReal : correoReal;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const queSeHizo = QUE_SE_HIZO[sol.tipo] || 'atendimos tu solicitud';
  const ref = inmueble ? `Inmueble Nº ${inmueble.numero_inmueble}${inmueble.direccion ? ` · ${inmueble.direccion}` : ''}` : 'Tu inmueble';
  const NOMBRE_TIPO: Record<string, string> = { cambio_precio: 'Cambio de precio', cambio_fotos: 'Cambio de fotos', asesoria: 'Asesoría' };
  const dinero = (n: number | null) => (n == null ? '' : '$ ' + Number(n).toLocaleString('es-CO'));
  const pedido = [NOMBRE_TIPO[sol.tipo] || sol.tipo, sol.valor_propuesto != null ? `valor propuesto ${dinero(sol.valor_propuesto)}` : '', sol.detalle || ''].filter(Boolean).join(' · ');
  const fechaPedido = sol.creado_en ? new Date(sol.creado_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) : '';
  const asunto = `Ya atendimos tu solicitud · ${inmueble ? `Inmueble ${inmueble.numero_inmueble}` : 'tu inmueble'}`;

  const html = correoBase(marca, {
    titulo: 'Ya quedó lista tu solicitud',
    tema: 'cambio',
    preheader: `Ya ${queSeHizo}.`,
    cuerpo:
      `<p style="margin:0">Hola${sol.propietario_nombre ? ' ' + esc(sol.propietario_nombre) : ''}, ya ${esc(queSeHizo)}.</p>` +
      `<table style="width:100%;border-collapse:collapse;margin-top:18px">${filaCorreo(marca, 'Inmueble', esc(ref))}${filaCorreo(marca, 'Lo que pediste', esc(pedido) + (fechaPedido ? ` (${esc(fechaPedido)})` : ''))}${filaCorreo(marca, 'Resultado', esc(queSeHizo.charAt(0).toUpperCase() + queSeHizo.slice(1)))}${
        sol.nota_cierre ? filaCorreo(marca, 'Detalle', esc(sol.nota_cierre)) : ''
      }</table>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#63707a">Si algo no quedó como esperabas, responde este correo y lo revisamos contigo.</p>`,
    modoPruebas,
    destinatarioReal: correoReal,
  });

  const registrar = (estado: 'enviado' | 'fallido', detalle: string | null) =>
    admin.from('agenda_correos_log').insert({
      empresa_id: sol.empresa_id,
      cita_id: null,
      destinatario_tipo: 'propietario',
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
    await registrar('enviado', 'solicitud-hecha:' + sol.id);
    await admin.from('agenda_solicitudes_propietario').update({ propietario_avisado_en: new Date().toISOString() }).eq('id', sol.id);
    return json({ ok: true, modo_pruebas: modoPruebas });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    try {
      await registrar('fallido', detalle);
    } catch {
      // sin más
    }
    return json({ ok: false, error: 'Falló el envío del correo: ' + detalle }, 502);
  }
});
