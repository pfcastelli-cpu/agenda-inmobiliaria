// Edge Function: portal-visita
// Acuerdo de horario de una visita a un inmueble "Rentando" entre el arrendatario (que vive
// adentro) y el cliente que visita. verify_jwt = false: el token secreto de la URL es la
// credencial (agenda_citas.token_arrendatario o token_cliente, uno por parte), como en
// calendario-ics. Cada parte solo ve lo suyo: el cliente nunca ve datos del arrendatario ni
// al revés. NO se avisa al asesor: la cita cambia sola en el sistema cuando hay acuerdo.
// Acciones (POST JSON { token, accion, ... }):
//   obtener          → cita, inmueble, asesor, propuesta pendiente
//   horarios         → { fecha } horas libres reales (mismo motor que la reserva pública)
//   proponer         → { fecha, hora } propone otra hora (reemplaza la propuesta pendiente)
//   responder        → { aceptar } la OTRA parte acepta (la cita pasa a la nueva hora) o rechaza
//   cancelar         → { motivo? } solo arrendatario; avisa al cliente
//   guardar_horario  → solo arrendatario: { dias:[1..7], desde, hasta } cuándo se muestra la vivienda
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, type MarcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';
const MAX_PROPUESTAS = 6; // por cita, entre las dos partes
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
type Rol = 'arrendatario' | 'cliente';

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
      'id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, estado, tipo_cita, cliente_nombre, cliente_email, token_arrendatario, token_cliente',
    )
    .or(`token_arrendatario.eq.${token},token_cliente.eq.${token}`)
    .maybeSingle();
  if (!cita || !cita.inmueble_id || cita.tipo_cita !== 'visita_cliente') return null;
  const rol: Rol = cita.token_arrendatario === token ? 'arrendatario' : 'cliente';
  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('id, numero_inmueble, direccion, barrio, ciudad, estado_crm, dias_visita_permitidos, hora_visita_desde, hora_visita_hasta, duracion_visita_minutos')
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
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, color_principal, color_accion',
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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">🧪 MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.destinatarioReal)}</div>` : ''}
<div style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 10px rgba(26,44,69,0.08)">
${encabezadoImagen(opts.marca, opts.titulo)}
<div style="padding:28px 26px">
<h1 style="color:${opts.marca.principal};font-size:20px;margin:0 0 12px">${esc(opts.titulo)}</h1>
<div style="color:#526575;font-size:14px;line-height:1.55">${opts.cuerpo}</div>
${opts.boton ? `<p style="margin:22px 0 0"><a href="${esc(opts.boton.url)}" style="display:inline-block;background:${opts.marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">${esc(opts.boton.texto)}</a></p>` : ''}
</div>
</div>
<p style="text-align:center;color:#66758a;font-size:11.5px;margin-top:18px">${esc(opts.remitente)}</p>
</div></body></html>`;
}

async function enviarCorreos(
  admin: Admin,
  empresaId: string,
  citaId: string,
  tipo: Rol,
  destinatarios: string[],
  asunto: string,
  armar: (extra: { destinatarioReal: string; modoPruebas: boolean; remitente: string; marca: MarcaCorreo }) => string,
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
  c: { cita: { id: string; empresa_id: string }; inmueble: { id: string } },
  accion: 'horario_actualizado' | 'cita_cancelada' | 'propuesta_creada' | 'propuesta_aceptada' | 'propuesta_rechazada',
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
  cita: { id: string; fecha: string; hora_inicio: string; estado: string },
  ahora: { fecha: string; hora: string },
) {
  const { data: p } = await admin
    .from('agenda_cita_propuestas')
    .select('id, propuesto_por, cita_fecha, cita_hora, fecha, hora_inicio, hora_fin, creado_en')
    .eq('cita_id', cita.id)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (!p) return null;
  const vencida = Date.now() - new Date(p.creado_en).getTime() > HORAS_VIGENCIA_PROPUESTA * 3600_000;
  const citaCambio = p.cita_fecha !== cita.fecha || p.cita_hora.slice(0, 5) !== cita.hora_inicio.slice(0, 5);
  const citaPasada = cita.fecha < ahora.fecha || (cita.fecha === ahora.fecha && cita.hora_inicio.slice(0, 5) <= ahora.hora);
  if (vencida || citaCambio || citaPasada || cita.estado === 'cancelada' || p.fecha < ahora.fecha) {
    await admin.from('agenda_cita_propuestas').update({ estado: 'expirada', respondido_en: new Date().toISOString() }).eq('id', p.id);
    return null;
  }
  return p;
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
  const { cita, inmueble, asesor, rol } = ctx;
  if (String(inmueble.estado_crm || '').trim().toLowerCase() !== 'rentando') {
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
        cuerpo: `<p style="margin:0 0 10px">Hola ${esc(nombre)},</p>${cuerpo}`,
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
        hoy: ahora.fecha,
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
              vence_horas: Math.max(1, Math.round(HORAS_VIGENCIA_PROPUESTA - (Date.now() - new Date(p.creado_en).getTime()) / 3600_000)),
            }
          : null,
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

      const nuevaLinea = `<b>${esc(formatearFecha(fecha))}, ${esc(formatearHora(hora))}</b>`;
      if (rol === 'arrendatario') {
        await avisarA(
          'cliente',
          `Propuesta de nuevo horario para tu visita · Inmueble ${inmueble.numero_inmueble}`,
          'Te proponen otra hora para tu visita',
          `<p style="margin:0 0 10px">El inmueble que vas a visitar${direccion ? ` (${esc(direccion)})` : ''} está actualmente arrendado y habitado, y el arrendatario no puede recibirte en el horario acordado.</p>
<p style="margin:0 0 10px">Tu visita sigue para ${lineaVisita}, pero propone esta otra hora:</p>
<p style="margin:0 0 10px;font-size:16px">${nuevaLinea}</p>
<p style="margin:0">Tu visita solo cambia si tú aceptas. Si no te sirve, puedes dejarla como está o proponer otra hora. La propuesta vence en ${HORAS_VIGENCIA_PROPUESTA} horas.</p>`,
          'Ver la propuesta',
        );
      } else {
        await avisarA(
          'arrendatario',
          `El interesado propone otra hora · Inmueble ${inmueble.numero_inmueble}`,
          'Te propusieron otra hora para la visita',
          `<p style="margin:0 0 10px">En respuesta a tu propuesta, la persona interesada en tu vivienda sugiere esta hora:</p>
<p style="margin:0 0 10px;font-size:16px">${nuevaLinea}</p>
<p style="margin:0">La visita sigue para ${lineaVisita} y solo cambia si tú aceptas. Puedes aceptar, o proponer otra hora. Vence en ${HORAS_VIGENCIA_PROPUESTA} horas.</p>`,
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
        await admin.from('agenda_cita_propuestas').update({ estado: 'rechazada', respondido_en: new Date().toISOString() }).eq('id', p.id).eq('estado', 'pendiente');
        await registrarAccion(admin, ctx, 'propuesta_rechazada', { por: rol });
        await avisarA(
          otraParte,
          `La propuesta de horario no fue aceptada · Inmueble ${inmueble.numero_inmueble}`,
          'La otra hora no se aceptó',
          `<p style="margin:0 0 10px">No fue aceptada la hora que propusiste. La visita sigue para ${lineaVisita}.</p>
<p style="margin:0">Si quieres, puedes proponer otra hora.</p>`,
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
          `<p style="margin:0 0 10px">La hora propuesta se ocupó antes de poder confirmarla. La visita sigue para ${lineaVisita}.</p><p style="margin:0">Puedes proponer otra hora.</p>`,
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
          actualizado_en: new Date().toISOString(),
        })
        .eq('id', cita.id)
        .eq('estado', 'confirmada')
        .eq('fecha', cita.fecha)
        .eq('hora_inicio', cita.hora_inicio)
        .select('id')
        .maybeSingle();
      if (errMover || !movida) return falla('No se pudo confirmar el cambio. Actualiza la página e inténtalo de nuevo.', 409);
      await admin.from('agenda_cita_propuestas').update({ estado: 'aceptada', respondido_en: new Date().toISOString() }).eq('id', p.id);
      await registrarAccion(admin, ctx, 'propuesta_aceptada', { acepto: rol, de: { fecha: cita.fecha, hora: horaCita }, a: { fecha: p.fecha, hora: p.hora_inicio.slice(0, 5) } });

      // En firme: el cliente recibe su confirmación de siempre (con la hora nueva), el
      // propietario su aviso y el arrendatario la suya. El asesor no recibe correo: ve la
      // cita en su agenda y en su calendario compartido.
      const cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY };
      for (const f of ['enviar-correo-cita', 'enviar-correo-propietario']) {
        fetch(`${SUPABASE_URL}/functions/v1/${f}`, { method: 'POST', headers: cabeceras, body: JSON.stringify({ cita_id: cita.id, sin_aviso_arrendatario: true }) }).catch(() => {});
      }
      const t = await correosArrendatario(admin, cita.empresa_id, inmueble.numero_inmueble);
      const nuevaLinea = `<b>${esc(formatearFecha(p.fecha))}, ${esc(formatearHora(p.hora_inicio.slice(0, 5)))}</b>${direccion ? ` en ${esc(direccion)}` : ''}`;
      await enviarCorreos(admin, cita.empresa_id, cita.id, 'arrendatario', t.correos, `Visita confirmada en nuevo horario · Inmueble ${inmueble.numero_inmueble}`, (extra) =>
        plantillaCorreo({
          titulo: 'La visita quedó en firme',
          cuerpo: `<p style="margin:0 0 10px">Hola ${esc(t.nombre)}, ambas partes aceptaron el cambio. La visita quedó para ${nuevaLinea}.</p><p style="margin:0">No tienes que hacer nada más.</p>`,
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
      if (rol !== 'arrendatario') return falla('Esta acción no está disponible desde este enlace.', 403);
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
      await admin
        .from('agenda_cita_propuestas')
        .update({ estado: 'expirada', respondido_en: new Date().toISOString() })
        .eq('cita_id', cita.id)
        .eq('estado', 'pendiente');
      await registrarAccion(admin, ctx, 'cita_cancelada', { fecha: cita.fecha, hora: horaCita, motivo });

      await enviarCorreos(admin, cita.empresa_id, cita.id, 'cliente', correosDe(cita.cliente_email).slice(0, 1), `Tu visita del ${formatearFecha(cita.fecha)} fue cancelada`, (extra) =>
        plantillaCorreo({
          titulo: 'Tu visita fue cancelada',
          cuerpo: `<p style="margin:0 0 10px">Hola ${esc(cita.cliente_nombre)}, lamentamos informarte que la visita del <b>${esc(formatearFecha(cita.fecha))}, ${esc(formatearHora(horaCita))}</b>${direccion ? ` al inmueble en ${esc(direccion)}` : ''} no se podrá realizar: el inmueble está arrendado y habitado, y en ese horario no es posible recibirte.</p>
<p style="margin:0">Puedes elegir otro horario cuando quieras${asesor?.nombre ? ` o escribirle a tu asesor, ${esc(asesor.nombre)}` : ''}.</p>`,
          boton: { texto: 'Agendar otro horario', url: `${SITIO_URL}/inmuebles/${inmueble.numero_inmueble}` },
          ...extra,
        }),
      );
      return json({ ok: true, cita: { fecha: cita.fecha, hora_inicio: horaCita, hora_fin: cita.hora_fin.slice(0, 5), estado: 'cancelada', vigente: false } });
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
