// Seguimientos estructurados de un caso: tipo de contacto, resultado, próximo paso y fecha.
// Sin datos personales: solo categorías y un texto corto. Requiere sql/121 (si no está aplicado, guarda solo el texto).

export const TIPOS_SEG = { nota: 'Nota', llamada: 'Llamada', correo: 'Correo', whatsapp: 'WhatsApp', visita: 'Visita', carta: 'Carta', otro: 'Otro' };
export const RESULTADOS_SEG = { contesto: 'Contestó', no_contesto: 'No contestó', acordado: 'Quedó acordado', pendiente: 'Queda pendiente', sin_respuesta: 'Sin respuesta', resuelto: 'Resuelto' };
const LIMITE_SEDI = 400;

const hoy = () => new Date().toISOString().slice(0, 10);

/** Fecha «2026-12-03» → «3 dic» y, si ya pasó, la marca como vencida. */
export function etiquetaFecha(f) {
  if (!f) return { texto: '', vencida: false };
  const d = new Date(f + 'T12:00:00');
  const texto = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
  return { texto, vencida: f < hoy() };
}

/** Texto único que viaja a Sedi (máx. 400): «Llamada · No contestó. Próximo: volver a llamar (3 dic). detalle». */
export function textoParaSedi(s) {
  const partes = [];
  const cabeza = [TIPOS_SEG[s.tipo] && s.tipo !== 'nota' ? TIPOS_SEG[s.tipo] : '', RESULTADOS_SEG[s.resultado] || ''].filter(Boolean).join(' · ');
  if (cabeza) partes.push(cabeza + '.');
  if (s.texto) partes.push(/[.!?]$/.test(s.texto) ? s.texto : s.texto + '.');
  if (s.proximo_paso) partes.push(`Próximo: ${s.proximo_paso}${s.proxima_fecha ? ' (' + etiquetaFecha(s.proxima_fecha).texto + ')' : ''}.`);
  return partes.join(' ').slice(0, LIMITE_SEDI);
}

/** Datos para la línea de tiempo: título corto y detalle legible. */
export function eventoDeSeguimiento(s) {
  const tipo = TIPOS_SEG[s.tipo] || 'Nota';
  const res = RESULTADOS_SEG[s.resultado] || '';
  const detalle = { Tipo: tipo };
  if (res) detalle.Resultado = res;
  detalle.Texto = s.texto;
  if (s.proximo_paso) detalle['Próximo paso'] = s.proximo_paso + (s.proxima_fecha ? ` (${etiquetaFecha(s.proxima_fecha).texto})` : '');
  const titulo = (s.tipo && s.tipo !== 'nota' ? `${tipo}${res ? ' · ' + res : ''}: ` : '') + s.texto;
  return { titulo, detalle };
}

export function htmlFormSeguimiento(escape) {
  const opt = (m) => Object.entries(m).map(([k, t]) => `<option value="${k}">${escape(t)}</option>`).join('');
  return `<h3>Agregar seguimiento</h3>
    <form id="seg-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:8px">
      <label class="v-field">¿Cómo fue el contacto?<select id="seg-tipo" class="v-input">${opt(TIPOS_SEG)}</select></label>
      <label class="v-field">Resultado<select id="seg-resultado" class="v-input"><option value="">— sin resultado —</option>${opt(RESULTADOS_SEG)}</select></label>
      <label class="v-field" style="grid-column:1/-1">Qué pasó o qué se hizo<input id="seg-texto" class="v-input" maxlength="300" placeholder="Resumen breve, sin datos personales" required></label>
      <label class="v-field" style="grid-column:span 2;min-width:200px">Próximo paso (opcional)<input id="seg-proximo" class="v-input" maxlength="120" placeholder="Ej. volver a llamar"></label>
      <label class="v-field">Para el día<input id="seg-fecha" class="v-input" type="date" min="${hoy()}"></label>
      <p class="v-note" style="grid-column:1/-1;margin:0">Si indica un próximo paso, conviene ponerle fecha: así aparecerá en «Hoy / vence esta semana».</p>
      <button class="v-btn v-primary" type="submit" style="grid-column:1/-1;justify-self:start">Agregar</button>
    </form>`;
}

/** Lee el formulario; devuelve { fila } o { error }. */
export function leerFormSeguimiento(el, caso) {
  const v = (i) => el.querySelector('#' + i).value.trim();
  const fila = { caso_id: caso.id, empresa_id: caso.empresa_id, tipo: v('seg-tipo') || 'nota', resultado: v('seg-resultado') || null, texto: v('seg-texto'), proximo_paso: v('seg-proximo') || null, proxima_fecha: v('seg-fecha') || null };
  if (!fila.texto) return { error: 'Escriba qué pasó o qué se hizo.' };
  if (fila.proxima_fecha && !fila.proximo_paso) return { error: 'Escribió una fecha pero no el próximo paso. Complete el próximo paso o quite la fecha.' };
  return { fila };
}

/** Inserta. Si la base aún no tiene las columnas nuevas (sql/121 sin aplicar), guarda solo el texto resumido. */
export async function guardarSeguimiento(supabase, fila) {
  const { error } = await supabase.from('agenda_casos_seguimientos').insert(fila);
  if (!error) return { error: null };
  if (/column|schema cache|tipo|resultado|proxim/i.test(error.message || '')) {
    const { error: e2 } = await supabase.from('agenda_casos_seguimientos').insert({ caso_id: fila.caso_id, empresa_id: fila.empresa_id, texto: textoParaSedi(fila) });
    return { error: e2, degradado: !e2 };
  }
  return { error };
}
