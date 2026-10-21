/**
 * Respaldo semanal de Supabase hacia Google Drive.
 *
 * Copia el CONTENIDO de las tablas de la agenda (citas, inmuebles, asesores, historial,
 * encuestas, etc.) a archivos JSON dentro de una carpeta de Drive, una subcarpeta por
 * fecha. Vive en el MISMO proyecto de Apps Script que sincronizar-inmuebles.gs y usa sus
 * mismas Propiedades del script (SUPABASE_URL y SUPABASE_SERVICE_KEY). Solo LEE de Supabase
 * y solo ESCRIBE archivos nuevos en la carpeta del respaldo: no borra nada, salvo que tú
 * actives la limpieza opcional (ver RESPALDO_CONSERVAR).
 *
 * Propiedades de script nuevas:
 *   RESPALDO_CARPETA_ID  -> ID de la carpeta de Drive (idealmente en una unidad compartida
 *                           privada, solo para administradores). Está en la URL de la
 *                           carpeta, después de /folders/.
 *   RESPALDO_CONSERVAR   -> opcional. Número de respaldos recientes a conservar; los más
 *                           viejos se envían a la papelera de Drive. Si no la pones, NO se
 *                           borra nada.
 *
 * Qué NO incluye: las cuentas de acceso (correo y contraseña) viven en Supabase Auth y no
 * están en estas tablas; si hubiera que reconstruir el proyecto, a las personas se les crea
 * el acceso de nuevo. La estructura de la base (tablas, reglas) está en la carpeta sql/ del
 * proyecto en GitHub. Los archivos contienen datos personales de clientes: la carpeta debe
 * ser privada.
 *
 * Activador: Añadir activador > respaldarSupabaseConAvisoDeError > Basado en tiempo >
 * Temporizador semanal (por ejemplo, domingo de madrugada).
 */

const TABLAS_RESPALDO = [
  'agenda_empresas',
  'agenda_configuracion',
  'agenda_asesores',
  'agenda_asesores_ausencias',
  'agenda_asesores_ciudades',
  'agenda_asesores_coberturas',
  'agenda_ciudades',
  'agenda_coberturas',
  'agenda_festivos',
  'agenda_miembros',
  'agenda_inmuebles',
  'agenda_inmuebles_historial',
  'agenda_propietarios',
  'agenda_arrendatarios',
  'agenda_citas',
  'agenda_citas_historial',
  'agenda_encuestas_cliente',
  'agenda_informes_propietarios',
  'agenda_solicitudes_propietario',
  'agenda_pendientes',
  'agenda_portales_cargas',
  'agenda_correos_log',
];

function respaldarSupabase() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const serviceKey = props.getProperty('SUPABASE_SERVICE_KEY');
  const carpetaId = props.getProperty('RESPALDO_CARPETA_ID');
  if (!supabaseUrl || !serviceKey || !carpetaId) {
    throw new Error('Faltan Propiedades del script: SUPABASE_URL, SUPABASE_SERVICE_KEY o RESPALDO_CARPETA_ID.');
  }

  const raiz = DriveApp.getFolderById(carpetaId);
  const marca = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd_HHmm');
  const carpeta = raiz.createFolder('respaldo-' + marca);
  const cabeceras = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, Prefer: 'count=exact' };
  const resumen = [];
  const problemas = [];

  TABLAS_RESPALDO.forEach(function (tabla) {
    const filas = [];
    let total = null;
    const TAMANO = 1000;
    for (let desde = 0; ; desde += TAMANO) {
      const r = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/' + tabla + '?select=*&limit=' + TAMANO + '&offset=' + desde, {
        method: 'get',
        headers: cabeceras,
        muteHttpExceptions: true,
      });
      if (r.getResponseCode() >= 300) {
        problemas.push(tabla + ': Supabase respondió ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
        return;
      }
      const pagina = JSON.parse(r.getContentText());
      pagina.forEach(function (f) { filas.push(f); });
      const rango = String(r.getHeaders()['Content-Range'] || r.getHeaders()['content-range'] || '');
      const m = rango.match(/\/(\d+)$/);
      if (m) { total = Number(m[1]); }
      if (pagina.length < TAMANO) { break; }
    }
    if (total !== null && total !== filas.length) {
      problemas.push(tabla + ': se esperaban ' + total + ' filas y se guardaron ' + filas.length);
    }
    carpeta.createFile(tabla + '.json', JSON.stringify(filas), MimeType.PLAIN_TEXT);
    resumen.push(tabla + ': ' + filas.length);
  });

  carpeta.createFile('LEEME.txt', 'Respaldo de Supabase (' + marca + ')\n\n' + resumen.join('\n') + (problemas.length ? '\n\nPROBLEMAS:\n' + problemas.join('\n') : ''), MimeType.PLAIN_TEXT);
  Logger.log('Respaldo ' + marca + ': ' + resumen.join(' | '));
  if (problemas.length) { throw new Error('El respaldo se guardó con problemas:\n' + problemas.join('\n')); }

  limpiarRespaldosViejos(raiz, Number(props.getProperty('RESPALDO_CONSERVAR') || 0));
}

// Solo si RESPALDO_CONSERVAR > 0: envía a la papelera de Drive (recuperable ~30 días) los
// respaldos más viejos que los N más recientes. Con 0 o sin la propiedad, no hace nada.
function limpiarRespaldosViejos(raiz, conservar) {
  if (!conservar || conservar < 1) { return; }
  const carpetas = [];
  const it = raiz.getFolders();
  while (it.hasNext()) {
    const c = it.next();
    if (/^respaldo-\d{4}-\d{2}-\d{2}_\d{4}$/.test(c.getName())) { carpetas.push(c); }
  }
  carpetas.sort(function (a, b) { return b.getName().localeCompare(a.getName()); });
  carpetas.slice(conservar).forEach(function (c) { c.setTrashed(true); });
}

/** Esta es la función que debe apuntar el activador semanal. */
function respaldarSupabaseConAvisoDeError() {
  try {
    respaldarSupabase();
  } catch (error) {
    MailApp.sendEmail('pf.castelli@patrimonios.co', 'Falló el respaldo semanal de Supabase', String(error));
    throw error;
  }
}
