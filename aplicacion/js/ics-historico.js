// Lee un calendario .ics exportado del sistema anterior (Google Calendar) y saca, de cada cita, los datos del cliente y el inmueble que
// vienen en la descripción: nombre, correo, celular y número o código de inmueble. Lógica pura (sin red) para poder probarla:
//   node --test tests/ics-historico.test.mjs
// Se usa para el HISTÓRICO DE DEMANDA (no crea citas en la agenda viva ni envía correos). Cuenta también las canceladas: son demanda.
// «Cuándo pidió la cita» sale de CREATED (o DTSTAMP): es la fecha que mide la demanda, no la de la visita.

const dos = (n) => String(n).padStart(2, '0');

// Valor iCalendar (con 'Z', con TZID o sin zona) → {fecha, hora, iso} en hora de Colombia (UTC−5, sin horario de verano).
export function icsABogota(valor, tzid) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(String(valor || ''));
  if (!m) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let instante = base + 5 * 3600000; // sin zona: se asume hora de Colombia
  if (m[7]) instante = base;
  else if (tzid && !/bogot|sa pacific|america\/lima|america\/panama/i.test(tzid)) {
    try {
      const p = {};
      for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tzid, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(base))) p[x.type] = x.value;
      const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      instante = base - (comoUtc - base);
    } catch { /* zona desconocida: se queda como hora de Colombia */ }
  }
  const d = new Date(instante - 5 * 3600000);
  return { fecha: `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`, hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`, iso: new Date(instante).toISOString() };
}

const desescapar = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

// Extrae nombre, correo, celular e inmueble de título + descripción. Tolera etiquetas («Nombre:», «Correo:», «Celular:», «Inmueble:», «Código:»)
// y también texto suelto. Lo que no encuentra queda vacío; la vista previa permite corregir a mano.
export function extraerDatosCliente(titulo, descripcion) {
  const texto = `${titulo || ''}\n${descripcion || ''}`.replace(/<[^>]+>/g, ' ');
  const correo = (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(texto) || [''])[0].toLowerCase();
  let telefono = '';
  for (const m of texto.matchAll(/(?:\+?57[\s.-]*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b|\b(\d{7,10})\b/g)) {
    const digitos = m[0].replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
    if (digitos.length >= 7 && digitos.length <= 10) { telefono = digitos; break; }
  }
  let inmueble = null;
  const etiquetado = /(?:inmueble|c[oó]digo|cod\.?|ref(?:erencia)?\.?|apto|apartamento|casa)\s*(?:n[°ºo.]*)?\s*[:#-]?\s*(\d{1,6})\b/i.exec(texto) || /(?:^|\s)#\s*(\d{1,6})\b/.exec(texto);
  if (etiquetado) inmueble = Number(etiquetado[1]);
  // Nombre: «Nombre: X» o «Cliente: X»; si no, la primera línea que no sea correo, teléfono ni inmueble.
  let nombre = '';
  const lab = /(?:nombre(?:\s+y\s+apellido)?|cliente|interesado)\s*:\s*([^\n\r]+)/i.exec(texto);
  if (lab) nombre = lab[1];
  else {
    for (const linea of String(descripcion || '').replace(/<[^>]+>/g, ' ').split(/\n/)) {
      const l = linea.trim();
      if (!l || /@/.test(l) || /\d{6,}/.test(l.replace(/\D/g, '')) && /\d{6,}/.test(l.replace(/[\s.-]/g, '')) || /inmueble|c[oó]digo|visita|cita/i.test(l)) continue;
      if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'-]{3,60}$/.test(l)) { nombre = l; break; }
    }
  }
  nombre = nombre.replace(/\s+/g, ' ').replace(/\b(correo|celular|tel[eé]fono|email|inmueble|c[oó]digo)\b.*$/i, '').trim().slice(0, 120);
  return { nombre, correo, telefono, inmueble };
}

// Eventos del archivo: uno por cita (se omiten las repetitivas y las de todo el día). Cada uno trae lo pedido y lo extraído.
export function parsearIcsHistorico(texto) {
  const lineas = String(texto || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const eventos = [];
  const omitidos = { recurrentes: 0, todoElDia: 0, invalidos: 0 };
  let ev = null;
  for (const l of lineas) {
    if (l === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (l === 'END:VEVENT') {
      if (ev) {
        if (ev.RRULE) omitidos.recurrentes++;
        else if (!ev.DTSTART || !/T/.test(ev.DTSTART.v)) omitidos[ev.DTSTART ? 'todoElDia' : 'invalidos']++;
        else {
          const ini = icsABogota(ev.DTSTART.v, ev.DTSTART.tzid);
          const pedida = ev.CREATED ? icsABogota(ev.CREATED.v, ev.CREATED.tzid) : ev.DTSTAMP ? icsABogota(ev.DTSTAMP.v, ev.DTSTAMP.tzid) : null;
          if (!ini) omitidos.invalidos++;
          else {
            const titulo = desescapar(ev.SUMMARY?.v).trim();
            const descripcion = desescapar(ev.DESCRIPTION?.v).trim();
            eventos.push({
              uid: ev.UID?.v || `${ini.fecha}-${ini.hora}-${titulo}`, fecha: ini.fecha, hora: ini.hora,
              pedidaEn: pedida ? pedida.iso : null, cancelada: (ev.STATUS?.v || '').toUpperCase() === 'CANCELLED',
              titulo, descripcion, ...extraerDatosCliente(titulo, descripcion),
            });
          }
        }
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    const i = l.indexOf(':');
    if (i < 0) continue;
    const partes = l.slice(0, i).split(';');
    const nombre = partes[0].toUpperCase();
    const tz = partes.find((x) => /^TZID=/i.test(x));
    if (!ev[nombre]) ev[nombre] = { v: l.slice(i + 1), tzid: tz ? tz.slice(5).replace(/^"|"$/g, '') : null };
  }
  return { eventos, omitidos };
}
