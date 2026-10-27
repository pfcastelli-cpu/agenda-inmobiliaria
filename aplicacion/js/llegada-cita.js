// «Llegué a la visita»: guarda la ubicación del asesor SOLO en el instante del toque (no hay rastreo) y la compara con el inmueble.
// La regla vive en la base (agenda_registrar_llegada, sql/031); aquí solo se pide el permiso del navegador y se muestra el resultado.
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML para la tarjeta de la cita. hoyISO = fecha de hoy (YYYY-MM-DD) en la hora de Colombia.
export function htmlLlegada(cita, hoyISO) {
  if (cita.tipo_cita !== 'visita_cliente' || cita.estado === 'cancelada') return '';
  if (cita.llegada_en) {
    const hora = new Date(cita.llegada_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    const lejos = cita.llegada_valida === false ? ` · a ${esc(cita.llegada_distancia_m)} m del inmueble` : '';
    return `<p class="v-note" style="margin:6px 0 0">${cita.llegada_valida === false ? '⚠️' : '✅'} Llegada registrada a las ${esc(hora)}${lejos}</p>`;
  }
  if (cita.fecha !== hoyISO) return '';
  return `<div class="v-actions" style="margin-top:8px"><button data-llegada="${esc(cita.id)}">Llegué a la visita</button></div>`;
}

// Pide la ubicación, la manda a la base y devuelve {ok, texto}. Nunca lanza.
export async function registrarLlegada(citaId) {
  if (!confirm('Se guardará tu ubicación solo en este momento, para confirmar que llegaste al inmueble. No se sigue tu recorrido. ¿Continuar?')) return { ok: false, cancelado: true };
  if (!navigator.geolocation) return { ok: false, texto: 'Este navegador no puede dar la ubicación.' };
  const pos = await new Promise((resolver) => {
    navigator.geolocation.getCurrentPosition((p) => resolver(p), () => resolver(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  if (!pos) return { ok: false, texto: 'No se pudo obtener tu ubicación. Revisa el permiso del navegador e inténtalo de nuevo.' };
  const { data, error } = await supabase.rpc('agenda_registrar_llegada', { p_cita_id: citaId, p_lat: pos.coords.latitude, p_lon: pos.coords.longitude });
  if (error) return { ok: false, texto: error.message };
  if (data?.valida === false) return { ok: true, texto: `Llegada registrada, pero estás a ${data.distancia_m} m del inmueble.` };
  return { ok: true, texto: 'Llegada registrada. ¡Buena visita!' };
}
