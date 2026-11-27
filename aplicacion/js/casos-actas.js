// Acta de entrega de una terminación: alerta al asesor, subida del archivo y cierre del caso en un solo paso.
// El archivo se sube a un depósito privado (casos-actas); el lector (archivo-correos-inmuebles.gs) lo copia a la carpeta de Drive
// del inmueble y deja el enlace en el caso. Subir el acta cierra la terminación (quién recibió y el cobro los confirma el asesor aquí mismo).
import { RECIBE, COBRO, cobroSugerido, faltaParaCerrar } from './casos-cierre.js';

const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const fechaCo = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
const TIPOS_OK = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_MB = 20;

export async function cargarActas(supabase, casoId) {
  const { data } = await supabase.from('agenda_casos_actas').select('*').eq('caso_id', casoId).order('creado_en', { ascending: false });
  return data || [];
}

/** Alerta según la fecha de entrega: {nivel: 'roja'|'amarilla'|'gris', texto} o null si ya hay acta. */
export function alertaActa(d, actas) {
  if (d.acta_entrega === 'si' || actas.length) return null;
  const f = d.fecha_entrega_real || d.fecha_entrega;
  if (!f) return { nivel: 'gris', texto: 'Cuando entreguen el inmueble, suba aquí el acta de entrega: con eso se cierra el caso.' };
  const faltan = dias(f, hoyBogota());
  if (faltan < 0) return { nivel: 'roja', texto: `La entrega era el ${fechaCo(f)} (hace ${-faltan} día${faltan === -1 ? '' : 's'}) y todavía no hay acta de entrega. Suba el acta para cerrar el caso.` };
  if (faltan <= 7) return { nivel: 'amarilla', texto: faltan === 0 ? `La entrega es hoy (${fechaCo(f)}). Al terminar, suba el acta de entrega.` : `La entrega es el ${fechaCo(f)} (en ${faltan} día${faltan === 1 ? '' : 's'}). Prepare el acta: cuando la tenga, súbala aquí.` };
  return { nivel: 'gris', texto: `La entrega está prevista para el ${fechaCo(f)}. Cuando se haga, suba el acta de entrega aquí.` };
}

const COLOR = { roja: ['#FDE8E8', '#8A1C1C', '#E6A3A3'], amarilla: ['#FFF4DF', '#5c3a00', '#f0d9a8'], gris: ['#E8EFF7', '#1A2C45', '#c9d3df'] };

export function htmlPanelActa(c, d, actas, clave, escape) {
  const al = alertaActa(d, actas);
  const op = (m, actual) => Object.entries(m).map(([k, t]) => `<option value="${k}" ${actual === k ? 'selected' : ''}>${escape(t)}</option>`).join('');
  const lista = actas.length ? `<ul style="margin:8px 0 0;padding-left:18px">${actas.map((a) => `<li>${escape(a.nombre)} · ${escape(fechaCo(a.creado_en))} · ${a.drive_url ? `<a href="${escape(a.drive_url)}" target="_blank" rel="noopener noreferrer">Abrir en Drive</a>` : a.drive_estado === 'error' ? '<span class="v-error">no se pudo copiar a Drive</span>' : '<span class="v-muted">se copiará a Drive en unos minutos</span>'}</li>`).join('')}</ul>` : '';
  const hecho = c.cerrado_en || d.acta_entrega === 'si';
  return `<section class="v-card" id="panel-acta" style="margin-top:12px;padding:16px;border:1px solid #c9d3df;border-radius:12px" aria-label="Acta de entrega">
    <h3 style="margin:0">Acta de entrega</h3>
    ${al ? `<div role="alert" style="margin-top:8px;padding:10px 14px;border-radius:10px;background:${COLOR[al.nivel][0]};color:${COLOR[al.nivel][1]};border:1px solid ${COLOR[al.nivel][2]};font-weight:600">${al.nivel === 'roja' ? '⚠ ' : al.nivel === 'amarilla' ? '⏰ ' : 'ℹ '}${escape(al.texto)}</div>` : ''}
    ${lista}
    ${hecho ? '' : `<form id="acta-form" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      <label class="v-field" style="grid-column:1/-1">Archivo del acta (PDF, foto o Word, máx. ${MAX_MB} MB)<input id="acta-archivo" class="v-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx" required></label>
      <label class="v-field">Fecha real de entrega<input id="acta-fecha" class="v-input" type="date" value="${escape(d.fecha_entrega_real || (d.fecha_entrega && d.fecha_entrega <= hoyBogota() ? d.fecha_entrega : hoyBogota()))}" max="${hoyBogota()}" required></label>
      <label class="v-field">¿Quién recibió el inmueble?<select id="acta-recibe" class="v-input" required><option value="">— elegir —</option>${op(RECIBE, d.recibe_inmueble)}</select></label>
      <label class="v-field">Cobro por terminación anticipada<select id="acta-cobro" class="v-input">${op(COBRO, d.cobro_terminacion || cobroSugerido(clave || '').valor)}</select></label>
      <p class="v-note" style="grid-column:1/-1;margin:0">Al subir el acta el caso se cierra y se anota en Sedi. Si hay indemnización o cobro por terminación anticipada, decídalo antes: no se cierra con «Pendiente de decidir». El archivo queda guardado también en Drive, en la carpeta del inmueble.</p>
      <div style="grid-column:1/-1"><button class="v-btn v-primary" type="submit">Subir acta y cerrar el caso</button> <span id="acta-msg" class="v-muted" role="status"></span></div>
    </form>`}
  </section>`;
}

export function enlazarPanelActa(el, ctx, c, d, listo) {
  const form = el.querySelector('#acta-form');
  if (!form) return;
  const msg = el.querySelector('#acta-msg');
  const error = (m) => { msg.className = 'v-error'; msg.textContent = m; };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const archivo = el.querySelector('#acta-archivo').files[0];
    const recibe = el.querySelector('#acta-recibe').value, cobro = el.querySelector('#acta-cobro').value, fecha = el.querySelector('#acta-fecha').value;
    if (!archivo) return error('Elija el archivo del acta.');
    if (!TIPOS_OK.includes(archivo.type) && !/\.(pdf|png|jpe?g|webp|docx)$/i.test(archivo.name)) return error('Solo se aceptan PDF, fotos o Word (.docx).');
    if (archivo.size > MAX_MB * 1048576) return error(`El archivo pesa más de ${MAX_MB} MB.`);
    const datos = { ...d, fecha_entrega_real: fecha, acta_entrega: 'si', recibe_inmueble: recibe, cobro_terminacion: cobro };
    const falta = faltaParaCerrar(datos);
    if (falta) return error(falta);
    msg.className = 'v-muted'; msg.textContent = 'Subiendo el acta…';
    form.querySelector('button').disabled = true;
    const limpio = archivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    const ruta = `${c.empresa_id}/${c.id}/${Date.now()}-${limpio}`;
    const sub = await ctx.supabase.storage.from('casos-actas').upload(ruta, archivo, { contentType: archivo.type || 'application/octet-stream', upsert: false });
    if (sub.error) { form.querySelector('button').disabled = false; return error('No se pudo subir el archivo: ' + sub.error.message); }
    const ins = await ctx.supabase.from('agenda_casos_actas').insert({ caso_id: c.id, empresa_id: c.empresa_id, nombre: archivo.name.slice(0, 200), ruta });
    if (ins.error) { form.querySelector('button').disabled = false; return error('El archivo subió, pero no se pudo registrar: ' + ins.error.message); }
    const cerr = await ctx.supabase.from('agenda_casos').update({ datos, estado: 'cerrado', cerrado_en: new Date().toISOString() }).eq('id', c.id);
    if (cerr.error) { form.querySelector('button').disabled = false; return error('Se guardó el acta, pero no se pudo cerrar el caso: ' + cerr.error.message); }
    listo('Acta subida y caso cerrado. En unos minutos se copia a Drive y queda anotado en Sedi.');
  };
}
