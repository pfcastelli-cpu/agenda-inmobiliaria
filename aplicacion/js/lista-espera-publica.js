// Lista de espera de la página pública de reserva: cuando un inmueble ya llenó su tope de citas (sql/035), en lugar de horarios se muestra este
// formulario. El navegador solo pregunta y envía; la regla (tope, lista) vive en la base.
import { supabase } from './cliente-supabase.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function agendaLlena(numero, host) {
  const { data } = await supabase.rpc('agenda_agenda_llena_publica', { p_numero_inmueble: numero, p_host: host });
  return data === true;
}

export function htmlListaEspera(estado) {
  if (estado.enviada) {
    return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>¡Quedaste en la lista de espera!</h2><p>Te escribiremos al correo que dejaste si se libera un turno para este inmueble.</p></div>`;
  }
  return `<div class="pu-card"><h2>Este inmueble tiene la agenda completa</h2>
    <p>Recibió muchísimas solicitudes de visita y por ahora no hay turnos disponibles. Déjanos tus datos y te avisamos si se libera uno.</p>
    <form id="pu-form-espera">
      <label for="pu-esp-nombre">Nombre y apellido</label><input id="pu-esp-nombre" type="text" required value="${esc(estado.nombre || '')}">
      <label for="pu-esp-tel">Celular</label><input id="pu-esp-tel" type="tel" required value="${esc(estado.telefono || '')}">
      <label for="pu-esp-correo">Correo electrónico</label><input id="pu-esp-correo" type="email" required value="${esc(estado.correo || '')}">
      <div class="pu-error" role="alert" style="${estado.error ? '' : 'display:none'}">${esc(estado.error)}</div>
      <button class="pu-main" type="submit" ${estado.enviando ? 'disabled' : ''}>${estado.enviando ? 'Enviando…' : 'Avisarme si se libera un turno'}</button>
    </form></div>`;
}

// Devuelve {ok, error?}. host = window.location.hostname.
export async function unirseListaEspera(numero, host, nombre, telefono, correo) {
  const { error } = await supabase.rpc('agenda_lista_espera_unirse', { p_numero_inmueble: numero, p_nombre: nombre, p_telefono: telefono, p_email: correo, p_host: host });
  return error ? { ok: false, error: /nombre|celular|correo/i.test(error.message || '') ? error.message : 'No se pudo guardar. Inténtalo de nuevo.' } : { ok: true };
}
