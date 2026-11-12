// Página pública /avisos/<token>: quien aceptó que le avisemos de inmuebles similares puede cambiar la frecuencia (semanal / mensual)
// o darse de baja con un clic. El token del enlace es la credencial (RPC agenda_avisos_similares_*, sql/080).
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');
const state = { token: null, paso: 'cargando', datos: null, frecuencia: 'semanal', error: '', guardando: false, mensaje: '' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/avisos\/([0-9a-f-]{8,})/i);
  return ruta ? ruta[1] : new URLSearchParams(window.location.search).get('token');
}

function vista() {
  if (state.paso === 'cargando') return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (state.paso === 'error') return `<div class="pu-error">${esc(state.error)}</div>`;
  const d = state.datos;
  if (!d.activo) {
    return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>Listo, ya no te enviaremos estos avisos</h2>
      <p>${esc(state.mensaje || 'Dejaste de recibir avisos de inmuebles similares.')}</p>
      <p style="margin-top:16px"><button type="button" class="pu-link" id="av-reactivar">Me equivoqué, quiero volver a recibirlos</button></p></div>`;
  }
  return `<div class="pu-card"><h2>Avisos de inmuebles similares</h2>
    <p>Te avisamos por correo cuando llega un inmueble parecido al que visitaste (según precio, área, ubicación y tipo)${d.correo ? ` a <strong>${esc(d.correo)}</strong>` : ''}.</p>
    ${state.mensaje ? `<p><strong>${esc(state.mensaje)}</strong></p>` : ''}
    <h3 class="pu-seccion">¿Cada cuánto?</h3>
    <label class="pu-eleccion"><input type="radio" name="av-frec" value="semanal" ${state.frecuencia === 'semanal' ? 'checked' : ''}><span><strong>Una vez por semana</strong><small>Como máximo, y solo si llega algo parecido.</small></span></label>
    <label class="pu-eleccion"><input type="radio" name="av-frec" value="mensual" ${state.frecuencia === 'mensual' ? 'checked' : ''}><span><strong>Una vez por mes</strong><small>Como máximo, y solo si llega algo parecido.</small></span></label>
    <div class="pu-error" role="alert" style="${state.error ? '' : 'display:none'}">${esc(state.error)}</div>
    <button class="pu-main" type="button" id="av-guardar" ${state.guardando ? 'disabled' : ''}>${state.guardando ? 'Guardando…' : 'Guardar'}</button>
    <p style="margin-top:18px"><button type="button" class="pu-link" id="av-baja">Dejar de recibir estos avisos</button></p>
  </div>`;
}

function render() {
  raiz.innerHTML = vista();
  raiz.querySelectorAll('input[name=av-frec]').forEach((r) => r.addEventListener('change', () => { state.frecuencia = r.value; }));
  raiz.querySelector('#av-guardar')?.addEventListener('click', () => guardar(false, 'Guardamos tu elección.'));
  raiz.querySelector('#av-baja')?.addEventListener('click', () => guardar(true, 'Dejaste de recibir avisos de inmuebles similares.'));
  raiz.querySelector('#av-reactivar')?.addEventListener('click', () => guardar(false, 'Volverás a recibir los avisos.'));
}

async function guardar(baja, mensaje) {
  state.guardando = true; state.error = ''; render();
  const { error } = await supabase.rpc('agenda_avisos_similares_guardar', { p_token: state.token, p_frecuencia: state.frecuencia, p_baja: baja });
  state.guardando = false;
  if (error) { state.error = /venci|funciona/i.test(error.message || '') ? 'Este enlace no funciona o ya venció.' : 'No pudimos guardar el cambio. Inténtalo de nuevo.'; render(); return; }
  state.datos.activo = !baja;
  state.mensaje = mensaje;
  render();
}

async function iniciar() {
  if (!hayConfiguracionSupabase()) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  state.token = tokenDesdeUrl();
  if (!state.token) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  render();
  const { data, error } = await supabase.rpc('agenda_avisos_similares_obtener', { p_token: state.token });
  if (error || !data || data.error) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  state.datos = data;
  state.frecuencia = data.frecuencia;
  state.paso = 'formulario';
  // ?baja=1 (enlace de baja de un clic desde el correo): se da de baja al abrir.
  if (new URLSearchParams(window.location.search).has('baja') && data.activo) { await guardar(true, 'Dejaste de recibir avisos de inmuebles similares.'); return; }
  render();
}

aplicarMarcaPublica();
iniciar();
