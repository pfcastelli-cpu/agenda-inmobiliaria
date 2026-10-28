import { agendaLlena, htmlListaEspera, unirseListaEspera } from './lista-espera-publica.js';
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';
import './teclado-publico.js';
import { pasosReserva, resumenVisita, estadoVisita } from './visita-presentacion.js';
import '../estilos/visita.css';

const raiz = document.getElementById('pu-main');

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const state = {
  paso: 'inicial', // inicial | buscando | inmueble | agendando | confirmado | error
  numero: null,
  inmueble: null,
  fechas: [],
  fechaSel: null,
  primeraFecha: null,
  slots: [],
  cargandoSlots: false,
  slotSel: null,
  errorMsg: '',
  enviando: false,
  cliente: { nombre: '', telefono: '', email: '' },
  confirmacion: null,
  duplicados: [],
  duplicadosRevisados: false,
  duplicadoMismoInmueble: null,
  correoVerificado: false,
  correoVerificadoValor: null,
  verificacionNecesaria: null,
  avisoHorarios: '', // aviso visible sobre la lista de horarios (horario tomado, agenda cambiada…)
  scrollAviso: false,
  codigoEnviado: false,
  codigoInput: '',
  enviandoCodigo: false,
  verificandoCodigo: false,
  errorCodigo: '',
  accionPendiente: null,
};

function hostActual() {
  return window.location.hostname;
}

function numeroDesdeUrl() {
  const ruta = window.location.pathname.match(/inmuebles\/(\d+)/i);
  if (ruta) return Number(ruta[1]);
  const params = new URLSearchParams(window.location.search);
  const q = params.get('codigo') || params.get('c') || params.get('inmueble');
  return q ? Number(q) : null;
}

function proximasFechasHabiles(cantidad, desdeISO = null) {
  const out = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const cursor = new Date(hoy);
  // Si el inmueble tiene una primera fecha disponible (p. ej. «se puede mostrar desde»), el calendario empieza ahí.
  if (desdeISO && /^\d{4}-\d{2}-\d{2}$/.test(desdeISO)) {
    const [a, m, d] = desdeISO.split('-').map(Number);
    const desde = new Date(a, m - 1, d);
    if (desde > cursor) cursor.setTime(desde.getTime());
  }
  while (out.length < cantidad) {
    if (cursor.getDay() !== 0) {
      out.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function fechaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function esMensajeTecnico(msg) {
  return /function|candidate|relation|column|syntax|operator|schema|constraint|duplicate key|null value|permission denied|violates|uuid|pg_|does not exist/i.test(msg || '');
}

function mensajeAmigable(error, generico) {
  const msg = error?.message || '';
  if (!msg || esMensajeTecnico(msg)) return generico;
  return msg;
}

function escaparHtml(valor) {
  if (!valor) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatoMoneda(valor) {
  if (!valor) return null;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);
}

let formatoHoraCache = null; // '12h' | '24h', cargado una vez por empresa

async function cargarFormatoHora() {
  if (formatoHoraCache) return formatoHoraCache;
  const { data } = await supabase.rpc('agenda_formato_hora_publico', { p_host: hostActual() });
  formatoHoraCache = data === '24h' ? '24h' : '12h';
  return formatoHoraCache;
}

function formatoHora(horaSql) {
  const [h, m] = horaSql.split(':').map(Number);
  if (formatoHoraCache === '24h') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const ampm = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function icono(nombre, extra = '') {
  return `<span aria-hidden="true" style="${extra}">●</span>`;
}

async function buscarInmueble(numero) {
  state.paso = 'buscando';
  state.errorMsg = '';
  state.avisoHorarios = '';
  render();
  const [{ data, error }] = await Promise.all([
    supabase.rpc('agenda_info_publica_inmueble', { p_numero_inmueble: numero, p_host: hostActual() }),
    cargarFormatoHora(),
  ]);
  if (error) {
    state.paso = 'error';
    state.errorMsg = 'No pudimos consultar este inmueble. Verifica el código o inténtalo de nuevo.';
    render();
    return;
  }
  const fila = Array.isArray(data) ? data[0] : data;
  if (!fila) {
    state.paso = 'error';
    state.errorMsg = 'Este inmueble no está disponible para agendar visitas en este momento. Verifica el código o contacta a tu asesor.';
    render();
    return;
  }
  state.inmueble = fila;
  state.numero = numero;
  // Si el inmueble ya llenó su tope de citas (sql/035), en vez de horarios se ofrece la lista de espera.
  state.espera = null;
  try {
    if (await agendaLlena(numero, hostActual())) {
      state.espera = { nombre: '', telefono: '', correo: '', enviando: false, enviada: false, error: '' };
      state.paso = 'llena';
      render();
      return;
    }
  } catch {
    /* si la base aún no tiene la función, se muestra la reserva de siempre */
  }
  // Primera fecha con horarios (respeta «se puede mostrar desde», días y horas permitidos): así nadie tiene que adivinar el día.
  let primeraFecha = null;
  try {
    const { data: pf } = await supabase.rpc('agenda_primera_fecha_publica', { p_numero_inmueble: numero, p_host: hostActual() });
    primeraFecha = typeof pf === 'string' ? pf : null;
  } catch {
    /* si la base aún no tiene esa función, se usa el calendario de siempre */
  }
  state.primeraFecha = primeraFecha;
  state.fechas = proximasFechasHabiles(14, primeraFecha);
  state.fechaSel = state.fechas[0];
  state.paso = 'inmueble';
  render();
  irAPrimerDiaConDisponibilidad();
}

async function horariosDelDia(fecha) {
  const { data, error } = await supabase.rpc('agenda_horarios_publicos_por_codigo', {
    p_numero_inmueble: state.numero,
    p_fecha: fechaISO(fecha),
    p_host: hostActual(),
  });
  if (error) return null;
  const vistos = new Set();
  return (data || []).filter((s) => {
    if (vistos.has(s.hora_inicio)) return false;
    vistos.add(s.hora_inicio);
    return true;
  });
}

// `aviso` se conserva después de recargar (por ejemplo «ese horario ya lo tomó otra persona»).
async function cargarHorarios(aviso = '') {
  state.cargandoSlots = true;
  state.slotSel = null;
  render();
  const slots = await horariosDelDia(state.fechaSel);
  state.cargandoSlots = false;
  if (slots === null) {
    state.slots = [];
    state.errorMsg = 'No pudimos cargar los horarios de ese día. Intenta con otra fecha.';
    render();
    return;
  }
  state.errorMsg = '';
  state.avisoHorarios = aviso;
  state.scrollAviso = !!aviso;
  state.slots = slots;
  state.slotsEn = Date.now();
  render();
}

// La ventana puede quedar abierta horas mientras la agenda cambia. Los horarios que se ven valen unos
// minutos; pasado ese tiempo se consultan de nuevo antes de confirmar y al volver a la pestaña.
const VIGENCIA_HORARIOS_MS = 60 * 1000;
const AVISO_HORARIO_TOMADO = 'Ese horario acaba de ser tomado por otra persona.';
const esChoqueDeHorario = (error) => /ya no est[aá] disponible|ya fue tomado/i.test(error?.message || '');

// Devuelve true si el horario elegido sigue libre (o no había uno elegido). Si ya no está, deja el aviso
// y la lista actualizada, y conserva los datos que la persona ya escribió.
async function refrescarHorarios() {
  if (!state.numero || !state.fechaSel) return true;
  const elegido = state.slotSel?.hora_inicio || null;
  const slots = await horariosDelDia(state.fechaSel);
  if (slots === null) return true; // sin conexión para consultar: que decida el servidor al confirmar
  state.slots = slots;
  state.slotsEn = Date.now();
  if (elegido && !slots.some((s) => s.hora_inicio === elegido)) {
    state.avisoHorarios = `El horario de las ${formatoHora(elegido)} ya no está disponible porque la agenda cambió.`;
    state.scrollAviso = true;
    state.slotSel = null;
    render();
    return false;
  }
  if (elegido) state.slotSel = slots.find((s) => s.hora_inicio === elegido);
  return true;
}

const horariosVencidos = () => !state.slotsEn || Date.now() - state.slotsEn > VIGENCIA_HORARIOS_MS;

// Al volver a la pestaña tras un rato (ventana abierta, celular bloqueado) se actualizan los horarios.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.paso !== 'inmueble' || state.enviando || state.cargandoSlots) return;
  if (Date.now() - (state.slotsEn || 0) <= 2 * VIGENCIA_HORARIOS_MS) return;
  refrescarHorarios().then((sigue) => { if (sigue) render(); });
});

// Al abrir un inmueble, en vez de mostrarle al cliente "sin horarios" si justo hoy no hay
// nada disponible, buscamos el primer día (de los próximos 14 hábiles) que sí tenga horarios
// y lo dejamos seleccionado. Si ninguno tiene, nos quedamos en el primer día para que el
// cliente pueda seguir explorando manualmente.
async function irAPrimerDiaConDisponibilidad() {
  state.cargandoSlots = true;
  state.slotSel = null;
  state.errorMsg = '';
  render();
  for (const f of state.fechas) {
    const slots = await horariosDelDia(f);
    if (slots && slots.length) {
      state.fechaSel = f;
      state.slots = slots;
      state.slotsEn = Date.now();
      state.cargandoSlots = false;
      render();
      return;
    }
  }
  state.fechaSel = state.fechas[0];
  state.slots = [];
  state.cargandoSlots = false;
  render();
}

async function revisarDuplicados() {
  const telefono = state.cliente.telefono.trim();
  const email = state.cliente.email.trim();
  if (!telefono && !email) return;
  const { data } = await supabase.rpc('agenda_cliente_citas_activas', {
    p_telefono: telefono,
    p_email: email,
    p_host: hostActual(),
  });
  state.duplicados = data || [];
  state.duplicadosRevisados = true;
  state.duplicadoMismoInmueble = state.duplicados.find((d) => d.numero_inmueble === state.numero) || null;
}

async function necesitaVerificarCorreo(email) {
  const { data, error } = await supabase.rpc('agenda_correo_requiere_verificacion', {
    p_correo: email,
    p_host: hostActual(),
  });
  if (error) return false; // si falla la consulta, no bloqueamos la reserva por esto
  return !!data;
}

async function enviarCodigoVerificacion() {
  state.enviandoCodigo = true;
  state.errorCodigo = '';
  render();
  const { error } = await supabase.functions.invoke('enviar-codigo-verificacion', {
    body: { email: state.cliente.email.trim(), host: hostActual() },
  });
  state.enviandoCodigo = false;
  if (error) {
    state.errorCodigo = 'No pudimos enviar el código. Intenta de nuevo en un momento.';
    render();
    return false;
  }
  state.codigoEnviado = true;
  render();
  return true;
}

async function verificarCodigo() {
  if (!state.codigoInput || state.codigoInput.trim().length < 4) {
    state.errorCodigo = 'Escribe el código que te llegó por correo.';
    render();
    return;
  }
  state.verificandoCodigo = true;
  state.errorCodigo = '';
  render();
  const { data, error } = await supabase.rpc('agenda_verificar_codigo_contacto', {
    p_correo: state.cliente.email.trim(),
    p_codigo: state.codigoInput.trim(),
    p_host: hostActual(),
  });
  state.verificandoCodigo = false;
  if (error || !data) {
    state.errorCodigo = mensajeAmigable(error, 'Código incorrecto. Revisa e intenta de nuevo.');
    render();
    return;
  }
  state.correoVerificado = true;
  state.correoVerificadoValor = state.cliente.email.trim().toLowerCase();
  state.codigoEnviado = false;
  state.codigoInput = '';
  const accion = state.accionPendiente;
  state.accionPendiente = null;
  if (accion === 'cambiar') await cambiarCita();
  else await confirmarCita();
}

// Antes de agendar o cambiar una cita verificamos que el correo escrito sea
// real: si ya tiene una cita registrada con esta empresa (o ya se verificó
// antes), lo damos por confiable y seguimos de una. Si no, le enviamos un
// código de 6 dígitos y detenemos el flujo hasta que lo confirme; cuando lo
// confirma, retomamos automáticamente la acción que estaba pendiente.
async function asegurarCorreoVerificado(accion) {
  const correoActual = state.cliente.email.trim().toLowerCase();
  if (state.correoVerificado && state.correoVerificadoValor === correoActual) {
    return true;
  }
  state.accionPendiente = accion;
  if (state.verificacionNecesaria === null) {
    state.verificacionNecesaria = await necesitaVerificarCorreo(state.cliente.email.trim());
  }
  if (!state.verificacionNecesaria) {
    state.correoVerificado = true;
    state.correoVerificadoValor = correoActual;
    return true;
  }
  if (!state.codigoEnviado) {
    await enviarCodigoVerificacion();
  } else {
    render();
  }
  return false;
}

async function confirmarCita() {
  if (!state.cliente.nombre || state.cliente.nombre.trim().length < 2) {
    state.errorMsg = 'Escribe tu nombre completo.';
    render();
    return;
  }
  if (!state.cliente.telefono || state.cliente.telefono.replace(/\D/g, '').length < 7) {
    state.errorMsg = 'Escribe tu número de celular. Por ahí te contactará tu asesor.';
    render();
    return;
  }
  if (!state.cliente.email || !/\S+@\S+\.\S+/.test(state.cliente.email.trim())) {
    state.errorMsg = 'Escribe un correo electrónico válido. Allí te enviaremos los datos de tu asesor y de la visita.';
    render();
    return;
  }
  if (!state.slotSel) {
    state.errorMsg = 'Elige un horario disponible.';
    render();
    return;
  }

  // Si la ventana lleva rato abierta, confirma primero que el horario siga libre.
  if (horariosVencidos() && !(await refrescarHorarios())) return;

  if (!state.duplicadosRevisados) {
    await revisarDuplicados();
    if (state.duplicados.length) {
      render();
      return;
    }
  }

  const correoListo = await asegurarCorreoVerificado('confirmar');
  if (!correoListo) return;

  state.enviando = true;
  state.errorMsg = '';
  render();
  const { data, error } = await supabase.rpc('agenda_agendar_cita_publica', {
    p_numero_inmueble: state.numero,
    p_fecha: fechaISO(state.fechaSel),
    p_hora_inicio: state.slotSel.hora_inicio,
    p_cliente_nombre: state.cliente.nombre.trim(),
    p_cliente_telefono: state.cliente.telefono.trim(),
    p_cliente_email: state.cliente.email.trim(),
    p_host: hostActual(),
  });
  state.enviando = false;
  if (error) {
    const aviso = esChoqueDeHorario(error) ? AVISO_HORARIO_TOMADO : mensajeAmigable(error, 'No se pudo agendar la visita. Elige otro horario e inténtalo de nuevo.');
    state.duplicadosRevisados = false;
    // El horario pudo dejar de estar disponible; recargamos la lista y conservamos el aviso.
    cargarHorarios(aviso);
    return;
  }
  // Se dispara sin esperar la respuesta: si el correo falla no debe bloquear
  // la confirmación visual de la cita; el intento (o la falla) queda
  // registrado en agenda_correos_log para revisión en el panel de administración.
  supabase.functions.invoke('enviar-correo-cita', { body: { cita_id: data } }).catch(() => {});
    supabase.functions.invoke('enviar-correo-propietario', { body: { cita_id: data } }).catch(() => {});
  state.confirmacion = {
    id: data,
    fecha: state.fechaSel,
    hora: state.slotSel,
  };
  state.paso = 'confirmado';
  render();
}

// Cuando el cliente ya tiene una cita activa para este mismo inmueble y elige
// "cambiar" en vez de agendar una adicional: ubicamos el id de esa cita vieja
// y la movemos al nuevo horario elegido (la función en la base de datos
// verifica que el celular/correo coincidan antes de tocar nada).
async function cambiarCita() {
  if (!state.duplicadoMismoInmueble || !state.slotSel) return;

  if (horariosVencidos() && !(await refrescarHorarios())) return;

  const correoListo = await asegurarCorreoVerificado('cambiar');
  if (!correoListo) return;

  state.enviando = true;
  state.errorMsg = '';
  render();

  const dup = state.duplicadoMismoInmueble;
  const { data: citaId } = await supabase.rpc('agenda_cita_id_publica', {
    p_telefono: state.cliente.telefono.trim(),
    p_email: state.cliente.email.trim(),
    p_fecha: dup.fecha,
    p_hora_inicio: dup.hora_inicio,
    p_numero_inmueble: dup.numero_inmueble,
    p_host: hostActual(),
  });
  if (!citaId) {
    state.enviando = false;
    state.errorMsg = 'No pudimos ubicar tu cita anterior. Escríbele directamente a tu asesor para cambiarla.';
    render();
    return;
  }

  const { data, error } = await supabase.rpc('agenda_reagendar_cita_publica', {
    p_cita_id: citaId,
    p_numero_inmueble: state.numero,
    p_fecha: fechaISO(state.fechaSel),
    p_hora_inicio: state.slotSel.hora_inicio,
    p_cliente_nombre: state.cliente.nombre.trim(),
    p_cliente_telefono: state.cliente.telefono.trim(),
    p_cliente_email: state.cliente.email.trim(),
    p_host: hostActual(),
  });
  state.enviando = false;
  if (error) {
    const aviso = esChoqueDeHorario(error) ? AVISO_HORARIO_TOMADO : mensajeAmigable(error, 'No se pudo cambiar la cita. Elige otro horario e inténtalo de nuevo.');
    state.duplicadosRevisados = false;
    cargarHorarios(aviso);
    return;
  }
  supabase.functions.invoke('enviar-correo-cita', { body: { cita_id: data, reagendada: true } }).catch(() => {});
  supabase.functions.invoke('enviar-correo-propietario', { body: { cita_id: data, reagendada: true } }).catch(() => {});
  state.confirmacion = {
    id: data,
    fecha: state.fechaSel,
    hora: state.slotSel,
  };
  state.paso = 'confirmado';
  render();
}

function vistaInicial() {
  return `
    <h2>Agenda tu visita</h2>
    <p>Escribe el código del inmueble que quieres visitar. Lo encuentras en el anuncio o en el enlace que te compartió tu asesor.</p>
    <div class="pu-card">
      <form id="pu-form-codigo">
        <label for="pu-codigo">Código del inmueble</label>
        <input id="pu-codigo" type="number" min="1" placeholder="Ej: 245" required>
        <button class="pu-main" type="submit">Buscar inmueble</button>
      </form>
    </div>
  `;
}

function vistaBuscando() {
  return `<div class="pu-spinner">Buscando el inmueble…</div>`;
}

function vistaError() {
  return `
    <div class="pu-error">${state.errorMsg}</div>
    <button class="pu-link" id="pu-volver">Buscar otro código</button>
  `;
}

// Mismo mensaje que el recuadro de los correos de visita (_shared/visita-correo.ts).
const NOTA_PUNTUALIDAD = `<p class="pu-nota"><b>Llega a tiempo a tu visita.</b> Tu asesor tiene otra cita justo después y no puede esperar. Te sugerimos llegar unos minutos antes; si llegas tarde, la visita puede acortarse o no realizarse.</p>`;

function tarjetaInmueble() {
  const i = state.inmueble;
  const ubicacion = [i.barrio, i.localidad, i.ciudad].filter(Boolean).join(', ');
  return `
    <div class="pu-card">
      <div style="font-size:13px;color:var(--pu-muted)">Inmueble ${i.numero_inmueble}</div>
      <h2 style="margin-top:4px">${i.direccion_limpia || ubicacion || i.ciudad || 'Ubicación disponible con tu asesor'}</h2>
      ${ubicacion ? `<div style="font-size:13px;color:var(--pu-muted)">${ubicacion}</div>` : ''}
      ${i.enlace_ficha_completa ? `<a class="pu-ver-inmueble" href="${i.enlace_ficha_completa}" target="_blank" rel="noopener">Ver este inmueble en nuestro sitio</a>` : ''}
      ${i.posible_ocupado ? `<p class="pu-nota">El inmueble puede estar ocupado. Si necesitamos cambiar la hora, te avisaremos por correo. Tu visita conserva su horario mientras no recibas ese aviso.</p>` : ''}
      ${i.visita_rapida ? `<p class="pu-nota">Visita breve de aproximadamente ${i.duracion_minutos} minutos. Llega puntual para aprovecharla.</p>` : ''}
      ${NOTA_PUNTUALIDAD}
    </div>
  `;
}

function selectorFechas() {
  const hoyISO = fechaISO(new Date());
  const aviso = state.primeraFecha && state.primeraFecha > hoyISO
    ? `<p class="pu-vacio" style="margin:0 0 8px;font-size:13px">Las visitas a este inmueble se pueden agendar desde el <strong>${state.primeraFecha.slice(8, 10)}/${state.primeraFecha.slice(5, 7)}/${state.primeraFecha.slice(0, 4)}</strong>; ya te mostramos esa fecha.</p>` : '';
  return `
    <h3>Elige un día</h3>
    ${aviso}
    <div class="pu-fechas" id="pu-fechas">
      ${state.fechas
        .map((f) => {
          const activa = fechaISO(f) === fechaISO(state.fechaSel);
          return `<button type="button" class="pu-fecha ${activa ? 'activa' : ''}" data-fecha="${fechaISO(f)}" aria-pressed="${activa ? 'true' : 'false'}">
            <span>${DIAS[f.getDay()]}</span>
            <strong>${f.getDate()}</strong>
            <span>${MESES[f.getMonth()].slice(0, 3)}</span>
          </button>`;
        })
        .join('')}
    </div>
  `;
}

function bannerAvisoHorarios() {
  if (!state.avisoHorarios) return '';
  return `<div class="pu-error" role="alert" id="pu-aviso-horarios" style="margin:0 0 12px"><strong>⚠️ ${escaparHtml(state.avisoHorarios)}</strong><br>No se guardó tu cita. <strong>Qué hacer:</strong> elige otro de los horarios de abajo (o cambia de fecha) y vuelve a confirmar. Tus datos siguen escritos.</div>`;
}

function selectorHorarios() {
  if (state.cargandoSlots) {
    return `<h3>Elige una hora</h3><div class="pu-spinner">Buscando horarios…</div>`;
  }
  if (!state.slots.length) {
    return `<h3>Elige una hora</h3>${bannerAvisoHorarios()}<div class="pu-vacio">No hay horarios disponibles ese día. Elige otra fecha.</div>`;
  }
  return `
    <h3>Elige una hora</h3>
    ${bannerAvisoHorarios()}
    <div class="pu-slots" id="pu-slots">
      ${state.slots
        .map((s) => {
          const activo = state.slotSel && state.slotSel.hora_inicio === s.hora_inicio;
          const duracionMin = Math.round((new Date(`2000-01-01T${s.hora_fin}`) - new Date(`2000-01-01T${s.hora_inicio}`)) / 60000);
          return `<button type="button" class="pu-slot ${activo ? 'activo' : ''}" data-hora="${s.hora_inicio}" aria-pressed="${activo ? 'true' : 'false'}">${formatoHora(s.hora_inicio)}${s.tipo_slot === 'mismo_inmueble' ? `<small>${duracionMin} min</small>` : ''}</button>`;
        })
        .join('')}
    </div>
  `;
}

function formularioCliente() {
  const hayDuplicados = state.duplicadosRevisados && state.duplicados.length > 0;
  const dupMismoInmueble = hayDuplicados ? state.duplicadoMismoInmueble : null;
  const otrosDuplicados = state.duplicados.filter((d) => d !== dupMismoInmueble);
  const mostrarVerificacion = state.codigoEnviado && !state.correoVerificado;

  let avisoDuplicados = '';
  if (dupMismoInmueble) {
    avisoDuplicados = `<div class="pu-error">Ya tienes una visita agendada para este mismo inmueble el ${dupMismoInmueble.fecha} a las ${formatoHora(dupMismoInmueble.hora_inicio)}. ¿Quieres cambiarla a este nuevo horario o agendar una visita adicional?</div>`;
  } else if (hayDuplicados) {
    avisoDuplicados = `<div class="pu-error">Ya tienes ${otrosDuplicados.length > 1 ? 'varias visitas' : 'una visita'} agendada${otrosDuplicados.length > 1 ? 's' : ''}: ${otrosDuplicados.map((d) => `inmueble ${d.numero_inmueble} el ${d.fecha} a las ${formatoHora(d.hora_inicio)}`).join('; ')}. ¿Quieres agendar esta también?</div>`;
  }

  const bloqueVerificacion = mostrarVerificacion
    ? `<div class="pu-verificacion">
         <p>Te enviamos un código a <strong>${escaparHtml(state.cliente.email.trim())}</strong>. Escríbelo aquí para confirmar tu visita (vence en 10 minutos).</p>
         <input id="pu-codigo-verificacion" class="pu-codigo-input" type="text" inputmode="numeric" maxlength="6" value="${escaparHtml(state.codigoInput)}" placeholder="000000" ${state.verificandoCodigo ? 'disabled' : ''}>
         ${state.errorCodigo ? `<div class="pu-error">${escaparHtml(state.errorCodigo)}</div>` : ''}
         <button class="pu-main" id="pu-verificar-codigo" ${state.verificandoCodigo ? 'disabled' : ''} style="margin-top:8px">
           ${state.verificandoCodigo ? 'Verificando…' : 'Verificar código'}
         </button>
         <button class="pu-link" id="pu-reenviar-codigo" ${state.enviandoCodigo ? 'disabled' : ''}>
           ${state.enviandoCodigo ? 'Enviando…' : '¿No te llegó? Enviar otro código'}
         </button>
       </div>`
    : '';

  return `
    <h3>Confirma tus datos</h3>
    <div class="pu-card">
      <p class="pu-seleccion">${DIAS[state.fechaSel.getDay()]} ${state.fechaSel.getDate()} de ${MESES[state.fechaSel.getMonth()]} a las <strong>${formatoHora(state.slotSel.hora_inicio)}</strong></p>
      <label for="pu-nombre">Nombre completo</label>
      <input id="pu-nombre" type="text" autocomplete="name" value="${escaparHtml(state.cliente.nombre)}" placeholder="Nombre y apellido" required ${mostrarVerificacion ? 'disabled' : ''}>
      <label for="pu-telefono">Celular</label>
      <input id="pu-telefono" type="tel" autocomplete="tel" value="${escaparHtml(state.cliente.telefono)}" placeholder="Ej: 3001234567" required ${mostrarVerificacion ? 'disabled' : ''}>
      <label for="pu-email">Correo electrónico</label>
      <input id="pu-email" type="email" autocomplete="email" value="${escaparHtml(state.cliente.email)}" placeholder="nombre@correo.com" required ${mostrarVerificacion ? 'disabled' : ''}>
      <p style="margin:6px 0 0;font-size:12.5px">Te enviaremos la confirmación, el asesor y las instrucciones para llegar.</p>
      ${avisoDuplicados}
      ${!mostrarVerificacion && state.errorMsg ? `<div class="pu-error">${state.errorMsg}</div>` : ''}
      ${
        mostrarVerificacion
          ? bloqueVerificacion
          : dupMismoInmueble
          ? `<button class="pu-main" id="pu-cambiar-cita" ${state.enviando ? 'disabled' : ''} style="margin-bottom:8px">
               ${state.enviando ? 'Cambiando…' : 'Cambiar mi cita a este nuevo horario'}
             </button>
             <button class="pu-link" id="pu-confirmar" ${state.enviando ? 'disabled' : ''}>Agendar una visita adicional</button>`
          : `<button class="pu-main" id="pu-confirmar" ${state.enviando ? 'disabled' : ''}>
               ${state.enviando ? 'Agendando…' : hayDuplicados ? 'Sí, agendar esta visita también' : 'Confirmar visita'}
             </button>`
      }
    </div>
  `;
}

function vistaInmueble() {
  return `
    ${pasosReserva(state.slotSel ? 2 : state.fechaSel ? 1 : 0)}
    <div class="pu-reserva-grid"><aside>${tarjetaInmueble()}</aside><section aria-label="Elige el horario de tu visita">
    ${selectorFechas()}
    ${selectorHorarios()}
    ${state.slotSel ? formularioCliente() : ''}
    <button class="pu-link" id="pu-volver" style="margin-top:10px">Buscar otro inmueble</button>
    </section></div>
  `;
}

function vistaConfirmado() {
  const { fecha, hora } = state.confirmacion;
  return `
    ${resumenVisita({ estado: estadoVisita(), numero: state.numero, direccion: state.inmueble?.direccion_limpia,
      zona: state.inmueble?.ciudad, fecha: `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`, hora: formatoHora(hora.hora_inicio) })}
    <div class="pu-card">
      <h3>Ya puedes organizar tu visita</h3>
      ${state.inmueble?.posible_ocupado ? `<p class="pu-nota">Tu visita sigue confirmada. Si recibes un aviso para elegir otra hora, el horario original dejará de estar disponible. Revisa tu correo antes de salir.</p>` : ''}
      <p>Encontrarás los datos del asesor y el enlace para cambiar o cancelar en el correo de confirmación.</p>
      ${NOTA_PUNTUALIDAD}
      <button class="pu-link" id="pu-nueva">Agendar otra visita</button>
    </div>
  `;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No pudimos cargar la página. Revisa tu internet e inténtalo otra vez en unos minutos.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'inicial') html = vistaInicial();
  else if (state.paso === 'buscando') html = vistaBuscando();
  else if (state.paso === 'error') html = vistaError();
  else if (state.paso === 'inmueble') html = vistaInmueble();
  else if (state.paso === 'confirmado') html = vistaConfirmado();
  else if (state.paso === 'llena') html = `${tarjetaInmueble()}${htmlListaEspera(state.espera)}<button class="pu-link" id="pu-volver" style="margin-top:10px">Buscar otro inmueble</button>`;
  raiz.innerHTML = `<div class="pu-flujo ${state.paso === 'inmueble' ? 'pu-reserva' : ''}">${html}</div>`;
  cablear();
  if (state.scrollAviso) {
    state.scrollAviso = false;
    document.getElementById('pu-aviso-horarios')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function cablear() {
  const formEspera = document.getElementById('pu-form-espera');
  if (formEspera) {
    formEspera.addEventListener('submit', async (e) => {
      e.preventDefault();
      const esp = state.espera;
      esp.nombre = document.getElementById('pu-esp-nombre').value;
      esp.telefono = document.getElementById('pu-esp-tel').value;
      esp.correo = document.getElementById('pu-esp-correo').value;
      esp.enviando = true;
      esp.error = '';
      render();
      const r = await unirseListaEspera(state.numero, hostActual(), esp.nombre, esp.telefono, esp.correo);
      esp.enviando = false;
      if (r.ok) esp.enviada = true;
      else esp.error = r.error;
      render();
    });
  }
  const formCodigo = document.getElementById('pu-form-codigo');
  if (formCodigo) {
    formCodigo.addEventListener('submit', (e) => {
      e.preventDefault();
      const numero = Number(document.getElementById('pu-codigo').value);
      if (numero > 0) buscarInmueble(numero);
    });
  }
  const volver = document.getElementById('pu-volver');
  if (volver) {
    volver.addEventListener('click', () => {
      state.paso = 'inicial';
      state.inmueble = null;
      state.slotSel = null;
      state.errorMsg = '';
      window.history.replaceState(null, '', window.location.pathname.replace(/inmuebles\/\d+/i, '') || '/');
      render();
    });
  }
  const nueva = document.getElementById('pu-nueva');
  if (nueva) {
    nueva.addEventListener('click', () => {
      state.paso = 'inicial';
      state.inmueble = null;
      state.slotSel = null;
      state.confirmacion = null;
      state.cliente = { nombre: '', telefono: '', email: '' };
      state.duplicados = [];
      state.duplicadosRevisados = false;
      state.duplicadoMismoInmueble = null;
      state.correoVerificado = false;
      state.correoVerificadoValor = null;
      state.verificacionNecesaria = null;
      state.codigoEnviado = false;
      state.codigoInput = '';
      state.errorCodigo = '';
      state.accionPendiente = null;
      render();
    });
  }
  const fechasEl = document.getElementById('pu-fechas');
  if (fechasEl) {
    fechasEl.querySelectorAll('.pu-fecha').forEach((el) => {
      el.addEventListener('click', () => {
        state.fechaSel = state.fechas.find((f) => fechaISO(f) === el.dataset.fecha);
        cargarHorarios();
      });
    });
  }
  const slotsEl = document.getElementById('pu-slots');
  if (slotsEl) {
    slotsEl.querySelectorAll('.pu-slot').forEach((el) => {
      el.addEventListener('click', () => {
        state.avisoHorarios = '';
        state.slotSel = state.slots.find((s) => s.hora_inicio === el.dataset.hora);
        render();
        document.getElementById('pu-nombre')?.focus({ preventScroll: true });
        document.getElementById('pu-nombre')?.closest('.pu-card')?.scrollIntoView({ block: 'start' });
      });
    });
  }
  const nombre = document.getElementById('pu-nombre');
  if (nombre) nombre.addEventListener('input', (e) => { state.cliente.nombre = e.target.value; });
  const telefono = document.getElementById('pu-telefono');
  if (telefono) telefono.addEventListener('input', (e) => { state.cliente.telefono = e.target.value; state.duplicadosRevisados = false; state.duplicadoMismoInmueble = null; });
  const email = document.getElementById('pu-email');
  if (email) email.addEventListener('input', (e) => {
    state.cliente.email = e.target.value;
    state.duplicadosRevisados = false;
    state.duplicadoMismoInmueble = null;
    state.correoVerificado = false;
    state.correoVerificadoValor = null;
    state.verificacionNecesaria = null;
    state.codigoEnviado = false;
    state.codigoInput = '';
    state.errorCodigo = '';
  });
  const confirmar = document.getElementById('pu-confirmar');
  if (confirmar) confirmar.addEventListener('click', confirmarCita);
  const cambiarCitaBtn = document.getElementById('pu-cambiar-cita');
  if (cambiarCitaBtn) cambiarCitaBtn.addEventListener('click', cambiarCita);
  const codigoInput = document.getElementById('pu-codigo-verificacion');
  if (codigoInput) codigoInput.addEventListener('input', (e) => { state.codigoInput = e.target.value.replace(/\D/g, '').slice(0, 6); });
  const verificarBtn = document.getElementById('pu-verificar-codigo');
  if (verificarBtn) verificarBtn.addEventListener('click', verificarCodigo);
  const reenviarBtn = document.getElementById('pu-reenviar-codigo');
  if (reenviarBtn) reenviarBtn.addEventListener('click', enviarCodigoVerificacion);
}

aplicarMarcaPublica();
const codigoInicial = numeroDesdeUrl();
if (codigoInicial) {
  buscarInmueble(codigoInicial);
} else {
  render();
}
