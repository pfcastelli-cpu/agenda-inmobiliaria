import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  createIcons,
  House,
  Plus,
  Search,
  Store,
  UserRound,
  Users,
} from 'lucide';

const icons = {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  House,
  Plus,
  Search,
  Store,
  UserRound,
  Users,
};

let iniciada = false;

export function actualizarNombreEmpresaDemo(nombre) {
  const el = document.querySelector('#visita-app .v-company');
  if (el) {
    el.textContent = nombre ? `${nombre} · DEMOSTRACIÓN` : 'Agenda de demostración';
  }
}

export function iniciarAgendaDemostracion() {
  if (iniciada) {
    return;
  }
  iniciada = true;

  const root = document.getElementById('visita-app');
  const main = root.querySelector('#v-main');
  const toast = root.querySelector('#v-toast');
  const duration = 40;
  const travel = 30;
  const baseDate = '2026-09-07';
  const tenantId = 'patrimonios-demo';
  const names = ['Valentina Ríos', 'Mateo Beltrán', 'Camila Torres', 'Daniel Acosta', 'Sofía Mendoza', 'Nicolás Vélez', 'Isabella Ruiz', 'Sebastián Mora', 'Mariana Castro', 'Tomás Herrera'];
  const zones = ['Cedritos', 'Chicó', 'Colina Campestre', 'Usaquén', 'Chapinero', 'Salitre', 'Santa Bárbara', 'Suba', 'Rosales', 'Teusaquillo'];
  const colors = ['#426fe2', '#a66adc', '#268979', '#be7745', '#ba6489', '#578dce', '#8b7bc7', '#4e949e', '#ab793e', '#6b89a5'];
  const advisors = names.map((name, i) => ({
    id: 'a' + i,
    tenantId,
    name,
    zone: zones[i],
    color: colors[i],
    start: 480 + (i % 3) * 30,
    end: 1050 + (i % 2) * 30,
    initials: name.split(' ').map((n) => n[0]).join(''),
  }));
  const properties = Array.from({ length: 100 }, (_, i) => ({
    id: 601 + i,
    tenantId,
    advisorId: advisors[i % 10].id,
    zone: zones[i % 10],
    type: i % 9 === 0 ? 'Casa' : i % 7 === 0 ? 'Local' : 'Apartamento',
    mode: i % 4 === 0 ? 'Venta' : 'Arriendo',
    area: 45 + (i * 17) % 210,
    rooms: 1 + i % 4,
    baths: 1 + i % 3,
    price: i % 4 === 0 ? 350000000 + (i * 23000000) % 1900000000 : 1400000 + (i * 170000) % 7200000,
    address: `${i % 2 ? 'Carrera' : 'Calle'} ${25 + (i * 7) % 140} # ${8 + (i * 3) % 60} – ${10 + (i * 11) % 80}`,
    start: 540 + (i % 3) * 30,
    end: 960 + (i % 3) * 30,
    saturday: i % 4 !== 0,
  }));
  const clients = ['Laura Martínez', 'Andrés Gómez', 'Juliana Pérez', 'Carlos Moreno', 'Paula Medina', 'David López', 'Ana Vargas', 'Felipe Ortiz', 'Diana León', 'Santiago Díaz'];
  const appointments = [];
  let nextId = 1;
  const state = {
    view: 'agenda',
    date: baseDate,
    week: 0,
    advisor: 'all',
    query: '',
    zone: 'all',
    mode: 'all',
    page: 0,
    limit: 6,
    property: null,
    slot: null,
    editId: null,
    client: '',
    cancelId: null,
    successId: null,
  };
  const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const prop = (id) => properties.find((p) => p.id === Number(id));
  const advisor = (id) => advisors.find((a) => a.id === id);
  const dateObj = (s) => new Date(s + 'T12:00:00Z');
  const addDays = (s, n) => {
    const d = dateObj(s);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dateLabel = (s) => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateObj(s));
  const time = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const activeAppointments = () => appointments.filter((a) => a.tenantId === tenantId && a.status !== 'cancelled');

  function windowFor(p, date) {
    const day = dateObj(date).getUTCDay();
    const a = advisor(p.advisorId);
    if (day === 0 || (day === 6 && !p.saturday)) return null;
    return { start: Math.max(a.start, p.start), end: Math.min(day === 6 ? 780 : a.end, day === 6 ? 780 : p.end) };
  }

  function canBook(p, date, start, ignoreId = null) {
    const w = windowFor(p, date);
    if (!w || start < w.start || start + duration > w.end) return false;
    return !activeAppointments().some((b) => {
      if (b.id === ignoreId || b.date !== date) return false;
      if (b.advisorId !== p.advisorId && b.propertyId !== p.id) return false;
      const buffer = b.propertyId === p.id ? 0 : travel;
      return start < b.start + duration + buffer && start + duration + buffer > b.start;
    });
  }

  function slotsFor(p, date, ignoreId = null) {
    const w = windowFor(p, date);
    if (!w) return [];
    const result = [];
    for (let t = Math.ceil(w.start / 30) * 30; t + duration <= w.end; t += 30) {
      result.push({ time: t, available: canBook(p, date, t, ignoreId) });
    }
    return result;
  }

  for (let d = 0; d < 14; d++) {
    const date = addDays(baseDate, d);
    advisors.forEach((a, i) => {
      const p = properties[(d % 10) * 10 + i];
      for (const start of [600, 840]) {
        if (canBook(p, date, start)) {
          appointments.push({
            id: 'v' + nextId++,
            tenantId,
            propertyId: p.id,
            advisorId: a.id,
            date,
            start,
            client: clients[(i + d) % clients.length],
            status: 'confirmed',
          });
        }
      }
    });
  }

  function avatar(a) {
    return `<span class="v-avatar">${a.initials}</span>`;
  }
  function notify(text) {
    toast.textContent = text;
  }
  function refreshIcons() {
    createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
  }
  function nav() {
    root.querySelectorAll('[data-view]').forEach((b) => {
      if (b.dataset.view === state.view || (state.view === 'booking' && b.dataset.view === 'properties')) {
        b.setAttribute('aria-current', 'page');
      } else {
        b.removeAttribute('aria-current');
      }
    });
  }
  function setView(view) {
    state.view = view;
    state.cancelId = null;
    state.limit = 6;
    notify('');
    render();
  }
  function dateStrip(booking = false) {
    const first = addDays(baseDate, state.week * 7);
    return `<div class="v-between"><div><strong style="font-size:14px">Septiembre 2026</strong><div class="v-muted" style="font-size:12px">${booking ? 'Elige el día de visita' : 'Semana de demostración'}</div></div><div class="v-row"><button class="v-iconbtn" data-week="-1" aria-label="Semana anterior" ${state.week === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><button class="v-iconbtn" data-week="1" aria-label="Semana siguiente" ${state.week === 1 ? 'disabled' : ''}>${icon('chevron-right')}</button></div></div>
    <div class="v-days">${Array.from({ length: 7 }, (_, i) => {
      const date = addDays(first, i);
      const d = dateObj(date);
      const count = booking
        ? slotsFor(prop(state.property), date, state.editId).filter((s) => s.available).length
        : activeAppointments().filter((a) => a.date === date && (state.advisor === 'all' || a.advisorId === state.advisor)).length;
      return `<button type="button" class="v-day" data-date="${date}" aria-pressed="${state.date === date}" aria-label="${dateLabel(date)}, ${count} ${booking ? 'horarios libres' : 'citas'}"><span>${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getUTCDay()]}</span><strong>${d.getUTCDate()}</strong><small>${count ? count + (booking ? ' libres' : ' citas') : '—'}</small></button>`;
    }).join('')}</div>`;
  }
  function appointmentCard(b) {
    const p = prop(b.propertyId);
    const a = advisor(b.advisorId);
    return `<article class="v-appt"><div class="v-time">${time(b.start)}<small>${time(b.start + duration)}</small></div><div class="v-apptbody" style="--advisor-color:${a.color}">
      <div class="v-between"><span class="v-muted" style="font-size:11px">#${p.id} · ${p.mode}</span><span class="v-tag ${b.status === 'completed' ? 'v-tag-neutral' : ''}">${b.status === 'completed' ? 'Realizada' : 'Confirmada'}</span></div>
      <h3 style="margin-top:6px">${p.type} en ${p.zone}</h3><div class="v-apptmeta"><span>${b.client ? escape(b.client) : 'Cliente de prueba'}</span><span>· ${duration} min</span></div>
      <div class="v-row">${avatar(a)}<span class="v-advisorname">${a.name}</span></div>
      ${b.status === 'completed' ? '' : `<div class="v-actions"><button data-edit="${b.id}">Reprogramar</button><button data-complete="${b.id}">Realizada</button><button class="v-danger" data-cancel="${b.id}">Cancelar</button></div>`}
      ${state.cancelId === b.id ? `<div class="v-cancelbox">¿Cancelar esta visita y liberar el horario?<div class="v-actions"><button class="v-danger" data-confirmcancel="${b.id}">Sí, cancelar</button><button data-keep="${b.id}">Conservar</button></div></div>` : ''}
    </div></article>`;
  }
  function renderAgenda() {
    const today = activeAppointments()
      .filter((a) => a.date === state.date && (state.advisor === 'all' || a.advisorId === state.advisor))
      .sort((a, b) => a.start - b.start || a.advisorId.localeCompare(b.advisorId));
    const completed = today.filter((a) => a.status === 'completed').length;
    main.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Tu operación, al día</div><h2>Agenda de visitas</h2></div><button class="v-btn v-primary" data-new>${icon('plus')}Nueva cita</button></div>
      <div class="v-statbar"><div class="v-stat"><strong>${today.length}</strong><span>Citas del día</span></div><div class="v-stat"><strong>${new Set(today.map((a) => a.advisorId)).size}</strong><span>Asesores con citas</span></div><div class="v-stat"><strong>${completed}</strong><span>Realizadas</span></div></div>
      ${dateStrip()}<label class="v-field" for="v-advisor">Ver agenda de<select id="v-advisor" class="v-input"><option value="all">Todo el equipo · 10 asesores</option>${advisors.map((a) => `<option value="${a.id}" ${state.advisor === a.id ? 'selected' : ''}>${a.name} · ${a.zone}</option>`).join('')}</select></label>
      <div class="v-between"><h3 style="text-transform:capitalize">${dateLabel(state.date).split(' de septiembre')[0]}</h3><span class="v-muted">${today.length} visitas</span></div>
      <div class="v-list">${today.length ? today.slice(0, state.limit).map(appointmentCard).join('') : `<div class="v-empty">${icon('calendar-check')}<h3>Agenda despejada</h3><p style="margin-top:8px">No hay visitas para este día y asesor.</p><button class="v-btn v-primary" data-new style="margin-top:16px">Agendar una visita</button></div>`}</div>
      ${today.length > state.limit ? `<button class="v-btn v-full" data-more style="margin-top:15px">Ver ${today.length - state.limit} citas más ${icon('chevron-down')}</button>` : ''}`;
  }
  function propertyCard(p) {
    const a = advisor(p.advisorId);
    return `<article class="v-property"><div class="v-propertyhead"><div class="v-building">${icon(p.type === 'Casa' ? 'house' : p.type === 'Local' ? 'store' : 'building-2')}</div><div style="min-width:0"><div class="v-muted" style="font-size:11px;margin-bottom:3px">#${p.id} · ${p.mode}</div><h3>${p.type} en ${p.zone}</h3><div class="v-details">${p.area} m² · ${p.type === 'Local' ? 'Espacio comercial' : p.rooms + ' hab. · ' + p.baths + ' baños'}</div></div></div><div class="v-between" style="margin-bottom:12px"><div class="v-price">${money.format(p.price)}<small>${p.mode === 'Arriendo' ? ' / mes' : ''}</small></div></div><div class="v-cardfoot"><div class="v-row">${avatar(a)}<span class="v-advisorname">${a.name.split(' ')[0]}</span></div><button class="v-btn v-primary" data-book="${p.id}">Ver horarios ${icon('arrow-up-right')}</button></div></article>`;
  }
  function filteredProperties() {
    const q = state.query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return properties.filter(
      (p) =>
        p.tenantId === tenantId &&
        (state.zone === 'all' || p.zone === state.zone) &&
        (state.mode === 'all' || p.mode === state.mode) &&
        `${p.id} ${p.zone} ${p.type} ${p.address} ${advisor(p.advisorId).name}`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .includes(q),
    );
  }
  function renderPropertyResults() {
    const list = filteredProperties();
    const total = Math.max(1, Math.ceil(list.length / 6));
    state.page = Math.min(state.page, total - 1);
    root.querySelector('#v-property-results').innerHTML = `<div class="v-between" style="margin-bottom:12px"><span class="v-muted">${list.length} inmuebles</span><span class="v-muted" style="font-size:12px">Asesor asignado automáticamente</span></div><div class="v-grid">${list.slice(state.page * 6, state.page * 6 + 6).map(propertyCard).join('')}</div>${list.length ? '' : `<div class="v-empty">${icon('search')}<h3>No encontramos inmuebles</h3><p style="margin-top:8px">Prueba otro código, barrio o filtro.</p></div>`}<div class="v-pagination"><button class="v-btn" data-page="-1" ${state.page === 0 ? 'disabled' : ''}>${icon('chevron-left')}Anterior</button><span>${state.page + 1} / ${total}</span><button class="v-btn" data-page="1" ${state.page >= total - 1 ? 'disabled' : ''}>Siguiente${icon('chevron-right')}</button></div>`;
    refreshIcons();
  }
  function renderProperties() {
    main.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Encuentra la próxima visita</div><h2>100 oportunidades</h2><p class="v-muted" style="margin-top:6px">Elige un inmueble para ver su disponibilidad.</p></div></div><label class="v-field" for="v-search"><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Buscar por código, barrio o asesor</span><div class="v-search"><input id="v-search" class="v-input" value="${escape(state.query)}" placeholder="Código, barrio o asesor…" type="search">${icon('search')}</div></label><div class="v-filters"><select class="v-input" id="v-zone" aria-label="Filtrar por barrio"><option value="all">Todos los barrios</option>${zones.map((z) => `<option ${z === state.zone ? 'selected' : ''}>${z}</option>`).join('')}</select><select class="v-input" id="v-mode" aria-label="Filtrar por operación"><option value="all">Venta y arriendo</option><option ${state.mode === 'Arriendo' ? 'selected' : ''}>Arriendo</option><option ${state.mode === 'Venta' ? 'selected' : ''}>Venta</option></select></div><div id="v-property-results"></div>`;
    renderPropertyResults();
  }
  function startBooking(id, editId = null) {
    state.property = Number(id);
    state.editId = editId;
    state.slot = null;
    state.client = '';
    if (editId) {
      const b = appointments.find((a) => a.id === editId);
      state.date = b.date;
      state.slot = b.start;
      state.client = b.client;
      state.week = Math.floor((dateObj(b.date) - dateObj(baseDate)) / 86400000 / 7);
    }
    state.view = 'booking';
    notify('');
    render();
  }
  function renderBooking() {
    const p = prop(state.property);
    const a = advisor(p.advisorId);
    const slots = slotsFor(p, state.date, state.editId);
    const free = slots.filter((s) => s.available);
    const w = windowFor(p, state.date);
    if (state.slot !== null && !canBook(p, state.date, state.slot, state.editId)) state.slot = null;
    main.innerHTML = `<div class="v-top"><button class="v-btn v-quiet" data-back>${icon('arrow-left')}Volver</button><span class="v-demo">${state.editId ? 'Reprogramar' : 'Nueva visita'}</span></div><div class="v-step"><span class="active"><b>1</b>Inmueble</span><span>—</span><span class="active"><b>2</b>Horario y cliente</span></div><div class="v-bookinghero"><div class="v-muted">#${p.id} · ${p.mode}</div><h3 style="font-size:20px;margin:4px 0">${p.type} en ${p.zone}</h3><div class="v-muted">${p.address} · ${p.area} m²</div><div class="v-row" style="margin-top:14px">${avatar(a)}<div><div style="font-size:14px;font-weight:600">${a.name}</div><div class="v-muted">Asesor asignado · ${a.zone}</div></div></div></div><div class="v-bookinggrid"><section aria-label="Fecha y disponibilidad">${dateStrip(true)}<div class="v-between"><div class="v-sectiontitle" style="margin:0">${icon('clock-3')}Horarios disponibles</div><span class="v-muted">${free.length} libres</span></div><div class="v-slots">${slots.map((s) => `<button type="button" class="v-slot" data-slot="${s.time}" aria-pressed="${state.slot === s.time}" ${s.available ? '' : 'disabled'} aria-label="${time(s.time)}${s.available ? ' disponible' : ' no disponible'}">${time(s.time)}</button>`).join('')}</div>${!slots.length ? `<div class="v-empty"><h3>Sin atención este día</h3><p style="margin-top:7px">El inmueble o el asesor no recibe visitas. Elige otra fecha.</p></div>` : !free.length ? `<div class="v-empty">Todos los horarios están ocupados. Prueba otro día.</div>` : ''}<p class="v-note">Visita de 40 min · 30 min de traslado entre inmuebles.<br>${w ? 'Ventana de visita: ' + time(w.start) + '–' + time(w.end) + '. Horas tachadas: cita o traslado.' : 'Domingos sin atención; sábados según el inmueble.'}</p></section><section aria-label="Datos de la visita"><form id="v-book-form"><div class="v-sectiontitle">${icon('user-round')}¿Quién visitará el inmueble?</div><label class="v-field" for="v-client">Nombre del cliente<input class="v-input" id="v-client" value="${escape(state.client)}" maxlength="80" placeholder="Ej. Andrea Gómez" autocomplete="off" required></label><div style="padding:15px 0;border-top:1px solid var(--v-line);border-bottom:1px solid var(--v-line);margin:20px 0"><div class="v-muted" style="font-size:12px">TU SELECCIÓN</div><div style="font-size:15px;text-transform:capitalize;margin-top:6px">${dateLabel(state.date)}</div><div id="v-selected-time" style="font-size:23px;font-weight:650;color:var(--v-blue);margin-top:4px">${state.slot === null ? 'Elige una hora' : time(state.slot) + ' – ' + time(state.slot + duration)}</div></div><div id="v-book-error" class="v-error" role="alert"></div><button class="v-btn v-primary v-full" type="submit" ${state.slot === null ? 'disabled' : ''}>${icon('calendar-check')}${state.editId ? 'Guardar nuevo horario' : 'Confirmar visita'}</button><p class="v-note" style="margin-top:12px">Reserva de prueba. No envía mensajes ni crea eventos externos.</p></form></section></div>`;
  }
  function renderTeam() {
    main.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Personas detrás de cada visita</div><h2>Tu equipo</h2><p class="v-muted" style="margin-top:6px">10 asesores · 10 inmuebles por asesor</p></div></div><div class="v-grid">${advisors
      .map((a) => {
        const count = activeAppointments().filter((b) => b.advisorId === a.id && b.date === state.date).length;
        return `<article class="v-teamcard"><div class="v-row">${avatar(a)}<div><h3>${a.name}</h3><p class="v-muted">${a.zone}</p></div></div><div class="v-teammeta"><span><strong style="color:var(--v-text)">10</strong> inmuebles</span><span><strong style="color:var(--v-text)">${count}</strong> citas el ${dateObj(state.date).getUTCDate()} sep.</span></div><div class="v-loadtrack" aria-label="${count * duration} minutos de visitas en la fecha seleccionada"><div class="v-load" style="width:${Math.min(100, (count * duration) / (a.end - a.start) * 100)}%"></div></div><p class="v-muted" style="font-size:12px;margin-bottom:14px">Lun–vie ${time(a.start)}–${time(a.end)}<br>Sábados hasta las 13:00 · Domingo libre</p><button class="v-btn v-full" data-team="${a.id}">${icon('calendar-days')}Ver agenda</button></article>`;
      })
      .join('')}</div>`;
  }
  function renderSuccess() {
    const b = appointments.find((a) => a.id === state.successId);
    const p = prop(b.propertyId);
    const a = advisor(b.advisorId);
    main.innerHTML = `<section class="v-success"><div class="v-successicon">${icon('check')}</div><div class="v-eyebrow">Todo listo</div><h2>${state.editId ? 'Visita reprogramada' : 'Visita confirmada'}</h2><p class="v-muted" style="margin-top:10px">El horario quedó reservado para ${escape(b.client)}.</p><div class="v-ticket"><div class="v-row">${icon('building-2')}<div><h3>${p.type} en ${p.zone}</h3><p class="v-muted">#${p.id} · ${p.address}</p></div></div><div class="v-row">${icon('calendar-days')}<div><div style="text-transform:capitalize">${dateLabel(b.date)}</div><strong>${time(b.start)} – ${time(b.start + duration)}</strong></div></div><div class="v-row">${avatar(a)}<div><div>${a.name}</div><div class="v-muted">Asesor responsable</div></div></div></div><button class="v-btn v-primary v-full" data-gotoagenda>Ver en la agenda ${icon('arrow-right')}</button><button class="v-btn v-quiet" data-new style="margin-top:9px">Agendar otra visita</button><p class="v-note" style="margin:12px 0 0">Reserva simulada ${b.id.toUpperCase()} · Sin notificaciones externas</p></section>`;
  }
  function render() {
    nav();
    if (state.view === 'agenda') renderAgenda();
    else if (state.view === 'properties') renderProperties();
    else if (state.view === 'team') renderTeam();
    else if (state.view === 'booking') renderBooking();
    else renderSuccess();
    refreshIcons();
  }

  root.addEventListener('input', (e) => {
    if (e.target.id === 'v-search') {
      state.query = e.target.value;
      state.page = 0;
      renderPropertyResults();
    }
    if (e.target.id === 'v-client') state.client = e.target.value;
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'v-advisor') {
      state.advisor = e.target.value;
      state.limit = 6;
      render();
    }
    if (e.target.id === 'v-zone') {
      state.zone = e.target.value;
      state.page = 0;
      renderPropertyResults();
    }
    if (e.target.id === 'v-mode') {
      state.mode = e.target.value;
      state.page = 0;
      renderPropertyResults();
    }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.view) {
      setView(b.dataset.view);
      return;
    }
    if (b.hasAttribute('data-new')) {
      state.query = '';
      state.zone = 'all';
      state.mode = 'all';
      state.page = 0;
      state.editId = null;
      setView('properties');
      return;
    }
    if (b.dataset.week) {
      state.week = Math.max(0, Math.min(1, state.week + Number(b.dataset.week)));
      state.date = addDays(baseDate, state.week * 7);
      state.slot = null;
      state.limit = 6;
      render();
      return;
    }
    if (b.dataset.date) {
      state.date = b.dataset.date;
      state.slot = null;
      state.limit = 6;
      render();
      return;
    }
    if (b.dataset.page) {
      state.page += Number(b.dataset.page);
      renderPropertyResults();
      return;
    }
    if (b.hasAttribute('data-more')) {
      state.limit = 100;
      render();
      return;
    }
    if (b.dataset.book) {
      startBooking(b.dataset.book);
      return;
    }
    if (b.hasAttribute('data-back')) {
      setView(state.editId ? 'agenda' : 'properties');
      return;
    }
    if (b.dataset.slot) {
      state.slot = Number(b.dataset.slot);
      root.querySelectorAll('[data-slot]').forEach((el) => el.setAttribute('aria-pressed', String(Number(el.dataset.slot) === state.slot)));
      root.querySelector('#v-selected-time').textContent = time(state.slot) + ' – ' + time(state.slot + duration);
      root.querySelector('#v-book-form button[type=submit]').disabled = false;
      root.querySelector('#v-book-error').textContent = '';
      return;
    }
    if (b.dataset.team) {
      state.advisor = b.dataset.team;
      setView('agenda');
      return;
    }
    if (b.dataset.edit) {
      const apt = appointments.find((a) => a.id === b.dataset.edit);
      startBooking(apt.propertyId, apt.id);
      return;
    }
    if (b.dataset.complete) {
      appointments.find((a) => a.id === b.dataset.complete).status = 'completed';
      notify('Visita marcada como realizada.');
      render();
      return;
    }
    if (b.dataset.cancel) {
      state.cancelId = b.dataset.cancel;
      render();
      return;
    }
    if (b.dataset.keep) {
      state.cancelId = null;
      render();
      return;
    }
    if (b.dataset.confirmcancel) {
      appointments.find((a) => a.id === b.dataset.confirmcancel).status = 'cancelled';
      state.cancelId = null;
      notify('Visita cancelada. El horario vuelve a estar disponible.');
      render();
      return;
    }
    if (b.hasAttribute('data-gotoagenda')) {
      const apt = appointments.find((a) => a.id === state.successId);
      state.date = apt.date;
      state.advisor = apt.advisorId;
      state.week = Math.floor((dateObj(apt.date) - dateObj(baseDate)) / 86400000 / 7);
      setView('agenda');
    }
  });
  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'v-book-form') return;
    e.preventDefault();
    const p = prop(state.property);
    const name = state.client.trim();
    const err = root.querySelector('#v-book-error');
    if (name.length < 2) {
      err.textContent = 'Escribe un nombre de al menos dos caracteres.';
      root.querySelector('#v-client').focus();
      return;
    }
    if (state.slot === null || !canBook(p, state.date, state.slot, state.editId)) {
      err.textContent = 'Este horario ya no está disponible. Selecciona otro.';
      return;
    }
    if (state.editId) {
      const apt = appointments.find((a) => a.id === state.editId);
      Object.assign(apt, { date: state.date, start: state.slot, client: name });
      state.successId = apt.id;
    } else {
      const apt = {
        id: 'v' + nextId++,
        tenantId,
        propertyId: p.id,
        advisorId: p.advisorId,
        date: state.date,
        start: state.slot,
        client: name,
        status: 'confirmed',
      };
      appointments.push(apt);
      state.successId = apt.id;
    }
    state.view = 'success';
    render();
  });
  render();
}
