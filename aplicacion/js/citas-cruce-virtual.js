// Agendar sobre un horario ocupado (con advertencia y confirmación) y reuniones virtuales de una cita.
// Módulo aparte de agenda-real.js: este archivo solo habla con Supabase y devuelve datos o HTML; agenda-real.js decide cuándo llamarlo.
// Reglas (en la base, sql/030): agenda_conflictos_cita dice qué choca; agenda_crear_cita_interna / agenda_mover_cita con
// p_forzar=true agendan igual y dejan la cita marcada como «cruce autorizado». Si la empresa no lo permite a asesores, la base rechaza.
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Clave que identifica «este horario concreto»; la confirmación de cruce solo vale para la clave que se confirmó.
export function claveHorario({ asesorId, inmuebleId, fecha, hora, duracion }) {
  return [asesorId, inmuebleId, fecha, hora, duracion || ''].join('|');
}

export async function revisarCruce({ empresaId, asesorId, inmuebleId, fecha, hora, duracion }) {
  const { data, error } = await supabase.rpc('agenda_conflictos_cita', {
    p_empresa_id: empresaId,
    p_asesor_id: asesorId,
    p_inmueble_id: inmuebleId || null,
    p_fecha: fecha,
    p_hora_inicio: hora,
    p_duracion_minutos: duracion ? Number(duracion) : null,
  });
  if (error) return { libre: true, puedeCruzar: false, conflictos: [], falloConsulta: true }; // si la consulta falla, decide la base al guardar
  return { libre: !!data.libre, puedeCruzar: !!data.puede_cruzar, conflictos: data.conflictos || [] };
}

// Panel de advertencia. horaFmt es el formateador de hora de la agenda (12 h / 24 h según la empresa).
export function htmlAvisoCruce(cruce, horaFmt) {
  const lista = cruce.conflictos.map((c) => `<li>${esc(c.detalle)}${c.hora_inicio ? ` (${esc(horaFmt(c.hora_inicio))}–${esc(horaFmt(c.hora_fin))})` : ''}</li>`).join('');
  return `<div class="v-cancelbox" role="alert" style="margin:12px 0"><p style="margin:0 0 6px;font-weight:600">⚠️ Ese horario está ocupado</p><ul style="margin:0 0 8px 18px">${lista}</ul>
    ${cruce.puedeCruzar
      ? `<p class="v-note" style="margin:0 0 8px">Puedes agendar de todos modos. Quedará registrado que tú autorizaste el cruce.</p><div class="v-actions"><button type="button" class="v-primary" data-cruce-confirmar>Agendar de todos modos</button><button type="button" data-cruce-cambiar>Elegir otra hora</button></div>`
      : `<p class="v-note" style="margin:0 0 8px">Tu empresa solo permite a los administradores agendar sobre un horario ocupado. Elige otra hora.</p><div class="v-actions"><button type="button" data-cruce-cambiar>Elegir otra hora</button></div>`}
  </div>`;
}

// ¿Puede el usuario actual agendar sobre un horario ocupado? (para mostrar el botón «Mover de todos modos»)
export async function puedeCruzar(empresaId) {
  const { data } = await supabase.rpc('agenda_puede_cruzar', { p_empresa_id: empresaId });
  return data === true;
}

// ---- Reuniones virtuales ------------------------------------------------------------------------------
const cacheProveedor = new Map();
export async function estadoReunion(empresaId) {
  if (cacheProveedor.has(empresaId)) return cacheProveedor.get(empresaId);
  const { data } = await supabase.rpc('agenda_videollamada_estado', { p_empresa_id: empresaId });
  const estado = { proveedor: data?.proveedor || 'manual', tieneCredenciales: !!data?.tiene_credenciales };
  cacheProveedor.set(empresaId, estado);
  return estado;
}
export function olvidarEstadoReunion() { cacheProveedor.clear(); }

// Campos del formulario de actividad. it = state.interna (virtual: boolean, enlace: string).
export function htmlCampoReunion(it, estado) {
  const automatico = estado.proveedor !== 'manual' && estado.tieneCredenciales;
  return `<label class="v-check"><input type="checkbox" id="v-interna-virtual" ${it.virtual ? 'checked' : ''}> Reunión virtual (videollamada)</label>
    ${it.virtual ? (automatico
      ? '<p class="v-note">El enlace de la reunión se crea automáticamente al guardar y queda en la cita.</p>'
      : `<label class="v-field" for="v-interna-enlace">Enlace de la reunión<input class="v-input" id="v-interna-enlace" type="url" placeholder="https://meet.google.com/…" value="${esc(it.enlace || '')}"></label>`) : ''}`;
}

// Crea el enlace automático para una cita ya guardada. Nunca lanza: devuelve {ok, enlace?, error?}.
export async function crearEnlaceReunion(citaId) {
  try {
    const { data, error } = await supabase.functions.invoke('crear-videollamada', { body: { cita_id: citaId } });
    if (error || !data?.ok) return { ok: false, error: data?.error || 'No se pudo crear el enlace.' };
    return { ok: true, enlace: data.enlace };
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servicio de reuniones.' };
  }
}

export function htmlEnlaceReunion(cita) {
  if (!cita.enlace_virtual) return cita.modalidad === 'virtual' ? '<span class="v-tag v-tag-neutral" style="margin-top:6px">Reunión virtual (sin enlace)</span>' : '';
  const url = /^https?:\/\//i.test(cita.enlace_virtual) ? cita.enlace_virtual : '';
  return url ? `<a class="v-link" href="${esc(url)}" target="_blank" rel="noopener">Unirse a la reunión virtual</a>` : '';
}
