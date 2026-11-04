// Informes → «Alertas de demanda»: qué inmuebles reciben más pedidos de cita de lo normal y, si es mucho, la recomendación «considera subir el canon»
// con su evidencia (pedidos en 24 h / 7 días / periodo y comparación con la mediana de la ciudad). Solo administradores (la función de la base lo exige).
// El cálculo está en agenda_demanda_resumen (sql/035); la lógica pura en alertas-demanda.js. Solo SUGIERE: nunca cambia precios ni cierra la agenda.
import { supabase } from './cliente-supabase.js';
import { nivelDemanda, textoAlerta, comparativo } from './alertas-demanda.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = (n) => (n == null ? '—' : '$ ' + Math.round(Number(n)).toLocaleString('es-CO'));
const ETIQUETA = { urgente: ['🔴', 'Urgente'], atencion: ['🟡', 'Atención'], normal: ['🟢', 'Normal'] };
const ORDEN = { urgente: 0, atencion: 1, normal: 2 };

// Calcula filas con nivel y comparación. data = respuesta de agenda_demanda_resumen.
export function filasDemanda(data) {
  const u = { info: data.umbral_info, urgente: data.umbral_urgente };
  const todos = data.inmuebles || [];
  const filas = todos.map((m) => ({ m, nivel: nivelDemanda(m, u), comp: comparativo(m, todos) }));
  filas.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel] || b.m.pedidos_24h - a.m.pedidos_24h || b.m.pedidos - a.m.pedidos);
  return filas;
}

export function htmlDemanda(data, dias) {
  const filas = filasDemanda(data);
  const alertas = filas.filter((f) => f.nivel !== 'normal');
  const med = (f) => (f.comp ? String(f.comp.mediana).replace('.', ',') : '—');
  return `<p class="v-muted" style="font-size:13.5px">${filas.length} inmuebles con pedidos de cita en los últimos ${dias} días. ${alertas.length ? `<strong>${alertas.length} con alerta.</strong>` : 'Ninguno con alerta ahora: no tienes que hacer nada.'}</p>
 ${alertas.map(({ m, nivel, comp }) => `<div style="border:1px solid var(--v-line,#e5e7eb);border-left:5px solid ${nivel === 'urgente' ? '#DC2626' : '#D97706'};border-radius:12px;padding:12px 14px;margin:0 0 10px"><strong>${ETIQUETA[nivel][0]} ${ETIQUETA[nivel][1]} · Inmueble ${esc(m.numero_inmueble)}</strong> · ${esc([m.barrio, m.ciudad].filter(Boolean).join(', '))} · ${esc(m.tipo_oferta || '')} ${cop(m.valor_canon || m.valor_venta)}<br><span>${esc(textoAlerta(m, nivel, comp))}</span></div>`).join('')}
 <div style="overflow-x:auto"><table class="v-tabla-res" style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr style="text-align:left;border-bottom:1px solid var(--v-line,#e5e7eb)"><th style="padding:8px 10px">Inmueble</th><th style="padding:8px 10px">24 h</th><th style="padding:8px 10px">7 días</th><th style="padding:8px 10px">${dias} días</th><th style="padding:8px 10px" title="Mediana de pedidos de los inmuebles de su ciudad en el mismo periodo">Mediana ciudad</th><th style="padding:8px 10px">Personas</th><th style="padding:8px 10px">Citas activas</th><th style="padding:8px 10px">Nivel</th></tr></thead><tbody>${filas.map((f) => `<tr style="border-bottom:1px solid var(--v-line,#e5e7eb)"><td data-label="Inmueble" style="padding:8px 10px">${esc(f.m.numero_inmueble)} · ${esc(f.m.direccion || '')}</td><td data-label="24 h" style="padding:8px 10px">${f.m.pedidos_24h}</td><td data-label="7 días" style="padding:8px 10px">${f.m.pedidos_7d}</td><td data-label="${dias} días" style="padding:8px 10px">${f.m.pedidos}</td><td data-label="Mediana ciudad" style="padding:8px 10px">${med(f)}</td><td data-label="Personas" style="padding:8px 10px">${f.m.personas}</td><td data-label="Citas activas" style="padding:8px 10px">${f.m.activas}</td><td data-label="Nivel" style="padding:8px 10px">${ETIQUETA[f.nivel][0]} ${ETIQUETA[f.nivel][1]}</td></tr>`).join('') || '<tr><td colspan="8" style="padding:8px 10px">Sin pedidos en el periodo.</td></tr>'}</tbody></table></div>
 <p class="v-muted" style="font-size:12.5px;margin-top:8px">«Mediana ciudad» compara con los demás inmuebles de la misma ciudad que tuvieron pedidos (si hay menos de 3, con todos). Los umbrales se ajustan en Configuración → Demanda.</p>`;
}

// Cuenta alertas (para el contador pequeño de Configuración → Demanda). Devuelve null si no se pudo calcular.
export async function contarAlertasDemanda(empresaId, dias = 14) {
  const { data, error } = await supabase.rpc('agenda_demanda_resumen', { p_empresa_id: empresaId, p_dias: dias });
  if (error || !data) return null;
  const filas = filasDemanda(data);
  return { total: filas.length, alertas: filas.filter((f) => f.nivel !== 'normal').length, urgentes: filas.filter((f) => f.nivel === 'urgente').length };
}

// Monta la sección dentro de `el` (un contenedor de Informes). Pide los datos por su cuenta para no frenar el resto del informe.
export function montarInformeDemanda(el, empresaId) {
  if (!el) return;
  el.innerHTML = `<h3 style="margin-top:28px">Alertas de demanda</h3>
   <p class="v-muted" style="font-size:13.5px">Cuántas personas piden cita por cada inmueble. Si uno recibe mucho más de lo normal, casi siempre el precio está por debajo del mercado: te lo señalamos con la evidencia y sugerimos subir el canon. <strong>Nunca se bloquea la agenda ni se deja de atender a un cliente</strong>, y el precio lo decides tú.</p>
   <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px"><label class="v-field" style="margin:0">Mirar los últimos<select class="v-input" id="v-dem-dias"><option value="7">7 días</option><option value="14">14 días</option><option value="30" selected>30 días</option><option value="90">90 días</option></select></label></div>
   <div id="v-dem-out" class="v-muted">Calculando…</div>`;
  const out = el.querySelector('#v-dem-out');
  const sel = el.querySelector('#v-dem-dias');
  let n = 0;
  async function cargar() {
    const mio = ++n;
    const dias = Number(sel.value);
    out.textContent = 'Calculando…';
    const { data, error } = await supabase.rpc('agenda_demanda_resumen', { p_empresa_id: empresaId, p_dias: dias });
    if (mio !== n || !el.isConnected) return;
    if (error || !data) { out.innerHTML = `<p class="v-muted">No se pudieron calcular las alertas de demanda${error?.message ? ': ' + esc(error.message) : ''}. Solo los administradores las ven.</p>`; return; }
    out.innerHTML = htmlDemanda(data, dias);
  }
  sel.onchange = cargar;
  cargar();
}
