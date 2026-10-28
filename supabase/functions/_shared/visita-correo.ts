import { pieContacto, type MarcaCorreo } from './marca-correo.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function enlaceVisita(url: string, texto: string, marca: MarcaCorreo): string {
  if (!/^https:\/\//i.test(url) && !/^tel:\+?[0-9]+$/.test(url)) return '';
  return `<a href="${esc(url)}" style="display:inline-block;padding:12px 0;margin-right:18px;color:${marca.principal};font-size:14px;line-height:1.5;text-decoration:underline">${esc(texto)}</a>`;
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
  titulo: string; preheader?: string; cuerpo: string; despues?: string; puntualidad?: boolean;
  boton?: { texto: string; url: string }; modoPruebas: boolean; destinatarioReal: string;
}): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#303b45">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(o.preheader)}</div>` : ''}
<div style="max-width:580px;margin:0 auto;padding:16px 12px">
${o.modoPruebas ? `<div style="padding:12px;background:#FEF3C7;color:#92400E;font-size:13px;margin-bottom:12px">MODO DE PRUEBAS: este correo iba dirigido en realidad a: ${esc(o.destinatarioReal)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dde3e7;border-top:4px solid ${marca.accion};border-radius:12px"><tr><td style="padding:20px">
${marca.logo ? `<img src="${esc(marca.logo)}" alt="${esc(marca.nombre)}" height="32" style="display:block;height:32px;width:auto;max-width:100%;margin-bottom:18px;border:0">` : `<p style="margin:0 0 18px;color:${marca.principal};font-size:14px;font-weight:700">${esc(marca.nombre)}</p>`}
<h1 style="margin:0 0 16px;color:${marca.principal};font-size:26px;line-height:1.2">${esc(o.titulo)}</h1>
<div style="font-size:15px;line-height:1.55;text-align:left">${o.cuerpo}</div>
${o.puntualidad ? bloquePuntualidad(marca) : ''}
${o.boton ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr><td align="center" bgcolor="${marca.accion}" style="border-radius:8px"><a href="${esc(o.boton.url)}" style="display:block;padding:16px 18px;background:${marca.accion};color:${marca.textoAccion};font-size:16px;line-height:1.4;font-weight:700;text-decoration:none;border-radius:8px">${esc(o.boton.texto)}</a></td></tr></table>` : ''}
${o.despues ? `<div style="font-size:14px;line-height:1.55;margin-top:18px;border-top:1px solid #dde3e7;padding-top:12px">${o.despues}</div>` : ''}
</td></tr></table>
${pieContacto(marca)}
</div></body></html>`;
}
