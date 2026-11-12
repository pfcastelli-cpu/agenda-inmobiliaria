import { type MarcaCorreo, type TemaFoto } from './marca-correo.ts';
import { botonCorreo, botonesCorreo, correoBase } from './plantilla-correo.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function enlaceVisita(url: string, texto: string, marca: MarcaCorreo): string {
  if (!/^https:\/\//i.test(url) && !/^tel:\+?[0-9]+$/.test(url)) return '';
  const t = texto.toLowerCase();
  const variante = t.includes('waze') ? 'waze' : t.includes('maps') || t.includes('mapa') ? 'mapa' : t.includes('llama') ? 'llamar' : 'contorno';
  return botonCorreo(marca, { url, texto, variante });
}

export { botonCorreo, botonesCorreo };

// Botón «Confirmo que estaré» (arrendatario). Lleva al portal de esa visita, que confirma de una vez al abrir el enlace
// (así un antivirus o la vista previa del correo no confirman por error).
export function botonConfirmarAsistencia(url: string, marca: MarcaCorreo, texto = 'Confirmo que estaré'): string {
  if (!/^https:\/\//i.test(url)) return '';
  return `<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;margin:6px 0;background:${marca.accion};color:${marca.textoAccion};font-size:15px;line-height:1.4;font-weight:700;text-decoration:none;border-radius:8px">${esc(texto)}</a>`;
}

// Aviso para el cliente que va a una visita: el asesor tiene otra cita después y no puede esperar.
export const TEXTO_PUNTUALIDAD = {
  titulo: 'Tu asesor no puede esperar',
  cuerpo: 'Tu asesor tiene otra cita justo después de la tuya, así que no podrá esperarte. Te sugerimos llegar unos minutos antes: si llegas tarde, la visita puede acortarse o no realizarse. Si tienes un imprevisto, avísale cuanto antes por WhatsApp o llamada.',
  calendario: 'Tu asesor tiene otra cita después y no puede esperar. Llega unos minutos antes y, si tienes un imprevisto, avísale por WhatsApp o llamada.',
};

export function bloquePuntualidad(marca: MarcaCorreo): string {
  return `<div style="margin-top:16px;padding:12px 14px;border-left:4px solid ${marca.accion};background:#f4f6f8;border-radius:4px"><p style="margin:0 0 4px;font-weight:700;color:${marca.principal}">${esc(TEXTO_PUNTUALIDAD.titulo)}</p><p style="margin:0;font-size:14px;line-height:1.55">${esc(TEXTO_PUNTUALIDAD.cuerpo)}</p></div>`;
}

// cuerpo y despues son HTML escapado por el llamador. El botón, título y preheader se escapan aquí.
// puntualidad: añade el recuadro «Tu asesor no puede esperar» después del cuerpo (correos al cliente de una visita).
export function correoVisita(marca: MarcaCorreo, o: {
  titulo: string; preheader?: string; cuerpo: string; despues?: string; puntualidad?: boolean; tema?: TemaFoto;
  boton?: { texto: string; url: string }; modoPruebas: boolean; destinatarioReal: string; etiqueta?: string; motivo?: string;
}): string {
  return correoBase(marca, { ...o, tema: o.tema ?? 'visita', botones: o.boton ? [{ ...o.boton, variante: 'principal' }] : undefined, cuerpo: `${o.cuerpo}${o.puntualidad ? bloquePuntualidad(marca) : ''}` });
}
