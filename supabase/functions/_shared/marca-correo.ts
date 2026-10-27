import { contactoEmpresa, contactoLegalCompleto, escaparContacto, htmlContacto, htmlLegal, type ContactoEmpresa } from './contacto-correo.ts';
// Marca de la empresa para los correos. Cada función de correo la lee de
// agenda_configuracion (columnas imagen_correo_url, color_principal, color_accion)
// para que cambiar de empresa no requiera tocar código: logo/imagen, colores y
// nombre salen de la configuración. Si la empresa no ha subido imagen, el correo
// sale sin imagen de encabezado en lugar de mostrar la de otra empresa.
export interface MarcaCorreo {
  nombre: string;
  contacto: ContactoEmpresa;
  fotosTematicas: boolean;
  imagen: string | null;
  logo: string | null;
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
    nombre: String(config?.nombre_comercial || config?.correo_remitente_nombre || 'Agenda de citas'),
    contacto: contactoEmpresa(config),
    fotosTematicas: config?.empresa?.slug === 'patrimonios',
    imagen: url.startsWith('https://') ? url : null,
    logo: String(config?.logo_url ?? '').trim().startsWith('https://') ? String(config.logo_url).trim() : null,
    principal,
    accion,
    textoAccion: luz(accion) > 0.179 ? '#111111' : '#ffffff',
  };
}

// Encabezado de marca: franja blanca con el logo centrado (sin línea de acento) y,
// debajo, la fotografía de la empresa (imagen_correo_url) a todo el ancho. Sin logo ni foto,
// queda solo el filo de color. Minimalista a propósito: la marca se nota por el orden, no por el ruido.
export type TemaFoto = 'visita' | 'hogar' | 'opinion' | 'ninguna';

// `tema` elige una fotografía realista con personas según el tipo de correo (archivos en aplicacion/public/correo/, que
// Netlify publica en citas.patrimonios.co/correo/). Solo se usan esas fotos con logo para la empresa de slug exacto patrimonios.
// En otras empresas y sin `tema`, usa la imagen propia (imagen_correo_url).
// 'ninguna' deja solo el logo (accesos, contraseñas, pruebas).
export function encabezadoImagen(marca: MarcaCorreo, alt: string, tema?: TemaFoto): string {
  const foto_url = tema === 'ninguna' ? null : tema && marca.fotosTematicas ? `https://citas.patrimonios.co/correo/foto-${tema}.jpg` : marca.imagen;
  const a = alt.replace(/[&<>"']/g, '');
  // Las fotos con personas ya llevan el logo incorporado: en esos correos no se repite arriba.
  const fotoConLogo = marca.fotosTematicas && (tema === 'visita' || tema === 'hogar' || tema === 'opinion');
  const logo = marca.logo && !fotoConLogo
    ? `<tr><td align="center" style="padding:30px 24px 24px;background:#ffffff"><img src="${marca.logo}" alt="${a}" height="44" border="0" style="height:44px;width:auto;max-width:240px;display:block;border:0;outline:none" /></td></tr>`
    : '';
  const foto = foto_url
    ? `<tr><td style="font-size:0;line-height:0"><img src="${foto_url}" alt="${a}" width="580" border="0" style="width:100%;max-width:580px;height:auto;display:block;border:0;outline:none" /></td></tr>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${logo}${foto}</table>`;
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

// Bloque de captación: SOLO para propietarios (nunca en accesos, contraseñas, cancelaciones ni avisos al
// arrendatario). Una idea, un botón. Sin cifras ni promesas que no estén confirmadas.
export function bloqueCaptacion(marca: MarcaCorreo): string {
  if (!contactoLegalCompleto(marca.contacto) || !marca.contacto.correo) return '';
  const asunto = encodeURIComponent('Quiero consignar un inmueble');
  return `<div style="padding:6px 26px 28px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:#f4f4f4;border-radius:24px;padding:26px 24px;text-align:center">
          <div style="font-size:12px;color:#6b6b6b;margin-bottom:6px">📣 Publicidad</div>
          <div style="font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;font-size:20px;line-height:1.3;color:${marca.principal};margin:0 0 6px">¿Tienes otro inmueble? 🏡</div>
          <div style="font-size:15px;line-height:1.6;color:#4d4d4d;margin:0 0 18px">Consígnanoslo y lo cuidamos con la misma tranquilidad. 🤝</div>
          <a href="mailto:${escaparContacto(marca.contacto.correo)}?subject=${asunto}" target="_blank" style="display:inline-block;padding:14px 26px;background:${marca.principal};color:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;text-decoration:none;border-radius:999px">🤝&nbsp; Quiero consignar un inmueble</a>
        </td>
      </tr></table>
    </div>`;
}

// Pie de la misma empresa, sin datos legales de respaldo de otra inmobiliaria.
export function pieLegal(marca: MarcaCorreo, urlPreferencias?: string): string { return htmlLegal(marca.contacto, urlPreferencias); }

// Emoji que acompaña al título del correo cuando el título llega como variable.
export function emojiTitulo(titulo: string): string {
  const t = String(titulo || '').toLowerCase();
  if (/cancel/.test(t)) return '😕';
  if (/contrase/.test(t)) return '🔑';
  if (/acceso|invit|bienvenid/.test(t)) return '👋';
  if (/informe/.test(t)) return '📊';
  if (/asesor|solicit|pedido|pide/.test(t)) return '📩';
  if (/cambi|hora|propone|propuesta|nueva/.test(t)) return '🔄';
  if (/confirm|acept|list/.test(t)) return '🎉';
  if (/visita/.test(t)) return '🏡';
  return '✨';
}

// Contacto de la empresa de esta comunicación.
export function pieContacto(marca: MarcaCorreo): string { return htmlContacto(marca.contacto); }
