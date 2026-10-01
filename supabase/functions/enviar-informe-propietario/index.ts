// Edge Function: enviar-informe-propietario
// La llama un administrador/coordinador desde la pestaña Informes (o desde la
// ficha del inmueble) para enviarle al propietario el link de su informe en
// vivo. SÍ requiere sesión (verify_jwt = true): primero valida el permiso con
// el JWT de quien llama (misma RPC que agenda_marcar_inmueble_no_disponible
// usa para auth.uid()), y solo después usa la service role para leer los
// correos de agenda_propietarios y enviar.
//
// El link apunta a una página pública nueva (/propietario/:token) que no
// necesita sesión — el token (uuid en agenda_inmuebles.token_informe_propietario)
// es el único requisito de acceso, igual que /inmuebles/:numero para reservar.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const IMAGEN_ENCABEZADO = 'https://adminpaxzu.patrimonios.co/uploads/images/Cita.jpg';

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

// Un mismo propietario puede tener varios correos separados por ';' en la
// hoja de origen (igual que en enviar-correo-propietario).
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extraerCorreosValidos(campoEmail: string | null | undefined): string[] {
  if (!campoEmail) return [];
  return campoEmail
    .split(/[;,]/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => REGEX_EMAIL.test(c));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'Falta iniciar sesión.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }

  const inmuebleId = String(body.inmueble_id || '');
  if (!inmuebleId) return json({ ok: false, error: 'Falta inmueble_id.' }, 400);

  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: permiso, error: errorPermiso } = await comoUsuario.rpc('agenda_verificar_permiso_informe_propietario', {
    p_inmueble_id: inmuebleId,
  });

  if (errorPermiso || !permiso) {
    return json({ ok: false, error: errorPermiso?.message || 'No tienes permiso para enviar este informe.' }, 403);
  }

  const empresaId = permiso.empresa_id as string;
  const numeroInmueble = permiso.numero_inmueble as number;
  const token = permiso.token as string;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino, dominio_publico',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;

  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'propietario_informe',
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: 'Todavía no se ha guardado la configuración de correo (host o contraseña faltante).',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'Correo no configurado todavía.' });
  }

  const { data: propietarios } = await admin
    .from('agenda_propietarios')
    .select('nombre, email')
    .eq('empresa_id', empresaId)
    .eq('numero_inmueble', numeroInmueble);

  const destinatarios = new Map<string, string[]>();
  for (const p of propietarios || []) {
    for (const correo of extraerCorreosValidos(p.email)) {
      const nombres = destinatarios.get(correo) || [];
      if (p.nombre && !nombres.includes(p.nombre)) nombres.push(p.nombre);
      destinatarios.set(correo, nombres);
    }
  }

  if (destinatarios.size === 0) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'propietario_informe',
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: `No hay propietarios con correo registrado para el inmueble Nº ${numeroInmueble}.`,
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'El inmueble no tiene propietarios con correo registrado.' });
  }

  const dominio = config.dominio_publico || 'citas.patrimonios.co';
  const linkInforme = `https://${dominio}/propietario/${token}`;
  const asunto = `El informe en vivo de tu inmueble Nº ${numeroInmueble}`;

  let password: string | null = null;
  try {
    const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
    if (errorPw) throw errorPw;
    password = pw as string;
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'propietario_informe',
      destinatario_email: null,
      asunto,
      estado: 'fallido',
      detalle_error: 'No se pudo leer la contraseña guardada: ' + (e instanceof Error ? e.message : String(e)),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'No se pudo leer la contraseña SMTP.' });
  }

  if (!password) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'propietario_informe',
      destinatario_email: null,
      asunto,
      estado: 'omitido',
      detalle_error: 'No hay contraseña SMTP guardada todavía.',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'Falta guardar la contraseña SMTP.' });
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

  function construirHtml(nombrePropietario: string, destinatarioRealCorreo: string) {
    const bannerPruebas = modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">
        🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinatarioRealCorreo)}
      </div>`
      : '';
    return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${bannerPruebas}
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
    <img src="${IMAGEN_ENCABEZADO}" alt="Informe de tu inmueble" width="580" style="width:100%;max-width:580px;height:auto;display:block" />
    <div style="padding:28px 26px 10px">
      <h1 style="color:#1A2C45;font-size:21px;margin:0 0 4px">El informe de tu inmueble Nº ${numeroInmueble}</h1>
      <p style="color:#526575;font-size:14px;margin:0 0 20px">Hola ${escaparHtml(nombrePropietario) || ''}, te compartimos el link con el informe en vivo de tu inmueble: cuántas visitas ha tenido, qué han dicho los clientes que lo han visto, y un espacio para pedirnos un cambio de precio, de fotos, o una asesoría cuando quieras. Se actualiza solo, así que puedes volver a verlo cuando quieras con este mismo link.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#1A2C45" style="border-radius:12px">
          <a href="${linkInforme}" target="_blank" style="display:block;padding:15px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">
            📊&nbsp;&nbsp;Ver el informe de mi inmueble
          </a>
        </td>
      </tr></table>
    </div>
    <div style="background:#f4f6f8;padding:16px 26px;border-top:1px solid #e6eaee">
      <p style="color:#8492a6;font-size:12px;margin:0">Este link es personal de tu inmueble; no lo compartas si prefieres que la información quede solo entre nosotros.</p>
    </div>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(config.correo_remitente_nombre) || 'Patrimonios Inmobiliarios'}</p>
</div>
</body>
</html>`;
  }

  let enviados = 0;
  for (const [correoPropietario, nombres] of destinatarios) {
    const nombrePropietario = nombres[0] || '';
    const destinatarioEnvio = modoPruebas ? config.correo_pruebas_destino || correoPropietario : correoPropietario;

    try {
      await transporte.sendMail({
        from: `${config.correo_remitente_nombre || 'Patrimonios Inmobiliarios'} <${config.correo_remitente_email}>`,
        to: destinatarioEnvio,
        subject: asunto,
        html: construirHtml(nombrePropietario, correoPropietario),
      });

      await registrarLog(admin, {
        empresa_id: empresaId,
        cita_id: null,
        destinatario_tipo: 'propietario_informe',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'enviado',
        modo_pruebas: modoPruebas,
      });
      enviados++;
    } catch (e) {
      await registrarLog(admin, {
        empresa_id: empresaId,
        cita_id: null,
        destinatario_tipo: 'propietario_informe',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'fallido',
        detalle_error: e instanceof Error ? e.message : String(e),
        modo_pruebas: modoPruebas,
      });
    }
  }

  return json({ ok: true, enviados, total_propietarios: destinatarios.size });
});
