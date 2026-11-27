// Panel «Comunicaciones» de la ficha de una terminación: cartas al arrendatario y aviso al propietario.
// Flujo: botón sugerido → carta redactada (editable por párrafos) → revisión → envío con confirmación → historial con copia exacta.
// El envío real lo hace la función del servidor `enviar-comunicacion-caso` (pendiente de construir): ella manda el correo desde
// solicitudes@, resuelve el nombre real del destinatario, y guarda la fila en agenda_casos_comunicaciones. Esta pantalla nunca
// tiene correos ni nombres de clientes. Mientras el modo de pruebas esté activo, todo correo va solo a la dirección de pruebas.
import { PLANTILLAS, borrador, cartaHTML } from './casos-cartas.js';
import { revisarTexto } from './casos-informes.js';
import { clasificarTerminacion } from './casos-inmuebles.js';
import { ubicacionCaso } from './casos-direcciones.js';

const ROL = { arrendatario: 'el arrendatario', propietario: 'el propietario' };
const DECISION = { pendiente: ['Esperando respuesta', '#8F5500', '#FFF4DF'], acepta: ['Autorizó', '#0B7A75', '#E3F4F3'], rechaza: ['No autorizó', '#9B1C1C', '#FCE8E8'], sin_respuesta: ['Sin respuesta', '#4F5B6C', '#EEF1F5'] };
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const hoy = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const insignia = (t, fg, bg) => `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;color:${fg};background:${bg}">${t}</span>`;

export async function cargarComunicaciones(supabase, casoId) {
  const { data } = await supabase.from('agenda_casos_comunicaciones').select('*').eq('caso_id', casoId).order('creado_en', { ascending: false });
  return data || [];
}

const datosCarta = (caso) => {
  const d = caso.datos || {};
  return { inmueble: ubicacionCaso(caso) || '[inmueble]', fechaAviso: d.fecha_aviso, fechaEntrega: d.fecha_entrega, fechaVencimiento: d.fecha_vencimiento, clasificacion: clasificarTerminacion(d).clave };
};
const sugerida = (caso) => ({ segura: 'entrega_a_tiempo', acuerdo: 'entrega_a_tiempo', extemporanea: 'renovado_820' }[clasificarTerminacion(caso.datos || {}).clave] || null);
const enviadas = (rows, pl) => rows.filter((r) => r.estado === 'enviada' && r.plantilla === pl);

function queFalta(rows, caso) {
  const arr = rows.filter((r) => r.estado === 'enviada' && r.destinatario === 'arrendatario');
  const prop = enviadas(rows, 'aviso_propietario');
  if (!arr.length && !prop.length) return { icono: '•', texto: sugerida(caso) ? 'Aún no se ha enviado nada en este caso.' : 'Complete las fechas del caso para sugerir la carta correcta.', tono: '#1A2C45', fondo: '#E6ECF5' };
  if (arr.length && !prop.length) return { icono: '⚠', texto: `Carta enviada al arrendatario el ${fechaHora(arr[0].enviada_en)}. Falta avisar al propietario.`, tono: '#8F5500', fondo: '#FFF4DF' };
  if (!arr.length) return { icono: '⚠', texto: 'Se avisó al propietario, pero falta enviar la carta al arrendatario.', tono: '#8F5500', fondo: '#FFF4DF' };
  const dec = prop[0].propietario_decision || 'pendiente';
  return { icono: dec === 'acepta' ? '✔' : '•', texto: `Todo enviado. Propietario: ${DECISION[dec][0].toLowerCase()}.`, tono: DECISION[dec][1], fondo: DECISION[dec][2] };
}

export function panelHTML(caso, rows, st, escape, modoPruebas = true) {
  const falta = queFalta(rows, caso); const sug = sugerida(caso);
  const boton = (clave, principal) => {
    const p = PLANTILLAS[clave]; const ya = enviadas(rows, clave)[0];
    return `<div style="flex:1;min-width:210px"><button type="button" class="v-btn ${principal ? 'v-primary' : 'v-quiet'}" style="width:100%;min-height:48px" data-com-abrir="${clave}">${ya ? 'Ya enviada · ' + fechaHora(ya.enviada_en) : escape(p.boton)}</button><div class="v-muted" style="font-size:12px;margin-top:4px">Va ${ROL[p.destinatario].replace('el ', 'al ')} · ${escape(p.ayuda)}</div></div>`;
  };
  const botones = Object.keys(PLANTILLAS).map((k) => boton(k, k === sug || (k === 'aviso_propietario' && !sug))).join('');
  return `<div class="v-card" id="com-panel" style="margin-top:12px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
    <h3>Comunicaciones</h3>
    <div role="status" style="margin:8px 0;padding:10px 12px;border-radius:10px;background:${falta.fondo};color:${falta.tono};font-weight:600">${falta.icono} ${escape(falta.texto)}</div>
    <div id="com-aviso" role="status" style="font-weight:600;color:#0B7A75">${st.aviso ? escape(st.aviso) : ''}</div>
    ${modoPruebas ? '<div style="margin:6px 0;padding:6px 10px;border-radius:8px;background:#FFF1D6;color:#7A4B00;font-size:13px"><strong>Modo de pruebas:</strong> nada llega a clientes; todo va a la dirección de pruebas.</div>' : ''}
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">${botones}</div>
    ${st.clave ? editorHTML(caso, st, escape) : ''}
    <h4 style="margin:18px 0 6px">Historial</h4>
    ${rows.length ? `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">${rows.map((r) => {
      const dec = r.plantilla === 'aviso_propietario' && r.estado === 'enviada' ? insignia(...[DECISION[r.propietario_decision || 'pendiente'][0], DECISION[r.propietario_decision || 'pendiente'][1], DECISION[r.propietario_decision || 'pendiente'][2]]) : '';
      const est = r.estado === 'prueba' ? insignia('Prueba', '#1A2C45', '#E6ECF5') : r.estado === 'borrador' ? insignia('Borrador', '#4F5B6C', '#EEF1F5') : insignia('Enviada', '#0B7A75', '#E3F4F3');
      return `<li style="border:1px solid var(--v-line);border-radius:10px;padding:10px 12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><strong>${escape(PLANTILLAS[r.plantilla]?.boton || r.plantilla)}</strong>${est}${dec}</div>
        <div class="v-muted" style="font-size:13px;margin-top:4px">Para ${ROL[r.destinatario] || r.destinatario}${r.correo_mascara ? ' (' + escape(r.correo_mascara) + ')' : ''} · ${escape(fechaHora(r.enviada_en || r.creado_en))}</div>
        <details style="margin-top:6px"><summary style="cursor:pointer;min-height:32px">Ver copia exacta del correo</summary><div class="v-note" style="margin:6px 0">Copia de lo que se envió. No se puede editar.</div><iframe sandbox="allow-same-origin" title="Copia del correo enviado" srcdoc="${escape(r.cuerpo_html)}" style="width:100%;height:520px;border:1px solid var(--v-line);border-radius:10px;background:#fff"></iframe></details></li>`;
    }).join('')}</ul>` : '<p class="v-muted">Aún no se ha enviado nada en este caso.</p>'}
  </div>`;
}

function armar(caso, st) {
  const c = { clave: st.clave, destinatario: PLANTILLAS[st.clave].destinatario, asunto: st.asunto, secciones: st.secciones };
  const dest = c.destinatario;
  return cartaHTML(c, { saludo: dest === 'propietario' ? 'Estimado(a) propietario(a)' : 'Estimado(a) arrendatario(a)', inmueble: datosCarta(caso).inmueble, fechaCarta: hoy(), enlaces: dest === 'propietario' ? { acepta: '#', hablar: '#', rechaza: '#' } : null, contacto: {} }, { base: (typeof location !== 'undefined' ? location.origin : '') + '/' }); // dirección absoluta: sirve en el correo real y en la vista aislada
}

function revisar(st) {
  const texto = [st.asunto, ...st.secciones.filter((s) => s.activa !== false).map((s) => s.texto)].join('\n\n');
  const probs = revisarTexto(texto, 'carta');
  const huecos = [...new Set((texto.match(/\[[^\]\n]{1,30}\]/g) || []))];
  if (huecos.length) probs.unshift({ tipo: 'datos', bloquea: true, mensaje: 'Faltan datos por completar en el texto: ' + huecos.join(', ') + '. Complételos en el caso o escríbalos aquí.', fragmento: '' });
  return probs;
}

function editorHTML(caso, st, escape) {
  const p = PLANTILLAS[st.clave]; const probs = revisar(st);
  const bloq = probs.filter((x) => x.bloquea); const avisos = probs.filter((x) => !x.bloquea);
  const NOM = { ortografia: 'Ortografía', redaccion: 'Redacción', juridico: 'Jurídico', datos: 'Datos', tono: 'Tono' };
  const motivo = bloq.length ? 'Corrija lo marcado «debe corregirse».' : (avisos.length && !st.forzar ? 'Hay avisos: corríjalos o marque «enviar de todos modos».' : '');
  const ya = enviadas(st.rows || [], st.clave)[0];
  return `<div id="com-editor" style="margin-top:14px;border-top:2px solid var(--v-line);padding-top:12px">
    <h4 style="margin:0 0 4px">${escape(p.boton)}</h4><p class="v-note">Va ${ROL[p.destinatario].replace('el ', 'al ')}. Puede cambiar cualquier párrafo; apague los opcionales si no los quiere.</p>
    ${ya ? `<div class="v-error" role="alert" style="margin:8px 0">Esta carta ya se envió el ${escape(fechaHora(ya.enviada_en))}. Si la envía de nuevo, quedará como recordatorio ligado a la anterior.</div>` : ''}
    <label class="v-field">Asunto del correo<input id="com-asunto" class="v-input" value="${escape(st.asunto)}" maxlength="200"></label>
    <div style="display:grid;gap:10px;margin-top:10px">${st.secciones.map((s, i) => `<div style="border:1px solid var(--v-line);border-radius:10px;padding:10px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong style="font-size:14px">${escape(s.titulo)}</strong>${s.opcional ? `<label style="display:flex;gap:6px;align-items:center;min-height:32px"><input type="checkbox" data-com-activa="${i}" ${s.activa !== false ? 'checked' : ''}> Incluir este párrafo</label>` : ''}</div>
      <textarea class="v-input" data-com-texto="${i}" rows="4" style="width:100%;min-height:100px;margin-top:6px;font-size:16px" ${s.activa === false ? 'disabled' : ''}>${escape(s.texto)}</textarea></div>`).join('')}</div>
    <div class="v-note" style="margin-top:12px"><strong>Revisión de los textos</strong></div>
    <div id="com-rev" aria-live="polite" style="display:grid;gap:6px;margin-top:6px">${probs.length ? probs.map((x) => `<div style="font-size:13px;border-radius:8px;padding:8px 10px;background:${x.bloquea ? '#FDECEA' : '#FFF1D6'};color:${x.bloquea ? '#8A1C14' : '#7A4B00'}"><strong>${NOM[x.tipo]}${x.bloquea ? ' (debe corregirse)' : ' (aviso)'}:</strong> ${escape(x.mensaje)}${x.fragmento ? ` <em>(«${escape(x.fragmento)}»)</em>` : ''}</div>`).join('') : '<div style="font-size:13px;border-radius:8px;padding:8px 10px;background:#E3F5F2;color:#0B5E5A">La revisión básica no encontró alertas. No reemplaza la revisión de una persona.</div>'}</div>
    <details style="margin-top:12px" open><summary style="cursor:pointer;min-height:36px;font-weight:600">Vista previa del correo</summary><iframe sandbox="allow-same-origin" title="Vista previa de la carta" srcdoc="${escape(armar(caso, st))}" style="width:100%;height:560px;border:1px solid var(--v-line);border-radius:10px;background:#fff;margin-top:6px"></iframe></details>
    ${avisos.length && !bloq.length ? `<label style="display:flex;gap:8px;align-items:center;margin-top:10px;min-height:40px"><input type="checkbox" id="com-forzar" ${st.forzar ? 'checked' : ''}> Entiendo los avisos y quiero enviar de todos modos</label>` : ''}
    <p id="com-motivo" role="status" style="color:#8A1C14;font-size:13px;margin:8px 0 0">${escape(motivo)}</p>
    <div id="com-confirmar" style="margin-top:6px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="v-btn v-quiet" id="com-prueba" style="min-height:48px" ${bloq.length ? 'disabled' : ''}>Enviarme una prueba</button><button type="button" class="v-btn v-primary" id="com-enviar" style="min-height:48px" ${motivo ? 'disabled' : ''}>Enviar ${p.destinatario === 'propietario' ? 'al propietario' : 'al arrendatario'}</button><button type="button" class="v-btn v-quiet" id="com-cerrar" style="min-height:48px">Cerrar</button></div>
    <div id="com-msg" role="status" class="v-note" style="margin-top:8px"></div></div>`;
}

/** Estado de la pantalla (por caso abierto). */
export const nuevoEstado = () => ({ clave: null, asunto: '', secciones: [], forzar: false, enviando: false, rows: [] });

/** Pinta el panel dentro de `host` y lo mantiene vivo. Al escribir solo se repinta el panel (sin ir al servidor) y se conserva el cursor.
 *  alEnviar(): se llama después de un envío correcto para recargar el historial. */
export function montarPanel(host, ctx, caso, rows, st, alEnviar) {
  const repintar = () => {
    const a = document.activeElement; const clave = a && host.contains(a) ? (a.id ? '#' + a.id : a.dataset?.comTexto != null ? `[data-com-texto="${a.dataset.comTexto}"]` : null) : null;
    const sel = clave && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    host.innerHTML = panelHTML(caso, rows, st, ctx.escape, ctx.modoPruebas !== false);
    enlazar(host, ctx, caso, rows, st, repintar, alEnviar);
    if (clave) { const n = host.querySelector(clave); if (n) { n.focus(); if (sel && n.setSelectionRange) n.setSelectionRange(sel[0], sel[1]); } }
  };
  repintar();
}

function enlazar(el, ctx, caso, rows, st, repintar, alEnviar) {
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-com-abrir]').forEach((b) => {
    b.onclick = () => { const b0 = borrador(b.dataset.comAbrir, datosCarta(caso)); Object.assign(st, { clave: b0.clave, asunto: b0.asunto, secciones: b0.secciones, forzar: false, rows }); repintar(); };
  });
  if (st.aviso && !st.clave) { const a = $('#com-aviso'); if (a) a.textContent = st.aviso; delete st.aviso; }
  if (!st.clave) return;
  st.rows = rows;
  const leer = () => { st.asunto = $('#com-asunto').value; el.querySelectorAll('[data-com-texto]').forEach((t) => { st.secciones[+t.dataset.comTexto].texto = t.value; }); };
  let t; const diferido = () => { clearTimeout(t); t = setTimeout(() => { leer(); repintar(true); }, 600); };
  $('#com-asunto').oninput = diferido;
  el.querySelectorAll('[data-com-texto]').forEach((x) => { x.oninput = diferido; });
  el.querySelectorAll('[data-com-activa]').forEach((x) => { x.onchange = () => { leer(); st.secciones[+x.dataset.comActiva].activa = x.checked; repintar(true); }; });
  if ($('#com-forzar')) $('#com-forzar').onchange = (e) => { st.forzar = e.target.checked; repintar(true); };
  $('#com-cerrar').onclick = () => { Object.assign(st, nuevoEstado()); repintar(); };
  const msg = (m) => { $('#com-msg').textContent = m; };
  const enviar = async (modo) => {
    leer(); if (st.enviando) return; st.enviando = true;
    const p = PLANTILLAS[st.clave]; const ya = enviadas(rows, st.clave)[0];
    const body = { caso_id: caso.id, plantilla: st.clave, destinatario: p.destinatario, modo, asunto: ya && modo === 'real' ? 'Recordatorio: ' + st.asunto : st.asunto, cuerpo_html: armar(caso, st), ligada_a: ya && modo === 'real' ? ya.id : null };
    for (const id of ['#com-enviar', '#com-prueba']) $(id).disabled = true; msg('Enviando…');
    const inv = ctx.supabase.functions?.invoke;
    if (!inv) { st.enviando = false; for (const id of ['#com-enviar', '#com-prueba']) $(id).disabled = false; return msg('El envío todavía no está conectado en esta pantalla. La carta no se envió.'); }
    const { error } = await ctx.supabase.functions.invoke('enviar-comunicacion-caso', { body });
    st.enviando = false;
    if (error) { for (const id of ['#com-enviar', '#com-prueba']) $(id).disabled = false; return msg('No se pudo enviar: ' + (error.message || 'error desconocido') + '. Nada quedó enviado.'); }
    Object.assign(st, nuevoEstado()); st.aviso = modo === 'prueba' ? 'Prueba enviada a la dirección de pruebas.' : 'Carta enviada y registrada en el historial.'; alEnviar();
  };
  $('#com-prueba').onclick = () => enviar('prueba');
  $('#com-enviar').onclick = () => {
    const p = PLANTILLAS[st.clave];
    $('#com-confirmar').innerHTML = `<div style="border:2px solid #1A2C45;border-radius:10px;padding:10px 12px"><strong>Se enviará ${p.destinatario === 'propietario' ? 'al PROPIETARIO' : 'al ARRENDATARIO'}.</strong> ¿Confirma?<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="v-btn v-primary" id="com-si" style="min-height:44px">Sí, enviar</button><button type="button" class="v-btn v-quiet" id="com-no" style="min-height:44px">Cancelar</button></div></div>`;
    $('#com-si').onclick = () => enviar('real'); $('#com-no').onclick = () => { $('#com-confirmar').innerHTML = ''; };
  };
  if (st.aviso) { msg(st.aviso); delete st.aviso; }
}
