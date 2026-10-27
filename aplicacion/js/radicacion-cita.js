// Botón «Enviar información para radicar» en la tarjeta de una visita: manda (o reenvía) al cliente el correo con el estudio de arrendatario
// y avisa al asesor. La función enviar-radicacion-cliente decide si hay datos para la ciudad del inmueble (sql/033).
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function htmlBotonRadicar(cita) {
  if (cita.tipo_cita !== 'visita_cliente' || cita.estado === 'cancelada' || !cita.cliente_email || !cita.inmueble_id) return '';
  const texto = cita.radicacion_enviada_en ? 'Reenviar información para radicar' : 'Enviar información para radicar';
  return `<div class="v-actions" style="margin-top:8px"><button data-radicar="${esc(cita.id)}">${texto}</button></div>${cita.radicacion_enviada_en ? '<p class="v-note" style="margin:4px 0 0">📨 Ya se le envió al cliente cómo radicar su estudio.</p>' : ''}`;
}

// Devuelve el texto para mostrar en el aviso. Nunca lanza.
export async function enviarRadicacion(citaId) {
  try {
    const { data, error } = await supabase.functions.invoke('enviar-radicacion-cliente', { body: { cita_id: citaId, forzar: true } });
    if (error || !data?.ok) return data?.error || 'No se pudo enviar la información.';
    return data.enviado ? 'Información para radicar enviada al cliente y aviso al asesor.' : data.motivo || 'No se envió.';
  } catch {
    return 'No se pudo conectar con el servicio de correo.';
  }
}
