// Lectura de los Excel de los portales y comparación contra el inventario de Sedi.
// Lógica pura (sin pantalla ni base de datos) para poder probarla con los archivos reales.

export const PORTALES = {
  fincaraiz: { nombre: 'Fincaraíz', columnaSedi: 'codigo_fincaraiz' },
  metrocuadrado: { nombre: 'Metrocuadrado', columnaSedi: 'codigo_metrocuadrado' },
  ciencuadras: { nombre: 'Ciencuadras', columnaSedi: 'codigo_ciencuadras' },
};

// Un inmueble en estas condiciones DEBE estar publicado (si además tiene código de portal en Sedi).
const ESTADOS_PUBLICABLES = ['disponible', 'rentando'];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Lee un .xlsx y detecta de qué portal es. Devuelve { portal, registros } con solo las publicaciones activas. */
export async function leerExcelPortal(buffer) {
  // La librería de Excel pesa bastante: solo se descarga cuando alguien sube un archivo.
  const XLSX = await import('xlsx');
  const libro = XLSX.read(buffer, { type: 'array' });
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, defval: '', raw: true });
  // El encabezado no siempre está en la fila 1 (Metrocuadrado trae un preámbulo): se busca la primera
  // fila que tenga una columna de código.
  let ini = -1;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const celdas = filas[i].map(norm);
    if (celdas.includes('codigo de inmueble') || celdas.includes('codigo del inmueble') || celdas.includes('codigo')) { ini = i; break; }
  }
  if (ini < 0) throw new Error('No encontré la columna de código en el archivo. ¿Es el Excel de un portal?');
  const cab = filas[ini].map(norm);
  const col = (...nombres) => { for (const n of nombres) { const k = cab.indexOf(n); if (k >= 0) return k; } return -1; };

  let portal;
  if (cab.includes('codigo inmobiliaria') && cab.includes('codigo de inmueble')) portal = 'fincaraiz';
  else if (cab.includes('codigo del inmueble') && cab.includes('estado publicacion')) portal = 'metrocuadrado';
  else if (cab.includes('codigo') && cab.includes('tipo transaccion')) portal = 'ciencuadras';
  else throw new Error('No reconozco el formato de este archivo (no parece de Fincaraíz, Metrocuadrado ni Ciencuadras).');

  const registros = [];
  for (const f of filas.slice(ini + 1)) {
    let r;
    if (portal === 'fincaraiz') {
      const codigo = String(f[col('codigo de inmueble')] ?? '').trim();
      if (!codigo || norm(f[col('estado')]) !== 'activo') continue;
      const oferta = norm(f[col('tipo de oferta')]).startsWith('v') ? 'venta' : 'arriendo';
      const precio = num(f[col('precio')]);
      r = { codigo, oferta, precioVenta: oferta === 'venta' ? precio : 0, precioCanon: oferta === 'arriendo' ? precio : 0,
            referencia: [f[col('direccion')], f[col('barrio / vereda')], f[col('ciudad')]].filter(Boolean).join(' · ') };
    } else if (portal === 'ciencuadras') {
      const codigo = String(f[col('codigo')] ?? '').trim();
      if (!codigo || norm(f[col('estado')]) !== 'activo') continue;
      const oferta = norm(f[col('tipo transaccion')]).startsWith('v') ? 'venta' : 'arriendo';
      r = { codigo, oferta, precioVenta: num(f[col('precio de venta')]), precioCanon: num(f[col('canon arrendamiento')]),
            referencia: [f[col('direccion')], f[col('barrio')], f[col('ciudad')]].filter(Boolean).join(' · ') };
    } else {
      const codigo = String(f[col('codigo del inmueble')] ?? '').trim();
      const estado = norm(f[col('estado publicacion')]);
      if (!codigo || !(estado === 'publicado' || estado === 'republicado')) continue;
      const oferta = norm(f[col('tipo de negocio')]).startsWith('v') ? 'venta' : 'arriendo';
      r = { codigo, oferta, precioVenta: num(f[col('valor venta')]), precioCanon: num(f[col('valor arriendo')]),
            referencia: [f[col('nombre del inmueble')], f[col('direccion inmueble')]].filter(Boolean).join(' · ') };
    }
    registros.push(r);
  }
  return { portal, registros };
}

const moneda = (n) => '$' + Math.round(n).toLocaleString('es-CO');

/**
 * Compara las publicaciones activas de UN portal con Sedi.
 * inmuebles: filas de agenda_inmuebles. Devuelve la lista de pendientes sugeridos.
 */
export function compararPortal(portal, registros, inmuebles) {
  const { nombre, columnaSedi } = PORTALES[portal];
  const activos = new Map(registros.map((r) => [r.codigo, r]));
  const porCodigoSedi = new Map();
  for (const i of inmuebles) { const c = (i[columnaSedi] || '').trim(); if (c) porCodigoSedi.set(c, i); }

  const items = [];
  const responsable = (i) => i.asesor_comercializacion || i.asesor_captacion || '';
  const ofertaSedi = (i) => (norm(i.tipo_oferta).startsWith('v') ? 'venta' : 'arriendo');
  const publicable = (i) => ESTADOS_PUBLICABLES.includes(norm(i.estado_crm));

  // 1) Sedi dice que debe estar publicado (tiene código del portal) y el portal no lo muestra activo.
  for (const [codigo, i] of porCodigoSedi) {
    if (activos.has(codigo) || !publicable(i)) continue;
    items.push({
      tipo: 'publicar', numero_inmueble: i.numero_inmueble, clave: `portal:${portal}:publicar:${i.numero_inmueble}`,
      titulo: `Publicar inmueble ${i.numero_inmueble} en ${nombre}`,
      detalle: `Sedi tiene el código ${codigo} para ${nombre} y el inmueble está ${i.estado_crm}, pero no aparece activo en el archivo del portal. ${i.direccion || ''}`.trim(),
      responsable_nombre: responsable(i), datos: { codigo, estado_crm: i.estado_crm },
    });
  }

  for (const [codigo, r] of activos) {
    const i = porCodigoSedi.get(codigo);
    if (!i) {
      // 2) Publicado en el portal sin código en Sedi: por la regla de la empresa, no debería estar publicado.
      items.push({
        tipo: 'revisar_codigo', numero_inmueble: null, clave: `portal:${portal}:revisar_codigo:${codigo}`,
        titulo: `Publicación ${codigo} en ${nombre} sin código en Sedi`,
        detalle: `Está activa en ${nombre} pero ningún inmueble de Sedi tiene ese código. O se baja del portal, o falta registrar el código en Sedi. ${r.referencia}`.trim(),
        responsable_nombre: '', datos: { codigo, referencia: r.referencia, oferta: r.oferta },
      });
      continue;
    }
    if (!publicable(i)) {
      // 3) Publicado, pero Sedi dice que ya no está disponible.
      items.push({
        tipo: 'despublicar', numero_inmueble: i.numero_inmueble, clave: `portal:${portal}:despublicar:${i.numero_inmueble}`,
        titulo: `Despublicar inmueble ${i.numero_inmueble} de ${nombre}`,
        detalle: `En Sedi está "${i.estado_crm || 'sin estado'}" pero sigue activo en ${nombre} (${codigo}). ${i.direccion || ''}`.trim(),
        responsable_nombre: responsable(i), datos: { codigo, estado_crm: i.estado_crm },
      });
      continue;
    }
    // 4) Precio distinto (se compara según la oferta de Sedi; si el portal tiene otra oferta, no se compara).
    const of = ofertaSedi(i);
    const precioSedi = num(of === 'venta' ? i.valor_venta : i.valor_canon);
    const precioPortal = of === 'venta' ? r.precioVenta : r.precioCanon;
    if (precioSedi > 0 && precioPortal > 0 && Math.abs(precioSedi - precioPortal) >= 1) {
      items.push({
        tipo: 'revisar_precio', numero_inmueble: i.numero_inmueble, clave: `portal:${portal}:revisar_precio:${i.numero_inmueble}`,
        titulo: `Precio distinto en ${nombre}: inmueble ${i.numero_inmueble}`,
        detalle: `Sedi: ${moneda(precioSedi)} · ${nombre}: ${moneda(precioPortal)} (${of}). Hay que corregir el que esté mal.`,
        responsable_nombre: responsable(i), datos: { codigo, precio_sedi: precioSedi, precio_portal: precioPortal, oferta: of },
      });
    }
  }
  return { items, totalActivos: activos.size };
}

/** Informativo (no genera pendientes): disponibles que no tienen código en ningún portal. */
export function disponiblesSinCodigo(inmuebles) {
  return inmuebles.filter((i) => norm(i.estado_crm) === 'disponible'
    && !i.codigo_fincaraiz && !i.codigo_metrocuadrado && !i.codigo_ciencuadras)
    .map((i) => i.numero_inmueble).sort((a, b) => a - b);
}
