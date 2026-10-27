// Configuración → Supervisión: (1) a quién le llegan las alertas de calificación baja, (2) registro de llegada con ubicación,
// (3) tablero de citas dudosas por asesor. El cálculo vive en la base (agenda_supervision_resumen, sql/031); aquí solo se muestra.
// Una señal es un indicio para conversar y revisar, nunca una prueba: el tablero lo dice y no ordena «culpables».
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.toISOString().slice(0, 10);
const NIVELES = { revisar: ['🔴', 'Revisar'], atencion: ['🟡', 'Atención'], ok: ['🟢', 'Sin señales'] };
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

// ctx = { el, empresaId, config, aviso(texto, error?), vigente() }
export async function supervisionTab(ctx) {
  const { el, empresaId, config, aviso, vigente } = ctx;
  const hasta = new Date();
  const desde = new Date(Date.now() - 30 * 86400_000);
  el.innerHTML = `<h2>Supervisión</h2>
 <p>Herramientas para cuidar la calidad del servicio y la confianza en los datos de la agenda. Están pensadas para <strong>conversar y revisar</strong>, no para acusar: una señal sola no prueba nada.</p>
 <form id="ad-sup-form">
  <h3>Alertas de calificación baja</h3>
  <p class="ad-note">Cuando un cliente califica la atención con esta nota o menos (o dice que el inmueble no le gustó), se avisa a quien supervisa para que revise qué pasó. Los supervisores se eligen en <strong>Equipo → ficha del asesor → Supervisor</strong>; también reciben los correos que pongas en Empresa → avisos de encuesta. Si no hay ninguno, le llega a los administradores.</p>
  <div class="ad-grid">
   <label>Avisar con calificación de … estrellas o menos<input name="alerta_baja_calificacion" type="number" min="1" max="4" value="${esc(config.alerta_baja_calificacion ?? 2)}"></label>
   <label class="ad-check"><input type="checkbox" name="alerta_baja_incluye_asesor" ${config.alerta_baja_incluye_asesor ? 'checked' : ''}> Enviar también la alerta al asesor evaluado</label>
  </div>
  <h3>Llegada a la visita</h3>
  <p class="ad-note">El asesor toca «Llegué a la visita» en su cita del día y se guarda su ubicación <strong>solo en ese instante</strong> (sin rastreo), comparada con el inmueble. Avisa a tu equipo por escrito antes de activarlo y revisa con tu abogado la política de datos personales (Ley 1581 de 2012).</p>
  <div class="ad-grid">
   <label class="ad-check"><input type="checkbox" name="exigir_llegada" ${config.exigir_llegada ? 'checked' : ''}> Marcar como señal las visitas que pasaron sin registrar llegada</label>
   <label>Distancia máxima al inmueble (metros)<input name="llegada_radio_metros" type="number" min="50" max="2000" step="50" value="${esc(config.llegada_radio_metros ?? 300)}"></label>
  </div>
  <button type="submit" style="margin-top:12px">Guardar</button>
 </form>
 <h3 style="margin-top:28px">Tablero de citas con visita de cliente</h3>
 <div class="ad-row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
  <label>Desde<input type="date" id="sup-desde" value="${iso(desde)}"></label>
  <label>Hasta<input type="date" id="sup-hasta" value="${iso(hasta)}"></label>
  <button type="button" id="sup-ver">Ver</button>
 </div>
 <div id="sup-resultado" class="ad-muted" style="margin-top:12px">Elige un periodo y pulsa Ver.</div>`;

  el.querySelector('#ad-sup-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const valores = {
      alerta_baja_calificacion: Math.max(1, Math.min(4, Number(f.alerta_baja_calificacion.value) || 2)),
      alerta_baja_incluye_asesor: f.alerta_baja_incluye_asesor.checked,
      exigir_llegada: f.exigir_llegada.checked,
      llegada_radio_metros: Math.max(50, Math.min(2000, Number(f.llegada_radio_metros.value) || 300)),
    };
    const { error } = await supabase.from('agenda_configuracion').update(valores).eq('empresa_id', empresaId);
    if (error) { aviso('No se pudo guardar. ¿Ya se aplicó el SQL 031?', true); return; }
    Object.assign(config, valores);
    aviso('Supervisión guardada.');
  };

  el.querySelector('#sup-ver').onclick = async () => {
    const out = el.querySelector('#sup-resultado');
    out.textContent = 'Calculando…';
    const { data, error } = await supabase.rpc('agenda_supervision_resumen', { p_empresa_id: empresaId, p_desde: el.querySelector('#sup-desde').value, p_hasta: el.querySelector('#sup-hasta').value });
    if (!vigente()) return;
    if (error) { out.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
    const emp = data.empresa || {};
    const filas = (data.asesores || []).map((a) => {
      const [ico, txt] = NIVELES[a.nivel] || NIVELES.ok;
      return `<tr><td data-label="Asesor">${esc(a.asesor_nombre)}</td><td data-label="Citas">${a.citas}</td><td data-label="Las registró el equipo">${pct(a.registradas_por_equipo, a.citas)}</td><td data-label="Con señales">${a.dudosas}</td><td data-label="Con prisa">${a.con_prisa}</td><td data-label="Canceladas el mismo día">${a.canceladas_mismo_dia}</td><td data-label="Encuestas respondidas">${a.encuestas_enviadas ? pct(a.encuestas_respondidas, a.encuestas_enviadas) : '—'}</td>${data.exigir_llegada ? `<td data-label="Sin llegada">${a.sin_llegada}</td>` : ''}<td data-label="Estado">${ico} ${txt}</td></tr>`;
    }).join('');
    const citas = (data.citas || []).map((c) => `<li style="margin-bottom:10px"><strong>${esc(c.fecha)} · ${esc(String(c.hora_inicio).slice(0, 5))}</strong> · ${esc(c.asesor)} → ${esc(c.cliente)}${c.telefono ? ` · ${esc(c.telefono)}` : ''}${c.correo ? ` · ${esc(c.correo)}` : ''}<br><small class="ad-muted">${(c.senales || []).map(esc).join(' · ')}</small></li>`).join('');
    out.innerHTML = `<p class="ad-note">En este periodo: ${emp.citas || 0} citas con cliente, ${emp.dudosas || 0} con varias señales; encuestas respondidas ${emp.encuestas_enviadas ? pct(emp.encuestas_respondidas, emp.encuestas_enviadas) : '—'}. «Las registró el equipo» son citas que no agendó el propio cliente en la página pública, por eso nadie más las confirmó.</p>
 <table class="v-tabla-res" style="width:100%"><thead><tr><th>Asesor</th><th>Citas</th><th>Las registró el equipo</th><th>Con señales</th><th>Con prisa</th><th>Canceladas el mismo día</th><th>Encuestas respondidas</th>${data.exigir_llegada ? '<th>Sin llegada</th>' : ''}<th>Estado</th></tr></thead><tbody>${filas || '<tr><td colspan="9">Sin citas en el periodo.</td></tr>'}</tbody></table>
 <h4 style="margin-top:18px">Citas para revisar (máximo 100)</h4>
 ${citas ? `<ul style="list-style:none;padding:0">${citas}</ul>` : '<p class="ad-muted">Ninguna cita reúne varias señales en este periodo.</p>'}
 <p class="ad-note">Cómo usarlo: empieza con una conversación con el asesor y revisa el contexto antes de concluir nada. Si una cita parece falsa, llama al cliente con el guion «¿asistió a ver el inmueble?». Cualquier medida disciplinaria debe seguir el reglamento interno de trabajo y el debido proceso (comunicar el cargo, escuchar los descargos); una alerta del sistema no es prueba suficiente por sí sola.</p>`;
  };
}
