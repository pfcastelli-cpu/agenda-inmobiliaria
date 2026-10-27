// Configuración → Radicación: datos de la aseguradora para el estudio de arrendatario, por ciudad (sql/033).
// La fila «Predeterminada» se usa en las ciudades sin configuración propia (ej.: Medellín usa la póliza de Bogotá).
// El texto de «Pasos» es editable: una línea = un paso numerado en el correo y en la página /radicar.
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null ? null : Number(v));

const CAMPOS_TEXTO = [
  ['aseguradora', 'Aseguradora', 'Libertador'],
  ['link_natural', 'Enlace del estudio · persona natural', 'https://…'],
  ['link_juridica', 'Enlace del estudio · persona jurídica', 'https://… (si lo dejas vacío, no se muestra el botón)'],
  ['nombre_inmobiliaria', 'Nombre de la inmobiliaria ante la aseguradora', 'Vacío = el nombre comercial'],
  ['codigo_inmobiliaria', 'Código de la inmobiliaria', 'Ej. 1478'],
  ['poliza', 'Número de póliza', 'Ej. 14221'],
  ['asesor_nombre', 'Asesor de respaldo (solo si la cita no tiene asesor)', 'Normalmente se usa el asesor que atendió al cliente'],
  ['asesor_correo', 'Correo del asesor de respaldo', 'asesor@…'],
];

function formFila(f, nombre) {
  const c = (k) => esc(f[k] ?? '');
  return `<form class="ad-form" data-rad-form data-id="${esc(f.id || '')}" data-ciudad="${esc(f.ciudad_id || '')}" style="margin:0 0 18px;padding:14px;border:1px solid #e5e7eb;border-radius:14px">
  <h3 style="margin-top:0">${esc(nombre)}${f.aseguradora && f.id ? ' · ' + esc(f.aseguradora) : ''}${f.id ? '' : ' <small class="ad-muted">(sin configurar)</small>'}</h3>
  <div class="ad-grid">${CAMPOS_TEXTO.map(([k, t, ph]) => `<label>${t}<input name="${k}" value="${c(k)}" placeholder="${esc(ph)}" autocomplete="off"></label>`).join('')}
   <label>Costo del estudio (% del canon)<input name="costo_porcentaje" type="number" min="0" max="100" step="0.1" value="${c('costo_porcentaje')}" placeholder="Ej. 15"></label>
   <label>Costo fijo en pesos (opcional)<input name="costo_valor" type="number" min="0" step="1000" value="${c('costo_valor')}" placeholder="Vacío = se calcula con el %"></label>
   <label class="ad-check"><input type="checkbox" name="costo_iva" ${f.costo_iva === false ? '' : 'checked'}> El costo es «+ IVA»</label>
  </div>
  <label style="display:block;margin-top:8px">Nota sobre costos y pago<textarea name="costo_nota" rows="2" style="width:100%">${c('costo_nota')}</textarea></label>
  <label style="display:block;margin-top:8px">Pasos (una línea por paso; aparecen numerados en el correo y en la página)<textarea name="instrucciones" rows="6" style="width:100%">${c('instrucciones')}</textarea></label>
  <button type="submit" style="margin-top:10px">Guardar ${esc(nombre)}</button>
  ${f.id ? '<button type="button" class="ad-link-btn" data-rad-borrar style="color:#B3261E;margin:10px 0 0 12px">Quitar esta aseguradora</button>' : ''}
</form>`;
}

// ctx = { el, empresaId, config, aviso(texto, error?), vigente() }
export async function radicacionTab(ctx) {
  const { el, empresaId, config, aviso, vigente } = ctx;
  el.innerHTML = '<p class="ad-muted">Cargando…</p>';
  const [{ data: filas, error }, { data: ciudades }] = await Promise.all([
    supabase.from('agenda_radicacion_config').select('*').eq('empresa_id', empresaId),
    supabase.from('agenda_ciudades').select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
  ]);
  if (!vigente()) return;
  if (error) { el.innerHTML = '<p class="error">No se pudo leer la configuración. Aplica primero el SQL 033.</p>'; return; }
  const filasDe = (ciudadId) => (filas || []).filter((f) => (f.ciudad_id || null) === ciudadId).sort((x, y) => (x.orden || 0) - (y.orden || 0));
  const bloquesDe = (ciudadId, nombre) => {
    const propias = filasDe(ciudadId);
    const formularios = propias.length ? propias.map((f) => formFila(f, nombre)) : [formFila({ empresa_id: empresaId, ciudad_id: ciudadId }, nombre)];
    return `<div data-rad-grupo>${formularios.join('')}<button type="button" class="ad-link-btn" data-rad-agregar="${esc(ciudadId || '')}" data-rad-nombre="${esc(nombre)}" style="margin:-6px 0 18px">＋ Agregar otra aseguradora para ${esc(nombre)}</button></div>`;
  };
  const bloques = [bloquesDe(null, 'Predeterminada (ciudades sin datos propios)'), ...(ciudades || []).map((c) => bloquesDe(c.id, c.nombre))];
  el.innerHTML = `<h2>Radicación del estudio de arrendatario</h2>
 <p>Cuando un cliente dice en la encuesta que <strong>quiere avanzar</strong>, recibe un correo con el enlace del estudio (persona natural o jurídica), los datos de la póliza listos para copiar, los pasos y los costos. Al asesor le llega un aviso para que esté pendiente. <strong>El asesor que va en el formulario es siempre el que atendió al cliente</strong> (nombre y correo de su ficha); el «asesor de respaldo» solo se usa si la cita no tiene asesor. Los demás datos cambian por ciudad: la que no tenga fila propia usa la «Predeterminada». Si trabajas con varias aseguradoras, agrega una por ciudad y el cliente verá todas.</p>
 <label class="ad-check"><input type="checkbox" id="rad-activa" ${config.radicacion_activa ? 'checked' : ''}> Enviar el correo automáticamente cuando el cliente elija «quiero avanzar»</label>
 <p class="ad-note">También puedes enviarlo a mano desde cada cita. Mientras el modo de pruebas del correo esté activo, todo llega a la dirección de pruebas.</p>
 <div style="margin-top:14px">${bloques.join('')}</div>`;

  el.querySelector('#rad-activa').onchange = async (e) => {
    const { error: err } = await supabase.from('agenda_configuracion').update({ radicacion_activa: e.target.checked }).eq('empresa_id', empresaId);
    if (err) { aviso('No se pudo guardar. ¿Ya se aplicó el SQL 033?', true); e.target.checked = !e.target.checked; return; }
    config.radicacion_activa = e.target.checked;
    aviso(e.target.checked ? 'Radicación automática activada.' : 'Radicación automática apagada.');
  };
  el.querySelectorAll('[data-rad-agregar]').forEach((btn) => {
    btn.onclick = () => {
      const tmp = document.createElement('div');
      tmp.innerHTML = formFila({ empresa_id: empresaId, ciudad_id: btn.dataset.radAgregar || null, aseguradora: '' }, btn.dataset.radNombre);
      const nuevo = tmp.firstElementChild;
      btn.before(nuevo);
      cablear(nuevo);
      nuevo.scrollIntoView({ block: 'center' });
    };
  });
  const cablear = (form) => {
    const b = form.querySelector('[data-rad-borrar]');
    if (b) b.onclick = async () => {
      if (!confirm('¿Quitar esta aseguradora de la configuración? Los clientes dejarán de verla en los correos nuevos.')) return;
      const { error: err } = await supabase.from('agenda_radicacion_config').delete().eq('id', form.dataset.id);
      if (err) { aviso('No se pudo quitar: ' + (err.message || ''), true); return; }
      aviso('Aseguradora quitada.');
      await radicacionTab(ctx);
    };
    form.onsubmit = guardar(form);
  };
  const guardar = (form) => async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = {
        empresa_id: empresaId, ciudad_id: form.dataset.ciudad || null,
        costo_porcentaje: num(f.costo_porcentaje.value), costo_valor: num(f.costo_valor.value), costo_iva: f.costo_iva.checked,
        costo_nota: f.costo_nota.value.trim(), instrucciones: f.instrucciones.value.trim(), actualizado_en: new Date().toISOString(),
      };
      for (const [k] of CAMPOS_TEXTO) v[k] = f[k].value.trim() || (k === 'aseguradora' ? 'Libertador' : null);
      for (const k of ['link_natural', 'link_juridica']) if (v[k] && !/^https:\/\/\S+$/i.test(v[k])) { aviso('El enlace debe empezar por https://', true); return; }
      const b = f.querySelector('button[type=submit]');
      b.disabled = true;
      const { error: err } = form.dataset.id
        ? await supabase.from('agenda_radicacion_config').update(v).eq('id', form.dataset.id)
        : await supabase.from('agenda_radicacion_config').insert(v);
      b.disabled = false;
      if (err) { aviso(err.code === '23505' ? 'Ya hay una aseguradora con ese nombre en esta ciudad: escribe otro nombre.' : 'No se pudo guardar: ' + (err.message || ''), true); return; }
      aviso('Radicación guardada.');
      await radicacionTab(ctx);
  };
  el.querySelectorAll('[data-rad-form]').forEach(cablear);
}
