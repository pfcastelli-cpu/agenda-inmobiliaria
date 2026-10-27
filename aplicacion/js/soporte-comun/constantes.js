// Vocabulario del soporte, compartido por la pestaña de cada empresa (tickets.js), la consola /soporte (soporte.js) y la campana.
// Cualquier texto o color de estado, prioridad o calificación se cambia SOLO aquí.
export const TIPOS = { error: 'Algo no funciona', mejora: 'Una mejora', duda: 'Una duda' };
export const EMOJI_TIPO = { error: '🐞', mejora: '💡', duda: '❓' };

// Lo que ve quien escribió el ticket / lo que ve el equipo de soporte.
export const ESTADOS_USUARIO = { abierto: 'Abierto', en_revision: 'En revisión', en_espera: 'Esperando tu respuesta', resuelto: 'Resuelto', cerrado: 'Cerrado', descartado: 'Descartado' };
export const ESTADOS_EQUIPO = { abierto: 'Abierto', en_revision: 'En revisión', en_espera: 'Esperando al usuario', resuelto: 'Resuelto', cerrado: 'Cerrado', descartado: 'Descartado' };
export const COLOR_ESTADO = { abierto: '#B26A00', en_revision: '#1A2C45', en_espera: '#7C3AED', resuelto: '#059669', cerrado: '#6B7785', descartado: '#6B7785' };
// Estados que no se pueden reabrir escribiendo en el ticket.
export const ESTADOS_FINALES = ['cerrado', 'descartado'];
// Estados en los que el equipo todavía tiene que actuar.
export const ESTADOS_POR_ATENDER = ['abierto', 'en_revision'];

export const PRIORIDADES = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export const COLOR_PRIORIDAD = { baja: '#6B7785', normal: '#1A2C45', alta: '#B26A00', urgente: '#B3261E' };

export const PUNTOS = { 1: 'Muy mala', 2: 'Mala', 3: 'Regular', 4: 'Buena', 5: 'Excelente' };

// Misma tabla que public.agenda_ticket_sla_horas (sql/024): horas corridas para la primera respuesta.
export const SLA_HORAS = { urgente: 2, alta: 8, normal: 24, baja: 48 };

// Un ticket ya se puede calificar cuando soporte respondió (o quedó resuelto/cerrado). Espeja la regla de agenda_ticket_calificar (sql/025).
export function sePuedeCalificar(t) {
  return Boolean(t.primera_respuesta_en) || t.estado === 'resuelto' || t.estado === 'cerrado';
}
