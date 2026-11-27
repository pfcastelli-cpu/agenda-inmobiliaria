// Vista «panorama» de Casos: terminaciones y asambleas con barra de filtros, resumen y tarjetas agrupadas por mes.
// Filtros (recomendación de usabilidad): atajos de tiempo + selector de mes con flechas + ciudad / quién pide / estado.
import { cargarDirecciones, dirInmueble, ubicacionCaso } from './casos-direcciones.js';
// Solo pinta HTML a partir de las filas que trae casos-inmuebles.js. No guarda nada ni usa datos personales.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const AZUL = '#1A2C45'; const ROJO = '#B3261E'; const AMBAR = '#B26A00'; const VERDE = '#0B7A75'; const GRIS = '#586780';

export const claveMes = (iso) => (iso ? iso.slice(0, 7) : 'sin-fecha');
export const rotuloMes = (k) => (k === 'sin-fecha' ? 'Sin fecha' : `${MESES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`);
const sumarMes = (k, n) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fecha = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const diaSemana = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long' }) : '');
const meses = (a, b) => (Date.parse(b) - Date.parse(a)) / (86400000 * 30.4375);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Estado inicial de los filtros (lo guarda casos-inmuebles.js para que no se pierda al abrir un caso y volver). */
export const filtrosIniciales = () => ({ atajo: 'todos', mes: '', ciudad: '', quien: '', estado: '' });

/** Fecha que ordena y agrupa cada tipo de caso. */
export function fechaClave(c) {
  const d = c.datos || {};
  if (c.tipo === 'terminacion') return d.fecha_entrega || c.fecha_limite || null;
  if (c.tipo === 'asamblea') return d.fecha_asamblea || null;
  if (c.tipo === 'mantenimiento') return d.fin_obra || d.inicio_obra || null;
  return c.fecha_limite || null;
}

const CAMPOS = {
  terminacion: { quien: ['Quién pide', (c) => c.datos?.solicitante], estado: ['Estado de la solicitud', (c) => c.datos?.estado_solicitud], tercero: ['Ciudad', (c) => c.datos?.ciudad] },
  asamblea: { quien: ['Clase', (c) => c.datos?.tipo_asamblea], estado: ['Modalidad', (c) => c.datos?.modalidad], tercero: ['Ciudad', (c) => c.datos?.ciudad] },
  mantenimiento: { quien: ['Estado', (c) => c.datos?.estado_sedi], estado: ['Cotización', (c) => c.datos?.cotizacion], tercero: ['Responsable del pago', (c) => c.datos?.paga] },
};
const ciudadDe = (c) => CAMPOS[c.tipo]?.tercero[1](c);

/** «Vencido» = fecha ya pasada y el caso sigue pendiente (una asamblea realizada no cuenta). */
const pendiente = (c) => !c.cerrado_en && !['realizada', 'cerrada', 'descartado'].includes(c.estado);
const vencido = (c, hoy) => { const f = fechaClave(c); return !!f && f < hoy && pendiente(c); };

const ATAJOS = [['todos', 'Todos'], ['este_mes', 'Este mes'], ['prox_mes', 'Próximo mes'], ['30', 'Próximos 30 días'], ['vencidos', 'Vencidos'], ['sin_fecha', 'Sin fecha']];
const NOMBRE_ATAJO = Object.fromEntries(ATAJOS);

function pasaTiempo(c, f, hoy) {
  const fc = fechaClave(c); const k = claveMes(fc);
  switch (f.atajo) {
    case 'este_mes': return k === claveMes(hoy);
    case 'prox_mes': return k === sumarMes(claveMes(hoy), 1);
    case '30': return !!fc && fc >= hoy && fc <= sumarDias(hoy, 30);
    case 'vencidos': return vencido(c, hoy);
    case 'sin_fecha': return !fc;
    case 'mes': return k === f.mes;
    default: return true;
  }
}
/** Aplica todos los filtros menos el indicado (para contar las opciones de cada lista sin dejarlas en cero por sorpresa). */
function aplicar(lista, f, tipo, hoy, omitir = '') {
  const C = CAMPOS[tipo];
  return lista.filter((c) => (omitir === 'tiempo' || pasaTiempo(c, f, hoy))
    && (omitir === 'ciudad' || !f.ciudad || ciudadDe(c) === f.ciudad)
    && (omitir === 'quien' || !f.quien || C.quien[1](c) === f.quien)
    && (omitir === 'estado' || !f.estado || C.estado[1](c) === f.estado));
}

const insignia = (texto, color, escape) => `<span style="display:inline-block;font-size:12px;font-weight:600;color:${color};background:${color}1A;border-radius:999px;padding:2px 9px">${escape(texto)}</span>`;

function barras(titulo, cuentas, color, escape) {
  const total = Object.values(cuentas).reduce((a, b) => a + b, 0) || 1;
  const filas = Object.entries(cuentas).sort((a, b) => b[1] - a[1]).map(([k, n]) => `
    <div style="display:grid;grid-template-columns:minmax(110px,40%) 1fr 28px;gap:8px;align-items:center;font-size:13px;margin-top:6px">
      <span>${escape(k)}</span>
      <span style="background:${color}22;border-radius:6px;height:10px;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(6, Math.round((n / total) * 100))}%;background:${color}"></span></span>
      <strong style="text-align:right">${n}</strong></div>`).join('');
  return `<div class="v-card" style="padding:12px 14px;border:1px solid var(--v-line);border-radius:12px"><h4 style="margin:0;font-size:14px">${escape(titulo)}</h4>${filas || '<p class="v-muted" style="font-size:13px;margin:6px 0 0">Sin datos</p>'}</div>`;
}
const contar = (lista, fn) => lista.reduce((acc, c) => { const k = fn(c); if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {});

/** Color solo por urgencia (y siempre con texto): rojo vencido, ámbar en 30 días o menos, azul el resto, gris lo ya realizado. */
function urgencia(c, hoy) {
  const fc = fechaClave(c);
  if (!pendiente(c)) return { color: GRIS, texto: fc ? `hace ${Math.max(0, dias(fc, hoy))} día(s)` : '' };
  if (!fc) return { color: GRIS, texto: '' };
  const n = dias(hoy, fc);
  if (n < 0) return { color: ROJO, texto: `Vencido hace ${-n} día(s)` };
  if (n === 0) return { color: ROJO, texto: 'Hoy' };
  if (n <= 30) return { color: AMBAR, texto: `en ${n} día(s)` };
  return { color: AZUL, texto: `en ${n} día(s)` };
}

function tarjeta(c, hoy, escape) {
  const d = c.datos || {};
  const u = urgencia(c, hoy);
  const fin = fechaClave(c);
  const etiquetas = [];
  let titulo;
  if (c.tipo === 'terminacion') {
    titulo = ubicacionCaso(c) || 'Terminación';
    if (d.fecha_aviso && d.fecha_entrega) {
      const m = meses(d.fecha_aviso, d.fecha_entrega);
      etiquetas.push(m >= 3 ? insignia(`Aviso con ${Math.floor(m)} meses de anticipación`, VERDE, escape) : insignia(`Aviso con solo ${m < 1 ? dias(d.fecha_aviso, d.fecha_entrega) + ' días' : m.toFixed(1).replace('.', ',') + ' meses'} (menos de 3)`, ROJO, escape));
    }
    if (d.solicitante) etiquetas.push(insignia(`Lo pide: ${d.solicitante.toLowerCase()}`, AZUL, escape));
    if (d.estado_solicitud) etiquetas.push(insignia(d.estado_solicitud, d.estado_solicitud.startsWith('Env') ? AMBAR : GRIS, escape));
  } else if (c.tipo === 'mantenimiento') {
    titulo = c.titulo;
    const col = { inicial: GRIS, sin_cotizacion: AMBAR, pendiente_cotizar: '#7A4FBF', cotizado: '#0277BD', propietario: '#7A4FBF', en_ejecucion: VERDE, en_encuesta: VERDE }[c.estado] || GRIS;
    etiquetas.push(insignia(d.estado_sedi || c.estado, col, escape));
    etiquetas.push(insignia(`Cotización: ${(d.cotizacion || 'Pendiente').toLowerCase()}`, d.cotizacion === 'Cotizado' ? VERDE : AMBAR, escape));
    if (d.paga && d.paga !== 'Sin definir') etiquetas.push(insignia(`Paga: ${d.paga.toLowerCase()}`, AZUL, escape));
    else etiquetas.push(insignia('Falta definir quién paga', ROJO, escape));
    etiquetas.push(insignia(d.informe_a ? `Informe para: ${d.informe_a}` : 'Informe: falta decidir a quién se envía', d.informe_a ? VERDE : GRIS, escape));
  } else {
    titulo = c.copropiedad || c.titulo;
    if (d.tipo_asamblea) etiquetas.push(insignia(d.tipo_asamblea, AZUL, escape));
    if (d.modalidad && d.modalidad !== 'Por confirmar') etiquetas.push(insignia(d.modalidad, '#0277BD', escape));
    etiquetas.push(d.propietario_avisado === 'si' ? insignia('Propietario avisado', VERDE, escape) : d.propietario_avisado === 'no' ? insignia('Falta avisar al propietario', ROJO, escape) : insignia('Aviso por confirmar', GRIS, escape));
    if (d.poder) etiquetas.push(insignia(d.poder, AMBAR, escape));
  }
  const cuando = fin ? `${diaSemana(fin)} ${fecha(fin)}${d.hora ? ', ' + escape(d.hora) : ''}` : 'Fecha por confirmar';
  return `<button type="button" class="v-card" data-caso-abrir="${c.id}" style="text-align:left;width:100%;padding:12px 14px;border:1px solid var(--v-line);border-left:6px solid ${u.color};border-radius:10px;background:var(--v-surface,#fff);cursor:pointer">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${escape(titulo)}</strong><span style="font-size:13px;font-weight:600;color:${u.color}">${cuando}${u.texto ? ` · ${escape(u.texto)}` : ''}</span></div>
    <div class="v-muted" style="font-size:13px;margin-top:3px">${(c.tipo === 'terminacion' ? [] : [ubicacionCaso(c)]).filter(Boolean).map(escape).join(' · ') || (c.tipo === 'terminacion' ? '' : 'Sin inmueble indicado')}${c.contrato_ref ? ' · ' + escape(c.contrato_ref) : ''}${d.ciudad ? ' · ' + escape(d.ciudad) : ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${etiquetas.join('')}</div>
    ${d.nota ? `<div style="font-size:13px;margin-top:8px">${escape(d.nota)}</div>` : ''}
  </button>`;
}

const select = (id, rotulo, valor, opciones, escape) => `<label class="v-field" style="min-width:150px">${escape(rotulo)}<select id="${id}" class="v-input"><option value="">Todos</option>${opciones.map(([v, n]) => `<option value="${escape(v)}" ${valor === v ? 'selected' : ''}>${escape(v)} (${n})</option>`).join('')}</select></label>`;
const opcionesDe = (lista, fn) => Object.entries(contar(lista, fn)).sort((a, b) => a[0].localeCompare(b[0], 'es'));

/**
 * @param {'terminacion'|'asamblea'} tipo
 * @param {Array} filas casos ya filtrados por texto y abiertos/todos
 * @param {object} f filtros (ver filtrosIniciales)
 * @returns {string} HTML
 */
export function panorama(tipo, filas, f, escape, hoy) {
  const C = CAMPOS[tipo];
  const lista = aplicar(filas, f, tipo, hoy);
  const mesActual = claveMes(hoy);
  const mesesConCasos = contar(filas.filter((c) => fechaClave(c)), (c) => claveMes(fechaClave(c)));
  const claveSel = f.atajo === 'mes' ? f.mes : '';

  // --- Barra de filtros ---
  const conteoAtajo = (a) => aplicar(filas, { ...f, atajo: a, mes: '' }, tipo, hoy).length;
  const atajos = ATAJOS.map(([a, t]) => `<button type="button" data-caso-atajo="${a}" aria-pressed="${f.atajo === a}" style="cursor:pointer;min-height:40px;border:1.5px solid ${AZUL};border-radius:999px;padding:6px 13px;font:inherit;font-size:13px;font-weight:600;white-space:nowrap;${f.atajo === a ? `background:${AZUL};color:#fff` : `background:#fff;color:${AZUL}`}">${t}${a === 'todos' ? '' : ` · ${conteoAtajo(a)}`}</button>`).join('');
  const opcionesMes = [...new Set([...Object.keys(mesesConCasos), ...(claveSel ? [claveSel] : [])])].sort();
  const selMes = `<div role="group" aria-label="Elegir un mes" style="display:flex;gap:6px;align-items:flex-end">
      <button type="button" class="v-btn" data-caso-mes-paso="-1" aria-label="Mes anterior" style="min-height:40px">‹</button>
      <label class="v-field" style="min-width:170px">Mes<select id="caso-f-mes" class="v-input"><option value="">— Elegir —</option>${opcionesMes.map((k) => `<option value="${k}" ${claveSel === k ? 'selected' : ''}>${escape(rotuloMes(k))} (${mesesConCasos[k] || 0})</option>`).join('')}</select></label>
      <button type="button" class="v-btn" data-caso-mes-paso="1" aria-label="Mes siguiente" style="min-height:40px">›</button></div>`;
  const hayFiltro = f.atajo !== 'todos' || f.ciudad || f.quien || f.estado;
  const masAbierto = typeof window === 'undefined' || window.innerWidth >= 700 || f.ciudad || f.quien || f.estado;
  const secundarios = `<details ${masAbierto ? 'open' : ''} style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;font-weight:600;color:${AZUL};min-height:32px">Más filtros${f.ciudad || f.quien || f.estado ? ' (activos)' : ''}</summary>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
        ${select('caso-f-ciudad', C.tercero[0], f.ciudad, opcionesDe(aplicar(filas, f, tipo, hoy, 'ciudad'), ciudadDe), escape)}
        ${select('caso-f-quien', C.quien[0], f.quien, opcionesDe(aplicar(filas, f, tipo, hoy, 'quien'), C.quien[1]), escape)}
        ${select('caso-f-estado', C.estado[0], f.estado, opcionesDe(aplicar(filas, f, tipo, hoy, 'estado'), C.estado[1]), escape)}</div></details>`;
  const etiqueta = (t, clave) => `<button type="button" data-caso-quitar="${clave}" aria-label="Quitar filtro ${escape(t)}" style="cursor:pointer;border:1px solid ${AZUL}55;background:${AZUL}12;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;color:${AZUL}">${escape(t)} ✕</button>`;
  const activos = [
    f.atajo !== 'todos' ? etiqueta(f.atajo === 'mes' ? rotuloMes(f.mes) : NOMBRE_ATAJO[f.atajo], 'atajo') : '',
    f.ciudad ? etiqueta(f.ciudad, 'ciudad') : '', f.quien ? etiqueta(f.quien, 'quien') : '', f.estado ? etiqueta(f.estado, 'estado') : '',
  ].filter(Boolean);
  const barra = `<div role="search" aria-label="Filtros" style="margin-top:14px">
      <div style="display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px" role="group" aria-label="Atajos de tiempo">${atajos}</div>
      ${selMes}${secundarios}
      <div aria-live="polite" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:13px"><strong>${lista.length} de ${filas.length} casos</strong>${activos.join('')}${hayFiltro ? `<button type="button" data-caso-limpiar class="v-btn" style="min-height:32px;padding:2px 10px">Limpiar filtros</button>` : ''}</div></div>`;

  // --- Resumen (refleja el filtro) ---
  const cortas = lista.filter((c) => c.datos?.fecha_aviso && c.datos?.fecha_entrega && meses(c.datos.fecha_aviso, c.datos.fecha_entrega) < 3).length;
  const cuadros = (tipo === 'mantenimiento'
    ? [['Casos de mantenimiento', lista.length, AZUL], ['Falta definir quién paga', lista.filter((c) => !c.datos?.paga || c.datos.paga === 'Sin definir').length, ROJO], ['Esperando al propietario', lista.filter((c) => c.datos?.estado_sedi === 'Esperando al propietario').length, AMBAR], ['Sin cotizar', lista.filter((c) => (c.datos?.cotizacion || 'Pendiente') === 'Pendiente').length, '#7A4FBF']]
    : tipo === 'terminacion'
    ? [['Terminaciones', lista.length, AZUL], ['Aviso con menos de 3 meses', cortas, ROJO], ['Con propuesta enviada', lista.filter((c) => (c.datos?.estado_solicitud || '').startsWith('Env')).length, AMBAR], ['Pide el propietario', lista.filter((c) => c.datos?.solicitante === 'Propietario').length, '#7A4FBF']]
    : [['Asambleas', lista.length, AZUL], ['Próximas', lista.filter((c) => pendiente(c) && fechaClave(c) && fechaClave(c) >= hoy).length, VERDE], ['Falta avisar al propietario', lista.filter((c) => c.datos?.propietario_avisado === 'no').length, ROJO], ['Fecha por confirmar', lista.filter((c) => !fechaClave(c)).length, GRIS]])
    .map(([t, n, col]) => `<div style="border:1px solid ${col}55;background:${col}0F;border-radius:12px;padding:10px 14px;min-width:130px"><div style="font-size:26px;font-weight:700;color:${col}">${n}</div><div style="font-size:13px">${t}</div></div>`).join('');
  const resumen = `<p class="v-muted" style="margin:14px 0 0;font-size:13px">Resumen de: ${activos.length ? escape([f.atajo !== 'todos' ? (f.atajo === 'mes' ? rotuloMes(f.mes) : NOMBRE_ATAJO[f.atajo]) : '', f.ciudad, f.quien, f.estado].filter(Boolean).join(' · ')) : 'todos los casos'}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">${cuadros}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px">
      ${barras(C.quien[0], contar(lista, C.quien[1]), AZUL, escape)}${barras(C.estado[0], contar(lista, C.estado[1]), AMBAR, escape)}${barras(C.tercero[0], contar(lista, ciudadDe), '#00A9A5', escape)}</div>`;

  // --- Lista ---
  let cuerpo;
  if (!filas.length) cuerpo = `<div class="v-empty" style="margin-top:16px"><h3>Todavía no hay casos de este tipo</h3></div>`;
  else if (!lista.length) {
    const cercano = f.atajo === 'mes' ? Object.keys(mesesConCasos).sort((a, b) => Math.abs(dias(f.mes + '-15', a + '-15')) - Math.abs(dias(f.mes + '-15', b + '-15')))[0] : null;
    cuerpo = `<div class="v-empty" style="margin-top:16px"><h3>No hay casos con estos filtros</h3>${f.atajo === 'mes' ? `<p>No hay casos en ${escape(rotuloMes(f.mes))}.${cercano ? ` <button type="button" class="v-btn" data-caso-ir-mes="${cercano}">Ver ${escape(rotuloMes(cercano))}</button>` : ''}</p>` : ''}<button type="button" class="v-btn" data-caso-limpiar>Quitar filtros</button></div>`;
  } else {
    const porMes = {};
    lista.forEach((c) => { const k = claveMes(fechaClave(c)); (porMes[k] ||= []).push(c); });
    const ord = (a, b) => (fechaClave(a) || '9').localeCompare(fechaClave(b) || '9');
    if (f.atajo === 'mes' || Object.keys(porMes).length === 1) cuerpo = `<div style="display:grid;gap:10px;margin-top:14px">${lista.slice().sort(ord).map((c) => tarjeta(c, hoy, escape)).join('')}</div>`;
    else {
      const claves = Object.keys(porMes);
      const proximos = claves.filter((k) => k !== 'sin-fecha' && k >= mesActual).sort();
      const pasados = claves.filter((k) => k !== 'sin-fecha' && k < mesActual).sort().reverse();
      cuerpo = [...proximos, ...pasados, ...(porMes['sin-fecha'] ? ['sin-fecha'] : [])].map((k) => {
        const abierto = k === 'sin-fecha' || k >= mesActual;
        return `<details ${abierto ? 'open' : ''} style="margin-top:16px"><summary style="cursor:pointer;font-weight:700;font-size:17px;color:${AZUL};text-transform:capitalize;min-height:36px">${escape(rotuloMes(k))} <span style="font-size:13px;font-weight:500;color:var(--v-muted)">(${porMes[k].length})${k < mesActual && k !== 'sin-fecha' ? ' · ya pasó' : ''}</span></summary>
          <div style="display:grid;gap:10px;margin-top:8px">${porMes[k].sort(ord).map((c) => tarjeta(c, hoy, escape)).join('')}</div></details>`;
      }).join('');
    }
  }
  return `${barra}${filas.length ? resumen : ''}${cuerpo}`;
}

/** Conecta los controles del panorama. `cambio()` vuelve a pintar la pantalla. */
export function enlazarPanorama(el, f, hoy, cambio) {
  const ir = (cambios) => { Object.assign(f, cambios); cambio(); };
  el.querySelectorAll('[data-caso-atajo]').forEach((b) => { b.onclick = () => ir({ atajo: b.dataset.casoAtajo, mes: '' }); });
  const sel = el.querySelector('#caso-f-mes');
  if (sel) sel.onchange = () => ir(sel.value ? { atajo: 'mes', mes: sel.value } : { atajo: 'todos', mes: '' });
  el.querySelectorAll('[data-caso-mes-paso]').forEach((b) => { b.onclick = () => { const base = f.atajo === 'mes' && f.mes ? f.mes : claveMes(hoy); ir({ atajo: 'mes', mes: sumarMes(base, +b.dataset.casoMesPaso) }); }; });
  el.querySelectorAll('[data-caso-ir-mes]').forEach((b) => { b.onclick = () => ir({ atajo: 'mes', mes: b.dataset.casoIrMes }); });
  [['caso-f-ciudad', 'ciudad'], ['caso-f-quien', 'quien'], ['caso-f-estado', 'estado']].forEach(([id, k]) => { const s = el.querySelector('#' + id); if (s) s.onchange = () => ir({ [k]: s.value }); });
  el.querySelectorAll('[data-caso-quitar]').forEach((b) => { b.onclick = () => ir(b.dataset.casoQuitar === 'atajo' ? { atajo: 'todos', mes: '' } : { [b.dataset.casoQuitar]: '' }); });
  el.querySelectorAll('[data-caso-limpiar]').forEach((b) => { b.onclick = () => ir(filtrosIniciales()); });
}
