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
const FAQ_URL = 'https://www.patrimonios.co/preguntas-frecuentes/generales';
// Condición de cobro tal como la confirmó la empresa: se repite igual en la página para no prometer de más.
const COBRO = 'Solo cobramos cuando se firma la promesa de compraventa, o cuando se firma el contrato de arrendamiento y se entrega el inmueble.';
const PREGUNTAS = [
  ['¿Cuál es la trampa?', `No hay trampa: agendar y la visita no tienen costo, no pedimos exclusividad y puedes cancelar cuando quieras. Ganamos solo si logramos el resultado. ${COBRO} No garantizamos plazos ni el precio de venta.`],
  ['¿Tengo que dejarles el inmueble en exclusiva?', 'No. No pedimos exclusividad.'],
  ['¿Tengo que pagar algo para agendar?', `No. Agendar y la visita del asesor no tienen costo. ${COBRO}`],
  ['¿Qué pasa si cambio de opinión?', 'Puedes cancelar cuando quieras. Escríbele a tu asesor o a nosotros y listo.'],
  ['¿Qué hace el asesor en la visita?', 'Conoce tu inmueble, toma las fotos y te explica cómo lo publicamos y administramos.'],
  ['¿Qué hacen con mis datos?', 'Los usamos para contactarte sobre esta visita. Tienes derecho a conocerlos, actualizarlos o pedir que los eliminemos.'],
];
const enlaceFaq = `<a href="${FAQ_URL}" target="_blank" rel="noopener">Ver todas las preguntas frecuentes</a>`;
// Acepta enlaces youtu.be/…, youtube.com/watch?v=…, /embed/… y /shorts/…; devuelve el ID de 11 caracteres o ''.
const videoId = (url) => (String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/) || [])[1] || '';

const state = {
  videoId: '',
  videoCargado: false,
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
  state.videoId = videoId(data.video_url);
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

// El video solo se muestra si la empresa configuró el enlace. No se incrusta al cargar: primero una miniatura (la página pesa
// poco en el celular y no habla con YouTube hasta que la persona toca play).
function bloqueVideo() {
  const id = state.videoId;
  if (!id) return '';
  const caja = state.videoCargado
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&cc_load_policy=1&hl=es" title="Cómo funciona la visita de captación" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
    : `<button type="button" class="pu-video-play" data-video="1" aria-label="Reproducir el video"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy"><span aria-hidden="true">▶</span></button>`;
  return `<details class="pu-video" ${state.videoCargado ? 'open' : ''}><summary>Mira cómo funciona (1 minuto)</summary><div class="pu-video-caja">${caja}</div><a class="pu-video-yt" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Ver en YouTube</a></details>`;
}

function pasoInmueble() {
  const c = ciudadSel();
  const f = state.f;
  const masDetalles = !!(f.complemento || f.barrio || f.valor);
  return `<span class="pu-paso">Paso 1 de 3</span>
  <h2>Vende o arrienda sin exclusividad. Pagas solo si lo logramos.</h2><p>Agenda la visita de un asesor en 2 minutos: conoce tu inmueble, toma las fotos y lo publica.</p>
  ${bloqueVideo()}
  <ol class="pu-pasos">
    <li>Cuéntanos qué inmueble tienes y elige el día y la hora que te sirvan.</li>
    <li>Un asesor te visita, conoce tu inmueble y toma las fotos.</li>
    <li>Lo publicamos y te contamos cómo va.</li>
  </ol>
  <div class="pu-confianza"><strong>Nuestro compromiso</strong>
    <ul class="pu-compromiso">
      <li><span aria-hidden="true">🔓</span><span><strong>Sin exclusividad.</strong> Puedes seguir con otros si quieres.</span></li>
      <li><span aria-hidden="true">💸</span><span><strong>Si no hay resultado, no nos debes nada.</strong> ${COBRO} Agendar y la visita no tienen costo.</span></li>
      <li><span aria-hidden="true">✋</span><span><strong>Cancelas cuando quieras.</strong></span></li>
    </ul>
    <small>Así nuestro interés y el tuyo son el mismo. No garantizamos plazos ni el precio de venta.</small>
  </div>
  <div class="pu-card">
    <label for="c-ciudad">Ciudad o municipio</label>
    <select id="c-ciudad"><option value="">Selecciona</option>${state.ciudades.map((x) => `<option value="${x.id}" ${f.ciudadId === x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    ${c && c.zonas.length ? `<label for="c-zona">Zona (opcional)</label><select id="c-zona"><option value="">No estoy seguro</option>${c.zonas.map((z) => `<option value="${z.id}" ${f.zonaId === z.id ? 'selected' : ''}>${esc(z.nombre)}</option>`).join('')}</select>` : ''}
    <label for="c-gestion">¿Qué quieres hacer?</label>
    <select id="c-gestion"><option value="">Selecciona</option>${GESTIONES.map((g) => `<option ${f.gestion === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <label for="c-tipo">Tipo de inmueble</label>
    <select id="c-tipo"><option value="">Selecciona</option>${TIPOS.map((t) => `<option ${f.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <label for="c-direccion">Dirección</label><input id="c-direccion" autocomplete="street-address" value="${esc(f.direccion)}" placeholder="Calle o carrera y número" maxlength="160">
    <details class="pu-mas" ${masDetalles ? 'open' : ''}><summary>Más detalles (opcional)</summary>
      <label for="c-complemento">Conjunto, edificio o apartamento</label><input id="c-complemento" value="${esc(f.complemento)}" placeholder="Ej: Torre 2, apto 501" maxlength="100">
      <label for="c-barrio">Barrio o sector</label><input id="c-barrio" value="${esc(f.barrio)}" maxlength="80">
      <label for="c-valor">Valor esperado en pesos</label><input id="c-valor" inputmode="numeric" value="${esc(f.valor)}" placeholder="Ej: 3.500.000" maxlength="16">
    </details>
  </div>
  ${state.error ? `<div class="pu-error" role="alert">${esc(state.error)}</div>` : ''}
  <button class="pu-main" id="c-sig-inmueble" type="button">Ver horarios disponibles</button>
  <h3>Preguntas frecuentes</h3>
  <div class="pu-faq">${PREGUNTAS.map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join('')}</div>
  <p class="pu-faq-mas">${enlaceFaq}</p>`;
}

function pasoHorario() {
  const dias = [...new Set(state.slots.map((s) => s.fecha))];
  const delDia = state.slots.filter((s) => s.fecha === state.fechaSel);
  return `<button class="pu-volver" type="button" data-ir="inmueble">← Volver</button>
  <span class="pu-paso">Paso 2 de 3</span>
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
  <span class="pu-paso">Paso 3 de 3</span>
  <h2>Tus datos</h2><p>${esc(fechaLarga(s.fecha))} · ${esc(hora(s.hora_inicio))}</p>
  <div class="pu-card">
    <label for="c-nombre">Nombre completo</label><input id="c-nombre" autocomplete="name" value="${esc(f.nombre)}" maxlength="120">
    <label for="c-telefono">Celular o WhatsApp</label><input id="c-telefono" type="tel" autocomplete="tel" value="${esc(f.telefono)}" maxlength="20">
    <label for="c-email">Correo electrónico</label><input id="c-email" type="email" autocomplete="email" value="${esc(f.email)}" maxlength="120">
    <label for="c-obs">Algo que debamos saber (opcional)</label><input id="c-obs" value="${esc(f.observaciones)}" maxlength="300">
    <label style="display:flex;gap:12px;align-items:flex-start;margin-top:16px"><input id="c-acepta" type="checkbox" style="width:24px;height:24px;min-height:0;flex:none;margin:0" ${f.acepta ? 'checked' : ''}><span>Soy propietario o estoy autorizado por el propietario, y autorizo el tratamiento de mis datos personales (Ley 1581 de 2012) para contactarme sobre esta visita.</span></label>
  </div>
  ${state.error ? `<div class="pu-error" role="alert">${esc(state.error)}</div>` : ''}
  <p class="pu-aviso-final">Solo usamos tus datos para esta visita. Agendar no tiene costo y puedes cancelar o cambiar la hora cuando quieras.</p>
  <button class="pu-main" id="c-confirmar" type="button" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Agendando…' : 'Reservar mi visita'}</button>`;
}

function pasoConfirmado() {
  const c = state.confirmacion;
  return `<div class="pu-confirmacion"><h2>¡Listo, tu visita quedó agendada!</h2>
  <p style="font-size:17px;color:inherit"><strong>${esc(fechaLarga(c.fecha))}</strong><br>${esc(hora(c.hora_inicio))} – ${esc(hora(c.hora_fin))}</p>
  <p>Te enviamos la confirmación a <strong>${esc(state.f.email)}</strong> con los datos de tu asesor${c.asesor_nombre ? ` (${esc(c.asesor_nombre)})` : ''}. Si no la ves, revisa la carpeta de spam.</p>
  <h3>Qué pasa ahora</h3>
  <ol class="pu-pasos">
    <li>Tu asesor ya tiene tu solicitud y puede escribirte para confirmar los detalles de la visita.</li>
    <li>El día de la visita conocerá tu inmueble y tomará las fotos.</li>
    <li>¿Cambio de planes? Escríbele a tu asesor y reprogramamos o cancelamos.</li>
  </ol>
  <p>¿Quieres adelantar? Puedes enviarle las fotos y datos de tu inmueble por WhatsApp, o dejar que él los tome en la visita.</p>
  <p class="pu-faq-mas">${enlaceFaq}</p></div>`;
}

function render(conservarPosicion = false) {
  const mapa = {
    cargando: () => '<div class="pu-spinner">Cargando…</div>',
    inactiva: () => '<div class="pu-card"><h2>Esta página no está disponible</h2><p>Por ahora no recibimos solicitudes por aquí. Comunícate con nosotros directamente.</p></div>',
    error: () => `<div class="pu-error" role="alert">${esc(state.error)}</div>`,
    inmueble: pasoInmueble, horario: pasoHorario, datos: pasoDatos, confirmado: pasoConfirmado,
  };
  raiz.innerHTML = mapa[state.paso]();
  // Con un error de validación se lleva a la persona al mensaje (con el teclado abierto en el celular no se veía abajo).
  const aviso = state.error ? raiz.querySelector('.pu-error') : null;
  if (aviso) aviso.scrollIntoView({ block: 'center' });
  else if (!conservarPosicion) window.scrollTo({ top: 0 });
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
  if (id === 'c-ciudad') { f.ciudadId = e.target.value; f.zonaId = ''; state.videoCargado = false; render(true); }
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
  if (b.dataset.video) { state.videoCargado = true; return render(true); }
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
