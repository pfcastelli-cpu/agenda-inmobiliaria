// Edge Function: enviar-correo-propietario
// Avisa a todos los propietarios (con correo registrado) de un inmueble que
// se agendó una cita de cliente sobre su inmueble. Igual que
// enviar-correo-cita: se puede llamar sin sesión, pero solo actúa sobre la
// cita que se le pasa por id y solo lee/envía a los correos que ya están
// guardados en agenda_propietarios para ese inmueble — nunca a un
// destinatario arbitrario que venga en la solicitud.
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
  try {
    const [a, m, d] = fecha.split('-').map(Number);
    const dt = new Date(a, m - 1, d);
    return dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return fecha;
  }
}

function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  const ampm = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Misma limpieza de dirección que enviar-correo-cita: quita torre/apto/oficina/etc.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;

function limpiarDireccion(direccion: string | null | undefined): string {
  if (!direccion) return '';
  return direccion
    .replace(REGEX_UNIDAD_INTERNA, ' ')
    .replace(/[,-]{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,-]+|[\s,-]+$/g, '')
    .trim();
}

function filaBoton(url: string, colorFondo: string, colorTexto: string, icono: string, texto: string): string {
  return `
      <tr><td style="padding:7px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${colorFondo}" style="border-radius:12px">
            <a href="${url}" target="_blank" style="display:block;padding:15px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${colorTexto};text-decoration:none;border-radius:12px">
              ${icono}&nbsp;&nbsp;${texto}
            </a>
          </td>
        </tr></table>
      </td></tr>`;
}

function filaDato(icono: string, etiqueta: string, valor: string): string {
  return `
      <tr>
        <td style="padding:11px 0;font-size:20px;width:32px;vertical-align:top">${icono}</td>
        <td style="padding:11px 0;vertical-align:top">
          <div style="font-size:11.5px;color:#8492a6;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">${etiqueta}</div>
          <div style="font-size:15px;color:#1A2C45;font-weight:700;line-height:1.35">${valor}</div>
        </td>
      </tr>`;
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
// hoja de origen. Aquí los separamos y validamos, uno por uno.
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

  const { data: cita, error: errorCita } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, tipo_cita')
    .eq('id', citaId)
    .maybeSingle();

  if (errorCita || !cita) {
    return json({ ok: false, error: 'No se encontró esa cita.' }, 404);
  }

  if (cita.tipo_cita !== 'visita_cliente') {
    // Solo avisamos al propietario cuando es una visita real de un cliente
    // interesado sobre su inmueble; las citas internas no aplican.
    return json({ ok: true, enviados: 0, motivo: 'Este tipo de cita no envía correo de propietario.' });
  }

  if (!cita.inmueble_id) {
    return json({ ok: true, enviados: 0, motivo: 'La cita no tiene un inmueble asociado.' });
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino',
    )
    .eq('empresa_id', cita.empresa_id)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;

  if (!config?.correo_smtp_host || !config?.correo_smtp_password_secret_id) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'propietario',
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: 'Todavía no se ha guardado la configuración de correo (host o contraseña faltante).',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'Correo no configurado todavía.' });
  }

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('numero_inmueble, direccion, ciudad, barrio, latitud, longitud')
    .eq('id', cita.inmueble_id)
    .maybeSingle();

  if (!inmueble) {
    return json({ ok: true, enviados: 0, motivo: 'No se encontró el inmueble de la cita.' });
  }

  const { data: propietarios } = await admin
    .from('agenda_propietarios')
    .select('nombre, email')
    .eq('empresa_id', cita.empresa_id)
    .eq('numero_inmueble', inmueble.numero_inmueble);

  // Un mismo correo puede repetirse entre varios copropietarios (cuentas
  // compartidas); lo enviamos una sola vez por dirección, con los nombres
  // de todos los propietarios que la comparten.
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
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'propietario',
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: `No hay propietarios con correo registrado para el inmueble Nº ${inmueble.numero_inmueble}.`,
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviados: 0, motivo: 'El inmueble no tiene propietarios con correo registrado.' });
  }

  let asesorNombre = '';
  let asesorCelular = '';
  if (cita.asesor_id) {
    const { data: asesor } = await admin
      .from('agenda_asesores')
      .select('nombre, celular')
      .eq('id', cita.asesor_id)
      .maybeSingle();
    asesorNombre = asesor?.nombre || '';
    asesorCelular = asesor?.celular || '';
  }

  const direccion = limpiarDireccion(inmueble.direccion);
  const ciudad = [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const direccionCompleta = [direccion, ciudad].filter(Boolean).join(', ');

  const fechaTexto = formatearFecha(cita.fecha);
  const horaTexto = formatearHora(cita.hora_inicio.slice(0, 5));
  const asunto = `Nueva visita agendada en tu inmueble Nº ${inmueble.numero_inmueble}`;

  const tieneCoordenadas =
    inmueble.latitud !== null && inmueble.latitud !== undefined && inmueble.longitud !== null && inmueble.longitud !== undefined;
  const wazeUrl = tieneCoordenadas
    ? `https://waze.com/ul?ll=${inmueble.latitud},${inmueble.longitud}&navigate=yes`
    : direccionCompleta
      ? `https://waze.com/ul?q=${encodeURIComponent(`${direccionCompleta}, Colombia`)}&navigate=yes`
      : null;
  const mapsUrl = tieneCoordenadas
    ? `https://www.google.com/maps/search/?api=1&query=${inmueble.latitud},${inmueble.longitud}`
    : direccionCompleta
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${direccionCompleta}, Colombia`)}`
      : null;
  const celularLimpio = asesorCelular ? asesorCelular.replace(/[^0-9]/g, '') : '';
  const mensajeWhatsapp = `Hola${asesorNombre ? ' ' + asesorNombre : ''}, te escribo por la visita agendada en mi inmueble Nº ${inmueble.numero_inmueble} el ${fechaTexto} a las ${horaTexto}.`;
  const whatsappUrl = celularLimpio ? `https://wa.me/${celularLimpio}?text=${encodeURIComponent(mensajeWhatsapp)}` : null;
  const llamarUrl = asesorCelular ? `tel:${asesorCelular.replace(/\s+/g, '')}` : null;

  let filasBotones = '';
  if (wazeUrl) filasBotones += filaBoton(wazeUrl, '#05C3DD', '#ffffff', '🚗', 'Ver ruta en Waze');
  if (mapsUrl) filasBotones += filaBoton(mapsUrl, '#4285F4', '#ffffff', '🧭', 'Ver ruta en Google Maps');
  if (whatsappUrl)
    filasBotones += filaBoton(
      whatsappUrl,
      '#25D366',
      '#ffffff',
      '💬',
      `Escribir a ${escaparHtml(asesorNombre) || 'tu asesor'} por WhatsApp`,
    );
  if (llamarUrl) filasBotones += filaBoton(llamarUrl, '#1A2C45', '#ffffff', '📞', `Llamar a ${escaparHtml(asesorNombre) || 'tu asesor'}`);

  let filasDatos = filaDato('🏠', 'Inmueble', `Nº ${inmueble.numero_inmueble}`);
  filasDatos += filaDato('📅', 'Fecha de la visita', escaparHtml(fechaTexto));
  filasDatos += filaDato('🕐', 'Hora', escaparHtml(horaTexto));
  if (direccion) {
    filasDatos += filaDato('📍', 'Dirección', `${escaparHtml(direccion)}${ciudad ? `, ${escaparHtml(ciudad)}` : ''}`);
  }
  if (asesorNombre) {
    filasDatos += filaDato(
      '🧑‍💼',
      'Asesor a cargo',
      `${escaparHtml(asesorNombre)}${asesorCelular ? ` · ${escaparHtml(asesorCelular)}` : ''}`,
    );
  }

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
    <img src="${IMAGEN_ENCABEZADO}" alt="Se agendó una visita en tu inmueble" width="580" style="width:100%;max-width:580px;height:auto;display:block" />
    <div style="padding:28px 26px 8px">
      <h1 style="color:#1A2C45;font-size:21px;margin:0 0 4px">Se agendó una visita en tu inmueble</h1>
      <p style="color:#526575;font-size:14px;margin:0 0 20px">Hola ${escaparHtml(nombrePropietario) || ''}, te informamos que un cliente interesado visitará tu inmueble:</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        ${filasDatos}
      </table>
    </div>
    ${
      filasBotones
        ? `<div style="padding:6px 26px 26px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${filasBotones}
      </table>
    </div>`
        : ''
    }
    <div style="background:#f4f6f8;padding:16px 26px;border-top:1px solid #e6eaee">
      <p style="color:#8492a6;font-size:12px;margin:0">Si tienes alguna pregunta sobre esta visita, comunícate directamente con el asesor a cargo usando los botones de arriba.</p>
    </div>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(config.correo_remitente_nombre) || 'Patrimonios Inmobiliarios'}</p>
</div>
</body>
</html>`;
  }

  let password: string | null = null;
  try {
    const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', {
      p_empresa_id: cita.empresa_id,
    });
    if (errorPw) throw errorPw;
    password = pw as string;
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'propietario',
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
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'propietario',
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
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        destinatario_tipo: 'propietario',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'enviado',
        modo_pruebas: modoPruebas,
      });
      enviados++;
    } catch (e) {
      await registrarLog(admin, {
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        destinatario_tipo: 'propietario',
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
