// Página pública /inspeccion/<token>: el arrendatario ve el código de LLEGADA (se lo dicta a quien llega a inspeccionar) y, ya registrada la llegada,
// el código de SALIDA. Los códigos solo aparecen el día de la cita. El token del enlace es la credencial (RPC agenda_inspeccion_publica, sql/076).
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');
const state = { token: null, d: null, error: '' };
let temporizador = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaTexto = (f) => { const [a, m, d] = String(f).split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); };
const hora12 = (h) => { const [H, M] = String(h).split(':').map(Number); return `${H % 12 === 0 ? 12 : H % 12}:${String(M).padStart(2, '0')} ${H >= 12 ? 'p. m.' : 'a. m.'}`; };
const horaReal = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/inspeccion\/([0-9a-f-]{8,})/i);
  return ruta ? ruta[1] : new URLSearchParams(window.location.search).get('token');
}

const caja = (codigo) => `<div style="margin:14px 0;padding:18px;border-radius:14px;background:#f4f6f8;text-align:center"><div style="font-size:46px;font-weight:700;letter-spacing:14px;padding-left:14px;color:#1a2c45;font-family:'Bricolage Grotesque',sans-serif">${esc(codigo)}</div></div>`;

function vista() {
  if (state.error) return `<div class="pu-error">${esc(state.error)}</div>`;
  const d = state.d;
  if (!d) return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  const resumen = `<p><strong>${esc(fechaTexto(d.fecha))}, ${esc(hora12(d.hora))}</strong><br>${esc(d.direccion)}${d.quien ? `<br>Irá: <strong>${esc(d.quien)}</strong>` : ''}${d.motivo ? `<br>Motivo: ${esc(d.motivo)}` : ''}</p>`;
  if (d.cancelada) return `<div class="pu-card"><h2>Esta inspección fue cancelada</h2>${resumen}<p>Si tienes dudas, escríbenos.</p></div>`;
  if (d.salida_en) return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>Inspección terminada</h2>${resumen}<p>Llegada a las ${esc(horaReal(d.entrada_en))} · salida a las ${esc(horaReal(d.salida_en))}. ¡Gracias!</p></div>`;
  if (d.codigo_salida) return `<div class="pu-card"><h2>Código de SALIDA</h2>${resumen}<p>Quien hizo la inspección llegó a las ${esc(horaReal(d.entrada_en))}. <strong>Cuando termine y se vaya</strong>, dile este código:</p>${caja(d.codigo_salida)}<p style="font-size:13px;color:#6b6b6b">No lo compartas antes de que termine.</p></div>`;
  if (d.codigo_entrada) return `<div class="pu-card"><h2>Código de LLEGADA</h2>${resumen}<p>Cuando la persona llegue a tu inmueble, <strong>dile este código</strong> para que registre su llegada. Es para tu seguridad.</p>${caja(d.codigo_entrada)}<p style="font-size:13px;color:#6b6b6b">Si alguien llega y no te pide el código, no lo des y avísanos. Cuando se registre la llegada, aquí aparecerá el código de salida.</p></div>`;
  if (!d.es_hoy) return `<div class="pu-card"><h2>Tienes una inspección programada</h2>${resumen}<p>Los códigos de seguridad aparecen en esta misma página <strong>el día de la inspección</strong>.</p></div>`;
  return `<div class="pu-card"><h2>Inspección</h2>${resumen}</div>`;
}

function render() { raiz.innerHTML = vista(); }

async function cargar() {
  const { data, error } = await supabase.rpc('agenda_inspeccion_publica', { p_token: state.token });
  if (error || !data || data.error) { state.error = 'Este enlace no funciona o ya venció.'; clearInterval(temporizador); render(); return; }
  state.d = data;
  render();
  if (data.salida_en || data.cancelada || !data.es_hoy) clearInterval(temporizador);
}

function iniciar() {
  if (!hayConfiguracionSupabase()) { state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  state.token = tokenDesdeUrl();
  if (!state.token) { state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  render();
  cargar();
  temporizador = setInterval(cargar, 15000); // el código de salida aparece solo cuando se registra la llegada
}

aplicarMarcaPublica();
iniciar();
