// Mantenimientos (reparaciones locativas): «qué sigue, quién tiene el turno, desde cuándo» + clasificación de a quién corresponde.
// Proceso y reglas: docs/CASOS-MANTENIMIENTO-PROCESO.md. Todo en roles, nunca en personas. Se guarda en agenda_casos.datos (sin SQL nuevo).
// La IA solo OPINA sobre la clasificación; la confirma el arquitecto o el coordinador de inmuebles (persona). Sin confirmar no se envía proveedor a cargo de nadie, salvo urgencia.

export const CORRESPONDE = { '': '— sin definir —', propietario: 'Al propietario (no es por uso)', arrendatario: 'Al arrendatario (por uso o mal uso)', seguro: 'Al seguro de hogar (plan con póliza)' };
export const URGENCIA = { normal: 'Normal', gas: 'URGENTE: fuga de gas', agua: 'URGENTE: fuga de agua', electrica: 'URGENTE: riesgo eléctrico', otra: 'URGENTE: otra emergencia' };
const TURNOS = { coordinacion: 'Coordinación', arquitectura: 'Arquitecto o coordinador de inmuebles', proveedor: 'Proveedor', propietario: 'Propietario', arrendatario: 'Arrendatario', solicitante: 'Quien pidió el arreglo', seguro: 'Seguro de hogar' };
export const ETAPAS = ['Recibido', 'A quién corresponde', 'Cotizar y aprobar', 'Ejecutar', 'Cierre'];
// Estados que ya mueven dinero o proveedor: exigen clasificación confirmada (salvo urgencia).
const EXIGEN_CONFIRMACION = new Set(['pendiente_cotizar', 'cotizado', 'en_ejecucion']);

export const esUrgente = (d = {}) => !!d.urgencia && d.urgencia !== 'normal';

/** Etapa (0-4), frase de «qué sigue» y rol con el turno, a partir del estado y la clasificación. */
export function queSigue(c) {
  const d = c.datos || {};
  const e = c.estado;
  const por = d.corresponde_a;
  if (c.cerrado_en || e === 'finalizada' || e === 'descartado') return { etapa: 4, texto: e === 'descartado' ? 'Caso descartado' : 'Caso finalizado', turno: null };
  if (esUrgente(d)) {
    if (d.poliza_hogar === 'si' && d.seguro_avisado !== 'si') return { etapa: 3, texto: 'AVISAR YA al seguro de hogar para que entre a solucionar', turno: 'coordinacion', urgente: true };
    if (!d.proveedor_enviado) return { etapa: 3, texto: 'Enviar ya un proveedor: es una urgencia y no espera cotización', turno: 'coordinacion', urgente: true };
  }
  if (e === 'inicial') {
    if (!por) return { etapa: 1, texto: 'Definir a quién corresponde el arreglo (con el motivo)', turno: 'coordinacion' };
    if (d.clasif_confirmada !== 'si') return { etapa: 1, texto: 'Esperar la confirmación de la clasificación', turno: 'arquitectura' };
    return { etapa: 1, texto: 'Informar al responsable y pedir cotización', turno: 'coordinacion' };
  }
  if (e === 'sin_cotizacion') return { etapa: 2, texto: 'Pedir la cotización al proveedor (idealmente virtual; si no alcanza, que vaya a verificar)', turno: 'coordinacion' };
  if (e === 'pendiente_cotizar') return { etapa: 2, texto: 'Esperar la cotización del proveedor', turno: 'proveedor' };
  if (e === 'cotizado') return por === 'arrendatario'
    ? { etapa: 2, texto: 'Esperar la respuesta del arrendatario sobre el valor', turno: 'arrendatario' }
    : { etapa: 2, texto: 'Esperar la aprobación del propietario (o informarle el valor)', turno: 'propietario' };
  if (e === 'propietario') return { etapa: 3, texto: 'Esperar que el propietario haga el arreglo con su propio personal', turno: 'propietario' };
  if (e === 'en_ejecucion') return { etapa: 3, texto: 'Esperar que termine el arreglo', turno: por === 'propietario' && d.arreglo_propio === 'si' ? 'propietario' : 'proveedor' };
  if (e === 'en_encuesta') return { etapa: 4, texto: 'Esperar la respuesta de la encuesta (o cerrar a los 7 días)', turno: 'solicitante' };
  return { etapa: 0, texto: 'Revisar el caso', turno: 'coordinacion' };
}

const dias = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null);

/** Tarjeta fija arriba del caso: barra de 5 etapas + qué sigue + turno + desde cuándo. */
export function htmlQueSigue(c, escape) {
  const s = queSigue(c);
  const n = dias(c.actualizado_en || c.creado_en);
  const rojo = n != null && n >= 3 && s.turno && s.turno !== 'coordinacion' && !c.cerrado_en;
  const barra = ETAPAS.map((t, i) => `<span style="flex:1;min-width:60px;text-align:center;font-size:11px;padding:4px 2px;border-radius:6px;${i === s.etapa ? 'background:#1A2C45;color:#fff;font-weight:700' : i < s.etapa ? 'background:#E3EFEA;color:#0B5D59' : 'background:#EEF1F5;color:#586780'}">${i + 1}. ${escape(t)}</span>`).join('');
  return `<div class="v-card" style="margin-top:10px;padding:14px;border:2px solid ${s.urgente ? '#B3261E' : 'var(--v-line)'};border-radius:12px" role="status">
    <div style="display:flex;gap:4px;flex-wrap:wrap">${barra}</div>
    <p style="margin:10px 0 0;font-size:16px;font-weight:700;${s.urgente ? 'color:#B3261E' : ''}">${s.urgente ? '⚠ ' : ''}Qué sigue: ${escape(s.texto)}</p>
    ${s.turno ? `<p style="margin:4px 0 0" class="v-muted">Turno de: <strong>${escape(TURNOS[s.turno])}</strong>${n != null ? ` · desde hace ${n === 0 ? 'menos de un día' : n + (n === 1 ? ' día' : ' días')}` : ''}${rojo ? ' <span style="color:#B3261E;font-weight:700">· sin respuesta, conviene hacer seguimiento</span>' : ''}</p>` : ''}
  </div>`;
}

export function htmlClasificacion(d, escape) {
  const op = (m, a) => Object.entries(m).map(([k, t]) => `<option value="${k}" ${(a || '') === k ? 'selected' : ''}>${escape(t)}</option>`).join('');
  const si = (v) => (v === 'si' ? 'checked' : '');
  return `<div id="caso-clasif" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
    <label class="v-field">¿A quién corresponde? (según la revisión preliminar)<select id="cl-corresponde" class="v-input">${op(CORRESPONDE, d.corresponde_a)}</select></label>
    <label class="v-field">Urgencia<select id="cl-urgencia" class="v-input">${op(URGENCIA, d.urgencia || 'normal')}</select></label>
    <label class="v-field" style="grid-column:1/-1">Motivo en una frase (sin nombres ni datos personales)<input id="cl-motivo" class="v-input" maxlength="300" value="${escape(d.clasif_motivo || '')}" placeholder="Ej. humedad por filtración de la cubierta, no por uso"></label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cl-poliza" ${si(d.poliza_hogar)}> El inmueble tiene póliza de hogar (planes premium, black o platino)</label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cl-seguro-avisado" ${si(d.seguro_avisado)}> Ya se avisó al seguro</label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cl-propio" ${si(d.arreglo_propio)}> El propietario manda su propio personal (arreglo propio)</label>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cl-proveedor" ${d.proveedor_enviado ? 'checked' : ''}> Ya se envió un proveedor</label>
    <label style="display:flex;gap:8px;align-items:center;grid-column:1/-1;font-weight:600"><input type="checkbox" id="cl-confirmada" ${si(d.clasif_confirmada)}> Confirmada por el arquitecto o el coordinador de inmuebles</label>
    <div style="grid-column:1/-1"><label class="v-field">¿Qué se observó? (para la opinión de la IA; sin nombres ni datos personales)<textarea id="cl-indicios" class="v-input" rows="2" maxlength="1500" placeholder="Ej. mancha de humedad en el techo del baño, aparece desde hace semanas, sin aviso previo del arrendatario"></textarea></label>
      <button type="button" class="v-btn v-quiet" id="cl-opinion" style="margin-top:6px">Pedir opinión de la IA (basada en la Ley 820 y las normas)</button><div id="cl-opinion-res" role="status"></div></div>
    <p class="v-note" style="grid-column:1/-1;margin:0">La IA solo da su opinión; la clasificación vale cuando el arquitecto o el coordinador de inmuebles la confirma. Sin confirmar no se envía proveedor a cargo de nadie, salvo urgencia (gas, agua, riesgo eléctrico), que se atiende primero.</p>
  </div>`;
}

export function leerClasificacion(el, d) {
  const v = (i) => el.querySelector('#' + i).value.trim();
  const k = (i) => (el.querySelector('#' + i).checked ? 'si' : 'no');
  return { ...d, corresponde_a: v('cl-corresponde'), urgencia: v('cl-urgencia') || 'normal', clasif_motivo: v('cl-motivo'), poliza_hogar: k('cl-poliza'), seguro_avisado: k('cl-seguro-avisado'), arreglo_propio: k('cl-propio'), proveedor_enviado: el.querySelector('#cl-proveedor').checked, clasif_confirmada: k('cl-confirmada') };
}

/** Mensaje si el cambio de estado no se puede hacer todavía; '' si se puede. */
export function bloqueoDeEstado(estado, datos) {
  if (esUrgente(datos)) return '';
  if (!EXIGEN_CONFIRMACION.has(estado)) return '';
  if (!datos.corresponde_a) return 'Antes de pasar a este estado defina a quién corresponde el arreglo.';
  if (datos.clasif_confirmada !== 'si') return 'Antes de enviar proveedor o pedir aprobación, el arquitecto o el coordinador de inmuebles debe confirmar la clasificación (o marque la urgencia si es una emergencia).';
  return '';
}
