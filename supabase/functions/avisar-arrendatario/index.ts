// Edge Function: avisar-arrendatario
// Botón "Informar al arrendatario" de una cita de visita sobre un inmueble con estado CRM
// "Rentando" (arrendatario viviendo adentro). Envía al arrendatario un correo con la fecha,
// la hora y el asesor a cargo. No revela nombre ni datos del cliente que visita.
// Requiere sesión: el llamador debe ser un miembro activo de la empresa de la cita. El
// destinatario sale siempre de agenda_arrendatarios (nunca del cuerpo de la solicitud).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

function formatearFecha(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

// Mismo recorte de dirección que los demás correos: sin torre/apto/oficina.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INT|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;
function limpiarDireccion(d: string | null | undefined): string {
  if (!d) return '';
  return d.replace(REGEX_UNIDAD_INTERNA, ' ').replace(/[,-]{2,}/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}

async function registrarLog(
  admin: ReturnType<typeof createClient>,
  fila: {
    empresa_id: string;
    cita_id: string;
    destinatario_email: string | null;
    asunto: string | null;
    estado: 'enviado' | 'fallido' | 'omitido';
    detalle_error?: string | null;
    modo_pruebas: boolean;
  },
) {
  try {
    await admin.from('agenda_correos_log').insert({
      ...fila,
      destinatario_tipo: 'arrendatario',
      detalle_error: fila.detalle_error ?? null,
    });
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
  const citaId = String(body.cita_id || '');
  if (!citaId) return json({ ok: false, error: 'Falta cita_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: usuarioData } = await admin.auth.getUser(jwt);
  const usuario = usuarioData?.user;
  if (!usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, tipo_cita, estado')
    .eq('id', citaId)
    .maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);

  const { data: miembro } = await admin
    .from('agenda_miembros')
    .select('id')
    .eq('empresa_id', cita.empresa_id)
    .eq('usuario_id', usuario.id)
    .eq('activo', true)
    .maybeSingle();
  if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);

  if (cita.estado === 'cancelada' || cita.tipo_cita !== 'visita_cliente' || !cita.inmueble_id) {
    return json({ ok: true, enviado: false, motivo: 'Solo se informa de visitas de clientes activas sobre un inmueble.' });
  }

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('numero_inmueble, direccion, barrio, ciudad, estado_crm')
    .eq('id', cita.inmueble_id)
    .maybeSingle();
  if (!inmueble || String(inmueble.estado_crm || '').trim().toLowerCase() !== 'rentando') {
    return json({ ok: true, enviado: false, motivo: 'Este inmueble no está rentando; no se informa al arrendatario.' });
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino',
    )
    .eq('empresa_id', cita.empresa_id)
    .maybeSingle();
  const modoPruebas = config?.correo_modo_pruebas !== false;

  const { data: arrendatario } = await admin
    .from('agenda_arrendatarios')
    .select('nombre, email')
    .eq('empresa_id', cita.empresa_id)
    .eq('numero_inmueble', inmueble.numero_inmueble)
    .maybeSingle();
  const correos = String(arrendatario?.email || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
  if (!correos.length) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: `No hay correo de arrendatario para el inmueble Nº ${inmueble.numero_inmueble}.`,
      modo_pruebas: modoPruebas,
    });
    return json({
      ok: true,
      enviado: false,
      motivo: `No hay correo registrado del arrendatario del inmueble Nº ${inmueble.numero_inmueble}. Avísale directamente.`,
    });
  }

  if (!config?.correo_smtp_host || !config.correo_remitente_email) {
    return json({ ok: true, enviado: false, motivo: 'El correo de la empresa no está configurado.' });
  }
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id });
  if (!password) {
    return json({ ok: true, enviado: false, motivo: 'Falta guardar la contraseña SMTP.' });
  }

  let asesorNombre = '';
  let asesorCelular = '';
  if (cita.asesor_id) {
    const { data: asesor } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', cita.asesor_id).maybeSingle();
    asesorNombre = asesor?.nombre || '';
    asesorCelular = asesor?.celular || '';
  }

  const direccion = limpiarDireccion(inmueble.direccion);
  const ciudad = [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const fechaTexto = formatearFecha(cita.fecha);
  const horaTexto = formatearHora(cita.hora_inicio.slice(0, 5));
  const asunto = `Visita programada en tu vivienda · ${fechaTexto}`;
  const nombre = escaparHtml(arrendatario?.nombre || '');
  const remitenteNombre = config.correo_remitente_nombre || 'Patrimonios Inmobiliarios';

  const html = (destinatarioReal: string) => `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${
    modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinatarioReal)}</div>`
      : ''
  }
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
    <img src="${IMAGEN_ENCABEZADO}" alt="Visita programada" width="580" style="width:100%;max-width:580px;height:auto;display:block" />
    <div style="padding:28px 26px 20px">
      <h1 style="color:#1A2C45;font-size:21px;margin:0 0 6px">Visita programada en tu vivienda</h1>
      <p style="color:#526575;font-size:14px;margin:0 0 18px">Hola ${nombre}, te informamos que se programó una visita a la vivienda que ocupas${direccion ? ` en ${escaparHtml(direccion)}${ciudad ? ', ' + escaparHtml(ciudad) : ''}` : ''}, por parte de una persona interesada en el inmueble.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#8492a6;font-size:13px">Fecha</td><td style="padding:8px 0;color:#1A2C45;font-size:15px;font-weight:600">${escaparHtml(fechaTexto)}</td></tr>
        <tr><td style="padding:8px 0;color:#8492a6;font-size:13px">Hora</td><td style="padding:8px 0;color:#1A2C45;font-size:15px;font-weight:600">${escaparHtml(horaTexto)}</td></tr>
        ${asesorNombre ? `<tr><td style="padding:8px 0;color:#8492a6;font-size:13px">Asesor a cargo</td><td style="padding:8px 0;color:#1A2C45;font-size:15px;font-weight:600">${escaparHtml(asesorNombre)}${asesorCelular ? ' · ' + escaparHtml(asesorCelular) : ''}</td></tr>` : ''}
      </table>
      <p style="color:#526575;font-size:14px;margin:18px 0 0">Si no puedes recibir la visita en ese horario, comunícate con el asesor para reprogramarla. Gracias por tu colaboración.</p>
    </div>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(remitenteNombre)}</p>
</div>
</body>
</html>`;

  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });

  let enviados = 0;
  for (const correo of correos) {
    const destino = modoPruebas ? config.correo_pruebas_destino || correo : correo;
    try {
      await transporte.sendMail({
        from: `${remitenteNombre} <${config.correo_remitente_email}>`,
        to: destino,
        subject: asunto,
        html: html(correo),
      });
      await registrarLog(admin, {
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        destinatario_email: destino,
        asunto,
        estado: 'enviado',
        modo_pruebas: modoPruebas,
      });
      enviados++;
    } catch (e) {
      await registrarLog(admin, {
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        destinatario_email: destino,
        asunto,
        estado: 'fallido',
        detalle_error: e instanceof Error ? e.message : String(e),
        modo_pruebas: modoPruebas,
      });
    }
  }

  if (!enviados) {
    return json({ ok: true, enviado: false, motivo: 'Falló el envío del correo. Revisa la bitácora de correos.' });
  }
  await admin
    .from('agenda_citas')
    .update({ arrendatario_avisado_en: new Date().toISOString(), arrendatario_avisado_por: usuario.id })
    .eq('id', cita.id);
  return json({ ok: true, enviado: true, enviados });
});
