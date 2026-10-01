// Edge Function: enviar-encuesta-cliente
// Se dispara justo después de marcar una cita como "Realizada" desde la
// agenda interna (igual que enviar-correo-cita/enviar-correo-propietario: sin
// sesión, no bloquea la confirmación visual, y solo actúa sobre la cita que
// se le pasa por id). Le pide al cliente, por correo, que califique la
// visita y deje un comentario — la otra mitad de "capturar el concepto del
// cliente" junto con el comentario que el asesor ya puede dejar al marcar la
// cita como realizada (columna feedback_cliente, agenda_citas).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

async function registrarLog(
  admin: ReturnType<typeof createClient>,
  fila: {
    empresa_id: string;
    cita_id: string | null;
    destinatario_tipo: string;
    destinatario_email: string | null;
    asunto: string | null;
    estado: 'enviado' | 'fallido' | 'omitido';
    detalle_error?: string | null;
    modo_pruebas: boolean;
  },
) {
  try {
    await admin.from('agenda_correos_log').insert(fila);
  } catch {
    // Si ni el registro del intento se puede guardar, no hay nada más que hacer aquí.
  }
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

  const citaId = String(body.cita_id || '');
  if (!citaId) return json({ ok: false, error: 'Falta cita_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: cita, error: errorCita } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, fecha, tipo_cita, cliente_nombre, cliente_email')
    .eq('id', citaId)
    .maybeSingle();

  if (errorCita || !cita) return json({ ok: false, error: 'No se encontró esa cita.' }, 404);

  if (cita.tipo_cita !== 'visita_cliente') {
    return json({ ok: true, enviado: false, motivo: 'Este tipo de cita no envía encuesta.' });
  }
  if (!cita.cliente_email) {
    return json({ ok: true, enviado: false, motivo: 'La cita no tiene correo de cliente guardado.' });
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino, dominio_publico',
    )
    .eq('empresa_id', cita.empresa_id)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;
  const asunto = '¿Qué te pareció la visita?';

  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'encuesta_cliente',
      destinatario_email: null,
      asunto,
      estado: 'omitido',
      detalle_error: 'Todavía no se ha guardado la configuración de correo (host o contraseña faltante).',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'Correo no configurado todavía.' });
  }

  // Una encuesta por cita (cita_id es único): si ya existe la reutilizamos en
  // vez de crear otra, para que el link de un reenvío no cambie.
  let token: string;
  const { data: existente } = await admin
    .from('agenda_encuestas_cliente')
    .select('token')
    .eq('cita_id', cita.id)
    .maybeSingle();

  if (existente) {
    token = existente.token;
  } else {
    const { data: nueva, error: errorInsert } = await admin
      .from('agenda_encuestas_cliente')
      .insert({ cita_id: cita.id, inmueble_id: cita.inmueble_id, empresa_id: cita.empresa_id })
      .select('token')
      .single();
    if (errorInsert || !nueva) {
      await registrarLog(admin, {
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        destinatario_tipo: 'encuesta_cliente',
        destinatario_email: null,
        asunto,
        estado: 'fallido',
        detalle_error: 'No se pudo crear el registro de la encuesta: ' + (errorInsert?.message || ''),
        modo_pruebas: modoPruebas,
      });
      return json({ ok: true, enviado: false, motivo: 'No se pudo crear la encuesta.' });
    }
    token = nueva.token;
  }

  const dominio = config.dominio_publico || 'citas.patrimonios.co';
  const linkOpinion = `https://${dominio}/opinion/${token}`;

  let password: string | null = null;
  try {
    const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id });
    if (errorPw) throw errorPw;
    password = pw as string;
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'encuesta_cliente',
      destinatario_email: null,
      asunto,
      estado: 'fallido',
      detalle_error: 'No se pudo leer la contraseña guardada: ' + (e instanceof Error ? e.message : String(e)),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'No se pudo leer la contraseña SMTP.' });
  }

  if (!password) {
    return json({ ok: true, enviado: false, motivo: 'Falta guardar la contraseña SMTP.' });
  }

  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: {
      user: config.correo_smtp_usuario || config.correo_remitente_email,
      pass: password,
    },
  });

  const destinatarioEnvio = modoPruebas ? config.correo_pruebas_destino || cita.cliente_email : cita.cliente_email;
  const bannerPruebas = modoPruebas
    ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">
        🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(cita.cliente_email)}
      </div>`
    : '';

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
  ${bannerPruebas}
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08);padding:28px 26px;text-align:center">
    <h1 style="color:#1A2C45;font-size:21px;margin:0 0 10px">¿Qué te pareció la visita?</h1>
    <p style="color:#526575;font-size:14px;margin:0 0 22px">Hola ${escaparHtml(cita.cliente_nombre) || ''}, gracias por visitar el inmueble. Tu opinión nos ayuda a mejorar y le llega directo al propietario.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="#1A2C45" style="border-radius:12px">
        <a href="${linkOpinion}" target="_blank" style="display:block;padding:15px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">
          ⭐&nbsp;&nbsp;Dejar mi opinión (1 minuto)
        </a>
      </td>
    </tr></table>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(config.correo_remitente_nombre) || 'Patrimonios Inmobiliarios'}</p>
</div>
</body>
</html>`;

  try {
    await transporte.sendMail({
      from: `${config.correo_remitente_nombre || 'Patrimonios Inmobiliarios'} <${config.correo_remitente_email}>`,
      to: destinatarioEnvio,
      subject: asunto,
      html,
    });
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'encuesta_cliente',
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'enviado',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: true });
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'encuesta_cliente',
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'fallido',
      detalle_error: e instanceof Error ? e.message : String(e),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'Falló el envío SMTP.' });
  }
});
