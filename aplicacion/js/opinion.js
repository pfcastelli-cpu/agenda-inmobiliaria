import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';

const raiz = document.getElementById('pu-main');

const state = {
  paso: 'cargando', // cargando | formulario | ya_respondida | enviado | error
  token: null,
  datos: null,
  errorMsg: '',
  calificacionSel: 0,
  comentario: '',
  enviando: false,
  errorForm: '',
};

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/opinion\/([0-9a-f-]{8,})/i);
  if (ruta) return ruta[1];
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}

function escapeHtml(valor) {
  if (valor == null) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function esMensajeTecnico(msg) {
  return /function|candidate|relation|column|syntax|operator|schema|constraint|duplicate key|null value|permission denied|violates|uuid|pg_|does not exist/i.test(msg || '');
}

function mensajeAmigable(error, generico) {
  const msg = error?.message || '';
  if (!msg || esMensajeTecnico(msg)) return generico;
  return msg;
}

async function cargarEncuesta() {
  state.token = tokenDesdeUrl();
  if (!state.token) {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no incluye un código válido.';
    render();
    return;
  }
  state.paso = 'cargando';
  render();
  const { data, error } = await supabase.rpc('agenda_obtener_encuesta', { p_token: state.token });
  if (error || !data || data.error === 'no_encontrada') {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no es válido o ya expiró.';
    render();
    return;
  }
  state.datos = data;
  if (data.ya_respondida) {
    state.paso = 'ya_respondida';
  } else {
    state.paso = 'formulario';
  }
  render();
}

function vistaCargando() {
  return `<div class="pu-spinner">Cargando…</div>`;
}

function vistaError() {
  return `<div class="pu-error">${escapeHtml(state.errorMsg)}</div>`;
}

function encabezadoInmueble() {
  const d = state.datos;
  if (!d || !d.direccion) return '';
  return `<p style="font-size:13px;color:var(--pu-muted)">Inmueble ${d.numero_inmueble || ''} · ${escapeHtml(d.direccion)}</p>`;
}

function selectorEstrellas() {
  let out = '<div class="pu-stars" id="pu-stars">';
  for (let i = 1; i <= 5; i++) {
    out += `<button type="button" class="pu-star ${i <= state.calificacionSel ? 'activa' : ''}" data-estrella="${i}" aria-label="${i} estrella${i === 1 ? '' : 's'}">★</button>`;
  }
  out += '</div>';
  return out;
}

function vistaFormulario() {
  return `
    <div class="pu-card">
      <h2>¿Qué te pareció la visita?</h2>
      ${encabezadoInmueble()}
      <p>Tu opinión le llega directo al propietario de este inmueble.</p>
      ${selectorEstrellas()}
      <label for="pu-comentario" style="margin-top:18px">Cuéntanos más (opcional)</label>
      <textarea id="pu-comentario" rows="4" placeholder="¿Qué te gustó? ¿Qué mejorarías?">${escapeHtml(state.comentario)}</textarea>
      <div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${escapeHtml(state.errorForm)}</div>
      <button class="pu-main" id="pu-enviar-opinion" type="button" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Enviando…' : 'Enviar mi opinión'}</button>
    </div>
  `;
}

function vistaYaRespondida() {
  const d = state.datos;
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>Ya registramos tu opinión</h2>
      ${encabezadoInmueble()}
      ${d.calificacion ? `<div style="color:#E6A817;font-size:22px;letter-spacing:2px;margin:10px 0">${'★'.repeat(d.calificacion)}${'☆'.repeat(5 - d.calificacion)}</div>` : ''}
      ${d.comentario ? `<p style="margin-top:10px">${escapeHtml(d.comentario)}</p>` : ''}
      <p style="margin-top:16px">Gracias por ayudarnos a mejorar.</p>
    </div>
  `;
}

function vistaEnviado() {
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>¡Gracias por tu opinión!</h2>
      <p>Tu comentario le llega directo al propietario del inmueble.</p>
    </div>
  `;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No se pudo conectar con el servicio. Intenta más tarde.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'cargando') html = vistaCargando();
  else if (state.paso === 'error') html = vistaError();
  else if (state.paso === 'formulario') html = vistaFormulario();
  else if (state.paso === 'ya_respondida') html = vistaYaRespondida();
  else if (state.paso === 'enviado') html = vistaEnviado();
  raiz.innerHTML = html;
  cablear();
}

async function enviarOpinion() {
  if (!state.calificacionSel) {
    state.errorForm = 'Elige entre 1 y 5 estrellas antes de enviar.';
    render();
    return;
  }
  state.enviando = true;
  state.errorForm = '';
  render();
  const { error } = await supabase.rpc('agenda_responder_encuesta', {
    p_token: state.token,
    p_calificacion: state.calificacionSel,
    p_comentario: state.comentario.trim() || null,
  });
  state.enviando = false;
  if (error) {
    state.errorForm = mensajeAmigable(error, 'No se pudo enviar tu opinión. Intenta de nuevo.');
    render();
    return;
  }
  state.paso = 'enviado';
  render();
}

function cablear() {
  const stars = document.getElementById('pu-stars');
  if (stars) {
    stars.querySelectorAll('.pu-star').forEach((el) => {
      el.addEventListener('click', () => {
        state.calificacionSel = Number(el.dataset.estrella);
        state.errorForm = '';
        render();
      });
    });
  }
  const comentario = document.getElementById('pu-comentario');
  if (comentario) comentario.addEventListener('input', (e) => { state.comentario = e.target.value; });
  const enviar = document.getElementById('pu-enviar-opinion');
  if (enviar) enviar.addEventListener('click', enviarOpinion);
}

cargarEncuesta();
