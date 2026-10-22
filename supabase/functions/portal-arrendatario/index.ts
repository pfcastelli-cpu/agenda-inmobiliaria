// Edge Function: portal-arrendatario
// Portal público del arrendatario de un inmueble "Rentando". El enlace sale del correo
// "Visita programada en tu vivienda" (/arrendatario/<token>). verify_jwt = false: el token
// secreto de la cita (agenda_citas.token_arrendatario) es la credencial, igual que en
// calendario-ics. Nunca devuelve nombre ni datos del cliente que visita.
// Acciones (POST JSON { token, accion, ... }):
//   obtener          → cita, inmueble, asesor y horario permitido actual
//   horarios         → { fecha } horas libres reales (mismo motor que la reserva pública)
//   mover            → { fecha, hora } mueve ESTA visita a otro horario válido
//   cancelar         → { motivo? } cancela la visita
//   guardar_horario  → { dias:[1..7], desde, hasta } días/horas en que se muestra la vivienda
// Cada cambio avisa por correo al asesor y, si cambia o se cancela la visita, al cliente.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';
const MAX_MOVIDAS = 3;

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
function falla(error: string, status = 400) {
  return json({ ok: false, error }, status);
}

function esc(valor: string | null | undefined): string {
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
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Mismo recorte de dirección que los demás correos: sin torre/apto/oficina.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INT|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;
function limpiarDireccion(d: string | null | undefined): string {
  if (!d) return '';
  return d.replace(REGEX_UNIDAD_INTERNA, ' ').replace(/[,-]{2,}/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}

// Fecha y hora actuales en Bogotá (la base guarda fecha y hora locales sin zona).
function ahoraBogota() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }); // 2026-10-22 14:05:09
  return { fecha: s.slice(0, 10), hora: s.slice(11, 16) };
}
function sumarDias(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

type Admin = ReturnType<typeof createClient>;

async function cargarContexto(admin: Admin, token: string) {
  const { data: cita } = await admin
    .from('agenda_citas')
    .select(
      'id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, estado, tipo_cita, cliente_nombre, cliente_email, token_arrendatario',
    )
    .eq('token_arrendatario', token)
    .maybeSingle();
  if (!cita || !cita.inmueble_id || cita.tipo_cita !== 'visita_cliente') return null;
  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('id, numero_inmueble, direccion, barrio, ciudad, estado_crm, dias_visita_permitidos, hora_visita_desde, hora_visita_hasta, duracion_visita_minutos')
    .eq('id', cita.inmueble_id)
    .maybeSingle();
  if (!inmueble) return null;
  let asesor: { id: string; nombre: string; celular: string; correo: string; correos_adicionales: string } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin
      .from('agenda_asesores')
      .select('id, nombre, celular, correo, correos_adicionales')
      .eq('id', cita.asesor_id)
      .maybeSingle();
    asesor = data;
  }
  return { cita, inmueble, asesor };
}

function correosDe(texto: string | null | undefined): string[] {
  return String(texto || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
}

// ---- Correo ----------------------------------------------------------------------------
async function configCorreo(admin: Admin, empresaId: string) {
  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return null;
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
  if (!password) return null;
  return { config, password: password as string, modoPruebas: config.correo_modo_pruebas !== false };
}

function plantillaCorreo(opts: {
  titulo: string;
  cuerpo: string; // HTML ya escapado
  boton?: { texto: string; url: string };
  modoPruebas: boolean;
  destinatarioReal: string;
  remitente: string;
}) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.destinatarioReal)}</div>` : ''}
<div style="background:#ffffff;border-radius:18px;padding:28px 26px;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
<h1 style="color:#1A2C45;font-size:20px;margin:0 0 12px">${esc(opts.titulo)}</h1>
<div style="color:#526575;font-size:14px;line-height:1.55">${opts.cuerpo}</div>
${opts.boton ? `<p style="margin:22px 0 0"><a href="${esc(opts.boton.url)}" style="display:inline-block;background:#1A2C45;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">${esc(opts.boton.texto)}</a></p>` : ''}
</div>
<p style="text-align:center;color:#9aa7b0;font-size:11.5px;margin-top:18px">${esc(opts.remitente)}</p>
</div></body></html>`;
}

async function enviarCorreos(
  admin: Admin,
  empresaId: string,
  citaId: string,
  tipo: 'arrendatario' | 'asesor' | 'cliente',
  destinatarios: string[],
  asunto: string,
  armar: (destinatarioReal: string, modoPruebas: boolean, remitente: string) => string,
) {
  if (!destinatarios.length) return;
  const cfg = await configCorreo(admin, empresaId);
  if (!cfg) return;
  const { config, password, modoPruebas } = cfg;
  const remitente = config.correo_remitente_nombre || 'Patrimonios Inmobiliarios';
  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password },
  });
  for (const correo of destinatarios) {
    const destino = modoPruebas ? config.correo_pruebas_destino || correo : correo;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({
        from: `${remitente} <${config.correo_remitente_email}>`,
        to: destino,
        subject: asunto,
        html: armar(correo, modoPruebas, remitente),
      });
    } catch (e) {
      estado = 'fallido';
      detalle = e instanceof Error ? e.message : String(e);
    }
    try {
      await admin.from('agenda_correos_log').insert({
        empresa_id: empresaId,
        cita_id: citaId,
        destinatario_tipo: tipo,
        destinatario_email: destino,
        asunto,
        estado,
        detalle_error: detalle,
        modo_pruebas: modoPruebas,
      });
    } catch {
      // Sin registro no hay nada más que hacer.
    }
  }
}

async function registrarAccion(
  admin: Admin,
  c: { cita: { id: string; empresa_id: string }; inmueble: { id: string } },
  accion: 'horario_actualizado' | 'cita_movida' | 'cita_cancelada',
  detalle: Record<string, unknown>,
) {
  try {
    await admin.from('agenda_arrendatario_acciones').insert({
      empresa_id: c.cita.empresa_id,
      inmueble_id: c.inmueble.id,
      cita_id: c.cita.id,
      accion,
      detalle,
    });
  } catch {
    // La auditoría no debe tumbar la acción del arrendatario.
  }
}

function resumenHorario(i: { dias_visita_permitidos: number[] | null; hora_visita_desde: string | null; hora_visita_hasta: string | null }) {
  const dias = (i.dias_visita_permitidos || []).map((d) => DIAS[d]).filter(Boolean).join(', ');
  const horas =
    i.hora_visita_desde && i.hora_visita_hasta
      ? `de ${formatearHora(i.hora_visita_desde.slice(0, 5))} a ${formatearHora(i.hora_visita_hasta.slice(0, 5))}`
      : '';
  return [dias, horas].filter(Boolean).join(' · ');
}

// ---- Horarios --------------------------------------------------------------------------
async function slotsDelDia(admin: Admin, cita: { empresa_id: string; inmueble_id: string }, fecha: string) {
  const { data, error } = await admin.rpc('agenda_sugerir_horarios', {
    p_empresa_id: cita.empresa_id,
    p_inmueble_id: cita.inmueble_id,
    p_fecha: fecha,
    p_intervalo_minutos: 30,
  });
  if (error) throw new Error(error.message);
  // Mismo criterio que la reserva pública: una fila por hora, la del asesor más prioritario.
  const filas = (data || []) as Array<{ asesor_id: string; asesor_nombre: string; prioridad: number; hora_inicio: string; hora_fin: string }>;
  filas.sort((a, b) => (a.hora_inicio < b.hora_inicio ? -1 : a.hora_inicio > b.hora_inicio ? 1 : a.prioridad - b.prioridad));
  const vistas = new Set<string>();
  return filas.filter((f) => {
    if (vistas.has(f.hora_inicio)) return false;
    vistas.add(f.hora_inicio);
    return true;
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return falla('Método no permitido.', 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return falla('Cuerpo de la solicitud inválido.');
  }
  const token = String(body.token || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return falla('Este enlace no es válido.', 404);
  }
  const accion = String(body.accion || '');

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ctx = await cargarContexto(admin, token);
  if (!ctx) return falla('Este enlace no es válido o ya no está activo.', 404);
  const { cita, inmueble, asesor } = ctx;
  if (String(inmueble.estado_crm || '').trim().toLowerCase() !== 'rentando') {
    return falla('Este inmueble ya no figura como rentando. Comunícate con tu asesor.', 409);
  }

  const ahora = ahoraBogota();
  const horaCita = cita.hora_inicio.slice(0, 5);
  const citaVigente = cita.estado !== 'cancelada' && (cita.fecha > ahora.fecha || (cita.fecha === ahora.fecha && horaCita > ahora.hora));
  const direccion = limpiarDireccion(inmueble.direccion);
  const correosAsesor = asesor ? [...correosDe(asesor.correo), ...correosDe(asesor.correos_adicionales)] : [];

  try {
    // ---------------------------------------------------------------- obtener
    if (accion === 'obtener') {
      return json({
        ok: true,
        hoy: ahora.fecha,
        cita: {
          fecha: cita.fecha,
          hora_inicio: horaCita,
          hora_fin: cita.hora_fin.slice(0, 5),
          estado: cita.estado,
          vigente: citaVigente,
        },
        inmueble: {
          numero: inmueble.numero_inmueble,
          direccion,
          zona: [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', '),
          dias_permitidos: inmueble.dias_visita_permitidos || [],
          desde: inmueble.hora_visita_desde ? inmueble.hora_visita_desde.slice(0, 5) : null,
          hasta: inmueble.hora_visita_hasta ? inmueble.hora_visita_hasta.slice(0, 5) : null,
        },
        asesor: asesor ? { nombre: asesor.nombre, celular: asesor.celular } : null,
      });
    }

    // --------------------------------------------------------------- horarios
    if (accion === 'horarios') {
      const fecha = String(body.fecha || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return falla('Fecha inválida.');
      if (fecha < ahora.fecha || fecha > sumarDias(ahora.fecha, 60)) return json({ ok: true, horas: [] });
      const slots = await slotsDelDia(admin, cita, fecha);
      return json({ ok: true, horas: slots.map((s) => ({ hora_inicio: s.hora_inicio.slice(0, 5), hora_fin: s.hora_fin.slice(0, 5) })) });
    }

    // ------------------------------------------------------------------ mover
    if (accion === 'mover') {
      if (!citaVigente) return falla('Esta visita ya no se puede cambiar (ya pasó o fue cancelada).', 409);
      const fecha = String(body.fecha || '');
      const hora = String(body.hora || '').slice(0, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return falla('Fecha u hora inválida.');
      if (fecha < ahora.fecha || fecha > sumarDias(ahora.fecha, 60)) return falla('Elige una fecha dentro de los próximos 60 días.');
      if (fecha === cita.fecha && hora === horaCita) return falla('Esa ya es la hora de la visita.');

      const { count: yaMovidas } = await admin
        .from('agenda_arrendatario_acciones')
        .select('id', { count: 'exact', head: true })
        .eq('cita_id', cita.id)
        .eq('accion', 'cita_movida');
      if ((yaMovidas || 0) >= MAX_MOVIDAS) {
        return falla(`Ya cambiaste esta visita ${MAX_MOVIDAS} veces. Comunícate directamente con el asesor.`, 429);
      }

      const slots = await slotsDelDia(admin, cita, fecha);
      const elegido = slots.find((s) => s.hora_inicio.slice(0, 5) === hora);
      if (!elegido) return falla('Ese horario ya no está disponible. Elige otro.', 409);
      const { data: libre } = await admin.rpc('agenda_slot_disponible', {
        p_empresa_id: cita.empresa_id,
        p_asesor_id: elegido.asesor_id,
        p_inmueble_id: cita.inmueble_id,
        p_fecha: fecha,
        p_hora_inicio: elegido.hora_inicio,
        p_hora_fin: elegido.hora_fin,
        p_ignorar_cita_id: cita.id,
      });
      if (!libre) return falla('Ese horario ya no está disponible. Elige otro.', 409);

      // Condición en el UPDATE: si alguien más cambió/canceló la cita entre tanto, no se pisa.
      const { data: movida, error: errMover } = await admin
        .from('agenda_citas')
        .update({
          fecha,
          hora_inicio: elegido.hora_inicio,
          hora_fin: elegido.hora_fin,
          asesor_id: elegido.asesor_id,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .eq('fecha', cita.fecha)
        .eq('hora_inicio', cita.hora_inicio)
        .select('id')
        .maybeSingle();
      if (errMover || !movida) return falla('No se pudo cambiar la visita. Actualiza la página e inténtalo de nuevo.', 409);

      await registrarAccion(admin, ctx, 'cita_movida', {
        de: { fecha: cita.fecha, hora: horaCita },
        a: { fecha, hora },
        asesor_nuevo: elegido.asesor_id,
      });

      // Avisos: cliente (confirmación con la nueva hora), propietario, asesor y arrendatario.
      const cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY };
      for (const f of ['enviar-correo-cita', 'enviar-correo-propietario']) {
        fetch(`${SUPABASE_URL}/functions/v1/${f}`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ cita_id: cita.id }) }).catch(() => {});
      }
      const nuevaFechaTxt = formatearFecha(fecha);
      const nuevaHoraTxt = formatearHora(hora);
      const { data: asesorNuevo } = await admin.from('agenda_asesores').select('nombre, celular, correo, correos_adicionales').eq('id', elegido.asesor_id).maybeSingle();
      const avisoAsesores = new Set<string>([...correosAsesor, ...correosDe(asesorNuevo?.correo), ...correosDe(asesorNuevo?.correos_adicionales)]);
      await enviarCorreos(admin, cita.empresa_id, cita.id, 'asesor', [...avisoAsesores], `El arrendatario cambió la visita · Inmueble ${inmueble.numero_inmueble}`, (real, mp, rem) =>
        plantillaCorreo({
          titulo: 'El arrendatario cambió una visita',
          cuerpo: `<p style="margin:0 0 10px">El arrendatario del inmueble Nº ${esc(String(inmueble.numero_inmueble))}${direccion ? ` (${esc(direccion)})` : ''} movió la visita desde el portal.</p>
<p style="margin:0">Antes: <b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b><br>Ahora: <b>${esc(nuevaFechaTxt)}, ${esc(nuevaHoraTxt)}</b>${asesorNuevo?.nombre ? `<br>Asesor a cargo: <b>${esc(asesorNuevo.nombre)}</b>` : ''}</p>
<p style="margin:10px 0 0">El nuevo horario ya cumple tu jornada y los traslados; al cliente se le envió la confirmación actualizada.</p>`,
          modoPruebas: mp, destinatarioReal: real, remitente: rem,
        }),
      );
      return json({
        ok: true,
        cita: { fecha, hora_inicio: hora, hora_fin: elegido.hora_fin.slice(0, 5), estado: 'confirmada', vigente: true },
        asesor: asesorNuevo ? { nombre: asesorNuevo.nombre, celular: asesorNuevo.celular } : null,
      });
    }

    // --------------------------------------------------------------- cancelar
    if (accion === 'cancelar') {
      if (!citaVigente) return falla('Esta visita ya no se puede cancelar (ya pasó o ya estaba cancelada).', 409);
      const motivo = String(body.motivo || '').trim().slice(0, 300);
      const { data: cancelada, error: errCancelar } = await admin
        .from('agenda_citas')
        .update({
          estado: 'cancelada',
          motivo_cancelacion: `Cancelada por el arrendatario${motivo ? ': ' + motivo : ''}`,
          cancelado_por: null,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .select('id')
        .maybeSingle();
      if (errCancelar || !cancelada) return falla('No se pudo cancelar la visita. Actualiza la página e inténtalo de nuevo.', 409);
      await registrarAccion(admin, ctx, 'cita_cancelada', { fecha: cita.fecha, hora: horaCita, motivo });

      await enviarCorreos(admin, cita.empresa_id, cita.id, 'asesor', [...new Set(correosAsesor)], `El arrendatario canceló la visita · Inmueble ${inmueble.numero_inmueble}`, (real, mp, rem) =>
        plantillaCorreo({
          titulo: 'El arrendatario canceló una visita',
          cuerpo: `<p style="margin:0 0 10px">El arrendatario del inmueble Nº ${esc(String(inmueble.numero_inmueble))}${direccion ? ` (${esc(direccion)})` : ''} canceló desde el portal la visita del <b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b>.</p>
${motivo ? `<p style="margin:0 0 10px">Motivo: ${esc(motivo)}</p>` : ''}<p style="margin:0">Comunícate con el cliente para ofrecerle otro horario.</p>`,
          modoPruebas: mp, destinatarioReal: real, remitente: rem,
        }),
      );
      const correoCliente = correosDe(cita.cliente_email)[0];
      if (correoCliente) {
        await enviarCorreos(admin, cita.empresa_id, cita.id, 'cliente', [correoCliente], `Tu visita del ${formatearFecha(cita.fecha)} fue cancelada`, (real, mp, rem) =>
          plantillaCorreo({
            titulo: 'Tu visita fue cancelada',
            cuerpo: `<p style="margin:0 0 10px">Hola ${esc(cita.cliente_nombre)}, lamentamos informarte que la visita del <b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b>${direccion ? ` al inmueble en ${esc(direccion)}` : ''} no se podrá realizar en ese horario por disponibilidad del inmueble.</p>
<p style="margin:0">Puedes elegir otro horario cuando quieras${asesor?.nombre ? ` o escribirle a tu asesor, ${esc(asesor.nombre)}` : ''}.</p>`,
            boton: { texto: 'Agendar otro horario', url: `${SITIO_URL}/inmuebles/${inmueble.numero_inmueble}` },
            modoPruebas: mp, destinatarioReal: real, remitente: rem,
          }),
        );
      }
      return json({ ok: true, cita: { fecha: cita.fecha, hora_inicio: horaCita, hora_fin: cita.hora_fin.slice(0, 5), estado: 'cancelada', vigente: false } });
    }

    // -------------------------------------------------------- guardar_horario
    if (accion === 'guardar_horario') {
      const dias = Array.isArray(body.dias) ? [...new Set((body.dias as unknown[]).map(Number))] : [];
      if (!dias.length || dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return falla('Elige al menos un día de la semana.');
      dias.sort((a, b) => a - b);
      const desde = String(body.desde || '').slice(0, 5);
      const hasta = String(body.hasta || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(desde) || !/^\d{2}:\d{2}$/.test(hasta)) return falla('Escribe la hora desde y hasta.');
      if (desde < '06:00' || hasta > '21:00') return falla('El horario debe estar entre las 6:00 a. m. y las 9:00 p. m.');
      const { data: cfgDur } = await admin.from('agenda_configuracion').select('duracion_visita_minutos').eq('empresa_id', cita.empresa_id).maybeSingle();
      const duracion = inmueble.duracion_visita_minutos || cfgDur?.duracion_visita_minutos || 30;
      const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      if (minutos(hasta) - minutos(desde) < duracion) {
        return falla(`El horario debe permitir al menos una visita completa (${duracion} minutos).`);
      }
      const anterior = resumenHorario(inmueble);
      const { error: errHorario } = await admin
        .from('agenda_inmuebles')
        .update({ dias_visita_permitidos: dias, hora_visita_desde: desde, hora_visita_hasta: hasta })
        .eq('id', inmueble.id);
      if (errHorario) return falla('No se pudo guardar el horario. Inténtalo de nuevo.', 500);
      const nuevo = { dias_visita_permitidos: dias, hora_visita_desde: desde, hora_visita_hasta: hasta };
      await registrarAccion(admin, ctx, 'horario_actualizado', { antes: anterior, despues: resumenHorario(nuevo) });

      // Otras visitas futuras de este inmueble que quedaron fuera del nuevo horario: NO se
      // mueven solas; se avisa a su asesor para que las reprograme con el cliente.
      const { data: futuras } = await admin
        .from('agenda_citas')
        .select('id, asesor_id, fecha, hora_inicio, hora_fin')
        .eq('inmueble_id', inmueble.id)
        .eq('tipo_cita', 'visita_cliente')
        .neq('estado', 'cancelada')
        .gte('fecha', ahora.fecha);
      const fuera = (futuras || []).filter((c) => {
        if (c.fecha === ahora.fecha && c.hora_inicio.slice(0, 5) <= ahora.hora) return false;
        const dow = new Date(c.fecha + 'T12:00:00Z').getUTCDay() || 7;
        return !dias.includes(dow) || c.hora_inicio.slice(0, 5) < desde || c.hora_fin.slice(0, 5) > hasta;
      });
      const citasFuera = fuera.map((c) => ({ id: c.id, fecha: c.fecha, hora_inicio: c.hora_inicio.slice(0, 5), es_esta: c.id === cita.id }));

      const idsAsesoresFuera = [...new Set(fuera.map((c) => c.asesor_id).filter(Boolean))] as string[];
      const { data: asesoresFuera } = idsAsesoresFuera.length
        ? await admin.from('agenda_asesores').select('correo, correos_adicionales').in('id', idsAsesoresFuera)
        : { data: [] as Array<{ correo: string; correos_adicionales: string }> };
      const avisar = new Set<string>(correosAsesor);
      (asesoresFuera || []).forEach((a) => [...correosDe(a.correo), ...correosDe(a.correos_adicionales)].forEach((c) => avisar.add(c)));
      const listaFuera = fuera.map((c) => `<li>${esc(formatearFecha(c.fecha))}, ${esc(formatearHora(c.hora_inicio.slice(0, 5)))}</li>`).join('');
      await enviarCorreos(admin, cita.empresa_id, cita.id, 'asesor', [...avisar], `El arrendatario actualizó el horario de visitas · Inmueble ${inmueble.numero_inmueble}`, (real, mp, rem) =>
        plantillaCorreo({
          titulo: 'Nuevo horario de visitas',
          cuerpo: `<p style="margin:0 0 10px">El arrendatario del inmueble Nº ${esc(String(inmueble.numero_inmueble))}${direccion ? ` (${esc(direccion)})` : ''} actualizó cuándo se puede mostrar la vivienda.</p>
<p style="margin:0 0 10px">Antes: ${esc(anterior || 'sin horario')}<br>Ahora: <b>${esc(resumenHorario(nuevo))}</b></p>
${fuera.length ? `<p style="margin:0 0 6px"><b>Estas visitas ya agendadas quedaron fuera del nuevo horario</b> y hay que reprogramarlas con el cliente:</p><ul style="margin:0 0 0 18px;padding:0">${listaFuera}</ul>` : '<p style="margin:0">Ninguna visita ya agendada se ve afectada.</p>'}`,
          modoPruebas: mp, destinatarioReal: real, remitente: rem,
        }),
      );
      return json({
        ok: true,
        inmueble: { dias_permitidos: dias, desde, hasta },
        citas_fuera: citasFuera,
      });
    }

    return falla('Acción no reconocida.');
  } catch (e) {
    console.error('portal-arrendatario', accion, e instanceof Error ? e.message : e);
    return falla('Algo salió mal. Inténtalo de nuevo en unos minutos.', 500);
  }
});
