import { encabezadoImagen, pieContacto, type MarcaCorreo, type TemaFoto } from './marca-correo.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export type BotonCorreo = { texto: string; url: string; variante?: 'principal' | 'contorno' | 'mapa' | 'waze' | 'llamar' | 'whatsapp' };

function textoBoton(boton: BotonCorreo): string {
  const original = String(boton.texto || '').trim();
  if (/^\p{Extended_Pictographic}/u.test(original)) return original;
  const t = `${original} ${boton.url}`.toLowerCase();
  const emoji = boton.variante === 'mapa' || /google\.com\/maps|maps\.google/.test(t) ? '📍'
    : boton.variante === 'waze' || /waze\.com/.test(t) ? '🚗'
      : boton.variante === 'llamar' || /^tel:/.test(t) ? '📞'
        : boton.variante === 'whatsapp' || /wa\.me|whatsapp/.test(t) ? '💬'
          : boton.variante === 'principal' && /gestionar|visita/.test(t) ? '📅' : '';
  return emoji ? `${emoji} ${original}` : original;
}

const colores = (marca: MarcaCorreo, variante: BotonCorreo['variante'] = 'principal') => {
  if (variante === 'contorno' || variante === 'mapa' || variante === 'waze' || variante === 'llamar' || variante === 'whatsapp') {
    return `background:#ffffff;color:${marca.principal};border:2px solid ${marca.principal}`;
  }
  return `background:${marca.accion};color:${marca.textoAccion};border:2px solid ${marca.accion}`;
};

export function botonCorreo(marca: MarcaCorreo, boton: BotonCorreo): string {
  if (!/^https:\/\//i.test(boton.url) && !/^tel:\+?[0-9]+$/.test(boton.url) && !/^mailto:/i.test(boton.url)) return '';
  return `<a href="${esc(boton.url)}" target="_blank" style="display:block;width:100%;max-width:260px;box-sizing:border-box;padding:14px 20px;margin:8px auto;border-radius:999px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.25;font-weight:700;text-decoration:none;${colores(marca, boton.variante)}">${esc(textoBoton(boton))}</a>`;
}

export function botonesCorreo(marca: MarcaCorreo, botones: BotonCorreo[]): string {
  return botones.filter((b) => b.url).length
    ? `<div style="margin:22px -4px 0;text-align:center">${botones.map((b) => botonCorreo(marca, b)).join('')}</div>`
    : '';
}

export function filaCorreo(marca: MarcaCorreo, etiqueta: string, valor: string): string {
  return valor ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ebee;color:#63707a;font-size:13px;width:36%;vertical-align:top">${esc(etiqueta)}</td><td style="padding:10px 0;border-bottom:1px solid #e7ebee;color:${marca.principal};font-size:15px;font-weight:600;overflow-wrap:anywhere">${esc(valor)}</td></tr>` : '';
}

export function correoBase(marca: MarcaCorreo, o: {
  titulo: string; preheader?: string; cuerpo: string; despues?: string; tema?: TemaFoto;
  botones?: BotonCorreo[]; modoPruebas?: boolean; destinatarioReal?: string;
  // etiqueta: línea pequeña sobre el título que dice de qué trata el correo y a quién va (ej. «Aviso al propietario · Inmueble 123»).
  // motivo: línea al pie que explica por qué se envió y en qué momento (ej. «Te lo enviamos porque se canceló una visita»).
  etiqueta?: string; motivo?: string;
}): string {
  const aviso = o.modoPruebas && o.destinatarioReal
    ? `<div style="padding:12px 16px;margin-bottom:16px;border:1px solid #f3d27a;border-radius:12px;background:#fff8df;color:#765400;font-size:13px;line-height:1.45;font-weight:600">MODO DE PRUEBAS: este correo iba dirigido en realidad a: ${esc(o.destinatarioReal)}</div>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#303b45"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(o.preheader || o.titulo)}</div><div style="max-width:580px;margin:0 auto;padding:20px 12px">${aviso}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dde3e7;border-radius:24px;overflow:hidden;background:#ffffff"><tr><td>${encabezadoImagen(marca, o.titulo, o.tema || 'ninguna')}</td></tr><tr><td style="padding:28px 26px 26px">${o.etiqueta ? `<div style="margin:0 0 8px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#63707a;font-weight:700">${esc(o.etiqueta)}</div>` : ''}<h1 style="margin:0 0 16px;color:${marca.principal};font-size:26px;line-height:1.22;font-weight:700">${esc(o.titulo)}</h1><div style="font-size:15px;line-height:1.65;text-align:left">${o.cuerpo}</div>${o.botones?.length ? botonesCorreo(marca, o.botones) : ''}${o.despues ? `<div style="font-size:14px;line-height:1.6;margin-top:20px;border-top:1px solid #dde3e7;padding-top:16px">${o.despues}</div>` : ''}</td></tr></table>${o.motivo ? `<p style="margin:14px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:#7a858e">${esc(o.motivo)}</p>` : ''}${pieContacto(marca)}</div></body></html>`;
}
