import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');

const IMPRESION_OPCIONES = [
  { valor: 'me_gusto_mucho', emoji: '😍', texto: 'Me gustó mucho' },
  { valor: 'me_gusto', emoji: '🙂', texto: 'Me gustó' },
  { valor: 'no_seguro', emoji: '😐', texto: 'No estoy seguro' },
  { valor: 'no_me_gusto', emoji: '🙁', texto: 'No me gustó' },
];
const INTENCION_OPCIONES = [
  { valor: 'avanzar', emoji: '✅', texto: 'Quiero avanzar con este inmueble' },
  { valor: 'segunda_visita', emoji: '🏡', texto: 'Quiero una segunda visita' },
  { valor: 'resolver_dudas', emoji: '📲', texto: 'Quiero que me contacten para resolver dudas' },
  { valor: 'ver_otras', emoji: '🔎', texto: 'Quiero ver otras opciones similares' },
  { valor: 'no_interesa', emoji: '❌', texto: 'No me interesa este inmueble' },
];
const MOTIVO_OPCIONES = [
  { valor: 'precio', emoji: '💰', texto: 'Precio alto' },
  { valor: 'ubicacion', emoji: '📍', texto: 'Ubicación' },
  { valor: 'estado', emoji: '🛠️', texto: 'Estado del inmueble' },
  { valor: 'tamano', emoji: '📐', texto: 'Tamaño o distribución' },
  { valor: 'ruido', emoji: '🔊', texto: 'Ruido o sector' },
  { valor: 'no_aplica', emoji: '✅', texto: 'No aplica' },
];

const state = {
  paso: 'cargando', // cargando | formulario | ya_respondida | enviado | error
  token: null,
  datos: null,
  errorMsg: '',
  impresionSel: null,
  intencionSel: null,
  motivoSel: null,
  calificacionAsesorSel: 0,
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

function impresionPreseleccionadaDesdeUrl() {
  const params = new URLSearchParams(window.location.search);
  const valor = params.get('impresion');
  return IMPRESION_OPCIONES.some((o) => o.valor === valor) ? valor : null;
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

function etiquetaOpcion(opciones, valor) {
  const op = opciones.find((o) => o.valor === valor);
  return op ? `${op.emoji} ${op.texto}` : '';
}

async function cargarEncuesta() {
  state.token = tokenDesdeUrl();
  if (!state.token) {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no funciona o ya venció. Pídele a tu asesor que te lo envíe de nuevo.';
    render();
    return;
  }
  state.paso = 'cargando';
  render();
  const { data, error } = await supabase.rpc('agenda_obtener_encuesta', { p_token: state.token });
  if (error || !data || data.error === 'no_encontrada') {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no funciona o ya venció. Pídele a tu asesor que te lo envíe de nuevo.';
    render();
    return;
  }
  state.datos = data;
  if (data.ya_respondida) {
    state.paso = 'ya_respondida';
  } else {
    state.impresionSel = impresionPreseleccionadaDesdeUrl();
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

function selectorOpciones(campo, opciones, seleccionado) {
  return `<div class="pu-options" data-campo="${campo}">${opciones
    .map(
      (o) =>
        `<button type="button" class="pu-option ${o.valor === seleccionado ? 'activa' : ''}" data-campo="${campo}" data-valor="${o.valor}">${o.emoji} ${escapeHtml(o.texto)}</button>`,
    )
    .join('')}</div>`;
}

function selectorEstrellas() {
  let out = '<div class="pu-stars" id="pu-stars">';
  for (let i = 1; i <= 5; i++) {
    out += `<button type="button" class="pu-star ${i <= state.calificacionAsesorSel ? 'activa' : ''}" data-estrella="${i}" aria-label="${i} estrella${i === 1 ? '' : 's'}">★</button>`;
  }
  out += '</div>';
  return out;
}

// El motivo solo se pregunta si el inmueble no convenció del todo.
const IMPRESIONES_QUE_PREGUNTAN_MOTIVO = ['no_me_gusto', 'no_seguro'];
const preguntarMotivo = () => IMPRESIONES_QUE_PREGUNTAN_MOTIVO.includes(state.impresionSel);

function vistaFormulario() {
  const motivo = preguntarMotivo()
    ? `<h3 class="pu-question">3. ¿Cuál fue el motivo principal? <span style="font-weight:400">(opcional)</span></h3>
      ${selectorOpciones('motivo', MOTIVO_OPCIONES.filter((o) => o.valor !== 'no_aplica'), state.motivoSel)}`
    : '';
  return `
    <div class="pu-card">
      <h2>¿Cómo te pareció el inmueble?</h2>
      ${encabezadoInmueble()}
      <p>Tu opinión nos ayuda a mejorar la atención y a conocer mejor cada inmueble. Solo toma un minuto.</p>

      <h3 class="pu-question">1. ¿Qué impresión te dejó el inmueble?</h3>
      ${selectorOpciones('impresion', IMPRESION_OPCIONES, state.impresionSel)}

      <h3 class="pu-question">2. ¿Cuál sería tu siguiente paso?</h3>
      ${selectorOpciones('intencion', INTENCION_OPCIONES, state.intencionSel)}

      ${motivo}

      <h3 class="pu-question">${preguntarMotivo() ? '4' : '3'}. ¿Cómo calificas la atención del asesor?</h3>
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
      ${d.impresion ? `<p class="pu-badge" style="display:inline-block;margin-top:8px">${etiquetaOpcion(IMPRESION_OPCIONES, d.impresion)}</p>` : ''}
      ${d.intencion ? `<p class="pu-badge" style="display:inline-block;margin:0 0 0 6px">${etiquetaOpcion(INTENCION_OPCIONES, d.intencion)}</p>` : ''}
      ${d.motivo && d.motivo !== 'no_aplica' ? `<p class="pu-badge" style="display:inline-block;margin:8px 0 0">${etiquetaOpcion(MOTIVO_OPCIONES, d.motivo)}</p>` : ''}
      ${d.calificacion ? `<div style="color:#E6A817;font-size:22px;letter-spacing:2px;margin:10px 0">${'★'.repeat(d.calificacion)}${'☆'.repeat(5 - d.calificacion)}</div>` : ''}
      ${d.comentario ? `<p style="margin-top:10px">${escapeHtml(d.comentario)}</p>` : ''}
      <p style="margin-top:16px">Gracias por ayudarnos a mejorar.</p>
      ${botonAgendarOtraVisita(d.intencion)}
      ${botonRadicar(d.intencion)}
    </div>
  `;
}

// Si el cliente dijo que quiere otra visita, su opinión ya quedó guardada: se le lleva directo a agendarla (misma página pública de reserva).
function botonRadicar(intencion) {
  if (intencion !== 'avanzar' || !state.token) return '';
  return `<p style="margin-top:16px"><a class="pu-main" style="display:inline-block;text-decoration:none" href="${window.location.origin}/radicar/${encodeURIComponent(state.token)}">Ver cómo radicar mi estudio</a></p>`;
}

function botonAgendarOtraVisita(intencion) {
  const numero = state.datos?.numero_inmueble;
  if (intencion !== 'segunda_visita' || !numero) return '';
  return `<p style="margin-top:16px"><a class="pu-main" style="display:inline-block;text-decoration:none" href="${window.location.origin}/inmuebles/${encodeURIComponent(numero)}">Agendar mi nueva visita</a></p>`;
}

function vistaEnviado() {
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>¡Gracias por tu opinión!</h2>
      <p>Tu opinión nos ayuda a mejorar nuestro servicio.</p>
      ${state.intencionSel === 'avanzar' ? '<p>Dijiste que quieres avanzar. Te mostramos cómo radicar tu estudio:</p>' : ''}
      ${state.intencionSel === 'segunda_visita' ? '<p>Dijiste que quieres volver a ver el inmueble. Escoge el día y la hora que mejor te quede:</p>' : ''}
      ${botonAgendarOtraVisita(state.intencionSel)}
      ${botonRadicar(state.intencionSel)}
    </div>
  `;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No pudimos cargar la página. Revisa tu internet e inténtalo otra vez en unos minutos.</div>`;
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
  if (!state.impresionSel) {
    state.errorForm = 'Elige qué impresión te dejó el inmueble.';
    render();
    return;
  }
  if (!state.intencionSel) {
    state.errorForm = 'Elige cuál sería tu siguiente paso.';
    render();
    return;
  }
  if (!state.calificacionAsesorSel) {
    state.errorForm = 'Elige entre 1 y 5 estrellas para la atención del asesor.';
    render();
    return;
  }
  state.enviando = true;
  state.errorForm = '';
  render();
  const { error } = await supabase.rpc('agenda_responder_encuesta', {
    p_token: state.token,
    p_calificacion: state.calificacionAsesorSel,
    p_comentario: state.comentario.trim() || null,
    p_impresion: state.impresionSel,
    p_intencion: state.intencionSel,
    p_motivo: preguntarMotivo() ? state.motivoSel : 'no_aplica',
  });
  state.enviando = false;
  if (error) {
    state.errorForm = mensajeAmigable(error, 'No se pudo enviar tu opinión. Intenta de nuevo.');
    render();
    return;
  }
  // Avisa por correo al asesor (si el cliente quiere avanzar) y a la administración. No bloquea ni afecta la pantalla del cliente.
  supabase.functions.invoke('avisar-encuesta-respondida', { body: { token: state.token } }).catch(() => {});
  state.paso = 'enviado';
  render();
}

function cablear() {
  raiz.querySelectorAll('.pu-options').forEach((grupo) => {
    grupo.querySelectorAll('.pu-option').forEach((boton) => {
      boton.addEventListener('click', () => {
        const campo = boton.dataset.campo;
        const valor = boton.dataset.valor;
        if (campo === 'impresion') {
          state.impresionSel = valor;
          if (!preguntarMotivo()) state.motivoSel = null;
        }
        else if (campo === 'intencion') state.intencionSel = valor;
        else if (campo === 'motivo') state.motivoSel = valor;
        state.errorForm = '';
        render();
      });
    });
  });
  const stars = document.getElementById('pu-stars');
  if (stars) {
    stars.querySelectorAll('.pu-star').forEach((el) => {
      el.addEventListener('click', () => {
        state.calificacionAsesorSel = Number(el.dataset.estrella);
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

aplicarMarcaPublica();
cargarEncuesta();
