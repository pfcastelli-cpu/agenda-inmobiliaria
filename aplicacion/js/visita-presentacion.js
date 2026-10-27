// Presentación compartida. Los estados provienen del servidor; aquí no se decide disponibilidad.
export const escVisita = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function estadoVisita({ cita = {}, reubicacion = false, propuesta, arrendatario = false } = {}) {
  if (cita.estado === 'cancelada') return { tono: 'neutro', titulo: 'Visita cancelada', detalle: 'Este horario ya no está reservado.', anterior: true };
  if (cita.vigente === false) return { tono: 'neutro', titulo: 'Visita finalizada', detalle: 'Esta visita ya pasó.', anterior: true };
  if (reubicacion) return {
    tono: 'atencion', anterior: true,
    titulo: arrendatario ? 'Esperando al interesado' : 'Elige una nueva hora',
    detalle: arrendatario ? 'El horario anterior quedó libre. Te avisaremos cuando elija otro.' : 'La hora anterior ya no está disponible. Necesitas elegir otra para visitar el inmueble.',
  };
  if (propuesta) return {
    tono: 'atencion', anterior: false,
    titulo: propuesta.propuesta_por_mi ? 'Propuesta enviada' : 'Nueva hora propuesta',
    detalle: 'La visita conserva su horario actual hasta que se acepte la propuesta.',
  };
  return { tono: 'confirmada', titulo: 'Visita confirmada', detalle: 'La visita está programada en este horario.', anterior: false };
}

export function resumenVisita({ estado, numero, direccion, zona, fecha, hora, asesor }) {
  return `<section class="pu-card pu-visita-resumen" aria-label="Resumen de la visita">
    <div class="pu-estado pu-estado-${estado.tono}" role="status"><strong>${escVisita(estado.titulo)}</strong><span>${escVisita(estado.detalle)}</span></div>
    <p class="pu-referencia">Inmueble ${escVisita(numero)}</p>
    <h2>${escVisita(direccion || 'Tu visita')}</h2>
    ${zona ? `<p class="pu-ubicacion">${escVisita(zona)}</p>` : ''}
    <div class="pu-cuando ${estado.anterior ? 'pu-cuando-anterior' : ''}">
      <span>${estado.anterior ? 'Horario anterior' : 'Fecha y hora'}</span>
      <strong>${escVisita(fecha)}</strong><b>${escVisita(hora)}</b>
    </div>
    ${asesor?.nombre ? `<div class="pu-asesor"><span>Tu asesor</span><strong>${escVisita(asesor.nombre)}</strong>${asesor.celular ? `<a href="tel:${escVisita(String(asesor.celular).replace(/[^+\d]/g, ''))}">Llamar al asesor</a>` : ''}</div>` : ''}
  </section>`;
}

export function pasosReserva(paso) {
  return `<ol class="pu-pasos" aria-label="Pasos para reservar">${['Día', 'Hora', 'Tus datos'].map((nombre, i) => `<li ${i === paso ? 'aria-current="step"' : ''} class="${i < paso ? 'completo' : ''}"><span aria-hidden="true">${i < paso ? '✓' : i + 1}</span>${nombre}</li>`).join('')}</ol>`;
}
