import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';

// Acuerdo de horario de una visita a un inmueble arrendado. Esta página la usan DOS personas con
// enlaces distintos: el arrendatario (/arrendatario/<token>) y el cliente que visita
// (/visita/<token>). El servidor dice quién es (`rol`) y solo devuelve lo que a cada uno le
// corresponde. Todo pasa por la Edge Function portal-visita; el token de la URL es la credencial.
const raiz = document.getElementById('pu-main');

const DIAS_LARGO = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_A_MOSTRAR = 21;

const state = {
  paso: 'cargando', // cargando | error | principal
  vista: 'resumen', // resumen | proponer | cancelar | cancelada
  token: null,
  rol: 'arrendatario',
  errorMsg: '',
  hoy: '',
  cita: null,
  inmueble: null,
  asesor: null,
  propuesta: null,
  // proponer
  fechaSel: null,
  horas: null, // null = cargando
  horaSel: null,
  // cancelar
  motivo: '',
  recienCancelada: false,
  // horario permitido (borrador editable, solo arrendatario)
  diasSel: [],
  desde: '',
  hasta: '',
  fueraDeHorario: 0,
  ocupado: false,
  mensaje: '',
  errorForm: '',
};

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/(?:arrendatario|visita)\/([0-9a-f-]{8,})/i);
  if (ruta) return ruta[1];
  return new URLSearchParams(window.location.search).get('token');
}

function esc(valor) {
  if (valor == null) return '';
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fechaDe(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d, 12);
}
function iso(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}
function fechaLarga(isoStr) {
  const f = fechaDe(isoStr);
  return `${DIAS_LARGO[f.getDay() || 7].toLowerCase()} ${f.getDate()} de ${MESES[f.getMonth()]}`;
}
function hora12(h) {
  if (!h) return '';
  const [hh, mm] = h.split(':').map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'p. m.' : 'a. m.'}`;
}

const esArrendatario = () => state.rol === 'arrendatario';

async function llamar(accion, extra = {}) {
  const { data, error } = await supabase.functions.invoke('portal-visita', { body: { token: state.token, accion, ...extra } });
  if (error) {
    // Las respuestas 4xx traen el mensaje en el cuerpo; lo rescatamos si se puede.
    let msg = '';
    try {
      const cuerpo = await error.context?.json?.();
      msg = cuerpo?.error || '';
    } catch {
      /* sin cuerpo legible */
    }
    throw new Error(msg || 'No se pudo conectar. Inténtalo de nuevo.');
  }
  if (!data?.ok) throw new Error(data?.error || 'No se pudo completar la acción.');
  return data;
}

function aplicarDatos(d) {
  state.rol = d.rol;
  state.hoy = d.hoy;
  state.cita = d.cita;
  state.inmueble = d.inmueble;
  state.asesor = d.asesor;
  state.propuesta = d.propuesta;
  if (d.rol === 'arrendatario') {
    state.diasSel = [...(d.inmueble.dias_permitidos || [])];
    state.desde = d.inmueble.desde || '';
    state.hasta = d.inmueble.hasta || '';
  }
}

async function recargar() {
  aplicarDatos(await llamar('obtener'));
  state.vista = state.cita.estado === 'cancelada' ? 'cancelada' : 'resumen';
}

async function cargar() {
  state.token = tokenDesdeUrl();
  if (!state.token) {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no incluye un código válido.';
    render();
    return;
  }
  render();
  try {
    await recargar();
    state.paso = 'principal';
  } catch (e) {
    state.paso = 'error';
    state.errorMsg = e.message || 'Este enlace no es válido o ya no está activo.';
  }
  render();
}

// ---- Vistas ----------------------------------------------------------------------------
function tarjetaVisita() {
  const c = state.cita;
  const i = state.inmueble;
  return `
    <div class="pu-card">
      <h2 style="margin-top:0">${esArrendatario() ? 'Visita programada en tu vivienda' : 'Tu visita al inmueble'}</h2>
      <p style="font-size:13px">${i.direccion ? esc(i.direccion) : 'Inmueble ' + esc(i.numero)}${i.zona ? ' · ' + esc(i.zona) : ''}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px">
        <span class="pu-badge">📅 ${esc(fechaLarga(c.fecha))}</span>
        <span class="pu-badge">🕒 ${esc(hora12(c.hora_inicio))} a ${esc(hora12(c.hora_fin))}</span>
      </div>
      ${state.asesor ? `<p style="margin-top:12px;margin-bottom:0">Asesor a cargo: <strong>${esc(state.asesor.nombre)}</strong>${state.asesor.celular ? ' · ' + esc(state.asesor.celular) : ''}</p>` : ''}
    </div>`;
}

function exito() {
  return state.mensaje ? `<div class="pu-card" style="border-color:var(--pu-teal)"><strong>✓ ${esc(state.mensaje)}</strong></div>` : '';
}

function errorBloque() {
  return `<div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${esc(state.errorForm)}</div>`;
}

const estiloSecundario = 'background:transparent;color:var(--pu-text);border:1.5px solid var(--pu-border);margin-top:10px';

function bloquePropuesta() {
  const p = state.propuesta;
  const proximaHora = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px">
      <span class="pu-badge">📅 ${esc(fechaLarga(p.fecha))}</span>
      <span class="pu-badge">🕒 ${esc(hora12(p.hora_inicio))}</span>
    </div>`;
  if (p.propuesta_por_mi) {
    return `
      <div class="pu-card">
        <h3 style="margin-top:0">Esperando respuesta</h3>
        <p style="margin-bottom:0">Enviaste esta propuesta; ${esArrendatario() ? 'la persona interesada' : 'el arrendatario'} debe aceptarla. Mientras tanto la visita sigue en su hora original. Vence en unas ${esc(p.vence_horas)} h.</p>
        ${proximaHora}
        <button class="pu-main" type="button" id="ar-ir-proponer" style="${estiloSecundario.replace('margin-top:10px', 'margin-top:0')}">Cambiar mi propuesta</button>
      </div>`;
  }
  return `
    <div class="pu-card" style="border-color:var(--pu-teal)">
      <h3 style="margin-top:0">${esArrendatario() ? 'La persona interesada propone otra hora' : 'Te proponen otra hora para tu visita'}</h3>
      <p style="margin-bottom:0">${
        esArrendatario()
          ? 'Si aceptas, la visita pasa a esta hora y queda en firme.'
          : 'El inmueble está arrendado y habitado, y el arrendatario no puede recibirte en la hora acordada. La visita solo cambia si aceptas.'
      }</p>
      ${proximaHora}
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-aceptar" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Un momento…' : 'Aceptar esta hora'}</button>
      <button class="pu-main" type="button" id="ar-rechazar" style="${estiloSecundario}" ${state.ocupado ? 'disabled' : ''}>No me sirve, dejar la hora original</button>
      <button class="pu-main" type="button" id="ar-ir-proponer" style="${estiloSecundario}">Proponer otra hora</button>
    </div>`;
}

function bloqueAcciones() {
  if (!state.cita.vigente) {
    return `<div class="pu-card"><p style="margin:0">Esta visita ya pasó, así que no se puede cambiar.${esArrendatario() ? ' Abajo puedes seguir ajustando el horario en que se muestra tu vivienda.' : ''}</p></div>`;
  }
  if (state.propuesta) return bloquePropuesta();
  if (!esArrendatario()) {
    return `<div class="pu-card"><p style="margin:0">El inmueble está arrendado y habitado. Si el arrendatario necesita otra hora, te escribiremos con una propuesta y la visita solo cambiará si tú aceptas.</p></div>`;
  }
  return `
    <div class="pu-card">
      <h3 style="margin-top:0">¿No puedes recibir la visita a esa hora?</h3>
      <p>Propón otra hora disponible (ya tiene en cuenta la agenda del asesor). La persona interesada recibe tu propuesta y, <strong>cuando la acepte, la visita queda en firme</strong>. Hasta entonces sigue en la hora original.</p>
      <button class="pu-main" type="button" id="ar-ir-proponer">Proponer otra hora</button>
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="${estiloSecundario}">Cancelar la visita</button>
    </div>`;
}

function bloqueHorarioPermitido() {
  if (!esArrendatario()) return '';
  const dias = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => `<button type="button" class="pu-option ${state.diasSel.includes(d) ? 'activa' : ''}" data-dia="${d}">${DIAS_LARGO[d]}</button>`)
    .join('');
  return `
    <div class="pu-card">
      <h3 style="margin-top:0">Cuándo se puede mostrar tu vivienda</h3>
      <p>Estos días y horas se usan para <strong>todas las visitas futuras</strong>. El sistema los combina con la jornada de los asesores, así que solo se ofrecen horarios en los que hay un asesor libre.</p>
      <h3 class="pu-question">Días</h3>
      <div class="pu-options" id="ar-dias">${dias}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
        <div style="flex:1;min-width:130px"><label for="ar-desde">Desde</label><input id="ar-desde" type="time" min="06:00" max="21:00" step="1800" value="${esc(state.desde)}"></div>
        <div style="flex:1;min-width:130px"><label for="ar-hasta">Hasta</label><input id="ar-hasta" type="time" min="06:00" max="21:00" step="1800" value="${esc(state.hasta)}"></div>
      </div>
      ${state.vista === 'resumen' && !state.propuesta ? errorBloque() : ''}
      <button class="pu-main" type="button" id="ar-guardar-horario" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Guardando…' : 'Guardar horario'}</button>
      ${
        state.fueraDeHorario
          ? `<p style="margin-top:14px;margin-bottom:0"><strong>Ojo:</strong> ${state.fueraDeHorario === 1 ? 'hay una visita ya agendada que queda' : `hay ${state.fueraDeHorario} visitas ya agendadas que quedan`} fuera del nuevo horario. Se respetan porque ya están confirmadas con el cliente; si no puedes en esa hora, usa el botón "Proponer otra hora" del correo de esa visita.</p>`
          : ''
      }
    </div>`;
}

function vistaResumen() {
  return `${tarjetaVisita()}${exito()}${bloqueAcciones()}${bloqueHorarioPermitido()}`;
}

function fechasCandidatas() {
  const permitidos = esArrendatario() ? state.inmueble.dias_permitidos || [] : [];
  const out = [];
  for (let n = 0; n < DIAS_A_MOSTRAR; n++) {
    const f = fechaDe(state.hoy);
    f.setDate(f.getDate() + n);
    const dow = f.getDay() || 7;
    if (permitidos.length && !permitidos.includes(dow)) continue;
    out.push(f);
  }
  return out;
}

function vistaProponer() {
  const fechas = fechasCandidatas();
  const strip = fechas.length
    ? `<div class="pu-fechas" id="ar-fechas">${fechas
        .map(
          (f) =>
            `<div class="pu-fecha ${iso(f) === state.fechaSel ? 'activa' : ''}" data-fecha="${iso(f)}"><span>${DIAS_CORTO[f.getDay()]}</span><strong>${f.getDate()}</strong><span>${MESES[f.getMonth()].slice(0, 3)}</span></div>`,
        )
        .join('')}</div>`
    : `<p class="pu-vacio">No hay días permitidos configurados. Actualiza primero el horario en que se puede mostrar tu vivienda.</p>`;
  let slots = '';
  if (state.fechaSel) {
    if (state.horas === null) slots = `<div class="pu-spinner">Buscando horarios…</div>`;
    else if (!state.horas.length) slots = `<p class="pu-vacio">No hay horarios libres ese día. Prueba con otro día.</p>`;
    else
      slots = `<div class="pu-slots" id="ar-slots">${state.horas
        .map((h) => `<div class="pu-slot ${h.hora_inicio === state.horaSel ? 'activo' : ''}" data-hora="${h.hora_inicio}">${esc(hora12(h.hora_inicio))}</div>`)
        .join('')}</div>`;
  }
  return `
    ${tarjetaVisita()}
    <div class="pu-card">
      <h3 style="margin-top:0">Elige la hora que propones</h3>
      <p>Solo aparecen horas en las que un asesor puede atender${esArrendatario() ? ' y que están dentro del horario permitido de tu vivienda' : ''}. ${esArrendatario() ? 'La persona interesada' : 'El arrendatario'} deberá aceptarla; la visita no cambia hasta entonces.</p>
      ${strip}
      ${slots}
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-confirmar-proponer" ${!state.horaSel || state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Enviando…' : state.horaSel ? `Proponer ${esc(fechaLarga(state.fechaSel))}, ${esc(hora12(state.horaSel))}` : 'Elige un horario'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="${estiloSecundario}">Volver</button>
    </div>`;
}

function vistaCancelar() {
  return `
    ${tarjetaVisita()}
    <div class="pu-card">
      <h3 style="margin-top:0">¿Cancelar esta visita?</h3>
      <p>Avisaremos a la persona interesada para que busque otro horario. Si solo necesitas otra hora, mejor usa "Proponer otra hora".</p>
      <label for="ar-motivo">Motivo (opcional)</label>
      <textarea id="ar-motivo" rows="3" maxlength="300" placeholder="Ej: ese día no estaremos en casa">${esc(state.motivo)}</textarea>
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-confirmar-cancelar" style="background:#b3261e;color:#fff" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Cancelando…' : 'Sí, cancelar la visita'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="${estiloSecundario}">No, volver</button>
    </div>`;
}

function vistaCancelada() {
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>${state.recienCancelada ? 'Visita cancelada' : 'Esta visita está cancelada'}</h2>
      <p>${state.recienCancelada ? 'Ya avisamos a la persona interesada.' : 'Ya no hay nada que hacer con este enlace para esta visita.'}</p>
    </div>
    ${exito()}${bloqueHorarioPermitido()}`;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No se pudo conectar con el servicio. Intenta más tarde.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'cargando') html = `<div class="pu-spinner">Cargando…</div>`;
  else if (state.paso === 'error') html = `<div class="pu-error">${esc(state.errorMsg)}</div>`;
  else if (state.vista === 'proponer') html = vistaProponer();
  else if (state.vista === 'cancelar') html = vistaCancelar();
  else if (state.vista === 'cancelada') html = vistaCancelada();
  else html = vistaResumen();
  raiz.innerHTML = html;
  cablear();
}

// ---- Acciones --------------------------------------------------------------------------
async function cargarHoras() {
  state.horas = null;
  state.horaSel = null;
  render();
  const fecha = state.fechaSel;
  try {
    const d = await llamar('horarios', { fecha });
    if (state.fechaSel !== fecha) return;
    state.horas = d.horas;
  } catch (e) {
    state.horas = [];
    state.errorForm = e.message;
  }
  render();
}

async function confirmarProponer() {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    await llamar('proponer', { fecha: state.fechaSel, hora: state.horaSel });
    await recargar();
    state.mensaje = `Enviamos tu propuesta (${fechaLarga(state.propuesta?.fecha || state.fechaSel)}, ${hora12(state.propuesta?.hora_inicio || state.horaSel)}). La visita solo cambia cuando ${esArrendatario() ? 'la persona interesada' : 'el arrendatario'} la acepte.`;
  } catch (e) {
    state.errorForm = e.message;
    state.ocupado = false;
    await cargarHoras();
    return;
  }
  state.ocupado = false;
  render();
  window.scrollTo({ top: 0 });
}

async function responder(aceptar) {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    await llamar('responder', { aceptar });
    await recargar();
    state.mensaje = aceptar
      ? `Listo: la visita quedó en firme para el ${fechaLarga(state.cita.fecha)} a las ${hora12(state.cita.hora_inicio)}.`
      : 'Dejamos la visita en su hora original y avisamos a la otra persona.';
  } catch (e) {
    state.errorForm = e.message;
    try {
      await recargar();
    } catch {
      /* se queda con lo que había */
    }
  }
  state.ocupado = false;
  render();
  window.scrollTo({ top: 0 });
}

async function confirmarCancelar() {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    const d = await llamar('cancelar', { motivo: state.motivo });
    state.cita = d.cita;
    state.propuesta = null;
    state.vista = 'cancelada';
    state.recienCancelada = true;
  } catch (e) {
    state.errorForm = e.message;
  }
  state.ocupado = false;
  render();
}

async function guardarHorario() {
  state.errorForm = '';
  state.mensaje = '';
  if (!state.diasSel.length) {
    state.errorForm = 'Elige al menos un día.';
    return render();
  }
  if (!state.desde || !state.hasta || state.desde >= state.hasta) {
    state.errorForm = 'Escribe una hora "desde" anterior a la hora "hasta".';
    return render();
  }
  state.ocupado = true;
  render();
  try {
    const d = await llamar('guardar_horario', { dias: state.diasSel, desde: state.desde, hasta: state.hasta });
    state.inmueble = { ...state.inmueble, dias_permitidos: d.inmueble.dias_permitidos, desde: d.inmueble.desde, hasta: d.inmueble.hasta };
    state.fueraDeHorario = d.fuera_de_horario;
    state.mensaje = 'Guardamos el nuevo horario. Ya se aplica a las próximas visitas.';
  } catch (e) {
    state.errorForm = e.message;
  }
  state.ocupado = false;
  render();
  if (state.mensaje) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irA(vista) {
  state.vista = vista;
  state.errorForm = '';
  state.mensaje = '';
  state.fechaSel = null;
  state.horas = null;
  state.horaSel = null;
  render();
  window.scrollTo({ top: 0 });
}

function cablear() {
  const por = (id) => document.getElementById(id);
  por('ar-ir-proponer')?.addEventListener('click', () => irA('proponer'));
  por('ar-ir-cancelar')?.addEventListener('click', () => irA('cancelar'));
  por('ar-volver')?.addEventListener('click', () => irA('resumen'));
  por('ar-confirmar-proponer')?.addEventListener('click', confirmarProponer);
  por('ar-confirmar-cancelar')?.addEventListener('click', confirmarCancelar);
  por('ar-aceptar')?.addEventListener('click', () => responder(true));
  por('ar-rechazar')?.addEventListener('click', () => responder(false));
  por('ar-guardar-horario')?.addEventListener('click', guardarHorario);
  por('ar-motivo')?.addEventListener('input', (e) => { state.motivo = e.target.value; });
  por('ar-desde')?.addEventListener('change', (e) => { state.desde = e.target.value; });
  por('ar-hasta')?.addEventListener('change', (e) => { state.hasta = e.target.value; });
  document.querySelectorAll('#ar-dias .pu-option').forEach((b) => {
    b.addEventListener('click', () => {
      const d = Number(b.dataset.dia);
      state.diasSel = state.diasSel.includes(d) ? state.diasSel.filter((x) => x !== d) : [...state.diasSel, d];
      state.errorForm = '';
      render();
    });
  });
  document.querySelectorAll('#ar-fechas .pu-fecha').forEach((el) => {
    el.addEventListener('click', () => {
      state.fechaSel = el.dataset.fecha;
      state.errorForm = '';
      cargarHoras();
    });
  });
  document.querySelectorAll('#ar-slots .pu-slot').forEach((el) => {
    el.addEventListener('click', () => {
      state.horaSel = el.dataset.hora;
      state.errorForm = '';
      render();
    });
  });
}

cargar();
