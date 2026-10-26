// Pestaña "Pendientes": tareas con dueño y fecha límite + carga de los Excel de los portales.
// Quién ve qué lo decide la base de datos (RLS, sql/008); aquí solo se pinta lo que llega.
// Los pendientes que salen de los portales NO se cierran a mano: los cierra el sistema cuando el
// siguiente Excel ya no muestra el problema.
import { leerExcelPortal, compararPortal, disponiblesSinCodigo, PORTALES } from './portales-logica.js';

const TIPOS = {
  publicar: 'Publicar', despublicar: 'Despublicar', revisar_codigo: 'Publicación sin código en Sedi', revisar_precio: 'Precio distinto',
  asamblea: 'Asamblea', terminacion: 'Terminación', entrega: 'Entrega', respuesta: 'Responder', otro: 'Otro',
};
const ESTADOS = { abierto: 'Abierto', en_proceso: 'En proceso', cerrado: 'Resuelto', descartado: 'Descartado' };
// Cada cuántos días hay que volver a cargar los Excel antes de avisar que están viejos.
const DIAS_MAX_SIN_CARGA = 8;

const ui = { sub: 'lista', estado: 'abiertos', tipo: 'all', texto: '', cargas: {}, analisis: {}, inmuebles: null, mensaje: '' };

const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const diasEntre = (isoA, isoB) => Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
const dinero = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const nombrePortal = (p) => PORTALES[p]?.nombre || p || '';

/* Lo que se sube en Portales se recuerda en este navegador (por empresa): así no se pierde al cambiar de
   pestaña, recargar la página o volver a entrar. Los pendientes en sí viven en la base de datos. */
const llaveLocal = (ctx) => `pendientes_portales_${ctx.empresaId}`;
function guardarLocal(ctx) {
  try { localStorage.setItem(llaveLocal(ctx), JSON.stringify(ui.analisis)); } catch { /* sin almacenamiento: no pasa nada */ }
}
function leerLocal(ctx) {
  if (Object.keys(ui.analisis).length) return;
  try {
    const t = localStorage.getItem(llaveLocal(ctx));
    if (t) ui.analisis = JSON.parse(t) || {};
  } catch { ui.analisis = {}; }
}

export function reiniciarPendientes() {
  Object.assign(ui, { sub: 'lista', estado: 'abiertos', tipo: 'all', texto: '', cargas: {}, analisis: {}, inmuebles: null, mensaje: '' });
}

export async function renderPendientes(ctx) {
  const { el, rol } = ctx;
  const gestiona = rol === 'administrador' || rol === 'coordinador';
  if (!gestiona) ui.sub = 'lista';
  leerLocal(ctx);
  el.innerHTML = '<p class="v-muted">Cargando pendientes…</p>';
  if (ui.sub === 'lista') await pintarLista(ctx, gestiona);
  else await pintarPortales(ctx);
}

function cabecera(ctx, gestiona) {
  const { icon } = ctx;
  return `<div class="v-top"><div><div class="v-eyebrow">Seguimiento</div><h2>Pendientes</h2></div></div>
    ${gestiona ? `<div style="margin-top:6px;display:inline-flex;border:1px solid var(--v-line);border-radius:10px;overflow:hidden">
      <button type="button" class="v-btn ${ui.sub === 'lista' ? 'v-primary' : 'v-quiet'}" style="border-radius:0" data-pend-sub="lista">${icon('list-checks')}Lista</button>
      <button type="button" class="v-btn ${ui.sub === 'portales' ? 'v-primary' : 'v-quiet'}" style="border-radius:0" data-pend-sub="portales">${icon('upload')}Portales</button>
    </div>` : ''}`;
}

function enlazarSub(ctx) {
  ctx.el.querySelectorAll('[data-pend-sub]').forEach((b) => {
    b.onclick = () => { ui.sub = b.dataset.pendSub; ui.mensaje = ''; renderPendientes(ctx).then(ctx.refreshIcons); };
  });
}

/* Junta lo que es el mismo problema en varios portales (p. ej. "Publicar 391" en los tres). */
function agrupar(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const k = f.numero_inmueble != null ? `${f.tipo}:${f.numero_inmueble}` : `solo:${f.id || f.clave}`;
    if (!mapa.has(k)) mapa.set(k, { k, tipo: f.tipo, numero: f.numero_inmueble, filas: [] });
    mapa.get(k).filas.push(f);
  }
  return [...mapa.values()];
}

/* Texto de lo que pasa en cada portal del grupo, en lenguaje corriente. */
function lineasGrupo(g, escape) {
  const f0 = g.filas[0];
  const d0 = f0.datos || {};
  const dir = d0.direccion ? ` · ${escape(d0.direccion)}` : '';
  if (g.tipo === 'publicar') return `<p style="margin:6px 0 0;font-size:13.5px">En Sedi está <strong>${escape(d0.estado_crm || '')}</strong> y tiene código de portal, pero no aparece activo en el portal.${dir}</p>`;
  if (g.tipo === 'despublicar') return `<p style="margin:6px 0 0;font-size:13.5px">En Sedi está <strong>${escape(d0.estado_crm || 'sin estado')}</strong> pero sigue publicado.${dir}</p>`;
  if (g.tipo === 'revisar_precio') {
    return `<p style="margin:6px 0 0;font-size:13.5px">Sedi: <strong>${dinero(d0.precio_sedi)}</strong> · ${g.filas.map((f) => `${escape(nombrePortal(f.portal))}: <strong>${dinero((f.datos || {}).precio_portal)}</strong>`).join(' · ')}${dir}</p>`;
  }
  if (g.tipo === 'revisar_codigo') return `<p style="margin:6px 0 0;font-size:13.5px">Código <strong>${escape(d0.codigo || '')}</strong> activo en ${escape(nombrePortal(f0.portal))}; ningún inmueble de Sedi lo tiene. O se baja del portal o falta registrar el código en Sedi.${d0.referencia ? `<br><span class="v-muted">${escape(d0.referencia)}</span>` : ''}</p>`;
  return `<p style="margin:6px 0 0;font-size:13.5px">${escape(f0.detalle)}</p>`;
}

/* ---------------------------------- Lista ---------------------------------- */

async function pintarLista(ctx, gestiona) {
  const { el, supabase, empresaId, escape, icon, refreshIcons } = ctx;
  let q = supabase.from('agenda_pendientes').select('*').eq('empresa_id', empresaId)
    .order('fecha_limite', { ascending: true, nullsFirst: false }).order('creado_en', { ascending: false }).limit(500);
  if (ui.estado === 'abiertos') q = q.in('estado', ['abierto', 'en_proceso']);
  else if (ui.estado !== 'todos') q = q.eq('estado', ui.estado);
  if (ui.tipo !== 'all') q = q.eq('tipo', ui.tipo);
  const { data, error } = await q;
  const hoy = hoyBogota();
  const texto = ui.texto.trim().toLowerCase();
  const filas = (data || []).filter((f) => !texto || `${f.titulo} ${f.detalle} ${f.responsable_nombre} ${f.numero_inmueble ?? ''}`.toLowerCase().includes(texto));
  const grupos = agrupar(filas);
  if (gestiona) await cargarCargas(ctx);
  const vencidos = grupos.filter((g) => g.filas.some((f) => ['abierto', 'en_proceso'].includes(f.estado) && f.fecha_limite && f.fecha_limite < hoy)).length;

  el.innerHTML = `${cabecera(ctx, gestiona)}
    ${resumenLista(ctx, filas, gestiona)}
    <p class="v-note">Cada pendiente tiene un responsable y una fecha límite. Los de portales no se cierran a mano: el sistema los compara solo cada madrugada con Sedi y con el último Excel de cada portal, y los marca como resueltos cuando el problema ya no existe.${gestiona ? '' : ' Solo ves los que son tuyos.'}</p>
    <div class="v-filters" style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label class="v-field">Estado<select id="pend-estado" class="v-input">
        <option value="abiertos" ${ui.estado === 'abiertos' ? 'selected' : ''}>Pendientes</option>
        ${Object.entries(ESTADOS).map(([v, t]) => `<option value="${v}" ${ui.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
        <option value="todos" ${ui.estado === 'todos' ? 'selected' : ''}>Todos</option></select></label>
      <label class="v-field">Tipo<select id="pend-tipo" class="v-input"><option value="all">Todos</option>
        ${Object.entries(TIPOS).map(([v, t]) => `<option value="${v}" ${ui.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="v-field">Buscar<input id="pend-texto" class="v-input" placeholder="# inmueble, asesor, texto…" value="${escape(ui.texto)}"></label>
    </div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(error.message)}</div>` : ''}
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${vencidos ? `<p style="margin-top:12px;color:#B3261E;font-weight:600">${vencidos} vencido(s)</p>` : ''}
    ${grupos.length === 0
      ? `<div class="v-empty" style="margin-top:16px">${icon('list-checks')}<h3>Sin pendientes</h3><p style="margin-top:8px">No hay pendientes con estos filtros.</p></div>`
      : seccionesPorTipo(ctx, grupos, hoy, gestiona)}`;

  enlazarSub(ctx);
  el.querySelector('#pend-estado').onchange = (e) => { ui.estado = e.target.value; renderPendientes(ctx).then(refreshIcons); };
  el.querySelector('#pend-tipo').onchange = (e) => { ui.tipo = e.target.value; renderPendientes(ctx).then(refreshIcons); };
  let deb;
  el.querySelector('#pend-texto').oninput = (e) => {
    const v = e.target.value; clearTimeout(deb);
    deb = setTimeout(() => { ui.texto = v; renderPendientes(ctx).then(refreshIcons); }, 700);
  };
  el.querySelectorAll('[data-pend-accion]').forEach((b) => {
    b.onclick = () => accionPendiente(ctx, b.dataset.ids.split(','), b.dataset.pendAccion);
  });
}

/* Resumen de una mirada: cuántos inmuebles hay por corregir y de qué tipo, y qué tan frescos están los Excel. */
const ORDEN_TIPOS = ['despublicar', 'publicar', 'revisar_precio', 'revisar_codigo', 'respuesta', 'terminacion', 'entrega', 'asamblea', 'otro'];
const COLOR_TIPO = { despublicar: '#B3261E', publicar: '#B26A00', revisar_precio: '#1A2C45', revisar_codigo: '#6B7785' };

function resumenLista(ctx, filas, gestiona) {
  const { escape } = ctx;
  const abiertas = filas.filter((f) => ['abierto', 'en_proceso'].includes(f.estado));
  if (!abiertas.length) return '';
  const grupos = agrupar(abiertas);
  const conteo = {};
  for (const g of grupos) conteo[g.tipo] = (conteo[g.tipo] || 0) + 1;
  const inmuebles = new Set(abiertas.map((f) => f.numero_inmueble).filter((n) => n != null)).size;
  const chips = ORDEN_TIPOS.filter((t) => conteo[t]).map((t) =>
    `<span style="display:inline-block;margin:0 8px 6px 0;padding:3px 10px;border-radius:999px;border:1px solid var(--v-line);font-size:13px;border-left:4px solid ${COLOR_TIPO[t] || '#1A2C45'}"><strong>${conteo[t]}</strong> ${escape(TIPOS[t] || t)}</span>`).join('');
  const hoy = hoyBogota();
  const frescura = gestiona ? Object.entries(PORTALES).map(([k, p]) => {
    const c = ui.cargas[k];
    if (!c) return `${p.nombre}: sin cargar`;
    const dias = diasEntre(c.cargado_en.slice(0, 10), hoy);
    return `${p.nombre}: hace ${dias} día(s)${dias > DIAS_MAX_SIN_CARGA ? ' ⚠️' : ''}`;
  }).join(' · ') : '';
  return `<div style="margin-top:14px;padding:12px 14px;border:1px solid var(--v-line);border-radius:12px">
    <p style="margin:0 0 8px;font-weight:600">${inmuebles ? `${inmuebles} inmueble(s)` : `${grupos.length} pendiente(s)`} por corregir</p>
    <div>${chips}</div>
    ${frescura ? `<p class="v-muted" style="margin:6px 0 0;font-size:12.5px">Último Excel — ${escape(frescura)}. Los pendientes de portales se re-evalúan solos cada madrugada con los datos de Sedi; al subir un Excel nuevo se actualizan al instante.</p>` : ''}
  </div>`;
}

function seccionesPorTipo(ctx, grupos, hoy, gestiona) {
  const { escape } = ctx;
  const porTipo = new Map();
  for (const g of grupos) porTipo.set(g.tipo, [...(porTipo.get(g.tipo) || []), g]);
  const tipos = [...porTipo.keys()].sort((a, b) => ORDEN_TIPOS.indexOf(a) - ORDEN_TIPOS.indexOf(b));
  return `<div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">${tipos.map((t) => {
    const gs = porTipo.get(t);
    // Las de «sin código en Sedi» suelen ser muchas y viejas: van plegadas.
    const abierta = t !== 'revisar_codigo' || gs.length <= 5;
    return `<details ${abierta ? 'open' : ''} style="border:0">
      <summary style="cursor:pointer;font-size:15px;font-weight:600;color:${COLOR_TIPO[t] || '#1A2C45'};padding:6px 0">${escape(TIPOS[t] || t)} (${gs.length})</summary>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">${gs.map((g) => tarjeta(ctx, g, hoy, gestiona)).join('')}</div>
    </details>`;
  }).join('')}</div>`;
}

function tarjeta(ctx, g, hoy, gestiona) {
  const { escape } = ctx;
  const f0 = g.filas[0];
  const abiertas = g.filas.filter((f) => ['abierto', 'en_proceso'].includes(f.estado));
  const abierto = abiertas.length > 0;
  const limite = abiertas.map((f) => f.fecha_limite).filter(Boolean).sort()[0] || null;
  const vencido = abierto && limite && limite < hoy;
  const color = !abierto ? (f0.estado === 'cerrado' ? '#059669' : '#6B7785') : vencido ? '#B3261E' : '#1A2C45';
  const vence = abierto && limite ? (vencido ? `Vencido hace ${diasEntre(limite, hoy)} día(s)` : `Vence ${limite}`) : '';
  const delSistema = g.filas.every((f) => f.origen === 'portales');
  const ids = g.filas.map((f) => f.id).join(',');
  const todasEnProceso = abiertas.length > 0 && abiertas.every((f) => f.estado === 'en_proceso');
  const estadoTxt = abierto ? (todasEnProceso ? 'En proceso' : 'Pendiente') : ESTADOS[f0.estado];

  const portales = g.filas.map((f) => {
    const hecho = f.estado === 'cerrado';
    return `<span style="display:inline-block;margin:0 6px 0 0;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--v-line);${hecho ? 'text-decoration:line-through;color:#059669' : ''}">${escape(nombrePortal(f.portal) || 'General')}</span>`;
  }).join('');

  const botones = [];
  if (abierto && !todasEnProceso) botones.push(`<button type="button" class="v-btn v-quiet" data-pend-accion="en_proceso" data-ids="${ids}">Ya lo estoy haciendo</button>`);
  // Solo lo que no viene de los portales se puede cerrar a mano. Lo de portales lo cierra el sistema.
  if (abierto && !delSistema) botones.push(`<button type="button" class="v-btn v-primary" data-pend-accion="cerrado" data-ids="${ids}">Cerrar</button>`);
  if (abierto && gestiona) botones.push(`<button type="button" class="v-btn v-quiet" data-pend-accion="descartado" data-ids="${ids}">No aplica (descartar)</button>`);
  if (!abierto && f0.estado === 'descartado' && gestiona) botones.push(`<button type="button" class="v-btn v-quiet" data-pend-accion="abierto" data-ids="${ids}">Reabrir</button>`);

  const cierre = !abierto
    ? (f0.estado === 'cerrado'
      ? `Resuelto automáticamente${f0.cerrado_en ? ' el ' + f0.cerrado_en.slice(0, 10) : ''}: Sedi y el portal ya coinciden.`
      : `Descartado${f0.nota_cierre ? ': ' + f0.nota_cierre : ''}`)
    : (delSistema ? 'Se marcará como resuelto solo cuando Sedi y el portal ya coincidan.' : '');

  const titulo = g.numero != null ? `${TIPOS[g.tipo] || g.tipo} · inmueble ${g.numero}` : (TIPOS[g.tipo] || g.tipo);
  return `<article style="border:1px solid var(--v-line);border-left:4px solid ${color};border-radius:12px;padding:12px 14px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <strong>${escape(titulo)}</strong>
      <span class="v-muted" style="font-size:12.5px">${escape(estadoTxt)}${vence ? ` · <span style="${vencido ? 'color:#B3261E;font-weight:600' : ''}">${escape(vence)}</span>` : ''}</span>
    </div>
    <p style="margin:6px 0 0">${portales}</p>
    ${lineasGrupo(g, escape)}
    <p class="v-muted" style="margin:6px 0 0;font-size:12.5px">Responsable: ${escape(f0.responsable_nombre || 'sin asignar')}${cierre ? ` · ${escape(cierre)}` : ''}</p>
    ${botones.length ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${botones.join('')}</div>` : ''}
  </article>`;
}

async function accionPendiente(ctx, ids, estado) {
  const { supabase, refreshIcons } = ctx;
  let nota = null;
  if (estado === 'cerrado') {
    nota = prompt('¿Qué se hizo? (queda como constancia)', '');
    if (nota === null) return;
  } else if (estado === 'descartado') {
    nota = prompt('¿Por qué no aplica? (obligatorio, queda como constancia)', '');
    if (nota === null) return;
    if (!nota.trim()) { ui.mensaje = 'Para descartar hay que escribir el motivo.'; renderPendientes(ctx).then(refreshIcons); return; }
  }
  let fallo = '';
  for (const id of ids) {
    const { error } = await supabase.rpc('agenda_pendiente_actualizar', { p_id: id, p_estado: estado, p_nota: nota });
    if (error) { fallo = error.message; break; }
  }
  ui.mensaje = fallo ? `No se pudo actualizar: ${fallo}` : '';
  renderPendientes(ctx).then(refreshIcons);
}

/* --------------------------------- Portales --------------------------------- */

async function cargarCargas(ctx) {
  const { supabase, empresaId } = ctx;
  const { data } = await supabase.from('agenda_portales_cargas').select('portal, cargado_en, total_activos')
    .eq('empresa_id', empresaId).order('cargado_en', { ascending: false }).limit(60);
  ui.cargas = {};
  for (const c of data || []) if (!ui.cargas[c.portal]) ui.cargas[c.portal] = c;
}

async function cargarInmuebles(ctx) {
  if (ui.inmuebles) return ui.inmuebles;
  const { supabase, empresaId } = ctx;
  const { data, error } = await supabase.from('agenda_inmuebles')
    .select('numero_inmueble, estado_crm, tipo_oferta, valor_canon, valor_venta, direccion, asesor_comercializacion, asesor_captacion, codigo_fincaraiz, codigo_metrocuadrado, codigo_ciencuadras')
    .eq('empresa_id', empresaId).limit(2000);
  if (error) throw new Error(error.message);
  ui.inmuebles = data || [];
  return ui.inmuebles;
}

async function pintarPortales(ctx) {
  const { el, escape, refreshIcons } = ctx;
  await cargarCargas(ctx);
  const hoy = hoyBogota();
  const estadoCarga = Object.entries(PORTALES).map(([k, p]) => {
    const c = ui.cargas[k];
    if (!c) return `<li><strong>${p.nombre}</strong>: <span style="color:#B3261E">nunca se ha cargado</span></li>`;
    const dias = diasEntre(c.cargado_en.slice(0, 10), hoy);
    return `<li><strong>${p.nombre}</strong>: última carga hace ${dias} día(s) · ${c.total_activos} publicaciones${dias > DIAS_MAX_SIN_CARGA ? ' <span style="color:#B3261E">— toca cargar de nuevo</span>' : ''}</li>`;
  }).join('');

  const cargados = Object.keys(ui.analisis);
  const sinCodigo = ui.inmuebles ? disponiblesSinCodigo(ui.inmuebles) : null;

  el.innerHTML = `${cabecera(ctx, true)}
    <p class="v-note">Descarga el Excel de publicaciones de cada portal (Fincaraíz te lo envía por correo, Metrocuadrado y Ciencuadras se descargan directo) y súbelos aquí. Se compara con los códigos de portal que tiene Sedi y, al subirlos, los pendientes se guardan solos (los que ya no aparezcan se marcan como resueltos). No se modifica nada en los portales.</p>
    <ul style="margin:12px 0;padding-left:18px;font-size:13.5px">${estadoCarga}</ul>
    <label class="v-field">Archivos de los portales (puedes elegir varios)
      <input type="file" id="por-archivos" class="v-input" accept=".xlsx,.xls" multiple></label>
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${cargados.length ? resumenCruzado(ctx) : ''}
    ${sinCodigo && sinCodigo.length ? `<details style="margin-top:20px"><summary><strong>${sinCodigo.length} inmuebles Disponibles sin código en ningún portal</strong> (informativo)</summary>
      <p class="v-muted" style="font-size:13px;margin-top:8px">Por la regla de la empresa no deberían estar publicados; si ya no se ofrecen, falta retirarlos en Sedi. No se crean pendientes con esto: hay que verificarlo primero con asesores o propietarios.</p>
      <p style="font-size:13.5px">${sinCodigo.join(', ')}</p></details>` : ''}`;

  enlazarSub(ctx);
  el.querySelector('#por-archivos').onchange = (e) => procesarArchivos(ctx, [...e.target.files]);
  void refreshIcons;
}

/* Resumen de todo lo cargado junto, agrupado por problema (no una tabla por portal). */
function resumenCruzado(ctx) {
  const { escape } = ctx;
  const filas = [];
  for (const [portal, a] of Object.entries(ui.analisis)) for (const i of a.items) filas.push({ ...i, portal, estado: 'abierto', id: i.clave });
  const porTipo = (t) => agrupar(filas.filter((f) => f.tipo === t));
  const seccion = (tipo, titulo, color) => {
    const gs = porTipo(tipo);
    if (!gs.length) return '';
    if (tipo === 'revisar_codigo') {
      // Suelen ser muchos y de publicaciones viejas: una línea por publicación, plegado.
      return `<details style="margin-top:16px"><summary style="font-size:15px;font-weight:600;color:${color}">${titulo} (${gs.length})</summary>
        <p class="v-muted" style="font-size:13px;margin:6px 0">O se bajan del portal, o falta registrar su código en Sedi.</p>
        <div style="display:flex;flex-direction:column;gap:4px">${gs.map((g) => {
          const f = g.filas[0];
          return `<div style="border-left:3px solid ${color};padding:1px 10px;font-size:13px"><strong>${escape(nombrePortal(f.portal))}</strong> ${escape((f.datos || {}).codigo || '')}${(f.datos || {}).referencia ? ` — <span class="v-muted">${escape(f.datos.referencia)}</span>` : ''}</div>`;
        }).join('')}</div></details>`;
    }
    return `<section style="margin-top:16px">
      <h3 style="margin:0 0 6px;font-size:15px;color:${color}">${titulo} (${gs.length})</h3>
      <div style="display:flex;flex-direction:column;gap:6px">${gs.map((g) => {
        const f0 = g.filas[0];
        const quien = f0.responsable_nombre ? ` · <span class="v-muted">${escape(f0.responsable_nombre)}</span>` : '';
        const num = g.numero != null ? `<strong>Inmueble ${g.numero}</strong> — ` : '';
        return `<div style="border-left:3px solid ${color};padding:2px 10px;font-size:13.5px">${num}${g.filas.map((f) => escape(nombrePortal(f.portal))).join(', ')}${quien}${lineasGrupo(g, escape).replace('margin:6px 0 0', 'margin:2px 0 0')}</div>`;
      }).join('')}</div></section>`;
  };
  const totalPortales = Object.keys(ui.analisis).map((k) => {
    const c = ui.analisis[k].cargadoEn;
    return `${nombrePortal(k)} (${ui.analisis[k].totalActivos}${c ? `, cargado ${c.slice(0, 10)}` : ''})`;
  }).join(' · ');
  const hay = filas.length > 0;
  return `<div style="margin-top:18px">
    <p class="v-muted" style="font-size:13px">Publicaciones activas leídas: ${escape(totalPortales)}</p>
    ${hay ? '' : '<p style="margin-top:10px">Sin diferencias: lo que dice Sedi coincide con los portales.</p>'}
    ${seccion('despublicar', 'Publicados que ya no deberían estarlo', '#B3261E')}
    ${seccion('publicar', 'Deberían estar publicados y no lo están', '#B26A00')}
    ${seccion('revisar_precio', 'Precio distinto entre Sedi y el portal', '#1A2C45')}
    ${seccion('revisar_codigo', 'Publicados en el portal sin código en Sedi', '#6B7785')}
  </div>`;
}

async function procesarArchivos(ctx, archivos) {
  const { refreshIcons } = ctx;
  if (!archivos.length) return;
  const errores = [];
  const nuevos = [];
  const registrosPorPortal = {};
  let inmuebles;
  try { inmuebles = await cargarInmuebles(ctx); } catch (e) { ui.mensaje = `No se pudo leer el inventario: ${e.message}`; renderPendientes(ctx).then(refreshIcons); return; }
  for (const f of archivos) {
    try {
      const { portal, registros } = await leerExcelPortal(new Uint8Array(await f.arrayBuffer()));
      ui.analisis[portal] = { ...compararPortal(portal, registros, inmuebles), guardado: false, cargadoEn: new Date().toISOString() };
      registrosPorPortal[portal] = registros;
      nuevos.push(portal);
    } catch (e) { errores.push(`${f.name}: ${e.message}`); }
  }
  // Al subir los archivos se guarda solo: crea los pendientes nuevos y marca como resueltos los que
  // ya no aparecen. No hay botón de por medio.
  await guardarPortales(ctx, nuevos, errores, registrosPorPortal);
}

async function guardarPortales(ctx, portales, previos = [], registrosPorPortal = {}) {
  const { supabase, empresaId, refreshIcons } = ctx;
  const partes = [...previos];
  for (const portal of portales) {
    const a = ui.analisis[portal];
    const { data, error } = await supabase.rpc('agenda_portales_guardar', {
      p_empresa_id: empresaId, p_portal: portal, p_items: a.items, p_total_activos: a.totalActivos,
    });
    if (error) { partes.push(`${nombrePortal(portal)}: no se pudo guardar (${error.message})`); continue; }
    a.guardado = true;
    guardarLocal(ctx);
    // La «foto» de lo publicado se guarda para que el sistema siga comparándola solo con Sedi cada madrugada (sql/021).
    // Si la base aún no tiene esa función, el resto funciona igual que antes.
    const registros = registrosPorPortal[portal];
    if (registros?.length) {
      await supabase.rpc('agenda_portales_guardar_foto', { p_empresa_id: empresaId, p_portal: portal, p_registros: registros }).then(() => {}, () => {});
    }
    partes.push(`${nombrePortal(portal)}: guardado — ${data.nuevos} pendiente(s) nuevo(s), ${data.cerrados_solos} resuelto(s) solos`);
  }
  ui.mensaje = partes.join(' · ');
  guardarLocal(ctx);
  renderPendientes(ctx).then(refreshIcons);
}
