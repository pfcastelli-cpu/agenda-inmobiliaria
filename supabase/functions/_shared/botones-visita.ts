// Botones para el cliente que va a una visita: cómo llegar (Maps y Waze), hablar con el asesor (WhatsApp y llamada).
// Solo aparecen los que tienen a dónde apuntar. Devuelve HTML listo para poner en el correo.
import type { MarcaCorreo } from './marca-correo.ts';
import { botonesCorreo, type BotonCorreo } from './plantilla-correo.ts';

export function botonesVisitaCliente(marca: MarcaCorreo, o: {
  latitud?: number | string | null; longitud?: number | string | null; direccion?: string; asesorNombre?: string; asesorCelular?: string; fechaTexto?: string; horaTexto?: string;
}): string {
  const coords = o.latitud != null && o.longitud != null && o.latitud !== '' && o.longitud !== '';
  const q = o.direccion ? encodeURIComponent(`${o.direccion}, Colombia`) : '';
  const waze = coords ? `https://waze.com/ul?ll=${o.latitud},${o.longitud}&navigate=yes` : q ? `https://waze.com/ul?q=${q}&navigate=yes` : null;
  const maps = coords ? `https://www.google.com/maps/search/?api=1&query=${o.latitud},${o.longitud}` : q ? `https://www.google.com/maps/search/?api=1&query=${q}` : null;
  const cel = String(o.asesorCelular || '').replace(/[^0-9]/g, '');
  const wa = cel ? `https://wa.me/${cel.length === 10 && cel.startsWith('3') ? '57' + cel : cel}?text=${encodeURIComponent(`Hola${o.asesorNombre ? ' ' + o.asesorNombre : ''}, te escribo por mi visita${o.fechaTexto ? ' del ' + o.fechaTexto : ''}${o.horaTexto ? ' a las ' + o.horaTexto : ''}.`)}` : null;
  const botones = ([
    { texto: 'Cómo llegar (Google Maps)', url: maps, variante: 'mapa' },
    { texto: 'Cómo llegar (Waze)', url: waze, variante: 'waze' },
    { texto: o.asesorNombre ? `Escribir a ${o.asesorNombre} por WhatsApp` : 'Escribir al asesor por WhatsApp', url: wa, variante: 'whatsapp' },
    { texto: o.asesorNombre ? `Llamar a ${o.asesorNombre}` : 'Llamar al asesor', url: cel ? `tel:+${cel.length === 10 && cel.startsWith('3') ? '57' + cel : cel}` : null, variante: 'llamar' },
  ] as { texto: string; url: string | null; variante: BotonCorreo['variante'] }[]).filter((b) => !!b.url) as BotonCorreo[];
  return botones.length ? botonesCorreo(marca, botones) : '';
}
