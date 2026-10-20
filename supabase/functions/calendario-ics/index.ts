// Edge Function: calendario-ics
// Entrega una agenda en formato iCalendar (.ics) para suscribirse desde Google Calendar,
// Outlook/Microsoft 365, Apple Calendar, etc. (funciona igual con cualquiera: no depende
// de ninguna API de Google ni de Microsoft, y no tiene costo).
//   GET ?t=<token>
//     - token de un asesor  -> solo sus citas
//     - token de la empresa -> las citas de todos los asesores (el título lleva el nombre
//       del asesor; cada asesor también tiene su propio enlace para verlo con otro color)
// verify_jwt = false: los calendarios no pueden enviar cabeceras de autenticación, el token
// secreto de la URL es la credencial.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ZONA = 'America/Bogota'; // Colombia no tiene horario de verano
const DIAS_ATRAS = 30;
const DIAS_ADELANTE = 180;

function esc(t: string | null | undefined): string {
  return String(t ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Las líneas iCalendar no deben pasar de 75 octetos; se parten con CRLF + espacio.
function plegar(linea: string): string {
  const enc = new TextEncoder();
  if (enc.encode(linea).length <= 75) return linea;
  const partes: string[] = [];
  let actual = '';
  for (const ch of linea) {
    const limite = partes.length === 0 ? 75 : 74;
    if (enc.encode(actual + ch).length > limite) {
      partes.push(actual);
      actual = ch;
    } else actual += ch;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}

function fechaHora(fecha: string, hora: string): string {
  return fecha.replace(/-/g, '') + 'T' + hora.slice(0, 8).replace(/:/g, '');
}

function sello(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('t')?.trim();
  if (!token || !/^[a-f0-9]{16,64}$/.test(token)) {
    return new Response('Enlace inválido.', { status: 404 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let empresaId: string;
  let asesorFiltro: { id: string; nombre: string } | null = null;
  let nombreCalendario: string;

  const { data: asesor } = await admin
    .from('agenda_asesores')
    .select('id, nombre, empresa_id')
    .eq('calendario_token', token)
    .maybeSingle();
  if (asesor) {
    empresaId = asesor.empresa_id;
    asesorFiltro = { id: asesor.id, nombre: asesor.nombre };
    nombreCalendario = `Citas · ${asesor.nombre}`;
  } else {
    const { data: cfg } = await admin
      .from('agenda_configuracion')
      .select('empresa_id, nombre_comercial')
      .eq('calendario_token', token)
      .maybeSingle();
    if (!cfg) return new Response('Enlace inválido.', { status: 404 });
    empresaId = cfg.empresa_id;
    nombreCalendario = `Citas · ${cfg.nombre_comercial || 'Todas las agendas'}`;
  }

  const hoy = new Date();
  const desde = new Date(hoy.getTime() - DIAS_ATRAS * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(hoy.getTime() + DIAS_ADELANTE * 86400000).toISOString().slice(0, 10);

  let consulta = admin
    .from('agenda_citas')
    .select(
      'id, asesor_id, inmueble_id, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_telefono, tipo_cita, titulo, direccion_libre, ciudad_libre, notas, estado, actualizado_en',
    )
    .eq('empresa_id', empresaId)
    .neq('estado', 'cancelada')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('hora_inicio')
    .limit(5000);
  if (asesorFiltro) consulta = consulta.eq('asesor_id', asesorFiltro.id);
  const { data: citas, error } = await consulta;
  if (error) return new Response('No se pudo generar el calendario.', { status: 500 });

  const idsInmuebles = [...new Set((citas || []).map((c) => c.inmueble_id).filter(Boolean))];
  const idsAsesores = [...new Set((citas || []).map((c) => c.asesor_id).filter(Boolean))];
  const inmuebles = new Map<string, { numero_inmueble: number; direccion: string; ciudad: string }>();
  const asesores = new Map<string, string>();
  if (idsInmuebles.length) {
    const { data } = await admin
      .from('agenda_inmuebles')
      .select('id, numero_inmueble, direccion, ciudad')
      .in('id', idsInmuebles);
    for (const i of data || []) inmuebles.set(i.id, i);
  }
  if (idsAsesores.length) {
    const { data } = await admin.from('agenda_asesores').select('id, nombre').in('id', idsAsesores);
    for (const a of data || []) asesores.set(a.id, a.nombre);
  }

  const lineas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Patrimonios//Agenda de citas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(nombreCalendario)}`,
    `X-WR-TIMEZONE:${ZONA}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE',
    `TZID:${ZONA}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'TZNAME:-05',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const ahora = sello(new Date());
  for (const c of citas || []) {
    const inm = c.inmueble_id ? inmuebles.get(c.inmueble_id) : undefined;
    const direccion = inm?.direccion || c.direccion_libre || '';
    const ciudad = inm?.ciudad || c.ciudad_libre || '';
    const nombreAsesor = asesores.get(c.asesor_id) || '';
    const base = inm
      ? `Visita #${inm.numero_inmueble}`
      : c.titulo || (c.tipo_cita === 'captacion' ? 'Captación' : 'Cita');
    const resumen = asesorFiltro ? base : `${nombreAsesor ? nombreAsesor + ' · ' : ''}${base}`;
    const descripcion = [
      `Asesor: ${nombreAsesor}`,
      c.cliente_nombre ? `Cliente: ${c.cliente_nombre}` : '',
      c.cliente_telefono ? `Teléfono: ${c.cliente_telefono}` : '',
      direccion ? `Dirección: ${direccion}${ciudad ? ', ' + ciudad : ''}` : '',
      c.notas ? `Notas: ${c.notas}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    lineas.push(
      'BEGIN:VEVENT',
      `UID:${c.id}@citas.patrimonios.co`,
      `DTSTAMP:${ahora}`,
      `LAST-MODIFIED:${sello(new Date(c.actualizado_en || hoy))}`,
      `DTSTART;TZID=${ZONA}:${fechaHora(c.fecha, c.hora_inicio)}`,
      `DTEND;TZID=${ZONA}:${fechaHora(c.fecha, c.hora_fin || c.hora_inicio)}`,
      `SUMMARY:${esc(resumen)}`,
      `DESCRIPTION:${esc(descripcion)}`,
      ...(direccion ? [`LOCATION:${esc(direccion + (ciudad ? ', ' + ciudad : ''))}`] : []),
      'END:VEVENT',
    );
  }
  lineas.push('END:VCALENDAR');

  return new Response(lineas.map(plegar).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline; filename="citas.ics"',
    },
  });
});
