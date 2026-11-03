// Página pública /consignar: el propietario agenda solo la cita de captación (un asesor va a conocer y fotografiar su inmueble).
// Se muestran los horarios libres de TODOS los asesores de la ciudad, mezclados; la base asigna al asesor de mayor prioridad
// que esté libre (RPC agenda_captacion_publica_*, sql/042). La empresa sale del dominio (o de ?empresa=slug, útil en pruebas locales).
// La página está apagada hasta activar «captacion_publica_activa» en Administración → Empresa.
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';
import './teclado-publico.js';

const raiz = document.getElementById('pu-main');
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIPOS = ['Apartamento', 'Apartaestudio', 'Casa', 'Casa campestre o finca', 'Local', 'Oficina', 'Consultorio', 'Bodega', 'Lote', 'Edificio', 'Parqueadero', 'Otro'];
const GESTIONES = ['Arrendar', 'Vender', 'Arrendar y vender'];

const state = {
  paso: 'cargando', // cargando | inactiva | inmueble | horario | datos | confirmado | error
  ciudades: [],
  nombreEmpresa: '',
  f: { ciudadId: '', zonaId: '', gestion: '', tipo: '', barrio: '', complemento: '', direccion: '', valor: '', nombre: '', telefono: '', email: '', observaciones: '', acepta: false },
  slots: [], // [{fecha, hora_inicio, hora_fin}]
  fechaSel: null,
  slotSel: null,
  cargandoSlots: false,
  enviando: false,
  error: '',
  confirmacion: null,
  hora12: true,
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const empresaSlug = () => new URLSearchParams(window.location.search).get('empresa') || null;
const base = () => ({ p_empresa_slug: empresaSlug(), p_host: window.location.hostname });
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function hora(h) {
  const [hh, mm] = String(h).split(':').map(Number);
  if (!state.hora12) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'p. m.' : 'a. m.'}`;
}
function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  return { dia: DIAS[f.getDay()], num: d, mes: MESES[m - 1] };
}
function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const t = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(a, m - 1, d));
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function msg(error, generico) {
  const t = error?.message || '';
  return !t || /function|candidate|relation|column|syntax|schema|constraint|violates|uuid|pg_|does not exist|permission denied/i.test(t) ? generico : t;
}

async function iniciar() {
  if (!hayConfiguracionSupabase()) {
    state.paso = 'error';
    state.error = 'La página no está configurada todavía.';
    return render();
  }
  aplicarMarcaPublica();
  try {
    const { data: fh } = await supabase.rpc('agenda_formato_hora_publico', { p_host: window.location.hostname });
    state.hora12 = fh !== '24h';
  } catch { /* formato de 12 h por defecto */ }
  const { data, error } = await supabase.rpc('agenda_captacion_publica_config', base());
  if (error) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en un momento.'; return render(); }
  if (!data?.activa) { state.paso = 'inactiva'; return render(); }
  state.ciudades = data.ciudades || [];
  state.nombreEmpresa = data.nombre || '';
  state.paso = 'inmueble';
  render();
}

async function cargarHorarios() {
  state.cargandoSlots = true;
  state.error = '';
  state.slots = [];
  state.fechaSel = null;
  state.slotSel = null;
  render();
  const { data, error } = await supabase.rpc('agenda_captacion_publica_horarios', {
    p_ciudad_id: state.f.ciudadId,
    p_fecha_desde: hoyISO(),
    p_cobertura_id: state.f.zonaId || null,
    ...base(),
  });
  state.cargandoSlots = false;
  if (error) state.error = msg(error, 'No pudimos consultar los horarios. Inténtalo de nuevo.');
  else state.slots = data || [];
  state.fechaSel = state.slots[0]?.fecha || null;
  render();
}

const ciudadSel = () => state.ciudades.find((c) => c.id === state.f.ciudadId);

function pasoInmueble() {
  const c = ciudadSel();
  const f = state.f;
  return `<h2>Cuéntanos de tu inmueble</h2><p>Con estos datos tu asesor llega preparado a la visita.</p>
  <div class="pu-card">
    <label for="c-ciudad">Ciudad o municipio</label>
    <select id="c-ciudad"><option value="">Selecciona</option>${state.ciudades.map((x) => `<option value="${x.id}" ${f.ciudadId === x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    ${c && c.zonas.length ? `<label for="c-zona">Zona (opcional)</label><select id="c-zona"><option value="">No estoy seguro</option>${c.zonas.map((z) => `<option value="${z.id}" ${f.zonaId === z.id ? 'selected' : ''}>${esc(z.nombre)}</option>`).join('')}</select>` : ''}
    <label for="c-gestion">¿Qué quieres hacer?</label>
    <select id="c-gestion"><option value="">Selecciona</option>${GESTIONES.map((g) => `<option ${f.gestion === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <label for="c-tipo">Tipo de inmueble</label>
    <select id="c-tipo"><option value="">Selecciona</option>${TIPOS.map((t) => `<option ${f.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <label for="c-direccion">Dirección</label><input id="c-direccion" autocomplete="street-address" value="${esc(f.direccion)}" placeholder="Calle o carrera y número" maxlength="160">
    <label for="c-complemento">Conjunto, edificio o apartamento (opcional)</label><input id="c-complemento" value="${esc(f.complemento)}" placeholder="Ej: Torre 2, apto 501" maxlength="100">
    <label for="c-barrio">Barrio o sector (opcional)</label><input id="c-barrio" value="${esc(f.barrio)}" maxlength="80">
    <label for="c-valor">Valor esperado en pesos (opcional)</label><input id="c-valor" inputmode="numeric" value="${esc(f.valor)}" placeholder="Ej: 3.500.000" maxlength="16">
  </div>
  ${state.error ? `<div class="pu-error" role="alert">${esc(state.error)}</div>` : ''}
  <button class="pu-main" id="c-sig-inmueble" type="button">Ver horarios disponibles</button>`;
}

function pasoHorario() {
  const dias = [...new Set(state.slots.map((s) => s.fecha))];
  const delDia = state.slots.filter((s) => s.fecha === state.fechaSel);
  return `<button class="pu-volver" type="button" data-ir="inmueble">← Volver</button>
  <h2>Elige el día y la hora</h2><p>La visita dura unos 90 minutos. ${esc(ciudadSel()?.nombre || '')}.</p>
  ${state.cargandoSlots ? '<div class="pu-spinner">Buscando horarios…</div>' : !dias.length ? `<div class="pu-vacio">${state.error ? esc(state.error) : 'Por ahora no hay horarios libres en los próximos días para esta ciudad. Escríbenos por WhatsApp o llámanos y te agendamos.'}</div>` : `
  <div class="pu-card">
    <div class="pu-fechas" role="tablist">${dias.map((d) => { const x = fechaCorta(d); return `<button type="button" class="pu-fecha ${d === state.fechaSel ? 'activa' : ''}" data-fecha="${d}">${x.dia}<strong>${x.num}</strong>${x.mes}</button>`; }).join('')}</div>
    <h3>${esc(fechaLarga(state.fechaSel))}</h3>
    <div class="pu-slots">${delDia.map((s) => `<button type="button" class="pu-slot ${state.slotSel && state.slotSel.hora_inicio === s.hora_inicio && state.slotSel.fecha === s.fecha ? 'activo' : ''}" data-slot="${s.fecha}|${s.hora_inicio}">${hora(s.hora_inicio)}</button>`).join('')}</div>
  </div>
  <button class="pu-main" id="c-sig-horario" type="button" ${state.slotSel ? '' : 'disabled'}>Continuar</button>`}`;
}

function pasoDatos() {
  const f = state.f;
  const s = state.slotSel;
  return `<button class="pu-volver" type="button" data-ir="horario">← Volver</button>
  <h2>Tus datos</h2><p>${esc(fechaLarga(s.fecha))} · ${esc(hora(s.hora_inicio))}</p>
  <div class="pu-card">
    <label for="c-nombre">Nombre completo</label><input id="c-nombre" autocomplete="name" value="${esc(f.nombre)}" maxlength="120">
    <label for="c-telefono">Celular o WhatsApp</label><input id="c-telefono" type="tel" autocomplete="tel" value="${esc(f.telefono)}" maxlength="20">
    <label for="c-email">Correo electrónico</label><input id="c-email" type="email" autocomplete="email" value="${esc(f.email)}" maxlength="120">
    <label for="c-obs">Algo que debamos saber (opcional)</label><input id="c-obs" value="${esc(f.observaciones)}" maxlength="300">
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:16px"><input id="c-acepta" type="checkbox" style="width:auto;min-height:0;margin-top:3px" ${f.acepta ? 'checked' : ''}><span>Soy propietario o estoy autorizado por el propietario, y autorizo el tratamiento de mis datos personales (Ley 1581 de 2012) para contactarme sobre esta visita.</span></label>
  </div>
  ${state.error ? `<div class="pu-error" role="alert">${esc(state.error)}</div>` : ''}
  <button class="pu-main" id="c-confirmar" type="button" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Agendando…' : 'Confirmar mi cita'}</button>`;
}

function pasoConfirmado() {
  const c = state.confirmacion;
  return `<div class="pu-confirmacion"><h2>¡Listo, quedó agendada!</h2>
  <p style="font-size:17px;color:inherit"><strong>${esc(fechaLarga(c.fecha))}</strong><br>${esc(hora(c.hora_inicio))} – ${esc(hora(c.hora_fin))}</p>
  <p>Te enviamos la confirmación a <strong>${esc(state.f.email)}</strong> con los datos de tu asesor${c.asesor_nombre ? ` (${esc(c.asesor_nombre)})` : ''}. Si no la ves, revisa la carpeta de spam.</p></div>`;
}

function render() {
  const mapa = {
    cargando: () => '<div class="pu-spinner">Cargando…</div>',
    inactiva: () => '<div class="pu-card"><h2>Esta página no está disponible</h2><p>Por ahora no recibimos solicitudes por aquí. Comunícate con nosotros directamente.</p></div>',
    error: () => `<div class="pu-error" role="alert">${esc(state.error)}</div>`,
    inmueble: pasoInmueble, horario: pasoHorario, datos: pasoDatos, confirmado: pasoConfirmado,
  };
  raiz.innerHTML = mapa[state.paso]();
  window.scrollTo({ top: 0 });
}

const NUM = (t) => String(t).replace(/\D/g, '');
raiz.addEventListener('input', (e) => {
  const f = state.f;
  const id = e.target.id;
  if (id === 'c-direccion') f.direccion = e.target.value;
  else if (id === 'c-barrio') f.barrio = e.target.value;
  else if (id === 'c-complemento') f.complemento = e.target.value;
  else if (id === 'c-valor') { const n = NUM(e.target.value); f.valor = n ? Number(n).toLocaleString('es-CO') : ''; e.target.value = f.valor; }
  else if (id === 'c-nombre') f.nombre = e.target.value;
  else if (id === 'c-telefono') f.telefono = e.target.value;
  else if (id === 'c-email') f.email = e.target.value;
  else if (id === 'c-obs') f.observaciones = e.target.value;
});
raiz.addEventListener('change', (e) => {
  const f = state.f;
  const id = e.target.id;
  if (id === 'c-ciudad') { f.ciudadId = e.target.value; f.zonaId = ''; render(); }
  else if (id === 'c-zona') f.zonaId = e.target.value;
  else if (id === 'c-gestion') f.gestion = e.target.value;
  else if (id === 'c-tipo') f.tipo = e.target.value;
  else if (id === 'c-acepta') f.acepta = e.target.checked;
});

async function confirmar() {
  const f = state.f;
  state.error = '';
  if (f.nombre.trim().length < 2) state.error = 'Escribe tu nombre completo.';
  else if (NUM(f.telefono).length < 7) state.error = 'Escribe un número de celular válido.';
  else if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) state.error = 'Escribe un correo electrónico válido.';
  else if (!f.acepta) state.error = 'Debes autorizar el tratamiento de tus datos para continuar.';
  if (state.error) return render();
  state.enviando = true;
  render();
  const { data, error } = await supabase.rpc('agenda_captacion_publica_agendar', {
    p_ciudad_id: f.ciudadId, p_fecha: state.slotSel.fecha, p_hora_inicio: state.slotSel.hora_inicio,
    p_nombre: f.nombre.trim(), p_telefono: f.telefono.trim(), p_email: f.email.trim(), p_direccion: f.direccion.trim(),
    p_tipo_inmueble: f.tipo || null, p_gestion: f.gestion || null, p_valor: f.valor ? Number(NUM(f.valor)) : null,
    p_barrio: f.barrio.trim() || null, p_complemento: f.complemento.trim() || null, p_observaciones: f.observaciones.trim() || null, p_cobertura_id: f.zonaId || null,
    p_acepta_datos: f.acepta, ...base(),
  });
  state.enviando = false;
  if (error) {
    const ocupado = /ya no está disponible/i.test(error.message || '');
    state.error = ocupado ? 'Ese horario acaba de ser tomado. Elige otro, por favor.' : msg(error, 'No pudimos agendar tu cita. Inténtalo de nuevo.');
    if (ocupado) { state.paso = 'horario'; return cargarHorarios(); }
    return render();
  }
  state.confirmacion = data;
  state.paso = 'confirmado';
  render();
  // Correos de confirmación (propietario) y aviso (asesor): no bloquean la pantalla si fallan.
  supabase.functions.invoke('avisar-captacion', { body: { cita_id: data.cita_id, token: data.token } }).catch(() => {});
}

raiz.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.id === 'c-sig-inmueble') {
    const f = state.f;
    state.error = '';
    if (!f.ciudadId) state.error = 'Selecciona la ciudad.';
    else if (!f.gestion) state.error = 'Cuéntanos qué quieres hacer con tu inmueble.';
    else if (!f.tipo) state.error = 'Selecciona el tipo de inmueble.';
    else if (f.direccion.trim().length < 5) state.error = 'Escribe la dirección del inmueble.';
    if (state.error) return render();
    state.paso = 'horario';
    return cargarHorarios();
  }
  if (b.dataset.ir) { state.error = ''; state.paso = b.dataset.ir; return render(); }
  if (b.dataset.fecha) { state.fechaSel = b.dataset.fecha; state.slotSel = null; return render(); }
  if (b.dataset.slot) { const [fecha, h] = b.dataset.slot.split('|'); state.slotSel = state.slots.find((s) => s.fecha === fecha && s.hora_inicio === h) || null; return render(); }
  if (b.id === 'c-sig-horario') { state.error = ''; state.paso = 'datos'; return render(); }
  if (b.id === 'c-confirmar') return confirmar();
});

iniciar();
