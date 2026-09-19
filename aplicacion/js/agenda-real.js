import { supabase } from './cliente-supabase.js';
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  createIcons,
  ExternalLink,
  House,
  Plus,
  Search,
  Store,
  UserRound,
  Users,
} from 'lucide';

const icons = {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  ExternalLink,
  House,
  Plus,
  Search,
  Store,
  UserRound,
  Users,
};

let iniciada = false;
let contexto = null; // { empresaId, rol, nombreEmpresa }
let inmueblesCache = null;
let asesoresCache = null;
let configPublicaCache = null;
let buscarInmueblesDebounce = null;

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const hora = (t) => (t ? String(t).slice(0, 5) : '');
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const addDiasISO = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateLabel = (iso) => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const DIAS_CORTOS_LUN = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const inicioSemanaISO = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=domingo..6=sábado
  const offset = dow === 0 ? -6 : 1 - dow; // la semana empieza en lunes
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const addMesesISO = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const mesLabel = (iso) => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

export function detenerAgendaReal() {
  iniciada = false;
  contexto = null;
  inmueblesCache = null;
  todosInmueblesCache = null;
  asesoresCache = null;
  configPublicaCache = null;
}

export function iniciarAgendaReal(acceso) {
  const membresia = acceso?.membresia;
  if (!membresia?.empresa?.id) return;
  contexto = { empresaId: membresia.empresa.id, rol: membresia.rol, nombreEmpresa: membresia.empresa.nombre };
  inmueblesCache = null;
  todosInmueblesCache = null;
  asesoresCache = null;
  configPublicaCache = null;
  cargarDominioPublico();

  const root = document.getElementById('visita-app');
  const insignia = root.querySelector('.v-header .v-demo');
  if (insignia) insignia.textContent = 'Datos reales';
  const pie = root.querySelector('.v-footnote');
  if (pie) pie.textContent = 'Datos reales · las citas y cancelaciones se guardan en Supabase';
  root.querySelectorAll('[data-view]').forEach((b) => {
    const textoIcono = b.querySelector('i');
    const etiqueta = b.dataset.view === 'agenda' ? 'Agenda' : b.dataset.view === 'properties' ? 'Inmuebles' : 'Equipo';
    b.textContent = '';
    if (textoIcono) b.appendChild(textoIcono);
    b.appendChild(document.createTextNode(etiqueta));
    // Mientras se confirma la configuración real de la empresa, se asume el valor
    // por defecto (Equipo solo para administradores) para evitar que se vea un
    // instante y luego se oculte.
    if (b.dataset.view === 'team') b.hidden = contexto.rol !== 'administrador';
  });

  state.view = 'agenda';
  state.fecha = hoyISO();
  state.inmueble = null;
  state.slot = null;
  state.cliente = '';
  state.telefono = '';
  state.correo = '';

  if (iniciada) {
    render();
    return;
  }
  iniciada = true;
  adjuntarEventos(root);
  render();
}

const state = {
  view: 'agenda',
  vistaAgenda: 'dia', // dia | semana | mes
  fecha: hoyISO(),
  asesorFiltro: 'all',
  query: '',
  ciudadFiltro: 'all',
  modoFiltro: 'all',
  pagina: 0,
  limite: 6,
  inmueble: null,
  fechaVisita: null,
  slots: [],
  slot: null,
  cargandoSlots: false,
  cliente: '',
  telefono: '',
  correo: '',
  cancelId: null,
  successId: null,
  citasHoy: [],
  cargandoCitas: false,
  errorReserva: '',
  moveId: null,
  moveFecha: '',
  moveHora: '',
  moveError: '',
  completarId: null,
  interna: { tipo: 'inventario', asesorId: '', inmuebleId: '', direccionLibre: '', ciudadLibre: '', fecha: hoyISO(), hora: '09:00', duracion: '', titulo: '', notas: '' },
  errorInterna: '',
  restriccionId: null,
  errorRestriccion: '',
};

const TIPOS_CITA = {
  visita_cliente: 'Visita con cliente',
  inventario: 'Inventario',
  inspeccion: 'Inspección / revisión',
  captacion: 'Captación de inmueble nuevo',
  otro: 'Otra actividad',
};

async function cargarDominioPublico() {
  if (configPublicaCache !== null) return configPublicaCache;
  const { data } = await supabase
    .from('agenda_configuracion')
    .select('dominio_publico, plantilla_enlace_inmueble, formato_hora, equipo_visible_roles')
    .eq('empresa_id', contexto.empresaId)
    .maybeSingle();
  configPublicaCache = {
    dominioPublico: data?.dominio_publico || 'citas.patrimonios.co',
    plantillaEnlaceInmueble: data?.plantilla_enlace_inmueble || '',
    formatoHora: data?.formato_hora === '24h' ? '24h' : '12h',
    equipoVisibleRoles: Array.isArray(data?.equipo_visible_roles) && data.equipo_visible_roles.length
      ? data.equipo_visible_roles
      : ['administrador'],
  };
  aplicarVisibilidadEquipo();
  return configPublicaCache;
}

// Muestra u oculta el botón "Equipo" de la navegación interna según el rol del
// usuario actual y la lista de roles configurada por la empresa. Se llama con el
// valor por defecto (solo administradores) apenas se conoce el rol, y de nuevo
// cuando termina de cargar (o se invalida) la configuración real de la empresa.
function aplicarVisibilidadEquipo() {
  if (!contexto) return;
  const root = document.getElementById('visita-app');
  const botonEquipo = root?.querySelector('[data-view="team"]');
  if (!botonEquipo) return;
  const roles = configPublicaCache?.equipoVisibleRoles || ['administrador'];
  const visible = roles.includes(contexto.rol);
  botonEquipo.hidden = !visible;
  if (!visible && state.view === 'team') {
    state.view = 'agenda';
    render();
  }
}

// Permite que otros módulos (p. ej. Configuración) avisen que el dominio público,
// el enlace del inmueble, el formato de hora o los roles con acceso a Equipo
// cambiaron, para que la vista no quede con el valor viejo hasta cerrar sesión.
export function invalidarDominioPublico() {
  configPublicaCache = null;
  if (contexto) cargarDominioPublico();
}

function linkPublico(numeroInmueble) {
  const plantilla = configPublicaCache?.plantillaEnlaceInmueble;
  if (plantilla && plantilla.includes('{numero}')) {
    return plantilla.replace(/\{numero\}/g, numeroInmueble);
  }
  const dominio = configPublicaCache?.dominioPublico || 'citas.patrimonios.co';
  return `https://${dominio}/inmuebles/${numeroInmueble}`;
}

function esMensajeTecnico(msg) {
  return /function|candidate|relation|column|syntax|operator|schema|constraint|duplicate key|null value|permission denied|violates|uuid|pg_|does not exist/i.test(msg || '');
}

function mensajeAmigable(error, generico) {
  const msg = error?.message || '';
  if (!msg || esMensajeTecnico(msg)) return generico;
  return msg;
}

function horaFmt(t) {
  const h24 = hora(t);
  if (!h24) return '';
  if ((configPublicaCache?.formatoHora || '12h') === '24h') return h24;
  const [hh, mm] = h24.split(':').map(Number);
  const ampm = hh >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

async function cargarInmuebles() {
  if (inmueblesCache) return inmueblesCache;
  const { data, error } = await supabase
    .from('agenda_inmuebles')
    .select('*')
    .eq('empresa_id', contexto.empresaId)
    .eq('disponible', true)
    .order('numero_inmueble');
  if (error) throw new Error('No se pudo cargar el inventario: ' + error.message);
  inmueblesCache = data || [];
  return inmueblesCache;
}

let todosInmueblesCache = null;
async function cargarTodosInmuebles() {
  if (todosInmueblesCache) return todosInmueblesCache;
  const { data, error } = await supabase
    .from('agenda_inmuebles')
    .select('*')
    .eq('empresa_id', contexto.empresaId)
    .order('numero_inmueble');
  if (error) throw new Error('No se pudo cargar el inventario: ' + error.message);
  todosInmueblesCache = data || [];
  return todosInmueblesCache;
}

async function cargarAsesores() {
  if (asesoresCache) return asesoresCache;
  const { data, error } = await supabase
    .from('agenda_asesores')
    .select('*, agenda_asesores_ciudades(agenda_ciudades(nombre))')
    .eq('empresa_id', contexto.empresaId)
    .order('nombre');
  if (error) throw new Error('No se pudo cargar el equipo: ' + error.message);
  asesoresCache = (data || []).map((a) => ({
    ...a,
    ciudadesTexto: (a.agenda_asesores_ciudades || []).map((x) => x.agenda_ciudades?.nombre).filter(Boolean).join(', ') || 'Sin ciudad asignada',
  }));
  return asesoresCache;
}

async function cargarCitas(fecha) {
  const { data, error } = await supabase
    .from('agenda_citas')
    .select('*, agenda_inmuebles(*), agenda_asesores(*)')
    .eq('empresa_id', contexto.empresaId)
    .eq('fecha', fecha)
    .neq('estado', 'cancelada')
    .order('hora_inicio');
  if (error) throw new Error('No se pudieron cargar las citas: ' + error.message);
  return data || [];
}

async function cargarCitasRango(fechaInicio, fechaFin) {
  const { data, error } = await supabase
    .from('agenda_citas')
    .select('*, agenda_inmuebles(*), agenda_asesores(*)')
    .eq('empresa_id', contexto.empresaId)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
    .neq('estado', 'cancelada')
    .order('fecha')
    .order('hora_inicio');
  if (error) throw new Error('No se pudieron cargar las citas: ' + error.message);
  return data || [];
}

function root() {
  return document.getElementById('visita-app');
}
function main() {
  return root().querySelector('#v-main');
}
function toast(texto) {
  const t = root().querySelector('#v-toast');
  if (t) t.textContent = texto || '';
}
function refreshIcons() {
  createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
}
function nav() {
  root()
    .querySelectorAll('[data-view]')
    .forEach((b) => {
      const activo = b.dataset.view === state.view || (state.view === 'reserva' && b.dataset.view === 'properties');
      if (activo) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
}
function setView(view) {
  state.view = view;
  state.cancelId = null;
  state.pagina = 0;
  toast('');
  render();
}

async function render() {
  nav();
  try {
    if (state.view === 'agenda') await renderAgenda();
    else if (state.view === 'interna') await renderInterna();
    else if (state.view === 'properties') await renderInmuebles();
    else if (state.view === 'team') await renderEquipo();
    else if (state.view === 'reserva') await renderReserva();
    else if (state.view === 'exito') renderExito();
  } catch (error) {
    main().innerHTML = `<div class="v-empty">${icon('calendar-days')}<h3>No se pudo cargar</h3><p style="margin-top:8px">${escape(error.message)}</p></div>`;
  }
  refreshIcons();
}

function citaCard(c) {
  const inmueble = c.agenda_inmuebles;
  const asesor = c.agenda_asesores;
  const esInterna = c.tipo_cita && c.tipo_cita !== 'visita_cliente';
  const direccion = inmueble ? inmueble.direccion : (c.direccion_libre || 'Sin dirección');
  const etiquetaTipo = TIPOS_CITA[c.tipo_cita] || TIPOS_CITA.visita_cliente;
  return `<article class="v-appt" style="--advisor-color:${asesor?.color || '#64748b'}"><div class="v-time">${horaFmt(c.hora_inicio)}<small>${horaFmt(c.hora_fin)}</small></div><div class="v-apptbody">
    <div class="v-between"><span class="v-muted" style="font-size:13px">${inmueble ? '#' + inmueble.numero_inmueble + ' · ' + inmueble.tipo_oferta : (esInterna ? escape(c.ciudad_libre || '') : 'Inmueble no disponible')}</span><span class="v-tag ${c.estado === 'completada' ? 'v-tag-neutral' : ''}">${c.estado === 'completada' ? 'Realizada' : 'Confirmada'}</span></div>
    ${esInterna ? `<span class="v-tag v-tag-neutral" style="margin-top:6px">${escape(etiquetaTipo)}</span>` : ''}
    <h3 style="margin-top:6px">${escape(esInterna && c.titulo ? c.titulo : direccion)}</h3>
    <div class="v-apptmeta"><span>${esInterna ? escape(direccion) : escape(c.cliente_nombre)}</span></div>
    <div class="v-row"><span class="v-avatar">${asesor ? escape(asesor.nombre.slice(0, 1)) : '?'}</span><span class="v-advisorname">${asesor ? escape(asesor.nombre) : 'Sin asesor'}${asesor && asesor.tipo_vinculacion === 'freelance' ? ' · freelance' : ''}</span></div>
    ${inmueble ? `<a class="v-link" href="${linkPublico(inmueble.numero_inmueble)}" target="_blank" rel="noopener">${icon('external-link')}Ver inmueble</a>` : ''}
    ${c.estado === 'completada' ? (c.feedback_cliente ? `<p class="v-muted" style="margin-top:8px;font-size:12.5px">Comentario del cliente: ${escape(c.feedback_cliente)}</p>` : '') : `<div class="v-actions"><button data-completar="${c.id}">Realizada</button><button data-mover="${c.id}">Mover</button><button class="v-danger" data-cancelar="${c.id}">Cancelar</button></div>`}
    ${state.moveId === c.id ? `<div class="v-cancelbox"><label class="v-field">Nueva fecha<input type="date" id="v-mover-fecha" class="v-input" value="${state.moveFecha}"></label><label class="v-field">Nueva hora<input type="time" id="v-mover-hora" class="v-input" value="${state.moveHora}"></label>${state.moveError ? `<p class="v-error">${escape(state.moveError)}</p>` : ''}<div class="v-actions"><button class="v-primary" data-confirmarmover="${c.id}">Guardar nuevo horario</button><button data-mantener="${c.id}">Cancelar</button></div></div>` : ''}
    ${state.cancelId === c.id ? `<div class="v-cancelbox">¿Cancelar esta ${esInterna ? 'actividad' : 'visita'} y liberar el horario?<div class="v-actions"><button class="v-danger" data-confirmarcancelar="${c.id}">Sí, cancelar</button><button data-mantener="${c.id}">Conservar</button></div></div>` : ''}
    ${state.completarId === c.id ? `<div class="v-cancelbox"><label class="v-field">¿Qué dijo el cliente? (para el informe al propietario)<textarea id="v-feedback-texto" class="v-input" rows="3" placeholder="Ej: le gustó mucho, va a decidir con su familia…"></textarea></label><div class="v-actions"><button class="v-primary" data-guardarrealizada="${c.id}">Guardar y marcar como realizada</button><button data-mantener="${c.id}">Cancelar</button></div></div>` : ''}
  </div></article>`;
}

function citaChip(c) {
  const inmueble = c.agenda_inmuebles;
  const asesor = c.agenda_asesores;
  const esInterna = c.tipo_cita && c.tipo_cita !== 'visita_cliente';
  const etiqueta = inmueble ? '#' + inmueble.numero_inmueble : escape(c.titulo || (TIPOS_CITA[c.tipo_cita] || 'Actividad'));
  const titulo = `${asesor ? asesor.nombre : 'Sin asesor'} · ${horaFmt(c.hora_inicio)}${inmueble ? ' · #' + inmueble.numero_inmueble : ''}`;
  return `<button type="button" class="v-chip" data-verdia="${c.fecha}" title="${escape(titulo)}" style="--advisor-color:${asesor?.color || '#64748b'}"><span class="v-chipdot"></span><span class="v-chiptime">${horaFmt(c.hora_inicio)}</span><span class="v-chiptxt">${etiqueta}</span></button>`;
}

function leyendaAsesores(asesores) {
  if (!asesores.length) return '';
  return `<div class="v-legend">${asesores.map((a) => `<span class="v-legenditem"><span class="v-dot" style="background:${a.color || '#94a3b8'}"></span>${escape(a.nombre)}</span>`).join('')}</div>`;
}

function selectorAsesor(asesores) {
  return `<label class="v-field" for="v-asesor">Ver agenda de<select id="v-asesor" class="v-input"><option value="all">Todo el equipo</option>${asesores.map((a) => `<option value="${a.id}" ${state.asesorFiltro === a.id ? 'selected' : ''}>${escape(a.nombre)}${a.tipo_vinculacion === 'freelance' ? ' · freelance' : ''}</option>`).join('')}</select></label>`;
}

async function renderAgenda() {
  const barraAcciones = `<div class="v-top"><div><div class="v-eyebrow">Tu operación, al día</div><h2>Agenda de visitas</h2></div><div class="v-row" style="gap:8px"><button class="v-btn" data-new-interna>${icon('clipboard-list')}Actividad interna</button><button class="v-btn v-primary" data-new>${icon('plus')}Nueva cita</button></div></div>`;
  const selectorVista = `<div class="v-viewtoggle" role="tablist" aria-label="Vista de la agenda"><button data-vista="dia" aria-pressed="${state.vistaAgenda === 'dia'}">Día</button><button data-vista="semana" aria-pressed="${state.vistaAgenda === 'semana'}">Semana</button><button data-vista="mes" aria-pressed="${state.vistaAgenda === 'mes'}">Mes</button></div>`;
  main().innerHTML = barraAcciones + selectorVista + '<p class="v-muted">Cargando…</p>';
  if (state.vistaAgenda === 'semana') await renderAgendaSemana(barraAcciones, selectorVista);
  else if (state.vistaAgenda === 'mes') await renderAgendaMes(barraAcciones, selectorVista);
  else await renderAgendaDia(barraAcciones, selectorVista);
}

async function renderAgendaDia(barraAcciones, selectorVista) {
  const citas = await cargarCitas(state.fecha);
  state.citasHoy = citas;
  const filtradas = state.asesorFiltro === 'all' ? citas : citas.filter((c) => c.asesor_id === state.asesorFiltro);
  const asesores = await cargarAsesores();
  main().innerHTML = barraAcciones + selectorVista + `
    <div class="v-statbar"><div class="v-stat"><strong>${filtradas.length}</strong><span>Citas del día</span></div><div class="v-stat"><strong>${new Set(filtradas.map((c) => c.asesor_id)).size}</strong><span>Asesores con citas</span></div><div class="v-stat"><strong>${filtradas.filter((c) => c.estado === 'completada').length}</strong><span>Realizadas</span></div></div>
    <div class="v-between"><button class="v-iconbtn" data-dia="-1" aria-label="Día anterior">${icon('chevron-left')}</button><h3 style="text-transform:capitalize;margin:0">${dateLabel(state.fecha)}</h3><button class="v-iconbtn" data-dia="1" aria-label="Día siguiente">${icon('chevron-right')}</button></div>
    ${selectorAsesor(asesores)}
    ${state.asesorFiltro === 'all' ? leyendaAsesores(asesores.filter((a) => a.activo)) : ''}
    <div class="v-list">${filtradas.length ? filtradas.map(citaCard).join('') : `<div class="v-empty">${icon('calendar-check')}<h3>Agenda despejada</h3><p style="margin-top:8px">No hay visitas para este día${state.asesorFiltro === 'all' ? '' : ' con este asesor'}.</p><button class="v-btn v-primary" data-new style="margin-top:16px">Agendar una visita</button></div>`}</div>`;
}

async function renderAgendaSemana(barraAcciones, selectorVista) {
  const inicio = inicioSemanaISO(state.fecha);
  const dias = Array.from({ length: 7 }, (_, i) => addDiasISO(inicio, i));
  const fin = dias[6];
  const [citas, asesores] = await Promise.all([cargarCitasRango(inicio, fin), cargarAsesores()]);
  const filtradas = state.asesorFiltro === 'all' ? citas : citas.filter((c) => c.asesor_id === state.asesorFiltro);
  const porDia = {};
  dias.forEach((d) => { porDia[d] = []; });
  filtradas.forEach((c) => { (porDia[c.fecha] ||= []).push(c); });
  const hoy = hoyISO();
  main().innerHTML = barraAcciones + selectorVista + `
    <div class="v-between"><button class="v-iconbtn" data-dia="-1" aria-label="Semana anterior">${icon('chevron-left')}</button><h3 style="margin:0;text-transform:capitalize">${dateLabel(inicio)} – ${dateLabel(fin)}</h3><button class="v-iconbtn" data-dia="1" aria-label="Semana siguiente">${icon('chevron-right')}</button></div>
    ${selectorAsesor(asesores)}
    ${state.asesorFiltro === 'all' ? leyendaAsesores(asesores.filter((a) => a.activo)) : ''}
    <div class="v-week">${dias.map((d) => `<div class="v-weekday ${d === hoy ? 'v-hoy' : ''}"><button type="button" class="v-weekdayhead" data-verdia="${d}">${DIAS_CORTOS_LUN[new Date(d + 'T12:00:00Z').getUTCDay() === 0 ? 6 : new Date(d + 'T12:00:00Z').getUTCDay() - 1]}<strong>${Number(d.slice(8, 10))}</strong></button><div class="v-weeklist">${(porDia[d] || []).length ? porDia[d].map(citaChip).join('') : ''}</div></div>`).join('')}</div>`;
}

async function renderAgendaMes(barraAcciones, selectorVista) {
  const inicioMes = state.fecha.slice(0, 8) + '01';
  const inicioGrid = inicioSemanaISO(inicioMes);
  const dias = Array.from({ length: 42 }, (_, i) => addDiasISO(inicioGrid, i));
  const finGrid = dias[41];
  const [citas, asesores] = await Promise.all([cargarCitasRango(inicioGrid, finGrid), cargarAsesores()]);
  const filtradas = state.asesorFiltro === 'all' ? citas : citas.filter((c) => c.asesor_id === state.asesorFiltro);
  const porDia = {};
  filtradas.forEach((c) => { (porDia[c.fecha] ||= []).push(c); });
  const hoy = hoyISO();
  const mesActual = inicioMes.slice(0, 7);
  main().innerHTML = barraAcciones + selectorVista + `
    <div class="v-between"><button class="v-iconbtn" data-dia="-1" aria-label="Mes anterior">${icon('chevron-left')}</button><h3 style="margin:0;text-transform:capitalize">${mesLabel(inicioMes)}</h3><button class="v-iconbtn" data-dia="1" aria-label="Mes siguiente">${icon('chevron-right')}</button></div>
    ${selectorAsesor(asesores)}
    ${state.asesorFiltro === 'all' ? leyendaAsesores(asesores.filter((a) => a.activo)) : ''}
    <div class="v-monthhead">${DIAS_CORTOS_LUN.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="v-monthgrid">${dias.map((d) => {
      const citasDia = porDia[d] || [];
      const fueraDeMes = d.slice(0, 7) !== mesActual;
      const puntos = citasDia.slice(0, 5).map((c) => `<span class="v-dot" style="background:${c.agenda_asesores?.color || '#94a3b8'}"></span>`).join('');
      const extra = citasDia.length > 5 ? `<span class="v-muted" style="font-size:12px">+${citasDia.length - 5}</span>` : '';
      return `<button type="button" class="v-monthday ${fueraDeMes ? 'v-otromes' : ''} ${d === hoy ? 'v-hoy' : ''}" data-verdia="${d}"><span class="v-monthdaynum">${Number(d.slice(8, 10))}</span><span class="v-monthdots">${puntos}${extra}</span></button>`;
    }).join('')}</div>`;
}

function restriccionResumen(inm) {
  const dias = inm.dias_visita_permitidos && inm.dias_visita_permitidos.length ? inm.dias_visita_permitidos.slice().sort((a, b) => a - b).map((d) => DIAS_CORTOS_LUN[d - 1]).join(', ') : null;
  const horas = inm.hora_visita_desde || inm.hora_visita_hasta ? `${inm.hora_visita_desde ? horaFmt(inm.hora_visita_desde) : 'inicio'}–${inm.hora_visita_hasta ? horaFmt(inm.hora_visita_hasta) : 'cierre'}` : null;
  const duracion = inm.duracion_visita_minutos ? `visitas de ${inm.duracion_visita_minutos} min` : null;
  if (!dias && !horas && !duracion) return 'Sin restricción de horario';
  return [dias, horas, duracion].filter(Boolean).join(' · ');
}

function restriccionEditor(inm) {
  const dias = inm.dias_visita_permitidos || [];
  return `<form id="v-restriccion-form" data-inmueble="${inm.id}" style="margin:10px 0 16px;padding:14px;border:1px solid var(--v-line);border-radius:12px;background:var(--v-tint)">
    <div class="v-sectiontitle" style="margin-bottom:8px">${icon('clock-3')}Restricción de horario para #${inm.numero_inmueble}</div>
    <p class="v-muted" style="font-size:14px;margin-bottom:10px">Limita en qué días y en qué franja horaria se puede agendar una visita a este inmueble. Deja los días sin marcar y las horas vacías para no aplicar ninguna restricción.</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${DIAS_CORTOS_LUN.map((d, i) => `<label class="v-check" style="text-transform:capitalize"><input type="checkbox" name="dia" value="${i + 1}" ${dias.includes(i + 1) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <label class="v-field" style="flex:1;min-width:140px">Desde<input type="time" class="v-input" name="hora_desde" value="${inm.hora_visita_desde ? hora(inm.hora_visita_desde) : ''}"></label>
      <label class="v-field" style="flex:1;min-width:140px">Hasta<input type="time" class="v-input" name="hora_hasta" value="${inm.hora_visita_hasta ? hora(inm.hora_visita_hasta) : ''}"></label>
    </div>
    <label class="v-field" style="margin-top:10px;max-width:220px">Duración de la visita (min)<input type="number" min="1" step="1" class="v-input" name="duracion_minutos" placeholder="Por defecto de la empresa" value="${inm.duracion_visita_minutos || ''}"></label>
    <p class="v-muted" style="font-size:14px;margin:6px 0 0">Úsalo para inmuebles de visita rápida (p. ej. oficinas). Si es menor a la duración por defecto, al cliente se le muestra un aviso para que sea puntual, porque el asesor puede tener otra cita cerca.</p>
    <div id="v-restriccion-error" class="v-error" role="alert">${escape(state.errorRestriccion)}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="v-btn v-primary" type="submit">${icon('check')}Guardar</button><button class="v-btn v-quiet" type="button" data-cerrar-restriccion>Cancelar</button></div>
  </form>`;
}

function inmuebleCard(inm) {
  return `<article class="v-property"><div class="v-propertyhead"><div class="v-building">${icon(inm.tipo_inmueble === 'Casa' ? 'house' : inm.tipo_inmueble === 'Local' ? 'store' : 'building-2')}</div><div style="min-width:0"><div class="v-muted" style="font-size:13px;margin-bottom:3px">#${inm.numero_inmueble} · ${escape(inm.tipo_oferta)}</div><h3>${escape(inm.direccion)}</h3><div class="v-details">${escape(inm.ciudad)}${inm.barrio ? ' · ' + escape(inm.barrio) : ''}${inm.habitaciones ? ' · ' + inm.habitaciones + ' hab.' : ''}</div></div></div>
    <div class="v-between" style="margin-bottom:12px"><div class="v-price">${inm.tipo_oferta === 'Arriendo' ? (inm.valor_canon ? money.format(inm.valor_canon) + '<small> / mes</small>' : 'Sin valor de canon') : inm.valor_venta ? money.format(inm.valor_venta) : 'Sin valor de venta'}</div></div>
    <div class="v-muted" style="font-size:14px;margin-bottom:10px">${icon('clock-3')} ${escape(restriccionResumen(inm))} <button type="button" class="v-link" data-restriccion="${inm.id}" style="margin-left:4px">Editar</button></div>
    ${state.restriccionId === inm.id ? restriccionEditor(inm) : ''}
    <div class="v-cardfoot"><a class="v-btn v-quiet" href="${linkPublico(inm.numero_inmueble)}" target="_blank" rel="noopener">${icon('external-link')}Ver ficha completa</a><span class="v-muted" style="font-size:14px">${inm.asesor_comercializacion ? escape(inm.asesor_comercializacion) : 'Sin asesor asignado en Sedi'}</span><button class="v-btn v-primary" data-reservar="${inm.id}">Ver horarios ${icon('arrow-up-right')}</button></div></article>`;
}

async function renderInmuebles() {
  main().innerHTML = '<p class="v-muted">Cargando inventario…</p>';
  const todos = await cargarInmuebles();
  const q = state.query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const lista = todos.filter(
    (inm) =>
      (state.ciudadFiltro === 'all' || inm.ciudad === state.ciudadFiltro) &&
      (state.modoFiltro === 'all' || inm.tipo_oferta === state.modoFiltro) &&
      `${inm.numero_inmueble} ${inm.direccion} ${inm.ciudad} ${inm.barrio}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .includes(q),
  );
  const ciudades = [...new Set(todos.map((inm) => inm.ciudad).filter(Boolean))].sort();
  const total = Math.max(1, Math.ceil(lista.length / 6));
  state.pagina = Math.min(state.pagina, total - 1);
  const pagina = lista.slice(state.pagina * 6, state.pagina * 6 + 6);

  main().innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Inventario real (Sedi)</div><h2>${todos.length} inmuebles disponibles</h2></div></div>
    <label class="v-field" for="v-search"><div class="v-search"><input id="v-search" class="v-input" value="${escape(state.query)}" placeholder="Número, dirección o barrio…" type="search">${icon('search')}</div></label>
    <div class="v-filters"><select class="v-input" id="v-ciudad" aria-label="Filtrar por ciudad"><option value="all">Todas las ciudades</option>${ciudades.map((c) => `<option ${c === state.ciudadFiltro ? 'selected' : ''}>${escape(c)}</option>`).join('')}</select><select class="v-input" id="v-modo" aria-label="Filtrar por operación"><option value="all">Venta y arriendo</option><option ${state.modoFiltro === 'Arriendo' ? 'selected' : ''}>Arriendo</option><option ${state.modoFiltro === 'Venta' ? 'selected' : ''}>Venta</option></select></div>
    ${todos.length === 0 ? `<div class="v-empty">${icon('building-2')}<h3>Todavía no hay inventario</h3><p style="margin-top:8px">Falta ejecutar la sincronización diaria desde la hoja de Sedi hacia Supabase (sincronizacion/sincronizar-inmuebles.gs).</p></div>` : `<div class="v-between" style="margin:12px 0"><span class="v-muted">${lista.length} resultados</span></div><div class="v-grid">${pagina.map(inmuebleCard).join('')}</div><div class="v-pagination"><button class="v-btn" data-pagina="-1" ${state.pagina === 0 ? 'disabled' : ''}>${icon('chevron-left')}Anterior</button><span>${state.pagina + 1} / ${total}</span><button class="v-btn" data-pagina="1" ${state.pagina >= total - 1 ? 'disabled' : ''}>Siguiente${icon('chevron-right')}</button></div>`}`;
}

async function renderEquipo() {
  main().innerHTML = '<p class="v-muted">Cargando equipo…</p>';
  const asesores = await cargarAsesores();
  main().innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Personas detrás de cada visita</div><h2>Tu equipo</h2><p class="v-muted" style="margin-top:6px">${asesores.filter((a) => a.activo).length} activos de ${asesores.length}</p></div></div>
    ${asesores.length === 0 ? `<div class="v-empty">${icon('users')}<h3>Todavía no hay asesores</h3><p style="margin-top:8px">Se crean desde el panel de Equipo (solo administradores).</p></div>` : `<div class="v-grid">${asesores
      .map(
        (a) =>
          `<article class="v-teamcard"><div class="v-row"><span class="v-avatar" style="background:${a.color || 'var(--v-tint)'};color:#fff">${escape(a.nombre.slice(0, 1))}</span><div><h3>${escape(a.nombre)}</h3><p class="v-muted">${escape(a.ciudadesTexto)}</p></div></div><div class="v-teammeta"><span>${a.tipo_vinculacion === 'planta' ? 'De planta' : 'Freelance'}</span><span>Prioridad ${a.prioridad}</span></div><p class="v-muted" style="font-size:14px;margin:10px 0 0">${horaFmt(a.jornada_inicio)}–${horaFmt(a.jornada_fin)}${a.atiende_sabado ? ' · sábados hasta ' + horaFmt(a.jornada_fin_sabado) : ' · no atiende sábados'}</p><p class="v-muted" style="font-size:14px;margin-top:4px">${a.activo ? 'Activo' : 'Inactivo'}</p></article>`,
      )
      .join('')}</div>`}`;
}

function startReserva(inmuebleId) {
  state.inmueble = inmuebleId;
  state.fechaVisita = hoyISO();
  state.slots = [];
  state.slot = null;
  state.cliente = '';
  state.telefono = '';
  state.correo = '';
  state.errorReserva = '';
  state.buscarPrimerDia = true;
  setView('reserva');
}

function ordenarSlots(data) {
  return (data || []).slice().sort((a, b) => {
    const da = a.distancia_km_mas_cercana ?? 999;
    const db = b.distancia_km_mas_cercana ?? 999;
    if (da !== db) return da - db;
    return a.hora_inicio.localeCompare(b.hora_inicio);
  });
}

async function slotsDelDia(fecha) {
  const { data, error } = await supabase.rpc('agenda_sugerir_horarios', {
    p_empresa_id: contexto.empresaId,
    p_inmueble_id: state.inmueble,
    p_fecha: fecha,
  });
  if (error) return { error };
  return { slots: ordenarSlots(data) };
}

async function cargarSlots() {
  state.cargandoSlots = true;
  state.slots = [];
  state.slot = null;
  // La primera vez que se abre un inmueble, en vez de mostrar "nada disponible" si justo
  // la fecha de hoy no tiene horarios, buscamos hacia adelante el primer día que sí tenga.
  if (state.buscarPrimerDia) {
    state.buscarPrimerDia = false;
    for (let i = 0; i < 14; i++) {
      const fecha = i === 0 ? state.fechaVisita : addDiasISO(state.fechaVisita, i);
      const resultado = await slotsDelDia(fecha);
      if (resultado.error) {
        state.cargandoSlots = false;
        state.errorReserva = mensajeAmigable(resultado.error, 'No se pudieron calcular los horarios. Intenta de nuevo.');
        return;
      }
      if (resultado.slots.length) {
        state.fechaVisita = fecha;
        state.slots = resultado.slots;
        state.cargandoSlots = false;
        return;
      }
    }
    state.cargandoSlots = false;
    return;
  }
  const { error, slots } = await slotsDelDia(state.fechaVisita);
  state.cargandoSlots = false;
  if (error) {
    state.errorReserva = mensajeAmigable(error, 'No se pudieron calcular los horarios. Intenta de nuevo.');
    return;
  }
  state.slots = slots;
}

async function renderReserva() {
  const todos = await cargarInmuebles();
  const inm = todos.find((i) => i.id === state.inmueble);
  if (!inm) {
    main().innerHTML = `<div class="v-empty">${icon('building-2')}<h3>Inmueble no encontrado</h3></div>`;
    return;
  }
  if (!state.slots.length && !state.cargandoSlots && !state.errorReserva) {
    await cargarSlots();
  }
  main().innerHTML = `<div class="v-top"><button class="v-btn v-quiet" data-volver>${icon('arrow-left')}Volver</button><span class="v-demo">Nueva visita</span></div>
    <div class="v-bookinghero"><div class="v-muted">#${inm.numero_inmueble} · ${escape(inm.tipo_oferta)}</div><h3 style="font-size:20px;margin:4px 0">${escape(inm.direccion)}</h3><div class="v-muted">${escape(inm.ciudad)}${inm.barrio ? ' · ' + escape(inm.barrio) : ''}</div></div>
    <div class="v-bookinggrid"><section aria-label="Fecha y disponibilidad">
      <label class="v-field" for="v-fecha-visita">Fecha de la visita<input type="date" id="v-fecha-visita" class="v-input" value="${state.fechaVisita}" min="${hoyISO()}"></label>
      <div class="v-between"><div class="v-sectiontitle" style="margin:0">${icon('clock-3')}Horarios sugeridos</div><span class="v-muted">${state.cargandoSlots ? 'calculando…' : state.slots.length + ' disponibles'}</span></div>
      ${state.errorReserva ? `<div class="v-empty">${escape(state.errorReserva)}</div>` : state.cargandoSlots ? '<p class="v-muted">Calculando el mejor orden según cercanía y prioridad…</p>' : !state.slots.length ? `<div class="v-empty">Ningún asesor tiene un horario disponible ese día para esta ciudad. Prueba otra fecha.</div>` : `<div class="v-slots">${state.slots
        .map(
          (s, idx) =>
            `<button type="button" class="v-slot" data-slot="${idx}" aria-pressed="${state.slot === idx}">${horaFmt(s.hora_inicio)}–${horaFmt(s.hora_fin)}<br><small>${escape(s.asesor_nombre)}${s.distancia_km_mas_cercana !== null ? ' · ' + Number(s.distancia_km_mas_cercana).toFixed(1) + ' km' : ' · primera del día'}</small></button>`,
        )
        .join('')}</div>`}
      <p class="v-note">Los horarios ya descartan choques y dejan un colchón de traslado según la distancia real entre inmuebles. Ordenados de menor a mayor traslado para el asesor.</p>
    </section>
    <section aria-label="Datos de la visita"><form id="v-reserva-form"><div class="v-sectiontitle">${icon('user-round')}¿Quién visitará el inmueble?</div>
      <label class="v-field" for="v-cliente">Nombre del cliente<input class="v-input" id="v-cliente" value="${escape(state.cliente)}" maxlength="120" required></label>
      <label class="v-field" for="v-telefono">Celular<input class="v-input" id="v-telefono" value="${escape(state.telefono)}" maxlength="20"></label>
      <label class="v-field" for="v-correo">Correo (opcional)<input class="v-input" id="v-correo" type="email" value="${escape(state.correo)}"></label>
      <div id="v-reserva-error" class="v-error" role="alert"></div>
      <button class="v-btn v-primary v-full" type="submit" ${state.slot === null ? 'disabled' : ''}>${icon('calendar-check')}Confirmar visita</button>
      <p class="v-note" style="margin-top:12px">Esto crea la cita real en la agenda. Todavía no envía correo al cliente ni al propietario, ni crea el evento en Google Calendar — eso sigue siendo un paso aparte por ahora.</p>
    </form></section></div>`;
}

async function renderInterna() {
  main().innerHTML = '<p class="v-muted">Cargando…</p>';
  const asesores = await cargarAsesores();
  const inmuebles = await cargarTodosInmuebles();
  const it = state.interna;
  main().innerHTML = `<div class="v-top"><button class="v-btn v-quiet" data-volver-agenda>${icon('arrow-left')}Volver</button><span class="v-demo">Actividad interna</span></div>
    <form id="v-interna-form">
      <div class="v-sectiontitle">${icon('clipboard-list')}¿Qué actividad es?</div>
      <label class="v-field" for="v-interna-tipo">Tipo de actividad<select class="v-input" id="v-interna-tipo">
        <option value="inventario" ${it.tipo === 'inventario' ? 'selected' : ''}>Inventario (entrada o salida del inmueble)</option>
        <option value="inspeccion" ${it.tipo === 'inspeccion' ? 'selected' : ''}>Inspección / revisión de inmueble ya arrendado</option>
        <option value="captacion" ${it.tipo === 'captacion' ? 'selected' : ''}>Captación de un inmueble nuevo</option>
        <option value="otro" ${it.tipo === 'otro' ? 'selected' : ''}>Otra actividad</option>
      </select></label>
      <label class="v-field" for="v-interna-asesor">Asesor<select class="v-input" id="v-interna-asesor" required><option value="">Selecciona un asesor</option>${asesores
        .filter((a) => a.activo)
        .map((a) => `<option value="${a.id}" ${it.asesorId === a.id ? 'selected' : ''}>${escape(a.nombre)}</option>`)
        .join('')}</select></label>
      ${
        it.tipo === 'captacion'
          ? `<label class="v-field" for="v-interna-direccion">Dirección<input class="v-input" id="v-interna-direccion" type="text" value="${escape(it.direccionLibre)}" placeholder="Dirección del inmueble a captar"></label>
      <label class="v-field" for="v-interna-ciudad">Ciudad<input class="v-input" id="v-interna-ciudad" type="text" value="${escape(it.ciudadLibre)}" placeholder="Ciudad"></label>`
          : `<label class="v-field" for="v-interna-inmueble">Inmueble<select class="v-input" id="v-interna-inmueble" required><option value="">Selecciona un inmueble</option>${inmuebles
              .map((i) => `<option value="${i.id}" ${it.inmuebleId === i.id ? 'selected' : ''}>#${i.numero_inmueble} · ${escape(i.direccion)}</option>`)
              .join('')}</select></label>`
      }
      <label class="v-field" for="v-interna-titulo">Título corto<input class="v-input" id="v-interna-titulo" type="text" maxlength="120" value="${escape(it.titulo)}" placeholder="Ej. Inventario de salida"></label>
      <label class="v-field" for="v-interna-fecha">Fecha<input class="v-input" id="v-interna-fecha" type="date" value="${it.fecha}"></label>
      <label class="v-field" for="v-interna-hora">Hora<input class="v-input" id="v-interna-hora" type="time" value="${it.hora}"></label>
      <label class="v-field" for="v-interna-duracion">Duración (minutos)<input class="v-input" id="v-interna-duracion" type="number" min="5" step="5" placeholder="Por defecto, la misma que una visita" value="${it.duracion}"></label>
      <label class="v-field" for="v-interna-notas">Notas (opcional)<textarea class="v-input" id="v-interna-notas">${escape(it.notas)}</textarea></label>
      <div id="v-interna-error" class="v-error" role="alert">${escape(state.errorInterna)}</div>
      <button class="v-btn v-primary v-full" type="submit">${icon('check')}Guardar actividad</button>
      <p class="v-note" style="margin-top:12px">Queda registrada en la agenda del asesor con trazabilidad completa (quién la creó, si se mueve o se cancela).</p>
    </form>`;
}

function renderExito() {
  const c = state.ultimaCitaCreada;
  main().innerHTML = `<section class="v-success"><div class="v-successicon">${icon('check')}</div><div class="v-eyebrow">Todo listo</div><h2>Visita confirmada</h2><p class="v-muted" style="margin-top:10px">Quedó guardada correctamente para ${escape(c.cliente_nombre)}.</p>
    <div class="v-ticket"><div class="v-row">${icon('building-2')}<div><h3>${escape(c.direccion)}</h3></div></div><div class="v-row">${icon('calendar-days')}<div><div style="text-transform:capitalize">${dateLabel(c.fecha)}</div><strong>${horaFmt(c.hora_inicio)} – ${horaFmt(c.hora_fin)}</strong></div></div><div class="v-row">${icon('user-round')}<div><div>${escape(c.asesor_nombre)}</div><div class="v-muted">Asesor asignado</div></div></div></div>
    <button class="v-btn v-primary v-full" data-iragenda>Ver en la agenda ${icon('arrow-right')}</button></section>`;
}

function adjuntarEventos(rootEl) {
  rootEl.addEventListener('input', (e) => {
    if (e.target.id === 'v-search') {
      const valor = e.target.value;
      clearTimeout(buscarInmueblesDebounce);
      buscarInmueblesDebounce = setTimeout(() => {
        state.query = valor;
        state.pagina = 0;
        renderInmuebles();
      }, 2500);
    }
    if (e.target.id === 'v-cliente') state.cliente = e.target.value;
    if (e.target.id === 'v-telefono') state.telefono = e.target.value;
    if (e.target.id === 'v-correo') state.correo = e.target.value;
    if (e.target.id === 'v-interna-titulo') state.interna.titulo = e.target.value;
    if (e.target.id === 'v-interna-duracion') state.interna.duracion = e.target.value;
    if (e.target.id === 'v-interna-direccion') state.interna.direccionLibre = e.target.value;
    if (e.target.id === 'v-interna-ciudad') state.interna.ciudadLibre = e.target.value;
    if (e.target.id === 'v-interna-notas') state.interna.notas = e.target.value;
  });

  rootEl.addEventListener('change', async (e) => {
    if (e.target.id === 'v-asesor') {
      state.asesorFiltro = e.target.value;
      render();
    }
    if (e.target.id === 'v-ciudad') {
      state.ciudadFiltro = e.target.value;
      state.pagina = 0;
      renderInmuebles();
    }
    if (e.target.id === 'v-modo') {
      state.modoFiltro = e.target.value;
      state.pagina = 0;
      renderInmuebles();
    }
    if (e.target.id === 'v-fecha-visita') {
      state.fechaVisita = e.target.value;
      state.slots = [];
      state.errorReserva = '';
      render();
    }
    if (e.target.id === 'v-interna-tipo') {
      state.interna.tipo = e.target.value;
      render();
    }
    if (e.target.id === 'v-interna-asesor') state.interna.asesorId = e.target.value;
    if (e.target.id === 'v-interna-inmueble') state.interna.inmuebleId = e.target.value;
    if (e.target.id === 'v-interna-fecha') state.interna.fecha = e.target.value;
    if (e.target.id === 'v-interna-hora') state.interna.hora = e.target.value;
  });

  rootEl.addEventListener('click', async (e) => {
    if (state.view !== 'agenda' && state.view !== 'interna' && state.view !== 'properties' && state.view !== 'team' && state.view !== 'reserva' && state.view !== 'exito') return;
    const b = e.target.closest('button');
    if (!b || b.disabled || !rootEl.contains(b)) return;

    if (b.dataset.view) {
      setView(b.dataset.view);
      return;
    }
    if (b.hasAttribute('data-new')) {
      state.query = '';
      state.ciudadFiltro = 'all';
      state.modoFiltro = 'all';
      state.pagina = 0;
      setView('properties');
      return;
    }
    if (b.hasAttribute('data-new-interna')) {
      state.interna = { tipo: 'inventario', asesorId: '', inmuebleId: '', direccionLibre: '', ciudadLibre: '', fecha: state.fecha, hora: '09:00', duracion: '', titulo: '', notas: '' };
      state.errorInterna = '';
      setView('interna');
      return;
    }
    if (b.hasAttribute('data-volver-agenda')) {
      setView('agenda');
      return;
    }
    if (b.dataset.mover) {
      const c = state.citasHoy.find((x) => x.id === b.dataset.mover);
      state.moveId = b.dataset.mover;
      state.moveFecha = c ? c.fecha : state.fecha;
      state.moveHora = c ? c.hora_inicio.slice(0, 5) : '';
      state.moveError = '';
      render();
      return;
    }
    if (b.dataset.vista) {
      state.vistaAgenda = b.dataset.vista;
      render();
      return;
    }
    if (b.dataset.verdia) {
      state.fecha = b.dataset.verdia;
      state.vistaAgenda = 'dia';
      render();
      return;
    }
    if (b.dataset.dia) {
      const n = Number(b.dataset.dia);
      if (state.vistaAgenda === 'semana') state.fecha = addDiasISO(state.fecha, n * 7);
      else if (state.vistaAgenda === 'mes') state.fecha = addMesesISO(state.fecha, n);
      else state.fecha = addDiasISO(state.fecha, n);
      render();
      return;
    }
    if (b.dataset.pagina) {
      state.pagina += Number(b.dataset.pagina);
      renderInmuebles();
      return;
    }
    if (b.dataset.restriccion) {
      state.restriccionId = state.restriccionId === b.dataset.restriccion ? null : b.dataset.restriccion;
      state.errorRestriccion = '';
      renderInmuebles();
      return;
    }
    if (b.hasAttribute('data-cerrar-restriccion')) {
      state.restriccionId = null;
      state.errorRestriccion = '';
      renderInmuebles();
      return;
    }
    if (b.dataset.reservar) {
      startReserva(b.dataset.reservar);
      return;
    }
    if (b.hasAttribute('data-volver')) {
      setView('properties');
      return;
    }
    if (b.dataset.slot !== undefined) {
      state.slot = Number(b.dataset.slot);
      rootEl.querySelectorAll('[data-slot]').forEach((el) => el.setAttribute('aria-pressed', String(Number(el.dataset.slot) === state.slot)));
      const boton = rootEl.querySelector('#v-reserva-form button[type=submit]');
      if (boton) boton.disabled = false;
      return;
    }
    if (b.dataset.completar) {
      state.completarId = b.dataset.completar;
      render();
      return;
    }
    if (b.dataset.guardarrealizada) {
      const textarea = rootEl.querySelector('#v-feedback-texto');
      const comentario = textarea ? textarea.value.trim() : '';
      b.disabled = true;
      const { error } = await supabase.from('agenda_citas').update({ estado: 'completada', feedback_cliente: comentario || null }).eq('id', b.dataset.guardarrealizada);
      b.disabled = false;
      state.completarId = null;
      toast(error ? 'No se pudo guardar: ' + error.message : 'Marcada como realizada. El comentario queda guardado para el informe al propietario.');
      render();
      return;
    }
    if (b.dataset.cancelar) {
      state.cancelId = b.dataset.cancelar;
      render();
      return;
    }
    if (b.dataset.mantener) {
      state.cancelId = null;
      state.moveId = null;
      state.completarId = null;
      render();
      return;
    }
    if (b.dataset.confirmarmover) {
      const fechaInput = rootEl.querySelector('#v-mover-fecha');
      const horaInput = rootEl.querySelector('#v-mover-hora');
      const nuevaFecha = fechaInput ? fechaInput.value : state.moveFecha;
      const nuevaHora = horaInput ? horaInput.value : state.moveHora;
      if (!nuevaFecha || !nuevaHora) {
        state.moveError = 'Escoge fecha y hora.';
        render();
        return;
      }
      b.disabled = true;
      const { error } = await supabase.rpc('agenda_mover_cita', {
        p_cita_id: b.dataset.confirmarmover,
        p_solicitante_asesor_id: null,
        p_nueva_fecha: nuevaFecha,
        p_nueva_hora_inicio: nuevaHora,
      });
      b.disabled = false;
      if (error) {
        state.moveError = error.message.includes('ya no está disponible') || error.message.includes('ya tiene una cita') ? 'Ese horario ya no está disponible para este asesor.' : 'No se pudo mover: ' + error.message;
        render();
        return;
      }
      state.moveId = null;
      state.moveError = '';
      toast('Cita movida al nuevo horario.');
      render();
      return;
    }
    if (b.dataset.confirmarcancelar) {
      const { error } = await supabase.rpc('agenda_cancelar_cita', { p_cita_id: b.dataset.confirmarcancelar, p_solicitante_asesor_id: null, p_motivo: '' });
      state.cancelId = null;
      toast(error ? 'No se pudo cancelar: ' + error.message : 'Cancelada. El horario vuelve a estar disponible.');
      render();
      return;
    }
    if (b.hasAttribute('data-iragenda')) {
      state.fecha = state.ultimaCitaCreada.fecha;
      setView('agenda');
      return;
    }
  });

  rootEl.addEventListener('submit', async (e) => {
    if (e.target.id === 'v-interna-form') {
      e.preventDefault();
      const it = state.interna;
      if (!it.asesorId) {
        state.errorInterna = 'Selecciona un asesor.';
        render();
        return;
      }
      if (it.tipo === 'captacion' && !it.direccionLibre.trim()) {
        state.errorInterna = 'Escribe la dirección del inmueble a captar.';
        render();
        return;
      }
      if (it.tipo !== 'captacion' && !it.inmuebleId) {
        state.errorInterna = 'Selecciona un inmueble.';
        render();
        return;
      }
      const boton = e.target.querySelector('button[type=submit]');
      boton.disabled = true;
      const { error } = await supabase.rpc('agenda_crear_cita_interna', {
        p_empresa_id: contexto.empresaId,
        p_asesor_id: it.asesorId,
        p_fecha: it.fecha,
        p_hora_inicio: it.hora,
        p_inmueble_id: it.tipo === 'captacion' ? null : it.inmuebleId,
        p_tipo_cita: it.tipo,
        p_titulo: it.titulo.trim(),
        p_direccion_libre: it.tipo === 'captacion' ? it.direccionLibre.trim() : '',
        p_ciudad_libre: it.tipo === 'captacion' ? it.ciudadLibre.trim() : '',
        p_notas: it.notas.trim(),
        p_duracion_minutos: it.duracion ? Number(it.duracion) : null,
      });
      boton.disabled = false;
      if (error) {
        state.errorInterna = error.message.includes('ya no está disponible') || error.message.includes('ya tiene una cita') ? 'El asesor ya tiene algo agendado en ese horario.' : mensajeAmigable(error, 'No se pudo guardar la actividad. Intenta de nuevo.');
        render();
        return;
      }
      state.fecha = it.fecha;
      toast('Actividad guardada en la agenda.');
      setView('agenda');
      return;
    }
    if (e.target.id === 'v-restriccion-form') {
      e.preventDefault();
      const inmuebleId = e.target.dataset.inmueble;
      const dias = Array.from(e.target.querySelectorAll('input[name=dia]:checked')).map((c) => Number(c.value));
      const horaDesde = e.target.querySelector('[name=hora_desde]').value || null;
      const horaHasta = e.target.querySelector('[name=hora_hasta]').value || null;
      const duracionRaw = e.target.querySelector('[name=duracion_minutos]').value;
      const duracionMinutos = duracionRaw ? Number(duracionRaw) : null;
      if (horaDesde && horaHasta && horaDesde >= horaHasta) {
        state.errorRestriccion = 'La hora "desde" debe ser anterior a la hora "hasta".';
        renderInmuebles();
        return;
      }
      if (duracionMinutos !== null && (!Number.isFinite(duracionMinutos) || duracionMinutos <= 0)) {
        state.errorRestriccion = 'La duración debe ser mayor a cero minutos.';
        renderInmuebles();
        return;
      }
      const boton = e.target.querySelector('button[type=submit]');
      boton.disabled = true;
      const { error } = await supabase.rpc('agenda_actualizar_restriccion_inmueble', {
        p_inmueble_id: inmuebleId,
        p_dias_permitidos: dias.length ? dias : null,
        p_hora_desde: horaDesde,
        p_hora_hasta: horaHasta,
        p_duracion_minutos: duracionMinutos,
      });
      boton.disabled = false;
      if (error) {
        state.errorRestriccion = 'No se pudo guardar: ' + error.message;
        renderInmuebles();
        return;
      }
      [inmueblesCache, todosInmueblesCache].forEach((cache) => {
        const fila = cache?.find((i) => i.id === inmuebleId);
        if (fila) {
          fila.dias_visita_permitidos = dias.length ? dias : null;
          fila.hora_visita_desde = horaDesde;
          fila.hora_visita_hasta = horaHasta;
          fila.duracion_visita_minutos = duracionMinutos;
        }
      });
      state.restriccionId = null;
      state.errorRestriccion = '';
      toast('Restricción de horario guardada.');
      renderInmuebles();
      return;
    }
    if (e.target.id !== 'v-reserva-form') return;
    e.preventDefault();
    const err = rootEl.querySelector('#v-reserva-error');
    const nombre = state.cliente.trim();
    if (nombre.length < 2) {
      err.textContent = 'Escribe un nombre de al menos dos caracteres.';
      return;
    }
    if (state.slot === null || !state.slots[state.slot]) {
      err.textContent = 'Selecciona un horario.';
      return;
    }
    const elegido = state.slots[state.slot];
    const boton = e.target.querySelector('button[type=submit]');
    boton.disabled = true;
    err.textContent = '';
    const { data, error } = await supabase.rpc('agenda_crear_cita', {
      p_empresa_id: contexto.empresaId,
      p_inmueble_id: state.inmueble,
      p_asesor_id: elegido.asesor_id,
      p_fecha: state.fechaVisita,
      p_hora_inicio: elegido.hora_inicio,
      p_cliente_nombre: nombre,
      p_cliente_telefono: state.telefono.trim(),
      p_cliente_email: state.correo.trim(),
    });
    boton.disabled = false;
    if (error) {
      err.textContent = error.message.includes('ya no está disponible') ? 'Ese horario ya no está disponible: alguien lo tomó primero. Elige otro.' : mensajeAmigable(error, 'No se pudo crear la cita. Intenta de nuevo o elige otro horario.');
      if (error.message.includes('ya no está disponible')) {
        await cargarSlots();
        render();
      }
      return;
    }
    const todos = await cargarInmuebles();
    const inm = todos.find((i) => i.id === state.inmueble);
    state.ultimaCitaCreada = {
      id: data,
      direccion: inm ? inm.direccion : '',
      fecha: state.fechaVisita,
      hora_inicio: elegido.hora_inicio,
      hora_fin: elegido.hora_fin,
      cliente_nombre: nombre,
      asesor_nombre: elegido.asesor_nombre,
    };
    setView('exito');
  });
}
