// Edge Function: portal-visita
// Acuerdo de horario de una visita a un inmueble "Rentando" entre el arrendatario (que vive
// adentro) y el cliente que visita. verify_jwt = false: el token secreto de la URL es la
// credencial (agenda_citas.token_arrendatario o token_cliente, uno por parte), como en
// calendario-ics. Cada parte solo ve lo suyo: el cliente nunca ve datos del arrendatario ni
// al revés. NO se avisa al asesor: la cita cambia sola en el sistema cuando hay acuerdo.
// Acciones (POST JSON { token, accion, ... }):
//   obtener          → cita, inmueble, asesor, propuesta pendiente
//   horarios         → { fecha } horas libres reales (mismo motor que la reserva pública)
//   proponer         → { fecha, hora } propone otra hora (reemplaza la propuesta pendiente) [inmueble Rentando]
//   responder        → { aceptar } la OTRA parte acepta (la cita pasa a la nueva hora) o rechaza [Rentando]
//   cancelar         → { motivo? } arrendatario (avisa al cliente) o CLIENTE (avisa por notificar-cambio-cita)
//   reagendar        → solo CLIENTE, inmueble que NO está Rentando: { fecha, hora } mueve la visita directo
//   guardar_horario  → solo arrendatario: { dias:[1..7], desde, hasta } cuándo se muestra el inmueble
// Con el token del INMUEBLE (agenda_inmuebles.token_arrendatario, un solo enlace para todas sus visitas):
//   obtener          → visitas próximas y franjas por fecha
//   ventanas_guardar → { fecha, tipo:'bloqueo'|'disponible', ventanas:[{desde,hasta}] } franjas de ese día; las visitas
//                      que quedan fuera se marcan para reubicar y el cliente elige otro turno dentro de las franjas
//   ventanas_borrar  → { fecha } quita las franjas de ese día
// El cliente puede cancelar o cambiar su visita desde su correo en cualquier inmueble; con arrendatario
// adentro (Rentando) el cambio de hora sigue siendo un acuerdo (proponer/responder).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, type MarcaCorreo, emojiTitulo, pieContacto } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';
import { calcularVencimiento, horasUltimoRecordatorio, correoClienteNuevoHorario, correoClienteRecordatorio, formatearMomento, MAX_DIAS_PAUSA, requiereLlamada, type MotivoReubicacion } from '../_shared/reubicacion.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';
const MAX_PROPUESTAS = 3; // por cita, entre las dos partes; al llegar al tope se avisa al asesor
const MAX_FRANJAS_POR_DIA = 3;
const HORAS_VIGENCIA_PROPUESTA = 48;

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

// Cómo llamar al inmueble según su tipo: una oficina o un local no son una "vivienda".
function sustantivo(tipo: string | null | undefined): string {
  switch (String(tipo || '').trim().toUpperCase()) {
    case 'APARTAMENTO':
    case 'CASA':
    case 'APARTAESTUDIO':
      return 'vivienda';
    case 'OFICINA':
      return 'oficina';
    case 'LOCAL':
      return 'local';
    case 'CONSULTORIO':
      return 'consultorio';
    case 'BODEGA':
      return 'bodega';
    case 'LOTE':
      return 'lote';
    default:
      return 'inmueble';
  }
}

// Mismo recorte de dirección que los demás correos: sin torre/apto/oficina.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INT|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;
function limpiarDireccion(d: string | null | undefined): string {
  if (!d) return '';
  return d.replace(REGEX_UNIDAD_INTERNA, ' ').replace(/[,-]{2,}/g, ',').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
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
type Rol = 'arrendatario' | 'cliente';
type TipoDestino = Rol | 'interno';

function correosDe(texto: string | null | undefined): string[] {
  return String(texto || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
}

async function cargarContexto(admin: Admin, token: string) {
  const { data: cita } = await admin
    .from('agenda_citas')
    .select(
      'id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, estado, tipo_cita, cliente_nombre, cliente_email, token_arrendatario, token_cliente, reubicacion_pendiente_desde, reubicacion_vence_en, reubicacion_motivo',
    )
    .or(`token_arrendatario.eq.${token},token_cliente.eq.${token}`)
    .maybeSingle();
  if (!cita || !cita.inmueble_id || cita.tipo_cita !== 'visita_cliente') return null;
  const rol: Rol = cita.token_arrendatario === token ? 'arrendatario' : 'cliente';
  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('id, numero_inmueble, direccion, barrio, ciudad, estado_crm, tipo_inmueble, dias_visita_permitidos, hora_visita_desde, hora_visita_hasta, duracion_visita_minutos, token_arrendatario, sin_aviso_arrendatario')
    .eq('id', cita.inmueble_id)
    .maybeSingle();
  if (!inmueble) return null;
  let asesor: { nombre: string; celular: string } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', cita.asesor_id).maybeSingle();
    asesor = data;
  }
  return { cita, inmueble, asesor, rol };
}

// ---- Correo ----------------------------------------------------------------------------
async function configCorreo(admin: Admin, empresaId: string) {
  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)',
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
  marca: MarcaCorreo;
}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.destinatarioReal)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(opts.marca, opts.titulo, 'visita')}
<div style="padding:28px 26px">
<h1 style="color:${opts.marca.principal};font-size:26px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-.01em;margin:0 0 12px">${esc(opts.titulo)} ${emojiTitulo(opts.titulo)}</h1>
<div style="color:#4d4d4d;font-size:14px;line-height:1.55">${opts.cuerpo}</div>
${opts.boton ? `<p style="margin:22px 0 0;text-align:center"><a href="${esc(opts.boton.url)}" style="display:inline-block;background:${opts.marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(opts.boton.texto)}</a></p>` : ''}
</div>
</div>
<p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${esc(opts.remitente)}</p>
  ${pieContacto(opts.marca)}
</div></body></html>`;
}

async function enviarCorreos(
  admin: Admin,
  empresaId: string,
  citaId: string,
  tipo: TipoDestino,
  destinatarios: string[],
  asunto: string,
  armar: (extra: { destinatarioReal: string; modoPruebas: boolean; remitente: string; marca: MarcaCorreo }) => string,
) {
  if (!destinatarios.length) return;
  const cfg = await configCorreo(admin, empresaId);
  if (!cfg) return;
  const { config, password, modoPruebas } = cfg;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
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
        html: armar({ destinatarioReal: correo, modoPruebas, remitente, marca: marcaCorreo(config) }),
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

async function correosArrendatario(admin: Admin, empresaId: string, numeroInmueble: number) {
  const { data } = await admin
    .from('agenda_arrendatarios')
    .select('nombre, email')
    .eq('empresa_id', empresaId)
    .eq('numero_inmueble', numeroInmueble)
    .maybeSingle();
  return { nombre: data?.nombre || '', correos: correosDe(data?.email) };
}

async function registrarAccion(
  admin: Admin,
  c: { cita: { id: string | null; empresa_id: string }; inmueble: { id: string } },
  accion: 'horario_actualizado' | 'cita_cancelada' | 'propuesta_creada' | 'propuesta_aceptada' | 'propuesta_rechazada' | 'ventanas_guardadas' | 'ventanas_borradas' | 'cita_reubicada' | 'pausa_visitas' | 'visita_vencida',
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
    // La auditoría no debe tumbar la acción.
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

// Primer día (desde hoy, hasta 60 días) en que hay al menos un horario libre: así nadie tiene que adivinar la fecha.
async function primeraFechaConHorarios(admin: Admin, cita: { empresa_id: string; inmueble_id: string }, diasPermitidos: number[] | null, hoy: string) {
  for (let n = 0; n <= 60; n++) {
    const fecha = sumarDias(hoy, n);
    const dow = new Date(fecha + 'T12:00:00Z').getUTCDay() || 7;
    if (diasPermitidos && diasPermitidos.length && !diasPermitidos.includes(dow)) {
      // Un día fuera del horario semanal solo puede tener turnos si el arrendatario abrió franjas ese día.
      const { count } = await admin.from('agenda_inmueble_ventanas').select('id', { count: 'exact', head: true }).eq('inmueble_id', cita.inmueble_id).eq('fecha', fecha).eq('tipo', 'disponible');
      if (!count) continue;
    }
    if ((await slotsDelDia(admin, cita, fecha)).length) return fecha;
  }
  return null;
}

// Devuelve el horario completo (asesor incluido) si ese día/hora de verdad se puede, o null.
async function slotValido(
  admin: Admin,
  cita: { id: string; empresa_id: string; inmueble_id: string },
  fecha: string,
  hora: string,
) {
  const slots = await slotsDelDia(admin, cita, fecha);
  const elegido = slots.find((s) => s.hora_inicio.slice(0, 5) === hora);
  if (!elegido) return null;
  const { data: libre } = await admin.rpc('agenda_slot_disponible', {
    p_empresa_id: cita.empresa_id,
    p_asesor_id: elegido.asesor_id,
    p_inmueble_id: cita.inmueble_id,
    p_fecha: fecha,
    p_hora_inicio: elegido.hora_inicio,
    p_hora_fin: elegido.hora_fin,
    p_ignorar_cita_id: cita.id,
  });
  return libre ? elegido : null;
}

// Propuesta pendiente de la cita, si sigue vigente. Si venció o la cita cambió por otra vía,
// la marca como expirada y devuelve null.
async function propuestaPendiente(
  admin: Admin,
  cita: { id: string; fecha: string; hora_inicio: string; estado: string; reubicacion_vence_en?: string | null },
  ahora: { fecha: string; hora: string },
) {
  const { data: p } = await admin
    .from('agenda_cita_propuestas')
    .select('id, propuesto_por, cita_fecha, cita_hora, fecha, hora_inicio, hora_fin, creado_en')
    .eq('cita_id', cita.id)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (!p) return null;
  // Con un cambio obligatorio en curso, la propuesta vale hasta el vencimiento de la visita; si no, 48 h.
  const vencida = cita.reubicacion_vence_en
    ? Date.now() > new Date(cita.reubicacion_vence_en).getTime()
    : Date.now() - new Date(p.creado_en).getTime() > HORAS_VIGENCIA_PROPUESTA * 3600_000;
  const citaCambio = p.cita_fecha !== cita.fecha || p.cita_hora.slice(0, 5) !== cita.hora_inicio.slice(0, 5);
  const citaPasada = cita.fecha < ahora.fecha || (cita.fecha === ahora.fecha && cita.hora_inicio.slice(0, 5) <= ahora.hora);
  if (vencida || citaCambio || citaPasada || cita.estado === 'cancelada' || p.fecha < ahora.fecha) {
    await admin.from('agenda_cita_propuestas').update({ estado: 'expirada', respondido_en: new Date().toISOString() }).eq('id', p.id);
    return null;
  }
  return p;
}

// ---- Portal por INMUEBLE (un solo enlace para todas las visitas del arrendatario) -----------
async function cargarInmueblePorToken(admin: Admin, token: string) {
  const { data } = await admin
    .from('agenda_inmuebles')
    .select('id, empresa_id, numero_inmueble, direccion, barrio, ciudad, estado_crm, tipo_inmueble, dias_visita_permitidos, hora_visita_desde, hora_visita_hasta, duracion_visita_minutos, token_arrendatario, sin_aviso_arrendatario')
    .eq('token_arrendatario', token)
    .maybeSingle();
  return data;
}

// Aviso interno al asesor (nunca con datos del arrendatario). cuerpo: HTML ya escapado.
async function avisarAsesor(admin: Admin, empresaId: string, citaId: string | null, asesorId: string | null, asunto: string, titulo: string, cuerpo: string) {
  if (!asesorId) return;
  const { data: a } = await admin.from('agenda_asesores').select('nombre, correo').eq('id', asesorId).maybeSingle();
  const correos = correosDe(a?.correo).slice(0, 1);
  await enviarCorreos(admin, empresaId, citaId as string, 'interno', correos, asunto, (extra) =>
    plantillaCorreo({ titulo, cuerpo: `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(a?.nombre || '')},</p>${cuerpo}`, ...extra }),
  );
}

// Marca como "por reubicar" las visitas de esa fecha que quedaron fuera de las franjas del arrendatario, avisa a sus
// clientes (cada uno elige un turno dentro de las franjas, sin pedir permiso otra vez) y al asesor. Quita la marca a las
// que ya caben. Devuelve cuántas quedaron por reubicar.
// Marca una visita como «pendiente de nuevo horario» con su plazo (ver _shared/reubicacion.ts). Devuelve el vencimiento en ms.
async function marcarReubicacion(admin: Admin, cita: { id: string; fecha: string; hora_inicio: string }, motivo: MotivoReubicacion): Promise<number> {
  const inicioMs = new Date(`${cita.fecha}T${cita.hora_inicio.slice(0, 5)}:00-05:00`).getTime(); // Colombia no tiene horario de verano
  const venceMs = calcularVencimiento(Date.now(), inicioMs);
  await admin
    .from('agenda_citas')
    .update({
      reubicacion_pendiente_desde: new Date().toISOString(),
      reubicacion_vence_en: new Date(venceMs).toISOString(),
      reubicacion_motivo: motivo,
      reubicacion_recordada_en: null,
      reubicacion_recordada2_en: null,
    })
    .eq('id', cita.id)
    .eq('estado', 'confirmada');
  return venceMs;
}

// Quita la marca de «pendiente de nuevo horario» (el cliente eligió, la cita se canceló o ya no aplica).
const LIMPIAR_REUBICACION = { reubicacion_pendiente_desde: null, reubicacion_vence_en: null, reubicacion_motivo: null, reubicacion_recordada_en: null, reubicacion_recordada2_en: null };

async function reubicarAfectadas(
  admin: Admin,
  inm: { id: string; empresa_id: string; numero_inmueble: number; direccion: string | null },
  fecha: string,
  ahora: { fecha: string; hora: string },
  motivo: MotivoReubicacion = 'dia_no_disponible',
) {
  const { data: franjas } = await admin.from('agenda_inmueble_ventanas').select('tipo, desde, hasta').eq('inmueble_id', inm.id).eq('fecha', fecha);
  const hm = (t: string) => t.slice(0, 5);
  const bloqueos = (franjas || []).filter((f) => f.tipo === 'bloqueo');
  const disponibles = (franjas || []).filter((f) => f.tipo === 'disponible');
  const { data: citas } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, asesor_id, hora_inicio, hora_fin, cliente_nombre, cliente_email, token_cliente, reubicacion_pendiente_desde')
    .eq('inmueble_id', inm.id)
    .eq('fecha', fecha)
    .eq('tipo_cita', 'visita_cliente')
    .neq('estado', 'cancelada');
  const direccion = limpiarDireccion(inm.direccion);
  const aviso: Array<{ id: string; asesor_id: string | null; hora: string; cliente: string; vence: string; llamar: boolean }> = [];
  let afectadasTotal = 0;
  for (const c of citas || []) {
    const ini = hm(c.hora_inicio);
    const fin = hm(c.hora_fin);
    if (fecha === ahora.fecha && ini <= ahora.hora) continue; // ya empezó o pasó
    const choca = bloqueos.some((b) => hm(b.desde) < fin && hm(b.hasta) > ini);
    const fuera = disponibles.length > 0 && !disponibles.some((d) => hm(d.desde) <= ini && hm(d.hasta) >= fin);
    const afectada = choca || fuera;
    if (afectada) afectadasTotal++;
    if (afectada && !c.reubicacion_pendiente_desde) {
      const venceMs = await marcarReubicacion(admin, { id: c.id, fecha, hora_inicio: c.hora_inicio }, motivo);
      const inicioMs = new Date(`${fecha}T${ini}:00-05:00`).getTime();
      aviso.push({ id: c.id, asesor_id: c.asesor_id, hora: ini, cliente: c.cliente_nombre, vence: formatearMomento(venceMs), llamar: requiereLlamada(Date.now(), inicioMs) });
      const correo = correoClienteNuevoHorario({
        nombre: c.cliente_nombre,
        lugar: direccion,
        visitaOriginal: formatearMomento(inicioMs),
        vence: formatearMomento(venceMs),
        enlace: `${SITIO_URL}/visita/${c.token_cliente}`,
      });
      await enviarCorreos(admin, c.empresa_id, c.id, 'cliente', correosDe(c.cliente_email).slice(0, 1), correo.asunto, (extra) =>
        plantillaCorreo({ titulo: correo.titulo, cuerpo: correo.cuerpo, boton: correo.boton, ...extra }),
      );
    } else if (!afectada && c.reubicacion_pendiente_desde) {
      await admin.from('agenda_citas').update(LIMPIAR_REUBICACION).eq('id', c.id);
    }
  }
  // Un solo correo por asesor con la lista de visitas que hay que reubicar.
  const porAsesor = new Map<string, typeof aviso>();
  for (const a of aviso) if (a.asesor_id) porAsesor.set(a.asesor_id, [...(porAsesor.get(a.asesor_id) || []), a]);
  for (const [asesorId, lista] of porAsesor) {
    await avisarAsesor(
      admin, inm.empresa_id, lista[0].id, asesorId,
      `Visitas por reubicar · Inmueble ${inm.numero_inmueble} · ${formatearFecha(fecha)}`,
      'Visitas por reubicar',
      `<p style="margin:0 0 10px;text-align:justify">El arrendatario del inmueble Nº ${esc(String(inm.numero_inmueble))} no puede recibir visitas el <b>${esc(formatearFecha(fecha))}</b>${motivo === 'pausa' ? ' (pausó las visitas por un tiempo)' : ''}. <b>No tienes que hacer nada:</b> ese horario ya quedó libre en tu agenda para atender a otras personas, y a cada cliente ya se le pidió elegir otra hora, con un plazo:</p>
<ul style="margin:0 0 10px;padding-left:20px">${lista.map((a) => `<li>${esc(formatearHora(a.hora))} · ${esc(a.cliente)} · plazo hasta ${esc(a.vence)}${a.llamar ? ' · <b>llámalo hoy: falta menos de un día</b>' : ''}</li>`).join('')}</ul>
<p style="margin:0;text-align:justify">Si el cliente elige una nueva hora, la visita se mueve sola y te llega el aviso. Si no elige antes de su plazo, se cancela sola. Mientras tanto aparece en tu agenda como «Horario liberado».</p>`,
    );
  }
  return afectadasTotal;
}

async function manejarInmueble(admin: Admin, inm: NonNullable<Awaited<ReturnType<typeof cargarInmueblePorToken>>>, accion: string, body: Record<string, unknown>) {
  const rentando = String(inm.estado_crm || '').trim().toLowerCase() === 'rentando' && inm.sin_aviso_arrendatario !== true;
  if (!rentando) return falla('Este inmueble ya no figura como arrendado. Comunícate con tu asesor.', 409);
  const ahora = ahoraBogota();
  const ctxAccion = { cita: { id: null as string | null, empresa_id: inm.empresa_id }, inmueble: { id: inm.id } };

  if (accion === 'obtener') {
    const { data: citas } = await admin
      .from('agenda_citas')
      .select('fecha, hora_inicio, hora_fin, token_arrendatario, reubicacion_pendiente_desde, reubicacion_vence_en')
      .eq('inmueble_id', inm.id)
      .eq('tipo_cita', 'visita_cliente')
      .neq('estado', 'cancelada')
      .gte('fecha', ahora.fecha)
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });
    const { data: franjas } = await admin
      .from('agenda_inmueble_ventanas')
      .select('fecha, tipo, desde, hasta')
      .eq('inmueble_id', inm.id)
      .gte('fecha', ahora.fecha)
      .order('fecha', { ascending: true })
      .order('desde', { ascending: true });
    return json({
      ok: true,
      modo: 'inmueble',
      rol: 'arrendatario',
      rentando: true,
      tipo: sustantivo(inm.tipo_inmueble),
      hoy: ahora.fecha,
      max_franjas: MAX_FRANJAS_POR_DIA,
      inmueble: {
        numero: inm.numero_inmueble,
        direccion: limpiarDireccion(inm.direccion),
        zona: [inm.barrio, inm.ciudad].filter(Boolean).join(', '),
        dias_permitidos: inm.dias_visita_permitidos || [],
        desde: inm.hora_visita_desde ? inm.hora_visita_desde.slice(0, 5) : null,
        hasta: inm.hora_visita_hasta ? inm.hora_visita_hasta.slice(0, 5) : null,
      },
      citas: (citas || [])
        .filter((c) => !(c.fecha === ahora.fecha && c.hora_inicio.slice(0, 5) <= ahora.hora))
        .map((c) => ({
          fecha: c.fecha,
          hora_inicio: c.hora_inicio.slice(0, 5),
          hora_fin: c.hora_fin.slice(0, 5),
          token: c.token_arrendatario,
          por_reubicar: !!c.reubicacion_pendiente_desde,
          vence: c.reubicacion_pendiente_desde && c.reubicacion_vence_en ? formatearMomento(new Date(c.reubicacion_vence_en).getTime()) : null,
        })),
      max_dias_pausa: MAX_DIAS_PAUSA,
      franjas: (franjas || []).map((f) => ({ fecha: f.fecha, tipo: f.tipo, desde: f.desde.slice(0, 5), hasta: f.hasta.slice(0, 5) })),
    });
  }

  if (accion === 'primera_fecha') {
    return json({ ok: true, fecha: await primeraFechaConHorarios(admin, { empresa_id: inm.empresa_id, inmueble_id: inm.id }, inm.dias_visita_permitidos, ahora.fecha) });
  }

  if (accion === 'ventanas_guardar') {
    // Una o varias fechas (cambio en bloque): las mismas franjas se aplican a todas.
    const fechas = [...new Set((Array.isArray(body.fechas) && body.fechas.length ? body.fechas : [body.fecha]).map((f) => String(f || '')))].sort();
    const tipo = body.tipo === 'bloqueo' ? 'bloqueo' : body.tipo === 'disponible' ? 'disponible' : '';
    if (!fechas.length || fechas.length > 31 || fechas.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f)) || !tipo) return falla('Elige al menos una fecha (máx. 31) y si es un bloqueo o una franja disponible.');
    if (fechas.some((f) => f < ahora.fecha || f > sumarDias(ahora.fecha, 60))) return falla('Elige fechas dentro de los próximos 60 días.');
    const lista = Array.isArray(body.ventanas) ? (body.ventanas as Array<Record<string, unknown>>) : [];
    if (!lista.length || lista.length > MAX_FRANJAS_POR_DIA) return falla(`Indica entre 1 y ${MAX_FRANJAS_POR_DIA} franjas.`);
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const { data: cfgDur } = await admin.from('agenda_configuracion').select('duracion_visita_minutos').eq('empresa_id', inm.empresa_id).maybeSingle();
    const duracion = inm.duracion_visita_minutos || cfgDur?.duracion_visita_minutos || 30;
    const filas: Array<{ desde: string; hasta: string }> = [];
    for (const v of lista) {
      const desde = String(v.desde || '').slice(0, 5);
      const hasta = String(v.hasta || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(desde) || !/^\d{2}:\d{2}$/.test(hasta)) return falla('Escribe la hora desde y hasta de cada franja.');
      if (desde < '06:00' || hasta > '21:00') return falla('Las franjas deben estar entre las 6:00 a. m. y las 9:00 p. m.');
      if (minutos(hasta) <= minutos(desde)) return falla('En cada franja, la hora "desde" debe ser anterior a "hasta".');
      if (tipo === 'disponible' && minutos(hasta) - minutos(desde) < duracion) {
        return falla(`Cada franja disponible debe permitir al menos una visita completa (${duracion} minutos).`);
      }
      filas.push({ desde, hasta });
    }
    filas.sort((a, b) => (a.desde < b.desde ? -1 : 1));
    for (let i = 1; i < filas.length; i++) if (filas[i].desde < filas[i - 1].hasta) return falla('Las franjas no pueden cruzarse.');

    await admin.from('agenda_inmueble_ventanas').delete().eq('inmueble_id', inm.id).in('fecha', fechas);
    const { error: errIns } = await admin
      .from('agenda_inmueble_ventanas')
      .insert(fechas.flatMap((fecha) => filas.map((f) => ({ empresa_id: inm.empresa_id, inmueble_id: inm.id, fecha, tipo, desde: f.desde, hasta: f.hasta }))));
    if (errIns) return falla('No se pudieron guardar las franjas. Inténtalo de nuevo.', 500);
    await registrarAccion(admin, ctxAccion, 'ventanas_guardadas', { fechas, tipo, franjas: filas });
    let afectadas = 0;
    for (const fecha of fechas) afectadas += await reubicarAfectadas(admin, inm, fecha, ahora);
    return json({ ok: true, afectadas, fechas: fechas.length });
  }

  // «No puedo recibir visitas por un tiempo»: bloquea todos los días del rango (hasta MAX_DIAS_PAUSA). Las visitas que caen ahí
  // quedan pendientes de nuevo horario (con plazo) y el cliente elige una fecha fuera de la pausa.
  if (accion === 'pausar') {
    const desde = String(body.desde || '');
    const hasta = String(body.hasta || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return falla('Indica desde qué día y hasta qué día no puedes recibir visitas.');
    if (hasta < desde) return falla('El último día de la pausa no puede ser anterior al primero.');
    if (desde < ahora.fecha || hasta > sumarDias(ahora.fecha, 60)) return falla('Elige fechas dentro de los próximos 60 días.');
    const fechas: string[] = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) fechas.push(f);
    if (fechas.length > MAX_DIAS_PAUSA) return falla(`La pausa puede durar hasta ${MAX_DIAS_PAUSA} días. Si necesitas más tiempo, comunícate con tu asesor.`);
    await admin.from('agenda_inmueble_ventanas').delete().eq('inmueble_id', inm.id).in('fecha', fechas);
    const { error: errIns } = await admin
      .from('agenda_inmueble_ventanas')
      .insert(fechas.map((fecha) => ({ empresa_id: inm.empresa_id, inmueble_id: inm.id, fecha, tipo: 'bloqueo', desde: '00:00', hasta: '23:59' })));
    if (errIns) return falla('No se pudo pausar las visitas. Inténtalo de nuevo.', 500);
    await registrarAccion(admin, ctxAccion, 'pausa_visitas', { desde, hasta });
    let afectadas = 0;
    for (const fecha of fechas) afectadas += await reubicarAfectadas(admin, inm, fecha, ahora, 'pausa');
    return json({ ok: true, afectadas, dias: fechas.length });
  }

  if (accion === 'ventanas_borrar') {
    const fechas = [...new Set((Array.isArray(body.fechas) && body.fechas.length ? body.fechas : [body.fecha]).map((f) => String(f || '')))].sort();
    if (!fechas.length || fechas.length > 31 || fechas.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f))) return falla('Fecha inválida.');
    await admin.from('agenda_inmueble_ventanas').delete().eq('inmueble_id', inm.id).in('fecha', fechas);
    await registrarAccion(admin, ctxAccion, 'ventanas_borradas', { fechas });
    let afectadas = 0;
    for (const fecha of fechas) afectadas += await reubicarAfectadas(admin, inm, fecha, ahora);
    return json({ ok: true, afectadas, fechas: fechas.length });
  }

  return falla('Acción no reconocida.');
}

// ---- Vencimientos y recordatorios de las visitas «pendientes de nuevo horario» -------------------
// Lo llama pg_cron cada 10 min (sql/026). No recibe nada ni toca nada que no esté vencido según la base, y cada paso deja una marca
// para no repetirse, así que es seguro aunque alguien lo invoque de más.
async function procesarReubicaciones(admin: Admin) {
  const ahoraMs = Date.now();
  const { data: pendientes } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, cliente_nombre, cliente_email, token_cliente, reubicacion_pendiente_desde, reubicacion_vence_en, reubicacion_recordada_en, reubicacion_recordada2_en')
    .eq('estado', 'confirmada')
    .eq('tipo_cita', 'visita_cliente')
    .not('reubicacion_pendiente_desde', 'is', null)
    .not('reubicacion_vence_en', 'is', null)
    .limit(200);
  let vencidas = 0;
  let recordadas = 0;
  for (const c of pendientes || []) {
    const venceMs = new Date(c.reubicacion_vence_en as string).getTime();
    const { data: inm } = await admin.from('agenda_inmuebles').select('id, numero_inmueble, direccion').eq('id', c.inmueble_id).maybeSingle();
    if (!inm) continue;
    const direccion = limpiarDireccion(inm.direccion);
    const inicioMs = new Date(`${c.fecha}T${c.hora_inicio.slice(0, 5)}:00-05:00`).getTime();
    const ctxAccion = { cita: { id: c.id as string | null, empresa_id: c.empresa_id }, inmueble: { id: inm.id } };

    if (venceMs <= ahoraMs) {
      // Se acabó el plazo y el cliente no eligió: la visita se cancela (condición en el UPDATE por si justo eligió).
      const { data: cancelada } = await admin
        .from('agenda_citas')
        .update({ estado: 'cancelada', motivo_cancelacion: 'Cancelada automáticamente: no se eligió una nueva hora antes del plazo', cancelado_por: null, actualizado_en: new Date().toISOString() })
        .eq('id', c.id)
        .eq('estado', 'confirmada')
        .eq('reubicacion_vence_en', c.reubicacion_vence_en)
        .select('id')
        .maybeSingle();
      if (!cancelada) continue;
      await admin.from('agenda_cita_propuestas').update({ estado: 'expirada', respondido_en: new Date().toISOString() }).eq('cita_id', c.id).eq('estado', 'pendiente');
      await registrarAccion(admin, ctxAccion, 'visita_vencida', { fecha: c.fecha, hora: c.hora_inicio.slice(0, 5), vencio: c.reubicacion_vence_en });
      // Cliente (con la cancelación en el calendario de su teléfono), propietario y arrendatario, por el correo de siempre.
      await fetch(`${SUPABASE_URL}/functions/v1/notificar-cambio-cita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
        body: JSON.stringify({ cita_id: c.id, accion: 'cancelada', origen: 'vencimiento' }),
      }).catch(() => {});
      await avisarAsesor(
        admin, c.empresa_id, c.id, c.asesor_id,
        `Visita cancelada por vencimiento · Inmueble ${inm.numero_inmueble}`,
        'Se canceló una visita: el cliente no eligió nueva hora',
        `<p style="margin:0 0 10px;text-align:justify">La visita de <b>${esc(c.cliente_nombre)}</b> al inmueble Nº ${esc(String(inm.numero_inmueble))}${direccion ? ` (${esc(direccion)})` : ''}, que estaba para ${esc(formatearMomento(inicioMs))}, se canceló sola: el arrendatario no podía recibirla y el cliente no eligió una nueva hora antes de su plazo (${esc(formatearMomento(venceMs))}).</p><p style="margin:0;text-align:justify">Si el cliente sigue interesado, puede agendar de nuevo desde el sitio o puedes escribirle tú.</p>`,
      );
      vencidas++;
      continue;
    }

    // Recordatorios: a mitad del plazo y otro antes de que venza (24 h antes si el plazo es largo, 2 h si es corto).
    const desdeMs = new Date(c.reubicacion_pendiente_desde as string).getTime();
    const faltaMs = venceMs - ahoraMs;
    const umbral2Ms = horasUltimoRecordatorio(desdeMs, venceMs) * 3600_000;
    const toca1 = !c.reubicacion_recordada_en && ahoraMs >= desdeMs + (venceMs - desdeMs) / 2 && faltaMs > umbral2Ms;
    const toca2 = !c.reubicacion_recordada2_en && faltaMs <= umbral2Ms;
    if (!toca1 && !toca2) continue;
    // Se marca primero (condicional): si dos corridas se cruzan, solo una envía.
    const marca = new Date().toISOString();
    const { data: marcada } = await admin
      .from('agenda_citas')
      .update(toca2 ? { reubicacion_recordada_en: c.reubicacion_recordada_en || marca, reubicacion_recordada2_en: marca } : { reubicacion_recordada_en: marca })
      .eq('id', c.id)
      .eq('estado', 'confirmada')
      .is(toca2 ? 'reubicacion_recordada2_en' : 'reubicacion_recordada_en', null)
      .select('id')
      .maybeSingle();
    if (!marcada) continue;
    let asesor: { nombre: string; celular: string } | null = null;
    if (c.asesor_id) {
      const { data } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', c.asesor_id).maybeSingle();
      asesor = data;
    }
    const correo = correoClienteRecordatorio({
      nombre: c.cliente_nombre,
      lugar: direccion,
      visitaOriginal: formatearMomento(inicioMs),
      vence: formatearMomento(venceMs),
      asesor,
      enlace: `${SITIO_URL}/visita/${c.token_cliente}`,
    });
    await enviarCorreos(admin, c.empresa_id, c.id, 'cliente', correosDe(c.cliente_email).slice(0, 1), correo.asunto, (extra) =>
      plantillaCorreo({ titulo: correo.titulo, cuerpo: correo.cuerpo, boton: correo.boton, ...extra }),
    );
    recordadas++;
  }
  return { vencidas, recordadas };
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
  // Tarea programada (pg_cron): no usa token de ninguna parte.
  if (body.accion === 'procesar_reubicaciones') {
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      return json({ ok: true, ...(await procesarReubicaciones(admin)) });
    } catch (e) {
      console.error('portal-visita procesar_reubicaciones', e instanceof Error ? e.message : e);
      return falla('No se pudieron procesar las visitas pendientes.', 500);
    }
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
  if (!ctx) {
    // ¿Es el enlace único del inmueble (arrendatario)? Si no, el enlace no sirve.
    const inmuebleDelToken = await cargarInmueblePorToken(admin, token);
    if (inmuebleDelToken) {
      try {
        return await manejarInmueble(admin, inmuebleDelToken, accion, body);
      } catch (e) {
        console.error('portal-visita inmueble', accion, e instanceof Error ? e.message : e);
        return falla('Algo salió mal. Inténtalo de nuevo en unos minutos.', 500);
      }
    }
    return falla('Este enlace no es válido o ya no está activo.', 404);
  }
  const { cita, inmueble, asesor, rol } = ctx;
  // «Sin aviso al arrendatario» = el inmueble se comporta como uno libre: el cliente reagenda directo.
  const rentando = String(inmueble.estado_crm || '').trim().toLowerCase() === 'rentando' && inmueble.sin_aviso_arrendatario !== true;
  const nombreInm = sustantivo(inmueble.tipo_inmueble);
  // El cliente puede ver, cancelar y (si no hay arrendatario adentro) reagendar su visita en cualquier inmueble;
  // todo lo demás (acuerdo de horario, horario permitido) solo existe mientras el inmueble está Rentando.
  if (!rentando && !(rol === 'cliente' && ['obtener', 'horarios', 'primera_fecha', 'cancelar', 'reagendar'].includes(accion))) {
    return falla('Este inmueble ya no figura como arrendado. Comunícate con tu asesor.', 409);
  }

  const ahora = ahoraBogota();
  const horaCita = cita.hora_inicio.slice(0, 5);
  const citaVigente = cita.estado !== 'cancelada' && (cita.fecha > ahora.fecha || (cita.fecha === ahora.fecha && horaCita > ahora.hora));
  const direccion = limpiarDireccion(inmueble.direccion);
  const otraParte: Rol = rol === 'arrendatario' ? 'cliente' : 'arrendatario';
  const enlaceDe = (r: Rol) => `${SITIO_URL}/${r === 'arrendatario' ? 'arrendatario' : 'visita'}/${r === 'arrendatario' ? cita.token_arrendatario : cita.token_cliente}`;

  // Avisa a la otra parte (nunca al asesor). cuerpo: HTML ya escapado.
  async function avisarA(destino: Rol, asunto: string, titulo: string, cuerpo: string, textoBoton: string) {
    let nombre = '';
    let correos: string[];
    if (destino === 'cliente') {
      correos = correosDe(cita.cliente_email).slice(0, 1);
      nombre = cita.cliente_nombre;
    } else {
      const t = await correosArrendatario(admin, cita.empresa_id, inmueble.numero_inmueble);
      correos = t.correos;
      nombre = t.nombre;
    }
    await enviarCorreos(admin, cita.empresa_id, cita.id, destino, correos, asunto, (extra) =>
      plantillaCorreo({
        titulo,
        cuerpo: `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(nombre)},</p>${cuerpo}`,
        boton: { texto: textoBoton, url: enlaceDe(destino) },
        ...extra,
      }),
    );
  }

  const lineaVisita = `<b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b>${direccion ? ` en ${esc(direccion)}` : ''}`;

  try {
    // ---------------------------------------------------------------- obtener
    if (accion === 'obtener') {
      const p = citaVigente ? await propuestaPendiente(admin, cita, ahora) : null;
      return json({
        ok: true,
        rol,
        rentando,
        tipo: nombreInm,
        hoy: ahora.fecha,
        reubicacion: !!cita.reubicacion_pendiente_desde && citaVigente,
        reubicacion_vence: cita.reubicacion_pendiente_desde && citaVigente && cita.reubicacion_vence_en ? formatearMomento(new Date(cita.reubicacion_vence_en).getTime()) : null,
        reubicacion_motivo: cita.reubicacion_pendiente_desde && citaVigente ? cita.reubicacion_motivo : null,
        inmueble_token: rol === 'arrendatario' ? inmueble.token_arrendatario : undefined,
        cita: { fecha: cita.fecha, hora_inicio: horaCita, hora_fin: cita.hora_fin.slice(0, 5), estado: cita.estado, vigente: citaVigente },
        inmueble: {
          numero: inmueble.numero_inmueble,
          direccion,
          zona: [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', '),
          ...(rol === 'arrendatario'
            ? {
                dias_permitidos: inmueble.dias_visita_permitidos || [],
                desde: inmueble.hora_visita_desde ? inmueble.hora_visita_desde.slice(0, 5) : null,
                hasta: inmueble.hora_visita_hasta ? inmueble.hora_visita_hasta.slice(0, 5) : null,
              }
            : {}),
        },
        asesor,
        propuesta: p
          ? {
              propuesta_por_mi: p.propuesto_por === rol,
              fecha: p.fecha,
              hora_inicio: p.hora_inicio.slice(0, 5),
              hora_fin: p.hora_fin.slice(0, 5),
              vence_horas: cita.reubicacion_vence_en
                ? Math.max(1, Math.round((new Date(cita.reubicacion_vence_en).getTime() - Date.now()) / 3600_000))
                : Math.max(1, Math.round(HORAS_VIGENCIA_PROPUESTA - (Date.now() - new Date(p.creado_en).getTime()) / 3600_000)),
            }
          : null,
      });
    }

    // ---------------------------------------------------------- primera_fecha
    if (accion === 'primera_fecha') {
      return json({ ok: true, fecha: await primeraFechaConHorarios(admin, cita, inmueble.dias_visita_permitidos, ahora.fecha) });
    }

    // --------------------------------------------------------------- horarios
    if (accion === 'horarios') {
      const fecha = String(body.fecha || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return falla('Fecha inválida.');
      if (fecha < ahora.fecha || fecha > sumarDias(ahora.fecha, 60)) return json({ ok: true, horas: [] });
      const slots = await slotsDelDia(admin, cita, fecha);
      return json({ ok: true, horas: slots.map((s) => ({ hora_inicio: s.hora_inicio.slice(0, 5), hora_fin: s.hora_fin.slice(0, 5) })) });
    }

    // --------------------------------------------------------------- proponer
    if (accion === 'proponer') {
      if (!citaVigente) return falla('Esta visita ya no se puede cambiar (ya pasó o fue cancelada).', 409);
      const fecha = String(body.fecha || '');
      const hora = String(body.hora || '').slice(0, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return falla('Fecha u hora inválida.');
      if (fecha < ahora.fecha || fecha > sumarDias(ahora.fecha, 60)) return falla('Elige una fecha dentro de los próximos 60 días.');
      if (fecha === cita.fecha && hora === horaCita) return falla('Esa ya es la hora de la visita.');

      const { count: total } = await admin
        .from('agenda_cita_propuestas')
        .select('id', { count: 'exact', head: true })
        .eq('cita_id', cita.id);
      if ((total || 0) >= MAX_PROPUESTAS) {
        return falla('Ya se hicieron varias propuestas para esta visita. Comuníquense directamente con el asesor.', 429);
      }

      const elegido = await slotValido(admin, cita, fecha, hora);
      if (!elegido) return falla('Ese horario ya no está disponible. Elige otro.', 409);

      // Una sola pendiente por cita: la nueva reemplaza a la anterior (sea de quien sea).
      await admin
        .from('agenda_cita_propuestas')
        .update({ estado: 'reemplazada', respondido_en: new Date().toISOString() })
        .eq('cita_id', cita.id)
        .eq('estado', 'pendiente');
      const { error: errIns } = await admin.from('agenda_cita_propuestas').insert({
        empresa_id: cita.empresa_id,
        cita_id: cita.id,
        propuesto_por: rol,
        cita_fecha: cita.fecha,
        cita_hora: cita.hora_inicio,
        fecha,
        hora_inicio: elegido.hora_inicio,
        hora_fin: elegido.hora_fin,
      });
      if (errIns) return falla('No se pudo enviar la propuesta. Inténtalo de nuevo.', 409);
      await registrarAccion(admin, ctx, 'propuesta_creada', { por: rol, de: { fecha: cita.fecha, hora: horaCita }, a: { fecha, hora } });
      if ((total || 0) + 1 >= MAX_PROPUESTAS) {
        // Última propuesta permitida: si no hay acuerdo, el asesor tiene que coordinarlo directamente.
        await avisarAsesor(
          admin, cita.empresa_id, cita.id, cita.asesor_id,
          `Visita sin acuerdo de horario · Inmueble ${inmueble.numero_inmueble}`,
          'Esta visita necesita tu ayuda',
          `<p style="margin:0 0 10px;text-align:justify">La visita de <b>${esc(cita.cliente_nombre)}</b> al inmueble Nº ${esc(String(inmueble.numero_inmueble))} (${lineaVisita}) ya llegó al tope de ${MAX_PROPUESTAS} propuestas de horario entre el cliente y el arrendatario. No se permiten más propuestas desde los enlaces.</p>
<p style="margin:0;text-align:justify">Si hay una propuesta pendiente se mantiene hasta que venza; si no hay acuerdo, la visita sigue en la hora original salvo que el arrendatario haya pedido el cambio (en ese caso se cancela al vencer el plazo). Comunícate con ambos para cerrarla.</p>`,
        );
      }

      const nuevaLinea = `<b>${esc(formatearFecha(fecha))}, ${esc(formatearHora(hora))}</b>`;
      if (rol === 'arrendatario') {
        // «No puedo a esa hora» es un cambio OBLIGATORIO: la visita queda pendiente de nuevo horario, con plazo; el cliente
        // acepta esta hora o elige otra, y si no hace ninguna de las dos antes del plazo la visita se cancela.
        const venceMs = await marcarReubicacion(admin, cita, 'otra_hora');
        const inicioMs = new Date(`${cita.fecha}T${horaCita}:00-05:00`).getTime();
        const correo = correoClienteNuevoHorario({
          nombre: cita.cliente_nombre,
          lugar: direccion,
          visitaOriginal: formatearMomento(inicioMs),
          vence: formatearMomento(venceMs),
          sugerencia: formatearMomento(new Date(`${fecha}T${hora}:00-05:00`).getTime()),
          asesor,
          enlace: enlaceDe('cliente'),
        });
        await enviarCorreos(admin, cita.empresa_id, cita.id, 'cliente', correosDe(cita.cliente_email).slice(0, 1), correo.asunto, (extra) =>
          plantillaCorreo({ titulo: correo.titulo, cuerpo: correo.cuerpo, boton: correo.boton, ...extra }),
        );
        if (requiereLlamada(Date.now(), inicioMs)) {
          await avisarAsesor(
            admin, cita.empresa_id, cita.id, cita.asesor_id,
            `Llama hoy: visita que debe cambiar · Inmueble ${inmueble.numero_inmueble}`,
            'Esta visita necesita tu llamada',
            `<p style="margin:0 0 10px;text-align:justify">El arrendatario no puede recibir la visita de <b>${esc(cita.cliente_nombre)}</b> (${lineaVisita}) y propuso otra hora. Como falta menos de un día, <b>llama hoy al cliente</b> para acordarla.</p><p style="margin:0;text-align:justify">Ya le enviamos un correo con plazo hasta el ${esc(formatearMomento(venceMs))}; si no elige, la visita se cancela sola.</p>`,
          );
        }
      } else {
        await avisarA(
          'arrendatario',
          `El interesado propone otra hora · Inmueble ${inmueble.numero_inmueble}`,
          'Te propusieron otra hora para la visita',
          `<p style="margin:0 0 10px;text-align:justify">En respuesta a tu propuesta, la persona interesada en tu ${nombreInm} sugiere esta hora:</p>
<p style="margin:0 0 10px;font-size:16px;text-align:justify">${nuevaLinea}</p>
<p style="margin:0;text-align:justify">La visita sigue para ${lineaVisita} y solo cambia si tú aceptas. Puedes aceptar, o proponer otra hora. Vence en ${HORAS_VIGENCIA_PROPUESTA} horas.</p>`,
          'Ver la propuesta',
        );
      }
      return json({ ok: true });
    }

    // -------------------------------------------------------------- responder
    if (accion === 'responder') {
      if (!citaVigente) return falla('Esta visita ya no se puede cambiar (ya pasó o fue cancelada).', 409);
      const aceptar = body.aceptar === true;
      const p = await propuestaPendiente(admin, cita, ahora);
      if (!p) return falla('Ya no hay una propuesta pendiente (venció o ya se respondió).', 409);
      if (p.propuesto_por === rol) return falla('Esperando la respuesta de la otra persona.', 409);

      if (!aceptar) {
        // Con un cambio obligatorio en curso el cliente no puede «dejar la hora original»: tiene que elegir otra o cancelar.
        if (rol === 'cliente' && cita.reubicacion_pendiente_desde) return falla('Esta visita debe cambiar de hora: acepta la propuesta, elige otra hora o cancélala.', 409);
        await admin.from('agenda_cita_propuestas').update({ estado: 'rechazada', respondido_en: new Date().toISOString() }).eq('id', p.id).eq('estado', 'pendiente');
        await registrarAccion(admin, ctx, 'propuesta_rechazada', { por: rol });
        await avisarA(
          otraParte,
          `La propuesta de horario no fue aceptada · Inmueble ${inmueble.numero_inmueble}`,
          'La otra hora no se aceptó',
          `<p style="margin:0 0 10px;text-align:justify">No fue aceptada la hora que propusiste. La visita sigue para ${lineaVisita}.</p>
<p style="margin:0;text-align:justify">Si quieres, puedes proponer otra hora.</p>`,
          'Proponer otra hora',
        );
        return json({ ok: true, resultado: 'rechazada' });
      }

      // Aceptar: se vuelve a validar que ese horario siga libre y dentro de las reglas.
      const elegido = await slotValido(admin, cita, p.fecha, p.hora_inicio.slice(0, 5));
      if (!elegido) {
        await admin.from('agenda_cita_propuestas').update({ estado: 'expirada', respondido_en: new Date().toISOString() }).eq('id', p.id).eq('estado', 'pendiente');
        await avisarA(
          otraParte,
          `La hora propuesta ya no está disponible · Inmueble ${inmueble.numero_inmueble}`,
          'Esa hora ya no está disponible',
          `<p style="margin:0 0 10px;text-align:justify">La hora propuesta se ocupó antes de poder confirmarla. La visita sigue para ${lineaVisita}.</p><p style="margin:0;text-align:justify">Puedes proponer otra hora.</p>`,
          'Proponer otra hora',
        );
        return falla('Esa hora ya no está disponible. Propón otra.', 409);
      }
      // Condición en el UPDATE: si alguien más cambió/canceló la cita entre tanto, no se pisa.
      const { data: movida, error: errMover } = await admin
        .from('agenda_citas')
        .update({
          fecha: p.fecha,
          hora_inicio: elegido.hora_inicio,
          hora_fin: elegido.hora_fin,
          asesor_id: elegido.asesor_id,
          ...LIMPIAR_REUBICACION,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .eq('fecha', cita.fecha)
        .eq('hora_inicio', cita.hora_inicio)
        .select('id')
        .maybeSingle();
      if (errMover && /ya no está disponible/i.test(errMover.message)) return falla('Esa hora acaba de ser tomada por otra persona. Propón o elige otra.', 409);
      if (errMover || !movida) return falla('No se pudo confirmar el cambio. Actualiza la página e inténtalo de nuevo.', 409);
      await admin.from('agenda_cita_propuestas').update({ estado: 'aceptada', respondido_en: new Date().toISOString() }).eq('id', p.id);
      await registrarAccion(admin, ctx, 'propuesta_aceptada', { acepto: rol, de: { fecha: cita.fecha, hora: horaCita }, a: { fecha: p.fecha, hora: p.hora_inicio.slice(0, 5) } });

      // En firme: el cliente recibe su confirmación de siempre (con la hora nueva), el
      // propietario su aviso y el arrendatario la suya. El asesor no recibe correo: ve la
      // cita en su agenda y en su calendario compartido.
      const cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY };
      for (const f of ['enviar-correo-cita', 'enviar-correo-propietario']) {
        fetch(`${SUPABASE_URL}/functions/v1/${f}`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ cita_id: cita.id, sin_aviso_arrendatario: true, reagendada: true }) }).catch(() => {});
      }
      const t = await correosArrendatario(admin, cita.empresa_id, inmueble.numero_inmueble);
      const nuevaLinea = `<b>${esc(formatearFecha(p.fecha))}, ${esc(formatearHora(p.hora_inicio.slice(0, 5)))}</b>${direccion ? ` en ${esc(direccion)}` : ''}`;
      await enviarCorreos(admin, cita.empresa_id, cita.id, 'arrendatario', t.correos, `Visita confirmada en nuevo horario · Inmueble ${inmueble.numero_inmueble}`, (extra) =>
        plantillaCorreo({
          titulo: 'La visita quedó en firme',
          cuerpo: `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(t.nombre)}, ambas partes aceptaron el cambio. La visita quedó para ${nuevaLinea}.</p><p style="margin:0;text-align:justify">No tienes que hacer nada más.</p>`,
          boton: { texto: 'Ver mi visita', url: enlaceDe('arrendatario') },
          ...extra,
        }),
      );
      return json({
        ok: true,
        resultado: 'aceptada',
        cita: { fecha: p.fecha, hora_inicio: p.hora_inicio.slice(0, 5), hora_fin: elegido.hora_fin.slice(0, 5), estado: 'confirmada', vigente: true },
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
          motivo_cancelacion: `Cancelada por ${rol === 'cliente' ? 'el cliente' : 'el arrendatario'}${motivo ? ': ' + motivo : ''}`,
          cancelado_por: null,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .select('id')
        .maybeSingle();
      if (errCancelar || !cancelada) return falla('No se pudo cancelar la visita. Actualiza la página e inténtalo de nuevo.', 409);
      await admin
        .from('agenda_cita_propuestas')
        .update({ estado: 'expirada', respondido_en: new Date().toISOString() })
        .eq('cita_id', cita.id)
        .eq('estado', 'pendiente');
      if (rol === 'cliente') {
        // El cliente canceló: se avisa al propietario y (si está Rentando) al arrendatario, y el cliente recibe su
        // constancia con la cancelación en el calendario de su teléfono.
        await fetch(`${SUPABASE_URL}/functions/v1/notificar-cambio-cita`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ cita_id: cita.id, accion: 'cancelada', origen: 'cliente' }),
        }).catch(() => {});
        return json({ ok: true, cita: { fecha: cita.fecha, hora_inicio: horaCita, hora_fin: cita.hora_fin.slice(0, 5), estado: 'cancelada', vigente: false } });
      }
      await registrarAccion(admin, ctx, 'cita_cancelada', { fecha: cita.fecha, hora: horaCita, motivo });
      await avisarAsesor(
        admin, cita.empresa_id, cita.id, cita.asesor_id,
        `El arrendatario canceló una visita · Inmueble ${inmueble.numero_inmueble}`,
        'El arrendatario canceló una visita',
        `<p style="margin:0 0 10px;text-align:justify">El arrendatario canceló la visita de <b>${esc(cita.cliente_nombre)}</b> al inmueble Nº ${esc(String(inmueble.numero_inmueble))} (${lineaVisita}).${motivo ? ` Motivo: ${esc(motivo)}.` : ''}</p>
<p style="margin:0;text-align:justify">Ya se avisó al cliente para que busque otro horario.</p>`,
      );

      await enviarCorreos(admin, cita.empresa_id, cita.id, 'cliente', correosDe(cita.cliente_email).slice(0, 1), `Tu visita del ${formatearFecha(cita.fecha)} fue cancelada`, (extra) =>
        plantillaCorreo({
          titulo: 'Tu visita fue cancelada',
          cuerpo: `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(cita.cliente_nombre)}, lamentamos informarte que la visita del <b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b>${direccion ? ` al inmueble en ${esc(direccion)}` : ''} no se podrá realizar: el inmueble está arrendado y ocupado, y en ese horario no es posible recibirte.</p>
<p style="margin:0;text-align:justify">Puedes elegir otro horario cuando quieras${asesor?.nombre ? ` o escribirle a tu asesor, ${esc(asesor.nombre)}` : ''}.</p>`,
          boton: { texto: 'Agendar otro horario', url: `${SITIO_URL}/inmuebles/${inmueble.numero_inmueble}` },
          ...extra,
        }),
      );
      return json({ ok: true, cita: { fecha: cita.fecha, hora_inicio: horaCita, hora_fin: cita.hora_fin.slice(0, 5), estado: 'cancelada', vigente: false } });
    }

    // -------------------------------------------------------------- reagendar
    // El cliente elige él mismo otra hora cuando NO hay arrendatario adentro (si lo hay, hay que acordar: proponer).
    if (accion === 'reagendar') {
      if (rol !== 'cliente') return falla('Esta acción no está disponible desde este enlace.', 403);
      // Con arrendatario adentro, el cliente solo elige directo cuando se le pidió reubicarse (los turnos que se
      // ofrecen ya están dentro de las franjas que el propio arrendatario abrió).
      if (rentando && !cita.reubicacion_pendiente_desde) return falla('En este inmueble vive un arrendatario: propón una hora y él deberá aceptarla.', 409);
      if (!citaVigente) return falla('Esta visita ya no se puede cambiar (ya pasó o fue cancelada).', 409);
      const fecha = String(body.fecha || '');
      const hora = String(body.hora || '').slice(0, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return falla('Fecha u hora inválida.');
      if (fecha < ahora.fecha || fecha > sumarDias(ahora.fecha, 60)) return falla('Elige una fecha dentro de los próximos 60 días.');
      if (fecha === cita.fecha && hora === horaCita) return falla('Esa ya es la hora de tu visita.');

      const elegido = await slotValido(admin, cita, fecha, hora);
      if (!elegido) return falla('Ese horario ya no está disponible. Elige otro.', 409);
      // Condición en el UPDATE: si alguien más cambió/canceló la cita entre tanto, no se pisa.
      const { data: movida, error: errMover } = await admin
        .from('agenda_citas')
        .update({
          fecha,
          hora_inicio: elegido.hora_inicio,
          hora_fin: elegido.hora_fin,
          asesor_id: elegido.asesor_id,
          ...LIMPIAR_REUBICACION,
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .eq('fecha', cita.fecha)
        .eq('hora_inicio', cita.hora_inicio)
        .select('id')
        .maybeSingle();
      if (errMover && /ya no está disponible/i.test(errMover.message)) return falla('Ese horario acaba de ser tomado por otra persona. Elige otro.', 409);
      if (errMover || !movida) return falla('No se pudo cambiar la visita. Actualiza la página e inténtalo de nuevo.', 409);
      if (rentando) await registrarAccion(admin, ctx, 'cita_reubicada', { de: { fecha: cita.fecha, hora: horaCita }, a: { fecha, hora } });
      await admin
        .from('agenda_cita_propuestas')
        .update({ estado: 'expirada', respondido_en: new Date().toISOString() })
        .eq('cita_id', cita.id)
        .eq('estado', 'pendiente');
      // Cliente (confirmación con la hora nueva) y propietario por los correos de siempre.
      await fetch(`${SUPABASE_URL}/functions/v1/notificar-cambio-cita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
        body: JSON.stringify({ cita_id: cita.id, accion: 'movida', origen: 'cliente', sin_aviso_arrendatario: rentando }),
      }).catch(() => {});
      return json({
        ok: true,
        cita: { fecha, hora_inicio: elegido.hora_inicio.slice(0, 5), hora_fin: elegido.hora_fin.slice(0, 5), estado: 'confirmada', vigente: true },
      });
    }

    // -------------------------------------------------------- guardar_horario
    if (accion === 'guardar_horario') {
      if (rol !== 'arrendatario') return falla('Esta acción no está disponible desde este enlace.', 403);
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
      await registrarAccion(admin, ctx, 'horario_actualizado', {
        antes: anterior,
        despues: resumenHorario({ dias_visita_permitidos: dias, hora_visita_desde: desde, hora_visita_hasta: hasta }),
      });

      // Visitas futuras de este inmueble que quedaron fuera del nuevo horario: se respetan (el
      // cliente ya las tiene confirmadas); el arrendatario puede proponer otra hora desde su correo.
      const { data: futuras } = await admin
        .from('agenda_citas')
        .select('id, fecha, hora_inicio, hora_fin')
        .eq('inmueble_id', inmueble.id)
        .eq('tipo_cita', 'visita_cliente')
        .neq('estado', 'cancelada')
        .gte('fecha', ahora.fecha);
      const fuera = (futuras || []).filter((c) => {
        if (c.fecha === ahora.fecha && c.hora_inicio.slice(0, 5) <= ahora.hora) return false;
        const dow = new Date(c.fecha + 'T12:00:00Z').getUTCDay() || 7;
        return !dias.includes(dow) || c.hora_inicio.slice(0, 5) < desde || c.hora_fin.slice(0, 5) > hasta;
      });
      return json({
        ok: true,
        inmueble: { dias_permitidos: dias, desde, hasta },
        fuera_de_horario: fuera.length,
        esta_fuera: fuera.some((c) => c.id === cita.id),
      });
    }

    return falla('Acción no reconocida.');
  } catch (e) {
    console.error('portal-visita', accion, e instanceof Error ? e.message : e);
    return falla('Algo salió mal. Inténtalo de nuevo en unos minutos.', 500);
  }
});
