// Página pública /preferencias/<token>: el propietario elige cuándo recibir correos de las visitas a sus inmuebles y si quiere publicidad.
// El token del enlace es la credencial; solo guarda las preferencias de ese correo (RPC agenda_preferencias_*, sql/032).
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');

const OPCIONES = [
  { valor: 'cada_cita', emoji: '📬', texto: 'Un correo con cada visita', detalle: 'Te avisamos apenas se agenda, cambia o cancela una visita a tu inmueble.' },
  { valor: 'semanal', emoji: '🗓️', texto: 'Un resumen cada semana', detalle: 'Un solo correo los lunes con lo que pasó con tus inmuebles.' },
  { valor: 'mensual', emoji: '📅', texto: 'Un resumen cada mes', detalle: 'Un solo correo el primer día de cada mes.' },
  { valor: 'ninguna', emoji: '🔕', texto: 'No quiero recibir correos de visitas', detalle: 'Podrás ver todo cuando quieras en el informe de tu inmueble.' },
];

const AVISOS = [
  { clave: 'nueva', texto: 'Cuando se agenda una visita nueva' },
  { clave: 'cambio', texto: 'Cuando una visita cambia de hora' },
  { clave: 'cancelacion', texto: 'Cuando se cancela una visita' },
];

const state = { token: null, paso: 'cargando', datos: null, frecuencia: 'cada_cita', publicidad: true, avisos: { nueva: true, cambio: true, cancelacion: true }, guardando: false, error: '' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/preferencias\/([0-9a-f-]{8,})/i);
  if (ruta) return ruta[1];
  return new URLSearchParams(window.location.search).get('token');
}

function vista() {
  if (state.paso === 'cargando') return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (state.paso === 'error') return `<div class="pu-error">${esc(state.error)}</div>`;
  if (state.paso === 'guardado') {
    return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>¡Listo, guardamos tus preferencias!</h2>
      <p>${esc(OPCIONES.find((o) => o.valor === state.frecuencia)?.texto || '')}${state.frecuencia === 'cada_cita' ? ` (${AVISOS.filter((a) => state.avisos[a.clave]).map((a) => a.texto.replace('Cuando ', '').replace('se agenda una visita nueva', 'visita nueva').replace('una visita cambia de hora', 'cambio de hora').replace('se cancela una visita', 'cancelación')).join(', ') || 'ningún aviso'})` : ''}${state.publicidad ? '' : ' · Sin publicidad'}.</p>
      <p style="margin-top:16px"><button type="button" class="pu-link" id="pu-editar">Cambiar de nuevo</button></p></div>`;
  }
  return `<div class="pu-card">
    <h2>¿Cómo quieres recibir los correos de tus inmuebles?</h2>
    ${state.datos?.correo ? `<p>Preferencias para <strong>${esc(state.datos.correo)}</strong>${state.datos.empresa ? ` · ${esc(state.datos.empresa)}` : ''}.</p>` : ''}
    <div class="pu-options" style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
      ${OPCIONES.map((o) => `<label class="pu-option" style="display:flex;gap:12px;align-items:flex-start;text-align:left;cursor:pointer"><input type="radio" name="frecuencia" value="${o.valor}" ${o.valor === state.frecuencia ? 'checked' : ''} style="margin-top:5px"><span><strong>${o.emoji} ${esc(o.texto)}</strong><br><small>${esc(o.detalle)}</small></span></label>`).join('')}
    </div>
    ${state.frecuencia === 'cada_cita' ? `<h3 style="margin-top:22px">¿De qué quieres que te avisemos?</h3>
    ${AVISOS.map((a) => `<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin:8px 0;min-height:32px"><input type="checkbox" data-aviso="${a.clave}" ${state.avisos[a.clave] ? 'checked' : ''} style="margin-top:4px"><span>${esc(a.texto)}</span></label>`).join('')}
    <p style="font-size:12.5px;color:#6b6b6b;margin-top:4px">Lo que desmarques no te llegará por correo, pero siempre podrás verlo en el informe de tu inmueble.</p>` : ''}
    <h3 style="margin-top:22px">Publicidad</h3>
    <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="pu-publicidad" ${state.publicidad ? 'checked' : ''} style="margin-top:4px"><span>Quiero recibir propuestas comerciales (por ejemplo, para consignar otro inmueble).</span></label>
    <p style="font-size:12.5px;color:#6b6b6b;margin-top:8px">Si la desmarcas, dejarás de ver publicidad en nuestros correos. Los avisos que elegiste arriba se mantienen.</p>
    <div class="pu-error" role="alert" style="${state.error ? '' : 'display:none'}">${esc(state.error)}</div>
    <button class="pu-main" id="pu-guardar" type="button" ${state.guardando ? 'disabled' : ''}>${state.guardando ? 'Guardando…' : 'Guardar mis preferencias'}</button>
  </div>`;
}

function render() {
  raiz.innerHTML = vista();
  raiz.querySelectorAll('input[name=frecuencia]').forEach((r) => r.addEventListener('change', () => { state.frecuencia = r.value; render(); }));
  raiz.querySelectorAll('input[data-aviso]').forEach((c) => c.addEventListener('change', () => { state.avisos[c.dataset.aviso] = c.checked; }));
  raiz.querySelector('#pu-publicidad')?.addEventListener('change', (e) => { state.publicidad = e.target.checked; });
  raiz.querySelector('#pu-guardar')?.addEventListener('click', guardar);
  raiz.querySelector('#pu-editar')?.addEventListener('click', () => { state.paso = 'formulario'; render(); });
}

async function guardar() {
  state.guardando = true;
  state.error = '';
  render();
  const { error } = await supabase.rpc('agenda_preferencias_guardar', { p_token: state.token, p_frecuencia: state.frecuencia, p_publicidad: state.publicidad });
  if (!error && state.frecuencia === 'cada_cita') {
    // Los tres avisos se guardan aparte (sql/074); si esa función aún no existe, no se bloquea lo demás.
    await supabase.rpc('agenda_preferencias_guardar_avisos', { p_token: state.token, p_nueva: state.avisos.nueva, p_cambio: state.avisos.cambio, p_cancelacion: state.avisos.cancelacion });
  }
  state.guardando = false;
  if (error) {
    state.error = /venci|funciona/i.test(error.message || '') ? 'Este enlace no funciona o ya venció.' : 'No se pudieron guardar tus preferencias. Inténtalo de nuevo.';
    render();
    return;
  }
  state.paso = 'guardado';
  render();
}

async function iniciar() {
  if (!hayConfiguracionSupabase()) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  state.token = tokenDesdeUrl();
  if (!state.token) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  render();
  const { data, error } = await supabase.rpc('agenda_preferencias_obtener', { p_token: state.token });
  if (error || !data || data.error) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  state.datos = data;
  state.frecuencia = data.frecuencia;
  state.publicidad = data.publicidad !== false;
  state.avisos = { nueva: data.avisar_nueva !== false, cambio: data.avisar_cambio !== false, cancelacion: data.avisar_cancelacion !== false };
  state.paso = 'formulario';
  render();
}

aplicarMarcaPublica();
iniciar();
