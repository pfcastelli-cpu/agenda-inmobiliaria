// Correos por INMUEBLE y CONTRATO: historial de cada arriendo (lo que llegó y salió por solicitudes@, info@ y contabilidad@).
// Los escribe el lector automático (sincronizacion/archivo-correos-inmuebles.gs, tablas de sql/124). Aquí solo se leen, se corrige a qué
// inmueble/contrato pertenecen y se marca lo ya anotado en Sedi. Se guarda resumen + enlaces (Gmail y Drive), nunca el texto completo.
import { montarLineaTiempo, eventoDeCorreo } from './casos-linea-tiempo.js';
import { rotuloInmueble } from './casos-direcciones.js';

const PARTE = { propietario: 'Propietario', arrendatario: 'Arrendatario', interno: 'Interno', otro: 'Otro' };
const lt = { caso: null, filtro: 'todo', pruebas: false, busca: '', abierto: null };
const st = { cod: '', contrato: '', tema: '' };
const TEMA = { TERMINACION: 'Terminación', ENTREGA: 'Entrega', REPARACION: 'Reparación', PQR: 'Queja (PQR)', ASAMBLEA: 'Asamblea', CAPTACION: 'Captación' };
const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '—');
const fechaHora = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', hour12: false, timeZone: 'America/Bogota' });

export function reiniciarCorreos() { st.cod = ''; st.contrato = ''; st.tema = ''; }

async function cargar(supabase, empresaId) {
  const [c, r] = await Promise.all([
    supabase.from('agenda_inmueble_correos').select('*').eq('empresa_id', empresaId).eq('estado', 'activo').order('fecha', { ascending: false }).limit(1500),
    supabase.from('agenda_inmueble_contratos_resumen').select('*').eq('empresa_id', empresaId),
  ]);
  const correos = c.data || [];
  // Nombre legible del inmueble: se toma de los casos que tengan el mismo contrato (copropiedad + unidad).
  const contratos = [...new Set(correos.map((x) => x.contrato_ref).filter(Boolean))];
  const nombres = {};
  if (contratos.length) {
    const { data } = await supabase.from('agenda_casos').select('contrato_ref,copropiedad,unidad').eq('empresa_id', empresaId).in('contrato_ref', contratos);
    (data || []).forEach((k) => { if (k.copropiedad || k.unidad) nombres[k.contrato_ref] = [k.copropiedad, k.unidad].filter(Boolean).join(' · '); });
  }
  return { correos, resumenes: r.data || [], nombres, error: c.error };
}

function inmuebles(correos, nombres) {
  const m = new Map();
  correos.filter((x) => x.inmueble_cod).forEach((x) => {
    const o = m.get(x.inmueble_cod) || { cod: x.inmueble_cod, n: 0, ultimo: x.fecha, nombre: '' };
    o.n++; if (x.fecha > o.ultimo) o.ultimo = x.fecha;
    if (!o.nombre && x.contrato_ref && nombres[x.contrato_ref]) o.nombre = nombres[x.contrato_ref];
    m.set(x.inmueble_cod, o);
  });
  return [...m.values()].sort((a, b) => b.ultimo.localeCompare(a.ultimo));
}

function tarjetaResumen(r, correos, escape) {
  const hay = (r.resumen_propietario || r.resumen_arrendatario);
  const filas = correos.filter((x) => (x.contrato_ref || 'SIN-CONTRATO') === r.contrato_ref);
  return `<div class="v-card" style="padding:14px;border:1px solid var(--v-line);border-radius:12px">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>Contrato ${escape(r.contrato_ref)}</strong><span class="v-muted" style="font-size:13px">${filas.length} correo${filas.length === 1 ? '' : 's'} · ${fechaCorta(r.primer_correo)} a ${fechaCorta(r.ultimo_correo)}</span></div>
    ${hay ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:8px">
      <div><div class="v-muted" style="font-size:12px;font-weight:700">PROPIETARIO</div><p style="margin:2px 0 0">${escape(r.resumen_propietario || 'Sin novedades registradas.')}</p></div>
      <div><div class="v-muted" style="font-size:12px;font-weight:700">ARRENDATARIO</div><p style="margin:2px 0 0">${escape(r.resumen_arrendatario || 'Sin novedades registradas.')}</p></div></div>`
      : '<p class="v-muted" style="margin:6px 0 0">El resumen se genera solo cuando llegan más correos.</p>'}
  </div>`;
}

export async function pintarCorreos(ctx, cabecera, enlazar) {
  const { el, supabase, empresaId, escape } = ctx;
  const { correos, resumenes, nombres, error } = await cargar(supabase, empresaId);
  const lista = inmuebles(correos, nombres);
  const porAsignar = correos.filter((x) => !x.inmueble_cod);
  if (st.cod && st.cod !== '__por_asignar' && !lista.some((i) => i.cod === st.cod)) st.cod = '';
  if (!st.cod && lista.length) st.cod = lista[0].cod;
  const opciones = lista.map((i) => `<option value="${escape(i.cod)}" ${st.cod === i.cod ? 'selected' : ''}>${escape(rotuloInmueble(i.cod))}${i.nombre ? ' · ' + escape(i.nombre) : ''} (${i.n})</option>`).join('')
    + (porAsignar.length ? `<option value="__por_asignar" ${st.cod === '__por_asignar' ? 'selected' : ''}>Por asignar (${porAsignar.length})</option>` : '');

  let cuerpo;
  if (error) cuerpo = `<div class="v-empty" style="margin-top:16px"><h3>Esta función todavía no está activada</h3><p style="margin-top:8px">Aún no se está leyendo ningún correo: falta crear las tablas en la base de datos (SQL 124) e instalar el lector en Google. Cuando eso se haga, aquí aparecerá el historial de cada inmueble. <span class="v-muted">(Detalle técnico: ${escape(error.message)})</span></p></div>`;
  else if (!correos.length) cuerpo = '<div class="v-empty" style="margin-top:16px"><h3>Aún no hay correos archivados</h3><p style="margin-top:8px">Todavía no ha llegado ninguno: el lector solo trabaja una vez instalado, y entonces tarda unos minutos en traer los primeros.</p></div>';
  else if (st.cod === '__por_asignar') cuerpo = htmlPorAsignar(porAsignar, escape);
  else {
    const delInmueble = correos.filter((x) => x.inmueble_cod === st.cod);
    const cts = [...new Set(delInmueble.map((x) => x.contrato_ref || 'SIN-CONTRATO'))];
    if (st.contrato && !cts.includes(st.contrato)) st.contrato = '';
    const chips = [['', `Todos los contratos (${delInmueble.length})`], ...cts.map((c) => [c, `${c === 'SIN-CONTRATO' ? 'Sin contrato' : c} (${delInmueble.filter((x) => (x.contrato_ref || 'SIN-CONTRATO') === c).length})`])]
      .map(([v, t]) => `<button type="button" class="v-btn ${st.contrato === v ? 'v-primary' : 'v-quiet'}" data-cor-contrato="${escape(v)}">${escape(t)}</button>`).join('');
    const temas = [...new Set(delInmueble.map((x) => x.categoria))];
    if (st.tema && !temas.includes(st.tema)) st.tema = '';
    const chipsTema = temas.length > 1 ? `<div role="group" aria-label="Tema" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${[['', 'Todos los temas'], ...temas.map((t) => [t, TEMA[t] || t])].map(([v, t]) => `<button type="button" class="v-btn ${st.tema === v ? 'v-primary' : 'v-quiet'}" data-cor-tema="${escape(v)}">${escape(t)}</button>`).join('')}</div>` : '';
    const mostrar = st.contrato ? [st.contrato] : cts;
    const tarjetas = mostrar.map((c) => resumenes.find((r) => r.inmueble_cod === st.cod && r.contrato_ref === c)
      || { inmueble_cod: st.cod, contrato_ref: c, correos: 0, primer_correo: delInmueble.at(-1)?.fecha, ultimo_correo: delInmueble[0]?.fecha }).map((r) => tarjetaResumen(r, delInmueble, escape)).join('');
    cuerpo = `<div role="group" aria-label="Contrato" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${chips}</div>${chipsTema}
      <div style="display:grid;gap:10px;margin-top:12px">${tarjetas}</div><div id="cor-lt" style="margin-top:14px"></div>`;
  }
  el.innerHTML = `${cabecera}
    <p class="v-note" style="margin-top:12px">Aquí está el historial de cada inmueble: los correos importantes que llegan y salen de solicitudes@, info@ y contabilidad@. Gemini los lee y deja solo terminaciones, entregas, reparaciones, quejas, asambleas y captaciones. Cada correo tiene una copia en Drive (con sus adjuntos) que cualquier persona de la empresa puede abrir.</p>
    ${correos.length ? `<div style="position:sticky;top:0;z-index:15;background:#1A2C45;color:#fff;padding:10px 14px;border-radius:10px;margin-top:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center"><label style="display:flex;gap:8px;align-items:center;font-weight:700">Inmueble<select id="cor-inmueble" class="v-input" style="max-width:360px">${opciones}</select></label><span style="font-size:15px"><strong>${st.cod === '__por_asignar' ? 'Correos sin inmueble' : escape(rotuloInmueble(st.cod)) + (lista.find((i) => i.cod === st.cod)?.nombre ? ' · ' + escape(lista.find((i) => i.cod === st.cod).nombre) : '')}</strong></span></div>` : ''}
    ${cuerpo}`;
  enlazar();
  const sel = el.querySelector('#cor-inmueble');
  if (sel) sel.onchange = () => { st.cod = sel.value; st.contrato = ''; pintarCorreos(ctx, cabecera, enlazar); };
  el.querySelectorAll('[data-cor-tema]').forEach((b) => { b.onclick = () => { st.tema = b.dataset.corTema; pintarCorreos(ctx, cabecera, enlazar); }; });
  el.querySelectorAll('[data-cor-contrato]').forEach((b) => { b.onclick = () => { st.contrato = b.dataset.corContrato; pintarCorreos(ctx, cabecera, enlazar); }; });
  const host = el.querySelector('#cor-lt');
  if (host) {
    const evs = correos.filter((x) => x.inmueble_cod === st.cod && (!st.contrato || (x.contrato_ref || 'SIN-CONTRATO') === st.contrato) && (!st.tema || x.categoria === st.tema)).map(eventoDeCorreo);
    lt.caso = st.cod + '|' + st.contrato;
    montarLineaTiempo(host, evs, lt, escape);
  }
  enlazarPorAsignar(ctx, () => pintarCorreos(ctx, cabecera, enlazar));
}

/* --------------------------- Correos sin inmueble ---------------------------- */
function htmlPorAsignar(filas, escape) {
  return `<p class="v-note" style="margin-top:12px">El lector no pudo saber a qué inmueble pertenecen. Escriba el N° de inmueble y el contrato, o descártelos si no importan.</p>
    <div style="display:grid;gap:10px;margin-top:12px">${filas.map((x) => `<div class="v-card" style="padding:12px 14px;border:1px solid var(--v-line);border-radius:10px">
      <div class="v-muted" style="font-size:13px">${escape(fechaHora(x.fecha))} · ${x.direccion === 'entrante' ? 'Recibido' : 'Enviado'} · ${escape(x.buzon)}</div>
      <strong>${escape(x.asunto || '(sin asunto)')}</strong><p style="margin:4px 0">${escape(x.resumen || '')}</p>
      ${x.enlace_drive ? `<a href="${escape(x.enlace_drive)}" target="_blank" rel="noopener noreferrer">Abrir el correo y sus adjuntos</a>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
        <label class="v-field">N° de inmueble<input class="v-input" data-asig-cod="${x.id}" inputmode="numeric" style="width:110px"></label>
        <label class="v-field">Contrato<input class="v-input" data-asig-ct="${x.id}" placeholder="CT-0000" style="width:130px"></label>
        <button type="button" class="v-btn v-primary" data-asig-ok="${x.id}">Asignar</button>
        <button type="button" class="v-btn v-quiet" data-asig-no="${x.id}">Descartar</button></div></div>`).join('')}</div>`;
}

function enlazarPorAsignar(ctx, repintar) {
  const { el, supabase } = ctx;
  el.querySelectorAll('[data-asig-ok]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.asigOk;
      const cod = el.querySelector(`[data-asig-cod="${id}"]`).value.trim();
      const ct = el.querySelector(`[data-asig-ct="${id}"]`).value.trim().toUpperCase();
      if (!/^\d{1,7}$/.test(cod)) { b.textContent = 'Falta el N° de inmueble'; return; }
      await supabase.from('agenda_inmueble_correos').update({ inmueble_cod: cod, contrato_ref: ct || null, asignacion: 'confirmada' }).eq('id', id);
      st.cod = cod; repintar();
    };
  });
  el.querySelectorAll('[data-asig-no]').forEach((b) => { b.onclick = async () => { await supabase.from('agenda_inmueble_correos').update({ estado: 'descartado' }).eq('id', b.dataset.asigNo); repintar(); }; });
}

/* ----------------------- Pendientes para anotar en Sedi ----------------------- */
export async function contarCorreosPendientesSedi(supabase, empresaId) {
  const { count } = await supabase.from('agenda_inmueble_correos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('estado', 'activo').eq('sedi_estado', 'pendiente').not('inmueble_cod', 'is', null);
  return count || 0;
}

export async function pintarPendientesSedi(host, ctx, repintar) {
  const { supabase, empresaId, escape } = ctx;
  const { data } = await supabase.from('agenda_inmueble_correos').select('*').eq('empresa_id', empresaId).eq('estado', 'activo').eq('sedi_estado', 'pendiente').not('inmueble_cod', 'is', null).order('fecha', { ascending: true }).limit(300);
  const filas = data || [];
  const instruccion = 'Pasa a SEDI los correos pendientes de «Casos → Sincronizar con Sedi → Correos por anotar en Sedi»: abre cada contrato, agrega el texto como seguimiento con su fecha, comprueba que quedó escrito y luego márcalo como hecho aquí. No envíes ningún correo desde SEDI.';
  host.innerHTML = `<h3 style="margin:22px 0 4px">Correos por anotar en Sedi (${filas.length})</h3>
    <p class="v-muted" style="margin:0 0 8px">Nadie tiene que acordarse: cada correo importante aparece aquí con el texto ya listo. Para pasarlos a Sedi, copie la instrucción y péguela en Claude con la sesión de Sedi abierta; él los anota y los marca como hechos.</p>
    ${filas.length === 0 ? '<div class="v-empty"><h3>No hay correos pendientes de Sedi</h3></div>' : `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button type="button" class="v-btn v-primary" id="cor-copiar-instr">Copiar instrucción para Claude</button><button type="button" class="v-btn v-quiet" id="cor-todos-hechos">Marcar todos como hechos</button><span id="cor-msg" class="v-muted" role="status"></span></div>
    <div style="display:grid;gap:10px">${filas.map((x) => `<div class="v-card" style="padding:12px 14px;border:1px solid var(--v-line);border-radius:10px">
      <div class="v-muted" style="font-size:13px">${escape(rotuloInmueble(x.inmueble_cod))} · ${escape(x.contrato_ref || 'sin contrato')} · ${escape(fechaHora(x.fecha))}</div>
      <div style="margin-top:4px">${escape(x.sedi_texto || x.resumen || '')}</div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="v-btn v-quiet" data-cor-hecho="${x.id}">Marcar hecho</button><button type="button" class="v-btn v-quiet" data-cor-omitir="${x.id}">Omitir</button></div></div>`).join('')}</div>`}`;
  const marcar = async (ids, estado) => { await supabase.from('agenda_inmueble_correos').update({ sedi_estado: estado, sedi_hecho_en: new Date().toISOString() }).in('id', ids); repintar(); };
  host.querySelectorAll('[data-cor-hecho]').forEach((b) => { b.onclick = () => marcar([b.dataset.corHecho], 'hecho'); });
  host.querySelectorAll('[data-cor-omitir]').forEach((b) => { b.onclick = () => marcar([b.dataset.corOmitir], 'omitido'); });
  const todos = host.querySelector('#cor-todos-hechos');
  if (todos) todos.onclick = () => marcar(filas.map((x) => x.id), 'hecho');
  const cp = host.querySelector('#cor-copiar-instr');
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(instruccion); host.querySelector('#cor-msg').textContent = 'Instrucción copiada. Péguela en Claude.'; } catch { host.querySelector('#cor-msg').textContent = instruccion; } };
}
