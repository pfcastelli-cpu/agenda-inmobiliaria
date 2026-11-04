// Configuración → Demanda: (1) cómo se lee la demanda (umbrales), (2) opción de tope con lista de espera (APAGADA por defecto), (3) importar el
// histórico del calendario del sistema anterior (.ics). Las alertas y la recomendación de subir el canon viven en Informes → Alertas de demanda
// (informe-demanda.js); aquí solo queda un contador. Lógica pura en alertas-demanda.js e ics-historico.js; cálculo en la base (agenda_demanda_resumen,
// sql/035; interruptor del bloqueo en sql/046). El sistema solo SUGIERE: nunca cambia precios.
import { supabase } from './cliente-supabase.js';
import { contarAlertasDemanda } from './informe-demanda.js';
import { parsearIcsHistorico } from './ics-historico.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null ? null : Math.max(1, Math.round(Number(v))));

// ctx = { el, empresaId, config, aviso(texto, error?), vigente() }
export async function demandaTab(ctx) {
  const { el, empresaId, config, aviso, vigente } = ctx;
  // Si la columna del interruptor (sql/046) aún no existe en la base, el bloqueo sigue la regla vieja: se bloquea siempre que haya un tope.
  const hayInterruptor = 'demanda_bloquear_por_tope' in config;
  const bloquea = hayInterruptor ? !!config.demanda_bloquear_por_tope : config.demanda_tope_citas != null;
  el.innerHTML = `<h2>Demanda por inmueble</h2>
 <p><strong>Qué mide:</strong> cuántas personas piden cita por cada inmueble. Si uno recibe muchos más pedidos de lo normal, casi siempre significa que el precio está por debajo del mercado. En ese caso el sistema te lo señala y <strong>sugiere subir el canon</strong>; el precio siempre lo decides tú.</p>
 <p><strong>Qué NO hace:</strong> no cierra la agenda ni deja de atender clientes. Aunque un inmueble tenga muchísima demanda, la página pública sigue dando horarios, salvo que enciendas la opción de abajo.</p>
 <p class="ad-note" id="dem-contador">Calculando alertas…</p>
 <form id="dem-form"><h3>Cuándo se considera «demanda alta»</h3>
  <div class="ad-grid">
   <label>Atención con … pedidos en 24 horas<input name="demanda_umbral_info" type="number" min="1" max="50" value="${esc(config.demanda_umbral_info ?? 3)}"></label>
   <label>Urgente con … pedidos en 24 horas<input name="demanda_umbral_urgente" type="number" min="2" max="100" value="${esc(config.demanda_umbral_urgente ?? 5)}"></label>
  </div>
  <p class="ad-note">«Atención» pide vigilar el inmueble; «Urgente» sugiere subir el canon (8–10 %). Si no cambias nada, se usan 3 y 5: son una primera suposición que conviene ajustar con el histórico que importes abajo. Si no haces nada, las alertas solo aparecen en Informes y no pasa nada más.</p>
  <h3 style="margin-top:20px">Opción avanzada: limitar citas por inmueble (apagada)</h3>
  <label class="ad-check" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="demanda_bloquear_por_tope" ${bloquea ? 'checked' : ''} ${hayInterruptor ? '' : 'disabled'}> <span>Dejar de dar horarios cuando un inmueble llegue al tope y ofrecer una lista de espera</span></label>
  <div class="ad-grid">
   <label>Tope de citas activas por inmueble <small class="ad-muted">(vacío = sin tope)</small><input name="demanda_tope_citas" type="number" min="1" max="100" value="${esc(config.demanda_tope_citas ?? '')}" placeholder="Ej. 8"></label>
  </div>
  <p class="ad-note"><strong>Úsalo con cuidado:</strong> al encenderlo, los clientes nuevos de ese inmueble <strong>no pueden reservar</strong>; solo dejan sus datos y esperan. Es una pérdida de clientes que no se ve en los informes. Normalmente es mejor subir el precio y seguir atendiendo a todos. Con la casilla apagada, el tope solo sirve de referencia: si se alcanza, el inmueble aparece con alerta, pero la reserva sigue abierta.</p>
  ${hayInterruptor ? '' : '<p class="error" role="alert">Falta aplicar el SQL 046: mientras tanto, cualquier tope guardado SÍ bloquea la página pública (regla anterior). Para que no bloquee, deja el tope vacío.</p>'}
  <button type="submit">Guardar</button>
 </form>
 <h3 style="margin-top:26px">Importar el histórico del sistema anterior</h3>
 <p class="ad-note">Exporta el calendario de Google (calendar.google.com → Configuración → Importar y exportar → Exportar) y sube el <code>.ics</code>. Se lee de cada cita el nombre, correo, celular y el número de inmueble de la descripción, y <strong>cuándo se pidió</strong> la cita (no cuándo es la visita). No se crean citas ni se envía ningún correo: solo sirve para medir la demanda y calibrar los umbrales.</p>
 <label>Archivo .ics<input type="file" id="dem-archivo" accept=".ics,text/calendar"></label>
 <div id="dem-import"></div>`;

  el.querySelector('#dem-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = { demanda_umbral_info: num(f.demanda_umbral_info.value) || 3, demanda_umbral_urgente: num(f.demanda_umbral_urgente.value) || 5, demanda_tope_citas: num(f.demanda_tope_citas.value) };
    if (hayInterruptor) v.demanda_bloquear_por_tope = f.demanda_bloquear_por_tope.checked;
    if (v.demanda_umbral_urgente <= v.demanda_umbral_info) { aviso('El umbral urgente debe ser mayor que el de atención.', true); return; }
    if (v.demanda_bloquear_por_tope && v.demanda_tope_citas == null) { aviso('Para limitar las citas escribe primero el tope (por ejemplo 8) o apaga la casilla.', true); return; }
    if (v.demanda_bloquear_por_tope && !config.demanda_bloquear_por_tope && !window.confirm('Vas a encender el límite: cuando un inmueble llegue a ' + v.demanda_tope_citas + ' citas activas, los clientes nuevos no podrán reservar y quedarán en lista de espera. ¿Confirmas?')) return;
    const { error } = await supabase.from('agenda_configuracion').update(v).eq('empresa_id', empresaId);
    if (error) { aviso('No se pudo guardar. ¿Ya se aplicó el SQL 035?', true); return; }
    Object.assign(config, v);
    aviso('Demanda guardada.');
    await contar();
  };

  async function contar() {
    const out = el.querySelector('#dem-contador');
    const r = await contarAlertasDemanda(empresaId, 14);
    if (!vigente() || !out) return;
    out.innerHTML = r
      ? (r.alertas ? `<strong>${r.alertas} ${r.alertas === 1 ? 'inmueble con alerta' : 'inmuebles con alerta'}${r.urgentes ? ` (${r.urgentes} urgente${r.urgentes === 1 ? '' : 's'})` : ''}</strong> en los últimos 14 días. ` : 'Ningún inmueble con alerta en los últimos 14 días. ') + 'Míralos en <strong>Informes → Alertas de demanda</strong>.'
      : 'Las alertas están en <strong>Informes → Alertas de demanda</strong>.';
  }
  contar();

// ---- Importar histórico ---------------------------------------------------------------------
  el.querySelector('#dem-archivo').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const box = el.querySelector('#dem-import');
    const { eventos, omitidos } = parsearIcsHistorico(await f.text());
    const utiles = eventos.filter((x) => x.inmueble && x.pedidaEn);
    const sinInmueble = eventos.length - utiles.length;
    if (!eventos.length) { box.innerHTML = '<p class="ad-muted">No encontré citas en ese archivo.</p>'; return; }
    box.innerHTML = `<p><strong>${utiles.length}</strong> citas con inmueble y fecha de pedido · ${sinInmueble} sin número de inmueble (se omiten) · ${omitidos.recurrentes + omitidos.todoElDia + omitidos.invalidos} omitidas por ser repetitivas o de todo el día.</p>
 <div style="overflow-x:auto"><table class="ad-tabla" style="width:100%;font-size:13px"><thead><tr><th>Pedida</th><th>Visita</th><th>Inmueble</th><th>Nombre</th><th>Celular</th><th>Correo</th></tr></thead><tbody>${utiles.slice(0, 15).map((x) => `<tr><td>${esc((x.pedidaEn || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(x.fecha)} ${esc(x.hora)}</td><td>${esc(x.inmueble)}</td><td>${esc(x.nombre)}</td><td>${esc(x.telefono)}</td><td>${esc(x.correo)}</td></tr>`).join('')}</tbody></table></div>
 <p class="ad-note">Vista previa de las primeras 15. Si el nombre, el celular o el correo salen vacíos o mal, la descripción de tus citas tiene otro formato: avísame con un ejemplo y ajusto el lector.</p>
 <button type="button" class="ad-primary" id="dem-confirmar" ${utiles.length ? '' : 'disabled'}>Importar ${utiles.length} citas para medir la demanda</button>`;
    box.querySelector('#dem-confirmar').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const filas = utiles.map((x) => ({
        empresa_id: empresaId, uid: x.uid, numero_inmueble: x.inmueble, fecha_cita: x.fecha, hora_cita: x.hora, pedida_en: x.pedidaEn,
        cliente_nombre: x.nombre || null, cliente_telefono: x.telefono || null, cliente_email: x.correo || null, cancelada: !!x.cancelada, origen: 'ics',
      }));
      let guardadas = 0;
      for (let i = 0; i < filas.length; i += 100) {
        const { error } = await supabase.from('agenda_demanda_eventos').upsert(filas.slice(i, i + 100), { onConflict: 'empresa_id,uid' });
        if (error) { aviso('Se detuvo: ' + (error.message || 'error'), true); break; }
        guardadas += Math.min(100, filas.length - i);
      }
      box.innerHTML = `<p><strong>${guardadas}</strong> citas importadas al histórico de demanda (las repetidas se actualizan, no se duplican).</p>`;
      await contar();
    };
  };
}
