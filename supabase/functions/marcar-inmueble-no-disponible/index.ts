// Edge Function: marcar-inmueble-no-disponible
// Se llama desde la ficha del inmueble cuando ya no está disponible (se
// arrendó, se vendió, alguien más radicó papeles, u otro motivo). A
// diferencia de enviar-correo-cita / enviar-correo-propietario, esta función
// SÍ requiere sesión (verify_jwt = true): marca el inmueble y cancela citas
// en nombre de quien llama, así que primero hay que saber quién es.
//
// Flujo:
//  1) Llama a la RPC agenda_marcar_inmueble_no_disponible usando el JWT de
//     quien invoca (no la service role) para que Postgres pueda validar el
//     permiso con auth.uid() exactamente igual que agenda_cancelar_cita /
//     agenda_mover_cita. La RPC marca el inmueble, cancela las citas futuras
//     de tipo visita_cliente que estaban confirmadas, y devuelve cuáles.
//  2) Con la service role, por cada cita cancelada: busca inmuebles similares
//     todavía disponibles (mismo tipo de oferta + misma ciudad + precio
//     parecido) y le manda al cliente un correo de disculpas — con la misma
//     invitación de calendario pero en versión METHOD:CANCEL, mismo UID que
//     usó enviar-correo-cita, para que el evento se borre solo del calendario
//     del cliente.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// ±20% — todavía no confirmado con Felipe como número exacto; es la lectura
// razonable de "precio similar" mientras lo ajusta si hace falta.
const TOLERANCIA_PRECIO = 0.2;
const MAX_SIMILARES = 3;

// Distancia aproximada en kilómetros entre dos coordenadas (fórmula de
// Haversine), usada para ordenar los inmuebles similares por cercanía real en
// vez de solo por "misma ciudad" (una ciudad como Bogotá es demasiado grande
// para que eso sea suficiente).
function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ordena los candidatos a "inmueble similar" priorizando, en orden: (1) los
// que tienen coordenadas y están más cerca del inmueble original, (2) los
// que están en el mismo barrio (cuando falta georreferenciación), y deja el
// resto en el orden que ya traían (por precio, de la consulta SQL).
function ordenarPorCercania(
  candidatos: Array<Record<string, unknown>>,
  original: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const latO = original.latitud !== null && original.latitud !== undefined ? Number(original.latitud) : null;
  const lonO = original.longitud !== null && original.longitud !== undefined ? Number(original.longitud) : null;
  const conDistancia = candidatos.map((c, idx) => {
    const lat = c.latitud !== null && c.latitud !== undefined ? Number(c.latitud) : null;
    const lon = c.longitud !== null && c.longitud !== undefined ? Number(c.longitud) : null;
    let distancia: number | null = null;
    if (latO !== null && lonO !== null && lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
      distancia = distanciaKm(latO, lonO, lat, lon);
    }
    const mismoBarrio = !!(original.barrio && c.barrio && original.barrio === c.barrio);
    return { c, idx, distancia, mismoBarrio };
  });
  conDistancia.sort((a, b) => {
    if (a.distancia !== null && b.distancia !== null) return a.distancia - b.distancia;
    if (a.distancia !== null) return -1;
    if (b.distancia !== null) return 1;
    if (a.mismoBarrio !== b.mismoBarrio) return a.mismoBarrio ? -1 : 1;
    return a.idx - b.idx;
  });
  return conDistancia.map((x) => x.c);
}

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

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

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

// ---------------------------------------------------------------------------
// Mismo constructor de .ics que enviar-correo-cita (duplicado a propósito:
// cada Edge Function se despliega por separado y no comparten módulos).
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

const ETIQUETAS_MOTIVO: Record<string, string> = {
  arrendado: 'se arrendó',
  vendido: 'se vendió',
  papeles_radicados: 'otra persona ya radicó los papeles',
  otro: 'ya no está disponible',
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'Falta iniciar sesión.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }

  const inmuebleId = String(body.inmueble_id || '');
  const motivo = String(body.motivo || '');
  const detalle = body.detalle ? String(body.detalle) : '';
  if (!inmuebleId) return json({ ok: false, error: 'Falta inmueble_id.' }, 400);
  if (!['arrendado', 'vendido', 'papeles_radicados', 'otro'].includes(motivo)) {
    return json({ ok: false, error: 'Motivo no válido.' }, 400);
  }

  // Cliente "como el usuario que llama": la RPC valida el permiso con
  // auth.uid(), igual que agenda_cancelar_cita / agenda_mover_cita.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: citasCanceladas, error: errorRpc } = await comoUsuario.rpc('agenda_marcar_inmueble_no_disponible', {
    p_inmueble_id: inmuebleId,
    p_motivo: motivo,
    p_detalle: detalle,
  });

  if (errorRpc) {
    return json({ ok: false, error: errorRpc.message || 'No se pudo marcar el inmueble.' }, 400);
  }

  const idsCitas = (citasCanceladas || []).map((c: { cita_id: string }) => c.cita_id).filter(Boolean);

  if (idsCitas.length === 0) {
    return json({ ok: true, marcado: true, citas_canceladas: 0, correos_enviados: 0 });
  }

  // A partir de aquí usamos la service role: ya sabemos que quien llamó tenía
  // permiso (la RPC no habría devuelto nada si no), y necesitamos leer datos
  // (inmuebles similares, configuración de correo) que el cliente no
  // necesariamente puede ver por sus propias políticas de RLS.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('empresa_id, numero_inmueble, direccion, ciudad, barrio, tipo_oferta, tipo_inmueble, valor_canon, valor_venta, latitud, longitud')
    .eq('id', inmuebleId)
    .maybeSingle();

  if (!inmueble) {
    // No debería pasar (la RPC ya lo encontró), pero por si acaso.
    return json({ ok: true, marcado: true, citas_canceladas: idsCitas.length, correos_enviados: 0 });
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_smtp_password_secret_id, correo_modo_pruebas, correo_pruebas_destino, dominio_publico, plantilla_enlace_inmueble',
    )
    .eq('empresa_id', inmueble.empresa_id)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;
  const puedeEnviar = !!(config?.correo_smtp_host && config?.correo_smtp_password_secret_id);

  // Inmuebles similares: mismo tipo de oferta + mismo tipo de inmueble (antes
  // faltaba este filtro, por lo que se llegó a sugerir una oficina para un
  // apartamento) + misma ciudad + precio dentro de un ±20% (ver
  // TOLERANCIA_PRECIO), todavía disponibles de verdad. Entre los que cumplen
  // eso, se prefieren los geográficamente más cercanos (ver ordenarPorCercania)
  // en vez de solo "misma ciudad", que en Bogotá puede significar zonas muy
  // distintas entre sí.
  let similares: Array<Record<string, unknown>> = [];
  const valorReferencia = inmueble.tipo_oferta === 'Arriendo' ? inmueble.valor_canon : inmueble.valor_venta;
  if (valorReferencia) {
    const campoValor = inmueble.tipo_oferta === 'Arriendo' ? 'valor_canon' : 'valor_venta';
    const min = Number(valorReferencia) * (1 - TOLERANCIA_PRECIO);
    const max = Number(valorReferencia) * (1 + TOLERANCIA_PRECIO);
    const { data: candidatos } = await admin
      .from('agenda_inmuebles')
      .select('numero_inmueble, direccion, ciudad, barrio, tipo_oferta, tipo_inmueble, valor_canon, valor_venta, habitaciones, latitud, longitud')
      .eq('empresa_id', inmueble.empresa_id)
      .eq('tipo_oferta', inmueble.tipo_oferta)
      .eq('tipo_inmueble', inmueble.tipo_inmueble)
      .eq('ciudad', inmueble.ciudad)
      .eq('disponible', true)
      .eq('no_disponible_manual', false)
      .neq('id', inmuebleId)
      .gte(campoValor, min)
      .lte(campoValor, max)
      .order(campoValor)
      .limit(MAX_SIMILARES * 5);
    similares = ordenarPorCercania(candidatos || [], inmueble).slice(0, MAX_SIMILARES);
  }

  function linkPublico(numeroInmueble: number): string {
    const plantilla = config?.plantilla_enlace_inmueble;
    if (plantilla && plantilla.includes('{numero}')) {
      return plantilla.replace(/\{numero\}/g, String(numeroInmueble));
    }
    const dominio = config?.dominio_publico || 'citas.patrimonios.co';
    return `https://${dominio}/inmuebles/${numeroInmueble}`;
  }

  function filaSimilar(inm: Record<string, unknown>): string {
    const direccionLimpia = limpiarDireccion(inm.direccion as string);
    const precio =
      inm.tipo_oferta === 'Arriendo'
        ? inm.valor_canon
          ? money.format(Number(inm.valor_canon)) + ' / mes'
          : ''
        : inm.valor_venta
          ? money.format(Number(inm.valor_venta))
          : '';
    return `
      <tr><td style="padding:10px 0;border-top:1px solid #e6eaee">
        <div style="font-size:11.5px;color:#8492a6;text-transform:uppercase;letter-spacing:.04em">#${inm.numero_inmueble} · ${escaparHtml(inm.ciudad as string)}${inm.barrio ? ' · ' + escaparHtml(inm.barrio as string) : ''}</div>
        <div style="font-size:15px;color:#1A2C45;font-weight:700;margin:2px 0">${escaparHtml(direccionLimpia)}</div>
        <div style="font-size:14px;color:#00A9A5;font-weight:700;margin-bottom:6px">${escaparHtml(precio)}</div>
        <a href="${linkPublico(inm.numero_inmueble as number)}" target="_blank" style="font-size:13px;color:#1A2C45;font-weight:600;text-decoration:underline">Ver este inmueble →</a>
      </td></tr>`;
  }

  let password: string | null = null;
  if (puedeEnviar) {
    try {
      const { data: pw, error: errorPw } = await admin.rpc('agenda_obtener_password_correo', {
        p_empresa_id: inmueble.empresa_id,
      });
      if (errorPw) throw errorPw;
      password = pw as string;
    } catch {
      password = null;
    }
  }

  let transporte: ReturnType<typeof nodemailer.createTransport> | null = null;
  if (password && config) {
    transporte = nodemailer.createTransport({
      host: config.correo_smtp_host!,
      port: config.correo_smtp_puerto || 587,
      secure: config.correo_smtp_seguridad === 'ssl',
      auth: {
        user: config.correo_smtp_usuario || config.correo_remitente_email!,
        pass: password,
      },
    });
  }

  const nombreRemitente = config?.correo_remitente_nombre || 'Patrimonios Inmobiliarios';
  const direccionInmueble = limpiarDireccion(inmueble.direccion);
  const ciudadTexto = [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const etiquetaMotivo = ETIQUETAS_MOTIVO[motivo] || ETIQUETAS_MOTIVO.otro;

  let correosEnviados = 0;

  for (const fila of citasCanceladas as Array<{ cita_id: string; cliente_nombre: string | null; cliente_email: string | null }>) {
    const citaId = fila.cita_id;
    const clienteEmail = fila.cliente_email;
    if (!clienteEmail) {
      await registrarLog(admin, {
        empresa_id: inmueble.empresa_id,
        cita_id: citaId,
        destinatario_tipo: 'cliente',
        destinatario_email: null,
        asunto: null,
        estado: 'omitido',
        detalle_error: 'La cita cancelada no tenía correo de cliente guardado.',
        modo_pruebas: modoPruebas,
      });
      continue;
    }

    // Se necesita fecha/hora original de la cita para reconstruir el mismo
    // DTSTART/DTEND que llevaba la invitación original y así poder cancelarla.
    const { data: citaOriginal } = await admin
      .from('agenda_citas')
      .select('fecha, hora_inicio, hora_fin')
      .eq('id', citaId)
      .maybeSingle();

    const destinatarioReal = clienteEmail;
    const destinatarioEnvio = modoPruebas ? config?.correo_pruebas_destino || destinatarioReal : destinatarioReal;
    const asunto = `Lamentamos informarte: el inmueble Nº ${inmueble.numero_inmueble} ya no está disponible`;

    const bannerPruebas = modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">
          🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinatarioReal)}
        </div>`
      : '';

    const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${bannerPruebas}
  <div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
    <div style="padding:28px 26px 8px">
      <h1 style="color:#1A2C45;font-size:20px;margin:0 0 4px">Tu visita fue cancelada</h1>
      <p style="color:#526575;font-size:14px;margin:0 0 14px">Hola ${escaparHtml(fila.cliente_nombre) || ''}, te escribimos porque el inmueble que ibas a visitar${citaOriginal ? ` el ${escaparHtml(formatearFecha(citaOriginal.fecha))} a las ${escaparHtml(formatearHora(citaOriginal.hora_inicio.slice(0, 5)))}` : ''} (Nº ${inmueble.numero_inmueble}, ${escaparHtml(direccionInmueble)}${ciudadTexto ? ', ' + escaparHtml(ciudadTexto) : ''}) ${escaparHtml(etiquetaMotivo)}, así que ya no está disponible para visitas.</p>
      <p style="color:#526575;font-size:14px;margin:0 0 18px">Lamentamos mucho el inconveniente y las molestias que esto te pueda ocasionar. Tu cita quedó cancelada automáticamente y también se eliminó del calendario de tu teléfono.${detalle ? ' ' + escaparHtml(detalle) : ''}</p>
      ${
        similares.length
          ? `<div style="font-size:13px;color:#1A2C45;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px">Estos inmuebles pueden interesarte</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">${similares.map(filaSimilar).join('')}</table>`
          : ''
      }
    </div>
    <div style="background:#f4f6f8;padding:16px 26px;border-top:1px solid #e6eaee">
      <p style="color:#8492a6;font-size:12px;margin:0">Si tienes dudas o quieres agendar una visita a alguno de estos inmuebles, comunícate con tu asesor.</p>
    </div>
  </div>
  <p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${escaparHtml(nombreRemitente)}</p>
</div>
</body>
</html>`;

    if (!transporte || !config) {
      await registrarLog(admin, {
        empresa_id: inmueble.empresa_id,
        cita_id: citaId,
        destinatario_tipo: 'cliente',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'omitido',
        detalle_error: 'Correo no configurado todavía (host/contraseña SMTP faltante).',
        modo_pruebas: modoPruebas,
      });
      continue;
    }

    try {
      const icsCancelacion = citaOriginal
        ? construirICS({
            metodo: 'CANCEL',
            uid: uidCalendarioCita(citaId),
            secuencia: 1,
            dtStart: aFechaICSUTC(citaOriginal.fecha, citaOriginal.hora_inicio),
            dtEnd: aFechaICSUTC(citaOriginal.fecha, citaOriginal.hora_fin || citaOriginal.hora_inicio),
            resumen: `Visita inmueble Nº ${inmueble.numero_inmueble} — CANCELADA`,
            descripcion: 'Esta visita fue cancelada porque el inmueble ya no está disponible.',
            organizadorNombre: nombreRemitente,
            organizadorEmail: config.correo_remitente_email!,
            asistenteNombre: fila.cliente_nombre || destinatarioEnvio!,
            asistenteEmail: destinatarioEnvio!,
            conAlarmas: false,
          })
        : null;

      await transporte.sendMail({
        from: `${nombreRemitente} <${config.correo_remitente_email}>`,
        to: destinatarioEnvio!,
        subject: asunto,
        html,
        ...(icsCancelacion
          ? { icalEvent: { method: 'CANCEL', filename: 'cancelacion.ics', content: icsCancelacion } }
          : {}),
      });

      await registrarLog(admin, {
        empresa_id: inmueble.empresa_id,
        cita_id: citaId,
        destinatario_tipo: 'cliente',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'enviado',
        modo_pruebas: modoPruebas,
      });
      correosEnviados++;
    } catch (e) {
      await registrarLog(admin, {
        empresa_id: inmueble.empresa_id,
        cita_id: citaId,
        destinatario_tipo: 'cliente',
        destinatario_email: destinatarioEnvio,
        asunto,
        estado: 'fallido',
        detalle_error: e instanceof Error ? e.message : String(e),
        modo_pruebas: modoPruebas,
      });
    }
  }

  return json({ ok: true, marcado: true, citas_canceladas: idsCitas.length, correos_enviados: correosEnviados });
});
