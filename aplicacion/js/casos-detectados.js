// Casos DETECTADOS por correo: el lector (archivo-correos-inmuebles.gs) guarda cada correo importante; aquí se agrupan por
// inmueble + contrato + tema y se muestran como casos "por verificar". El humano solo comprueba que esté bien.
// La verificación y los datos que completa una persona (quién asiste, si se avisó al propietario, poder) se guardan en
// agenda_casos_detectados (sql/125). Si esa tabla aún no existe, se recuerdan en el navegador (localStorage).
import { montarLineaTiempo, eventoDeCorreo, FAMILIA } from './casos-linea-tiempo.js';
import { rotuloInmueble } from './casos-direcciones.js';

const UNO = { terminacion: 'Terminación', mantenimiento: 'Mantenimiento', pqr: 'PQR', asamblea: 'Asamblea' };
const LS = 'casos_detectados_verificados';
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '');
const fechaHora = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', hour12: false, timeZone: 'America/Bogota' });
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(\s*(re|rv|fwd|fw|enc)\s*:\s*)+/i, '').replace(/[^a-z0-9]/g, '').slice(0, 60);
const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

// Estado por caso detectado: { estado: 'por_verificar' | 'verificado' | 'descartado', datos: { asistente, propietario_avisado, poder } }
let estadoDet = {};
let ctxDet = { supabase: null, empresaId: null, enBase: false, asesores: [] };
const leerLocal = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const guardarLocal = () => { try { localStorage.setItem(LS, JSON.stringify(estadoDet)); } catch { /* sin almacenamiento: no se recuerda */ } };
const estadoDe = (clave) => estadoDet[clave] || { estado: 'por_verificar', datos: {} };

/** Cambia el estado y/o los datos de un caso detectado y lo guarda (base si existe la tabla; si no, en el navegador). */
async function guardarEstado(clave, tipo, parche) {
  const ant = estadoDe(clave);
  const nuevo = { estado: parche.estado || ant.estado, datos: { ...ant.datos, ...(parche.datos || {}) } };
  estadoDet[clave] = nuevo;
  const { supabase, empresaId } = ctxDet;
  if (supabase && ctxDet.enBase) {
    const fila = { empresa_id: empresaId, clave, tipo, estado: nuevo.estado, datos: nuevo.datos, actualizado_en: new Date().toISOString(), ...(parche.estado === 'verificado' ? { verificado_en: new Date().toISOString() } : {}) };
    const { error } = await supabase.from('agenda_casos_detectados').upsert(fila, { onConflict: 'empresa_id,clave' });
    if (!error) return null;
    guardarLocal();
    return 'No se pudo guardar en la base (' + error.message + '); quedó recordado solo en este navegador.';
  }
  guardarLocal();
  return null;
}

export async function cargarCorreosEmpresa(supabase, empresaId) {
  const { data, error } = await supabase.from('agenda_inmueble_correos').select('*').eq('empresa_id', empresaId).eq('estado', 'activo').order('fecha', { ascending: true }).limit(2000);
  ctxDet = { supabase, empresaId, enBase: false, asesores: ctxDet.asesores };
  const det = await supabase.from('agenda_casos_detectados').select('*').eq('empresa_id', empresaId).limit(2000);
  estadoDet = {};
  if (!det.error && Array.isArray(det.data)) {
    ctxDet.enBase = true;
    det.data.forEach((fl) => { estadoDet[fl.clave] = { estado: fl.estado, datos: fl.datos || {} }; });
  } else {
    Object.entries(leerLocal()).forEach(([k, v]) => { estadoDet[k] = typeof v === 'string' ? { estado: v === 'ok' ? 'verificado' : 'descartado', datos: {} } : v; });
  }
  if (!ctxDet.asesores.length) {
    const a = await supabase.from('agenda_asesores').select('nombre').eq('empresa_id', empresaId).limit(200);
    ctxDet.asesores = (a.data || []).map((x) => x.nombre).filter(Boolean);
  }
  return { correos: data || [], error };
}

/* ------------------------------ Agrupar ------------------------------ */
export function agruparDetectados(correos, tipo, casosReales = []) {
  const grupos = new Map();
  for (const x of correos) {
    if (FAMILIA[x.categoria] !== tipo) continue;
    const clave = x.inmueble_cod ? `${tipo}|${x.inmueble_cod}|${x.contrato_ref || ''}` : `${tipo}|?|${norm(x.asunto)}`;
    if (!grupos.has(clave)) grupos.set(clave, { clave, tipo, cod: x.inmueble_cod || '', contrato: x.contrato_ref || '', correos: [] });
    grupos.get(clave).correos.push(x);
  }
  // Si ya existe un caso real (traído de Sedi) del mismo inmueble o contrato, sus correos aparecen en la línea de tiempo de ese caso.
  const cubierto = (g) => g.cod && casosReales.some((c) => String((c.datos || {}).n_inmueble || '') === String(g.cod) || (g.contrato && c.contrato_ref === g.contrato));
  return [...grupos.values()].filter((g) => !cubierto(g)).map(completar).sort((a, b) => b.ultimo.localeCompare(a.ultimo));
}

const ES_PODER = /poder|autoriz|representa|delega/i;
const ES_ASISTE = /asistir[aá]|representar[aá]|asistencia|delegad|asiste|nos representa/i;

function completar(g) {
  const cs = g.correos; // ya ordenados por fecha ascendente
  const prim = (f) => cs.find(f) || null;
  const texto = (x) => `${x.asunto} ${x.resumen}`;
  g.primero = cs[0].fecha; g.ultimo = cs[cs.length - 1].fecha;
  g.titulo = g.cod ? `${UNO[g.tipo]} · ${rotuloInmueble(g.cod)}${g.contrato ? ' · ' + g.contrato : ''}` : `${UNO[g.tipo]} · ${clip(cs[0].asunto.replace(/^(\s*(re|rv|fwd|fw)\s*:\s*)+/i, ''), 70)}`;
  let h = [];
  if (g.tipo === 'terminacion') {
    h = [
      ['Aviso o solicitud del arrendatario', prim((x) => x.direccion === 'entrante' && x.parte === 'arrendatario' && x.categoria === 'TERMINACION') || prim((x) => x.parte === 'arrendatario')],
      ['Aviso o comunicación al propietario', prim((x) => x.direccion === 'saliente' && x.parte === 'propietario') || prim((x) => x.parte === 'propietario')],
      ['Respuesta o decisión del propietario', prim((x) => x.direccion === 'entrante' && x.parte === 'propietario')],
      ['Entrega del inmueble', prim((x) => x.categoria === 'ENTREGA')],
    ];
  } else if (g.tipo === 'asamblea') {
    const poder = prim((x) => x.direccion === 'entrante' && ES_PODER.test(texto(x)));
    h = [
      ['Convocatoria recibida por nosotros', prim((x) => x.direccion === 'entrante' && x !== poder) || cs[0]],
      ['Convocatoria enviada al propietario', prim((x) => x.direccion === 'saliente')],
      ['Poder o autorización del propietario', poder],
      ['Quién asistirá por la empresa', prim((x) => ES_ASISTE.test(x.resumen || ''))],
    ];
  } else if (g.tipo === 'mantenimiento') {
    h = [
      ['Solicitud o aviso del daño', cs[0]],
      ['Cotización o anticipo', prim((x) => /cotiz|anticipo|presupuesto|\$/i.test(texto(x)))],
      ['Ingreso o inspección al inmueble', prim((x) => /ingreso|inspecci|visita|autorizaci/i.test(texto(x)))],
    ];
  } else {
    h = [['Queja o petición recibida', prim((x) => x.direccion === 'entrante') || cs[0]], ['Respuesta enviada', prim((x) => x.direccion === 'saliente')]];
  }
  g.hitos = h.map(([rotulo, correo]) => ({ rotulo, correo }));
  return g;
}

/** Hitos del caso mezclando lo que detectó el lector con lo que una persona marcó a mano (asistente, aviso al propietario, poder). */
function hitosEfectivos(g) {
  const d = estadoDe(g.clave).datos;
  return g.hitos.map((h) => {
    const base = { rotulo: h.rotulo, correo: h.correo, ok: !!h.correo, manual: '', no: false, nota: '' };
    if (g.tipo !== 'asamblea') return base;
    const campo = h.rotulo.startsWith('Convocatoria enviada') ? 'propietario_avisado' : h.rotulo.startsWith('Poder') ? 'poder' : h.rotulo.startsWith('Quién asistirá') ? 'asistente' : '';
    if (!campo) return base;
    if (campo === 'asistente') { if (d.asistente) { base.ok = true; base.manual = d.asistente; } return base; }
    if (d[campo] === 'si') { base.ok = true; base.manual = 'Sí'; base.nota = 'confirmado por una persona'; }
    else if (d[campo] === 'no') { base.ok = false; base.no = true; base.manual = 'No'; base.nota = 'confirmado por una persona'; }
    return base;
  });
}
const FALTA_TXT = { 'Convocatoria enviada al propietario': 'avisar al propietario', 'Poder o autorización del propietario': 'poder del propietario', 'Quién asistirá por la empresa': 'quién asistirá' };
function faltantes(g) {
  if (g.tipo !== 'asamblea') return [];
  return hitosEfectivos(g).filter((h) => !h.ok && !h.no && FALTA_TXT[h.rotulo]).map((h) => FALTA_TXT[h.rotulo]);
}

/* ------------------------- Pintar: ficha tipo tabla ------------------------- */
const CSS = `
.dt-ficha{margin-top:10px;border:1px solid #c9d3df;border-radius:12px;overflow:hidden;background:#fff}
.dt-ficha-cab{background:#1A2C45;color:#fff;padding:12px 16px;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;align-items:center}
.dt-ficha-cab h3{margin:0;font-size:18px;color:#fff}
.dt-ficha table{width:100%;border-collapse:collapse}
.dt-ficha th{width:34%;text-align:left;background:#E8EFF7;color:#1A2C45;font-size:13px;font-weight:700;padding:8px 14px;border-top:1px solid #d7dfe9;vertical-align:top}
.dt-ficha td{padding:8px 14px;border-top:1px solid #d7dfe9;font-size:15px;overflow-wrap:anywhere}
.dt-sello{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#FFF4DF;color:#8F5500}
.dt-sello.ok{background:#E3F4F3;color:#0B6661}
.dt-hitos{margin-top:12px;border:1px solid #c9d3df;border-radius:12px;overflow:hidden;background:#fff}
.dt-hitos h3{margin:0;padding:10px 16px;background:#0B7A75;color:#fff;font-size:16px}
.dt-hito{display:grid;grid-template-columns:26px 1fr auto;gap:10px;padding:10px 14px;border-top:1px solid #d7dfe9;align-items:start}
.dt-hito:first-of-type{border-top:0}
.dt-hito .dt-ic{font-size:18px;line-height:1.2}
.dt-hito small{display:block;color:#4F5B6C;font-size:13px;margin-top:2px}
.dt-falta{color:#8a94a3}
.dt-btn{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:999px;background:#1A2C45;color:#fff;font-weight:700;font-size:14px;text-decoration:none;border:0;cursor:pointer;white-space:nowrap}
.dt-btn.sec{background:#fff;color:#1A2C45;border:1px solid #1A2C45}
.dt-tarj{display:block;text-align:left;width:100%;padding:12px 14px;border:1px solid #c9d3df;border-left:6px solid #0B7A75;border-radius:10px;background:#fff;cursor:pointer;font:inherit;color:inherit}
.dt-tarj:hover{box-shadow:0 2px 10px rgba(26,44,69,.15)}
.dt-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:12px}
.dt-chip{padding:2px 9px;border-radius:999px;background:#E8EFF7;color:#1A2C45}
.dt-chip.no{background:#F1F1F1;color:#8a94a3}
.dt-tabla{width:100%;border-collapse:collapse;margin-top:6px}
.dt-tabla th{background:#E8EFF7;color:#1A2C45;text-align:left;font-size:12px;padding:6px 10px}
.dt-tabla td{padding:8px 10px;border-top:1px solid #d7dfe9;font-size:14px;vertical-align:top}
.dt-wrap{overflow-x:auto}
.dt-aviso{margin-top:10px;padding:10px 14px;border-radius:10px;background:#FFF4DF;color:#5c3a00;font-size:14px;border:1px solid #f0d9a8}
`;
function estilos() { if (document.getElementById('dt-estilos')) return; const s = document.createElement('style'); s.id = 'dt-estilos'; s.textContent = CSS; document.head.appendChild(s); }

/** Tabla de datos con encabezado de color. filas = [[rótulo, valorHtml]]. */
export function fichaHtml(titulo, sello, filas, escape) {
  estilos();
  return `<section class="dt-ficha" aria-label="Datos del caso"><div class="dt-ficha-cab"><h3>${escape(titulo)}</h3>${sello || ''}</div>
    <table><tbody>${filas.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<tr><th scope="row">${escape(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table></section>`;
}

/* ------------------------------ Lista (tarjetas) ------------------------------ */
export function htmlListaDetectados(lista, escape) {
  estilos();
  const visibles = lista.filter((g) => estadoDe(g.clave).estado !== 'descartado');
  if (!visibles.length) return '';
  return `<section aria-label="Detectados por correo" style="margin-top:16px">
    <h3 style="margin:0">Detectados por correo (${visibles.length})</h3>
    <p class="v-muted" style="margin:2px 0 8px">El lector armó estos casos solo, leyendo los correos. «Por verificar» quiere decir que nadie ha confirmado todavía que esos correos sí son de ese caso. Abra uno, mire «Qué falta» y pulse «Está bien».</p>
    <div style="display:grid;gap:10px">${visibles.map((g) => {
      const ok = estadoDe(g.clave).estado === 'verificado';
      const falta = faltantes(g);
      return `<button type="button" class="dt-tarj" data-det-abrir="${escape(g.clave)}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${escape(g.titulo)}</strong><span class="dt-sello ${ok ? 'ok' : ''}">${ok ? '✓ Verificado' : 'Por verificar'}</span></div>
        ${falta.length ? `<div style="font-size:13px;margin-top:3px;color:#8F5500">Falta: ${escape(falta.join(' · '))}</div>` : ''}
        <div class="v-muted" style="font-size:13px;margin-top:3px">${g.correos.length} correo${g.correos.length === 1 ? '' : 's'} · del ${escape(fecha(g.primero))} al ${escape(fecha(g.ultimo))}</div>
        <div class="dt-chips">${hitosEfectivos(g).map((h) => `<span class="dt-chip ${h.ok ? '' : 'no'}">${h.ok ? '✓' : h.no ? '✗' : '—'} ${escape(h.rotulo)}${h.correo ? ': ' + escape(fecha(h.correo.fecha)) : (h.manual ? ': ' + escape(h.manual) : '')}</span>`).join('')}</div></button>`;
    }).join('')}</div></section>`;
}

/* ------------------------------ Detalle ------------------------------ */
const ltDet = { caso: null, filtro: 'todo', pruebas: false, busca: '', abierto: null };

export function htmlDetalleDetectado(g, escape) {
  estilos();
  const est = estadoDe(g.clave); const d = est.datos;
  const ok = est.estado === 'verificado';
  const hef = hitosEfectivos(g); const falta = faltantes(g);
  const sello = `<span class="dt-sello ${ok ? 'ok' : ''}">${ok ? '✓ Verificado' : 'Por verificar'}</span>`;
  const f = fichaHtml(g.titulo, sello, [
    ['Tipo de caso', escape(UNO[g.tipo])],
    ['Inmueble', g.cod ? escape(rotuloInmueble(g.cod)) : '<span class="dt-falta">Sin asignar: falta saber a qué inmueble pertenece</span>'],
    ['Contrato', g.contrato ? escape(g.contrato) : '<span class="dt-falta">Sin contrato</span>'],
    ['Primer correo', escape(fecha(g.primero))],
    ['Último movimiento', escape(fecha(g.ultimo))],
    ['Correos leídos', String(g.correos.length)],
    ...(g.tipo === 'asamblea' ? [['Quién asistirá por la empresa', d.asistente ? escape(d.asistente) : '<span class="dt-falta">Sin asignar</span>']] : []),
  ], escape);
  const que = ok ? '' : `<div class="dt-aviso"><strong>¿Qué es «por verificar»?</strong> El lector armó este caso solo con los correos. Usted debe confirmar que los correos de abajo sí son de este caso${falta.length ? ' y completar lo que falta: <strong>' + escape(falta.join(', ')) + '</strong>' : ''}. Luego pulse «Está bien».</div>`;
  const completar = g.tipo === 'asamblea' ? `<section class="dt-hitos" aria-label="Completar datos"><h3 style="background:#8F5500">Complete lo que el lector no pudo saber</h3>
    <form id="det-form" style="padding:12px 14px;display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <label class="v-field">¿Quién asistirá por la empresa?<input id="det-asistente" class="v-input" list="det-asesores" maxlength="80" value="${escape(d.asistente || '')}" placeholder="Nombre de la persona"><datalist id="det-asesores">${ctxDet.asesores.map((n) => `<option value="${escape(n)}">`).join('')}</datalist></label>
      <label class="v-field">¿Se avisó al propietario?<select id="det-avisado" class="v-input">${['pendiente', 'si', 'no'].map((v) => `<option value="${v}" ${(d.propietario_avisado || 'pendiente') === v ? 'selected' : ''}>${{ pendiente: 'Pendiente / no sé', si: 'Sí', no: 'No' }[v]}</option>`).join('')}</select></label>
      <label class="v-field">¿El propietario dio poder o autorización?<select id="det-poder" class="v-input">${['pendiente', 'si', 'no'].map((v) => `<option value="${v}" ${(d.poder || 'pendiente') === v ? 'selected' : ''}>${{ pendiente: 'Pendiente / no sé', si: 'Sí', no: 'No' }[v]}</option>`).join('')}</select></label>
      <div style="grid-column:1/-1"><button type="submit" class="dt-btn">Guardar estos datos</button> <span id="det-msg" class="v-muted" role="status"></span></div>
    </form></section>` : '';
  const filasHitos = hef.map((h) => `<div class="dt-hito"><span class="dt-ic" aria-hidden="true">${h.ok ? '✅' : h.no ? '🚫' : '⬜'}</span>
      <div><strong>${escape(h.rotulo)}</strong>${h.correo ? `<small>${escape(fechaHora(h.correo.fecha))} · ${h.correo.direccion === 'entrante' ? 'Recibido de' : 'Enviado a'} ${escape(clip(h.correo.direccion === 'entrante' ? h.correo.de : h.correo.para, 50))}</small><small>${escape(clip(h.correo.resumen, 220))}</small>` : (h.manual ? `<small>${escape(h.manual)} · ${escape(h.nota || 'anotado por una persona')}</small>` : '<small class="dt-falta">No aparece en los correos leídos.</small>')}</div>
      <div>${h.correo && h.correo.enlace_drive ? `<a class="dt-btn" href="${escape(h.correo.enlace_drive)}" target="_blank" rel="noopener noreferrer">Abrir correo</a>` : ''}</div></div>`).join('');
  const tabla = `<div class="dt-wrap"><table class="dt-tabla"><thead><tr><th>Fecha</th><th>Sentido</th><th>Quién</th><th>Qué dice</th><th>Correo</th></tr></thead><tbody>${[...g.correos].reverse().map((x) => `<tr><td>${escape(fechaHora(x.fecha))}</td><td>${x.direccion === 'entrante' ? '📥 Recibido' : '📤 Enviado'}</td><td>${escape(clip(x.direccion === 'entrante' ? x.de : x.para, 40))}</td><td>${escape(clip(x.resumen, 200))}</td><td>${x.enlace_drive ? `<a href="${escape(x.enlace_drive)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  return `${f}${que}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="dt-btn" data-det-ok>✓ Está bien, verificado</button><button type="button" class="dt-btn sec" data-det-no>No es un caso, quitar</button>${ok ? '<button type="button" class="dt-btn sec" data-det-deshacer>Volver a «por verificar»</button>' : ''}</div>
    <p id="det-error" class="v-error" role="alert" hidden></p>
    <section class="dt-hitos" aria-label="Qué pasó y cuándo"><h3>Qué pasó y cuándo</h3>${filasHitos}</section>
    ${completar}
    <section class="dt-hitos" aria-label="Todos los correos"><h3 style="background:#1A2C45">Todos los correos</h3><div style="padding:6px 8px">${tabla}</div></section>
    <div id="det-linea"></div>`;
}

export function enlazarDetalleDetectado(el, g, escape, volver, repintar) {
  montarLineaTiempo(el.querySelector('#det-linea'), g.correos.map(eventoDeCorreo), Object.assign(ltDet, ltDet.caso === g.clave ? {} : { caso: g.clave, filtro: 'todo', pruebas: false, busca: '', abierto: null }), escape);
  const aviso = (m) => { const e = el.querySelector('#det-error'); if (e && m) { e.hidden = false; e.textContent = m; } };
  const ok = el.querySelector('[data-det-ok]'); if (ok) ok.onclick = async () => { aviso(await guardarEstado(g.clave, g.tipo, { estado: 'verificado' })); repintar(); };
  const no = el.querySelector('[data-det-no]'); if (no) no.onclick = async () => { aviso(await guardarEstado(g.clave, g.tipo, { estado: 'descartado' })); volver(); };
  const des = el.querySelector('[data-det-deshacer]'); if (des) des.onclick = async () => { aviso(await guardarEstado(g.clave, g.tipo, { estado: 'por_verificar' })); repintar(); };
  const form = el.querySelector('#det-form');
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault();
    const m = await guardarEstado(g.clave, g.tipo, { datos: { asistente: el.querySelector('#det-asistente').value.trim(), propietario_avisado: el.querySelector('#det-avisado').value, poder: el.querySelector('#det-poder').value } });
    if (m) return aviso(m);
    repintar();
  };
}
