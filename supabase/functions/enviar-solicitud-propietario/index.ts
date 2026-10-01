// Edge Function: enviar-solicitud-propietario
// La llama la página pública del informe en vivo (/propietario/:token), sin
// sesión — el token es el único requisito de acceso, igual que las demás
// funciones públicas de este proyecto. Guarda la solicitud del propietario
// (cambio de precio, cambio de fotos, o pedir asesoría) en
// agenda_solicitudes_propietario a través de la RPC agenda_crear_solicitud_propietario
// (ya valida el token y es la única que puede escribir en esa tabla desde
// afuera), y le avisa por correo al asesor a cargo del inmueble, con copia a
// su supervisor si tiene uno configurado.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

const ETIQUETAS_TIPO: Record<string, string> = {
  cambio_precio: 'Solicitud de cambio de precio',
  cambio_fotos: 'Solicitud de cambio de fotos',
  asesoria: 'Pidió una asesoría',
};

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

  const token = String(body.token || '');
  const tipo = String(body.tipo || '');
  if (!token) return json({ ok: false, error: 'Falta el token del informe.' }, 400);
  if (!['cambio_precio', 'cambio_fotos', 'asesoria'].includes(tipo)) {
    return json({ ok: false, error: 'Tipo de solicitud no válido.' }, 400);
  }
  const valorPropuesto = body.valor_propuesto != null && body.valor_propuesto !== '' ? Number(body.valor_propuesto) : null;
  const detalle = body.detalle ? String(body.detalle).slice(0, 2000) : null;
  const propietarioNombre = body.propietario_nombre ? String(body.propietario_nombre).slice(0, 200) : null;
  const propietarioEmail = body.propietario_email ? String(body.propietario_email).slice(0, 200) : null;

  const anonimo = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: solicitud, error: errorRpc } = await anonimo.rpc('agenda_crear_solicitud_propietario', {
    p_token: token,
    p_tipo: tipo,
    p_valor_propuesto: valorPropuesto,
    p_detalle: detalle,
    p_propietario_nombre: propietarioNombre,
    p_propietario_email: propietarioEmail,
  });

  if (errorRpc || !solicitud) {
    return json({ ok: false, error: errorRpc?.message || 'No se pudo guardar la solicitud.' }, 400);
  }

  const empresaId = solicitud.empresa_id as string;
  const numeroInmueble = solicitud.numero_inmueble as number;
  const asesorComercializacion = solicitud.asesor_comercializacion as string | null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;
  const asunto = `${ETIQUETAS_TIPO[tipo]} — inmueble Nº ${numeroInmueble}`;

  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'solicitud_propietario',
      destinatario_email: null,
      asunto,
      estado: 'omitido',
      detalle_error: 'Todavía no se ha guardado la configuración de correo (host o contraseña faltante). La solicitud quedó guardada igual.',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, guardada: true, notificado: false, motivo: 'Correo no configurado todavía.' });
  }

  // Resolver el asesor a cargo por nombre (agenda_inmuebles no tiene un FK al
  // asesor, solo el texto asesor_comercializacion que viene de Sedi) y, si
  // tiene uno configurado, su supervisor — ver la pestaña Equipo.
  let correoAsesor: string | null = null;
  let nombreAsesor: string | null = null;
  let correoSupervisor: string | null = null;
  if (asesorComercializacion) {
    const { data: asesor } = await admin
      .from('agenda_asesores')
      .select('id, nombre, correo, supervisor_id')
      .eq('empresa_id', empresaId)
      .ilike('nombre', asesorComercializacion.trim())
      .maybeSingle();
    if (asesor) {
      correoAsesor = asesor.correo || null;
      nombreAsesor = asesor.nombre;
      if (asesor.supervisor_id) {
        const { data: supervisor } = await admin
          .from('agenda_asesores')
          .select('correo')
          .eq('id', asesor.supervisor_id)
          .maybeSingle();
        correoSupervisor = supervisor?.correo || null;
      }
    }
  }

  // Si no se pudo identificar al asesor (o no tiene correo), el aviso va al
  // menos al correo remitente configurado, para que nadie se quede sin saber
  // que un propietario pidió algo.
  const destinatarioPrincipal = correoAsesor || config.correo_remitente_email;
  if (!destinatarioPrincipal) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'solicitud_propietario',
      destinatario_email: null,
      asunto,
      estado: 'omitido',
      detalle_error: `No se encontró correo para avisar de la solicitud del inmueble Nº ${numeroInmueble} (asesor: ${asesorComercializacion || 'sin asesor'}).`,
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, guardada: true, notificado: false, motivo: 'No se encontró a quién avisar.' });
  }

  let password: string | null = null;
  try {
    const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
    if (errorPw) throw errorPw;
    password = pw as string;
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'solicitud_propietario',
      destinatario_email: destinatarioPrincipal,
      asunto,
      estado: 'fallido',
      detalle_error: 'No se pudo leer la contraseña guardada: ' + (e instanceof Error ? e.message : String(e)),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, guardada: true, notificado: false, motivo: 'No se pudo leer la contraseña SMTP.' });
  }

  if (!password) {
    return json({ ok: true, guardada: true, notificado: false, motivo: 'Falta guardar la contraseña SMTP.' });
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

  const destinoReal = { to: destinatarioPrincipal, cc: correoSupervisor || undefined };
  const destino = modoPruebas
    ? { to: config.correo_pruebas_destino || destinatarioPrincipal, cc: undefined }
    : destinoReal;

  const filasDetalle: string[] = [
    `<tr><td style="padding:6px 0;color:#8492a6;font-size:12px;text-transform:uppercase">Inmueble</td></tr><tr><td style="padding:0 0 10px;font-size:15px;font-weight:700;color:#1A2C45">Nº ${numeroInmueble}</td></tr>`,
  ];
  if (tipo === 'cambio_precio' && valorPropuesto != null) {
    filasDetalle.push(
      `<tr><td style="padding:6px 0;color:#8492a6;font-size:12px;text-transform:uppercase">Precio propuesto por el propietario</td></tr><tr><td style="padding:0 0 10px;font-size:15px;font-weight:700;color:#1A2C45">$${valorPropuesto.toLocaleString('es-CO')}</td></tr>`,
    );
  }
  if (detalle) {
    filasDetalle.push(
      `<tr><td style="padding:6px 0;color:#8492a6;font-size:12px;text-transform:uppercase">Mensaje del propietario</td></tr><tr><td style="padding:0 0 10px;font-size:14px;color:#1A2C45">${escaparHtml(detalle)}</td></tr>`,
    );
  }
  if (propietarioNombre || propietarioEmail) {
    filasDetalle.push(
      `<tr><td style="padding:6px 0;color:#8492a6;font-size:12px;text-transform:uppercase">Quién escribió</td></tr><tr><td style="padding:0 0 4px;font-size:14px;color:#1A2C45">${escaparHtml(propietarioNombre) || ''}${propietarioEmail ? ` · ${escaparHtml(propietarioEmail)}` : ''}</td></tr>`,
    );
  }

  const bannerPruebas = modoPruebas
    ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">
        🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinoReal.to)}${destinoReal.cc ? ' (con copia a ' + escaparHtml(destinoReal.cc) + ')' : ''}
      </div>`
    : '';

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${bannerPruebas}
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08);padding:26px">
    <h1 style="color:#1A2C45;font-size:20px;margin:0 0 14px">${escaparHtml(ETIQUETAS_TIPO[tipo])}</h1>
    <p style="color:#526575;font-size:14px;margin:0 0 16px">El propietario del inmueble Nº ${numeroInmueble}${nombreAsesor ? ` (tu inmueble, ${escaparHtml(nombreAsesor)})` : ''} escribió desde el informe en vivo:</p>
    <table style="width:100%;border-collapse:collapse">${filasDetalle.join('')}</table>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(config.correo_remitente_nombre) || 'Patrimonios Inmobiliarios'} · aviso automático</p>
</div>
</body>
</html>`;

  try {
    await transporte.sendMail({
      from: `${config.correo_remitente_nombre || 'Patrimonios Inmobiliarios'} <${config.correo_remitente_email}>`,
      to: destino.to,
      cc: destino.cc,
      subject: asunto,
      html,
    });
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'solicitud_propietario',
      destinatario_email: destino.to + (destino.cc ? ` (cc ${destino.cc})` : ''),
      asunto,
      estado: 'enviado',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, guardada: true, notificado: true });
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'solicitud_propietario',
      destinatario_email: destino.to,
      asunto,
      estado: 'fallido',
      detalle_error: e instanceof Error ? e.message : String(e),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, guardada: true, notificado: false, motivo: 'La solicitud quedó guardada pero el correo falló.' });
  }
});
