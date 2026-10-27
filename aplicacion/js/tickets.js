// Pestaña «Soporte» de cada empresa: el usuario reporta un error, propone una mejora o hace una pregunta (ticket) y conversa con soporte.
// Cada quien ve los suyos; el administrador ve todos los de su empresa y sus métricas. La base decide quién ve qué (RLS y funciones
// de sql/022–025); aquí solo se pinta. Vocabulario, formato, línea de tiempo y llamadas a la base están en ./soporte-comun/.
import { crearApiSoporte } from './soporte-comun/api.js';
import { COLOR_ESTADO, COLOR_PRIORIDAD, EMOJI_TIPO, ESTADOS_FINALES, ESTADOS_USUARIO, PRIORIDADES, PUNTOS, SLA_HORAS, TIPOS, sePuedeCalificar } from './soporte-comun/constantes.js';
import { duracionMin, escapar as esc, estrellas, fechaCorta, fechaHora, minutosParaSla } from './soporte-comun/formato.js';
import { construirLinea, textoEvento } from './soporte-comun/linea-tiempo.js';
import { EVENTO_AVISOS } from './soporte-comun/campana.js';

const ESTADOS_ADMIN = { en_espera: 'Esperando respuesta de quien escribió', en_revision: 'En revisión', resuelto: 'Resuelto', cerrado: 'Cerrado', descartado: 'Descartado' };

const nuevoBorrador = () => ({ tipo: 'error', titulo: '', descripcion: '' });
const estadoInicial = () => ({
  filtro: 'abiertos', mensaje: '', error: '', enviando: false, borrador: nuevoBorrador(), abierto: null, detalle: null, uid: null,
  respuestas: {}, estadoAdmin: {}, puntos: {}, comentario: {}, reabriendo: {},
});
const ui = estadoInicial();

export function reiniciarTickets() {
  Object.assign(ui, estadoInicial());
}

// Desde la campana: deja abierta la conversación de ese ticket al pintar la pestaña.
export function abrirTicket(id) {
  ui.abierto = id;
  ui.filtro = 'todos';
  ui.mensaje = '';
  ui.error = '';
}

const avisosCambiaron = () => window.dispatchEvent(new Event(EVENTO_AVISOS));

export async function renderTickets(ctx) {
  const { el, supabase, empresaId, rol } = ctx;
  const api = crearApiSoporte(supabase);
  const esAdmin = rol === 'administrador';
  const repintar = () => renderTickets(ctx);
  el.innerHTML = '<p class="v-muted">Cargando soporte…</p>';
  if (!ui.uid) ui.uid = (await supabase.auth.getUser()).data?.user?.id || null;

  let q = supabase.from('agenda_tickets').select('*').eq('empresa_id', empresaId).order('creado_en', { ascending: false }).limit(200);
  // «En curso» incluye los resueltos que aún no se han calificado: así la invitación a calificar no desaparece de la lista.
  if (ui.filtro === 'abiertos') q = q.or('estado.in.(abierto,en_revision,en_espera),and(estado.eq.resuelto,calificacion.is.null)');
  else if (ui.filtro !== 'todos') q = q.eq('estado', ui.filtro);
  const { data, error } = await q;
  const tickets = data || [];
  // Acceso de ayuda y métricas: solo el administrador (si la base aún no los tiene, no se muestran).
  const [acceso, metricas] = esAdmin
    ? await Promise.all([api.accesoEstado(empresaId).then((r) => r.data), api.metricas(empresaId, 30).then((r) => r.data)])
    : [null, null];
  // La conversación del ticket abierto se pide aparte: trae mensajes y eventos que la lista no incluye.
  ui.detalle = null;
  const abierto = tickets.find((x) => x.id === ui.abierto);
  if (abierto) {
    const r = await api.detalle(abierto.id, abierto.usuario_id === ui.uid ? 'solicitante' : null);
    if (r.error) ui.error = r.error; else ui.detalle = r.data;
    api.marcarAvisos({ ticketId: abierto.id }).then(avisosCambiaron);
  }

  const b = ui.borrador;
  el.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Ayuda</div><h2>Soporte</h2></div></div>
    <p class="v-note">¿Algo no funciona, tienes una idea o una duda? Cuéntanoslo aquí y conversa con soporte dentro del mismo ticket. ${esAdmin ? 'Como administrador ves los tickets de todo el equipo y puedes responderlos.' : 'Solo tú y el administrador ven tus tickets. Los avisos te llegan a la campana y por correo.'}</p>
    ${metricas ? bloqueMetricas(metricas) : ''}
    <form id="tk-form" class="v-form" style="margin-top:14px;display:flex;flex-direction:column;gap:12px;max-width:640px">
      <label class="v-field">¿Qué necesitas?
        <select id="tk-tipo" class="v-input">${Object.entries(TIPOS).map(([v, t]) => `<option value="${v}" ${b.tipo === v ? 'selected' : ''}>${EMOJI_TIPO[v]} ${t}</option>`).join('')}</select></label>
      <label class="v-field">Título (qué pasa, en pocas palabras)
        <input id="tk-titulo" class="v-input" maxlength="140" required placeholder="Ej: No me deja mover una cita" value="${esc(b.titulo)}"></label>
      <label class="v-field">Detalles (qué hacías, qué esperabas, qué pasó)
        <textarea id="tk-desc" class="v-input" rows="5" maxlength="4000" placeholder="Si es posible, indica el número de inmueble o la fecha de la cita. No escribas contraseñas ni datos bancarios.">${esc(b.descripcion)}</textarea></label>
      ${ui.error ? `<div class="v-error" role="alert">${esc(ui.error)}</div>` : ''}
      ${ui.mensaje ? `<p class="v-note" role="status">${esc(ui.mensaje)}</p>` : ''}
      <div><button type="submit" class="v-btn v-primary" ${ui.enviando ? 'disabled' : ''}>${ui.enviando ? 'Enviando…' : 'Enviar ticket'}</button>
        <span class="v-muted" style="margin-left:8px;font-size:13px">Respondemos en un máximo de ${SLA_HORAS.normal} horas.</span></div>
    </form>
    ${acceso ? bloqueAcceso(acceso) : ''}
    <h3 style="margin:26px 0 8px">${esAdmin ? 'Tickets del equipo' : 'Mis tickets'}</h3>
    <label class="v-field" style="max-width:240px">Ver<select id="tk-filtro" class="v-input">
      <option value="abiertos" ${ui.filtro === 'abiertos' ? 'selected' : ''}>En curso</option>
      ${Object.entries(ESTADOS_USUARIO).map(([v, t]) => `<option value="${v}" ${ui.filtro === v ? 'selected' : ''}>${t}</option>`).join('')}
      <option value="todos" ${ui.filtro === 'todos' ? 'selected' : ''}>Todos</option></select></label>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${esc(error.message)}</div>` : ''}
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">${tickets.length ? tickets.map((t) => tarjeta(t, esAdmin)).join('') : '<p class="v-muted">No hay tickets con este filtro.</p>'}</div>`;

  // ---- formulario de ticket nuevo
  el.querySelector('#tk-tipo').onchange = (e) => { ui.borrador.tipo = e.target.value; };
  el.querySelector('#tk-titulo').oninput = (e) => { ui.borrador.titulo = e.target.value; };
  el.querySelector('#tk-desc').oninput = (e) => { ui.borrador.descripcion = e.target.value; };
  el.querySelector('#tk-filtro').onchange = (e) => { ui.filtro = e.target.value; ui.abierto = null; repintar(); };
  el.querySelector('#tk-form').onsubmit = async (e) => {
    e.preventDefault();
    ui.enviando = true; ui.error = ''; ui.mensaje = '';
    repintar();
    const r = await api.crear(empresaId, ui.borrador, ctx.vistaAnterior);
    ui.enviando = false;
    if (r.error) ui.error = r.error;
    else {
      ui.mensaje = `Listo: recibimos tu ticket #${r.data.numero}. Te respondemos en un máximo de ${SLA_HORAS.normal} horas y te avisamos por la campana y por correo.`;
      ui.borrador = nuevoBorrador();
      api.avisar(r.data.id, 'creado');
    }
    repintar();
  };

  // ---- acceso de ayuda (administrador)
  el.querySelectorAll('[data-acceso-horas]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const r = await api.accesoOtorgar(empresaId, Number(btn.dataset.accesoHoras));
      ui.error = r.error || '';
      ui.mensaje = r.error ? '' : 'Listo: el equipo de soporte puede revisar un diagnóstico de solo lectura de tu empresa durante ese tiempo.';
      repintar();
    };
  });
  const revocar = el.querySelector('[data-acceso-revocar]');
  if (revocar) {
    revocar.onclick = async () => {
      revocar.disabled = true;
      const r = await api.accesoRevocar(empresaId);
      ui.error = r.error || '';
      ui.mensaje = r.error ? '' : 'Quitamos el acceso de ayuda.';
      repintar();
    };
  }

  // ---- conversación: abrir, escribir, resolver, reabrir, calificar
  el.querySelectorAll('[data-tk-abrir]').forEach((btn) => {
    btn.onclick = () => { ui.abierto = ui.abierto === btn.dataset.tkAbrir ? null : btn.dataset.tkAbrir; ui.error = ''; ui.mensaje = ''; repintar(); };
  });
  // «Ver» siempre abre (no alterna): lo usan los avisos de la tarjeta («necesito más ayuda», «calificar»).
  el.querySelectorAll('[data-tk-ver]').forEach((btn) => { btn.onclick = () => { ui.abierto = btn.dataset.tkVer; ui.error = ''; ui.mensaje = ''; repintar(); }; });
  // Borradores: lo que escribe cada quien no se pierde si la pantalla se vuelve a pintar.
  el.querySelectorAll('[data-tk-texto]').forEach((ta) => { ta.oninput = () => { ui.respuestas[ta.dataset.tkTexto] = ta.value; }; });
  el.querySelectorAll('[data-tk-estado-admin]').forEach((s) => { s.onchange = () => { ui.estadoAdmin[s.dataset.tkEstadoAdmin] = s.value; }; });
  el.querySelectorAll('[data-tk-reabrir]').forEach((btn) => { btn.onclick = () => { ui.reabriendo[btn.dataset.tkReabrir] = true; ui.abierto = btn.dataset.tkReabrir; repintar(); }; });
  el.querySelectorAll('[data-tk-enviar]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.tkEnviar;
      const t = tickets.find((x) => x.id === id);
      const propio = t.usuario_id === ui.uid;
      const texto = (ui.respuestas[id] || '').trim();
      const resolver = btn.dataset.estado === 'resuelto';
      if (!texto && !resolver) { ui.error = 'Escribe tu mensaje antes de enviarlo.'; ui.mensaje = ''; return repintar(); }
      btn.disabled = true;
      const r = await api.responder(id, { texto: texto || null, estado: resolver ? 'resuelto' : (propio ? null : ui.estadoAdmin[id] || 'en_espera'), como: propio ? 'solicitante' : null });
      if (r.error) { ui.error = r.error; ui.mensaje = ''; } else {
        ui.error = '';
        delete ui.respuestas[id]; delete ui.reabriendo[id];
        if (resolver) { ui.abierto = id; ui.mensaje = '¡Gracias! Marcamos tu ticket como resuelto. Cuéntanos cómo fue la atención con las estrellas de abajo.'; }
        else ui.mensaje = propio ? 'Mensaje enviado. Soporte recibió el aviso.' : 'Respuesta enviada.';
        if (texto) api.avisar(id, propio ? 'respuesta_cliente' : 'respondido');
      }
      repintar();
    };
  });
  el.querySelectorAll('[data-tk-puntos]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.tkId;
      ui.puntos[id] = Number(btn.dataset.tkPuntos);
      el.querySelectorAll(`[data-tk-id="${id}"][data-tk-puntos]`).forEach((o) => {
        o.setAttribute('aria-checked', String(Number(o.dataset.tkPuntos) === ui.puntos[id]));
        o.style.color = Number(o.dataset.tkPuntos) <= ui.puntos[id] ? '#F59E0B' : '#9AA5B1';
      });
      const rotulo = el.querySelector(`[data-tk-rotulo="${id}"]`);
      if (rotulo) rotulo.textContent = PUNTOS[ui.puntos[id]];
    };
  });
  el.querySelectorAll('[data-tk-comentario]').forEach((ta) => { ta.oninput = () => { ui.comentario[ta.dataset.tkComentario] = ta.value; }; });
  el.querySelectorAll('[data-tk-calificar]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.tkCalificar;
      const t = tickets.find((x) => x.id === id);
      if (!(ui.puntos[id] ?? t.calificacion)) { ui.error = 'Elige de 1 a 5 estrellas.'; ui.mensaje = ''; return repintar(); }
      btn.disabled = true;
      const r = await api.calificar(id, ui.puntos[id] ?? t.calificacion, ui.comentario[id] ?? t.calificacion_comentario ?? '');
      ui.error = r.error || '';
      ui.mensaje = r.error ? '' : 'Gracias por calificar la atención: nos ayuda a mejorar.';
      repintar();
    };
  });
}

// ---------------------------------------------------------------- piezas de pantalla
function bloqueMetricas(m) {
  const csat = m.csat || {};
  const celda = (valor, texto) => `<div style="flex:1 1 130px;border:1px solid var(--v-line);border-radius:12px;padding:10px 12px"><div style="font-size:21px;font-weight:700">${valor}</div><div class="v-muted" style="font-size:12.5px">${texto}</div></div>`;
  return `<section aria-label="Resumen de soporte" style="margin-top:14px;max-width:760px">
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${celda(m.pendientes, 'Por atender')}
      ${celda(m.en_espera, 'Esperando respuesta del usuario')}
      ${celda(duracionMin(m.primera_respuesta_min?.mediana), 'Primera respuesta (mediana)')}
      ${celda(m.resolucion_horas?.mediana != null ? `${m.resolucion_horas.mediana} h` : '—', 'Tiempo de resolución (mediana)')}
      ${celda(csat.n ? `${csat.promedio} / 5` : '—', csat.n ? `Calificación (${csat.n} ${csat.n === 1 ? 'respuesta' : 'respuestas'})` : 'Calificación (sin respuestas aún)')}
    </div>
    <p class="v-muted" style="margin:6px 0 0;font-size:12.5px">Últimos ${m.dias} días: ${m.creados} tickets creados, ${m.resueltos} resueltos.${m.vencidos ? ` ${m.vencidos} sin primera respuesta a tiempo.` : ''}</p>
  </section>`;
}

const ACCIONES_AUDITORIA = { acceso_otorgado: 'Se dio acceso de ayuda', acceso_revocado: 'Se quitó el acceso de ayuda', diagnostico_consultado: 'Soporte consultó el diagnóstico', ticket_respondido: 'Soporte respondió un ticket' };

/* Acceso de ayuda: el administrador deja que el soporte de la plataforma vea, por un tiempo limitado, un diagnóstico de SOLO LECTURA
   (configuración sin contraseñas, conteos, últimos correos y errores). No puede entrar como un usuario ni cambiar nada. */
function bloqueAcceso(acceso) {
  const hasta = acceso.acceso_hasta ? fechaHora(acceso.acceso_hasta) : null;
  const aud = (acceso.auditoria || []).slice(0, 8).map((a) => `<li>${esc(fechaHora(a.creado_en))} · ${esc(ACCIONES_AUDITORIA[a.accion] || a.accion)} · <span class="v-muted">${esc(a.actor || '')}</span></li>`).join('');
  return `<section style="margin-top:26px;padding:14px 16px;border:1px solid var(--v-line);border-radius:12px;max-width:640px">
    <h3 style="margin:0 0 6px">Acceso de ayuda para soporte</h3>
    <p class="v-muted" style="margin:0 0 10px;font-size:13.5px">Si necesitas que el equipo de soporte de la plataforma revise tu cuenta, dale acceso por un tiempo limitado. Solo verá un <strong>diagnóstico de lectura</strong> (configuración sin contraseñas, conteos, últimos correos y errores): no puede entrar como ningún usuario ni cambiar tus datos. Todo lo que haga queda registrado aquí.</p>
    ${hasta ? `<p style="margin:0 0 10px"><strong>✓ Acceso activo hasta ${esc(hasta)}</strong></p><button type="button" class="v-btn v-quiet" data-acceso-revocar>Quitar el acceso ahora</button>`
      : `<p style="margin:0 0 10px"><strong>✕ Sin acceso de ayuda</strong></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="v-btn v-primary" data-acceso-horas="24">Dar acceso 24 horas</button><button type="button" class="v-btn v-quiet" data-acceso-horas="72">3 días</button><button type="button" class="v-btn v-quiet" data-acceso-horas="168">7 días</button></div>`}
    ${aud ? `<p class="v-muted" style="margin:12px 0 4px;font-size:13px">Registro reciente:</p><ul style="margin:0;padding-left:18px;font-size:13px">${aud}</ul>` : ''}
  </section>`;
}

const insignia = (texto, col = '#1A2C45') => `<span style="font-size:12px;font-weight:600;color:${col};border:1px solid ${col}33;background:${col}12;border-radius:999px;padding:1px 9px">${esc(texto)}</span>`;

// Lo que el usuario debe hacer a continuación, dicho de frente en la tarjeta (sin tener que abrir la conversación).
function siguientePaso(t) {
  if (t.estado === 'en_espera') {
    return `<div class="v-note" style="margin:10px 0 0"><strong>Soporte te respondió.</strong> ¿Quedó resuelto tu caso?
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="v-btn v-primary" data-tk-enviar="${t.id}" data-estado="resuelto">Sí, quedó resuelto</button>
      <button type="button" class="v-btn v-quiet" data-tk-ver="${t.id}">No, necesito más ayuda</button></div></div>`;
  }
  if (['resuelto', 'cerrado'].includes(t.estado) && !t.calificacion) {
    return `<div class="v-note" style="margin:10px 0 0"><strong>Tu ticket quedó resuelto.</strong> Cuéntanos cómo fue la atención.
      <div style="margin-top:8px"><button type="button" class="v-btn v-primary" data-tk-ver="${t.id}">Calificar la atención</button></div></div>`;
  }
  return '';
}

function tarjeta(t, esAdmin) {
  const color = COLOR_ESTADO[t.estado] || '#1A2C45';
  const abierto = ui.abierto === t.id;
  const propio = t.usuario_id === ui.uid;
  const minSla = minutosParaSla(t);
  return `<article style="border:1px solid var(--v-line);border-left:4px solid ${color};border-radius:12px;padding:12px 14px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
      <strong>${EMOJI_TIPO[t.tipo] || ''} #${t.numero} · ${esc(t.titulo)}</strong>
      <span style="font-size:12.5px;font-weight:600;color:${color}">${esc(ESTADOS_USUARIO[t.estado] || t.estado)}</span>
    </div>
    <p class="v-muted" style="margin:4px 0 0;font-size:12.5px">${esc(TIPOS[t.tipo] || t.tipo)} · ${fechaCorta(t.creado_en)}${esAdmin ? ` · ${esc(t.usuario_nombre || 'usuario')}` : ''}${t.pagina ? ` · desde ${esc(t.pagina)}` : ''}</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${t.prioridad && t.prioridad !== 'normal' ? insignia(`Prioridad ${PRIORIDADES[t.prioridad].toLowerCase()}`, COLOR_PRIORIDAD[t.prioridad]) : ''}
      ${t.asignado_nombre ? insignia(`Atiende: ${t.asignado_nombre}`) : ''}
      ${t.reabierto_n ? insignia(`Reabierto ${t.reabierto_n} ${t.reabierto_n === 1 ? 'vez' : 'veces'}`, '#B26A00') : ''}
      ${esAdmin && minSla != null && minSla < 0 ? insignia('Respuesta vencida', '#B3261E') : ''}
      ${t.calificacion ? insignia(`${estrellas(t.calificacion)} ${PUNTOS[t.calificacion]}`, '#B26A00') : ''}
    </div>
    ${propio ? siguientePaso(t) : ''}
    <div style="margin-top:10px"><button type="button" class="v-btn v-quiet" data-tk-abrir="${t.id}" aria-expanded="${abierto}">${abierto ? 'Ocultar conversación' : 'Ver conversación'}</button></div>
    ${abierto && ui.detalle ? conversacion(t, esAdmin, propio) : ''}
  </article>`;
}

function burbuja(i) {
  const equipo = i.tipo !== 'solicitante';
  // Sin saltos de línea entre las etiquetas: la burbuja usa pre-wrap y se verían como líneas en blanco.
  const cabeza = `<div class="v-muted" style="font-size:12px;margin-bottom:2px"><b>${esc(i.autor || (equipo ? 'Soporte' : 'Usuario'))}</b>${equipo ? ' · soporte' : ''} · ${esc(fechaHora(i.cuando))}</div>`;
  return `<div style="align-self:${equipo ? 'flex-start' : 'flex-end'};max-width:88%;padding:10px 12px;border-radius:12px;background:${equipo ? '#EEF3F7' : '#F4F4F4'};white-space:pre-wrap;word-break:break-word">${cabeza}${esc(i.texto)}</div>`;
}

// Hilo: la descripción original, los mensajes y los cambios del ticket, en orden. Debajo, responder, reabrir o calificar.
function conversacion(t, esAdmin, propio) {
  const linea = construirLinea(t, ui.detalle).map((i) => {
    if (i.clase === 'mensaje') return burbuja(i);
    const texto = textoEvento(i.evento, 'usuario');
    return texto ? `<div class="v-muted" style="align-self:center;font-size:12px;text-align:center">${esc(texto)} · ${esc(fechaHora(i.cuando))}</div>` : '';
  }).join('');
  const final = ESTADOS_FINALES.includes(t.estado);
  const resuelto = t.estado === 'resuelto';
  // Un ticket resuelto no invita a seguir escribiendo: primero se califica; escribir exige reabrirlo a propósito.
  const mostrarCompositor = !final && (esAdmin || propio) && !(resuelto && propio && !ui.reabriendo[t.id]);
  const estadoAdmin = ui.estadoAdmin[t.id] || 'en_espera';
  const compositor = mostrarCompositor ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
      <label class="v-field">${propio ? (resuelto ? 'Cuéntanos qué sigue pasando (reabre el ticket)' : 'Tu mensaje') : 'Tu respuesta (le llega por correo y a la campana de quien escribió el ticket)'}
        <textarea class="v-input" rows="3" maxlength="4000" data-tk-texto="${t.id}" placeholder="${propio ? 'Cuéntanos más o confirma si ya quedó resuelto.' : 'Escribe la respuesta…'}">${esc(ui.respuestas[t.id] || '')}</textarea></label>
      ${propio ? '' : `<label class="v-field" style="max-width:340px">Después de enviar, dejar el ticket en
        <select class="v-input" data-tk-estado-admin="${t.id}">${Object.entries(ESTADOS_ADMIN).map(([v, n]) => `<option value="${v}" ${estadoAdmin === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="v-btn v-primary" data-tk-enviar="${t.id}">${propio ? (resuelto ? 'Reabrir y enviar' : 'Enviar mensaje') : 'Enviar respuesta'}</button>
        ${propio && !resuelto ? `<button type="button" class="v-btn v-quiet" data-tk-enviar="${t.id}" data-estado="resuelto">Ya quedó resuelto</button>` : ''}
      </div></div>` : '';
  const pie = final
    ? '<p class="v-muted" style="margin:14px 0 0;font-size:13px">Este ticket está cerrado. Si el problema continúa, crea uno nuevo desde el formulario de arriba.</p>'
    : (resuelto && propio && !ui.reabriendo[t.id] ? `<div style="margin-top:12px"><button type="button" class="v-btn v-quiet" data-tk-reabrir="${t.id}">El problema continúa: reabrir el ticket</button></div>` : '');
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--v-line)">
    <div style="display:flex;flex-direction:column;gap:8px" aria-live="polite">${linea}</div>
    ${propio && sePuedeCalificar(t) ? calificacion(t) : ''}
    ${compositor}${pie}
  </div>`;
}

// Calificación 1 a 5 de la atención recibida (solo quien escribió el ticket; se puede cambiar por unos días).
function calificacion(t) {
  const actual = ui.puntos[t.id] ?? t.calificacion ?? 0;
  const botones = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${actual === n}" aria-label="${n} de 5: ${PUNTOS[n]}" data-tk-id="${t.id}" data-tk-puntos="${n}" title="${PUNTOS[n]}"
      style="background:none;border:0;cursor:pointer;font-size:28px;line-height:1;padding:2px 4px;min-width:44px;min-height:44px;color:${n <= actual ? '#F59E0B' : '#9AA5B1'}">★</button>`).join('');
  return `<div style="margin-top:16px;padding:12px 14px;border:1px solid var(--v-line);border-radius:12px;background:#FFFBF0">
    <strong>${t.calificacion ? 'Tu calificación (puedes cambiarla)' : '¿Cómo fue la atención de soporte?'}</strong>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><div role="radiogroup" aria-label="Calificación de la atención" style="display:flex;gap:2px;margin:4px 0">${botones}</div>
      <span class="v-muted" data-tk-rotulo="${t.id}" style="font-size:13px">${actual ? PUNTOS[actual] : 'Toca una estrella'}</span></div>
    <label class="v-field">Comentario (opcional)
      <textarea class="v-input" rows="2" maxlength="1000" data-tk-comentario="${t.id}">${esc(ui.comentario[t.id] ?? t.calificacion_comentario ?? '')}</textarea></label>
    <div style="margin-top:8px"><button type="button" class="v-btn v-primary" data-tk-calificar="${t.id}">${t.calificacion ? 'Actualizar calificación' : 'Enviar calificación'}</button></div>
  </div>`;
}
