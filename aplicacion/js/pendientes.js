// Pestaña "Pendientes": tareas con dueño y fecha límite + carga de los Excel de los portales.
// Quién ve qué lo decide la base de datos (RLS, sql/008); aquí solo se pinta lo que llega.
import { leerExcelPortal, compararPortal, disponiblesSinCodigo, PORTALES } from './portales-logica.js';

const TIPOS = {
  publicar: 'Publicar', despublicar: 'Despublicar', revisar_codigo: 'Revisar código', revisar_precio: 'Revisar precio',
  asamblea: 'Asamblea', terminacion: 'Terminación', entrega: 'Entrega', respuesta: 'Responder', otro: 'Otro',
};
const ESTADOS = { abierto: 'Abierto', en_proceso: 'En proceso', cerrado: 'Cerrado', descartado: 'Descartado' };
// Cada cuántos días hay que volver a cargar los Excel antes de avisar que están viejos.
const DIAS_MAX_SIN_CARGA = 8;

const ui = { sub: 'lista', estado: 'abiertos', tipo: 'all', texto: '', filas: [], cargas: {}, analisis: {}, inmuebles: null, mensaje: '' };

const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const diasEntre = (isoA, isoB) => Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);

export function reiniciarPendientes() {
  Object.assign(ui, { sub: 'lista', estado: 'abiertos', tipo: 'all', texto: '', filas: [], cargas: {}, analisis: {}, inmuebles: null, mensaje: '' });
}

export async function renderPendientes(ctx) {
  const { el, rol } = ctx;
  const gestiona = rol === 'administrador' || rol === 'coordinador';
  if (!gestiona) ui.sub = 'lista';
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
  ui.filas = filas;
  const vencidos = filas.filter((f) => ['abierto', 'en_proceso'].includes(f.estado) && f.fecha_limite && f.fecha_limite < hoy).length;

  el.innerHTML = `${cabecera(ctx, gestiona)}
    <p class="v-note">Cada pendiente tiene un responsable y una fecha límite, y sigue aquí hasta que se cierra. Los de portales se cierran solos cuando el siguiente Excel ya no muestra el problema.${gestiona ? '' : ' Solo ves los que son tuyos.'}</p>
    <div class="v-filters" style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label class="v-field">Estado<select id="pend-estado" class="v-input">
        <option value="abiertos" ${ui.estado === 'abiertos' ? 'selected' : ''}>Abiertos</option>
        ${Object.entries(ESTADOS).map(([v, t]) => `<option value="${v}" ${ui.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
        <option value="todos" ${ui.estado === 'todos' ? 'selected' : ''}>Todos</option></select></label>
      <label class="v-field">Tipo<select id="pend-tipo" class="v-input"><option value="all">Todos</option>
        ${Object.entries(TIPOS).map(([v, t]) => `<option value="${v}" ${ui.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="v-field">Buscar<input id="pend-texto" class="v-input" placeholder="# inmueble, asesor, texto…" value="${escape(ui.texto)}"></label>
    </div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(error.message)}</div>` : ''}
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${vencidos ? `<p style="margin-top:12px;color:#B3261E;font-weight:600">${vencidos} vencido(s)</p>` : ''}
    ${filas.length === 0
      ? `<div class="v-empty" style="margin-top:16px">${icon('list-checks')}<h3>Sin pendientes</h3><p style="margin-top:8px">No hay pendientes con estos filtros.</p></div>`
      : `<div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">${filas.map((f) => tarjeta(ctx, f, hoy)).join('')}</div>`}`;

  enlazarSub(ctx);
  el.querySelector('#pend-estado').onchange = (e) => { ui.estado = e.target.value; renderPendientes(ctx).then(refreshIcons); };
  el.querySelector('#pend-tipo').onchange = (e) => { ui.tipo = e.target.value; renderPendientes(ctx).then(refreshIcons); };
  let deb;
  el.querySelector('#pend-texto').oninput = (e) => {
    const v = e.target.value; clearTimeout(deb);
    deb = setTimeout(() => { ui.texto = v; renderPendientes(ctx).then(refreshIcons); }, 700);
  };
  el.querySelectorAll('[data-pend-accion]').forEach((b) => {
    b.onclick = () => accionPendiente(ctx, b.dataset.id, b.dataset.pendAccion);
  });
}

function tarjeta(ctx, f, hoy) {
  const { escape } = ctx;
  const abierto = ['abierto', 'en_proceso'].includes(f.estado);
  const vencido = abierto && f.fecha_limite && f.fecha_limite < hoy;
  const color = !abierto ? '#6B7785' : vencido ? '#B3261E' : '#1A2C45';
  const vence = f.fecha_limite
    ? (vencido ? `Vencido hace ${diasEntre(f.fecha_limite, hoy)} día(s)` : `Vence ${f.fecha_limite}`)
    : '';
  const portal = f.portal ? PORTALES[f.portal]?.nombre : '';
  const botones = abierto
    ? `${f.estado === 'abierto' ? `<button type="button" class="v-btn v-quiet" data-pend-accion="en_proceso" data-id="${f.id}">En proceso</button>` : ''}
       <button type="button" class="v-btn v-primary" data-pend-accion="cerrado" data-id="${f.id}">Cerrar</button>
       <button type="button" class="v-btn v-quiet" data-pend-accion="descartado" data-id="${f.id}">Descartar</button>`
    : `<button type="button" class="v-btn v-quiet" data-pend-accion="abierto" data-id="${f.id}">Reabrir</button>`;
  return `<article style="border:1px solid var(--v-line);border-left:4px solid ${color};border-radius:12px;padding:12px 14px">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <strong>${escape(f.titulo)}</strong>
      <span class="v-muted" style="font-size:12.5px">${escape(TIPOS[f.tipo] || f.tipo)}${portal ? ' · ' + escape(portal) : ''} · ${escape(ESTADOS[f.estado] || f.estado)}</span>
    </div>
    <p style="margin:6px 0 0;font-size:13.5px">${escape(f.detalle)}</p>
    <p class="v-muted" style="margin:6px 0 0;font-size:12.5px">Responsable: ${escape(f.responsable_nombre || 'sin asignar')}${vence ? ` · <span style="${vencido ? 'color:#B3261E;font-weight:600' : ''}">${escape(vence)}</span>` : ''}${f.estado === 'cerrado' || f.estado === 'descartado' ? ` · ${f.cierre_tipo === 'automatico' ? 'cerrado solo' : 'cerrado a mano'}${f.nota_cierre ? ': ' + escape(f.nota_cierre) : ''}` : ''}</p>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${botones}</div>
  </article>`;
}

async function accionPendiente(ctx, id, estado) {
  const { supabase, refreshIcons } = ctx;
  let nota = null;
  if (estado === 'cerrado') {
    nota = prompt('¿Qué se hizo? (queda como constancia)', '');
    if (nota === null) return;
  } else if (estado === 'descartado') {
    nota = prompt('¿Por qué se descarta? (obligatorio)', '');
    if (nota === null) return;
    if (!nota.trim()) { ui.mensaje = 'Para descartar hay que escribir el motivo.'; renderPendientes(ctx).then(refreshIcons); return; }
  }
  const { error } = await supabase.rpc('agenda_pendiente_actualizar', { p_id: id, p_estado: estado, p_nota: nota });
  ui.mensaje = error ? `No se pudo actualizar: ${error.message}` : '';
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
  const { el, escape, icon, refreshIcons } = ctx;
  await cargarCargas(ctx);
  const hoy = hoyBogota();
  const estadoCarga = Object.entries(PORTALES).map(([k, p]) => {
    const c = ui.cargas[k];
    if (!c) return `<li><strong>${p.nombre}</strong>: <span style="color:#B3261E">nunca se ha cargado</span></li>`;
    const dias = diasEntre(c.cargado_en.slice(0, 10), hoy);
    return `<li><strong>${p.nombre}</strong>: última carga hace ${dias} día(s) · ${c.total_activos} publicaciones${dias > DIAS_MAX_SIN_CARGA ? ' <span style="color:#B3261E">— toca cargar de nuevo</span>' : ''}</li>`;
  }).join('');

  const resultados = Object.entries(ui.analisis).map(([k, a]) => bloqueAnalisis(ctx, k, a)).join('');
  const sinCodigo = ui.inmuebles ? disponiblesSinCodigo(ui.inmuebles) : null;

  el.innerHTML = `${cabecera(ctx, true)}
    <p class="v-note">Descarga el Excel de publicaciones de cada portal (Fincaraíz te lo envía por correo, Metrocuadrado y Ciencuadras se descargan directo) y súbelos aquí. Se compara con los códigos de portal que tiene Sedi: lo que debería estar publicado y no está, lo que está publicado y no debería, y los precios distintos. No se modifica nada en los portales.</p>
    <ul style="margin:12px 0;padding-left:18px;font-size:13.5px">${estadoCarga}</ul>
    <label class="v-field">Archivos de los portales (puedes elegir varios)
      <input type="file" id="por-archivos" class="v-input" accept=".xlsx,.xls" multiple></label>
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${resultados}
    ${sinCodigo && sinCodigo.length ? `<details style="margin-top:20px"><summary><strong>${sinCodigo.length} inmuebles Disponibles sin código en ningún portal</strong> (informativo)</summary>
      <p class="v-muted" style="font-size:13px;margin-top:8px">Por la regla de la empresa no deberían estar publicados; si ya no se ofrecen, falta retirarlos en Sedi. No se crean pendientes con esto: hay que verificarlo primero con asesores o propietarios.</p>
      <p style="font-size:13.5px">${sinCodigo.join(', ')}</p></details>` : ''}`;

  enlazarSub(ctx);
  el.querySelector('#por-archivos').onchange = (e) => procesarArchivos(ctx, [...e.target.files]);
  el.querySelectorAll('[data-por-guardar]').forEach((b) => { b.onclick = () => guardarPortal(ctx, b.dataset.porGuardar); });
  void icon;
}

function bloqueAnalisis(ctx, portal, a) {
  const { escape } = ctx;
  const cuentas = {};
  a.items.forEach((i) => { cuentas[i.tipo] = (cuentas[i.tipo] || 0) + 1; });
  const resumen = Object.entries(cuentas).map(([t, n]) => `${n} ${TIPOS[t].toLowerCase()}`).join(' · ') || 'sin diferencias';
  return `<section style="margin-top:20px;border:1px solid var(--v-line);border-radius:12px;padding:14px">
    <h3 style="margin:0">${PORTALES[portal].nombre} <span class="v-muted" style="font-size:13px;font-weight:400">· ${a.totalActivos} publicaciones activas</span></h3>
    <p style="margin:6px 0">${escape(resumen)}</p>
    ${a.items.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--v-line)"><th style="padding:6px 8px">Tipo</th><th style="padding:6px 8px">Qué pasa</th><th style="padding:6px 8px">Responsable</th></tr></thead>
      <tbody>${a.items.map((i) => `<tr style="border-bottom:1px solid var(--v-line)"><td style="padding:6px 8px;white-space:nowrap">${escape(TIPOS[i.tipo])}</td><td style="padding:6px 8px"><strong>${escape(i.titulo)}</strong><br><span class="v-muted">${escape(i.detalle)}</span></td><td style="padding:6px 8px">${escape(i.responsable_nombre || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <button type="button" class="v-btn v-primary" style="margin-top:12px" data-por-guardar="${portal}" ${a.guardado ? 'disabled' : ''}>${a.guardado ? 'Guardado' : 'Guardar como pendientes y cerrar los resueltos'}</button>
  </section>`;
}

async function procesarArchivos(ctx, archivos) {
  const { refreshIcons } = ctx;
  if (!archivos.length) return;
  const errores = [];
  let inmuebles;
  try { inmuebles = await cargarInmuebles(ctx); } catch (e) { ui.mensaje = `No se pudo leer el inventario: ${e.message}`; renderPendientes(ctx).then(refreshIcons); return; }
  for (const f of archivos) {
    try {
      const { portal, registros } = await leerExcelPortal(new Uint8Array(await f.arrayBuffer()));
      ui.analisis[portal] = { ...compararPortal(portal, registros, inmuebles), guardado: false };
    } catch (e) { errores.push(`${f.name}: ${e.message}`); }
  }
  ui.mensaje = errores.join(' · ');
  renderPendientes(ctx).then(refreshIcons);
}

async function guardarPortal(ctx, portal) {
  const { supabase, empresaId, refreshIcons } = ctx;
  const a = ui.analisis[portal];
  if (!a) return;
  const { data, error } = await supabase.rpc('agenda_portales_guardar', {
    p_empresa_id: empresaId, p_portal: portal, p_items: a.items, p_total_activos: a.totalActivos,
  });
  if (error) { ui.mensaje = `No se pudo guardar: ${error.message}`; }
  else {
    a.guardado = true;
    ui.mensaje = `${PORTALES[portal].nombre}: ${data.nuevos} pendiente(s) nuevo(s), ${data.pendientes} en total, ${data.cerrados_solos} cerrado(s) solos por evidencia.`;
  }
  renderPendientes(ctx).then(refreshIcons);
}
