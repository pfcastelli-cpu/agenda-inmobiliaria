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

const bloqueAsesor = (d) => d.codigo_asesor ? `<div style="margin:0 0 14px;padding:12px 14px;border-left:4px solid #00a9a5;background:#f4f6f8;border-radius:4px"><strong>Código del asesor</strong><p style="margin:4px 0 0;font-size:14px">Quien llegue debe decírtelo desde el principio. Si no lo dice o no coincide, no abras y escríbenos.</p>${caja(d.codigo_asesor)}</div>` : '';

// ---- Encuesta de salida (llega por correo al terminar la inspección) --------------------------------------------------
const modoEncuesta = new URLSearchParams(window.location.search).has('encuesta');
const enc = { r: {}, estado: 'formulario', error: '' };
const tipoVisita = (d) => (/fotograf|foto/i.test(d.motivo || '') ? 'foto' : /mantenim|repar|arreglo/i.test(d.motivo || '') ? 'mant' : /inventar|entrega/i.test(d.motivo || '') ? 'inv' : 'insp');
const PREG_DURACION = { foto: '¿Te avisaron que iban a tomar fotos y respetaron tus cosas?', mant: '¿El trabajo quedó terminado y limpio?', inv: '¿Recibiste el acta o inventario con claridad?', insp: '¿La visita duró lo razonable?' };
const caritas = ['😠', '🙁', '😐', '🙂', '😄'];
function fila(clave, pregunta, opciones) {
  return `<div style="margin:0 0 18px"><p style="margin:0 0 8px"><strong>${esc(pregunta)}</strong></p><div style="display:flex;flex-wrap:wrap;gap:8px">${opciones.map(([v, t]) => `<button type="button" data-enc="${clave}" data-valor="${esc(v)}" class="pu-link" style="border:2px solid ${String(enc.r[clave]) === String(v) ? '#00a9a5' : '#c9d2d8'};border-radius:12px;padding:10px 14px;text-decoration:none;font-size:${typeof t === 'string' && t.length <= 2 ? 24 : 15}px;background:${String(enc.r[clave]) === String(v) ? '#e6f6f5' : '#fff'}">${t}</button>`).join('')}</div></div>`;
}
function vistaEncuesta(d) {
  if (enc.estado === 'enviada') return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>¡Gracias por contarnos!</h2><p>${enc.r.quiere_llamada ? 'Te vamos a llamar muy pronto.' : 'Leemos todas las respuestas para mejorar.'}</p></div>`;
  if (!d.salida_en) return '<div class="pu-card"><h2>Esta encuesta estará disponible cuando termine la inspección</h2><p>Te llegará el aviso por correo.</p></div>';
  const t = tipoVisita(d);
  return `<div class="pu-card"><h2>¿Cómo estuvo la visita?</h2><p>Son 4 preguntas de un toque. Tus respuestas llegan a la coordinación y no se comparten con el propietario.</p>
    ${fila('puntualidad', '¿El asesor llegó a la hora acordada?', [1, 2, 3, 4, 5].map((n) => [n, caritas[n - 1]]))}
    ${fila('trato', '¿Cómo fue el trato del asesor?', [1, 2, 3, 4, 5].map((n) => [n, '★'.repeat(n)]))}
    ${fila('identificacion', '¿Se identificó con su código antes de entrar?', [['si', 'Sí'], ['no', 'No'], ['no_recuerdo', 'No me acuerdo']])}
    ${t === 'insp' ? fila('duracion', PREG_DURACION.insp, [['corta', 'Muy corta'], ['justa', 'Justa'], ['larga', 'Muy larga']]) : fila('duracion', PREG_DURACION[t], [['justa', 'Sí'], ['corta', 'Más o menos'], ['larga', 'No']])}
    <label style="display:block;margin:0 0 14px"><strong>¿Algo que quieras contarnos? (opcional)</strong><textarea id="enc-comentario" rows="3" maxlength="300" style="width:100%;margin-top:6px">${esc(enc.r.comentario || '')}</textarea></label>
    <label class="pu-marca" style="margin:0 0 14px"><input type="checkbox" id="enc-llamar" ${enc.r.quiere_llamada ? 'checked' : ''}><span>Algo salió mal y quiero que me llamen.</span></label>
    ${enc.error ? `<div class="pu-error" role="alert">${esc(enc.error)}</div>` : ''}
    <button class="pu-main" type="button" id="enc-enviar" ${enc.estado === 'enviando' ? 'disabled' : ''}>${enc.estado === 'enviando' ? 'Enviando…' : 'Enviar respuestas'}</button></div>`;
}
async function enviarEncuesta() {
  enc.r.comentario = (document.getElementById('enc-comentario')?.value || '').trim();
  enc.r.quiere_llamada = !!document.getElementById('enc-llamar')?.checked;
  if (!enc.r.puntualidad && !enc.r.trato && !enc.r.identificacion && !enc.r.duracion && !enc.r.comentario) { enc.error = 'Toca al menos una respuesta.'; render(); return; }
  enc.estado = 'enviando'; enc.error = ''; render();
  const { data, error } = await supabase.rpc('agenda_inspeccion_encuesta', { p_token: state.token, p_respuestas: enc.r });
  if (error || !data?.ok) { enc.estado = 'formulario'; enc.error = 'No pudimos guardar tus respuestas. Inténtalo de nuevo.'; render(); return; }
  enc.estado = 'enviada'; render();
}

function vista() {
  if (state.error) return `<div class="pu-error">${esc(state.error)}</div>`;
  const d = state.d;
  if (!d) return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (modoEncuesta && !d.cancelada) return vistaEncuesta(d);
  const resumen = `<p><strong>${esc(fechaTexto(d.fecha))}, ${esc(hora12(d.hora))}</strong><br>${esc(d.direccion)}${d.quien ? `<br>Asesor que asistirá: <strong>${esc(d.quien)}</strong>` : ''}${d.motivo ? `<br>Motivo: ${esc(d.motivo)}` : ''}</p>`;
  if (d.cancelada) return `<div class="pu-card"><h2>Esta inspección fue cancelada</h2>${resumen}<p>Si tienes dudas, escríbenos.</p></div>`;
  if (d.salida_en) return `<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>Inspección terminada</h2>${resumen}<p>Llegada a las ${esc(horaReal(d.entrada_en))} · salida a las ${esc(horaReal(d.salida_en))}. ¡Gracias!</p></div>`;
  if (d.codigo_salida) return `<div class="pu-card"><h2>Código de SALIDA</h2>${resumen}<p>Quien hizo la inspección llegó a las ${esc(horaReal(d.entrada_en))}. <strong>Cuando termine y se vaya</strong>, dile este código:</p>${caja(d.codigo_salida)}<p style="font-size:13px;color:#6b6b6b">No lo compartas antes de que termine.</p></div>`;
  if (d.codigo_entrada) return `<div class="pu-card"><h2>Códigos de hoy</h2>${resumen}${bloqueAsesor(d)}<h3 style="margin-bottom:0">Código de LLEGADA</h3><p>Cuando la persona llegue a tu inmueble, <strong>dile este código</strong> para que registre su llegada. Es para tu seguridad.</p>${caja(d.codigo_entrada)}<p style="font-size:13px;color:#6b6b6b">Si alguien llega y no te pide el código, no lo des y avísanos. Cuando se registre la llegada, aquí aparecerá el código de salida.</p></div>`;
  if (!d.es_hoy) return `<div class="pu-card"><h2>Tienes una inspección programada</h2>${resumen}${bloqueAsesor(d)}<p>Los códigos de seguridad aparecen en esta misma página <strong>el día de la inspección</strong>.</p></div>`;
  return `<div class="pu-card"><h2>Inspección</h2>${resumen}</div>`;
}

function render() {
  raiz.innerHTML = vista();
  raiz.querySelectorAll('[data-enc]').forEach((b) => b.addEventListener('click', () => { enc.r[b.dataset.enc] = /^\d$/.test(b.dataset.valor) ? Number(b.dataset.valor) : b.dataset.valor; enc.r.comentario = document.getElementById('enc-comentario')?.value || ''; enc.r.quiere_llamada = !!document.getElementById('enc-llamar')?.checked; render(); }));
  raiz.querySelector('#enc-enviar')?.addEventListener('click', enviarEncuesta);
}

async function cargar() {
  const { data, error } = await supabase.rpc('agenda_inspeccion_publica', { p_token: state.token });
  if (error || !data || data.error) { state.error = 'Este enlace no funciona o ya venció.'; clearInterval(temporizador); render(); return; }
  state.d = data;
  render();
  if (data.salida_en || data.cancelada || !data.es_hoy || modoEncuesta) clearInterval(temporizador);
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
