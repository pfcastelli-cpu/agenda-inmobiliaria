// Edge Function: probar-correo-config
// Envía un correo de prueba usando la configuración SMTP ya guardada, para que un
// administrador pueda confirmar de inmediato si los datos son correctos (a diferencia
// de enviar-correo-cita, que es "fire and forget", esta función SÍ espera la respuesta
// del servidor SMTP y la devuelve tal cual, para poder mostrar el error real en pantalla).
// Solo administradores activos de la empresa pueden usarla — se verifica con el JWT
// del que llama, igual que en gestion-accesos.
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

async function registrarLog(
  admin: ReturnType<typeof createClient>,
  fila: {
    empresa_id: string;
    destinatario_email: string | null;
    asunto: string | null;
    estado: 'enviado' | 'fallido' | 'omitido';
    detalle_error?: string | null;
    modo_pruebas: boolean;
  },
) {
  try {
    await admin.from('agenda_correos_log').insert({ ...fila, destinatario_tipo: 'interno', cita_id: null });
  } catch {
    // Si ni el registro se puede guardar, no hay nada más que hacer aquí.
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

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!jwt) return json({ ok: false, error: 'Falta autenticación.' }, 401);

  const empresaId = String(body.empresa_id || '');
  if (!empresaId) return json({ ok: false, error: 'Falta empresa_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: quienLlama, error: errorQuienLlama } = await admin.auth.getUser(jwt);
  if (errorQuienLlama || !quienLlama?.user) {
    return json({ ok: false, error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' }, 401);
  }
  const { data: miembroLlamando } = await admin
    .from('agenda_miembros')
    .select('rol, activo')
    .eq('empresa_id', empresaId)
    .eq('usuario_id', quienLlama.user.id)
    .maybeSingle();
  if (!miembroLlamando || !miembroLlamando.activo || miembroLlamando.rol !== 'administrador') {
    return json({ ok: false, error: 'No tienes permisos de administrador en esta empresa.' }, 403);
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_pruebas_destino',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();

  const destino = String(body.destino || '').trim() || config?.correo_pruebas_destino || quienLlama.user.email || '';

  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) {
    return json({ ok: false, error: 'Todavía no has guardado el host y la contraseña SMTP.' }, 400);
  }
  if (!destino) {
    return json({ ok: false, error: 'No hay a dónde mandar la prueba: escribe un correo de destino.' }, 400);
  }

  const asunto = 'Correo de prueba — configuración de citas de Patrimonios';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;padding:20px">
    <h2 style="color:#1A2C45">✅ Tu configuración de correo funciona</h2>
    <p style="color:#526575">Este es un correo de prueba enviado desde el panel de administración de la agenda de citas, usando exactamente los mismos datos SMTP que se usan para los correos reales de confirmación de visitas.</p>
    <p style="color:#9aa7b0;font-size:12px">Enviado el ${new Date().toLocaleString('es-CO')}.</p>
  </body></html>`;

  let password: string | null = null;
  try {
    const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', {
      p_empresa_id: empresaId,
    });
    if (errorPw) throw errorPw;
    password = pw as string;
  } catch (e) {
    const detalle = 'No se pudo leer la contraseña guardada: ' + (e instanceof Error ? e.message : String(e));
    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: destino,
      asunto,
      estado: 'fallido',
      detalle_error: detalle,
      modo_pruebas: true,
    });
    return json({ ok: false, error: detalle });
  }

  if (!password) {
    return json({ ok: false, error: 'No hay contraseña SMTP guardada todavía.' }, 400);
  }

  try {
    const transporte = nodemailer.createTransport({
      host: config.correo_smtp_host,
      port: config.correo_smtp_puerto || 587,
      secure: config.correo_smtp_seguridad === 'ssl',
      auth: {
        user: config.correo_smtp_usuario || config.correo_remitente_email,
        pass: password,
      },
    });

    await transporte.sendMail({
      from: `${config.correo_remitente_nombre || 'Patrimonios Inmobiliarios'} <${config.correo_remitente_email}>`,
      to: destino,
      subject: asunto,
      html,
    });

    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: destino,
      asunto,
      estado: 'enviado',
      modo_pruebas: true,
    });

    return json({ ok: true, destino });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: destino,
      asunto,
      estado: 'fallido',
      detalle_error: detalle,
      modo_pruebas: true,
    });
    return json({ ok: false, error: detalle });
  }
});
