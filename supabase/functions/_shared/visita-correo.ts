import { pieContacto, type MarcaCorreo } from './marca-correo.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function enlaceVisita(url: string, texto: string, marca: MarcaCorreo): string {
  if (!/^https:\/\//i.test(url) && !/^tel:\+?[0-9]+$/.test(url)) return '';
  return `<a href="${esc(url)}" style="display:inline-block;padding:12px 0;margin-right:18px;color:${marca.principal};font-size:14px;line-height:1.5;text-decoration:underline">${esc(texto)}</a>`;
}

// cuerpo y despues son HTML escapado por el llamador. El botón, título y preheader se escapan aquí.
export function correoVisita(marca: MarcaCorreo, o: {
  titulo: string; preheader?: string; cuerpo: string; despues?: string;
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
${o.boton ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr><td align="center" bgcolor="${marca.accion}" style="border-radius:8px"><a href="${esc(o.boton.url)}" style="display:block;padding:16px 18px;background:${marca.accion};color:${marca.textoAccion};font-size:16px;line-height:1.4;font-weight:700;text-decoration:none;border-radius:8px">${esc(o.boton.texto)}</a></td></tr></table>` : ''}
${o.despues ? `<div style="font-size:14px;line-height:1.55;margin-top:18px;border-top:1px solid #dde3e7;padding-top:12px">${o.despues}</div>` : ''}
</td></tr></table>
${pieContacto(marca)}
</div></body></html>`;
}
