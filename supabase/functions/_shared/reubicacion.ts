// Visita «pendiente de nuevo horario»: reglas y textos de los correos cuando quien ocupa un inmueble arrendado NO puede
// recibir una visita ya agendada. El cambio es OBLIGATORIO (no una propuesta opcional): el cliente tiene un plazo (proporcional a lo lejos que está la visita) para elegir
// otra hora y, si no lo hace, la visita se cancela sola; mientras tanto el horario original queda libre. Módulo puro (sin red): lo usan portal-visita y notificar-cambio-cita,
// y se prueba con `node --test tests/reubicacion.test.mjs`. Ver reports/Visita cuando el arrendatario no puede.md.
// Plazo proporcional a la distancia de la visita: cuanto más lejos esté, más tiempo tiene el cliente (mitad del tiempo que falta,
// entre 24 h y 7 días); si la visita está cerca, el plazo es corto. El horario original queda LIBRE desde el primer momento
// (las consultas de disponibilidad ignoran las visitas con reubicacion_pendiente_desde, sql/034).
export const HORAS_PLAZO_MIN = 24; // visita a 48 h o más: nunca menos de 24 h de plazo
export const HORAS_PLAZO_MAX = 168; // 7 días
export const MARGEN_VISITA_LEJANA_H = 24; // visita a 48 h o más: el plazo vence al menos 24 h antes
export const MARGEN_ANTES_DE_VISITA_H = 2; // visita cercana (< 48 h): el plazo vence al menos 2 h antes
export const HORAS_CERCANA = 48;
export const MAX_DIAS_PAUSA = 14;

export type MotivoReubicacion = 'dia_no_disponible' | 'otra_hora' | 'pausa';

const H = 3_600_000;
const MIN = 60_000;

// Momento (ms) en que vence el plazo del cliente para elegir nueva hora. T = horas que faltan para la visita original:
//   T >= 48 h: plazo = T / 2, entre 24 h y 7 días, y nunca después de (visita − 24 h).
//   T <  48 h: plazo = el mayor entre T / 2 y 24 h, sin pasar de (visita − 2 h), con piso de 1 h para leer el correo.
// Ejemplos: visita en 17 días → 7 días; en 3 días → 36 h; en 30 h → 24 h; mañana (20 h) → 10 h. Nunca después de que empiece la visita.
export function calcularVencimientoBase(ahoraMs: number, inicioVisitaMs: number): number {
  const horasHasta = (inicioVisitaMs - ahoraMs) / H;
  let vence: number;
  if (horasHasta >= HORAS_CERCANA) {
    const plazo = Math.min(HORAS_PLAZO_MAX, Math.max(HORAS_PLAZO_MIN, horasHasta / 2));
    vence = Math.min(ahoraMs + plazo * H, inicioVisitaMs - MARGEN_VISITA_LEJANA_H * H);
  } else {
    const plazo = Math.max(horasHasta / 2, horasHasta >= 24 ? HORAS_PLAZO_MIN : 0);
    vence = Math.min(ahoraMs + plazo * H, inicioVisitaMs - MARGEN_ANTES_DE_VISITA_H * H);
  }
  if (vence < ahoraMs + H) vence = ahoraMs + H;
  return Math.min(vence, inicioVisitaMs);
}

// Horario hábil de los vencimientos: nadie debería perder su visita porque el plazo terminó de madrugada. Hora de Bogotá (UTC−5, sin horario de verano).
export const HORA_HABIL_DESDE = 8;
export const HORA_HABIL_HASTA = 20;
const HORAS_MIN_AL_ADELANTAR = 3; // al adelantar un vencimiento nocturno, que quede al menos este tiempo útil

// Si el vencimiento cae fuera de 8:00–20:00, se pasa al 20:00 anterior (siempre que deje al menos 3 h de plazo) o, si no,
// a las 8:00 siguientes (si todavía queda antes del límite). Si ninguna cabe (visita muy cercana), se deja como está.
export function ajustarAHorarioHabil(venceMs: number, ahoraMs: number, limiteMs: number): number {
  const local = new Date(venceMs - 5 * H);
  const horaDecimal = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (horaDecimal >= HORA_HABIL_DESDE && horaDecimal <= HORA_HABIL_HASTA) return venceMs;
  const medianoche = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 5 * H; // 00:00 Bogotá de ese día, en ms
  const antes = horaDecimal > HORA_HABIL_HASTA ? medianoche + HORA_HABIL_HASTA * H : medianoche - 24 * H + HORA_HABIL_HASTA * H;
  const despues = horaDecimal < HORA_HABIL_DESDE ? medianoche + HORA_HABIL_DESDE * H : medianoche + 24 * H + HORA_HABIL_DESDE * H;
  if (antes >= ahoraMs + HORAS_MIN_AL_ADELANTAR * H) return antes;
  if (despues <= limiteMs) return despues;
  return venceMs;
}

export function calcularVencimiento(ahoraMs: number, inicioVisitaMs: number): number {
  const base = calcularVencimientoBase(ahoraMs, inicioVisitaMs);
  const horasHasta = (inicioVisitaMs - ahoraMs) / H;
  const limite = inicioVisitaMs - (horasHasta >= HORAS_CERCANA ? MARGEN_VISITA_LEJANA_H : MARGEN_ANTES_DE_VISITA_H) * H;
  return Math.min(ajustarAHorarioHabil(base, ahoraMs, limite), inicioVisitaMs);
}

// Cuánto antes del vencimiento va el último recordatorio: 24 h si el plazo es largo (2 días o más), 2 h si es corto.
export const horasUltimoRecordatorio = (desdeMs: number, venceMs: number) => ((venceMs - desdeMs) / H >= 48 ? 24 : 2);

// Si falta menos de 24 h para la visita, el correo no basta: el asesor debe llamar de inmediato.
export const requiereLlamada = (ahoraMs: number, inicioVisitaMs: number) => inicioVisitaMs - ahoraMs < 24 * H;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// «jueves 29 de octubre, 3:00 p. m.» en hora de Bogotá (fecha absoluta: nadie tiene que calcular «dentro de 24 horas»).
export function formatearMomento(ms: number): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const dia = DIAS[new Date(Date.UTC(g('year'), g('month') - 1, g('day'), 12)).getUTCDay()];
  const h = g('hour');
  return `${dia} ${g('day')} de ${MESES[g('month') - 1]}, ${h % 12 === 0 ? 12 : h % 12}:${String(g('minute')).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

export function esc(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface DatosCorreoCliente {
  nombre: string;
  lugar: string; // dirección ya limpia; puede ir vacía
  visitaOriginal: string; // «jueves 29 de octubre, 3:00 p. m.»
  vence: string; // formatearMomento(vence)
  sugerencia?: string; // hora que propone el arrendatario, si propuso una
  asesor?: { nombre: string; celular?: string } | null;
  enlace: string;
}
export interface CorreoListo {
  asunto: string;
  titulo: string;
  cuerpo: string; // HTML ya escapado
  boton: { texto: string; url: string };
}

const P = 'margin:0 0 12px;text-align:left';
const contactoAsesor = (a?: { nombre: string; celular?: string } | null) =>
  a?.nombre ? `<p style="${P}">¿Dudas? Escríbele o llama a tu asesor, <b>${esc(a.nombre)}</b>${a.celular ? ` (${esc(a.celular)})` : ''}.</p>` : '';

// Correo 1: el cliente debe elegir nueva hora antes del plazo; sin respuesta, se cancela.
export function correoClienteNuevoHorario(d: DatosCorreoCliente): CorreoListo {
  const donde = d.lugar ? ` (${esc(d.lugar)})` : '';
  return {
    asunto: `Tu visita necesita una nueva hora: elígela antes del ${d.vence}`,
    titulo: 'Necesitamos cambiar la hora de tu visita',
    cuerpo: `<p style="${P}">Hola ${esc(d.nombre)}. Quien ocupa el inmueble${donde} no puede recibirte el <b>${esc(d.visitaOriginal)}</b>.</p>
${d.sugerencia ? `<p style="${P}">Te propone esta hora: <b>${esc(d.sugerencia)}</b>; puedes aceptarla o elegir otra que te quede mejor.</p>` : ''}<p style="${P}"><b>Qué debes hacer:</b> entra y elige una nueva hora antes del <b>${esc(d.vence)}</b></p>
<p style="${P}">El horario anterior ya quedó libre: no vayas al inmueble a la hora original.</p>
<p style="${P}"><b>Si no eliges otra hora:</b> la visita se cancelará.</p>
${contactoAsesor(d.asesor)}`,
    boton: { texto: 'Elegir nueva hora', url: d.enlace },
  };
}

// Correo 2: recordatorio (a mitad del plazo y 2 h antes de que venza).
export function correoClienteRecordatorio(d: DatosCorreoCliente): CorreoListo {
  return {
    asunto: `Recordatorio: elige una nueva hora para tu visita antes del ${d.vence}`,
    titulo: 'Aún falta elegir la hora de tu visita',
    cuerpo: `<p style="${P}">Hola ${esc(d.nombre)}, todavía no has elegido una nueva hora para tu visita, que estaba para el <b>${esc(d.visitaOriginal)}</b>, porque quien vive en el inmueble no puede recibirte a esa hora.</p>
<p style="${P}"><b>Tienes hasta el ${esc(d.vence)}</b> para elegir. Después de ese momento la visita se cancela automáticamente (el horario original ya no está reservado para ti).</p>
${contactoAsesor(d.asesor)}`,
    boton: { texto: 'Elegir nueva hora', url: d.enlace },
  };
}

// Texto del recuadro para el arrendatario en el correo «visita programada» (avisar-arrendatario).
export const OPCIONES_ARRENDATARIO = {
  intro: 'Ya agendamos la visita dentro de los días y horas que nos indicaste. Si todo está bien, no tienes que hacer nada. Si no puedes recibirla, dinos cuál de estas opciones es la tuya:',
  otraHora: { titulo: 'Puedo, pero a otra hora', detalle: 'Eliges la hora que sí te sirve y se la ofrecemos a la persona interesada.' },
  diaNoPuedo: { titulo: 'No puedo ese día', detalle: 'Marcas el día (o varios) y las franjas en que sí puedes.' },
  pausa: { titulo: 'No puedo recibir visitas por un tiempo', detalle: 'Pausas las visitas hasta por 14 días.' },
  consecuencia: 'En cualquiera de los tres casos le pedimos a la persona interesada que elija otra hora y le damos un plazo. Si no la elige, la visita se cancela sola. Tu horario queda libre desde ya y tú no tienes que hacer nada más.',
};
