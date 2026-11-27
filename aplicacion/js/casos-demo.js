// Página de prueba de «Casos»: usa una base falsa en memoria con datos de ./datos-demo/casos-demo.json.
// No se conecta a Supabase ni pide sesión. Solo para ver cómo queda y probar los filtros.
import { renderCasos } from './casos-inmuebles.js';

const resp = await fetch('./datos-demo/casos-demo.json').catch(() => null);
const bd = resp && resp.ok ? await resp.json() : { casos: [], seguimientos: [], archivos: [], cola: [] };
const tablas = { agenda_casos: bd.casos, agenda_casos_seguimientos: bd.seguimientos, agenda_casos_archivos: bd.archivos, agenda_sedi_cola: bd.cola, agenda_casos_comunicaciones: bd.comunicaciones || [], agenda_casos_eventos: [], agenda_casos_ia_ajustes: [], agenda_inmueble_correos: bd.correos || [], agenda_inmueble_contratos_resumen: bd.resumenes_contrato || [], agenda_casos_detectados: bd.detectados || [], agenda_casos_actas: bd.actas || [], agenda_inmuebles: bd.inmuebles || [], agenda_asesores: [{ nombre: 'Daniela' }, { nombre: 'Gino Castelli' }, { nombre: 'Felipe Castelli' }] };

function consulta(nombre) {
  const filtros = []; let orden = []; let lim = Infinity; let modo = 'select'; let cambios = null; let conteo = false; let solo = null; let claves = [];
  const q = {
    select(_c, op) { if (modo === 'select' || modo === 'insert') { if (op?.count) conteo = true; } return q; },
    eq(c, v) { filtros.push((r) => r[c] === v); return q; },
    in(c, vs) { filtros.push((r) => vs.includes(r[c])); return q; },
    not(c, _op, v) { filtros.push((r) => (r[c] ?? null) !== v); return q; },
    is(c, v) { filtros.push((r) => (r[c] ?? null) === v); return q; },
    order(c, o = {}) { orden.push([c, o.ascending !== false]); return q; },
    limit(n) { lim = n; return q; }, range(a, b) { lim = b + 1; return q; },
    maybeSingle() { solo = 'maybe'; return q; }, single() { solo = 'uno'; return q; },
    insert(fila) { modo = 'insert'; cambios = { id: 'demo-' + Math.random().toString(36).slice(2, 8), creado_en: new Date().toISOString(), ...fila }; return q; },
    update(c) { modo = 'update'; cambios = c; return q; },
    upsert(fila, op = {}) { modo = 'upsert'; cambios = fila; claves = String(op.onConflict || 'id').split(','); return q; },
    then(ok, fallo) { return Promise.resolve(ejecutar()).then(ok, fallo); },
  };
  function ejecutar() {
    const tabla = tablas[nombre] || [];
    if (modo === 'insert') { tabla.unshift(cambios); return { data: solo ? { id: cambios.id } : [cambios], error: null }; }
    if (modo === 'upsert') { const ya = tabla.find((r) => claves.every((k) => r[k] === cambios[k])); if (ya) Object.assign(ya, cambios); else tabla.unshift({ id: 'demo-' + Math.random().toString(36).slice(2, 8), ...cambios }); return { data: null, error: null }; }
    let filas = tabla.filter((r) => filtros.every((f) => f(r)));
    if (modo === 'update') {
      // Imita el trigger de sql/122: cada cambio de estado deja una fila en el historial.
      if (nombre === 'agenda_casos') filas.forEach((r) => { if (cambios.estado && cambios.estado !== r.estado) tablas.agenda_casos_eventos.unshift({ id: 'ev-' + Math.random().toString(36).slice(2, 8), caso_id: r.id, campo: 'estado', valor_anterior: r.estado, valor_nuevo: cambios.estado, creado_en: new Date().toISOString() }); });
      filas.forEach((r) => Object.assign(r, cambios)); return { data: filas, error: null };
    }
    orden.slice().reverse().forEach(([c, asc]) => filas.sort((a, b) => (String(a[c] ?? '￿') < String(b[c] ?? '￿') ? -1 : 1) * (asc ? 1 : -1)));
    filas = filas.slice(0, lim);
    if (conteo) return { count: filas.length, data: null, error: null };
    return { data: solo ? (filas[0] || null) : filas, error: null };
  }
  return q;
}
// Simula la función del servidor `enviar-comunicacion-caso`: no envía nada; solo guarda la fila en memoria (con el modo de pruebas).
const functions = { invoke: async (_n, { body }) => {
  // IA SIMULADA (no llama a ningún proveedor): solo para ver la pantalla. La real es la función `revisar-redaccion-caso`.
  if (_n === 'revisar-redaccion-caso') {
    if (body.modo === 'redaccion') return { error: null, data: { ok: true, modelo: 'simulada (demo)', resultado: { texto_sugerido: String(body.texto).replace(/ {2,}/g, ' '), avisos: [{ tipo: 'tono', mensaje: 'Ejemplo simulado de aviso de tono.', fragmento: '' }] } } };
    return { error: null, data: { ok: true, modelo: 'simulada (demo)', resultado: { opinion: 'propietario', confianza: 'media', razones: ['Ejemplo simulado: la filtración parece venir de la cubierta, no del uso.'], normas: ['Ley 820 de 2003 (verificar artículo)'], evidencia_que_falta: ['Foto fechada del daño', 'Concepto técnico del proveedor'], texto_para_arquitecto: 'Respuesta simulada para la demo; no es una opinión real.' } } };
  }
  const ahora = new Date().toISOString();
  tablas.agenda_casos_comunicaciones.unshift({ id: 'com-' + Math.random().toString(36).slice(2, 8), caso_id: body.caso_id, plantilla: body.plantilla, destinatario: body.destinatario, estado: body.modo === 'prueba' ? 'prueba' : 'enviada', asunto: body.asunto, cuerpo_html: body.cuerpo_html, correo_mascara: 'p***@ejemplo.co', propietario_decision: body.plantilla === 'aviso_propietario' && body.modo === 'real' ? 'pendiente' : null, ligada_a: body.ligada_a, creado_en: ahora, enviada_en: ahora });
  return { error: null };
} };
const storage = { from: () => ({ upload: async () => ({ error: null }) }) };   // simula el depósito privado casos-actas (no sube nada)
const supabase = { from: consulta, rpc: async () => ({ error: null }), functions, storage };
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
renderCasos({ el: document.getElementById('casos-demo'), supabase, empresaId: 'demo', rol: 'administrador', escape, icon: () => '', refreshIcons: () => {} });
