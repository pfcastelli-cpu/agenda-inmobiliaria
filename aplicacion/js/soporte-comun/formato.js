// Funciones puras de formato del soporte (sin DOM ni red): se prueban con `node --test tests/soporte.test.mjs`.
export const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Los errores de Postgres llegan como «P0001: texto»; al usuario solo le sirve el texto.
export const limpiarError = (m) => String(m || '').replace(/^.*?:\s*/, '') || 'No se pudo completar la acción.';

const ZONA = 'America/Bogota';
export const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONA }) : '');
export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: ZONA }) : '');

// «hace 5 min», «hace 3 h», «hace 2 días»; pasados 7 días, la fecha corta.
export function hace(iso, ahora = Date.now()) {
  if (!iso) return '';
  const min = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  if (min < 60 * 24 * 7) { const d = Math.round(min / 1440); return `hace ${d} ${d === 1 ? 'día' : 'días'}`; }
  return fechaCorta(iso);
}

export const estrellas = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));

// Minutos → «45 min», «3.5 h», «2.4 días». null → «—».
export function duracionMin(min) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  if (min < 60 * 48) return `${Math.round(min / 6) / 10} h`;
  return `${Math.round(min / 144) / 10} días`;
}

// Minutos que faltan (positivo) o pasaron (negativo) para la primera respuesta; null si ya no aplica.
export function minutosParaSla(t, ahora = Date.now()) {
  if (t.primera_respuesta_en || !['abierto', 'en_revision'].includes(t.estado) || !t.vence_primera_en) return null;
  return Math.round((new Date(t.vence_primera_en).getTime() - ahora) / 60000);
}
