// Visita «pendiente de nuevo horario»: reglas y textos de los correos cuando quien ocupa un inmueble arrendado NO puede
// recibir una visita ya agendada. El cambio es OBLIGATORIO (no una propuesta opcional): el cliente tiene un plazo para elegir
// otra hora y, si no lo hace, la visita se cancela sola. Módulo puro (sin red): lo usan portal-visita y notificar-cambio-cita,
// y se prueba con `node --test tests/reubicacion.test.mjs`. Ver reports/Visita cuando el arrendatario no puede.md.
export const HORAS_PLAZO_CORTO = 24; // visita a menos de 5 días
export const HORAS_PLAZO_LARGO = 48; // visita a 5 días o más
export const DIAS_PARA_PLAZO_LARGO = 5;
export const MARGEN_ANTES_DE_VISITA_H = 2; // el plazo vence siempre antes de la visita original
export const MAX_DIAS_PAUSA = 14;

export type MotivoReubicacion = 'dia_no_disponible' | 'otra_hora' | 'pausa';

const H = 3_600_000;
const MIN = 60_000;

// Momento (ms) en que vence el plazo del cliente para elegir nueva hora. Siempre antes de la visita original:
// el menor entre (ahora + 24 h, o 48 h si la visita está a 5 días o más) y (visita − 2 h), con piso de 1 h para que
// haya tiempo de leer el correo, y nunca después de que empiece la visita.
export function calcularVencimiento(ahoraMs: number, inicioVisitaMs: number): number {
  const horasHasta = (inicioVisitaMs - ahoraMs) / H;
  const plazo = horasHasta >= DIAS_PARA_PLAZO_LARGO * 24 ? HORAS_PLAZO_LARGO : HORAS_PLAZO_CORTO;
  let vence = Math.min(ahoraMs + plazo * H, inicioVisitaMs - MARGEN_ANTES_DE_VISITA_H * H);
  if (vence < ahoraMs + H) vence = ahoraMs + H;
  return Math.min(vence, inicioVisitaMs);
}

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

const P = 'margin:0 0 10px;text-align:justify';
const contactoAsesor = (a?: { nombre: string; celular?: string } | null) =>
  a?.nombre ? `<p style="${P}">¿Dudas? Escríbele o llama a tu asesor, <b>${esc(a.nombre)}</b>${a.celular ? ` (${esc(a.celular)})` : ''}.</p>` : '';

// Correo 1: el cliente debe elegir nueva hora antes del plazo; sin respuesta, se cancela.
export function correoClienteNuevoHorario(d: DatosCorreoCliente): CorreoListo {
  const donde = d.lugar ? ` (${esc(d.lugar)})` : '';
  return {
    asunto: `Tu visita necesita una nueva hora: elígela antes del ${d.vence}`,
    titulo: 'Necesitamos cambiar la hora de tu visita',
    cuerpo: `<p style="${P}">Hola ${esc(d.nombre)}, quien vive en el inmueble${donde} no puede recibirte el <b>${esc(d.visitaOriginal)}</b>, y lamentamos el inconveniente. No depende de ti: necesitamos fijar otra hora.</p>
${d.sugerencia ? `<p style="${P}">Te propone esta hora: <b>${esc(d.sugerencia)}</b>; puedes aceptarla o elegir otra que te quede mejor.</p>` : ''}<p style="${P}"><b>Qué debes hacer:</b> entra y elige una nueva hora antes del <b>${esc(d.vence)}</b></p>
<p style="${P}"><b>Si no lo haces:</b> la visita se cancelará y ese horario quedará libre para otras personas. No vayas al inmueble a la hora original: nadie podrá recibirte.</p>
<p style="${P}">Si ya no te interesa el inmueble, no tienes que hacer nada más: la visita se cancelará sola en esa fecha.</p>
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
<p style="${P}"><b>Tienes hasta el ${esc(d.vence)}</b> para elegir. Después de ese momento la visita se cancela automáticamente y el horario queda libre.</p>
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
  consecuencia: 'En cualquiera de los tres casos le pedimos a la persona interesada que elija otra hora y le damos un plazo. Si no la elige, la visita se cancela sola: tú no tienes que hacer nada más.',
};
