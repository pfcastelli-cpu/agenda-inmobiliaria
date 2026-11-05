/**
 * Importa a Supabase (1) las citas de los Google Calendar de cada ciudad y (2) los «intereses» del bot de WhatsApp.
 * Sirve para los informes a propietarios y para seguir funcionando MIENTRAS aún se usa Calendar (corre cada hora y solo
 * trae lo nuevo). No envía correos a nadie: escribe en tablas aparte (SQL 049, aplicado 2026-11-05).
 *
 * PRIVACIDAD: no se guarda nombre, correo ni teléfono del cliente ni el WhatsApp del bot; solo una huella anónima
 * (SHA-256 con la empresa como sal) que sirve para contar personas distintas.
 *
 * Instalado en Apps Script, proyecto «SEDI A SUPABASE». Propiedades del script:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, EMPRESA_ID (nunca en el repo)
 *   HOJA_BOT_ID     = id de la hoja del bot de WhatsApp (pestaña INTERESES)
 *   IMPORTAR_DESDE  = fecha desde la que se leen citas, formato 2026-11-05 (si falta: hoy → solo lo NUEVO).
 *                     Historial 2026-01-01 → 2026-11-05 ya importado; para reimportarlo, poner 2026-01-01 y correr a mano.
 *
 * Uso: PRUEBA_citasEnSeco() muestra lo que leería sin guardar; PRUEBA_ejemplos() muestra 2 citas reales por ciudad
 * (con datos del cliente, SOLO en el registro de ejecución); crearActivadores() la deja corriendo cada hora.
 * Nota: en Apps Script hay además dos funciones de diagnóstico (PRUEBA_titulos, PRUEBA_crudo) que no son necesarias.
 */
const TZ_IMP = 'America/Bogota';
const DIAS_FUTURO = 90;
const CALENDARIOS = [
  { ciudad: 'Bogotá', asesor: 'Luis Jiménez', id: 'c_7f1ee8e64993854549a99d6c4c66d4c84740e67fa26a26ef6215e0448156d65c@group.calendar.google.com' },
  { ciudad: 'Medellín', asesor: 'Luisa Restrepo', id: 'c_c96cfc794357aed1b19e5372ca3d0c422e8f3579b4fd563d6322561fea13630f@group.calendar.google.com' },
  { ciudad: 'Barranquilla', asesor: 'Laura Salcedo', id: 'c_d87f1b28b4332b599ff78b73bd64cd6e192f40bac16881ee1f709e163cdaac75@group.calendar.google.com' },
];

function propsImp_() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    url: p.getProperty('SUPABASE_URL'), key: p.getProperty('SUPABASE_SERVICE_KEY'), empresaId: p.getProperty('EMPRESA_ID'),
    hojaBot: p.getProperty('HOJA_BOT_ID'), desde: p.getProperty('IMPORTAR_DESDE'),
  };
  if (!cfg.url || !cfg.key || !cfg.empresaId) throw new Error('Faltan SUPABASE_URL, SUPABASE_SERVICE_KEY o EMPRESA_ID en las propiedades del script.');
  return cfg;
}

/** Lee la descripción del evento (formato de la reserva: 📍 Dirección, 👤 Asesor, Booked by…, Código inmueble). */
function parsearDescripcion_(desc) {
  const out = { nombre: '', email: '', telefono: '', inmueble: null, direccion: '', asesor: '' };
  if (!desc) return out;
  const texto = String(desc).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\r/g, '');
  const lineas = texto.split('\n').map(s => s.trim()).filter(Boolean);
  const i = lineas.findIndex(l => /^booked by$/i.test(l));
  if (i >= 0) {
    out.nombre = lineas[i + 1] || '';
    out.email = String(lineas[i + 2] || '').toLowerCase();
    out.telefono = String(lineas[i + 3] || '').replace(/[^\d+]/g, '');
  }
  // Etiqueta nueva «Código inmueble» o antigua «Número de Inmueble (máx. 5 dígitos…)»; el valor puede ir en la misma línea
  // o en la siguiente («633», «n633», «N° 633»).
  const j = lineas.findIndex(l => /^(c(ó|o)digo|n(ú|u)mero\s+de)\s+inmueble/i.test(l));
  if (j >= 0) {
    const resto = lineas[j].replace(/^(c(ó|o)digo|n(ú|u)mero\s+de)\s+inmueble(\s*\([^)]*\))?\s*:?/i, '');
    const cand = [resto, lineas[j + 1] || ''].map(s => (String(s).match(/(?:^|[^\d])(\d{1,5})(?!\d)/) || [])[1]).find(Boolean);
    if (cand) out.inmueble = Number(cand);
  }
  const d = texto.match(/Direcci(?:ó|o)n:\s*([^\n]+)/i); if (d) out.direccion = d[1].trim();
  const a = texto.match(/Asesor:\s*([^\n📞]+)/i); if (a) out.asesor = a[1].trim();
  return out;
}

function huella_(valor, sal) {
  const v = String(valor || '').toLowerCase().replace(/\s+/g, '');
  if (!v) return '';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + v).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').slice(0, 24);
}

function eventosAFilas_(cal, desde, hasta, empresaId) {
  const evs = CalendarApp.getCalendarById(cal.id).getEvents(desde, hasta);
  const filas = [];
  evs.forEach(ev => {
    const pb = parsearDescripcion_(ev.getDescription());
    if (!pb.email && !pb.telefono && !pb.inmueble) return; // no es una cita de reservas (p. ej. «Vacaciones»): se ignora
    filas.push({
      empresa_id: empresaId, evento_id: ev.getId(), ciudad: cal.ciudad, calendario_asesor: cal.asesor,
      numero_inmueble: pb.inmueble, asesor_nombre: pb.asesor || cal.asesor, cliente_huella: huella_(pb.email || pb.telefono, empresaId),
      direccion: pb.direccion || ev.getLocation() || '', titulo: ev.getTitle() || '',
      inicio: ev.getStartTime().toISOString(), fin: ev.getEndTime().toISOString(), estado: 'activa',
      actualizado_en: new Date().toISOString(),
    });
  });
  return filas;
}

function ventana_(cfg) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const desde = cfg.desde ? new Date(cfg.desde + 'T00:00:00-05:00') : hoy;
  return { desde: desde, hasta: new Date(hoy.getTime() + DIAS_FUTURO * 86400000) };
}

function rest_(cfg, metodo, ruta, cuerpo, extra) {
  const r = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + ruta, {
    method: metodo, contentType: 'application/json', muteHttpExceptions: true,
    headers: Object.assign({ apikey: cfg.key, Authorization: 'Bearer ' + cfg.key }, extra || {}),
    payload: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.getResponseCode() >= 300) throw new Error('Supabase ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  return r.getContentText() ? JSON.parse(r.getContentText()) : null;
}

/** PRUEBA: no guarda nada. Cuántas citas leería por ciudad y las primeras (con huella, sin datos personales). */
function PRUEBA_citasEnSeco() {
  const cfg = propsImp_(); const v = ventana_(cfg);
  CALENDARIOS.forEach(cal => {
    const filas = eventosAFilas_(cal, v.desde, v.hasta, cfg.empresaId);
    const sinCodigo = filas.filter(f => !f.numero_inmueble).length;
    Logger.log(cal.ciudad + ': ' + filas.length + ' citas (' + sinCodigo + ' sin código de inmueble) desde ' + v.desde.toISOString());
    filas.slice(0, 3).forEach(f => Logger.log(JSON.stringify({ inm: f.numero_inmueble, huella: f.cliente_huella.slice(0, 6), ini: f.inicio, dir: f.direccion })));
  });
}

/** Solo para revisar a ojo: 2 ejemplos reales por ciudad en el registro (no guarda nada). */
function PRUEBA_ejemplos() {
  const cfg = propsImp_(); const v = ventana_(cfg);
  CALENDARIOS.forEach(cal => {
    const evs = CalendarApp.getCalendarById(cal.id).getEvents(v.desde, v.hasta);
    let n = 0;
    for (const ev of evs) {
      const pb = parsearDescripcion_(ev.getDescription());
      if (!pb.inmueble || !pb.email) continue;
      Logger.log('[' + cal.ciudad + '] ' + Utilities.formatDate(ev.getStartTime(), TZ_IMP, 'yyyy-MM-dd HH:mm') + ' | cliente: ' + pb.nombre + ' | ' + pb.email + ' | ' + pb.telefono + ' | inmueble: ' + pb.inmueble + ' | asesor: ' + (pb.asesor || cal.asesor) + ' | dir: ' + (pb.direccion || ev.getLocation()));
      if (++n >= 2) break;
    }
  });
}

/** Importa/actualiza las citas de la ventana y marca «eliminada» las que ya no están en Calendar (solo dentro de la ventana). */
function importarCitasCalendar() {
  const cfg = propsImp_(); const v = ventana_(cfg);
  CALENDARIOS.forEach(cal => {
    const filas = eventosAFilas_(cal, v.desde, v.hasta, cfg.empresaId);
    for (let i = 0; i < filas.length; i += 200) {
      rest_(cfg, 'post', 'agenda_citas_calendar?on_conflict=empresa_id,evento_id', filas.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    }
    const vistas = new Set(filas.map(f => f.evento_id));
    const guardadas = rest_(cfg, 'get', 'agenda_citas_calendar?select=evento_id&estado=eq.activa&empresa_id=eq.' + cfg.empresaId +
      '&ciudad=eq.' + encodeURIComponent(cal.ciudad) + '&inicio=gte.' + v.desde.toISOString() + '&inicio=lte.' + v.hasta.toISOString() + '&limit=5000');
    (guardadas || []).filter(g => !vistas.has(g.evento_id)).forEach(g => {
      rest_(cfg, 'patch', 'agenda_citas_calendar?empresa_id=eq.' + cfg.empresaId + '&evento_id=eq.' + encodeURIComponent(g.evento_id),
        { estado: 'eliminada', actualizado_en: new Date().toISOString() }, { Prefer: 'return=minimal' });
    });
    Logger.log(cal.ciudad + ': ' + filas.length + ' citas sincronizadas.');
  });
}

/** Importa la hoja INTERESES del bot (solo filas nuevas desde la última corrida). */
function importarInteresesBot() {
  const cfg = propsImp_(); const p = PropertiesService.getScriptProperties();
  if (!cfg.hojaBot) throw new Error('Falta HOJA_BOT_ID.');
  const hoja = SpreadsheetApp.openById(cfg.hojaBot).getSheetByName('INTERESES');
  const ultima = hoja.getLastRow(); const previa = Number(p.getProperty('INTERESES_ULTIMA_FILA') || 1);
  if (ultima <= previa) return Logger.log('Sin intereses nuevos.');
  const valores = hoja.getRange(previa + 1, 1, ultima - previa, 8).getValues();
  const filas = valores.filter(r => r[0] && r[2]).map(r => {
    const fecha = r[0] instanceof Date ? r[0] : parsearFechaBot_(String(r[0]));
    const codigo = String(r[5]).replace(/\D/g, '');
    const contacto = String(r[2]).replace(/\D/g, '');
    return {
      empresa_id: cfg.empresaId, clave: fecha.toISOString() + '|' + huella_(contacto, cfg.empresaId) + '|' + codigo, fecha: fecha.toISOString(),
      ciudad: String(r[1] || ''), contacto_huella: huella_(contacto, cfg.empresaId), interes: String(r[3] || '').toLowerCase(), tipo_inmueble: String(r[4] || ''),
      numero_inmueble: codigo ? Number(codigo) : null, direccion: String(r[6] || ''), agendo_cita: /^s/i.test(String(r[7] || '')),
    };
  });
  for (let i = 0; i < filas.length; i += 200) {
    rest_(cfg, 'post', 'agenda_intereses_bot?on_conflict=empresa_id,clave', filas.slice(i, i + 200), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  p.setProperty('INTERESES_ULTIMA_FILA', String(ultima));
  Logger.log(filas.length + ' intereses importados.');
}

function parsearFechaBot_(s) { // «12/08/2026 16:43:40» = día/mes/año, hora de Bogotá
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date();
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 5, +m[5], +(m[6] || 0)));
}

/** Deja todo corriendo solo cada hora. Ejecutar una sola vez (ya ejecutado el 2026-11-05). */
function crearActivadores() {
  ScriptApp.getProjectTriggers().filter(t => ['importarCitasCalendar', 'importarInteresesBot'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importarCitasCalendar').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('importarInteresesBot').timeBased().everyHours(1).create();
}
