// Estado de la confirmación de asistencia del arrendatario en la tarjeta de una visita a un inmueble arrendado.
// El arrendatario confirma con el botón «Confirmo que estaré» de su correo o de su portal (sql/048).
// Si faltan menos de 24 h para la visita y sigue sin confirmar, la etiqueta se destaca para que el asesor lo llame.

const HORAS_ALERTA = 24;

const escapar = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// Las citas guardan fecha y hora «de pared» de Bogotá; el navegador del asesor está en la misma zona.
export function horasParaVisita(c, ahora = new Date()) {
  const inicio = new Date(`${c.fecha}T${String(c.hora_inicio || '').slice(0, 5)}:00`);
  if (Number.isNaN(inicio.getTime())) return null;
  return (inicio.getTime() - ahora.getTime()) / 3600000;
}

export function htmlConfirmacionArrendatario(c, ahora = new Date()) {
  if (!c || c.estado !== 'confirmada') return '';
  const horas = horasParaVisita(c, ahora);
  if (horas === null || horas <= 0) return '';
  if (c.arrendatario_confirmado_en) {
    const cuando = new Date(c.arrendatario_confirmado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    return `<p class="v-confirma v-confirma-ok" role="status">✅ Arrendatario confirmó <span>(${escapar(cuando)})</span></p>`;
  }
  if (horas < HORAS_ALERTA) {
    return `<p class="v-confirma v-confirma-alerta" role="alert">⏳ <strong>Arrendatario sin confirmar</strong> y la visita es en menos de 24 horas. <strong>Llámalo para confirmar.</strong></p>`;
  }
  return `<p class="v-confirma v-confirma-pendiente">⏳ Arrendatario sin confirmar <span>(le llega un recordatorio 24 horas antes)</span></p>`;
}
