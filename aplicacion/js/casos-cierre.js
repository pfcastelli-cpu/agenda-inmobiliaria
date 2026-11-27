// Cierre completo de una terminación: fecha real, acta, quién recibe el inmueble y cobro por terminación anticipada.
// Todo se guarda en agenda_casos.datos (sin SQL nuevo). Solo roles y categorías: nada de nombres ni cédulas.
// El valor del cobro y la retención del depósito NO se calculan aquí: los decide la persona (la retención irá en su propio bloque).

export const RECIBE = { propietario: 'El propietario', inmobiliaria: 'La inmobiliaria (en nombre del propietario)', tercero: 'Otra persona autorizada por escrito' };
export const COBRO = { pendiente: 'Pendiente de decidir', cobrado: 'Se cobró', exonerado: 'El propietario decidió no cobrarlo', no_aplica: 'No aplica' };

/** Qué cobro sugerir según la clasificación (solo una sugerencia; la persona decide). */
export function cobroSugerido(clave) {
  if (clave === 'segura') return { valor: 'no_aplica', porque: 'La entrega es segura: el aviso fue a tiempo y coincide con el vencimiento.' };
  if (clave === 'extemporanea' || clave === 'acuerdo') return { valor: 'pendiente', porque: 'La terminación no es la «segura»: revise con el propietario si hay cobro por terminación anticipada (el abogado confirma el texto del contrato).' };
  return { valor: 'pendiente', porque: 'Faltan fechas para clasificar la terminación.' };
}

export function htmlCierre(d, clasif, escape) {
  const sug = cobroSugerido(clasif.clave);
  const op = (m, actual) => Object.entries(m).map(([k, t]) => `<option value="${k}" ${actual === k ? 'selected' : ''}>${escape(t)}</option>`).join('');
  const cobroActual = d.cobro_terminacion || sug.valor;
  return `
    <label class="v-field">Fecha real de entrega (según el asesor)<input id="caso-entrega-real" class="v-input" type="date" value="${escape(d.fecha_entrega_real || '')}"></label>
    <label class="v-field">¿Existe el acta de entrega?<select id="caso-acta" class="v-input"><option value="no" ${d.acta_entrega === 'si' ? '' : 'selected'}>No</option><option value="si" ${d.acta_entrega === 'si' ? 'selected' : ''}>Sí</option></select></label>
    <label class="v-field">¿Quién recibió el inmueble?<select id="caso-recibe" class="v-input"><option value="">— elegir —</option>${op(RECIBE, d.recibe_inmueble)}</select></label>
    <label class="v-field">Cobro por terminación anticipada<select id="caso-cobro" class="v-input">${op(COBRO, cobroActual)}</select></label>
    <label class="v-field" style="grid-column:1/-1">Nota del cobro (opcional, sin datos personales)<input id="caso-cobro-nota" class="v-input" maxlength="200" value="${escape(d.cobro_nota || '')}" placeholder="Ej. el propietario aprobó no cobrar por mutuo acuerdo"></label>
    <p class="v-note" style="grid-column:1/-1;margin:0">${escape(sug.porque)} La terminación solo se cierra con acta de entrega, fecha real, quién recibió y el cobro decidido.</p>`;
}

/** Lee el bloque y devuelve los campos para `datos`. */
export function leerCierre(el, d) {
  const v = (i) => el.querySelector('#' + i).value.trim();
  return { ...d, fecha_entrega_real: v('caso-entrega-real'), acta_entrega: v('caso-acta'), recibe_inmueble: v('caso-recibe'), cobro_terminacion: v('caso-cobro'), cobro_nota: v('caso-cobro-nota') };
}

/** Devuelve el mensaje de lo que falta para cerrar, o '' si ya se puede cerrar. */
export function faltaParaCerrar(datos) {
  const f = [];
  if (!datos.fecha_entrega_real) f.push('la fecha real de entrega');
  if (datos.acta_entrega !== 'si') f.push('el acta de entrega');
  if (!datos.recibe_inmueble) f.push('quién recibió el inmueble');
  if (!datos.cobro_terminacion || datos.cobro_terminacion === 'pendiente') f.push('decidir el cobro por terminación anticipada (o marcar «No aplica»)');
  return f.length ? 'Para cerrar la terminación falta: ' + f.join(', ') + '.' : '';
}
