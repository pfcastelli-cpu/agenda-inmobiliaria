// Pantalla «Casos»: terminaciones, mantenimientos locativos, PQRs y asambleas de los inmuebles.
// Los datos viven en agenda_casos* (sql/120). Todo lo que debe reflejarse en Sedi cae solo en la cola
// agenda_sedi_cola (trigger), y el asistente de Chrome la ejecuta (docs/SINCRONIZAR-SEDI-CHROME.md).
// Sin datos personales de clientes: se guarda contrato, copropiedad y unidad; los nombres se quedan en Sedi.

import { panorama, enlazarPanorama, filtrosIniciales } from './casos-panorama.js';
import { cargarComunicaciones, montarPanel, nuevoEstado } from './casos-comunicaciones.js';

import { cargarEventos, montarLineaTiempo, eventoDeCorreo, FAMILIA } from './casos-linea-tiempo.js';
const escapeAttr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
import { cargarCorreosEmpresa, agruparDetectados, htmlListaDetectados, htmlDetalleDetectado, enlazarDetalleDetectado, fichaHtml } from './casos-detectados.js';
import { pintarCorreos, pintarPendientesSedi, contarCorreosPendientesSedi, reiniciarCorreos } from './casos-correos.js';
import { cargarAjustes, htmlAjustes, enlazarAjustes, pedirOpinion, htmlOpinion } from './casos-ia.js';
import { htmlQueSigue, htmlClasificacion, leerClasificacion, bloqueoDeEstado } from './casos-mantenimiento.js';
import { htmlCierre, leerCierre, faltaParaCerrar } from './casos-cierre.js';
import { cargarActas, htmlPanelActa, enlazarPanelActa } from './casos-actas.js';
import { cargarDirecciones, dirInmueble, ubicacionCaso, listaInmuebles } from './casos-direcciones.js';
import { htmlFormSeguimiento, leerFormSeguimiento, guardarSeguimiento } from './casos-seguimientos.js';
const ltSt = { caso: null, filtro: 'todo', pruebas: false, busca: '', abierto: null }; // estado de la línea de tiempo
let comSt ={ caso: null, st: nuevoEstado() }; // borrador de comunicación abierto (por caso)

const TIPOS = { terminacion: 'Terminaciones', mantenimiento: 'Mantenimientos', pqr: 'PQRs', asamblea: 'Asambleas' };
const UNO = { terminacion: 'terminación', mantenimiento: 'mantenimiento', pqr: 'PQR', asamblea: 'asamblea' };
const ESTADOS = {
  terminacion: { inicial: 'Inicial', aviso_recibido: 'Aviso recibido', propuesta_enviada: 'Propuesta enviada', entrega_programada: 'Entrega programada', entregado_sin_acta: 'Entregado, falta acta', cerrado: 'Cerrado', descartado: 'Descartado' },
  // Estados de «Reparaciones locativas» en Sedi (filtro Estado, leído el 28 nov 2026) + «Nuevo» (aún sin crear en Sedi) y «Descartado» (solo agenda).
  mantenimiento: { inicial: 'Nuevo', sin_cotizacion: 'Sin cotización', pendiente_cotizar: 'Pendiente cotizar', cotizado: 'Cotizado', propietario: 'Con el propietario', en_ejecucion: 'En ejecución', en_encuesta: 'En encuesta', finalizada: 'Finalizada', descartado: 'Descartado' },
  pqr: { radicado: 'Radicado', en_gestion: 'En gestión', respondido: 'Respondido', cerrado: 'Cerrado', descartado: 'Descartado' },
  asamblea: { detectada: 'Detectada', confirmada: 'Confirmada', poder_enviado: 'Poder enviado', realizada: 'Realizada', cerrada: 'Cerrada', descartado: 'Descartada' },
};
const ESTADO_INICIAL = { terminacion: 'inicial', mantenimiento: 'inicial', pqr: 'radicado', asamblea: 'detectada' };
const CIERRAN = new Set(['cerrado', 'cerrada', 'descartado', 'finalizada']);
const PRIORIDAD = { 1: 'Urgente', 2: 'Esta semana', 3: 'Pendiente' };
const COLOR_PRIORIDAD = { 1: '#B3261E', 2: '#B26A00', 3: '#1A2C45' };

const tipoDetectadoPrefijo = () => ui.sub + '|';
const ui = { sub: 'terminacion', ver: 'abiertos', texto: '', abierto: null, nuevo: false, mensaje: '', f: filtrosIniciales() };

const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const fechaCorta = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const diasHabiles = (iso, n) => { let d = iso; let k = 0; while (k < n) { d = sumarDias(d, 1); const w = new Date(d + 'T12:00:00').getDay(); if (w !== 0 && w !== 6) k++; } return d; };
const mesesEntre = (a, b) => (Date.parse(b) - Date.parse(a)) / (86400000 * 30.4375);

/* Regla de Felipe: la entrega es SEGURA solo si coincide (±5 días) con el vencimiento y el aviso fue con 3 meses o más.
   Aviso de menos de 3 meses = EXTEMPORÁNEO; entrega distinta del vencimiento = ACUERDO. */
export function clasificarTerminacion(d = {}) {
  if (!d.fecha_aviso || !d.fecha_vencimiento || !d.fecha_entrega) return { clave: 'incompleta', texto: 'Faltan fechas para clasificar', color: '#555' };
  const aTiempo = mesesEntre(d.fecha_aviso, d.fecha_vencimiento) >= 3;
  const coincide = Math.abs(Date.parse(d.fecha_entrega) - Date.parse(d.fecha_vencimiento)) / 86400000 <= 5;
  if (aTiempo && coincide) return { clave: 'segura', texto: 'Entrega SEGURA', color: '#0B7A75' };
  if (!aTiempo) return { clave: 'extemporanea', texto: 'EXTEMPORÁNEO (aviso con menos de 3 meses)', color: '#B3261E' };
  return { clave: 'acuerdo', texto: 'ACUERDO (la entrega no coincide con el vencimiento)', color: '#B26A00' };
}

/** Abre «Casos» directamente en una pestaña (por ejemplo la de Asambleas desde el menú). */
export function abrirCasosEn(sub) { if (TIPOS[sub]) { ui.sub = sub; ui.abierto = null; ui.nuevo = false; } }
export function reiniciarCasos() { reiniciarCorreos(); Object.assign(ui, { sub: 'terminacion', ver: 'abiertos', texto: '', abierto: null, nuevo: false, mensaje: '', f: filtrosIniciales() }); }

export async function renderCasos(ctx) {
  ctx.el.innerHTML = '<p class="v-muted">Cargando casos…</p>';
  await cargarDirecciones(ctx.supabase, ctx.empresaId);
  if (ui.sub === 'cola') await pintarCola(ctx);
  else if (ui.sub === 'correos') await pintarCorreos(ctx, cabecera(ctx, await contarCola(ctx)), () => enlazarCabecera(ctx));
  else if (ui.sub === 'ia') await pintarAjustesIA(ctx);
  else if (ui.abierto) await pintarDetalle(ctx);
  else await pintarLista(ctx);
  ctx.refreshIcons?.();
}

function cabecera(ctx, pendientesSedi) {
  const { icon } = ctx;
  const pest = [...Object.entries(TIPOS), ['correos', 'Correos por inmueble'], ['cola', 'Sincronizar con Sedi'], ['ia', 'Ajustes de IA']]
    .map(([v, t]) => `<button type="button" class="v-btn ${ui.sub === v ? 'v-primary' : 'v-quiet'}" data-caso-sub="${v}">${t}${v === 'cola' && pendientesSedi ? ` <span class="v-contador">${pendientesSedi}</span>` : ''}</button>`).join('');
  return `<div class="v-top"><div><div class="v-eyebrow">Inmuebles</div><h2>Casos</h2></div>
    <button type="button" class="v-btn v-primary" data-caso-nuevo>${icon('plus')}Nuevo caso</button></div>
    <div class="v-pesta" role="tablist" aria-label="Tipos de caso" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${pest}</div>`;
}

function enlazarCabecera(ctx) {
  ctx.el.querySelectorAll('[data-caso-sub]').forEach((b) => { b.onclick = () => { ui.sub = b.dataset.casoSub; ui.abierto = null; ui.nuevo = false; ui.mensaje = ''; ui.f = filtrosIniciales(); renderCasos(ctx); }; });
  const n = ctx.el.querySelector('[data-caso-nuevo]');
  if (n) n.onclick = () => { ui.nuevo = true; ui.abierto = null; if (['cola', 'correos', 'ia'].includes(ui.sub)) ui.sub = 'terminacion'; renderCasos(ctx); };
}

async function pintarAjustesIA(ctx) {
  const a = await cargarAjustes(ctx.supabase, ctx.empresaId);
  ctx.el.innerHTML = `${cabecera(ctx, 0)}<div id="ia-host">${htmlAjustes(a, ctx.escape, ctx.rol === 'administrador')}</div>`;
  enlazarCabecera(ctx);
  enlazarAjustes(ctx.el.querySelector('#ia-host'), ctx.supabase, ctx.empresaId, ctx.escape, a);
}

async function contarCola(ctx) {
  const { count } = await ctx.supabase.from('agenda_sedi_cola').select('id', { count: 'exact', head: true }).eq('empresa_id', ctx.empresaId).in('estado', ['pendiente', 'error']);
  return (count || 0) + await contarCorreosPendientesSedi(ctx.supabase, ctx.empresaId);
}

/* --------------------------------- Lista --------------------------------- */
async function pintarLista(ctx) {
  const { el, supabase, empresaId, escape } = ctx;
  const nCola = await contarCola(ctx);
  if (ui.nuevo) { el.innerHTML = cabecera(ctx, nCola) + formularioNuevo(); enlazarCabecera(ctx); enlazarNuevo(ctx); return; }
  let q = supabase.from('agenda_casos').select('*').eq('empresa_id', empresaId).eq('tipo', ui.sub)
    .order('prioridad', { ascending: true }).order('fecha_limite', { ascending: true, nullsFirst: false }).limit(500);
  if (ui.ver === 'abiertos') q = q.is('cerrado_en', null);
  const { data, error } = await q;
  const t = ui.texto.trim().toLowerCase();
  const filas = (data || []).filter((c) => !t || `${c.titulo} ${c.copropiedad || ''} ${c.unidad || ''} ${c.contrato_ref || ''} ${c.sedi_numero || ''}`.toLowerCase().includes(t));
  const hoy = hoyBogota();
  const { correos: todosCorreos } = await cargarCorreosEmpresa(supabase, empresaId);
  const detectados = agruparDetectados(todosCorreos, ui.sub, data || []).filter((g) => !t || g.titulo.toLowerCase().includes(t));
  const vencidos = filas.filter((c) => !c.cerrado_en && c.fecha_limite && c.fecha_limite < hoy).length;
  el.innerHTML = `${cabecera(ctx, nCola)}
    <div class="v-filters" style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label class="v-field">Ver<select id="caso-ver" class="v-input"><option value="abiertos" ${ui.ver === 'abiertos' ? 'selected' : ''}>Abiertos</option><option value="todos" ${ui.ver === 'todos' ? 'selected' : ''}>Todos</option></select></label>
      <label class="v-field">Buscar<input id="caso-texto" class="v-input" placeholder="Copropiedad, apto, contrato…" value="${escape(ui.texto)}"></label>
    </div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(error.message)}</div>` : ''}
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${vencidos ? `<p style="margin-top:12px;color:#B3261E;font-weight:600">${vencidos} vencido(s)</p>` : ''}
    ${htmlListaDetectados(detectados, escape)}
    ${filas.length === 0 ? `<div class="v-empty" style="margin-top:16px"><h3>Sin ${TIPOS[ui.sub].toLowerCase()} registrados</h3><p style="margin-top:8px">${detectados.length ? 'Los casos que armó el lector con los correos están arriba.' : 'Use «Nuevo caso» para agregar uno.'}</p></div>`
      : (ui.sub === 'terminacion' || ui.sub === 'asamblea' || ui.sub === 'mantenimiento') ? panorama(ui.sub, filas, ui.f, escape, hoy)
      : `<div style="display:grid;gap:10px;margin-top:14px">${filas.map((c) => tarjeta(ctx, c, hoy)).join('')}</div>`}`;
  enlazarCabecera(ctx);
  if (ui.sub === 'terminacion' || ui.sub === 'asamblea' || ui.sub === 'mantenimiento') enlazarPanorama(el, ui.f, hoy, () => renderCasos(ctx));
  el.querySelector('#caso-ver').onchange = (e) => { ui.ver = e.target.value; renderCasos(ctx); };
  const inp = el.querySelector('#caso-texto');
  inp.onchange = () => { ui.texto = inp.value; renderCasos(ctx); };
  el.querySelectorAll('[data-caso-abrir], [data-det-abrir]').forEach((b) => { b.onclick = () => { ui.abierto = b.dataset.casoAbrir || b.dataset.detAbrir; renderCasos(ctx); }; });
}

function insigniaSedi(c, escape) {
  if (c.tipo === 'asamblea' || !c.sincroniza_sedi) return '';
  const m = { sincronizado: ['En Sedi', '#0B7A75'], pendiente: ['Por pasar a Sedi', '#B26A00'], error: ['Error al pasar a Sedi', '#B3261E'] }[c.sedi_estado];
  return m ? `<span style="font-size:12px;font-weight:600;color:${m[1]}">${escape(m[0])}${c.sedi_numero ? ` · #${escape(c.sedi_numero)}` : ''}</span>` : '';
}

function tarjeta(ctx, c, hoy) {
  const { escape } = ctx;
  const vencido = !c.cerrado_en && c.fecha_limite && c.fecha_limite < hoy;
  const extra = c.tipo === 'terminacion' && !c.cerrado_en ? `<span style="font-size:12px;font-weight:600;color:${clasificarTerminacion(c.datos).color}">${escape(clasificarTerminacion(c.datos).texto)}</span>` : '';
  return `<button type="button" class="v-card" data-caso-abrir="${c.id}" style="text-align:left;padding:12px 14px;border:1px solid var(--v-line);border-left:5px solid ${COLOR_PRIORIDAD[c.prioridad]};border-radius:10px;background:var(--v-surface, #fff);cursor:pointer">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${escape(c.titulo)}</strong><span style="font-size:12px;color:${COLOR_PRIORIDAD[c.prioridad]};font-weight:600">${PRIORIDAD[c.prioridad]}</span></div>
    <div class="v-muted" style="font-size:13px;margin-top:4px">${[ubicacionCaso(c), c.contrato_ref].filter(Boolean).map(escape).join(' · ') || 'Sin inmueble indicado'}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:13px"><span>${escape(ESTADOS[c.tipo][c.estado] || c.estado)}</span>${c.fecha_limite ? `<span style="${vencido ? 'color:#B3261E;font-weight:600' : ''}">Límite: ${fechaCorta(c.fecha_limite)}${vencido ? ' (vencido)' : ''}</span>` : ''}${extra}${insigniaSedi(c, escape)}</div>
  </button>`;
}

/* -------------------------------- Formulario ------------------------------- */
const campo = (id, rotulo, tipo = 'text', extra = '') => `<label class="v-field">${rotulo}<input id="${id}" type="${tipo}" class="v-input" ${extra}></label>`;

function camposPorTipo(tipo) {
  if (tipo === 'terminacion') return `${campo('nc-fecha_vencimiento', 'Vencimiento del contrato', 'date')}${campo('nc-fecha_aviso', 'Fecha del aviso del arrendatario', 'date')}${campo('nc-fecha_entrega', 'Fecha de entrega acordada', 'date')}
    <label class="v-field">Causa<select id="nc-causa" class="v-input"><option>No renovación</option><option>Terminación anticipada de contrato</option><option>Mutuo acuerdo</option></select></label>
    <label class="v-field">Canal<select id="nc-canal" class="v-input"><option>Correo</option><option>WhatsApp</option><option>Carta</option></select></label>
    <p id="nc-clasif" class="v-note" style="grid-column:1/-1"></p>`;
  if (tipo === 'mantenimiento') return `${campo('nc-proveedor', 'Proveedor (si ya hay)')}${campo('nc-cotizacion', 'Valor cotizado', 'number', 'min="0"')}
    <label class="v-field">¿Quién paga?<select id="nc-paga" class="v-input"><option value="por_definir">Por definir (revisar contrato y Ley 820)</option><option value="propietario">Propietario</option><option value="arrendatario">Arrendatario</option><option value="copropiedad">Copropiedad</option></select></label>`;
  if (tipo === 'pqr') return `<label class="v-field">Clase<select id="nc-clase" class="v-input"><option value="peticion">Derecho de petición</option><option value="queja">Queja</option><option value="reclamo">Reclamo</option><option value="sugerencia">Sugerencia</option></select></label>
    ${campo('nc-radicado', 'Fecha de radicación', 'date', `value="${hoyBogota()}"`)}<label class="v-field">Canal<select id="nc-canal" class="v-input"><option>Correo</option><option>WhatsApp</option><option>Carta</option><option>Entidad</option></select></label>
    <p class="v-note" style="grid-column:1/-1">Los derechos de petición tienen plazo legal (15 días hábiles): el límite se calcula solo.</p>`;
  return `${campo('nc-fecha_asamblea', 'Fecha de la asamblea', 'date')}${campo('nc-hora', 'Hora', 'time')}${campo('nc-lugar', 'Lugar o enlace')}${campo('nc-limite_poderes', 'Fecha límite de poderes', 'date')}
    <label class="v-field">Modalidad<select id="nc-modalidad" class="v-input"><option>Presencial</option><option>Virtual</option><option>Mixta</option></select></label>`;
}

function formularioNuevo() {
  return `<form id="caso-form" class="v-card" style="margin-top:14px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
    <h3>Nuevo caso</h3>
    <p class="v-note">Busque el inmueble por su dirección y el formulario se llena solo con lo que ya sabemos (contrato, correos recibidos, fechas). Revise y corrija lo que haga falta. No pegue nombres, cédulas, celulares ni correos de clientes: eso se queda en Sedi.</p>
    <label class="v-field" style="margin-top:10px">Inmueble (escriba parte de la dirección o el número)<input id="nc-inmueble" class="v-input" list="nc-inmuebles" autocomplete="off" placeholder="Ej.: Montiel, Lagartos, 344…"></label><datalist id="nc-inmuebles">${listaInmuebles().map((i) => `<option value="${escapeAttr(i.direccion)} (N° ${i.cod})"></option>`).join('')}</datalist><p id="nc-precarga" class="v-note" role="status" style="margin:6px 0 0"></p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px">
      <label class="v-field">Tipo<select id="nc-tipo" class="v-input">${Object.entries(UNO).map(([v, t]) => `<option value="${v}" ${ui.sub === v ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
      ${campo('nc-titulo', 'Título corto', 'text', 'required maxlength="200"')}
      ${campo('nc-copropiedad', 'Copropiedad / edificio')}${campo('nc-unidad', 'Apartamento / local')}${campo('nc-contrato', 'N.º de contrato (CT-…)')}
      <label class="v-field">Prioridad<select id="nc-prioridad" class="v-input"><option value="1">Urgente</option><option value="2">Esta semana</option><option value="3" selected>Pendiente</option></select></label>
      ${campo('nc-limite', 'Fecha límite', 'date')}
      <label class="v-field">Parte<select id="nc-parte" class="v-input"><option value="interno">Interno</option><option value="propietario">Propietario</option><option value="arrendatario">Arrendatario</option><option value="ambos">Ambos</option></select></label>
      ${campo('nc-drive', 'Carpeta de Drive con fotos y documentos', 'url', 'placeholder="https://drive.google.com/…"')}
    </div>
    <div id="nc-especificos" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px"></div>
    <label class="v-field" style="margin-top:12px">Descripción<textarea id="nc-desc" class="v-input" rows="3"></textarea></label>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="nc-sedi" type="checkbox" checked> Pasar también a Sedi (el asistente lo hará desde su Chrome)</label>
    <div id="nc-error" class="v-error" role="alert" hidden></div>
    <div style="display:flex;gap:10px;margin-top:14px"><button type="submit" class="v-btn v-primary">Guardar caso</button><button type="button" class="v-btn v-quiet" id="nc-cancelar">Cancelar</button></div>
    </form>`;
}

function enlazarNuevo(ctx) {
  const { el, supabase, empresaId } = ctx;
  const $ = (id) => el.querySelector('#' + id);
  const pintarEspecificos = () => {
    $('nc-especificos').innerHTML = camposPorTipo($('nc-tipo').value);
    const clasif = () => { const p = $('nc-clasif'); if (!p) return; const r = clasificarTerminacion({ fecha_aviso: $('nc-fecha_aviso').value, fecha_vencimiento: $('nc-fecha_vencimiento').value, fecha_entrega: $('nc-fecha_entrega').value }); p.textContent = r.texto; p.style.color = r.color; };
    ['nc-fecha_aviso', 'nc-fecha_vencimiento', 'nc-fecha_entrega'].forEach((i) => { if ($(i)) $(i).onchange = clasif; });
  };
  let pre = { cod: '', fecha_aviso: '', descripcion: '', contrato: '' };
  const rellenar = () => {
    if (!pre.cod) return;
    const poner = (id, val) => { if ($(id) && val && !$(id).value) $(id).value = val; };
    if ($('nc-tipo').value === 'terminacion') { poner('nc-fecha_aviso', pre.fecha_aviso); $('nc-fecha_aviso')?.dispatchEvent(new Event('change')); }
  };
  $('nc-tipo').onchange = () => { pintarEspecificos(); rellenar(); }; pintarEspecificos();
  $('nc-inmueble').onchange = async () => {
    const txt = $('nc-inmueble').value.trim(); const m = txt.match(/\(N° (\d+)\)\s*$/) || (/^\d+$/.test(txt) ? [null, txt] : null);
    const msg = $('nc-precarga'); if (!m) { msg.textContent = ''; return; }
    const cod = m[1]; const dir = dirInmueble(cod);
    if (!dir) { msg.textContent = 'No encuentro ese inmueble; revise el número.'; return; }
    msg.textContent = 'Buscando lo que ya se sabe de este inmueble…';
    const tipo = $('nc-tipo').value;
    const [cor, res] = await Promise.all([
      supabase.from('agenda_inmueble_correos').select('fecha,direccion,categoria,resumen,contrato_ref').eq('empresa_id', empresaId).eq('inmueble_cod', cod).eq('estado', 'activo').order('fecha', { ascending: false }).limit(60),
      supabase.from('agenda_inmueble_contratos_resumen').select('contrato_ref,ultimo_correo').eq('empresa_id', empresaId).eq('inmueble_cod', cod).order('ultimo_correo', { ascending: false }).limit(5),
    ]);
    const correos = (cor.data || []).filter((x) => FAMILIA[x.categoria] === tipo);
    const contrato = (res.data || []).find((x) => x.contrato_ref && x.contrato_ref !== 'SIN-CONTRATO')?.contrato_ref || correos.find((x) => x.contrato_ref)?.contrato_ref || '';
    const aviso = correos.filter((x) => x.direccion === 'entrante').at(-1);
    pre = { cod, contrato, fecha_aviso: aviso ? String(aviso.fecha).slice(0, 10) : '', descripcion: correos[0]?.resumen || '' };
    const poner = (id, val) => { if ($(id) && val) $(id).value = val; };
    poner('nc-copropiedad', dir); poner('nc-contrato', contrato);
    poner('nc-titulo', `${UNO[tipo][0].toUpperCase() + UNO[tipo].slice(1)} · ${dir}`.slice(0, 200));
    poner('nc-desc', pre.descripcion);
    rellenar();
    const usados = [contrato && 'contrato ' + contrato, aviso && 'fecha del aviso', pre.descripcion && 'descripción del último correo'].filter(Boolean);
    msg.textContent = 'Listo: se llenó ' + ['la dirección', ...usados].join(', ') + '. Complete lo que falte.';
  };
  $('nc-cancelar').onclick = () => { ui.nuevo = false; renderCasos(ctx); };
  $('caso-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const tipo = $('nc-tipo').value;
    const v = (i) => ($(i) ? $(i).value.trim() : '');
    const datos = pre.cod ? { n_inmueble: pre.cod } : {};
    let limite = v('nc-limite') || null;
    if (tipo === 'terminacion') Object.assign(datos, { fecha_vencimiento: v('nc-fecha_vencimiento'), fecha_aviso: v('nc-fecha_aviso'), fecha_entrega: v('nc-fecha_entrega'), causa: v('nc-causa'), canal: v('nc-canal') });
    if (tipo === 'terminacion') { limite = limite || datos.fecha_entrega || null; datos.clasificacion = clasificarTerminacion(datos).clave; }
    if (tipo === 'mantenimiento') Object.assign(datos, { proveedor: v('nc-proveedor'), cotizacion: Number(v('nc-cotizacion')) || null, paga: v('nc-paga') });
    if (tipo === 'pqr') { Object.assign(datos, { clase: v('nc-clase'), radicado: v('nc-radicado'), canal: v('nc-canal') }); if (datos.clase === 'peticion' && datos.radicado) limite = limite || diasHabiles(datos.radicado, 15); }
    if (tipo === 'asamblea') { Object.assign(datos, { fecha_asamblea: v('nc-fecha_asamblea'), hora: v('nc-hora'), lugar: v('nc-lugar'), limite_poderes: v('nc-limite_poderes'), modalidad: v('nc-modalidad') }); limite = limite || datos.limite_poderes || datos.fecha_asamblea || null; }
    const fila = { empresa_id: empresaId, tipo, titulo: v('nc-titulo'), descripcion: v('nc-desc') || null, copropiedad: v('nc-copropiedad') || null, unidad: v('nc-unidad') || null, contrato_ref: v('nc-contrato') || null,
      prioridad: Number(v('nc-prioridad')), fecha_limite: limite, parte: v('nc-parte'), datos, drive_carpeta_url: v('nc-drive') || null, estado: ESTADO_INICIAL[tipo], origen: 'manual',
      sincroniza_sedi: $('nc-sedi').checked && tipo !== 'asamblea', sedi_estado: $('nc-sedi').checked && tipo !== 'asamblea' ? 'pendiente' : 'no_aplica' };
    const { data, error } = await supabase.from('agenda_casos').insert(fila).select('id').single();
    if (error) { const e = $('nc-error'); e.hidden = false; e.textContent = error.message; return; }
    ui.nuevo = false; ui.abierto = data.id; ui.mensaje = 'Caso guardado.'; renderCasos(ctx);
  };
}

/* --------------------------------- Detalle --------------------------------- */
const ROTULOS_DATOS = { ciudad: 'Ciudad', n_inmueble: 'N° de inmueble', fecha_aviso: 'Fecha del aviso', fecha_entrega: 'Fecha de entrega', fecha_vencimiento: 'Vencimiento del contrato', arrendatario: 'Arrendatario', propietario: 'Propietario', solicitante: 'Quién avisó', estado_solicitud: 'Qué dijo', proceso_sedi: 'Proceso en Sedi', estado_sedi: 'Estado en Sedi', cotizacion: 'Cotización', paga: 'Quién paga', inicio_obra: 'Inicio de obra', fin_obra: 'Fin de obra', informe_a: 'Informe enviado a', tipo_asamblea: 'Tipo de asamblea', fecha_asamblea: 'Fecha de la asamblea', hora: 'Hora', modalidad: 'Modalidad', propietario_avisado: 'Propietario avisado', poder: 'Poder', nota: 'Nota' };
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
function fichaCaso(c, d, escape) {
  const val = (v) => (v === '' || v == null ? '' : esFecha(v) ? escape(fechaCorta(v)) : escape(String(v)));
  const vistas = new Set(['ciudad', 'n_inmueble', 'fecha_aviso', 'fecha_entrega', 'fecha_vencimiento', 'arrendatario', 'propietario']);
  const clas = c.tipo === 'terminacion' ? clasificarTerminacion(d) : null;
  const filas = [
    ['Tipo de caso', escape((UNO[c.tipo] || c.tipo).replace(/^./, (m) => m.toUpperCase()))],
    ['Dirección del inmueble', dirInmueble(d.n_inmueble) ? `<strong>${escape(dirInmueble(d.n_inmueble))}</strong>` : ''],
    ['Ciudad', val(d.ciudad)], ['N° de inmueble', val(d.n_inmueble)],
    ['Conjunto o edificio', val(c.copropiedad)], ['Unidad', val(c.unidad)], ['Contrato', val(c.contrato_ref)],
    ['Arrendatario', val(d.arrendatario)], ['Propietario', val(d.propietario)],
    ['Fecha del aviso', val(d.fecha_aviso)], ['Fecha de entrega', val(d.fecha_entrega)], ['Vencimiento del contrato', val(d.fecha_vencimiento)],
    ...(clas ? [['Clasificación', `<strong style="color:${clas.color}">${escape(clas.texto)}</strong>`]] : []),
    ...Object.entries(d).filter(([k, v]) => !vistas.has(k) && v !== '' && v != null).map(([k, v]) => [ROTULOS_DATOS[k] || k.replace(/_/g, ' '), val(v)]),
    ['Prioridad', `<strong style="color:${COLOR_PRIORIDAD[c.prioridad]}">${escape(PRIORIDAD[c.prioridad] || '')}</strong>`],
    ['Límite', c.fecha_limite ? val(c.fecha_limite) : ''],
    ['Sedi', insigniaSedi(c, escape)],
  ];
  return fichaHtml(c.titulo, `<span class="dt-sello">${escape(ESTADOS[c.tipo]?.[c.estado] || c.estado)}</span>`, filas, escape);
}

async function pintarDetalleDetectado(ctx) {
  const { el, supabase, empresaId, escape } = ctx;
  const tipo = String(ui.abierto).split('|')[0];
  const nCola = await contarCola(ctx);
  const { correos } = await cargarCorreosEmpresa(supabase, empresaId);
  const { data: reales } = await supabase.from('agenda_casos').select('*').eq('empresa_id', empresaId).eq('tipo', tipo).limit(500);
  const g = agruparDetectados(correos, tipo, reales || []).find((x) => x.clave === ui.abierto);
  if (!g) { ui.abierto = null; ui.mensaje = 'No se encontró el caso detectado.'; return pintarLista(ctx); }
  el.innerHTML = `${cabecera(ctx, nCola)}
    <div style="position:sticky;top:0;z-index:20;background:var(--v-bg,#F5F7FA);padding:8px 0;margin-top:4px"><button type="button" class="v-btn v-primary" id="caso-volver">← Volver a ${escape((TIPOS[tipo] || 'la lista').toLowerCase())}</button></div>
    ${htmlDetalleDetectado(g, escape)}`;
  enlazarCabecera(ctx);
  el.querySelector('#caso-volver').onclick = () => { ui.abierto = null; renderCasos(ctx); };
  enlazarDetalleDetectado(el, g, escape, () => { ui.abierto = null; renderCasos(ctx); }, () => renderCasos(ctx));
}

async function pintarDetalle(ctx) {
  if (String(ui.abierto).startsWith(tipoDetectadoPrefijo())) return pintarDetalleDetectado(ctx);
  const { el, supabase, escape, icon } = ctx;
  const { data: c, error } = await supabase.from('agenda_casos').select('*').eq('id', ui.abierto).maybeSingle();
  if (error || !c) { ui.abierto = null; ui.mensaje = error ? error.message : 'No se encontró el caso.'; return pintarLista(ctx); }
  const nCola = await contarCola(ctx);
  const abierto = !c.cerrado_en;
  const d = c.datos || {};
  const actas = c.tipo === 'terminacion' ? await cargarActas(supabase, c.id) : [];
  el.innerHTML = `${cabecera(ctx, nCola)}
    <div style="position:sticky;top:0;z-index:20;background:var(--v-bg,#F5F7FA);padding:8px 0;margin-top:4px"><button type="button" class="v-btn v-primary" id="caso-volver">← Volver a ${escape((TIPOS[c.tipo] || 'la lista').toLowerCase())}</button></div>
    ${c.tipo === 'mantenimiento' ? htmlQueSigue(c, escape) : ''}
    ${fichaCaso(c, d, escape)}
    ${c.tipo === 'terminacion' ? htmlPanelActa(c, d, actas, clasificarTerminacion(d).clave, escape) : ''}
    <div class="v-card" style="margin-top:10px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
      ${c.descripcion ? `<p style="margin:0 0 8px">${escape(c.descripcion)}</p>` : ''}
      ${c.drive_carpeta_url ? `<p style="margin-top:10px"><a href="${escape(c.drive_carpeta_url)}" target="_blank" rel="noopener noreferrer">${icon('folder-open')} Abrir carpeta de Drive</a></p>` : ''}
      ${abierto ? `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
        <label class="v-field">Estado<select id="caso-estado" class="v-input">${Object.entries(ESTADOS[c.tipo]).map(([k, t]) => `<option value="${k}" ${c.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button type="button" class="v-btn v-primary" id="caso-guardar-estado">Guardar</button></div>
        ${c.tipo === 'mantenimiento' ? htmlClasificacion(d, escape) : ''}
        ${c.tipo === 'terminacion' ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Cierre manual (solo si no hay acta para subir)</summary><div id="caso-cierre" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
          ${htmlCierre(d, clasificarTerminacion(d), escape)}</div></details>` : ''}` : `<p class="v-note">Caso cerrado el ${escape(String(c.cerrado_en).slice(0, 10))}.</p>`}
      <div id="caso-error" class="v-error" role="alert" hidden></div>
    </div>
    <div id="caso-linea"></div>
    ${c.tipo === 'terminacion' ? '<details class="v-card" style="margin-top:12px;border:1px solid var(--v-line);border-radius:12px;padding:12px 16px"><summary style="cursor:pointer;font-weight:700;font-size:16px">✉ Cartas que enviamos desde la plataforma (entrega a tiempo, contrato prorrogado, aviso al propietario)</summary><p class="v-muted" style="margin:8px 0 0">Los correos que ya se enviaron o recibieron por solicitudes@, info@ o contabilidad@ están arriba, en la línea del tiempo. Esto es solo para redactar y enviar una carta nueva desde aquí.</p><div id="caso-comunicaciones"></div></details>' : ''}
    <div class="v-card" style="margin-top:12px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
      ${htmlFormSeguimiento(escape)}
    </div>
    <div class="v-card" style="margin-top:12px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
      <h3>Agregar foto o documento (Drive)</h3>
      <form id="arch-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:8px">
        <input id="arch-nombre" class="v-input" placeholder="Nombre (ej. Humedad baño)" required maxlength="120">
        <input id="arch-url" class="v-input" type="url" placeholder="Enlace de Drive" required>
        <select id="arch-tipo" class="v-input"><option value="foto">Foto</option><option value="documento">Documento</option><option value="acta">Acta de entrega</option><option value="carta">Carta</option><option value="otro">Otro</option></select>
        <button class="v-btn v-primary" type="submit">Agregar</button></form>
    </div>`;
  enlazarCabecera(ctx);
  if (c.tipo === 'terminacion') enlazarPanelActa(el, ctx, c, d, (m) => { ui.mensaje = m; renderCasos(ctx); });
  const pintarLinea = async () => {
    if (ltSt.caso !== c.id) Object.assign(ltSt, { caso: c.id, filtro: 'todo', pruebas: false, busca: '', abierto: null });
    montarLineaTiempo(el.querySelector('#caso-linea'), await cargarEventos(ctx.supabase, c, ESTADOS[c.tipo]), ltSt, escape);
  };
  await pintarLinea();
  if (c.tipo === 'terminacion') {
    if (comSt.caso !== c.id) comSt = { caso: c.id, st: nuevoEstado() };
    const mostrar = async () => { const filas = await cargarComunicaciones(ctx.supabase, c.id); montarPanel(el.querySelector('#caso-comunicaciones'), ctx, c, filas, comSt.st, mostrar); await pintarLinea(); };
    await mostrar();
  }
  const $ = (i) => el.querySelector('#' + i);
  const mostrarError = (m) => { const e = $('caso-error'); e.hidden = false; e.textContent = m; };
  $('caso-volver').onclick = () => { ui.abierto = null; renderCasos(ctx); };
  if (abierto) $('caso-guardar-estado').onclick = async () => {
    const estado = $('caso-estado').value;
    const cambios = { estado };
    if (c.tipo === 'terminacion') cambios.datos = leerCierre(el, d);
    if (c.tipo === 'mantenimiento') { cambios.datos = leerClasificacion(el, d); const b = bloqueoDeEstado(estado, cambios.datos); if (b && estado !== c.estado) return mostrarError(b); }
    if (CIERRAN.has(estado)) cambios.cerrado_en = new Date().toISOString();
    if (c.tipo === 'terminacion' && estado === 'cerrado') { const falta = faltaParaCerrar(cambios.datos); if (falta) return mostrarError(falta); }
    const { error: e } = await ctx.supabase.from('agenda_casos').update(cambios).eq('id', c.id);
    if (e) return mostrarError(e.message);
    ui.mensaje = 'Estado guardado.'; renderCasos(ctx);
  };
  const botonOpinion = el.querySelector('#cl-opinion');
  if (botonOpinion) botonOpinion.onclick = async () => {
    const res = el.querySelector('#cl-opinion-res');
    res.textContent = 'Consultando a la IA…';
    const r = await pedirOpinion(ctx.supabase, ctx.empresaId, { resumen: c.descripcion || c.titulo, indicios: el.querySelector('#cl-indicios').value });
    res.innerHTML = r.error ? `<span class="v-error">${escape(r.error)}</span>` : htmlOpinion(r.opinion, escape);
  };
  $('seg-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const { fila, error: msg } = leerFormSeguimiento(el, c);
    if (msg) return mostrarError(msg);
    const { error: e, degradado } = await guardarSeguimiento(ctx.supabase, fila);
    if (e) return mostrarError(e.message);
    if (degradado) ui.mensaje = 'Seguimiento guardado como texto (la base aún no tiene los campos nuevos).';
    renderCasos(ctx);
  };
  $('arch-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const { error: e } = await ctx.supabase.from('agenda_casos_archivos').insert({ caso_id: c.id, empresa_id: c.empresa_id, nombre: $('arch-nombre').value.trim(), drive_url: $('arch-url').value.trim(), tipo: $('arch-tipo').value });
    if (e) return mostrarError('El enlace debe ser de Google Drive o Docs. ' + e.message);
    renderCasos(ctx);
  };
}

/* ------------------------------ Cola de Sedi ------------------------------- */
const ACCION = { crear: 'Crear en Sedi', seguimiento: 'Agregar seguimiento', cambiar_estado: 'Cambiar estado', cerrar: 'Cerrar proceso', adjuntar: 'Adjuntar documento' };
async function pintarCola(ctx) {
  const { el, supabase, empresaId, escape } = ctx;
  const { data, error } = await supabase.from('agenda_sedi_cola').select('*, agenda_casos(titulo,tipo,contrato_ref,copropiedad,unidad,sedi_numero,datos)')
    .eq('empresa_id', empresaId).in('estado', ['pendiente', 'en_proceso', 'error']).order('creado_en', { ascending: true }).limit(200);
  const filas = data || [];
  const nCor = await contarCorreosPendientesSedi(supabase, empresaId);
  el.innerHTML = `${cabecera(ctx, filas.length + nCor)}
    <p class="v-note" style="margin-top:12px">Sedi no tiene API para escribir. Lo que se haga aquí queda en esta lista y el asistente de Chrome (con la sesión de Sedi de Felipe) lo pasa a Sedi y lo marca como hecho. También se puede marcar a mano.</p>
    ${error ? `<div class="v-error" role="alert">${escape(error.message)}</div>` : ''}
    ${filas.length === 0 ? '<div class="v-empty" style="margin-top:16px"><h3>Todo está al día con Sedi</h3></div>'
      : `<div style="display:grid;gap:10px;margin-top:14px">${filas.map((f) => { const k = f.agenda_casos || {}; return `<div class="v-card" style="padding:12px 14px;border:1px solid var(--v-line);border-radius:10px">
        <strong>${escape(ACCION[f.accion] || f.accion)}</strong> · ${escape(k.titulo || '')}
        <div class="v-muted" style="font-size:13px">${[TIPOS[k.tipo], ubicacionCaso(k), k.contrato_ref].filter(Boolean).map(escape).join(' · ')}</div>
        ${f.payload?.texto ? `<div style="margin-top:6px">${escape(f.payload.texto)}</div>` : ''}
        ${f.error ? `<div style="color:#B3261E;margin-top:6px">${escape(f.error)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="v-btn v-quiet" data-cola-hecho="${f.id}">Marcar hecho</button><button type="button" class="v-btn v-quiet" data-cola-omitir="${f.id}">Omitir</button></div></div>`; }).join('')}</div>`}
    <div id="cor-sedi"></div>`;
  enlazarCabecera(ctx);
  pintarPendientesSedi(el.querySelector('#cor-sedi'), ctx, () => renderCasos(ctx));
  el.querySelectorAll('[data-cola-hecho],[data-cola-omitir]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.colaHecho || b.dataset.colaOmitir;
      const { error: e } = await supabase.rpc('agenda_sedi_marcar', { p_id: id, p_estado: b.dataset.colaHecho ? 'hecho' : 'omitido' });
      if (e) ui.mensaje = e.message;
      renderCasos(ctx);
    };
  });
}
