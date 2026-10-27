// Edge Function: avisar-arrendatario
// Botón "Informar al arrendatario" de una cita de visita sobre un inmueble con estado CRM
// "Rentando" (arrendatario viviendo adentro). Envía al arrendatario un correo con la fecha,
// la hora y el asesor a cargo. No revela nombre ni datos del cliente que visita.
// Requiere sesión: el llamador debe ser un miembro activo de la empresa de la cita. El
// destinatario sale siempre de agenda_arrendatarios (nunca del cuerpo de la solicitud).
// También la llama enviar-correo-cita al agendar una visita en un inmueble Rentando (llamada interna con la
// service role: el aviso al arrendatario sale solo, sin que el asesor tenga que acordarse del botón).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, enlaceInmueble, marcaCorreo, pieContacto } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';
import { OPCIONES_ARRENDATARIO } from '../_shared/reubicacion.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';

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

// Cómo llamar al inmueble según su tipo: una oficina o un local no son una "vivienda".
function sustantivo(tipo: string | null | undefined): { n: string; el: string } {
  switch (String(tipo || '').trim().toUpperCase()) {
    case 'APARTAMENTO':
    case 'CASA':
    case 'APARTAESTUDIO':
      return { n: 'vivienda', el: 'la vivienda' };
    case 'OFICINA':
      return { n: 'oficina', el: 'la oficina' };
    case 'LOCAL':
      return { n: 'local', el: 'el local' };
    case 'CONSULTORIO':
      return { n: 'consultorio', el: 'el consultorio' };
    case 'BODEGA':
      return { n: 'bodega', el: 'la bodega' };
    case 'LOTE':
      return { n: 'lote', el: 'el lote' };
    default:
      return { n: 'inmueble', el: 'el inmueble' };
  }
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
  return d.replace(REGEX_UNIDAD_INTERNA, ' ').replace(/[,-]{2,}/g, ',').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
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
  const interno = jwt.length > 20 && jwt === SERVICE_ROLE_KEY;
  const { data: usuarioData } = interno ? { data: null } : await admin.auth.getUser(jwt);
  const usuario = usuarioData?.user ?? null;
  if (!interno && !usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, tipo_cita, estado, token_arrendatario, arrendatario_avisado_en')
    .eq('id', citaId)
    .maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);

  if (!interno && usuario) {
    const { data: miembro } = await admin
      .from('agenda_miembros')
      .select('usuario_id')
      .eq('empresa_id', cita.empresa_id)
      .eq('usuario_id', usuario.id)
      .eq('activo', true)
      .maybeSingle();
    if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  }

  if (interno && cita.arrendatario_avisado_en && Date.now() - new Date(cita.arrendatario_avisado_en).getTime() < 120000) {
    return json({ ok: true, enviado: false, motivo: 'El arrendatario ya recibió este aviso hace instantes.' });
  }

  if (cita.estado === 'cancelada' || cita.tipo_cita !== 'visita_cliente' || !cita.inmueble_id) {
    return json({ ok: true, enviado: false, motivo: 'Solo se informa de visitas de clientes activas sobre un inmueble.' });
  }

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('numero_inmueble, direccion, barrio, ciudad, estado_crm, tipo_inmueble, token_arrendatario, sin_aviso_arrendatario')
    .eq('id', cita.inmueble_id)
    .maybeSingle();
  if (inmueble?.sin_aviso_arrendatario === true) {
    return json({ ok: true, enviado: false, motivo: 'Este inmueble está marcado para no avisar al arrendatario.' });
  }
  if (!inmueble || String(inmueble.estado_crm || '').trim().toLowerCase() !== 'rentando') {
    return json({ ok: true, enviado: false, motivo: 'Este inmueble no está rentando; no se informa al arrendatario.' });
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, plantilla_enlace_inmueble, dominio_publico, contacto_empresa, correo_contacto, telefono, nombre_comercial, empresa:agenda_empresas(slug)',
    )
    .eq('empresa_id', cita.empresa_id)
    .maybeSingle();
  const marca = marcaCorreo(config);
  const modoPruebas = config?.correo_modo_pruebas !== false;

  const { data: arrendatario } = await admin
    .from('agenda_arrendatarios')
    .select('nombre, email')
    .eq('empresa_id', cita.empresa_id)
    .eq('numero_inmueble', inmueble.numero_inmueble)
    .maybeSingle();
  let correos = String(arrendatario?.email || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
  // En modo de pruebas, aunque el inmueble no tenga correo de arrendatario se manda igual al correo de
  // pruebas, para poder ver cómo le llegaría.
  if (!correos.length && modoPruebas && config?.correo_pruebas_destino) correos = ['(este inmueble no tiene correo de arrendatario registrado)'];
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
  const sust = sustantivo(inmueble.tipo_inmueble);
  const ciudad = [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const fechaTexto = formatearFecha(cita.fecha);
  const horaTexto = formatearHora(cita.hora_inicio.slice(0, 5));
  // Un solo enlace por inmueble y el mismo asunto en todos los avisos (el correo los agrupa en una conversación):
  // cada aviso lista TODAS las visitas próximas, para no obligar al arrendatario a negociar una por una.
  const hoyBogota = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 10);
  const { data: proximasRaw } = await admin
    .from('agenda_citas')
    .select('id, fecha, hora_inicio, token_arrendatario')
    .eq('inmueble_id', cita.inmueble_id)
    .eq('tipo_cita', 'visita_cliente')
    .neq('estado', 'cancelada')
    .gte('fecha', hoyBogota)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });
  const proximas = (proximasRaw || []).slice(0, 12);
  if (!proximas.some((c) => c.id === cita.id)) proximas.push({ id: cita.id, fecha: cita.fecha, hora_inicio: cita.hora_inicio, token_arrendatario: cita.token_arrendatario });
  const varias = proximas.length > 1;
  const asunto = `Visitas programadas en tu ${sust.n} · Inmueble ${inmueble.numero_inmueble}`;
  const nombre = escaparHtml(arrendatario?.nombre || '');
  const enlacePortal = `${SITIO_URL}/arrendatario/${inmueble.token_arrendatario || cita.token_arrendatario}`;
  const enlaceSitio = enlaceInmueble(config, inmueble.numero_inmueble);
  const lugarTexto = [direccion, ciudad].filter(Boolean).join(', ').replace(/\.+$/, '');
  const remitenteNombre = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';

  const html = (destinatarioReal: string) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${
    modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(destinatarioReal)}</div>`
      : ''
  }
  <div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
    ${encabezadoImagen(marca, `Visita programada`, 'hogar')}
    <div style="padding:28px 26px 20px">
      <h1 style="color:${marca.principal};font-size:26px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-.01em;margin:0 0 6px">${varias ? `Tienes ${proximas.length} visitas programadas en tu ${sust.n}` : `Visita programada en tu ${sust.n}`} 🏠</h1>
      <p style="color:#4d4d4d;text-align:justify;font-size:15px;line-height:1.65;margin:0 0 18px">Hola${nombre ? ' ' + nombre : ''}, una persona interesada quiere conocer ${sust.el} que ocupas${lugarTexto ? ` en ${escaparHtml(lugarTexto)}` : ''}. Queremos respetar tu tiempo.</p>
      <table style="width:100%;border-collapse:collapse">
        ${proximas
          .map(
            (c) =>
              `<tr><td style="padding:8px 0;color:#4d4d4d;font-size:13px">📅 ${c.id === cita.id && varias ? 'Nueva' : 'Visita'}</td><td style="padding:8px 0;color:${marca.principal};font-size:15px;font-weight:600">${escaparHtml(formatearFecha(c.fecha))} · ${escaparHtml(formatearHora(c.hora_inicio.slice(0, 5)))}<br><a href="${SITIO_URL}/arrendatario/${c.token_arrendatario}?accion=otra_hora" style="font-size:12.5px;font-weight:600;color:${marca.principal}">No puedo a esta hora</a></td></tr>`,
          )
          .join('')}
        ${asesorNombre ? `<tr><td style="padding:8px 0;color:#4d4d4d;font-size:13px">👤 Asesor a cargo</td><td style="padding:8px 0;color:${marca.principal};font-size:15px;font-weight:600">${escaparHtml(asesorNombre)}${asesorCelular ? ' · ' + escaparHtml(asesorCelular) : ''}</td></tr>` : ''}
      </table>
      <p style="color:#4d4d4d;text-align:justify;font-size:15px;line-height:1.65;margin:18px 0 10px">${OPCIONES_ARRENDATARIO.intro}</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0"><a href="${SITIO_URL}/arrendatario/${cita.token_arrendatario}?accion=otra_hora" style="color:${marca.principal};font-weight:700;font-size:15px;text-decoration:none">① ${OPCIONES_ARRENDATARIO.otraHora.titulo}</a><br><span style="color:#6b6b6b;font-size:13px">${OPCIONES_ARRENDATARIO.otraHora.detalle}</span></td></tr>
        <tr><td style="padding:8px 0"><a href="${enlacePortal}?accion=dia" style="color:${marca.principal};font-weight:700;font-size:15px;text-decoration:none">② ${OPCIONES_ARRENDATARIO.diaNoPuedo.titulo}</a><br><span style="color:#6b6b6b;font-size:13px">${OPCIONES_ARRENDATARIO.diaNoPuedo.detalle}</span></td></tr>
        <tr><td style="padding:8px 0"><a href="${enlacePortal}?accion=pausa" style="color:${marca.principal};font-weight:700;font-size:15px;text-decoration:none">③ ${OPCIONES_ARRENDATARIO.pausa.titulo}</a><br><span style="color:#6b6b6b;font-size:13px">${OPCIONES_ARRENDATARIO.pausa.detalle}</span></td></tr>
      </table>
      <p style="color:#4d4d4d;text-align:justify;font-size:14px;line-height:1.6;margin:10px 0 0">${OPCIONES_ARRENDATARIO.consecuencia} Gracias por tu colaboración.</p>
      <p style="margin:18px 0 6px;text-align:center"><a href="${enlacePortal}" style="display:inline-block;background:${marca.principal};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 26px;border-radius:999px">👀 Ver mis visitas y mis horarios</a></p>
      <p style="margin:10px 0 6px;text-align:center"><a href="${enlaceSitio}" target="_blank" style="display:inline-block;color:${marca.principal};text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:999px;border:2px solid ${marca.principal}">🏠 Ver el inmueble en nuestro sitio</a></p>
      <p style="color:#6b6b6b;font-size:12px;margin:10px 0 0">Este enlace es solo para ti, no lo compartas. ¿Prefieres hablar? Llama o escríbele a tu asesor.</p>
    </div>
  </div>
  <p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${escaparHtml(remitenteNombre)}</p>
  ${pieContacto(marca)}
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
    .update({ arrendatario_avisado_en: new Date().toISOString(), arrendatario_avisado_por: usuario?.id ?? null })
    .eq('id', cita.id);
  return json({ ok: true, enviado: true, enviados });
});
