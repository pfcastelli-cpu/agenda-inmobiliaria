// Horarios de captación por ciudad (agenda interna → «Captación de un inmueble nuevo»).
// Se elige la ciudad (la cobertura/zona es opcional) y se muestran, mezclados y por día, TODOS los horarios libres de los asesores
// de esa ciudad. Cada hora se asigna al asesor de mayor prioridad que esté libre (prioridad 1 antes que 5; a igual prioridad,
// de planta antes que freelance); si ese está ocupado, la hora la ofrece el siguiente. La lógica de «quién está libre» vive en
// la RPC agenda_sugerir_horarios_captacion_ciudad (sql/041): jornada, almuerzo, ausencias, festivos, anticipación y traslado.

const DIAS_BUSQUEDA = 7;

// De dónde llegó el propietario. Texto libre en la base (agenda_citas.origen_captacion), así que se puede ampliar sin migración.
export const ORIGENES_CAPTACION = [
  'Referido de un propietario',
  'Referido de un cliente o arrendatario',
  'Referido de un asesor o aliado',
  'Administrador de edificio o conjunto',
  'Constructora o proyecto nuevo',
  'Página web (consigna tu inmueble)',
  'Bot de WhatsApp',
  'WhatsApp / llamada directa',
  'Portal inmobiliario (Fincaraíz, Metrocuadrado, Ciencuadras)',
  'Letrero en el inmueble',
  'Google / búsqueda en internet',
  'Redes sociales (Instagram, Facebook, TikTok)',
  'Publicidad pagada',
  'Correo o campaña de email',
  'Base de datos propia (propietario antiguo)',
  'Llamada en frío / base fría',
  'Puerta a puerta o volanteo',
  'Evento, feria o alianza',
  'Otro',
];

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hhmm = (h) => String(h || '').slice(0, 5);

export async function cargarCiudadesYZonas(supabase, empresaId) {
  const [ciudades, zonas] = await Promise.all([
    supabase.from('agenda_ciudades').select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
    supabase.from('agenda_coberturas').select('id, nombre, ciudad_id').eq('empresa_id', empresaId).order('nombre'),
  ]);
  if (ciudades.error) throw new Error('No se pudieron cargar las ciudades: ' + ciudades.error.message);
  return { ciudades: ciudades.data || [], zonas: zonas.data || [] };
}

// Junta las filas (día, hora, asesor) en una sola lista por día y hora, con los asesores libres ordenados por prioridad.
export function agruparHorarios(filas) {
  const porClave = new Map();
  for (const f of filas || []) {
    const clave = `${f.fecha} ${f.hora_inicio}`;
    if (!porClave.has(clave)) porClave.set(clave, { fecha: f.fecha, horaInicio: f.hora_inicio, horaFin: f.hora_fin, opciones: [] });
    porClave.get(clave).opciones.push({ asesorId: f.asesor_id, asesorNombre: f.asesor_nombre, tipo: f.tipo_vinculacion, prioridad: f.prioridad });
  }
  const lista = [...porClave.values()];
  for (const s of lista) {
    s.opciones.sort((a, b) => a.prioridad - b.prioridad || (a.tipo === 'planta' ? 0 : 1) - (b.tipo === 'planta' ? 0 : 1) || a.asesorNombre.localeCompare(b.asesorNombre));
  }
  return lista.sort((a, b) => (a.fecha + a.horaInicio < b.fecha + b.horaInicio ? -1 : 1));
}

export async function buscarHorariosCaptacion(supabase, { empresaId, ciudadId, coberturaId, desde }) {
  const { data, error } = await supabase.rpc('agenda_sugerir_horarios_captacion_ciudad', {
    p_empresa_id: empresaId,
    p_ciudad_id: ciudadId,
    p_fecha_desde: desde,
    p_dias: DIAS_BUSQUEDA,
    p_cobertura_id: coberturaId || null,
  });
  if (error) throw new Error(error.message);
  return agruparHorarios(data);
}

// Elige la opción por defecto (el asesor de mayor prioridad libre) o la que el usuario cambie.
export function seleccionarHorario(slot, asesorId) {
  const op = slot.opciones.find((o) => o.asesorId === asesorId) || slot.opciones[0];
  return { ...slot, asesorId: op.asesorId, asesorNombre: op.asesorNombre };
}

export function htmlCiudadYZona(it, ciudades, zonas) {
  const zonasCiudad = zonas.filter((z) => z.ciudad_id === it.ciudadId);
  return `<label class="v-field" for="v-interna-ciudad-captacion">Ciudad<select class="v-input" id="v-interna-ciudad-captacion" required><option value="">Selecciona la ciudad</option>${ciudades
    .map((c) => `<option value="${c.id}" ${it.ciudadId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`)
    .join('')}</select></label>
  ${zonasCiudad.length ? `<label class="v-field" for="v-interna-cobertura">Zona (opcional)<select class="v-input" id="v-interna-cobertura"><option value="">Toda la ciudad</option>${zonasCiudad
    .map((z) => `<option value="${z.id}" ${it.coberturaId === z.id ? 'selected' : ''}>${esc(z.nombre)}</option>`)
    .join('')}</select></label>` : ''}`;
}

const NOMBRE_DIA = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function htmlHorariosCaptacion(it) {
  if (it.buscandoSlots) return '<p class="v-muted">Buscando horarios…</p>';
  const sel = it.slotSeleccionado;
  const dias = new Map();
  for (const s of it.slotsCaptacion) {
    if (!dias.has(s.fecha)) dias.set(s.fecha, []);
    dias.get(s.fecha).push(s);
  }
  const lista = [...dias.entries()]
    .map(([fecha, slots]) => `<div class="v-sectiontitle" style="margin-top:12px;text-transform:capitalize">${esc(NOMBRE_DIA.format(new Date(fecha + 'T00:00:00Z')))}</div>
      <div class="v-slots">${slots
        .map((s) => {
          const idx = it.slotsCaptacion.indexOf(s);
          const activo = !!(sel && sel.fecha === s.fecha && sel.horaInicio === s.horaInicio);
          const extra = s.opciones.length > 1 ? ` <small>(+${s.opciones.length - 1})</small>` : '';
          return `<button type="button" class="v-slot" data-slot-captacion="${idx}" aria-pressed="${activo}">${hhmm(s.horaInicio)}–${hhmm(s.horaFin)}<br><small>${esc(s.opciones[0].asesorNombre)}</small>${extra}</button>`;
        })
        .join('')}</div>`)
    .join('');
  const cambiar = sel && sel.opciones.length > 1
    ? `<label class="v-field" for="v-interna-asesor-captacion" style="margin-top:10px">Asesor para este horario<select class="v-input" id="v-interna-asesor-captacion">${sel.opciones
        .map((o, i) => `<option value="${o.asesorId}" ${o.asesorId === sel.asesorId ? 'selected' : ''}>${esc(o.asesorNombre)}${i === 0 ? ' · mayor prioridad' : ''}</option>`)
        .join('')}</select></label>`
    : '';
  return `${it.errorSlots ? `<p class="v-error">${esc(it.errorSlots)}</p>` : ''}${lista}${cambiar}
    ${sel ? `<p class="v-note" style="margin-top:8px">Horario elegido: ${esc(NOMBRE_DIA.format(new Date(sel.fecha + 'T00:00:00Z')))}, ${hhmm(sel.horaInicio)} – ${hhmm(sel.horaFin)} con ${esc(sel.asesorNombre)}.</p>` : ''}`;
}
