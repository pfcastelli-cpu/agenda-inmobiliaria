// Configuración → Demanda: (1) alertas de demanda por inmueble en horas, (2) umbrales y tope de citas, (3) importar el histórico del
// calendario del sistema anterior (.ics con nombre, correo, celular e inmueble en la descripción). La lógica pura está en
// alertas-demanda.js e ics-historico.js; el cálculo en la base (agenda_demanda_resumen, sql/035). El sistema solo SUGIERE: nunca cambia precios.
import { supabase } from './cliente-supabase.js';
import { nivelDemanda, textoAlerta } from './alertas-demanda.js';
import { parsearIcsHistorico } from './ics-historico.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = (n) => (n == null ? '—' : '$ ' + Math.round(Number(n)).toLocaleString('es-CO'));
const ETIQUETA = { urgente: ['🔴', 'Urgente'], atencion: ['🟡', 'Atención'], normal: ['🟢', 'Normal'] };
const num = (v) => (v === '' || v == null ? null : Math.max(1, Math.round(Number(v))));

// ctx = { el, empresaId, config, aviso(texto, error?), vigente() }
export async function demandaTab(ctx) {
  const { el, empresaId, config, aviso, vigente } = ctx;
  el.innerHTML = `<h2>Demanda por inmueble</h2>
 <p>Mide cuántas personas piden cita por cada inmueble y te avisa <strong>en horas</strong> cuando uno recibe mucho más de lo normal. Con una sola radicación por inmueble, una avalancha de pedidos casi siempre significa que el precio está por debajo del mercado y que la agenda del equipo se está llenando con un solo inmueble. La alerta solo <strong>sugiere</strong>; el precio lo decides tú.</p>
 <form id="dem-form"><h3>Umbrales y tope</h3>
  <div class="ad-grid">
   <label>Atención con … pedidos en 24 horas<input name="demanda_umbral_info" type="number" min="1" max="50" value="${esc(config.demanda_umbral_info ?? 3)}"></label>
   <label>Urgente con … pedidos en 24 horas<input name="demanda_umbral_urgente" type="number" min="2" max="100" value="${esc(config.demanda_umbral_urgente ?? 5)}"></label>
   <label>Tope de citas activas por inmueble <small class="ad-muted">(vacío = sin tope)</small><input name="demanda_tope_citas" type="number" min="1" max="100" value="${esc(config.demanda_tope_citas ?? '')}" placeholder="Ej. 8"></label>
  </div>
  <p class="ad-note">Con el tope, cuando un inmueble llega a ese número de citas activas, la página pública deja de dar horarios y ofrece una <strong>lista de espera</strong>. Los umbrales son una primera suposición: se calibran con el histórico que importes abajo.</p>
  <button type="submit">Guardar</button>
 </form>
 <h3 style="margin-top:26px">Alertas</h3>
 <div class="ad-row" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label>Mirar los últimos<select id="dem-dias"><option value="3">3 días</option><option value="7">7 días</option><option value="14" selected>14 días</option><option value="30">30 días</option><option value="90">90 días</option></select></label><button type="button" id="dem-ver">Actualizar</button></div>
 <div id="dem-resultado" class="ad-muted" style="margin-top:12px">Cargando…</div>
 <h3 style="margin-top:26px">Importar el histórico del sistema anterior</h3>
 <p class="ad-note">Exporta el calendario de Google (calendar.google.com → Configuración → Importar y exportar → Exportar) y sube el <code>.ics</code>. Se lee de cada cita el nombre, correo, celular y el número de inmueble de la descripción, y <strong>cuándo se pidió</strong> la cita (no cuándo es la visita). No se crean citas ni se envía ningún correo: solo sirve para medir la demanda.</p>
 <label>Archivo .ics<input type="file" id="dem-archivo" accept=".ics,text/calendar"></label>
 <div id="dem-import"></div>`;

  el.querySelector('#dem-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = { demanda_umbral_info: num(f.demanda_umbral_info.value) || 3, demanda_umbral_urgente: num(f.demanda_umbral_urgente.value) || 5, demanda_tope_citas: num(f.demanda_tope_citas.value) };
    if (v.demanda_umbral_urgente <= v.demanda_umbral_info) { aviso('El umbral urgente debe ser mayor que el de atención.', true); return; }
    const { error } = await supabase.from('agenda_configuracion').update(v).eq('empresa_id', empresaId);
    if (error) { aviso('No se pudo guardar. ¿Ya se aplicó el SQL 035?', true); return; }
    Object.assign(config, v);
    aviso('Demanda guardada.');
    await cargar();
  };

  async function cargar() {
    const out = el.querySelector('#dem-resultado');
    out.textContent = 'Calculando…';
    const { data, error } = await supabase.rpc('agenda_demanda_resumen', { p_empresa_id: empresaId, p_dias: Number(el.querySelector('#dem-dias').value) });
    if (!vigente()) return;
    if (error) { out.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
    const u = { info: data.umbral_info, urgente: data.umbral_urgente };
    const filas = (data.inmuebles || []).map((m) => ({ m, nivel: nivelDemanda(m, u) }));
    const orden = { urgente: 0, atencion: 1, normal: 2 };
    filas.sort((a, b) => orden[a.nivel] - orden[b.nivel] || b.m.pedidos_24h - a.m.pedidos_24h || b.m.pedidos - a.m.pedidos);
    const alertas = filas.filter((f) => f.nivel !== 'normal');
    out.innerHTML = `<p class="ad-note">${data.inmuebles.length} inmuebles con pedidos en este periodo; promedio de ${data.promedio_pedidos_por_inmueble ?? '—'} pedidos por inmueble. ${alertas.length ? `<strong>${alertas.length} con alerta.</strong>` : 'Ninguno con alerta ahora.'}</p>
 ${alertas.map(({ m, nivel }) => `<div style="border:1px solid #e5e7eb;border-left:5px solid ${nivel === 'urgente' ? '#DC2626' : '#D97706'};border-radius:12px;padding:12px 14px;margin:0 0 10px"><strong>${ETIQUETA[nivel][0]} ${ETIQUETA[nivel][1]} · Inmueble ${esc(m.numero_inmueble)}</strong> · ${esc([m.barrio, m.ciudad].filter(Boolean).join(', '))} · ${esc(m.tipo_oferta || '')} ${cop(m.valor_canon || m.valor_venta)}<br><span>${esc(textoAlerta(m, nivel))}</span></div>`).join('')}
 <table class="v-tabla-res" style="width:100%"><thead><tr><th>Inmueble</th><th>24 h</th><th>48 h</th><th>7 días</th><th>Total</th><th>Personas</th><th>Citas activas</th><th>Nivel</th></tr></thead><tbody>${filas.map(({ m, nivel }) => `<tr><td data-label="Inmueble">${esc(m.numero_inmueble)} · ${esc(m.direccion || '')}</td><td data-label="24 h">${m.pedidos_24h}</td><td data-label="48 h">${m.pedidos_48h}</td><td data-label="7 días">${m.pedidos_7d}</td><td data-label="Total">${m.pedidos}</td><td data-label="Personas">${m.personas}</td><td data-label="Citas activas">${m.activas}${m.tope != null ? ' / ' + m.tope : ''}</td><td data-label="Nivel">${ETIQUETA[nivel][0]} ${ETIQUETA[nivel][1]}</td></tr>`).join('') || '<tr><td colspan="8">Sin pedidos en el periodo.</td></tr>'}</tbody></table>`;
  }
  el.querySelector('#dem-ver').onclick = cargar;
  el.querySelector('#dem-dias').onchange = cargar;
  cargar();

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
      await cargar();
    };
  };
}
