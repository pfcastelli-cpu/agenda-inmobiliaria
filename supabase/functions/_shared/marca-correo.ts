// Marca de la empresa para los correos. Cada función de correo la lee de
// agenda_configuracion (columnas imagen_correo_url, color_principal, color_accion)
// para que cambiar de empresa no requiera tocar código: logo/imagen, colores y
// nombre salen de la configuración. Si la empresa no ha subido imagen, el correo
// sale sin imagen de encabezado en lugar de mostrar la de otra empresa.
export interface MarcaCorreo {
  imagen: string | null;
  principal: string;
  accion: string;
  textoAccion: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function luz(h: string): number {
  const c = h.slice(1).match(/../g)!.map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

// deno-lint-ignore no-explicit-any
export function marcaCorreo(config: any): MarcaCorreo {
  const principal = HEX.test(config?.color_principal ?? '') ? config.color_principal : '#1A2C45';
  const accion = HEX.test(config?.color_accion ?? '') ? config.color_accion : '#00A9A5';
  const url = String(config?.imagen_correo_url ?? '').trim();
  return {
    imagen: url.startsWith('https://') ? url : null,
    logo: String(config?.logo_url ?? '').trim().startsWith('https://') ? String(config.logo_url).trim() : null,
    principal,
    accion,
    textoAccion: luz(accion) > 0.179 ? '#111111' : '#ffffff',
  };
}

// Encabezado de marca: franja blanca con el logo centrado, filo fino del color de acción y,
// debajo, la fotografía de la empresa (imagen_correo_url) a todo el ancho. Sin logo ni foto,
// queda solo el filo de color. Minimalista a propósito: la marca se nota por el orden, no por el ruido.
export type TemaFoto = 'fachada' | 'sala' | 'conjunto' | 'llaves' | 'ninguna';

// `tema` elige una fotografía realista según el tipo de correo (archivos en aplicacion/public/correo/, que
// Netlify publica en citas.patrimonios.co/correo/). Sin `tema` usa la foto única de la empresa (imagen_correo_url).
// 'ninguna' deja solo el logo (accesos, contraseñas, pruebas).
export function encabezadoImagen(marca: MarcaCorreo, alt: string, tema?: TemaFoto): string {
  const foto_url = tema === 'ninguna' ? null : tema ? `https://citas.patrimonios.co/correo/foto-${tema}.jpg` : marca.imagen;
  const a = alt.replace(/[&<>"']/g, '');
  const logo = marca.logo
    ? `<tr><td align="center" style="padding:30px 24px 24px;background:#ffffff"><img src="${marca.logo}" alt="${a}" height="44" border="0" style="height:44px;width:auto;max-width:240px;display:block;border:0;outline:none" /></td></tr>`
    : '';
  const foto = foto_url
    ? `<tr><td style="font-size:0;line-height:0"><img src="${foto_url}" alt="${a}" width="580" border="0" style="width:100%;max-width:580px;height:auto;display:block;border:0;outline:none" /></td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${logo}<tr><td style="height:3px;line-height:3px;font-size:0;background:${marca.accion}">&nbsp;</td></tr>${foto}</table>`;
}

// Enlace para VER el inmueble en el sitio de la empresa (plantilla con {numero}); si la empresa no la
// configuró, cae a la página pública de agendamiento.
// deno-lint-ignore no-explicit-any
export function enlaceInmueble(config: any, numero: number | string): string {
  const plantilla = String(config?.plantilla_enlace_inmueble ?? '');
  const dominio = String(config?.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const respaldo = `https://${dominio}/inmuebles/${encodeURIComponent(String(numero))}`;
  if (!plantilla.includes('{numero}')) return respaldo;
  const url = plantilla.replace(/\{numero\}/g, encodeURIComponent(String(numero))).replace(/["'<>\s]/g, '');
  return /^https:\/\//i.test(url) ? url : respaldo;
}

// Datos legales de Patrimonios para el pie de los correos con publicidad (Ley 1581 de 2012: identificar al
// responsable). Hoy son fijos porque agenda_configuracion no tiene columnas de NIT ni dirección; si se vende
// a otra inmobiliaria, hay que moverlos a la configuración.
const LEGAL = {
  razon: 'Patrimonios Inmobiliarios S.A.S.',
  nit: '900.140.990-1',
  direccion: 'Carrera 67 (Av. Boyacá) Nº 167-61, Of. 203, Centro Empresarial Colina Office Park, Bogotá',
  politica: 'https://www.patrimonios.co/politicas/politica-de-tratamiento-de-datos',
  correo: 'info@patrimonios.co',
};

// Bloque de captación: SOLO para propietarios (nunca en accesos, contraseñas, cancelaciones ni avisos al
// arrendatario). Una idea, un botón. Sin cifras ni promesas que no estén confirmadas.
export function bloqueCaptacion(marca: MarcaCorreo): string {
  const asunto = encodeURIComponent('Quiero consignar un inmueble');
  return `<div style="padding:6px 26px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:#f1efe9;border-radius:2px;padding:22px 24px;border-left:3px solid ${marca.accion}">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a857b;margin-bottom:6px">Publicidad</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.3;color:${marca.principal};margin:0 0 6px">¿Tienes otro inmueble?</div>
          <div style="font-size:15px;line-height:1.55;color:#4d4d4d;margin:0 0 16px">Consígnanoslo y lo cuidamos con la misma tranquilidad.</div>
          <a href="mailto:${LEGAL.correo}?subject=${asunto}" target="_blank" style="display:inline-block;padding:13px 22px;background:${marca.principal};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border-radius:2px">Quiero consignar un inmueble</a>
        </td>
      </tr></table>
    </div>`;
}

// Pie legal para correos con publicidad: responsable, NIT, dirección, política y baja.
export function pieLegal(): string {
  const baja = encodeURIComponent('Baja de comunicaciones comerciales');
  return `<p style="text-align:center;color:#6b665c;font-size:12px;line-height:1.6;margin:18px 8px 0">${LEGAL.razon} · NIT ${LEGAL.nit}<br>${LEGAL.direccion}<br>Tratamos tus datos conforme a la <a href="${LEGAL.politica}" style="color:#6b665c;text-decoration:underline">Política de Tratamiento de Datos</a> (Ley 1581 de 2012). Si no quieres recibir publicidad nuestra, <a href="mailto:${LEGAL.correo}?subject=${baja}" style="color:#6b665c;text-decoration:underline">escríbenos para darte de baja</a>; seguirás recibiendo los avisos de tus inmuebles.</p>`;
}
