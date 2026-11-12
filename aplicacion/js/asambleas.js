// Pantalla «Asambleas»: citaciones a asambleas de copropiedad detectadas en los correos (exportación JSON/CSV de la hoja del vigilante).
// Solo lectura: los datos se quedan en la memoria de esta pestaña. Se pinta dentro de la agenda (menú Inmuebles) o en asambleas-ensayo.html.
const $ = (selector) => document.querySelector(selector);

const state = { rows: [], filtered: [] };

const aliases = {
  hilo: ['HILO GMAIL', 'hilo_id', 'thread_id'],
  buzon: ['BUZON', 'correo_buzon'],
  ids: ['IDS MENSAJES', 'message_ids'],
  principal: ['MENSAJE PRINCIPAL', 'message_id'],
  de: ['DE', 'correo_de', 'from'],
  recibido: ['FECHA RECIBIDO', 'correo_recibido_en', 'date'],
  asunto: ['ASUNTO', 'subject'],
  cuerpo: ['CUERPO TEXTO', 'cuerpo_texto', 'body'],
  html: ['CORREO HTML', 'correo_html'],
  adjuntos: ['ADJUNTOS', 'attachments'],
  esCitacion: ['ES CITACION', 'es_citacion_asamblea'],
  tipo: ['TIPO', 'tipo'],
  copropiedad: ['COPROPIEDAD', 'copropiedad', 'conjunto'],
  fecha: ['FECHA ASAMBLEA', 'fecha_asamblea'],
  hora: ['HORA', 'hora'],
  lugar: ['LUGAR O ENLACE', 'lugar_enlace', 'lugar'],
  modalidad: ['MODALIDAD', 'modalidad'],
  limite: ['FECHA LIMITE PODERES', 'fecha_limite_poderes'],
  inmueble: ['INMUEBLE TEXTO', 'inmueble', 'numero_inmueble'],
  confianza: ['CONFIANZA', 'confianza'],
  json: ['JSON GEMINI', 'json_gemini'],
  estado: ['ESTADO ENVIO', 'estado'],
  drivePdf: ['PDF DRIVE URL', 'pdf_drive_url'],
  driveAdjuntos: ['ADJUNTOS DRIVE URL', 'adjuntos_drive_url'],
  driveCorreo: ['CORREO DRIVE URL', 'correo_drive_url'],
  propietarios: ['PROPIETARIOS', 'propietarios'],
  notas: ['NOTAS', 'notas']
};

function text(value) { return value == null ? '' : String(value).trim(); }
function pick(row, names) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate));
  return key ? row[key] : '';
}
function normalize(row) {
  const result = {};
  for (const [key, names] of Object.entries(aliases)) result[key] = text(pick(row, names));
  result.raw = row;
  return result;
}
function yes(value) { return /^(sí|si|yes|true|1|citaci[oó]n)$/i.test(text(value)); }
function dateValue(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date; }
function formatDate(value, withTime = false) {
  const date = dateValue(value);
  if (!date) return text(value) || 'No disponible';
  return new Intl.DateTimeFormat('es-CO', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' }).format(date);
}
function escapeHtml(value) { return text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function links(value, label) { return text(value) ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${label}</a>` : ''; }

function parseCsv(source) {
  const records = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i], next = source[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((item) => text(item))) records.push(row); row = [];
    } else cell += char;
  }
  row.push(cell); if (row.some((item) => text(item))) records.push(row);
  const headers = (records.shift() || []).map((item) => text(item).replace(/^\uFEFF/, ''));
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function readRows(source, name) {
  if (/\.json$/i.test(name) || source.trim().startsWith('[')) {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.rows) ? parsed.rows : []);
  }
  return parseCsv(source);
}

function isUpcoming(row) {
  const date = dateValue(`${row.fecha}T${row.hora || '23:59'}`);
  if (!date) return false;
  const days = (date - new Date()) / 86400000;
  return days >= 0 && days < 7 && !/avisad/i.test(row.estado);
}
function groupMonth(row) {
  const date = dateValue(row.fecha) || dateValue(row.recibido);
  return date ? new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(date) : 'Fecha no determinada';
}
function data(label, value) { return `<div><dt>${label}</dt><dd>${escapeHtml(value || 'No disponible')}</dd></div>`; }

function renderMetrics() {
  const rows = state.rows;
  const metrics = [
    ['Conversaciones', rows.length],
    ['Citaciones', rows.filter((row) => yes(row.esCitacion)).length],
    ['No citaciones', rows.filter((row) => row.esCitacion && !yes(row.esCitacion)).length],
    ['Sin asociar', rows.filter((row) => !row.inmueble).length],
    ['Con adjuntos', rows.filter((row) => row.adjuntos).length],
    ['Con PDF en Drive', rows.filter((row) => row.drivePdf).length]
  ];
  $('#ae-metrics').innerHTML = metrics.map(([label, value]) => `<div class="ae-metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
}

function matches(row) {
  const filter = $('#ae-filtro').value;
  const search = $('#ae-busqueda').value.toLowerCase();
  const haystack = [row.copropiedad, row.inmueble, row.asunto, row.de].join(' ').toLowerCase();
  const from = $('#ae-desde').value, to = $('#ae-hasta').value;
  const date = (dateValue(row.fecha) || dateValue(row.recibido));
  const dateIso = date ? date.toISOString().slice(0, 10) : '';
  if (filter === 'citaciones' && !yes(row.esCitacion)) return false;
  if (filter === 'no-citaciones' && (!row.esCitacion || yes(row.esCitacion))) return false;
  if (filter === 'indeterminadas' && row.esCitacion) return false;
  if (filter === 'sin-asociar' && row.inmueble) return false;
  if (filter === 'adjuntos' && !row.adjuntos) return false;
  if (filter === 'pdf' && !row.drivePdf) return false;
  if (search && !haystack.includes(search)) return false;
  if (from && (!dateIso || dateIso < from)) return false;
  if (to && (!dateIso || dateIso > to)) return false;
  return true;
}

function renderCard(row, index) {
  const tags = [];
  if (yes(row.esCitacion)) tags.push('<span class="ae-tag">Citación</span>');
  if (isUpcoming(row)) tags.push('<span class="ae-tag ae-tag-warn">En menos de 7 días</span>');
  if (!row.inmueble) tags.push('<span class="ae-tag ae-tag-warn">Sin inmueble asociado</span>');
  const notice = row.estado ? `Aviso: ${row.estado}` : 'Aviso al propietario: no registrado';
  const driveLinks = [links(row.drivePdf, 'PDF de la convocatoria'), links(row.driveAdjuntos, 'Adjuntos en Drive'), links(row.driveCorreo, 'Correo en Drive')].filter(Boolean).join('');
  return `<article class="ae-asamblea"><div class="ae-tags">${tags.join('')}</div><h3>${escapeHtml(row.copropiedad || 'Conjunto no determinado')}</h3><dl class="ae-data">${data('Asamblea', `${formatDate(row.fecha)}${row.hora ? ` · ${row.hora}` : ''}`)}${data('Inmueble', row.inmueble)}${data('Propietario(s)', row.propietarios)}${data('Modalidad', row.modalidad || row.lugar)}${data('Correo recibido', formatDate(row.recibido, true))}${data('Buzón', row.buzon)}${data('Remitente', row.de)}${data('Seguimiento', notice)}</dl><div class="ae-links">${driveLinks}</div><div class="ae-actions"><button type="button" data-detail="${index}">Ver detalle y citación original</button></div></article>`;
}

function renderList() {
  state.filtered = state.rows.filter(matches).sort((a, b) => (dateValue(a.fecha) || dateValue(a.recibido) || 0) - (dateValue(b.fecha) || dateValue(b.recibido) || 0));
  $('#ae-resultados').textContent = `${state.filtered.length} de ${state.rows.length} conversaciones`; const groups = new Map();
  state.filtered.forEach((row) => { const key = groupMonth(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
  $('#ae-lista').innerHTML = [...groups.entries()].map(([month, rows]) => `<section><h2 class="ae-mes">${escapeHtml(month)}</h2><div class="ae-card-list">${rows.map((row) => renderCard(row, state.rows.indexOf(row))).join('')}</div></section>`).join('') || '<div class="ae-empty ae-card"><h2>No hay coincidencias</h2><p>Prueba otros filtros.</p></div>';
  document.querySelectorAll('[data-detail]').forEach((button) => button.addEventListener('click', () => showDetail(state.rows[Number(button.dataset.detail)])));
}

function showDetail(row) {
  $('#ae-detalle-titulo').textContent = row.asunto || row.copropiedad || 'Detalle de la conversación';
  $('#ae-detalle-contenido').innerHTML = `<div class="ae-timeline"><p><strong>Recibido:</strong> ${escapeHtml(formatDate(row.recibido, true))}</p><p><strong>De:</strong> ${escapeHtml(row.de || 'No disponible')}<br><strong>Buzón:</strong> ${escapeHtml(row.buzon || 'No disponible')}</p><p><strong>Mensaje principal:</strong> ${escapeHtml(row.principal || 'No disponible')}<br><strong>Mensajes relacionados:</strong> ${escapeHtml(row.ids || 'No disponible')}</p></div><dl class="ae-data">${data('Conjunto', row.copropiedad)}${data('Tipo', row.tipo)}${data('Fecha de asamblea', row.fecha)}${data('Hora', row.hora)}${data('Lugar o enlace', row.lugar)}${data('Fecha límite', row.limite)}${data('Inmueble', row.inmueble)}${data('Confianza Gemini', row.confianza)}</dl><h3>Enlaces disponibles</h3><div class="ae-links">${links(row.drivePdf, 'PDF de la convocatoria')}${links(row.driveAdjuntos, 'Adjuntos en Drive')}${links(row.driveCorreo, 'Correo en Drive') || '<span class="ae-muted">Aún no hay archivos de Drive registrados.</span>'}</div><h3>Correo original en texto</h3><div class="ae-original">${escapeHtml(row.cuerpo || 'No hay cuerpo de texto.')}</div><h3>Resultado bruto de Gemini</h3><pre class="ae-json">${escapeHtml(row.json || 'No disponible')}</pre><p class="ae-muted">Esta pantalla es de solo lectura: no guarda datos ni envía correos.</p>`;
  const dialog = $('#ae-detalle'); if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}

function resetFilters() { $('#ae-filtro').value = 'todas'; $('#ae-busqueda').value = ''; $('#ae-desde').value = ''; $('#ae-hasta').value = ''; renderList(); }
function loadRows(source, name) { state.rows = readRows(source, name).map(normalize); renderMetrics(); $('#ae-dashboard').hidden = false; $('#ae-vacio').hidden = true; $('#ae-limpiar').disabled = false; $('#ae-file-status').textContent = `${state.rows.length} conversaciones cargadas desde ${name}.`; renderList(); }


const PLANTILLA = `<div class="ae-raiz">
  <section class="ae-shell">
    <header class="ae-header">
      <div><p class="ae-eyebrow">Copropiedades</p><h1>Asambleas</h1><p class="ae-lead">Citaciones a asambleas que llegaron a los correos de la empresa, ordenadas por fecha. La lectura es automática: revisa siempre la citación original antes de avisar a un propietario.</p></div>
      <div class="ae-badge" role="status">Solo lectura</div>
    </header>
    <section class="ae-import ae-card" aria-labelledby="ae-import-title">
      <div><h2 id="ae-import-title">Cargar resultados</h2><p>Elige el archivo JSON o CSV exportado de la hoja de asambleas. Los datos se quedan en la memoria de esta pestaña y no se guardan en ningún sitio.</p></div>
      <label class="ae-file"><span>Elegir JSON o CSV</span><input id="ae-file" type="file" accept=".json,.csv,application/json,text/csv"></label>
      <button id="ae-limpiar" class="ae-btn ae-btn-quiet" type="button" disabled>Limpiar datos</button>
      <p id="ae-file-status" class="ae-status" role="status">Aún no has cargado resultados.</p>
    </section>
    <section id="ae-dashboard" hidden>
      <div class="ae-metrics" id="ae-metrics" aria-label="Resumen de resultados"></div>
      <section class="ae-toolbar ae-card" aria-label="Filtros">
        <label>Ver<select id="ae-filtro"><option value="todas">Todas</option><option value="citaciones">Citaciones</option><option value="no-citaciones">No son citaciones</option><option value="indeterminadas">Por confirmar</option><option value="sin-asociar">Sin inmueble asociado</option><option value="adjuntos">Con adjuntos</option><option value="pdf">Con PDF en Drive</option></select></label>
        <label class="ae-search">Buscar<input id="ae-busqueda" type="search" placeholder="Conjunto, inmueble, asunto o remitente"></label>
        <label>Desde<input id="ae-desde" type="date"></label><label>Hasta<input id="ae-hasta" type="date"></label>
        <button id="ae-restablecer" class="ae-btn ae-btn-quiet" type="button">Quitar filtros</button>
      </section>
      <p id="ae-resultados" class="ae-resultados" role="status"></p><div id="ae-lista" class="ae-lista"></div>
    </section>
    <section id="ae-vacio" class="ae-empty ae-card"><h2>Aún no hay asambleas cargadas</h2><p>Cuando cargues el archivo de resultados, las citaciones aparecerán aquí por mes, de la más próxima a la más lejana.</p></section>
  </section>
  <dialog id="ae-detalle" class="ae-dialog" aria-labelledby="ae-detalle-titulo"><div class="ae-dialog-head"><h2 id="ae-detalle-titulo">Detalle de la conversación</h2><button id="ae-cerrar" class="ae-close" type="button" aria-label="Cerrar detalle">×</button></div><div id="ae-detalle-contenido"></div></dialog></div>`;

export function renderAsambleas({ el }) {
  state.rows = []; state.filtered = [];
  el.innerHTML = PLANTILLA;
  $('#ae-file').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; try { loadRows(await file.text(), file.name); } catch (error) { $('#ae-file-status').textContent = `No se pudo leer el archivo: ${error.message}`; } });
  ['ae-filtro', 'ae-busqueda', 'ae-desde', 'ae-hasta'].forEach((id) => $(`#${id}`).addEventListener('input', renderList));
  $('#ae-restablecer').addEventListener('click', resetFilters);
  $('#ae-limpiar').addEventListener('click', () => { state.rows = []; state.filtered = []; $('#ae-dashboard').hidden = true; $('#ae-vacio').hidden = false; $('#ae-limpiar').disabled = true; $('#ae-file').value = ''; $('#ae-file-status').textContent = 'Aún no has cargado resultados.'; });
  $('#ae-cerrar').addEventListener('click', () => $('#ae-detalle').close());
}
