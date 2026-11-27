// Dirección de cada inmueble (conjunto, apartamento…) para mostrarla junto al número: las personas reconocen el inmueble por su dirección, no por el código.
// Se carga una vez por sesión desde agenda_inmuebles (lectura permitida por RLS) y se consulta de forma síncrona.
let mapa = new Map();
let cargadoPara = '';

const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export async function cargarDirecciones(supabase, empresaId) {
  if (cargadoPara === empresaId && mapa.size) return;
  try {
  const nuevo = new Map();
  for (let desde = 0; desde < 5000; desde += 1000) {
    const { data, error } = await supabase.from('agenda_inmuebles').select('numero_inmueble,direccion').eq('empresa_id', empresaId).range(desde, desde + 999);
    if (error || !data) break;
    data.forEach((r) => { if (r.numero_inmueble != null && r.direccion) nuevo.set(String(r.numero_inmueble), limpiar(r.direccion)); });
    if (data.length < 1000) break;
  }
  if (nuevo.size) { mapa = nuevo; cargadoPara = empresaId; }
  } catch { /* sin direcciones se muestra el número, como antes */ }
}

/** Dirección del inmueble por su número, o '' si no se conoce. */
export const dirInmueble = (cod) => (cod == null || cod === '' ? '' : mapa.get(String(cod).trim()) || '');

/** Texto para mostrar: «dirección (N° 344)»; si no hay dirección, «Inmueble 344». */
export function rotuloInmueble(cod) {
  if (cod == null || cod === '') return '';
  const d = dirInmueble(cod);
  return d ? `${d} (N° ${cod})` : `Inmueble ${cod}`;
}

/** Línea de ubicación de un caso: dirección si se conoce; si no, conjunto · unidad. */
export function ubicacionCaso(c) {
  const d = dirInmueble(c?.datos?.n_inmueble);
  return d || [c?.copropiedad, c?.unidad].filter(Boolean).join(' · ');
}

/** Todos los inmuebles conocidos [{cod, direccion}] para el buscador del formulario «Nuevo caso». */
export const listaInmuebles = () => [...mapa.entries()].map(([cod, direccion]) => ({ cod, direccion })).sort((a, b) => a.direccion.localeCompare(b.direccion, 'es'));
