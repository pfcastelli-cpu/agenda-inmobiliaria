// Edge Function: avisar-ticket
// Correos de los tickets de soporte (pestaña «Soporte», sql/022). Exige sesión (verify_jwt activo):
//   { ticket_id, evento: 'creado' }     → avisa a los administradores de la empresa y al equipo de soporte de la plataforma (la llama quien creó el ticket)
//   { ticket_id, evento: 'respondido' } → avisa a quien lo escribió (la llama un administrador de la empresa o un usuario de soporte, sql/023)
//   { ticket_id, evento: 'respuesta_cliente' } → avisa a quien atiende el ticket (o, sin responsable, a administradores y soporte); la llama quien lo escribió (sql/024)
// Respeta el modo de pruebas (todo va a `correo_pruebas_destino`) y deja registro en agenda_correos_log (tipo `interno`).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieContacto, type MarcaCorreo } from '../_shared/marca-correo.ts';
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
function esc(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const TIPOS: Record<string, string> = { error: '🐞 Algo no funciona', mejora: '💡 Una mejora', duda: '❓ Una duda' };
const ESTADOS: Record<string, string> = { abierto: 'Abierto', en_revision: 'En revisión', en_espera: 'Esperando tu respuesta', resuelto: 'Resuelto', cerrado: 'Cerrado', descartado: 'Descartado' };

function plantilla(opts: { marca: MarcaCorreo; remitente: string; modoPruebas: boolean; destinatarioReal: string; titulo: string; cuerpo: string; boton?: { texto: string; url: string } }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.destinatarioReal)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(opts.marca, opts.titulo, 'ninguna')}
<div style="padding:28px 26px">
<h1 style="color:${opts.marca.principal};font-size:24px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;margin:0 0 12px">${esc(opts.titulo)}</h1>
<div style="color:#4d4d4d;font-size:14px;line-height:1.6">${opts.cuerpo}</div>
${opts.boton ? `<p style="margin:22px 0 0;text-align:center"><a href="${esc(opts.boton.url)}" style="display:inline-block;background:${opts.marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(opts.boton.texto)}</a></p>` : ''}
</div></div>
<p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${esc(opts.remitente)}</p>
${pieContacto(opts.marca)}
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo inválido.' }, 400);
  }
  const ticketId = String(body.ticket_id || '');
  const evento = body.evento === 'respondido' ? 'respondido' : body.evento === 'respuesta_cliente' ? 'respuesta_cliente' : 'creado';
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return json({ ok: false, error: 'Falta ticket_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(jwt);
  const usuario = u?.user;
  if (!usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: t } = await admin.from('agenda_tickets').select('*').eq('id', ticketId).maybeSingle();
  if (!t) return json({ ok: false, error: 'Ticket no encontrado.' }, 404);
  const { data: miembro } = await admin.from('agenda_miembros').select('rol').eq('empresa_id', t.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
  const { data: soporte } = await admin.from('agenda_soporte_usuarios').select('usuario_id').eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
  if (!miembro && !soporte) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  // «creado» solo lo dispara quien lo creó; «respondido» solo un administrador de la empresa o un usuario de soporte.
  // «respuesta_cliente» (quien escribió contestó dentro del hilo) también solo la dispara quien lo creó.
  if ((evento === 'creado' || evento === 'respuesta_cliente') && t.usuario_id !== usuario.id) return json({ ok: false, error: 'No permitido.' }, 403);
  if (evento === 'respondido' && !soporte && miembro?.rol !== 'administrador') return json({ ok: false, error: 'No permitido.' }, 403);
  // Último mensaje público del hilo de quien responde (la nota interna nunca entra aquí).
  const { data: ultimo } = await admin.from('agenda_ticket_mensajes').select('texto')
    .eq('ticket_id', ticketId).in('autor_tipo', evento === 'respuesta_cliente' ? ['solicitante'] : ['soporte', 'empresa']).order('creado_en', { ascending: false }).limit(1).maybeSingle();
  const textoMensaje: string = ultimo?.texto || (evento === 'respondido' ? t.respuesta : '') || '';

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, dominio_publico, nombre_comercial, contacto_empresa, correo_contacto, telefono, empresa:agenda_empresas(slug)')
    .eq('empresa_id', t.empresa_id)
    .maybeSingle();
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return json({ ok: true, enviado: false, motivo: 'Correo no configurado.' });
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: t.empresa_id });
  if (!password) return json({ ok: true, enviado: false, motivo: 'Falta la contraseña SMTP.' });
  const marca = marcaCorreo(config);
  const modoPruebas = config.correo_modo_pruebas !== false;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const dominio = config.dominio_publico || 'citas.patrimonios.co';

  // Destinatarios
  const correos: string[] = [];
  if (evento === 'respuesta_cliente' && t.asignado_a) {
    // Si alguien ya atiende el ticket, el aviso va solo a esa persona.
    const { data } = await admin.auth.admin.getUserById(t.asignado_a);
    if (data?.user?.email) correos.push(data.user.email);
  } else if (evento === 'creado' || evento === 'respuesta_cliente') {
    const { data: admins } = await admin.from('agenda_miembros').select('usuario_id').eq('empresa_id', t.empresa_id).eq('rol', 'administrador').eq('activo', true);
    const { data: equipoSoporte } = await admin.from('agenda_soporte_usuarios').select('usuario_id').eq('activo', true);
    for (const a of [...(admins || []), ...(equipoSoporte || [])]) {
      const { data } = await admin.auth.admin.getUserById(a.usuario_id);
      if (data?.user?.email) correos.push(data.user.email);
    }
  } else {
    const { data } = await admin.auth.admin.getUserById(t.usuario_id);
    if (data?.user?.email) correos.push(data.user.email);
  }
  // Acuse de recibo: quien creó el ticket recibe su propio correo (con el plazo de respuesta), no el aviso del equipo.
  let correoAutor = '';
  if (evento === 'creado') {
    const { data } = await admin.auth.admin.getUserById(t.usuario_id);
    correoAutor = data?.user?.email || '';
  }
  const destinos = [...new Set(correos)].filter((c) => c !== correoAutor);
  if (!destinos.length && !correoAutor) return json({ ok: true, enviado: false, motivo: 'No hay a quién avisar.' });

  const asunto = evento === 'creado' ? `Nuevo ticket #${t.numero}: ${t.titulo}`
    : evento === 'respuesta_cliente' ? `Nuevo mensaje en el ticket #${t.numero}: ${t.titulo}`
    : `Respuesta a tu ticket #${t.numero}: ${t.titulo}`;
  const titulo = evento === 'creado' ? `Nuevo ticket #${t.numero}` : evento === 'respuesta_cliente' ? `Nuevo mensaje en el ticket #${t.numero}` : `Respondimos tu ticket #${t.numero}`;
  const cierre = evento === 'respondido' && ['resuelto', 'cerrado'].includes(t.estado)
    ? '<p style="margin:12px 0 0">Cuando puedas, abre Soporte y califica la atención (de 1 a 5 estrellas). Si el problema continúa, responde en el mismo ticket y lo reabrimos.</p>'
    : evento === 'respondido' && t.estado === 'en_espera'
      ? '<p style="margin:12px 0 0">Estamos esperando tu respuesta: ábrelo en Soporte y contesta dentro del mismo ticket.</p>' : '';
  const cuerpo = evento === 'respuesta_cliente'
    ? `<p style="margin:0 0 10px"><b>${esc(t.usuario_nombre || 'Un usuario')}</b> respondió en su ticket «<b>${esc(t.titulo)}</b>»:</p>
<p style="margin:0;padding:12px 14px;background:#f4f4f4;border-radius:10px;white-space:pre-wrap">${esc(textoMensaje)}</p>`
    : evento === 'creado'
    ? `<p style="margin:0 0 10px"><b>${esc(t.usuario_nombre || 'Un usuario')}</b> abrió un ticket${t.pagina ? ` desde «${esc(t.pagina)}»` : ''}:</p>
<p style="margin:0 0 6px;font-size:13px;color:#6b6b6b">${esc(TIPOS[t.tipo] || t.tipo)}</p>
<p style="margin:0 0 10px;font-weight:600;color:#1a2c45">${esc(t.titulo)}</p>
${t.descripcion ? `<p style="margin:0;padding:12px 14px;background:#f4f4f4;border-radius:10px;white-space:pre-wrap">${esc(t.descripcion)}</p>` : ''}`
    : `<p style="margin:0 0 10px">Tu ticket «<b>${esc(t.titulo)}</b>» ahora está <b>${esc(ESTADOS[t.estado] || t.estado)}</b>.</p>
${textoMensaje ? `<p style="margin:0;padding:12px 14px;background:#f4f4f4;border-radius:10px;white-space:pre-wrap">${esc(textoMensaje)}</p>` : ''}${cierre}`;

  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });
  const envios = destinos.map((real) => ({ real, asunto, titulo, cuerpo }));
  if (correoAutor) {
    // Mismo plazo que ve el usuario en la pantalla (public.agenda_ticket_sla_horas('normal') = 24 h).
    envios.push({
      real: correoAutor,
      asunto: `Recibimos tu ticket #${t.numero}: ${t.titulo}`,
      titulo: `Recibimos tu ticket #${t.numero}`,
      cuerpo: `<p style="margin:0 0 10px">Gracias por escribirnos. Ya tenemos tu solicitud «<b>${esc(t.titulo)}</b>» y la estamos revisando.</p>
<p style="margin:0 0 10px">Te respondemos en un máximo de <b>24 horas</b>. Cuando haya novedades te avisaremos en la campana de la aplicación y por correo, y podrás contestar dentro del mismo ticket.</p>
${t.descripcion ? `<p style="margin:0;padding:12px 14px;background:#f4f4f4;border-radius:10px;white-space:pre-wrap">${esc(t.descripcion)}</p>` : ''}`,
    });
  }
  let enviados = 0;
  for (const envio of envios) {
    const real = envio.real;
    const destino = modoPruebas ? config.correo_pruebas_destino || real : real;
    const { asunto, titulo, cuerpo } = envio;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({
        from: `${remitente} <${config.correo_remitente_email}>`,
        to: destino,
        subject: asunto,
        html: plantilla({ marca, remitente, modoPruebas, destinatarioReal: real, titulo, cuerpo, boton: { texto: 'Abrir Soporte', url: `https://${dominio}/` } }),
      });
      enviados++;
    } catch (e) {
      estado = 'fallido';
      detalle = e instanceof Error ? e.message : String(e);
    }
    try {
      await admin.from('agenda_correos_log').insert({ empresa_id: t.empresa_id, cita_id: null, destinatario_tipo: 'interno', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
    } catch { /* sin registro no hay nada más que hacer */ }
  }
  return json({ ok: true, enviado: enviados > 0, enviados });
});
