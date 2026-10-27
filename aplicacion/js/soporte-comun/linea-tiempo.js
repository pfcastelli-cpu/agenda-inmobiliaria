// Arma la conversación de un ticket como una lista ordenada de elementos neutros (mensaje | nota | evento).
// Quien pinta (tickets.js o soporte.js) decide cómo se ve; aquí vive la regla de qué entra y en qué orden.
import { ESTADOS_EQUIPO, ESTADOS_USUARIO, PRIORIDADES } from './constantes.js';
import { estrellas } from './formato.js';

// t = ticket (fila), detalle = respuesta de agenda_ticket_detalle. Las notas internas solo vienen para soporte, y aun así
// solo se incluyen si se pide expresamente (conNotas): nunca por accidente.
export function construirLinea(t, detalle, { conNotas = false } = {}) {
  const items = [
    { clase: 'mensaje', tipo: 'solicitante', autor: t.usuario_nombre || '', texto: t.descripcion || '(Sin detalles)', cuando: t.creado_en },
    ...(detalle?.mensajes || []).map((m) => ({ clase: 'mensaje', tipo: m.tipo, autor: m.autor, texto: m.texto, cuando: m.creado_en })),
    ...(conNotas ? (detalle?.notas || []).map((n) => ({ clase: 'nota', tipo: 'nota', autor: n.autor, texto: n.texto, cuando: n.creado_en })) : []),
    ...(detalle?.eventos || []).filter((e) => e.tipo !== 'nota_interna').map((e) => ({ clase: 'evento', evento: e, cuando: e.creado_en })),
  ];
  return items.sort((a, b) => new Date(a.cuando) - new Date(b.cuando));
}

// Frase corta de un evento del historial; '' si no hay nada útil que decir. vista: 'usuario' | 'equipo'.
export function textoEvento(e, vista = 'usuario') {
  const estados = vista === 'equipo' ? ESTADOS_EQUIPO : ESTADOS_USUARIO;
  const d = e.detalle || {};
  switch (e.tipo) {
    case 'estado':
      return vista === 'equipo'
        ? `${e.actor}${d.auto ? ' (automático)' : ''}: «${estados[d.de] || d.de}» → «${estados[d.a] || d.a}»`
        : `${d.auto ? 'Automático: ' : ''}pasó a «${estados[d.a] || d.a}»`;
    case 'prioridad':
      return vista === 'equipo' ? `${e.actor}: prioridad ${PRIORIDADES[d.de] || d.de} → ${PRIORIDADES[d.a] || d.a}` : `Prioridad: ${PRIORIDADES[d.a] || d.a}`;
    case 'asignado':
      return d.a ? (vista === 'equipo' ? `${e.actor} tomó el ticket` : `Lo atiende ${d.a}`) : (vista === 'equipo' ? `${e.actor} soltó el ticket` : 'Quedó sin responsable');
    case 'reabierto':
      return 'Se reabrió el ticket';
    case 'calificado':
      return vista === 'equipo' ? `${e.actor} calificó la atención: ${estrellas(d.puntos)}` : `Calificó la atención: ${estrellas(d.puntos)}`;
    default:
      return '';
  }
}
