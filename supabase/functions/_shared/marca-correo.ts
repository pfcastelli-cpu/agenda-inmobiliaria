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
    principal,
    accion,
    textoAccion: luz(accion) > 0.179 ? '#111111' : '#ffffff',
  };
}

// Bloque <img> del encabezado (vacío si la empresa no configuró imagen).
export function encabezadoImagen(marca: MarcaCorreo, alt: string): string {
  if (!marca.imagen) return `<div style="height:8px;background:${marca.accion}"></div>`;
  const a = alt.replace(/[&<>"']/g, '');
  return `<img src="${marca.imagen}" alt="${a}" width="580" style="width:100%;max-width:580px;height:auto;display:block" />`;
}
