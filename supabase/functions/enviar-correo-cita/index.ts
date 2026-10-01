// Edge Function: enviar-correo-cita
// Envía el correo de confirmación de una cita de cliente (visita_cliente).
// Se puede llamar sin sesión (la usa tanto la página pública de reserva como
// la agenda interna), pero solo actúa sobre la cita que se le pasa por id y
// nunca deja mandar a un destinatario distinto al que ya está guardado en esa
// cita — así una llamada externa no puede usarse para mandar correo arbitrario.
//
// Desde el 29-sep-2026 el correo también trae adjunta una invitación de
// calendario (.ics, METHOD:REQUEST) con recordatorios a 24h, 2h y 1h antes,
// para que la visita le quede guardada al cliente en su iPhone/Android igual
// que si la hubiera reservado desde Google Calendar. El UID de esa invitación
// es siempre `cita-<id>@patrimonios.co`, calculado a partir del id de la
// cita — así la función de cancelación (marcar-inmueble-no-disponible) puede
// mandar un METHOD:CANCEL con el mismo UID sin tener que guardar nada extra.
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

// Quita torre/apto/oficina/etc. de la dirección antes de mostrarla al cliente
// — solo debe ver la dirección "de calle", nunca el detalle interno de la unidad.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INT|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;

function limpiarDireccion(direccion: string | null | undefined): string {
  if (!direccion) return '';
  return direccion
    .replace(REGEX_UNIDAD_INTERNA, ' ')
    .replace(/[,-]{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,-]+|[\s,-]+$/g, '')
    .trim();
}

// Genera un botón de ancho completo con estilos en línea (compatible con
// Gmail, Apple Mail, Outlook.com y clientes móviles) envuelto en una tabla
// para que también se vea bien en Outlook de escritorio.
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

// ---------------------------------------------------------------------------
// Invitación de calendario (.ics). Colombia no tiene horario de verano (UTC-5
// todo el año), así que convertir a UTC es simplemente sumar 5 horas — no hace
// falta un bloque VTIMEZONE completo.
// ---------------------------------------------------------------------------
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function aFechaICSUTC(fecha: string, hora: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [hh, mm, ss] = hora.split(':').map(Number);
  const dt = new Date(Date.UTC(anio, mes - 1, dia, (hh || 0) + 5, mm || 0, ss || 0));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}

function marcaDeTiempoICSAhora(): string {
  const ahora = new Date();
  return `${ahora.getUTCFullYear()}${pad2(ahora.getUTCMonth() + 1)}${pad2(ahora.getUTCDate())}T${pad2(ahora.getUTCHours())}${pad2(ahora.getUTCMinutes())}${pad2(ahora.getUTCSeconds())}Z`;
}

function escaparICS(texto: string | null | undefined): string {
  return String(texto || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// RFC 5545: una línea de contenido no debe superar 75 octetos; se "pliega"
// con un salto de línea seguido de un espacio.
function plegarLineaICS(linea: string): string {
  const partes: string[] = [];
  let resto = linea;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ' ' + resto.slice(74);
  }
  partes.push(resto);
  return partes.join('\r\n');
}

function uidCalendarioCita(citaId: string): string {
  return `cita-${citaId}@patrimonios.co`;
}

function construirICS(opts: {
  metodo: 'REQUEST' | 'CANCEL';
  uid: string;
  secuencia: number;
  dtStart: string;
  dtEnd: string;
  resumen: string;
  descripcion: string;
  ubicacion?: string;
  organizadorNombre: string;
  organizadorEmail: string;
  asistenteNombre: string;
  asistenteEmail: string;
  conAlarmas: boolean;
}): string {
  const lineas: (string | null)[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Patrimonios Inmobiliarios//Agenda de Citas//ES',
    `METHOD:${opts.metodo}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${marcaDeTiempoICSAhora()}`,
    `SEQUENCE:${opts.secuencia}`,
    `DTSTART:${opts.dtStart}`,
    `DTEND:${opts.dtEnd}`,
    plegarLineaICS(`SUMMARY:${escaparICS(opts.resumen)}`),
    plegarLineaICS(`DESCRIPTION:${escaparICS(opts.descripcion)}`),
    opts.ubicacion ? plegarLineaICS(`LOCATION:${escaparICS(opts.ubicacion)}`) : null,
    plegarLineaICS(`ORGANIZER;CN=${escaparICS(opts.organizadorNombre)}:mailto:${opts.organizadorEmail}`),
    plegarLineaICS(
      `ATTENDEE;CN=${escaparICS(opts.asistenteNombre)};ROLE=REQ-PARTICIPANT;RSVP=${opts.metodo === 'REQUEST' ? 'TRUE' : 'FALSE'}:mailto:${opts.asistenteEmail}`,
    ),
    `STATUS:${opts.metodo === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
  ];
  if (opts.conAlarmas) {
    const recordatorios: [string, string][] = [
      ['-P1D', '24 horas'],
      ['-PT2H', '2 horas'],
      ['-PT1H', '1 hora'],
    ];
    for (const [trigger, etiqueta] of recordatorios) {
      lineas.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        plegarLineaICS(`DESCRIPTION:Recordatorio: tu visita es en ${etiqueta}`),
        `TRIGGER:${trigger}`,
        'END:VALARM',
      );
    }
  }
  lineas.push('END:VEVENT', 'END:VCALENDAR');
  return lineas.filter((l): l is string => l !== null).join('\r\n');
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: cita, error: errorCita } = await admin
    .from('agenda_citas')
    .select(
      'id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_email, cliente_telefono, tipo_cita, direccion_libre, ciudad_libre',
    )
    .eq('id', citaId)
    .maybeSingle();

  if (errorCita || !cita) {
    return json({ ok: false, error: 'No se encontró esa cita.' }, 404);
  }

  if (cita.tipo_cita !== 'visita_cliente') {
    // Las citas internas (captación, inventario, etc.) todavía no tienen un
    // correo de cliente que enviar — no es un error, simplemente no aplica.
    return json({ ok: true, enviado: false, motivo: 'Este tipo de cita no envía correo de cliente.' });
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
      destinatario_tipo: 'cliente',
      destinatario_email: cita.cliente_email || null,
      asunto: null,
      estado: 'omitido',
      detalle_error: 'Todavía no se ha guardado la configuración de correo (host o contraseña faltante).',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'Correo no configurado todavía.' });
  }

  if (!cita.cliente_email) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'cliente',
      destinatario_email: null,
      asunto: null,
      estado: 'omitido',
      detalle_error: 'La cita no tiene un correo de cliente guardado.',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'La cita no tiene correo de cliente.' });
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

  let direccion = cita.direccion_libre || '';
  let ciudad = cita.ciudad_libre || '';
  let latitud: number | string | null = null;
  let longitud: number | string | null = null;
  let numeroInmueble: number | null = null;
  if (cita.inmueble_id) {
    const { data: inmueble } = await admin
      .from('agenda_inmuebles')
      .select('numero_inmueble, direccion, ciudad, barrio, latitud, longitud')
      .eq('id', cita.inmueble_id)
      .maybeSingle();
    if (inmueble) {
      direccion = inmueble.direccion || direccion;
      ciudad = [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ') || ciudad;
      latitud = inmueble.latitud;
      longitud = inmueble.longitud;
      numeroInmueble = inmueble.numero_inmueble;
    }
  }
  direccion = limpiarDireccion(direccion);

  const destinatarioReal = cita.cliente_email;
  const destinatarioEnvio = modoPruebas ? config.correo_pruebas_destino || destinatarioReal : destinatarioReal;

  const fechaTexto = formatearFecha(cita.fecha);
  const horaTexto = formatearHora(cita.hora_inicio.slice(0, 5));
  const direccionCompleta = [direccion, ciudad].filter(Boolean).join(', ');

  const asunto = `Confirmación de tu visita — ${fechaTexto} a las ${horaTexto}`;

  const bannerPruebas = modoPruebas
    ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">
        🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinatarioReal)}
      </div>`
    : '';

  // Botones de acción: solo se muestran los que sí tienen a dónde apuntar.
  const tieneCoordenadas = latitud !== null && latitud !== undefined && longitud !== null && longitud !== undefined;
  const wazeUrl = tieneCoordenadas
    ? `https://waze.com/ul?ll=${latitud},${longitud}&navigate=yes`
    : direccionCompleta
      ? `https://waze.com/ul?q=${encodeURIComponent(`${direccionCompleta}, Colombia`)}&navigate=yes`
      : null;
  const mapsUrl = tieneCoordenadas
    ? `https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`
    : direccionCompleta
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${direccionCompleta}, Colombia`)}`
      : null;
  const celularLimpio = asesorCelular ? asesorCelular.replace(/[^0-9]/g, '') : '';
  const mensajeWhatsapp = `Hola${asesorNombre ? ' ' + asesorNombre : ''}, te escribo por mi visita del ${fechaTexto} a las ${horaTexto}.`;
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

  let filasDatos = filaDato('📅', 'Fecha', escaparHtml(fechaTexto));
  filasDatos += filaDato('🕐', 'Hora', escaparHtml(horaTexto));
  if (direccion) {
    filasDatos += filaDato('📍', 'Dirección', `${escaparHtml(direccion)}${ciudad ? `, ${escaparHtml(ciudad)}` : ''}`);
  }
  if (asesorNombre) {
    filasDatos += filaDato(
      '🧑‍💼',
      'Tu asesor',
      `${escaparHtml(asesorNombre)}${asesorCelular ? ` · ${escaparHtml(asesorCelular)}` : ''}`,
    );
  }

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${bannerPruebas}
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
    <img src="${IMAGEN_ENCABEZADO}" alt="Tu visita quedó confirmada" width="580" style="width:100%;max-width:580px;height:auto;display:block" />
    <div style="padding:28px 26px 8px">
      <h1 style="color:#1A2C45;font-size:21px;margin:0 0 4px">¡Tu visita quedó confirmada!</h1>
      <p style="color:#526575;font-size:14px;margin:0 0 20px">Hola ${escaparHtml(cita.cliente_nombre) || ''}, estos son los detalles de tu cita:</p>
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
      <p style="color:#8492a6;font-size:12px;margin:0">Si necesitas cambiar o cancelar tu visita, comunícate directamente con tu asesor usando los botones de arriba. También te dejamos la cita guardada en el archivo adjunto para que quede en el calendario de tu teléfono, con recordatorios 24, 2 y 1 hora antes.</p>
    </div>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(config.correo_remitente_nombre) || 'Patrimonios Inmobiliarios'}</p>
</div>
</body>
</html>`;

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
      destinatario_tipo: 'cliente',
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'fallido',
      detalle_error: 'No se pudo leer la contraseña guardada: ' + (e instanceof Error ? e.message : String(e)),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'No se pudo leer la contraseña SMTP.' });
  }

  if (!password) {
    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'cliente',
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'omitido',
      detalle_error: 'No hay contraseña SMTP guardada todavía.',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'Falta guardar la contraseña SMTP.' });
  }

  // Invitación de calendario (.ics) — se adjunta siempre que la cita tenga
  // hora de inicio y de fin, con el mismo esquema de UID que usará después
  // la cancelación si el inmueble deja de estar disponible.
  const nombreRemitente = config.correo_remitente_nombre || 'Patrimonios Inmobiliarios';
  const descripcionICS = [
    numeroInmueble ? `Inmueble Nº ${numeroInmueble}` : null,
    direccionCompleta || null,
    asesorNombre ? `Asesor: ${asesorNombre}${asesorCelular ? ' · ' + asesorCelular : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const icsContent = construirICS({
    metodo: 'REQUEST',
    uid: uidCalendarioCita(cita.id),
    secuencia: 0,
    dtStart: aFechaICSUTC(cita.fecha, cita.hora_inicio),
    dtEnd: aFechaICSUTC(cita.fecha, cita.hora_fin || cita.hora_inicio),
    resumen: `Visita inmueble${numeroInmueble ? ' Nº ' + numeroInmueble : ''}${direccion ? ' — ' + direccion : ''}`,
    descripcion: descripcionICS,
    ubicacion: direccionCompleta || undefined,
    organizadorNombre: nombreRemitente,
    organizadorEmail: config.correo_remitente_email,
    asistenteNombre: cita.cliente_nombre || destinatarioEnvio,
    asistenteEmail: destinatarioEnvio,
    conAlarmas: true,
  });

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
      from: `${nombreRemitente} <${config.correo_remitente_email}>`,
      to: destinatarioEnvio,
      subject: asunto,
      html,
      icalEvent: {
        method: 'REQUEST',
        filename: 'visita.ics',
        content: icsContent,
      },
    });

    await registrarLog(admin, {
      empresa_id: cita.empresa_id,
      cita_id: cita.id,
      destinatario_tipo: 'cliente',
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
      destinatario_tipo: 'cliente',
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'fallido',
      detalle_error: e instanceof Error ? e.message : String(e),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: true, enviado: false, motivo: 'Falló el envío SMTP.' });
  }
});
