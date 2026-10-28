import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { crearApiSoporte } from './soporte-comun/api.js';
import { COLOR_ESTADO, COLOR_PRIORIDAD, EMOJI_TIPO, ESTADOS_EQUIPO, PRIORIDADES, PUNTOS, TIPOS } from './soporte-comun/constantes.js';
import { duracionMin, escapar as esc, estrellas, fechaHora as fecha, minutosParaSla } from './soporte-comun/formato.js';
import { construirLinea, textoEvento } from './soporte-comun/linea-tiempo.js';
import { montarCampana, EVENTO_AVISOS } from './soporte-comun/campana.js';
import { montarFallos } from './fallos-sistema.js';

// Consola de soporte de la plataforma (/soporte). La usan SOLO usuarios de soporte (tabla agenda_soporte_usuarios, sql/023):
// ven los tickets de todas las empresas, conversan con quien los escribió, dejan notas internas, cambian estado, prioridad y
// responsable, ven métricas y, cuando una empresa les da «acceso de ayuda» temporal, abren un diagnóstico de solo lectura.
// Todo pasa por funciones de la base (sql/023–025) a través de ./soporte-comun/api.js; aquí solo se pinta.
const raiz = document.getElementById('raiz');
const quien = document.getElementById('quien');
const botonSalir = document.getElementById('salir');
const api = crearApiSoporte(supabase);

const ui = {
  filtro: 'abiertos', empresa: '', asignacion: '', dias: 30, empresas: [], tickets: [], metricas: null, diag: {}, mensaje: '', error: '', nombre: '',
  abierto: null, detalle: null, respuestas: {}, notas: {}, estadoResp: {},
};
let campana = null;

function vistaLogin(error = '') {
  campana?.destruir(); campana = null;
  quien.textContent = '';
  botonSalir.hidden = true;
  raiz.innerHTML = `<section class="tarjeta login"><h2>Entrar a soporte</h2>
    <p class="suave">Solo para el equipo de soporte de la plataforma.</p>
    <form id="form-login"><label>Correo<input type="email" id="email" autocomplete="username" required></label>
    <label>Contraseña<input type="password" id="clave" autocomplete="current-password" required></label>
    ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
    <button class="principal" type="submit">Iniciar sesión</button></form></section>`;
  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const { error: err } = await supabase.auth.signInWithPassword({ email: document.getElementById('email').value.trim(), password: document.getElementById('clave').value });
    if (err) return vistaLogin('No pudimos iniciar sesión. Revisa el correo y la contraseña.');
    arrancar();
  };
}

function vistaSinAcceso() {
  raiz.innerHTML = `<section class="tarjeta login"><h2>Sin acceso</h2><p>Esta cuenta no es de soporte de la plataforma. Si eres parte de una empresa, entra por la agenda.</p>
    <p><a href="/">Ir a la agenda</a></p></section>`;
}

async function cargar() {
  const [emp, tk, met] = await Promise.all([
    api.empresas(),
    api.listaSoporte({ estado: ui.filtro, empresaId: ui.empresa, asignacion: ui.asignacion }),
    api.metricas(ui.empresa || null, ui.dias),
  ]);
  if (emp.error || tk.error) throw new Error(emp.error || tk.error);
  ui.empresas = emp.data || [];
  ui.tickets = tk.data || [];
  ui.metricas = met.data;
  ui.detalle = null;
  if (ui.abierto && ui.tickets.some((t) => t.id === ui.abierto)) {
    const d = await api.detalle(ui.abierto);
    if (d.error) ui.error = d.error; else ui.detalle = d.data;
    api.marcarAvisos({ ticketId: ui.abierto }).then(() => window.dispatchEvent(new Event(EVENTO_AVISOS)));
  }
}

function textoSla(t) {
  const min = minutosParaSla(t);
  if (min == null) return '';
  return min < 0
    ? `<span class="etiqueta" style="color:#b3261e;border-color:#b3261e55">Vencido hace ${duracionMin(-min)}</span>`
    : `<span class="etiqueta">Responder en ${duracionMin(min)}</span>`;
}

function panelMetricas(m) {
  if (!m) return '';
  const csat = m.csat || {};
  const celda = (valor, texto, alerta) => `<div class="metrica${alerta ? ' alerta' : ''}"><div class="valor">${valor}</div><div class="suave">${texto}</div></div>`;
  const dist = csat.n ? [5, 4, 3, 2, 1].map((n) => `<div class="barra"><span>${n}★</span><i style="width:${Math.round(100 * (csat.distribucion?.[n] || 0) / csat.n)}%"></i><b>${csat.distribucion?.[n] || 0}</b></div>`).join('') : '<p class="suave">Aún no hay calificaciones en este periodo.</p>';
  const empresas = (m.por_empresa || []).slice(0, 8).map((e) => `<tr><td>${esc(e.empresa)}</td><td>${e.creados}</td><td>${e.pendientes}</td></tr>`).join('');
  return `<section class="tarjeta" style="margin-bottom:16px" aria-label="Indicadores de gestión">
    <div class="cabeza"><strong>Indicadores de gestión</strong>
      <label style="flex:none;flex-direction:row;align-items:center;gap:6px">Periodo<select id="f-dias" style="width:auto">${[7, 30, 90].map((d) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${d} días</option>`).join('')}</select></label></div>
    <div class="metricas">
      ${celda(m.pendientes, 'Por atender', m.pendientes > 0)}
      ${celda(m.vencidos, 'Sin primera respuesta a tiempo', m.vencidos > 0)}
      ${celda(m.sin_asignar, 'Sin responsable', m.sin_asignar > 0)}
      ${celda(m.en_espera, 'Esperando al usuario')}
      ${celda(m.antiguos_7d, 'En curso hace más de 7 días', m.antiguos_7d > 0)}
      ${celda(m.creados, `Creados (${m.dias} d)`)}
      ${celda(m.resueltos, `Resueltos (${m.dias} d)`)}
      ${celda(m.sla_primera_pct != null ? `${m.sla_primera_pct}%` : '—', 'Primera respuesta a tiempo')}
      ${celda(duracionMin(m.primera_respuesta_min?.mediana), `Primera respuesta · mediana<br>p90: ${duracionMin(m.primera_respuesta_min?.p90)} · n=${m.primera_respuesta_min?.n || 0}`)}
      ${celda(m.resolucion_horas?.mediana != null ? `${m.resolucion_horas.mediana} h` : '—', `Resolución · mediana<br>p90: ${m.resolucion_horas?.p90 != null ? `${m.resolucion_horas.p90} h` : '—'} · n=${m.resolucion_horas?.n || 0}`)}
      ${celda(m.reabiertos_pct != null ? `${m.reabiertos_pct}%` : '—', 'Reabiertos')}
      ${celda(csat.n ? `${csat.promedio} / 5` : '—', `Calificación · n=${csat.n || 0}${csat.tasa_respuesta_pct != null ? ` (${csat.tasa_respuesta_pct}% de los atendidos)` : ''}${csat.n ? `<br>${csat.positivas_pct}% buenas o excelentes` : ''}`)}
    </div>
    <div class="dos">
      <div><p class="suave" style="margin:8px 0 4px"><b>Calificaciones</b>${csat.n && csat.n < 10 ? ' (pocas respuestas: tómalas con cautela)' : ''}</p>${dist}</div>
      ${empresas ? `<div><p class="suave" style="margin:8px 0 4px"><b>Por empresa</b></p><table class="tabla"><thead><tr><th>Empresa</th><th>Creados</th><th>En curso</th></tr></thead><tbody>${empresas}</tbody></table></div>` : ''}
    </div>
  </section>`;
}

async function pintar() {
  try {
    await cargar();
  } catch (e) {
    ui.error = e.message;
  }
  raiz.innerHTML = `<button type="button" id="soporte-fallos">Fallos del sistema</button><h2>Tickets de todas las empresas</h2>
    <p class="suave">«Acceso de ayuda» = la empresa autorizó a soporte a ver un diagnóstico de solo lectura por un tiempo limitado.</p>
    ${panelMetricas(ui.metricas)}
    <div class="fila">
      <label>Ver<select id="f-estado"><option value="abiertos" ${ui.filtro === 'abiertos' ? 'selected' : ''}>Por atender</option>
        ${Object.entries(ESTADOS_EQUIPO).map(([v, t]) => `<option value="${v}" ${ui.filtro === v ? 'selected' : ''}>${t}</option>`).join('')}
        <option value="todos" ${ui.filtro === 'todos' ? 'selected' : ''}>Todos</option></select></label>
      <label>Responsable<select id="f-asignacion"><option value="">Todos</option>
        <option value="mios" ${ui.asignacion === 'mios' ? 'selected' : ''}>Los míos</option>
        <option value="sin_asignar" ${ui.asignacion === 'sin_asignar' ? 'selected' : ''}>Sin responsable</option></select></label>
      <label>Empresa<select id="f-empresa"><option value="">Todas</option>
        ${ui.empresas.map((e) => `<option value="${e.id}" ${ui.empresa === e.id ? 'selected' : ''}>${esc(e.nombre)}${e.tickets_abiertos ? ` (${e.tickets_abiertos})` : ''}${e.acceso_hasta ? ' · con acceso' : ''}</option>`).join('')}</select></label>
    </div>
    ${ui.error ? `<div class="error" role="alert">${esc(ui.error)}</div>` : ''}
    ${ui.mensaje ? `<div class="ok" role="status">${esc(ui.mensaje)}</div>` : ''}
    ${ui.tickets.length ? ui.tickets.map(tarjeta).join('') : '<p class="suave">No hay tickets con este filtro.</p>'}`;
  const recargar = () => { ui.mensaje = ''; ui.error = ''; pintar(); };
  document.getElementById('soporte-fallos').onclick=()=>montarFallos({el:raiz,supabase,empresas:ui.empresas,volver:pintar});
  document.getElementById('f-estado').onchange = (e) => { ui.filtro = e.target.value; ui.abierto = null; recargar(); };
  document.getElementById('f-asignacion').onchange = (e) => { ui.asignacion = e.target.value; ui.abierto = null; recargar(); };
  document.getElementById('f-empresa').onchange = (e) => { ui.empresa = e.target.value; ui.abierto = null; recargar(); };
  const dias = document.getElementById('f-dias');
  if (dias) dias.onchange = (e) => { ui.dias = Number(e.target.value); recargar(); };
  raiz.querySelectorAll('[data-abrir]').forEach((b) => { b.onclick = () => { ui.abierto = ui.abierto === b.dataset.abrir ? null : b.dataset.abrir; recargar(); }; });
  raiz.querySelectorAll('[data-diag]').forEach((b) => { b.onclick = () => diagnostico(b.dataset.empresa); });
  raiz.querySelectorAll('[data-texto]').forEach((ta) => { ta.oninput = () => { ui.respuestas[ta.dataset.texto] = ta.value; }; });
  raiz.querySelectorAll('[data-nota]').forEach((ta) => { ta.oninput = () => { ui.notas[ta.dataset.nota] = ta.value; }; });
  raiz.querySelectorAll('[data-estado-resp]').forEach((s) => { s.onchange = () => { ui.estadoResp[s.dataset.estadoResp] = s.value; }; });
  raiz.querySelectorAll('[data-enviar]').forEach((b) => { b.onclick = () => enviar(b.dataset.enviar); });
  raiz.querySelectorAll('[data-guardar-nota]').forEach((b) => { b.onclick = () => guardarNota(b.dataset.guardarNota); });
  raiz.querySelectorAll('[data-tomar]').forEach((b) => { b.onclick = () => gestionar(b.dataset.tomar, { asignacion: b.dataset.accion }); });
  raiz.querySelectorAll('[data-prioridad]').forEach((s) => { s.onchange = () => gestionar(s.dataset.prioridad, { prioridad: s.value }); });
  raiz.querySelectorAll('[data-estado]').forEach((s) => { s.onchange = () => gestionar(s.dataset.estado, { estado: s.value }); });
}

function tarjeta(t) {
  const color = COLOR_ESTADO[t.estado] || '#1a2c45';
  const abierto = ui.abierto === t.id;
  return `<article class="tarjeta ticket" style="border-left-color:${color}">
    <div class="cabeza"><strong>${EMOJI_TIPO[t.tipo] || ''} #${t.numero} · ${esc(t.titulo)}</strong><span class="etiqueta" style="color:${color}">${esc(ESTADOS_EQUIPO[t.estado] || t.estado)}</span></div>
    <p class="suave" style="margin:4px 0 0"><b>${esc(t.empresa_nombre)}</b> · ${esc(TIPOS[t.tipo] || t.tipo)} · ${esc(t.usuario_nombre || 'usuario')} · ${fecha(t.creado_en)}${t.pagina ? ` · desde ${esc(t.pagina)}` : ''}${t.acceso_hasta ? ` · <span class="etiqueta">acceso de ayuda hasta ${fecha(t.acceso_hasta)}</span>` : ''}</p>
    <p style="margin:8px 0 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="etiqueta" style="color:${COLOR_PRIORIDAD[t.prioridad]}">${esc(PRIORIDADES[t.prioridad] || t.prioridad)}</span>
      ${t.asignado_nombre ? `<span class="etiqueta">Atiende: ${esc(t.asignado_nombre)}</span>` : '<span class="etiqueta" style="color:#b26a00">Sin responsable</span>'}
      ${textoSla(t)}
      ${t.reabierto_n ? `<span class="etiqueta" style="color:#b26a00">Reabierto ${t.reabierto_n}×</span>` : ''}
      ${t.calificacion ? `<span class="etiqueta" style="color:#b26a00" title="${esc(t.calificacion_comentario || '')}">${estrellas(t.calificacion)} ${PUNTOS[t.calificacion]}</span>` : ''}
    </p>
    ${abierto ? '' : (t.descripcion ? `<p style="white-space:pre-wrap;margin:8px 0 0">${esc(t.descripcion.length > 220 ? `${t.descripcion.slice(0, 220)}…` : t.descripcion)}</p>` : '')}
    <div class="fila" style="margin:10px 0 0">
      <button type="button" data-abrir="${t.id}" aria-expanded="${abierto}">${abierto ? 'Ocultar conversación' : `Abrir conversación (${t.mensajes} ${t.mensajes === 1 ? 'mensaje' : 'mensajes'}${t.notas ? `, ${t.notas} ${t.notas === 1 ? 'nota' : 'notas'}` : ''})`}</button>
      <button type="button" data-tomar="${t.id}" data-accion="${t.soy_asignado ? 'nadie' : 'yo'}">${t.soy_asignado ? 'Soltar' : 'Tomar'}</button>
      <label style="flex:0 1 150px">Estado<select data-estado="${t.id}">${Object.entries(ESTADOS_EQUIPO).map(([v, n]) => `<option value="${v}" ${t.estado === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label style="flex:0 1 130px">Prioridad<select data-prioridad="${t.id}">${Object.entries(PRIORIDADES).map(([v, n]) => `<option value="${v}" ${t.prioridad === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    ${abierto && ui.detalle ? conversacion(t) : ''}
    ${ui.diag[t.empresa_id] ? `<pre class="diag">${esc(JSON.stringify(ui.diag[t.empresa_id], null, 2))}</pre>` : ''}
  </article>`;
}

// Hilo con quien escribió (público) y, aparte y con otro color, las notas internas. Dos botones distintos para no mezclarlas.
function conversacion(t) {
  const linea = construirLinea(t, ui.detalle, { conNotas: true }).map((i) => {
    if (i.clase === 'evento') {
      const texto = textoEvento(i.evento, 'equipo');
      return texto ? `<div class="evento">${esc(texto)} · ${fecha(i.cuando)}</div>` : '';
    }
    const etiqueta = i.clase === 'nota' ? 'Nota interna (solo soporte)' : (i.tipo === 'solicitante' ? 'Usuario' : i.tipo === 'empresa' ? 'Administrador de la empresa' : 'Soporte');
    return `<div class="${i.clase === 'nota' ? 'nota' : `msg ${i.tipo}`}"><div class="suave"><b>${esc(i.autor || etiqueta)}</b> · ${etiqueta} · ${fecha(i.cuando)}</div>${esc(i.texto)}</div>`;
  }).join('');
  const estadoResp = ui.estadoResp[t.id] || 'en_espera';
  return `<div class="hilo" aria-live="polite">${linea}</div>
    <div class="fila" style="margin:12px 0 0"><label>Respuesta para quien escribió (le llega por correo y a su campana)
      <textarea data-texto="${t.id}" maxlength="4000" placeholder="Escribe la respuesta…">${esc(ui.respuestas[t.id] || '')}</textarea></label></div>
    <div class="fila" style="margin:6px 0 0"><label style="flex:0 1 280px">Después de enviar, dejarlo en
      <select data-estado-resp="${t.id}">${Object.entries(ESTADOS_EQUIPO).map(([v, n]) => `<option value="${v}" ${estadoResp === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="principal" type="button" data-enviar="${t.id}">Enviar al cliente</button></div>
    <div class="fila" style="margin:14px 0 0"><label>Nota interna (NO la ve la empresa)
      <textarea class="campo-nota" data-nota="${t.id}" maxlength="4000" placeholder="Qué se revisó, qué falta…">${esc(ui.notas[t.id] || '')}</textarea></label></div>
    <div class="fila" style="margin:6px 0 0"><button type="button" data-guardar-nota="${t.id}">Guardar nota interna</button>
      <button type="button" data-diag="${t.id}" data-empresa="${t.empresa_id}" ${t.acceso_hasta ? '' : 'disabled title="La empresa no ha dado acceso de ayuda"'}>Ver diagnóstico de la empresa</button></div>`;
}

// Ejecuta una acción de la base y vuelve a pintar con el aviso de éxito o de error.
async function accion(promesa, exito, despues) {
  ui.error = ''; ui.mensaje = '';
  const r = await promesa;
  if (r.error) ui.error = r.error;
  else { ui.mensaje = exito; despues?.(r); }
  pintar();
}

function enviar(id) {
  const texto = (ui.respuestas[id] || '').trim();
  if (!texto) { ui.error = 'Escribe la respuesta antes de enviarla.'; ui.mensaje = ''; return pintar(); }
  return accion(api.responder(id, { texto, estado: ui.estadoResp[id] || 'en_espera' }), 'Respuesta enviada.', () => { delete ui.respuestas[id]; api.avisar(id, 'respondido'); });
}
function guardarNota(id) {
  const texto = (ui.notas[id] || '').trim();
  if (!texto) { ui.error = 'Escribe la nota antes de guardarla.'; ui.mensaje = ''; return pintar(); }
  return accion(api.agregarNota(id, texto), 'Nota guardada (solo la ve soporte).', () => { delete ui.notas[id]; });
}
const gestionar = (id, cambios) => accion(api.gestionar(id, { p_estado: cambios.estado ?? null, p_prioridad: cambios.prioridad ?? null, p_asignacion: cambios.asignacion ?? null }), 'Ticket actualizado.');
const diagnostico = (empresaId) => accion(api.diagnostico(empresaId), 'Diagnóstico cargado.', (r) => { ui.diag[empresaId] = r.data; });

// Un aviso de la campana lleva a la conversación de ese ticket, sin filtros que lo escondan.
function abrirDesdeAviso(aviso) {
  if (!aviso.ticket_id) return;
  Object.assign(ui, { abierto: aviso.ticket_id, filtro: 'todos', empresa: '', asignacion: '', mensaje: '', error: '' });
  pintar();
}

async function arrancar() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return vistaLogin();
  const { data: yo, error } = await supabase.rpc('agenda_soporte_yo');
  if (error || !yo?.es_soporte) return vistaSinAcceso();
  ui.nombre = yo.nombre;
  quien.textContent = yo.nombre ? `· ${yo.nombre}` : '';
  botonSalir.hidden = false;
  if (!campana) campana = montarCampana({ contenedor: document.getElementById('campana'), api, onAbrir: abrirDesdeAviso });
  await pintar();
}

if (!hayConfiguracionSupabase()) {
  raiz.innerHTML = '<p class="error">Falta la configuración de Supabase.</p>';
} else {
  botonSalir.onclick = async () => { await supabase.auth.signOut(); vistaLogin(); };
  arrancar();
}
