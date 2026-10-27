import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';
import './teclado-publico.js';

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
  vista: 'resumen', // resumen | proponer | cancelar | cancelada | inmueble
  modo: 'cita', // cita (enlace de una visita) | inmueble (enlace único del arrendatario con todas sus visitas)
  reubicacion: false, // el cliente debe elegir otro hora (obligatorio) porque el arrendatario no puede recibirlo
  reubicacionVence: null, // texto del plazo: «jueves 29 de octubre, 3:00 p. m.»
  inmuebleToken: null,
  // pausa de visitas (arrendatario, modo inmueble)
  pausaDesde: '',
  pausaHasta: '',
  pausaConfirmar: false,
  maxDiasPausa: 14,
  // modo inmueble
  citasInm: [],
  franjas: [],
  maxFranjas: 3,
  franjaFecha: null,
  franjaFechas: [], // días elegidos cuando se cambia en bloque
  franjaMulti: false,
  primeraFecha: null, // primera fecha con horarios, para no obligar a adivinar el día
  franjaTipo: 'disponible',
  franjaRangos: [],
  token: null,
  rol: 'arrendatario',
  rentando: true,
  tipo: 'inmueble',
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
// El cliente cambia la hora directo (sin acuerdo) cuando en el inmueble no vive un arrendatario.
const cambioDirecto = () => !esArrendatario() && (!state.rentando || state.reubicacion);

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
    throw new Error(msg || 'No pudimos conectar. Revisa tu internet e inténtalo otra vez.');
  }
  if (!data?.ok) throw new Error(data?.error || 'No se pudo completar la acción.');
  return data;
}

function aplicarDatos(d) {
  if (d.modo === 'inmueble') {
    state.modo = 'inmueble';
    state.rol = 'arrendatario';
    state.tipo = d.tipo || 'inmueble';
    state.hoy = d.hoy;
    state.inmueble = d.inmueble;
    state.citasInm = d.citas || [];
    state.franjas = d.franjas || [];
    state.maxFranjas = d.max_franjas || 3;
    state.maxDiasPausa = d.max_dias_pausa || 14;
    return;
  }
  state.modo = 'cita';
  state.reubicacion = !!d.reubicacion;
  state.reubicacionVence = d.reubicacion_vence || null;
  state.inmuebleToken = d.inmueble_token || null;
  state.rol = d.rol;
  state.rentando = d.rentando !== false;
  state.tipo = d.tipo || 'inmueble';
  state.hoy = d.hoy;
  state.cita = d.cita;
  state.inmueble = d.inmueble;
  state.asesor = d.asesor;
  state.propuesta = d.propuesta;
  if (d.rol === 'arrendatario') {
    // Sin días configurados el sistema ofrece todos los días: se muestra así (✓ en todos), no como si ninguno se pudiera.
    state.diasSel = d.inmueble.dias_permitidos?.length ? [...d.inmueble.dias_permitidos] : [1, 2, 3, 4, 5, 6, 7];
    state.desde = d.inmueble.desde || '';
    state.hasta = d.inmueble.hasta || '';
  }
}

async function recargar() {
  aplicarDatos(await llamar('obtener'));
  if (state.modo === 'inmueble') {
    state.vista = 'inmueble';
    return;
  }
  state.vista = state.cita.estado === 'cancelada' ? 'cancelada' : 'resumen';
}

async function cargar() {
  state.token = tokenDesdeUrl();
  if (!state.token) {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no funciona o ya venció. Pídele a tu asesor que te lo envíe de nuevo.';
    render();
    return;
  }
  render();
  try {
    await recargar();
    state.paso = 'principal';
  } catch (e) {
    state.paso = 'error';
    state.errorMsg = e.message || 'Este enlace no funciona o ya venció. Pídele a tu asesor que te lo envíe de nuevo.';
  }
  render();
  irSegunEnlace();
}

// Los botones del correo traen ?accion=: abren directo la opción que la persona eligió.
function irSegunEnlace() {
  if (state.paso !== 'principal') return;
  const params = new URLSearchParams(window.location.search);
  const accion = params.get('accion');
  if (!accion) return;
  if (state.modo === 'cita') {
    if (accion === 'otra_hora' && esArrendatario() && state.cita?.vigente && !state.propuesta) irA('proponer');
    return;
  }
  if (accion === 'dia') {
    const fecha = params.get('fecha');
    if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) elegirFechaFranja(fecha);
    document.getElementById('ar-card-dia')?.scrollIntoView({ behavior: 'smooth' });
  } else if (accion === 'pausa') {
    document.getElementById('ar-card-pausa')?.scrollIntoView({ behavior: 'smooth' });
  }
}

// ---- Vistas ----------------------------------------------------------------------------
function tarjetaVisita() {
  const c = state.cita;
  const i = state.inmueble;
  return `
    <div class="pu-card">
      <h2 style="margin-top:0">${esArrendatario() ? `Visita programada en tu ${esc(state.tipo)}` : 'Tu visita al inmueble'}</h2>
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

const venceTxt = () => (state.reubicacionVence ? esc(state.reubicacionVence) : 'el plazo indicado en el correo');

function bloquePropuesta() {
  const p = state.propuesta;
  const proximaHora = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 12px">
      <span class="pu-badge">📅 ${esc(fechaLarga(p.fecha))}</span>
      <span class="pu-badge">🕒 ${esc(hora12(p.hora_inicio))}</span>
    </div>`;
  if (p.propuesta_por_mi) {
    // El arrendatario no puede a la hora original: el cambio es obligatorio y tiene plazo.
    if (esArrendatario() && state.reubicacion) {
      return `
      <div class="pu-card">
        <h3 style="margin-top:0">Esperando respuesta de la persona interesada</h3>
        <p style="margin-bottom:0">Le enviamos tu propuesta. Ella debe aceptarla o elegir otra hora <strong>antes del ${venceTxt()}</strong>; si no lo hace, <strong>la visita se cancela sola</strong> y no tendrás que hacer nada más.</p>
        ${proximaHora}
        <button class="pu-main" type="button" id="ar-ir-proponer" style="${estiloSecundario.replace('margin-top:10px', 'margin-top:0')}">Cambiar mi propuesta</button>
      </div>`;
    }
    return `
      <div class="pu-card">
        <h3 style="margin-top:0">Esperando respuesta</h3>
        <p style="margin-bottom:0">Enviaste esta propuesta; ${esArrendatario() ? 'la persona interesada' : 'el arrendatario'} debe aceptarla. Mientras tanto la visita sigue en su hora original. Vence en unas ${esc(p.vence_horas)} h.</p>
        ${proximaHora}
        <button class="pu-main" type="button" id="ar-ir-proponer" style="${estiloSecundario.replace('margin-top:10px', 'margin-top:0')}">Cambiar mi propuesta</button>
      </div>`;
  }
  if (!esArrendatario() && state.reubicacion) {
    return `
    <div class="pu-card" style="border-color:var(--pu-teal)">
      <h3 style="margin-top:0">Tu visita necesita una nueva hora</h3>
      <p>Quien vive en el inmueble no puede recibirte a la hora acordada. Te propone esta otra:</p>
      ${proximaHora}
      <p><strong>Tienes hasta el ${venceTxt()} para elegir.</strong> Si no lo haces, la visita se cancela y el horario queda libre. No vayas al inmueble a la hora original: nadie podrá recibirte.</p>
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-aceptar" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Un momento…' : 'Aceptar esta hora'}</button>
      <button class="pu-main" type="button" id="ar-ir-proponer" style="${estiloSecundario}">Elegir otra hora</button>
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="${estiloSecundario}">Cancelar mi visita</button>
    </div>`;
  }
  return `
    <div class="pu-card" style="border-color:var(--pu-teal)">
      <h3 style="margin-top:0">${esArrendatario() ? 'La persona interesada propone otra hora' : 'Te proponen otra hora para tu visita'}</h3>
      <p style="margin-bottom:0">${
        esArrendatario()
          ? 'Si aceptas, la visita pasa a esta hora y queda en firme.'
          : 'El inmueble está arrendado y ocupado. La visita solo cambia si aceptas.'
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
    return `<div class="pu-card"><p style="margin:0">Esta visita ya pasó, así que no se puede cambiar.${esArrendatario() ? ' Abajo puedes seguir ajustando el horario en que se muestra tu ${state.tipo}.' : ''}</p></div>`;
  }
  if (state.propuesta) return bloquePropuesta();
  if (!esArrendatario()) {
    // Cambio obligatorio: el arrendatario no puede a esa hora. El cliente elige otra antes del plazo o la visita se cancela.
    if (state.reubicacion) {
      return `
    <div class="pu-card" style="border-color:var(--pu-teal)">
      <h3 style="margin-top:0">Tu visita necesita una nueva hora</h3>
      <p>Quien vive en el inmueble no puede recibirte a la hora acordada. Escoge un horario disponible (ya tiene en cuenta la agenda del asesor): el cambio queda en firme al instante y te enviamos la confirmación por correo.</p>
      <p><strong>Tienes hasta el ${venceTxt()} para elegir.</strong> Si no lo haces, la visita se cancela y el horario queda libre. No vayas al inmueble a la hora original: nadie podrá recibirte.</p>
      <button class="pu-main" type="button" id="ar-ir-proponer">Elegir nueva hora</button>
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="${estiloSecundario}">Ya no me interesa: cancelar mi visita</button>
    </div>`;
    }
    return `
    <div class="pu-card">
      <h3 style="margin-top:0">¿Necesitas cambiar tu visita?</h3>
      <p>${
        state.rentando
          ? 'El inmueble está arrendado y ocupado: si propones otra hora, el arrendatario debe aceptarla y la visita no cambia hasta entonces. Si quien vive allí no puede recibirte, te escribiremos y tendrás un plazo para elegir otra hora; si no la eliges, la visita se cancela.'
          : 'Elige otra hora disponible (ya tiene en cuenta la agenda del asesor). El cambio queda en firme al instante y te enviamos la confirmación por correo.'
      }</p>
      <button class="pu-main" type="button" id="ar-ir-proponer">${state.rentando ? 'Proponer otra hora' : 'Cambiar la hora'}</button>
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="${estiloSecundario}">Cancelar mi visita</button>
    </div>`;
  }
  // Arrendatario: tres opciones, cada una con un resultado distinto, y la consecuencia dicha de frente.
  const base = state.inmuebleToken ? `/arrendatario/${esc(state.inmuebleToken)}` : '';
  const enlaceBoton = (href, texto) => `<a class="pu-main" href="${href}" style="display:flex;align-items:center;justify-content:center;min-height:48px;box-sizing:border-box;text-align:center;text-decoration:none;${estiloSecundario}">${texto}</a>`;
  return `
    <div class="pu-card">
      <h3 style="margin-top:0">¿No puedes recibir esta visita?</h3>
      ${state.reubicacion ? `<p class="pu-badge" style="margin:0 0 10px">Ya le pedimos a la persona interesada que elija otra hora (plazo: ${venceTxt()}).</p>` : ''}
      <p>Dinos cuál de estas opciones es la tuya. En cualquiera de los tres casos <strong>le pedimos a la persona interesada que elija otra hora y le damos un plazo; si no la elige, la visita se cancela sola</strong>. Tú no tienes que hacer nada más.</p>
      <button class="pu-main" type="button" id="ar-ir-proponer">Puedo, pero a otra hora</button>
      ${base ? enlaceBoton(`${base}?accion=dia&fecha=${esc(state.cita.fecha)}`, 'No puedo ese día') : ''}
      ${base ? enlaceBoton(`${base}?accion=pausa`, 'No puedo recibir visitas por un tiempo') : ''}
      <button class="pu-main" type="button" id="ar-ir-cancelar" style="${estiloSecundario};font-size:13px">Cancelar solo esta visita</button>
    </div>`;
}

function bloqueHorarioPermitido() {
  if (!esArrendatario()) return '';
  const dias = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => `<button type="button" class="pu-option ${state.diasSel.includes(d) ? 'activa' : ''}" data-dia="${d}" aria-pressed="${state.diasSel.includes(d)}">${state.diasSel.includes(d) ? '✓' : '✕'} ${DIAS_LARGO[d]}</button>`)
    .join('');
  return `
    <div class="pu-card">
      <h3 style="margin-top:0">Cuándo se puede mostrar tu ${esc(state.tipo)}</h3>
      <p>Estos días y horas se usan para <strong>todas las visitas futuras</strong>. El sistema los combina con la jornada de los asesores, así que solo se ofrecen horarios en los que hay un asesor libre.</p>
      <h3 class="pu-question">Días</h3>
      <p class="pu-vacio" style="margin:0 0 6px;font-size:13px">✓ = se puede mostrar ese día · ✕ = no se muestra</p>
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

function enlaceTodas() {
  if (!esArrendatario() || !state.inmuebleToken) return '';
  return `<div class="pu-card"><p style="margin:0"><a href="/arrendatario/${esc(state.inmuebleToken)}"><strong>Ver todas mis visitas y organizar mis horarios</strong></a><br>Si tienes varias visitas, ahí marcas los días y franjas en que sí (o no) puedes, de una sola vez.</p></div>`;
}

function vistaResumen() {
  return `${tarjetaVisita()}${exito()}${enlaceTodas()}${bloqueAcciones()}${bloqueHorarioPermitido()}`;
}

// ---- Vista del inmueble (arrendatario): todas sus visitas y sus franjas --------------------
const esPausa = (f) => f.tipo === 'bloqueo' && f.desde === '00:00' && f.hasta >= '23:59';

function textoFranjaDia(fecha) {
  const del = state.franjas.filter((f) => f.fecha === fecha);
  if (!del.length) return '';
  if (del.some(esPausa)) return 'No recibes visitas ese día (pausa)';
  const tipo = del[0].tipo === 'disponible' ? 'Solo puedes' : 'No puedes';
  return `${tipo}: ${del.map((f) => `${hora12(f.desde)} a ${hora12(f.hasta)}`).join(', ')}`;
}

function vistaInmueble() {
  const i = state.inmueble;
  const lista = state.citasInm.length
    ? state.citasInm
        .map(
          (c) =>
            `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0"><span class="pu-badge">📅 ${esc(fechaLarga(c.fecha))}</span><span class="pu-badge">🕒 ${esc(hora12(c.hora_inicio))} a ${esc(hora12(c.hora_fin))}</span>${c.por_reubicar ? `<span class="pu-badge">Por cambiar de hora${c.vence ? ` · plazo del interesado: ${esc(c.vence)}` : ''}</span>` : ''}<a href="/arrendatario/${esc(c.token)}">Ver o cambiar esta visita</a></div>`,
        )
        .join('')
    : `<p class="pu-vacio" style="margin:0">No tienes visitas programadas por ahora.</p>`;

  const fechas = [];
  for (let n = 0; n < DIAS_A_MOSTRAR; n++) {
    const f = fechaDe(state.hoy);
    f.setDate(f.getDate() + n);
    fechas.push(f);
  }
  const multi = state.franjaMulti;
  const elegida = (f) => (multi ? state.franjaFechas.includes(iso(f)) : iso(f) === state.franjaFecha);
  const strip = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px">
      <button type="button" class="pu-option ${multi ? 'activa' : ''}" id="ar-multi" aria-pressed="${multi}">${multi ? '✓' : '○'} Cambiar varios días a la vez</button>
      ${multi ? `<button type="button" class="pu-option" id="ar-multi-habiles">Elegir lunes a viernes</button><button type="button" class="pu-option" id="ar-multi-limpiar">Quitar selección</button>` : ''}
    </div>
    <div class="pu-fechas" id="ar-fechas-franja">${fechas
      .map((f) => {
        const tiene = state.franjas.some((x) => x.fecha === iso(f));
        const hay = state.citasInm.some((x) => x.fecha === iso(f));
        const sel = elegida(f);
        return `<div class="pu-fecha ${sel ? 'activa' : ''}" data-fecha="${iso(f)}" role="button" tabindex="0" aria-pressed="${sel}"><span>${sel ? '✓ ' : ''}${DIAS_CORTO[f.getDay()]}</span><strong>${f.getDate()}</strong><span>${MESES[f.getMonth()].slice(0, 3)}${tiene ? ' ●' : hay ? ' ·' : ''}</span></div>`;
      })
      .join('')}</div>
    <p class="pu-vacio" style="margin:6px 0 0;font-size:12px">✓ = día elegido · ● ya tiene franjas · · tiene visitas</p>`;

  const diasElegidos = multi ? [...state.franjaFechas].sort() : state.franjaFecha ? [state.franjaFecha] : [];
  let editor = '';
  if (diasElegidos.length) {
    const disponible = state.franjaTipo === 'disponible';
    const rangos = state.franjaRangos
      .map(
        (r, k) =>
          `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:8px 0"><div style="flex:1;min-width:120px"><label>Desde</label><input type="time" min="06:00" max="21:00" step="900" data-rango="${k}" data-lado="desde" value="${esc(r.desde)}"></div><div style="flex:1;min-width:120px"><label>Hasta</label><input type="time" min="06:00" max="21:00" step="900" data-rango="${k}" data-lado="hasta" value="${esc(r.hasta)}"></div>${state.franjaRangos.length > 1 ? `<button type="button" class="pu-main" data-quitar-rango="${k}" style="${estiloSecundario.replace('margin-top:10px', 'margin-top:0')};width:auto">Quitar</button>` : ''}</div>`,
      )
      .join('');
    const titulo = diasElegidos.length === 1 ? esc(fechaLarga(diasElegidos[0])) : `${diasElegidos.length} días elegidos`;
    const guardadoUnico = diasElegidos.length === 1 ? textoFranjaDia(diasElegidos[0]) : '';
    const hayGuardadas = state.franjas.some((f) => diasElegidos.includes(f.fecha));
    editor = `
      <h3 class="pu-question">${titulo}</h3>
      ${diasElegidos.length > 1 ? `<p style="margin:0 0 8px;font-size:13px">${esc(diasElegidos.map((d) => fechaLarga(d)).join(' · '))}</p>` : ''}
      ${guardadoUnico ? `<p style="margin:0 0 8px"><strong>Hoy tienes guardado:</strong> ${esc(guardadoUnico)}</p>` : ''}
      <div class="pu-options" id="ar-tipo-franja">
        <button type="button" class="pu-option ${disponible ? 'activa' : ''}" data-tipo="disponible" aria-pressed="${disponible}">${disponible ? '✓' : '○'} Solo puedo en estas franjas</button>
        <button type="button" class="pu-option ${!disponible ? 'activa' : ''}" data-tipo="bloqueo" aria-pressed="${!disponible}">${!disponible ? '✓' : '○'} No puedo en estas franjas</button>
      </div>
      <p style="margin:8px 0 0;font-size:13px">${disponible ? `${diasElegidos.length > 1 ? 'Esos días' : 'Ese día'} solo se ofrecerán visitas dentro de ${state.maxFranjas === 1 ? 'la franja' : `hasta ${state.maxFranjas} franjas`} (por ejemplo, de 2 horas). Dentro de cada franja pueden atenderse varias personas, una tras otra.` : 'En esas franjas no se ofrecerá ninguna visita.'}</p>
      ${rangos}
      ${state.franjaRangos.length < state.maxFranjas ? `<button type="button" class="pu-main" id="ar-mas-rango" style="${estiloSecundario}">Agregar otra franja</button>` : ''}
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-guardar-franjas" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Guardando…' : diasElegidos.length > 1 ? `Guardar en los ${diasElegidos.length} días` : 'Guardar franjas de este día'}</button>
      ${hayGuardadas ? `<button class="pu-main" type="button" id="ar-borrar-franjas" style="${estiloSecundario}" ${state.ocupado ? 'disabled' : ''}>${diasElegidos.length > 1 ? 'Quitar las franjas de estos días' : 'Quitar las franjas de este día'}</button>` : ''}`;
  }

  return `
    <div class="pu-card">
      <h2 style="margin-top:0">Tus visitas en tu ${esc(state.tipo)}</h2>
      <p style="font-size:13px">${i.direccion ? esc(i.direccion) : 'Inmueble ' + esc(i.numero)}${i.zona ? ' · ' + esc(i.zona) : ''}</p>
      ${lista}
    </div>
    ${exito()}
    <div class="pu-card" id="ar-card-dia">
      <h3 style="margin-top:0">No puedo ese día</h3>
      <p>Elige el día (o varios a la vez) y marca las franjas en las que <strong>sí</strong> (o <strong>no</strong>) puedes recibir. Le pedimos a cada persona con visita esos días que elija otra hora y le damos un plazo; <strong>si no la elige, su visita se cancela sola</strong>. Así no tienes que responder visita por visita.</p>
      ${strip}
      ${editor}
    </div>
    ${bloquePausa()}`;
}

// «No puedo recibir visitas por un tiempo»: acción grande, así que pide confirmar en una pantalla que dice las consecuencias.
function bloquePausa() {
  const afectadas = state.citasInm.filter((c) => state.pausaDesde && state.pausaHasta && c.fecha >= state.pausaDesde && c.fecha <= state.pausaHasta).length;
  const dias = state.pausaDesde && state.pausaHasta ? Math.round((fechaDe(state.pausaHasta) - fechaDe(state.pausaDesde)) / 86400000) + 1 : 0;
  const rango = state.pausaDesde && state.pausaHasta ? (state.pausaDesde === state.pausaHasta ? esc(fechaLarga(state.pausaDesde)) : `del ${esc(fechaLarga(state.pausaDesde))} al ${esc(fechaLarga(state.pausaHasta))}`) : '';
  if (state.pausaConfirmar) {
    return `
    <div class="pu-card" id="ar-card-pausa" style="border-color:#b3261e">
      <h3 style="margin-top:0">¿Pausar las visitas ${rango}?</h3>
      <p>Durante ${dias === 1 ? 'ese día' : `esos ${dias} días`} no se ofrecerá ningún horario para tu ${esc(state.tipo)}.</p>
      <p>${afectadas ? `Hay <strong>${afectadas} ${afectadas === 1 ? 'visita' : 'visitas'}</strong> en esas fechas: le pedimos a cada persona que elija otra hora fuera de la pausa y le damos un plazo. <strong>Si no la elige, su visita se cancela sola.</strong>` : 'No tienes visitas programadas en esas fechas.'}</p>
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-pausa-si" style="background:#b3261e;color:#fff" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Pausando…' : 'Sí, pausar las visitas'}</button>
      <button class="pu-main" type="button" id="ar-pausa-volver" style="${estiloSecundario}" ${state.ocupado ? 'disabled' : ''}>Volver</button>
    </div>`;
  }
  return `
    <div class="pu-card" id="ar-card-pausa">
      <h3 style="margin-top:0">No puedo recibir visitas por un tiempo</h3>
      <p>Pausa las visitas hasta por ${state.maxDiasPausa} días seguidos (por ejemplo, por un viaje o una remodelación). Si necesitas más tiempo, habla con tu asesor.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px"><label for="ar-pausa-desde">Desde</label><input id="ar-pausa-desde" type="date" min="${esc(state.hoy)}" value="${esc(state.pausaDesde)}"></div>
        <div style="flex:1;min-width:140px"><label for="ar-pausa-hasta">Hasta</label><input id="ar-pausa-hasta" type="date" min="${esc(state.pausaDesde || state.hoy)}" value="${esc(state.pausaHasta)}"></div>
      </div>
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-pausa-revisar">Revisar y pausar</button>
    </div>`;
}

function fechasCandidatas() {
  const permitidos = esArrendatario() ? state.inmueble.dias_permitidos || [] : [];
  const out = [];
  for (let n = 0; n < DIAS_A_MOSTRAR; n++) {
    const f = fechaDe(state.primeraFecha || state.hoy);
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
            `<div class="pu-fecha ${iso(f) === state.fechaSel ? 'activa' : ''}" data-fecha="${iso(f)}" role="button" tabindex="0"><span>${DIAS_CORTO[f.getDay()]}</span><strong>${f.getDate()}</strong><span>${MESES[f.getMonth()].slice(0, 3)}</span></div>`,
        )
        .join('')}</div>`
    : `<p class="pu-vacio">No hay días permitidos configurados. Actualiza primero el horario en que se puede mostrar tu ${esc(state.tipo)}.</p>`;
  let slots = '';
  if (state.fechaSel) {
    if (state.horas === null) slots = `<div class="pu-spinner">Buscando horarios…</div>`;
    else if (!state.horas.length) slots = `<p class="pu-vacio">No hay horarios libres ese día. Prueba con otro día.</p>`;
    else
      slots = `<div class="pu-slots" id="ar-slots">${state.horas
        .map((h) => `<div class="pu-slot ${h.hora_inicio === state.horaSel ? 'activo' : ''}" data-hora="${h.hora_inicio}" role="button" tabindex="0">${esc(hora12(h.hora_inicio))}</div>`)
        .join('')}</div>`;
  }
  return `
    ${tarjetaVisita()}
    <div class="pu-card">
      <h3 style="margin-top:0">${cambioDirecto() ? 'Elige la nueva hora de tu visita' : 'Elige la hora que propones'}</h3>
      <p>Solo aparecen horas en las que un asesor puede atender${esArrendatario() ? ` y que están dentro del horario permitido de tu ${esc(state.tipo)}` : ''}. ${cambioDirecto() ? 'Al confirmar, tu visita pasa a esa hora y te enviamos la confirmación por correo.' : esArrendatario() ? 'Al enviarla, la visita ya no queda en la hora original: la persona interesada deberá aceptar tu hora o elegir otra antes de un plazo; si no lo hace, la visita se cancela.' : 'El arrendatario deberá aceptarla; la visita no cambia hasta entonces.'}</p>
      ${strip}
      ${slots}
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-confirmar-proponer" ${!state.horaSel || state.ocupado ? 'disabled' : ''}>${state.ocupado ? (cambioDirecto() ? 'Cambiando…' : 'Enviando…') : state.horaSel ? `${cambioDirecto() ? 'Cambiar a' : 'Proponer'} ${esc(fechaLarga(state.fechaSel))}, ${esc(hora12(state.horaSel))}` : 'Elige un horario'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="${estiloSecundario}">Volver</button>
    </div>`;
}

function vistaCancelar() {
  return `
    ${tarjetaVisita()}
    <div class="pu-card">
      <h3 style="margin-top:0">${esArrendatario() ? '¿Cancelar esta visita?' : '¿Cancelar tu visita?'}</h3>
      <p>${
        esArrendatario()
          ? 'Esta visita se cancela y avisaremos a la persona interesada para que agende otra. Si solo necesitas otra hora, vuelve y usa "Puedo, pero a otra hora": así ella elige una nueva hora sin perder su turno.'
          : `Avisaremos al propietario${state.rentando ? ' y al arrendatario' : ''} y la visita se quitará del calendario de tu teléfono. Si solo necesitas otra hora, mejor cámbiala.`
      }</p>
      <label for="ar-motivo">Motivo (opcional)</label>
      <textarea id="ar-motivo" rows="3" maxlength="300" placeholder="${esArrendatario() ? 'Ej: ese día no estaremos en casa' : 'Ej: ya encontré otro inmueble'}">${esc(state.motivo)}</textarea>
      ${errorBloque()}
      <button class="pu-main" type="button" id="ar-confirmar-cancelar" style="background:#b3261e;color:#fff" ${state.ocupado ? 'disabled' : ''}>${state.ocupado ? 'Cancelando…' : esArrendatario() ? 'Sí, cancelar la visita' : 'Sí, cancelar mi visita'}</button>
      <button class="pu-main" type="button" id="ar-volver" style="${estiloSecundario}">No, volver</button>
    </div>`;
}

function vistaCancelada() {
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>${state.recienCancelada ? 'Visita cancelada' : 'Esta visita está cancelada'}</h2>
      <p>${
        state.recienCancelada
          ? esArrendatario() ? 'Ya avisamos a la persona interesada.' : 'Te enviamos un correo de constancia. Cuando quieras, puedes agendar otra visita.'
          : 'Ya no hay nada que hacer con este enlace para esta visita.'
      }</p>
      ${!esArrendatario() && state.inmueble?.numero ? `<p><a class="pu-main" href="/inmuebles/${esc(state.inmueble.numero)}" style="display:block;text-align:center;text-decoration:none">Agendar otro horario</a></p>` : ''}
    </div>
    ${exito()}${bloqueHorarioPermitido()}`;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No pudimos cargar la página. Revisa tu internet e inténtalo otra vez en unos minutos.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'cargando') html = `<div class="pu-spinner">Cargando…</div>`;
  else if (state.paso === 'error') html = `<div class="pu-error">${esc(state.errorMsg)}</div>`;
  else if (state.vista === 'proponer') html = vistaProponer();
  else if (state.vista === 'cancelar') html = vistaCancelar();
  else if (state.vista === 'cancelada') html = vistaCancelada();
  else if (state.vista === 'inmueble') html = vistaInmueble();
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
    if (cambioDirecto()) {
      await llamar('reagendar', { fecha: state.fechaSel, hora: state.horaSel });
      await recargar();
      state.mensaje = `Listo: tu visita quedó para el ${fechaLarga(state.cita.fecha)} a las ${hora12(state.cita.hora_inicio).replace(/\.$/, '')}. Te enviamos la confirmación por correo.`;
      state.ocupado = false;
      state.vista = 'resumen';
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    await llamar('proponer', { fecha: state.fechaSel, hora: state.horaSel });
    await recargar();
    state.mensaje = esArrendatario()
      ? `Enviamos tu propuesta (${fechaLarga(state.propuesta?.fecha || state.fechaSel)}, ${hora12(state.propuesta?.hora_inicio || state.horaSel)}). La persona interesada debe aceptarla o elegir otra hora${state.reubicacionVence ? ` antes del ${state.reubicacionVence}` : ' en el plazo que le dimos'}; si no lo hace, la visita se cancela sola.`
      : `Enviamos tu propuesta (${fechaLarga(state.propuesta?.fecha || state.fechaSel)}, ${hora12(state.propuesta?.hora_inicio || state.horaSel)}). La visita solo cambia cuando el arrendatario la acepte.`;
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
      ? `Listo: la visita quedó en firme para el ${fechaLarga(state.cita.fecha)} a las ${hora12(state.cita.hora_inicio).replace(/\.$/, '')}.`
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

// Pausa de visitas: primero se revisa (pantalla de confirmación con las consecuencias) y solo entonces se ejecuta.
function revisarPausa() {
  state.errorForm = '';
  state.mensaje = '';
  if (!state.pausaDesde || !state.pausaHasta) { state.errorForm = 'Elige desde qué día y hasta qué día.'; return render(); }
  if (state.pausaHasta < state.pausaDesde) { state.errorForm = 'El último día no puede ser anterior al primero.'; return render(); }
  const dias = Math.round((fechaDe(state.pausaHasta) - fechaDe(state.pausaDesde)) / 86400000) + 1;
  if (dias > state.maxDiasPausa) { state.errorForm = `La pausa puede durar hasta ${state.maxDiasPausa} días. Si necesitas más tiempo, habla con tu asesor.`; return render(); }
  state.pausaConfirmar = true;
  render();
}

async function confirmarPausa() {
  state.ocupado = true;
  state.errorForm = '';
  render();
  try {
    const d = await llamar('pausar', { desde: state.pausaDesde, hasta: state.pausaHasta });
    await recargar();
    state.mensaje = `Pausamos las visitas del ${fechaLarga(state.pausaDesde)} al ${fechaLarga(state.pausaHasta)}.${d.afectadas ? ` Le pedimos a ${d.afectadas === 1 ? 'la persona con una visita' : `las ${d.afectadas} personas con visita`} en esas fechas que elija${d.afectadas === 1 ? '' : 'n'} otra hora; si no lo hace${d.afectadas === 1 ? '' : 'n'} a tiempo, la visita se cancela sola.` : ' No tenías visitas programadas en esas fechas.'}`;
    state.pausaDesde = '';
    state.pausaHasta = '';
    state.pausaConfirmar = false;
  } catch (e) {
    state.errorForm = e.message;
  }
  state.ocupado = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function alternarFechaFranja(fecha) {
  state.errorForm = '';
  state.mensaje = '';
  state.franjaFechas = state.franjaFechas.includes(fecha) ? state.franjaFechas.filter((f) => f !== fecha) : [...state.franjaFechas, fecha];
  if (state.franjaFechas.length && !state.franjaRangos.length) state.franjaRangos = [{ desde: '08:00', hasta: '10:00' }];
  render();
}

function elegirFechaFranja(fecha) {
  state.franjaFecha = fecha;
  state.errorForm = '';
  state.mensaje = '';
  const del = state.franjas.filter((f) => f.fecha === fecha);
  if (del.length) {
    state.franjaTipo = del[0].tipo;
    state.franjaRangos = del.map((f) => ({ desde: f.desde, hasta: f.hasta }));
  } else {
    state.franjaTipo = 'disponible';
    state.franjaRangos = [{ desde: '08:00', hasta: '10:00' }];
  }
  render();
}

async function guardarFranjas() {
  state.errorForm = '';
  state.mensaje = '';
  for (const r of state.franjaRangos) {
    if (!r.desde || !r.hasta || r.desde >= r.hasta) {
      state.errorForm = 'En cada franja, la hora "desde" debe ser anterior a "hasta".';
      return render();
    }
  }
  const fechasElegidas = state.franjaMulti ? [...state.franjaFechas].sort() : [state.franjaFecha];
  if (!fechasElegidas.length || !fechasElegidas[0]) {
    state.errorForm = 'Elige al menos un día.';
    return render();
  }
  state.ocupado = true;
  render();
  try {
    const d = await llamar('ventanas_guardar', { fechas: fechasElegidas, tipo: state.franjaTipo, ventanas: state.franjaRangos });
    const fecha = state.franjaFecha;
    const rangos = state.franjaRangos;
    const tipo = state.franjaTipo;
    await recargar();
    if (state.franjaMulti) {
      state.franjaRangos = rangos;
      state.franjaTipo = tipo;
    } else {
      state.franjaFecha = fecha;
      elegirFechaFranja(fecha);
    }
    state.mensaje = `Guardamos tus franjas ${fechasElegidas.length > 1 ? `de ${fechasElegidas.length} días` : `del ${fechaLarga(fecha)}`}.${d.afectadas ? ` Hay ${d.afectadas === 1 ? 'una visita' : `${d.afectadas} visitas`} fuera de ellas: ya le pedimos a ${d.afectadas === 1 ? 'esa persona' : 'esas personas'} que elija${d.afectadas === 1 ? '' : 'n'} otro turno dentro de tus franjas.` : ' Ninguna visita tuya queda fuera de ellas.'}`;
  } catch (e) {
    state.errorForm = e.message;
  }
  state.ocupado = false;
  render();
  if (state.mensaje) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function borrarFranjas() {
  state.errorForm = '';
  state.ocupado = true;
  render();
  try {
    const fechasElegidas = state.franjaMulti ? [...state.franjaFechas].sort() : [state.franjaFecha];
    const fecha = state.franjaFecha;
    await llamar('ventanas_borrar', { fechas: fechasElegidas });
    await recargar();
    if (!state.franjaMulti) elegirFechaFranja(fecha);
    state.mensaje = fechasElegidas.length > 1 ? `Quitamos las franjas de ${fechasElegidas.length} días.` : `Quitamos las franjas del ${fechaLarga(fechasElegidas[0])}.`;
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
  state.primeraFecha = null;
  render();
  window.scrollTo({ top: 0 });
  if (vista === 'proponer') abrirEnPrimeraFecha();
}

// Al abrir «elegir hora», se salta solo a la primera fecha con horarios libres (respeta «citas desde», días permitidos y franjas).
async function abrirEnPrimeraFecha() {
  try {
    const d = await llamar('primera_fecha');
    if (state.vista !== 'proponer' || !d.fecha) return;
    state.primeraFecha = d.fecha;
    state.fechaSel = d.fecha;
    await cargarHoras();
  } catch {
    /* si falla, la persona puede elegir el día a mano */
  }
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
  por('ar-pausa-desde')?.addEventListener('change', (e) => {
    state.pausaDesde = e.target.value;
    if (!state.pausaHasta || state.pausaHasta < state.pausaDesde) state.pausaHasta = state.pausaDesde;
    render();
  });
  por('ar-pausa-hasta')?.addEventListener('change', (e) => { state.pausaHasta = e.target.value; });
  por('ar-pausa-revisar')?.addEventListener('click', revisarPausa);
  por('ar-pausa-volver')?.addEventListener('click', () => { state.pausaConfirmar = false; state.errorForm = ''; render(); });
  por('ar-pausa-si')?.addEventListener('click', confirmarPausa);
  por('ar-guardar-franjas')?.addEventListener('click', guardarFranjas);
  por('ar-borrar-franjas')?.addEventListener('click', borrarFranjas);
  por('ar-mas-rango')?.addEventListener('click', () => {
    state.franjaRangos = [...state.franjaRangos, { desde: '14:00', hasta: '16:00' }];
    render();
  });
  document.querySelectorAll('[data-quitar-rango]').forEach((b) => {
    b.addEventListener('click', () => {
      state.franjaRangos = state.franjaRangos.filter((_, k) => k !== Number(b.dataset.quitarRango));
      render();
    });
  });
  document.querySelectorAll('input[data-rango]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state.franjaRangos[Number(inp.dataset.rango)][inp.dataset.lado] = inp.value;
    });
  });
  document.querySelectorAll('#ar-tipo-franja .pu-option').forEach((b) => {
    b.addEventListener('click', () => {
      state.franjaTipo = b.dataset.tipo;
      render();
    });
  });
  document.querySelectorAll('#ar-fechas-franja .pu-fecha').forEach((el) => {
    el.addEventListener('click', () => (state.franjaMulti ? alternarFechaFranja(el.dataset.fecha) : elegirFechaFranja(el.dataset.fecha)));
  });
  por('ar-multi')?.addEventListener('click', () => {
    state.franjaMulti = !state.franjaMulti;
    state.errorForm = '';
    state.mensaje = '';
    state.franjaFechas = state.franjaMulti && state.franjaFecha ? [state.franjaFecha] : [];
    if (state.franjaMulti && !state.franjaRangos.length) state.franjaRangos = [{ desde: '08:00', hasta: '10:00' }];
    render();
  });
  por('ar-multi-habiles')?.addEventListener('click', () => {
    const habiles = [];
    for (let n = 0; n < DIAS_A_MOSTRAR; n++) {
      const f = fechaDe(state.hoy);
      f.setDate(f.getDate() + n);
      const dow = f.getDay();
      if (dow >= 1 && dow <= 5) habiles.push(iso(f));
    }
    state.franjaFechas = habiles;
    if (!state.franjaRangos.length) state.franjaRangos = [{ desde: '08:00', hasta: '10:00' }];
    state.errorForm = '';
    render();
  });
  por('ar-multi-limpiar')?.addEventListener('click', () => {
    state.franjaFechas = [];
    render();
  });
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

aplicarMarcaPublica();
cargar();
