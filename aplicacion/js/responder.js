// Página /responder/<id de la solicitud>: el asesor llega desde el botón del correo «Pidió una asesoría», entra con su usuario y contraseña
// (si no tiene sesión abierta), ve lo que pidió el propietario y le escribe. El mensaje sale por la función responder-propietario, que lo
// manda con el diseño de la empresa y deja las respuestas en el correo del asesor. Solo miembros de la empresa de la solicitud pueden responder.
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');
const state = { id: null, paso: 'cargando', sol: null, inmueble: null, error: '', enviando: false };
const TIPOS = { asesoria: 'Pidió una asesoría', cambio_precio: 'Pidió un cambio de precio' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function idDesdeUrl() {
  const m = window.location.pathname.match(/responder\/([0-9a-f-]{8,})/i);
  return m ? m[1] : null;
}

function vista() {
  if (state.paso === 'cargando') return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (state.paso === 'error') return `<div class="pu-error">${esc(state.error)}</div>`;
  if (state.paso === 'login') {
    return `<div class="pu-card"><h2>Entra para responder</h2><p>Usa tu usuario y contraseña de la agenda.</p>
      <label>Correo<input type="email" id="rp-email" autocomplete="username" class="pu-codigo-input" style="width:100%;text-align:left;letter-spacing:0"></label>
      <label style="display:block;margin-top:10px">Contraseña<input type="password" id="rp-clave" autocomplete="current-password" class="pu-codigo-input" style="width:100%;text-align:left;letter-spacing:0"></label>
      <div class="pu-error" role="alert" style="${state.error ? '' : 'display:none'}">${esc(state.error)}</div>
      <button class="pu-main" id="rp-entrar" type="button" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Entrando…' : 'Entrar'}</button></div>`;
  }
  if (state.paso === 'enviado') return '<div class="pu-confirmacion"><div class="pu-icono">✓</div><h2>Mensaje enviado</h2><p>El propietario lo recibirá con el diseño de la empresa. Si responde, te llegará a tu correo.</p></div>';
  const s = state.sol;
  const i = state.inmueble;
  return `<div class="pu-card"><h2>${esc(TIPOS[s.tipo] || 'Solicitud del propietario')}</h2>
    <p>${i ? `Inmueble Nº ${esc(i.numero_inmueble)} · ${esc(i.direccion)}` : ''}<br>${esc(s.propietario_nombre || 'Propietario')} · ${esc(s.propietario_email || '')}</p>
    ${s.detalle ? `<p style="padding:10px 12px;background:#f4f6f8;border-radius:10px">${esc(s.detalle)}</p>` : ''}
    <label style="display:block;margin-top:12px">Tu mensaje para el propietario<textarea id="rp-mensaje" rows="6" maxlength="2000" style="width:100%;margin-top:4px" placeholder="Escribe aquí. Le llegará con el diseño de la empresa."></textarea></label>
    <div class="pu-error" role="alert" style="${state.error ? '' : 'display:none'}">${esc(state.error)}</div>
    <button class="pu-main" id="rp-enviar" type="button" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Enviando…' : 'Enviar al propietario'}</button></div>`;
}

function render() {
  raiz.innerHTML = vista();
  raiz.querySelector('#rp-entrar')?.addEventListener('click', entrar);
  raiz.querySelector('#rp-enviar')?.addEventListener('click', enviar);
}

async function entrar() {
  state.enviando = true; state.error = ''; render();
  const email = document.getElementById('rp-email')?.value.trim();
  const clave = document.getElementById('rp-clave')?.value;
  const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
  state.enviando = false;
  if (error) { state.error = 'No pudimos iniciar sesión. Revisa el correo y la contraseña.'; render(); return; }
  await cargar();
}

async function cargar() {
  const { data: sesion } = await supabase.auth.getSession();
  if (!sesion?.session) { state.paso = 'login'; render(); return; }
  const { data: sol, error } = await supabase.from('agenda_solicitudes_propietario').select('id, inmueble_id, tipo, detalle, propietario_nombre, propietario_email').eq('id', state.id).maybeSingle();
  if (error || !sol) { state.paso = 'error'; state.error = 'No encontramos esta solicitud con tu cuenta. Entra con el usuario de tu empresa.'; render(); return; }
  state.sol = sol;
  if (sol.inmueble_id) {
    const { data: inm } = await supabase.from('agenda_inmuebles').select('numero_inmueble, direccion').eq('id', sol.inmueble_id).maybeSingle();
    state.inmueble = inm || null;
  }
  state.paso = 'formulario';
  render();
}

async function enviar() {
  const mensaje = (document.getElementById('rp-mensaje')?.value || '').trim();
  if (mensaje.length < 3) { state.error = 'Escribe el mensaje primero.'; render(); return; }
  state.enviando = true; state.error = ''; render();
  try {
    const { data, error } = await supabase.functions.invoke('responder-propietario', { body: { solicitud_id: state.id, mensaje } });
    if (error || !data?.ok) throw new Error(data?.error || 'No se pudo enviar el mensaje. Inténtalo de nuevo.');
    state.paso = 'enviado';
  } catch (e) { state.error = e.message; }
  state.enviando = false;
  render();
}

function iniciar() {
  if (!hayConfiguracionSupabase()) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  state.id = idDesdeUrl();
  if (!state.id) { state.paso = 'error'; state.error = 'Este enlace no funciona.'; render(); return; }
  render();
  cargar();
}

aplicarMarcaPublica();
iniciar();
