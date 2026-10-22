import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';

// Portal del arrendatario de un inmueble "Rentando". El enlace sale del correo "Visita
// programada en tu vivienda". Todo pasa por la Edge Function portal-arrendatario; el token
// de la URL es la credencial. Aquí nunca aparece información del cliente que visita.
const raiz = document.getElementById('pu-main');

const DIAS_LARGO = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_A_MOSTRAR = 21;

const state = {
  paso: 'cargando', // cargando | error | principal
  vista: 'resumen', // resumen | mover | cancelar | movida | cancelada
  token: null,
  errorMsg: '',
  hoy: '',
  cita: null,
  inmueble: null,
  asesor: null,
  // mover
  fechaSel: null,
  horas: null, // null = cargando
  horaSel: null,
  // cancelar
  motivo: '',
  // horario permitido (borrador editable)
  diasSel: [],
  desde: '',
  hasta: '',
  citasFuera: null,
  ocupado: false,
  mensaje: '', // éxito
  recienCancelada: false,
  errorForm: '',
};

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/arrendatario\/([0-9a-f-]{8,})/i);
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

async function llamar(accion, extra = {}) {
  const { data, error } = await supabase.functions.invoke('portal-arrendatario', { body: { token: state.token, accion, ...extra } });
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
  state.hoy = d.hoy;
  state.cita = d.cita;
  state.inmueble = d.inmueble;
  state.asesor = d.asesor;
  state.diasSel = [...d.inmueble.dias_permitidos];
  state.desde = d.inmueble.desde || '';
  state.hasta = d.inmueble.hasta || '';
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
    aplicarDatos(await llamar('obtener'));
    state.paso = 'principal';
    state.vista = state.cita.estado === 'cancelada' ? 'cancelada' : 'resumen';
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
      <h2 style="margin-top:0">Visita programada en tu vivienda</h2>
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

function bloqueAcciones() {
  if (!state.cita.vigente) {
    return `<div class="pu-card"><p style="margin:0">Esta visita ya pasó, así que no se puede cambiar. Abajo puedes seguir ajustando el horario en que se muestra tu vivienda.</p></div>`;
  }
  return `
    <div class="pu-card">
      <h3 style="margin-top:0">¿No te sirve este horario?</h3>
      <p>Puedes moverla a otro horario disponible (ya tiene en cuenta la agenda del asesor) o cancelarla.</p>
      <button class="pu-main" type="button" id="ar-ir-mover">Cambiar a otro horario</button>
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="background:transparent;color:var(--pu-text);border:1.5px solid var(--pu-border);margin-top:10px">Cancelar la visita</button>
    </div>`;
}

function bloqueHorarioPermitido() {
  const dias = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => `<button type="button" class="pu-option ${state.diasSel.includes(d) ? 'activa' : ''}" data-dia="${d}">${DIAS_LARGO[d]}</button>`)
    .join('');
  const fuera = state.citasFuera;
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
      <div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${esc(state.errorForm)}</div>
      <button class="pu-main" type="button" id="ar-guardar-horario" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Guardando…' : 'Guardar horario'}</button>
      ${
        fuera && fuera.length
          ? `<p style="margin-top:14px;margin-bottom:0"><strong>Ojo:</strong> ${
              fuera.some((c) => c.es_esta)
                ? 'la visita que tienes programada'
                : fuera.length === 1
                  ? 'hay una visita ya agendada'
                  : `hay ${fuera.length} visitas ya agendadas`
            } que quedó fuera del nuevo horario. No se movió sola: ${fuera.some((c) => c.es_esta) && state.cita.vigente ? 'puedes cambiarla arriba y ' : ''}ya avisamos a los asesores para que la reprogramen con la persona interesada.</p>`
          : ''
      }
    </div>`;
}

function vistaResumen() {
  return `${tarjetaVisita()}${exito()}${bloqueAcciones()}${bloqueHorarioPermitido()}`;
}

function fechasCandidatas() {
  const permitidos = state.inmueble.dias_permitidos;
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

function vistaMover() {
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
      <h3 style="margin-top:0">Elige el nuevo día y hora</h3>
      <p>Solo aparecen días y horas dentro del horario permitido de tu vivienda en los que un asesor puede atender.</p>
      ${strip}
      ${slots}
      <div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${esc(state.errorForm)}</div>
      <button class="pu-main" type="button" id="ar-confirmar-mover" ${!state.horaSel || state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Cambiando…' : state.horaSel ? `Cambiar a ${esc(fechaLarga(state.fechaSel))}, ${esc(hora12(state.horaSel))}` : 'Elige un horario'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="background:transparent;color:var(--pu-text);border:1.5px solid var(--pu-border);margin-top:10px">Volver</button>
    </div>`;
}

function vistaCancelar() {
  return `
    ${tarjetaVisita()}
    <div class="pu-card">
      <h3 style="margin-top:0">¿Cancelar esta visita?</h3>
      <p>Avisaremos a la persona interesada y al asesor para que busquen otro horario. Si solo necesitas otra hora, mejor usa "Cambiar a otro horario".</p>
      <label for="ar-motivo">Motivo (opcional)</label>
      <textarea id="ar-motivo" rows="3" maxlength="300" placeholder="Ej: ese día no estaremos en casa">${esc(state.motivo)}</textarea>
      <div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${esc(state.errorForm)}</div>
      <button class="pu-main" type="button" id="ar-confirmar-cancelar" style="background:#b3261e;color:#fff" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Cancelando…' : 'Sí, cancelar la visita'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="background:transparent;color:var(--pu-text);border:1.5px solid var(--pu-border);margin-top:10px">No, volver</button>
    </div>`;
}

function vistaCancelada() {
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>${state.recienCancelada ? 'Visita cancelada' : 'Esta visita está cancelada'}</h2>
      <p>${state.recienCancelada ? 'Ya avisamos a la persona interesada y al asesor.' : 'Ya no hay nada que hacer con este enlace para esta visita.'}</p>
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
  else if (state.vista === 'mover') html = vistaMover();
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

async function confirmarMover() {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    const d = await llamar('mover', { fecha: state.fechaSel, hora: state.horaSel });
    state.cita = d.cita;
    if (d.asesor) state.asesor = d.asesor;
    state.vista = 'resumen';
    state.mensaje = `Listo: tu visita quedó para el ${fechaLarga(d.cita.fecha)} a las ${hora12(d.cita.hora_inicio)}. Avisamos a la persona interesada y al asesor.`;
  } catch (e) {
    state.errorForm = e.message;
    if (state.fechaSel) {
      state.ocupado = false;
      await cargarHoras();
      return;
    }
  }
  state.ocupado = false;
  render();
}

async function confirmarCancelar() {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    const d = await llamar('cancelar', { motivo: state.motivo });
    state.cita = d.cita;
    state.vista = 'cancelada';
    state.recienCancelada = true;
    state.errorForm = '';
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
    state.citasFuera = d.citas_fuera;
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
  por('ar-ir-mover')?.addEventListener('click', () => irA('mover'));
  por('ar-ir-cancelar')?.addEventListener('click', () => irA('cancelar'));
  por('ar-volver')?.addEventListener('click', () => irA('resumen'));
  por('ar-confirmar-mover')?.addEventListener('click', confirmarMover);
  por('ar-confirmar-cancelar')?.addEventListener('click', confirmarCancelar);
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
