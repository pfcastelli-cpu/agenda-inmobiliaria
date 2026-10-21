/**
 * Sincroniza el inventario de Sedi (tu hoja de Google Sheets de Inmuebles)
 * hacia Supabase (tabla agenda_inmuebles), una vez al día.
 *
 * IMPORTANTE: este código vive en un proyecto de Apps Script NUEVO Y
 * SEPARADO de las macros que ya usas para citas y correos. No toca esa
 * hoja de citas, no toca el calendario, y de la hoja de Inmuebles SOLO
 * LEE datos (getValues()): ninguna línea de este archivo escribe, borra
 * ni reordena nada en tus hojas actuales.
 *
 * Antes de usarlo, configura estas Propiedades del script (⚙️ Configuración
 * del proyecto > Propiedades del script > Añadir propiedad de script):
 *   HOJA_INMUEBLES_ID     -> el ID de la hoja de Inmuebles (está en su URL,
 *                            entre /d/ y /edit)
 *   SUPABASE_URL          -> https://ykiuuxludyonkhywtmgu.supabase.co
 *   SUPABASE_SERVICE_KEY  -> la "service_role" key de Supabase (Project
 *                            Settings > API). NUNCA la clave "publishable"
 *                            que usa la aplicación en el navegador.
 * EMPRESA_ID se busca solo, la primera vez que corra, y se guarda aquí mismo.
 *
 * Si la pestaña con los datos (la que tiene la fila de encabezados
 * "Numero inmueble", "Estado Inmueble", etc) no se llama "Hoja1", agrega
 * también la propiedad de script NOMBRE_HOJA con el nombre real de esa
 * pestaña (tal cual aparece en la etiqueta de abajo en Google Sheets).
 */

function sincronizarInmuebles() {
  const props = PropertiesService.getScriptProperties();
  const hojaId = props.getProperty('HOJA_INMUEBLES_ID');
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const serviceKey = props.getProperty('SUPABASE_SERVICE_KEY');
  const nombreHoja = props.getProperty('NOMBRE_HOJA') || 'Hoja1';
  let empresaId = props.getProperty('EMPRESA_ID');

  if (!hojaId || !supabaseUrl || !serviceKey) {
    throw new Error('Faltan Propiedades del script: HOJA_INMUEBLES_ID, SUPABASE_URL o SUPABASE_SERVICE_KEY.');
  }

  if (!empresaId) {
    empresaId = obtenerEmpresaId(supabaseUrl, serviceKey);
    props.setProperty('EMPRESA_ID', empresaId);
  }

  const hoja = SpreadsheetApp.openById(hojaId).getSheetByName(nombreHoja);
  if (!hoja) {
    throw new Error('No existe una pestaña llamada "' + nombreHoja + '" en esa hoja. Agrega la propiedad de script NOMBRE_HOJA con el nombre real de la pestaña.');
  }
  // getValues() ya interpreta los números (incluida la coma decimal) de forma
  // correcta: no hay que leer el texto de la celda ni parsear comas a mano.
  const datos = hoja.getDataRange().getValues();
  const encabezados = datos[0].map(function (h) { return String(h).trim(); });
  const filas = datos.slice(1);

  const columna = function (nombre) { return encabezados.indexOf(nombre); };
  const idx = {
    numero: columna('Numero inmueble'),
    estadoInmueble: columna('Estado Inmueble'),
    estadoCrm: columna('Estado CRM'),
    tipoOferta: columna('Tipo Oferta'),
    tipoInmueble: columna('Tipo Inmueble'),
    usoInmueble: columna('Uso Inmueble'),
    direccion: columna('Dirección'),
    pais: columna('País'),
    ciudad: columna('Ciudad'),
    localidad: columna('Localidad'),
    barrio: columna('Barrio'),
    latitud: columna('Latitud'),
    longitud: columna('Longitud'),
    asesorCaptacion: columna('Asesor de captación'),
    asesorComercializacion: columna('Asesor de comercialización'),
    habitaciones: columna('Habitaciones'),
    banos: columna('Baños'),
    parqueaderos: columna('Parqueaderos'),
    llave: columna('Ubicación Llave'),
    restricciones: columna('Restricciones Visita'),
    descripcion: columna('Descripción inmueble'),
    valorCanon: columna('Valor Canon'),
    valorVenta: columna('Valor Venta'),
    comisionCanon: columna('Canon Tarifa Comisión'),
    comisionVenta: columna('Venta Tarifa Comisión'),
    metroCuadrado: columna('Metro Cuadrado'),
    fincaRaiz: columna('Finca Raíz'),
    mercadoLibre: columna('Mercado Libre'),
    cienCuadras: columna('Cien Cuadras'),
    tieneAdministracion: columna('Tiene Administración'),
    admonIncluida: columna('Admon Incluida'),
    valorAdmin1: columna('Valor Administración Fecha 1'),
    valorAdmin2: columna('Valor Administración Fecha 2'),
    valorAdmin3: columna('Valor Administración Fecha 3'),
  };
  Object.keys(idx).forEach(function (clave) {
    if (idx[clave] === -1) {
      throw new Error('No se encontró la columna esperada para "' + clave + '". ¿Cambiaron los encabezados de la hoja? Se detiene sin tocar Supabase.');
    }
  });

  const numeroOrNull = function (v) { return (v === '' || v === null || v === undefined) ? null : Number(v); };
  const textoSeguro = function (v) { return (v === null || v === undefined) ? '' : String(v).trim(); };
  const esSi = function (v) { return /^s[ií]$/i.test(textoSeguro(v)); };

  // Algunas tarifas de comisión vienen como una etiqueta de Sedi, ej.
  // "COMISIÓN ESTANDAR (8%)" o "COMISIÓN PLATINUM (10,9%)" (con coma
  // decimal). Aquí se extrae el número (10,9 -> 10.9) y se guarda también
  // la etiqueta completa para no perder el texto original.
  const porcentajeDeEtiqueta = function (v) {
    const texto = textoSeguro(v);
    if (texto === '') { return null; }
    const encontrado = texto.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
    if (!encontrado) { return null; }
    return Number(encontrado[1].replace(',', '.'));
  };

  // Un inmueble se considera realmente disponible para agendar visitas
  // cuando el CRM lo marca como Disponible/Rentando Y además ya tiene un
  // código activo en al menos un portal (Finca Raíz, Metrocuadrado, Mercado
  // Libre o Cien Cuadras) -- eso es lo que confirma que ya está publicado y
  // se están recibiendo clientes interesados en él, no solo que su estado
  // interno diga "Libre".
  const tienePortalActivo = function (fila) {
    return [idx.metroCuadrado, idx.fincaRaiz, idx.mercadoLibre, idx.cienCuadras].some(function (i) {
      return textoSeguro(fila[i]) !== '';
    });
  };

  const filasParaSupabase = [];
  const numerosVistos = [];
  filas.forEach(function (fila) {
    const numero = fila[idx.numero];
    if (numero === '' || numero === null || numero === undefined) { return; } // fila vacía, se ignora
    numerosVistos.push(Number(numero));
    filasParaSupabase.push({
      empresa_id: empresaId,
      numero_inmueble: Number(numero),
      estado_inmueble: textoSeguro(fila[idx.estadoInmueble]),
      estado_crm: textoSeguro(fila[idx.estadoCrm]),
      tipo_oferta: textoSeguro(fila[idx.tipoOferta]),
      tipo_inmueble: textoSeguro(fila[idx.tipoInmueble]),
      uso_inmueble: textoSeguro(fila[idx.usoInmueble]),
      direccion: textoSeguro(fila[idx.direccion]),
      pais: textoSeguro(fila[idx.pais]) || 'COLOMBIA',
      ciudad: textoSeguro(fila[idx.ciudad]),
      localidad: textoSeguro(fila[idx.localidad]),
      barrio: textoSeguro(fila[idx.barrio]),
      latitud: numeroOrNull(fila[idx.latitud]),
      longitud: numeroOrNull(fila[idx.longitud]),
      asesor_captacion: textoSeguro(fila[idx.asesorCaptacion]),
      asesor_comercializacion: textoSeguro(fila[idx.asesorComercializacion]),
      habitaciones: numeroOrNull(fila[idx.habitaciones]),
      banos: numeroOrNull(fila[idx.banos]),
      parqueaderos: numeroOrNull(fila[idx.parqueaderos]),
      ubicacion_llave: textoSeguro(fila[idx.llave]),
      restricciones_visita: textoSeguro(fila[idx.restricciones]),
      descripcion: textoSeguro(fila[idx.descripcion]),
      valor_canon: numeroOrNull(fila[idx.valorCanon]),
      valor_venta: numeroOrNull(fila[idx.valorVenta]),
      canon_tarifa_comision: porcentajeDeEtiqueta(fila[idx.comisionCanon]),
      canon_tarifa_etiqueta: textoSeguro(fila[idx.comisionCanon]) || null,
      venta_tarifa_comision: porcentajeDeEtiqueta(fila[idx.comisionVenta]),
      venta_tarifa_etiqueta: textoSeguro(fila[idx.comisionVenta]) || null,
      disponible: (
        /^(disponible|rentando)$/i.test(textoSeguro(fila[idx.estadoCrm])) && tienePortalActivo(fila)
      ),
      codigo_metrocuadrado: textoSeguro(fila[idx.metroCuadrado]) || null,
      codigo_fincaraiz: textoSeguro(fila[idx.fincaRaiz]) || null,
      codigo_ciencuadras: textoSeguro(fila[idx.cienCuadras]) || null,
      tiene_administracion: esSi(fila[idx.tieneAdministracion]),
      administracion_incluida: esSi(fila[idx.admonIncluida]),
      valor_administracion: (function () {
        const v1 = numeroOrNull(fila[idx.valorAdmin1]);
        const v2 = numeroOrNull(fila[idx.valorAdmin2]);
        const v3 = numeroOrNull(fila[idx.valorAdmin3]);
        if (v1 === null && v2 === null && v3 === null) { return null; }
        return (v1 || 0) + (v2 || 0) + (v3 || 0);
      })(),
      visto_en_ultima_sincronizacion: true,
      veces_no_visto: 0,
      sincronizado_en: new Date().toISOString(),
    });
  });

  if (filasParaSupabase.length === 0) {
    throw new Error('La hoja no devolvió ninguna fila con "Numero inmueble". Se detiene sin tocar Supabase, para no marcar todo el inventario como no visto por error.');
  }

  // Sube en bloques para no exceder límites de tamaño de una sola llamada.
  const TAMANO_BLOQUE = 200;
  for (let i = 0; i < filasParaSupabase.length; i += TAMANO_BLOQUE) {
    subirBloque(supabaseUrl, serviceKey, filasParaSupabase.slice(i, i + TAMANO_BLOQUE));
  }

  marcarNoVistos(supabaseUrl, serviceKey, empresaId, numerosVistos);
  Logger.log('Sincronización completa: ' + filasParaSupabase.length + ' inmuebles procesados.');
}

function subirBloque(supabaseUrl, serviceKey, bloque) {
  const respuesta = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/agenda_inmuebles?on_conflict=empresa_id,numero_inmueble', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Prefer: 'resolution=merge-duplicates',
    },
    payload: JSON.stringify(bloque),
    muteHttpExceptions: true,
  });
  if (respuesta.getResponseCode() >= 300) {
    throw new Error('Supabase respondió ' + respuesta.getResponseCode() + ' al guardar inmuebles: ' + respuesta.getContentText());
  }
}

function marcarNoVistos(supabaseUrl, serviceKey, empresaId, numerosVistos) {
  const vistos = {};
  numerosVistos.forEach(function (n) { vistos[n] = true; });

  const respuestaLectura = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/agenda_inmuebles?select=id,numero_inmueble,veces_no_visto&empresa_id=eq.' + empresaId,
    { method: 'get', headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }, muteHttpExceptions: true },
  );
  if (respuestaLectura.getResponseCode() >= 300) {
    throw new Error('No se pudo leer el inventario existente en Supabase: ' + respuestaLectura.getContentText());
  }
  const existentes = JSON.parse(respuestaLectura.getContentText());

  existentes.forEach(function (fila) {
    if (vistos[fila.numero_inmueble]) { return; } // sí vino en esta corrida, ya se actualizó en subirBloque
    const nuevoConteo = (fila.veces_no_visto || 0) + 1;
    const cuerpo = {
      visto_en_ultima_sincronizacion: false,
      veces_no_visto: nuevoConteo,
      sincronizado_en: new Date().toISOString(),
    };
    if (nuevoConteo >= 3) {
      cuerpo.disponible = false; // tres corridas seguidas sin verlo en la hoja: se trata como retirado
    }
    UrlFetchApp.fetch(supabaseUrl + '/rest/v1/agenda_inmuebles?id=eq.' + fila.id, {
      method: 'patch',
      contentType: 'application/json',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      payload: JSON.stringify(cuerpo),
      muteHttpExceptions: true,
    });
  });
}

function obtenerEmpresaId(supabaseUrl, serviceKey) {
  const respuesta = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/agenda_empresas?slug=eq.patrimonios&select=id', {
    method: 'get',
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    muteHttpExceptions: true,
  });
  const filasEmpresa = JSON.parse(respuesta.getContentText());
  if (!filasEmpresa || !filasEmpresa.length) {
    throw new Error('No se encontró la empresa "patrimonios" en agenda_empresas. ¿Ya se corrió sql/001-ya-ejecutado.sql?');
  }
  return filasEmpresa[0].id;
}

/**
 * Esta es la función que debe apuntar el disparador diario (Activadores >
 * Añadir activador > Basado en tiempo > Temporizador de día), NO
 * sincronizarInmuebles() directamente, para que un error te llegue por
 * correo en vez de fallar en silencio.
 */
function sincronizarInmueblesConAvisoDeError() {
  try {
    sincronizarInmuebles();
  } catch (error) {
    MailApp.sendEmail('pf.castelli@patrimonios.co', 'Falló la sincronización diaria de inmuebles', String(error));
    throw error;
  }
}

/**
 * Sincroniza el contacto del ARRENDATARIO de cada inmueble desde la hoja
 * "InformeGeneralInmueblesArrendados" (pestaña "Inmuebles") hacia Supabase
 * (tabla agenda_arrendatarios). Se usa para el botón "Informar al arrendatario"
 * de los inmuebles con Estado CRM "Rentando".
 *
 * También es de SOLO LECTURA sobre la hoja. Propiedades de script nuevas:
 *   HOJA_ARRENDADOS_ID         -> ID de esa hoja (11bwWCu-2H6gtPkRpiNWmqsjjwOmN-MNp3fjB434MouM)
 *   NOMBRE_HOJA_ARRENDADOS     -> opcional, por defecto "Inmuebles"
 * (usa las mismas SUPABASE_URL, SUPABASE_SERVICE_KEY y EMPRESA_ID de arriba)
 *
 * Si un inmueble tiene varias filas (contratos anteriores), se queda con la de
 * estado NORMAL y fecha de vencimiento más reciente. Los inmuebles que dejan de
 * aparecer en la hoja se borran de agenda_arrendatarios en la misma corrida.
 */
function sincronizarArrendatarios() {
  const props = PropertiesService.getScriptProperties();
  const hojaId = props.getProperty('HOJA_ARRENDADOS_ID');
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const serviceKey = props.getProperty('SUPABASE_SERVICE_KEY');
  const nombreHoja = props.getProperty('NOMBRE_HOJA_ARRENDADOS') || 'Inmuebles';
  let empresaId = props.getProperty('EMPRESA_ID');
  if (!hojaId || !supabaseUrl || !serviceKey) {
    throw new Error('Faltan Propiedades del script: HOJA_ARRENDADOS_ID, SUPABASE_URL o SUPABASE_SERVICE_KEY.');
  }
  if (!empresaId) {
    empresaId = obtenerEmpresaId(supabaseUrl, serviceKey);
    props.setProperty('EMPRESA_ID', empresaId);
  }

  const hoja = SpreadsheetApp.openById(hojaId).getSheetByName(nombreHoja);
  if (!hoja) { throw new Error('No existe una pestaña llamada "' + nombreHoja + '" en la hoja de arrendados.'); }
  const datos = hoja.getDataRange().getValues();
  const encabezados = datos[0].map(function (h) { return String(h).trim(); });
  const col = function (nombre) { return encabezados.indexOf(nombre); };
  const idx = {
    numero: col('No inmueble'),
    estado: col('Estado'),
    vence: col('Fec. de vencimiento'),
    nombre: col('Arrendatario'),
    telefono: col('Teléfono de arrendatario'),
    celular: col('Celular de arrendatario'),
    email: col('Email de arrendatario'),
  };
  Object.keys(idx).forEach(function (k) {
    if (idx[k] === -1) { throw new Error('No se encontró la columna esperada para "' + k + '" en la hoja de arrendados. Se detiene sin tocar Supabase.'); }
  });

  const texto = function (v) { return (v === null || v === undefined) ? '' : String(v).trim(); };
  const aFechaISO = function (v) {
    if (v instanceof Date && !isNaN(v)) { return Utilities.formatDate(v, 'America/Bogota', 'yyyy-MM-dd'); }
    const t = texto(v);
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) { return m[1] + '-' + m[2] + '-' + m[3]; }
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    return null;
  };

  const inicio = new Date().toISOString();
  const mejorPorInmueble = {};
  datos.slice(1).forEach(function (fila) {
    const numero = Number(fila[idx.numero]);
    if (!numero || String(fila[idx.estado]).trim().toUpperCase() !== 'NORMAL') { return; }
    const vence = aFechaISO(fila[idx.vence]);
    const previo = mejorPorInmueble[numero];
    if (previo && (previo.vencimiento_contrato || '') > (vence || '')) { return; }
    mejorPorInmueble[numero] = {
      empresa_id: empresaId,
      numero_inmueble: numero,
      nombre: texto(fila[idx.nombre]),
      email: texto(fila[idx.email]),
      celular: texto(fila[idx.celular]),
      telefono: texto(fila[idx.telefono]),
      vencimiento_contrato: vence,
      sincronizado_en: inicio,
    };
  });
  const filasSupabase = Object.keys(mejorPorInmueble).map(function (k) { return mejorPorInmueble[k]; });
  if (filasSupabase.length === 0) {
    throw new Error('La hoja de arrendados no devolvió ninguna fila NORMAL. Se detiene sin tocar Supabase, para no borrar todos los contactos por error.');
  }

  const cabeceras = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  for (let i = 0; i < filasSupabase.length; i += 200) {
    const r = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/agenda_arrendatarios?on_conflict=empresa_id,numero_inmueble', {
      method: 'post',
      contentType: 'application/json',
      headers: Object.assign({ Prefer: 'resolution=merge-duplicates' }, cabeceras),
      payload: JSON.stringify(filasSupabase.slice(i, i + 200)),
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() >= 300) {
      throw new Error('Supabase respondió ' + r.getResponseCode() + ' al guardar arrendatarios: ' + r.getContentText());
    }
  }
  // Quita los que ya no figuran en la hoja (arrendatario que se fue / contrato terminado).
  UrlFetchApp.fetch(supabaseUrl + '/rest/v1/agenda_arrendatarios?empresa_id=eq.' + empresaId + '&sincronizado_en=lt.' + encodeURIComponent(inicio), {
    method: 'delete',
    headers: cabeceras,
    muteHttpExceptions: true,
  });
  Logger.log('Arrendatarios sincronizados: ' + filasSupabase.length);
}

/** Apunta aquí el activador diario de arrendatarios (igual que el de inmuebles). */
function sincronizarArrendatariosConAvisoDeError() {
  try {
    sincronizarArrendatarios();
  } catch (error) {
    MailApp.sendEmail('pf.castelli@patrimonios.co', 'Falló la sincronización diaria de arrendatarios', String(error));
    throw error;
  }
}
