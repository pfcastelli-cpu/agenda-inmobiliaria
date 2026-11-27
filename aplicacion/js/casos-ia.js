// IA en Casos: ajustes de estilo (amabilidad, firmeza, protección de la empresa), revisión de redacción y opinión sobre a quién corresponde un arreglo.
// La IA solo propone: nada se envía ni se decide sola. Todo texto que sale hacia la IA se revisa antes sin datos personales.
// Servidor: función `revisar-redaccion-caso` y tabla `agenda_casos_ia_ajustes` (sql/123). Si no están disponibles, se usa la revisión local.
import { revisarTexto } from './casos-informes.js';

export const AJUSTES_BASE = { amabilidad: 4, firmeza: 3, proteccion_empresa: 4, instrucciones: '', revision_ia_activa: true };
const NIVELES = {
  amabilidad: ['Seco y directo', 'Correcto y breve', 'Cordial', 'Cálido y amable', 'Muy cálido y cercano'],
  firmeza: ['Muy flexible', 'Flexible', 'Equilibrado', 'Firme', 'Muy firme'],
  proteccion_empresa: ['Mínima', 'Baja', 'Media', 'Alta', 'Máxima (no asumir nada que no corresponda)'],
};
const AYUDA = {
  amabilidad: 'Qué tan cálido suena el texto. Alto = más cercano y empático.',
  firmeza: 'Qué tan firme es la empresa al decir lo que no le corresponde. Alto = no cede, pero sin ser seco.',
  proteccion_empresa: 'Cuánto cuida la IA que la empresa no prometa ni asuma costos ajenos y que quede constancia.',
};

export async function cargarAjustes(supabase, empresaId) {
  const { data } = await supabase.from('agenda_casos_ia_ajustes').select('*').eq('empresa_id', empresaId).maybeSingle();
  return { ...AJUSTES_BASE, ...(data || {}), instrucciones: (data && data.instrucciones) || '' };
}

export async function guardarAjustes(supabase, empresaId, a) {
  const fila = { amabilidad: +a.amabilidad, firmeza: +a.firmeza, proteccion_empresa: +a.proteccion_empresa, instrucciones: a.instrucciones.trim() || null, revision_ia_activa: !!a.revision_ia_activa, actualizado_en: new Date().toISOString() };
  const { data: ya } = await supabase.from('agenda_casos_ia_ajustes').select('empresa_id').eq('empresa_id', empresaId).maybeSingle();
  return ya ? supabase.from('agenda_casos_ia_ajustes').update(fila).eq('empresa_id', empresaId) : supabase.from('agenda_casos_ia_ajustes').insert({ empresa_id: empresaId, ...fila });
}

/** Ejemplo breve de cómo sonaría con los ajustes actuales (solo orientativo; la IA real redacta con estas mismas indicaciones). */
export function ejemploDeTono(a) {
  const saludo = a.amabilidad >= 4 ? 'Con mucho gusto le contamos cómo va su solicitud.' : a.amabilidad === 3 ? 'Le informamos cómo va su solicitud.' : 'Estado de su solicitud.';
  const firme = a.firmeza >= 4 ? 'Según la revisión preliminar, este arreglo no corresponde a la administración; por eso necesitamos su respuesta antes de continuar.' : a.firmeza === 3 ? 'Según la revisión preliminar, este arreglo parece corresponder a la otra parte; le agradecemos confirmarnos cómo desea proceder.' : 'Estamos revisando a quién corresponde el arreglo y quedamos atentos a su opinión.';
  const cierre = a.proteccion_empresa >= 4 ? ' Dejamos constancia de lo conversado y no iniciaremos trabajos sin su aprobación escrita.' : '';
  return `${saludo} ${firme}${cierre}`;
}

export function htmlAjustes(a, escape, puedeEditar) {
  const fila = (k, titulo) => `<div style="margin-top:14px"><label for="ia-${k}" style="font-weight:600">${titulo}: <span id="ia-${k}-t" style="color:#0B5D59">${escape(NIVELES[k][a[k] - 1])}</span></label>
    <input id="ia-${k}" type="range" min="1" max="5" step="1" value="${a[k]}" ${puedeEditar ? '' : 'disabled'} style="width:100%"><div class="v-muted" style="font-size:12px">${escape(AYUDA[k])}</div></div>`;
  return `<div class="v-card" style="margin-top:12px;padding:16px;border:1px solid var(--v-line);border-radius:12px">
    <h3>Cómo contesta la IA</h3>
    <p class="v-muted">Estos ajustes valen para la revisión de informes y cartas y para la opinión sobre a quién corresponde un arreglo. La IA siempre trata de «usted», no promete, no culpa y no usa datos personales.${puedeEditar ? '' : ' Solo el administrador puede cambiarlos.'}</p>
    ${fila('amabilidad', 'Amabilidad')}${fila('firmeza', 'Firmeza')}${fila('proteccion_empresa', 'Protección de la empresa')}
    <label class="v-field" style="margin-top:14px">Instrucciones propias de la empresa (opcional, máx. 1000 letras; sin nombres ni datos personales)
      <textarea id="ia-instrucciones" class="v-input" rows="3" maxlength="1000" ${puedeEditar ? '' : 'disabled'} placeholder="Ej. En urgencias de agua, siempre recordar cerrar la llave de paso.">${escape(a.instrucciones)}</textarea></label>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="ia-activa" ${a.revision_ia_activa ? 'checked' : ''} ${puedeEditar ? '' : 'disabled'}> Usar la IA para revisar textos y dar opiniones (si se apaga, solo queda la revisión básica local)</label>
    <div style="margin-top:14px;padding:12px;border-radius:10px;background:#EEF1F5"><strong>Así sonaría:</strong><p id="ia-ejemplo" style="margin:6px 0 0">${escape(ejemploDeTono(a))}</p></div>
    ${puedeEditar ? '<div style="margin-top:14px"><button type="button" class="v-btn v-primary" id="ia-guardar">Guardar ajustes</button> <span id="ia-msg" class="v-muted" role="status"></span></div>' : ''}
  </div>`;
}

export function enlazarAjustes(host, supabase, empresaId, escape, a) {
  const leer = () => ({ amabilidad: host.querySelector('#ia-amabilidad').value, firmeza: host.querySelector('#ia-firmeza').value, proteccion_empresa: host.querySelector('#ia-proteccion_empresa').value, instrucciones: host.querySelector('#ia-instrucciones').value, revision_ia_activa: host.querySelector('#ia-activa').checked });
  ['amabilidad', 'firmeza', 'proteccion_empresa'].forEach((k) => {
    host.querySelector('#ia-' + k).oninput = () => { const v = leer(); host.querySelector(`#ia-${k}-t`).textContent = NIVELES[k][v[k] - 1]; host.querySelector('#ia-ejemplo').textContent = ejemploDeTono({ amabilidad: +v.amabilidad, firmeza: +v.firmeza, proteccion_empresa: +v.proteccion_empresa }); };
  });
  const g = host.querySelector('#ia-guardar');
  if (g) g.onclick = async () => {
    const { error } = await guardarAjustes(supabase, empresaId, leer());
    host.querySelector('#ia-msg').textContent = error ? 'No se pudo guardar: ' + error.message : 'Guardado.';
  };
}

/* -------------------------- Revisión de redacción -------------------------- */
/** Primero la revisión local (bloquea datos personales: ese texto nunca sale hacia la IA). Después, si está disponible, la IA. */
export async function revisarRedaccion(supabase, empresaId, texto, perfil = 'informe') {
  const locales = revisarTexto(texto, perfil);
  if (locales.some((p) => p.tipo === 'datos')) return { local: locales, ia: null, motivo: 'datos' };
  const { data, error } = await supabase.functions.invoke('revisar-redaccion-caso', { body: { empresa_id: empresaId, modo: 'redaccion', texto, perfil } });
  if (error || !data || !data.ok) return { local: locales, ia: null, motivo: (data && data.motivo) || 'fallo' };
  return { local: locales, ia: data.resultado, modelo: data.modelo };
}

/* ------------------------ Opinión sobre a quién corresponde ------------------------ */
export const OPINION = { propietario: 'Al propietario', arrendatario: 'Al arrendatario', seguro: 'Al seguro de hogar', indeterminado: 'No se puede saber todavía' };

export async function pedirOpinion(supabase, empresaId, { resumen, indicios }) {
  const prueba = revisarTexto(`${resumen} ${indicios}`, 'carta').filter((p) => p.tipo === 'datos');
  if (prueba.length) return { error: 'Quite los datos personales del texto (' + prueba[0].mensaje + ') antes de pedir la opinión.' };
  const { data, error } = await supabase.functions.invoke('revisar-redaccion-caso', { body: { empresa_id: empresaId, modo: 'clasificacion', resumen, indicios } });
  if (error || !data || !data.ok) return { error: data && data.motivo === 'sin_clave' ? 'Falta la clave de IA de la empresa.' : data && data.motivo === 'apagada' ? 'La IA está apagada en los ajustes.' : 'La IA no pudo responder ahora. La clasificación se hace a mano.' };
  return { opinion: data.resultado, modelo: data.modelo };
}

export function htmlOpinion(o, escape) {
  const li = (arr) => (arr && arr.length ? `<ul style="margin:4px 0 0 18px">${arr.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>` : '<span class="v-muted"> —</span>');
  return `<div style="margin-top:10px;padding:12px;border-radius:10px;border:1px dashed #586780">
    <p style="margin:0;font-weight:700">Opinión de la IA (preliminar): ${escape(OPINION[o.opinion] || OPINION.indeterminado)} · confianza ${escape(o.confianza)}</p>
    <p style="margin:6px 0 0">${escape(o.texto_para_arquitecto)}</p>
    <div style="margin-top:6px"><strong>Razones</strong>${li(o.razones)}</div>
    <div style="margin-top:6px"><strong>Normas citadas</strong>${li(o.normas)}</div>
    <div style="margin-top:6px"><strong>Evidencia que falta</strong>${li(o.evidencia_que_falta)}</div>
    <p class="v-note" style="margin:8px 0 0">Es una opinión, no una decisión. Las normas hay que verificarlas. Lo confirma el arquitecto o el coordinador de inmuebles.</p></div>`;
}
