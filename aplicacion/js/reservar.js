import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';

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
  slots: [],
  cargandoSlots: false,
  slotSel: null,
  errorMsg: '',
  enviando: false,
  cliente: { nombre: '', telefono: '', email: '' },
  confirmacion: null,
  duplicados: [],
  duplicadosRevisados: false,
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

function proximasFechasHabiles(cantidad) {
  const out = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const cursor = new Date(hoy);
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
  state.fechas = proximasFechasHabiles(14);
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

async function cargarHorarios() {
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
  state.slots = slots;
  render();
}

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
}

async function confirmarCita() {
  if (!state.cliente.nombre || state.cliente.nombre.trim().length < 2) {
    state.errorMsg = 'Escribe tu nombre completo.';
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

  if (!state.duplicadosRevisados) {
    await revisarDuplicados();
    if (state.duplicados.length) {
      render();
      return;
    }
  }

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
    state.errorMsg = mensajeAmigable(error, 'No se pudo agendar la visita. Elige otro horario e inténtalo de nuevo.');
    state.duplicadosRevisados = false;
    // El horario pudo dejar de estar disponible; recargamos la lista.
    cargarHorarios();
    return;
  }
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

function tarjetaInmueble() {
  const i = state.inmueble;
  const ubicacion = [i.barrio, i.localidad, i.ciudad].filter(Boolean).join(', ');
  return `
    <div class="pu-card">
      <div style="font-size:13px;color:var(--pu-muted)">Inmueble ${i.numero_inmueble}</div>
      <h2 style="margin-top:4px">${i.direccion_limpia || ubicacion || i.ciudad || 'Ubicación disponible con tu asesor'}</h2>
      ${ubicacion ? `<div style="font-size:13px;color:var(--pu-muted)">${ubicacion}</div>` : ''}
      ${i.enlace_ficha_completa ? `<a class="pu-ver-inmueble" href="${i.enlace_ficha_completa}" target="_blank" rel="noopener">Ver este inmueble en nuestro sitio</a>` : ''}
      ${i.posible_ocupado ? `<div class="pu-aviso" style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff4e5;color:#8a5200;font-size:13px">Este inmueble podría estar ocupado actualmente. Es posible que debamos reprogramar tu visita; tu asesor te confirmará antes de la cita.</div>` : ''}
      ${i.visita_rapida ? `<div class="pu-aviso" style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff4e5;color:#8a5200;font-size:13px">Esta visita es breve (~${i.duracion_minutos} min). Tu asesor puede tener otra cita cerca de esta hora, así que te pedimos ser puntual.</div>` : ''}
    </div>
  `;
}

function selectorFechas() {
  return `
    <h3>Elige un día</h3>
    <div class="pu-fechas" id="pu-fechas">
      ${state.fechas
        .map((f) => {
          const activa = fechaISO(f) === fechaISO(state.fechaSel);
          return `<div class="pu-fecha ${activa ? 'activa' : ''}" data-fecha="${fechaISO(f)}">
            <span>${DIAS[f.getDay()]}</span>
            <strong>${f.getDate()}</strong>
            <span>${MESES[f.getMonth()].slice(0, 3)}</span>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

function selectorHorarios() {
  if (state.cargandoSlots) {
    return `<h3>Horarios disponibles</h3><div class="pu-spinner">Buscando horarios…</div>`;
  }
  if (!state.slots.length) {
    return `<h3>Horarios disponibles</h3><div class="pu-vacio">No hay horarios disponibles ese día. Elige otra fecha.</div>`;
  }
  return `
    <h3>Horarios disponibles</h3>
    <div class="pu-slots" id="pu-slots">
      ${state.slots
        .map((s) => {
          const activo = state.slotSel && state.slotSel.hora_inicio === s.hora_inicio;
          const duracionMin = Math.round((new Date(`2000-01-01T${s.hora_fin}`) - new Date(`2000-01-01T${s.hora_inicio}`)) / 60000);
          return `<div class="pu-slot ${activo ? 'activo' : ''}" data-hora="${s.hora_inicio}">${formatoHora(s.hora_inicio)}${s.tipo_slot === 'mismo_inmueble' ? `<br><small>${duracionMin} min</small>` : ''}</div>`;
        })
        .join('')}
    </div>
  `;
}

function formularioCliente() {
  const hayDuplicados = state.duplicadosRevisados && state.duplicados.length > 0;
  return `
    <h3>Tus datos</h3>
    <div class="pu-card">
      <label for="pu-nombre">Nombre completo</label>
      <input id="pu-nombre" type="text" value="${state.cliente.nombre}" placeholder="Nombre y apellido" required>
      <label for="pu-telefono">Celular</label>
      <input id="pu-telefono" type="tel" value="${state.cliente.telefono}" placeholder="Ej: 3001234567">
      <label for="pu-email">Correo electrónico</label>
      <input id="pu-email" type="email" value="${state.cliente.email}" placeholder="nombre@correo.com" required>
      <p style="margin:6px 0 0;font-size:12.5px">Allí te llegarán los datos de tu asesor, la dirección exacta y cómo llegar.</p>
      ${hayDuplicados ? `<div class="pu-error">Ya tienes ${state.duplicados.length > 1 ? 'varias visitas' : 'una visita'} agendada${state.duplicados.length > 1 ? 's' : ''}: ${state.duplicados.map((d) => `inmueble ${d.numero_inmueble} el ${d.fecha} a las ${formatoHora(d.hora_inicio)}`).join('; ')}. ¿Deseas agendar esta también?</div>` : ''}
      ${state.errorMsg ? `<div class="pu-error">${state.errorMsg}</div>` : ''}
      <button class="pu-main" id="pu-confirmar" ${state.enviando ? 'disabled' : ''}>
        ${state.enviando ? 'Agendando…' : hayDuplicados ? 'Sí, agendar esta visita también' : 'Confirmar visita'}
      </button>
    </div>
  `;
}

function vistaInmueble() {
  return `
    ${tarjetaInmueble()}
    ${selectorFechas()}
    ${selectorHorarios()}
    ${state.slotSel ? formularioCliente() : ''}
    <button class="pu-link" id="pu-volver" style="margin-top:10px">Buscar otro inmueble</button>
  `;
}

function vistaConfirmado() {
  const { fecha, hora } = state.confirmacion;
  return `
    <div class="pu-confirmacion">
      <div class="pu-icono">✓</div>
      <h2>¡Visita confirmada!</h2>
      <p>
        Te esperamos el ${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}
        a las ${formatoHora(hora.hora_inicio)} para visitar el inmueble ${state.numero}${state.inmueble?.direccion_limpia ? ' (' + state.inmueble.direccion_limpia + ')' : ''}.
      </p>
      ${state.inmueble?.visita_rapida ? `<p style="color:#8a5200"><strong>Esta visita es breve (~${state.inmueble.duracion_minutos} min):</strong> tu asesor puede tener otra cita cerca de esta hora, así que te pedimos llegar puntual.</p>` : ''}
      <p>Tu asesor se pondrá en contacto contigo antes de la visita. Si necesitas cambiar el horario, escríbele directamente.</p>
      <button class="pu-link" id="pu-nueva">Agendar otra visita</button>
    </div>
  `;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No se pudo conectar con el servicio de agendamiento. Intenta más tarde.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'inicial') html = vistaInicial();
  else if (state.paso === 'buscando') html = vistaBuscando();
  else if (state.paso === 'error') html = vistaError();
  else if (state.paso === 'inmueble') html = vistaInmueble();
  else if (state.paso === 'confirmado') html = vistaConfirmado();
  raiz.innerHTML = html;
  cablear();
}

function cablear() {
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
        state.slotSel = state.slots.find((s) => s.hora_inicio === el.dataset.hora);
        render();
      });
    });
  }
  const nombre = document.getElementById('pu-nombre');
  if (nombre) nombre.addEventListener('input', (e) => { state.cliente.nombre = e.target.value; });
  const telefono = document.getElementById('pu-telefono');
  if (telefono) telefono.addEventListener('input', (e) => { state.cliente.telefono = e.target.value; state.duplicadosRevisados = false; });
  const email = document.getElementById('pu-email');
  if (email) email.addEventListener('input', (e) => { state.cliente.email = e.target.value; state.duplicadosRevisados = false; });
  const confirmar = document.getElementById('pu-confirmar');
  if (confirmar) confirmar.addEventListener('click', confirmarCita);
}

const codigoInicial = numeroDesdeUrl();
if (codigoInicial) {
  buscarInmueble(codigoInicial);
} else {
  render();
}
