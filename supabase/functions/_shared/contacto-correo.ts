// Contrato de contacto por empresa. Sin consultas ni valores de otra inmobiliaria.
export interface TelefonoEmpresa { etiqueta: string; numero: string; extension: string; enlace: string }
export interface SedeEmpresa { nombre: string; ciudad: string; telefonos: TelefonoEmpresa[] }
export interface ContactoEmpresa {
  nombre: string; correo: string; sitioWeb: string; razonSocial: string; nit: string;
  direccion: string; politicaDatos: string; correoBaja: string; sedes: SedeEmpresa[];
}

const texto = (v: unknown, max = 160): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
const objeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const escaparContacto = (v: string): string => v.replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function correoSeguro(v: unknown): string {
  const s = texto(v, 254);
  return /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(s) ? s : '';
}
function urlSegura(v: unknown): string {
  const s = texto(v, 1000);
  if (!s || /[\s<>"'\x00-\x1f]/.test(s)) return '';
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
  catch { return ''; }
}
function telefonoSeguro(v: unknown): TelefonoEmpresa | null {
  const p = objeto(v), numero = texto(p.numero, 40), extension = texto(p.extension, 8);
  const digitos = numero.replace(/\D/g, '');
  if (!/^\+?[\d ().-]+$/.test(numero) || digitos.length < 7 || digitos.length > 15 || (extension && !/^\d{1,8}$/.test(extension))) return null;
  return { etiqueta: texto(p.etiqueta, 60), numero, extension,
    enlace: `tel:${numero.startsWith('+') ? '+' : ''}${digitos}${extension ? `;ext=${extension}` : ''}` };
}

export function contactoEmpresa(config: unknown): ContactoEmpresa {
  const c = objeto(config), datos = objeto(c.contacto_empresa);
  const sedes: SedeEmpresa[] = (Array.isArray(datos.sedes) ? datos.sedes : []).slice(0, 20).flatMap(v => {
    const sede = objeto(v);
    const telefonos = (Array.isArray(sede.telefonos) ? sede.telefonos : []).slice(0, 10)
      .map(telefonoSeguro).filter((p): p is TelefonoEmpresa => p !== null);
    return telefonos.length ? [{ nombre: texto(sede.nombre, 100), ciudad: texto(sede.ciudad, 100), telefonos }] : [];
  });
  // Compatibilidad solo con el teléfono general de ESTA fila de configuración.
  const general = telefonoSeguro({ numero: c.telefono });
  if (!sedes.length && general) sedes.push({ nombre: '', ciudad: '', telefonos: [general] });
  const correo = correoSeguro(c.correo_contacto);
  return { nombre: texto(c.nombre_comercial, 120), correo, sitioWeb: urlSegura(datos.sitio_web),
    razonSocial: texto(datos.razon_social, 180), nit: texto(datos.nit, 40), direccion: texto(datos.direccion, 400),
    politicaDatos: urlSegura(datos.politica_datos_url), correoBaja: correoSeguro(datos.correo_baja) || correo, sedes };
}

export function contactoLegalCompleto(c: ContactoEmpresa): boolean {
  return !!(c.razonSocial && c.nit && c.direccion && c.politicaDatos && c.correoBaja);
}

export function htmlContacto(c: ContactoEmpresa): string {
  const lineas = c.sedes.map(s => {
    const titulo = [s.nombre, s.ciudad].filter(Boolean).join(' · ');
    const numeros = s.telefonos.map(p => `<a href="${escaparContacto(p.enlace)}" style="color:inherit;text-decoration:underline">${escaparContacto(p.etiqueta ? `${p.etiqueta}: ` : '')}${escaparContacto(p.numero)}${p.extension ? ` ext. ${escaparContacto(p.extension)}` : ''}</a>`).join(' · ');
    return `${titulo ? `${escaparContacto(titulo)}: ` : ''}${numeros}`;
  });
  const canales = [c.correo ? `<a href="mailto:${escaparContacto(c.correo)}" style="color:inherit;text-decoration:underline">${escaparContacto(c.correo)}</a>` : '',
    c.sitioWeb ? `<a href="${escaparContacto(c.sitioWeb)}" style="color:inherit;text-decoration:underline">${escaparContacto(c.sitioWeb.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a>` : ''].filter(Boolean);
  if (canales.length) lineas.push(canales.join(' · '));
  return lineas.length ? `<p style="text-align:center;color:#6b6b6b;font-size:13px;line-height:1.8;margin:6px 8px 0;overflow-wrap:anywhere">${lineas.join('<br>')}</p>` : '';
}

export function htmlLegal(c: ContactoEmpresa, urlPreferencias?: string): string {
  const lineas = [c.razonSocial || c.nombre, c.nit ? `NIT ${c.nit}` : '', c.direccion].filter(Boolean).map(escaparContacto);
  if (c.politicaDatos) lineas.push(`<a href="${escaparContacto(c.politicaDatos)}" style="color:inherit;text-decoration:underline">Política de tratamiento de datos</a>`);
  if (urlPreferencias) lineas.push(`Elige cuándo recibir estos correos (con cada visita, resumen semanal o mensual, o ninguno) y si quieres recibir publicidad: <a href="${escaparContacto(urlPreferencias)}" style="color:inherit;text-decoration:underline">administra tus preferencias</a>.`);
  else if (contactoLegalCompleto(c)) lineas.push(`Para dejar de recibir comunicaciones comerciales, <a href="mailto:${escaparContacto(c.correoBaja)}?subject=Baja%20de%20comunicaciones%20comerciales" style="color:inherit;text-decoration:underline">solicita la baja</a>. Seguirás recibiendo los avisos de tus inmuebles.`);
  return `${htmlContacto(c)}${lineas.length ? `<p style="text-align:center;color:#6b6b6b;font-size:12px;line-height:1.6;margin:18px 8px 0;overflow-wrap:anywhere">${lineas.join('<br>')}</p>` : ''}`;
}
