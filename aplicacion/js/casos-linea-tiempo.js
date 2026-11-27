// Línea de tiempo única de un caso: une seguimientos, comunicaciones (cartas y pruebas), decisiones del propietario,
// archivos y sincronización con Sedi. Solo lectura; el contenido sale de las mismas tablas (sin copiar datos).
// Presentación "de museo": resumen arriba, línea vertical con hitos por fecha agrupados por mes y un detalle que se abre
// en una ventana emergente (hoja inferior en celular). Cada tipo lleva ícono + palabra (el color nunca va solo); las pruebas
// se ven distintas ("no llegó al cliente") y están ocultas por defecto; nunca se muestran datos personales (los correos ya vienen enmascarados).
import { eventoDeSeguimiento } from './casos-seguimientos.js';
const TIPOS = {
  seguimiento: { ico: '📝', nombre: 'Seguimiento', fg: '#1A2C45', bg: '#EEF1F5', ac: '#1A2C45' },
  estado: { ico: '➜', nombre: 'Estado', fg: '#1A2C45', bg: '#E6ECF5', ac: '#1A2C45' },
  correo_in: { ico: '📥', nombre: 'Correo recibido', fg: '#1A2C45', bg: '#E6ECF5', ac: '#1A2C45' },
  correo_out: { ico: '📤', nombre: 'Correo enviado', fg: '#0B6661', bg: '#E3F4F3', ac: '#0B7A75' },
  carta: { ico: '✉', nombre: 'Carta enviada', fg: '#0B6661', bg: '#E3F4F3', ac: '#0B7A75' },
  prueba: { ico: '✉⚗', nombre: 'PRUEBA · no llegó al cliente', fg: '#4F5B6C', bg: '#F4F4F4', ac: '#586780' },
  borrador: { ico: '✉', nombre: 'Borrador sin enviar', fg: '#4F5B6C', bg: '#EEF1F5', ac: '#586780' },
  decision: { ico: '✔', nombre: 'Decisión del propietario', fg: '#0B6661', bg: '#E3F4F3', ac: '#0B7A75' },
  archivo: { ico: '📎', nombre: 'Archivo', fg: '#8F5500', bg: '#FFF4DF', ac: '#B26A00' },
  sedi: { ico: '⇄', nombre: 'Sedi', fg: '#4F5B6C', bg: '#EEF1F5', ac: '#586780' },
  error: { ico: '⚠', nombre: 'Sedi · con error', fg: '#B3261E', bg: '#FCE8E8', ac: '#B3261E' },
};
const DEC = { pendiente: ['Esperando respuesta', '#8F5500', '#FFF4DF'], acepta: ['Autorizó', '#0B6661', '#E3F4F3'], rechaza: ['No autorizó', '#B3261E', '#FCE8E8'], sin_respuesta: ['Sin respuesta', '#4F5B6C', '#EEF1F5'] };
const NOMBRE_PLANTILLA = { entrega_a_tiempo: 'Carta de entrega a tiempo', renovado_820: 'Carta de contrato prorrogado', aviso_propietario: 'Aviso al propietario', informe_mantenimiento: 'Informe de mantenimiento', encuesta_mantenimiento: 'Encuesta de satisfacción', otra: 'Comunicado' };
const ACCION_SEDI = { crear: 'Crear el caso en Sedi', seguimiento: 'Pasar seguimiento a Sedi', cambiar_estado: 'Cambiar estado en Sedi', cerrar: 'Cerrar en Sedi', adjuntar: 'Adjuntar archivo en Sedi' };
const ESTADO_SEDI = { pendiente: 'pendiente', en_proceso: 'en proceso', hecho: 'hecho', error: 'con error', omitido: 'omitido' };
const FILTROS = [['todo', 'Todo'], ['comunicaciones', 'Comunicaciones'], ['seguimientos', 'Seguimientos'], ['archivos', 'Archivos'], ['sedi', 'Sedi']];

const dia = (iso) => new Date(new Date(iso).getTime() - 5 * 3600000).toISOString().slice(0, 10);
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' });
const fechaCompleta = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', hour12: false, timeZone: 'America/Bogota' });
const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const deClave = (k) => new Date(k + 'T12:00:00Z');
const etiquetaDia = (k) => {
  const hoy = dia(new Date().toISOString()); const ayer = dia(new Date(Date.now() - 86400000).toISOString());
  if (k === hoy) return 'Hoy'; if (k === ayer) return 'Ayer'; return '';
};
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Une todas las fuentes en una lista de eventos ordenada (más reciente primero). */
const PRIO = { 1: 'Urgente', 2: 'Esta semana', 3: 'Pendiente' };
const fechaLarga = (f) => (f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sin fecha');

/** Cambios registrados por el trigger (sql/122). `estados` = etiquetas de estado de este tipo de caso. */
function eventoDeCambio(e, estados = {}) {
  const est = (v) => estados[v] || v || '—';
  if (e.campo === 'estado') return { titulo: `Cambió el estado: ${est(e.valor_anterior)} → ${est(e.valor_nuevo)}`, detalle: { De: est(e.valor_anterior), A: est(e.valor_nuevo) } };
  if (e.campo === 'prioridad') return { titulo: `Cambió la prioridad: ${PRIO[e.valor_anterior] || '—'} → ${PRIO[e.valor_nuevo] || '—'}`, detalle: { De: PRIO[e.valor_anterior] || '—', A: PRIO[e.valor_nuevo] || '—' } };
  if (e.campo === 'fecha_limite') return { titulo: `Cambió la fecha límite: ${fechaLarga(e.valor_anterior)} → ${fechaLarga(e.valor_nuevo)}`, detalle: { De: fechaLarga(e.valor_anterior), A: fechaLarga(e.valor_nuevo) } };
  return { titulo: e.valor_nuevo ? 'Se asignó un responsable del caso' : 'Se quitó el responsable del caso', detalle: {} };
}

export function construirEventos(caso, { seg = [], arch = [], com = [], cola = [], cambios = [], estados = {} } = {}) {
  const ev = [];
  for (const c of cambios) { const { titulo, detalle } = eventoDeCambio(c, estados); ev.push({ id: 'cam-' + c.id, cuando: c.creado_en, tipo: 'estado', grupo: 'seguimientos', titulo, detalle }); }
  // Un caso traído de Sedi no «se abrió» el día que se importó: se usan las fechas reales del caso (aviso del arrendatario, entrega).
  const dd = caso.datos || {};
  if (caso.origen === 'sedi' && dd.fecha_aviso) ev.push({ id: 'aviso', cuando: `${dd.fecha_aviso}T12:00:00-05:00`, tipo: 'estado', grupo: 'seguimientos', titulo: `${dd.solicitante || 'El arrendatario'} avisó que no continúa`, detalle: { 'Fecha del aviso': dd.fecha_aviso, 'Entrega acordada': dd.fecha_entrega || '', Origen: 'Registrado en Sedi' } });
  // Asambleas: la fecha real del hito es la de la asamblea (no la de cuando se importó el dato).
  if (caso.tipo === 'asamblea' && dd.fecha_asamblea) ev.push({ id: 'asamblea', cuando: `${dd.fecha_asamblea}T12:00:00-05:00`, tipo: 'estado', grupo: 'seguimientos', titulo: `${dd.tipo_asamblea || 'Asamblea'}${dd.modalidad && dd.modalidad !== 'Por confirmar' ? ' · ' + dd.modalidad : ''}`, detalle: { 'Fecha de la asamblea': dd.fecha_asamblea, Hora: dd.hora, Poder: dd.poder, Nota: dd.nota } });
  // «Se abrió el caso» solo si se creó en la agenda: en un caso importado esa fecha es la de la importación y confunde.
  if (caso.origen === 'sedi' && dd.fecha_aviso) { /* ya está el hito del aviso */ }
  else if (caso.creado_en && !['sedi', 'correo'].includes(caso.origen)) ev.push({ id: 'caso-ini', cuando: caso.creado_en, tipo: 'estado', grupo: 'seguimientos', titulo: 'Se abrió el caso', detalle: { Origen: caso.origen === 'sedi' ? 'Traído de Sedi' : 'Creado en la agenda' } });
  for (const s of seg) { const { titulo, detalle } = eventoDeSeguimiento(s); ev.push({ id: 'seg-' + s.id, cuando: s.creado_en, tipo: 'seguimiento', grupo: 'seguimientos', titulo, detalle }); }
  for (const a of arch) ev.push({ id: 'arc-' + a.id, cuando: a.creado_en, tipo: 'archivo', grupo: 'archivos', titulo: `Se agregó ${a.tipo === 'foto' ? 'la foto' : 'el archivo'} «${a.nombre}»`, detalle: { Tipo: a.tipo }, enlace: a.drive_url, enlaceTexto: 'Abrir en Drive' });
  for (const c of com) {
    const nombre = NOMBRE_PLANTILLA[c.plantilla] || 'Comunicado';
    const rol = c.destinatario === 'propietario' ? 'al propietario' : 'al arrendatario';
    const tipo = c.estado === 'prueba' ? 'prueba' : c.estado === 'borrador' ? 'borrador' : 'carta';
    const cuando = c.enviada_en || c.creado_en;
    ev.push({ id: 'com-' + c.id, cuando, tipo, grupo: 'comunicaciones', esPrueba: c.estado === 'prueba', titulo: c.estado === 'enviada' ? `${nombre} enviada ${rol}` : c.estado === 'prueba' ? `Prueba de «${nombre}» (no llegó ${rol})` : `${nombre}: borrador sin enviar`,
      detalle: { Asunto: c.asunto, Destinatario: c.destinatario === 'propietario' ? 'Propietario' : 'Arrendatario', 'Correo': c.correo_mascara || '', Enviada: c.enviada_en ? fechaCompleta(c.enviada_en) : '' }, cuerpo: c.cuerpo_html });
    if (c.estado === 'enviada' && c.propietario_decision) {
      const d = DEC[c.propietario_decision] || DEC.pendiente;
      ev.push({ id: 'dec-' + c.id, cuando: c.propietario_decidio_en || c.enviada_en || c.creado_en, tipo: 'decision', grupo: 'comunicaciones', titulo: `Decisión del propietario: ${d[0]}`, badge: d, detalle: { Aviso: c.asunto } });
    }
  }
  for (const q of cola) ev.push({ id: 'sedi-' + q.id, cuando: q.hecho_en || q.creado_en, tipo: 'sedi', grupo: 'sedi', error: q.estado === 'error', titulo: `${ACCION_SEDI[q.accion] || q.accion}: ${ESTADO_SEDI[q.estado] || q.estado}`, detalle: { Intentos: String(q.intentos ?? 0), Error: q.error || '' } });
  if (caso.cerrado_en) ev.push({ id: 'caso-fin', cuando: caso.cerrado_en, tipo: 'estado', grupo: 'seguimientos', titulo: 'Se cerró el caso', detalle: {} });
  return ev.filter((e) => e.cuando).sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
}

/** Tema del correo (lo decide Gemini en el lector) -> tipo de caso al que pertenece. */
export const FAMILIA = { TERMINACION: 'terminacion', ENTREGA: 'terminacion', REPARACION: 'mantenimiento', PQR: 'pqr', ASAMBLEA: 'asamblea' };
const PARTE_CORREO = { propietario: 'Propietario', arrendatario: 'Arrendatario', interno: 'Interno', otro: 'Otro' };

/** Un correo archivado (agenda_inmueble_correos) como hito de la línea de tiempo, con enlace al correo en Drive y a sus adjuntos. */
export function eventoDeCorreo(x) {
  const adj = x.adjuntos || [];
  const quien = x.direccion === 'entrante' ? x.de : x.para;
  return {
    id: 'cor-' + x.id, cuando: x.fecha, tipo: x.direccion === 'entrante' ? 'correo_in' : 'correo_out', grupo: 'comunicaciones',
    titulo: String(x.resumen || x.asunto || 'Correo').slice(0, 150), nAdjuntos: adj.length,
    detalle: { Resumen: x.resumen, Asunto: x.asunto, [x.direccion === 'entrante' ? 'Recibido de' : 'Enviado a']: quien, Parte: PARTE_CORREO[x.parte] || '', Tema: x.categoria, Buzón: x.buzon, Adjuntos: adj.map((a) => a.nombre).join(', ') },
    enlaces: [{ texto: '📂 Abrir el correo y sus adjuntos (copia en Drive)', url: x.enlace_drive }, { texto: 'Abrir en Gmail (solo quien tenga ese buzón)', url: x.enlace_gmail }, ...adj.filter((a) => a.url).map((a) => ({ texto: '📎 ' + a.nombre, url: a.url }))],
  };
}

export async function cargarEventos(supabase, caso, estados = {}) {
  // Correos archivados del mismo inmueble (y contrato) y del mismo tema que este caso.
  const cod = caso.datos && (caso.datos.n_inmueble || caso.datos.inmueble_cod);
  const correosP = cod ? supabase.from('agenda_inmueble_correos').select('*').eq('inmueble_cod', String(cod)).eq('estado', 'activo') : Promise.resolve({ data: [] });
  const [seg, arch, com, cola, cambios, cor] = await Promise.all([
    supabase.from('agenda_casos_seguimientos').select('*').eq('caso_id', caso.id),
    supabase.from('agenda_casos_archivos').select('*').eq('caso_id', caso.id),
    supabase.from('agenda_casos_comunicaciones').select('*').eq('caso_id', caso.id),
    supabase.from('agenda_sedi_cola').select('id,accion,estado,intentos,error,creado_en,hecho_en').eq('caso_id', caso.id),
    supabase.from('agenda_casos_eventos').select('*').eq('caso_id', caso.id), // si sql/122 no está aplicado, viene vacío
    correosP,
  ]);
  const delTema = (cor.data || []).filter((x) => FAMILIA[x.categoria] === caso.tipo && (!caso.contrato_ref || !x.contrato_ref || x.contrato_ref === caso.contrato_ref));
  const eventos = construirEventos(caso, { seg: seg.data || [], arch: arch.data || [], com: com.data || [], cola: cola.data || [], cambios: cambios.data || [], estados });
  return eventos.concat(delTema.map(eventoDeCorreo));
}

/* ───────────────────────── Presentación ───────────────────────── */

const CSS = `
.lt-raiz,.lt-fondo{--lt-azul:#1A2C45;--lt-turq:#0B7A75;--lt-ambar:#B26A00;--lt-rojo:#B3261E;--lt-gris:#586780;--lt-line:var(--v-line,#dde3ea);--lt-muted:var(--v-muted,#4F5B6C);--lt-bg:var(--v-bg,#fff);--lt-espina:#B8C3D1}
.lt-raiz{margin-top:12px;padding:16px;border:1px solid var(--lt-line);border-radius:12px;container-type:inline-size;box-sizing:border-box;max-width:100%;overflow:hidden}
.lt-raiz *,.lt-fondo *{box-sizing:border-box}
.lt-h{margin:0}
.lt-sub{margin:4px 0 12px;font-size:13px;color:var(--lt-muted)}
.lt-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lt-resumen{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 14px}
.lt-dato{border:1px solid var(--lt-line);border-radius:12px;padding:10px 12px;background:var(--lt-bg);min-width:0}
.lt-dato b{display:block;font-size:26px;line-height:1.1;color:var(--lt-azul)}
.lt-dato span{display:block;font-size:13px;color:var(--lt-muted);margin-top:2px}
.lt-ancho{grid-column:1/-1}
.lt-ancho .lt-nov{display:block;font-size:15px;font-weight:600;color:var(--lt-azul);margin-top:2px;overflow-wrap:anywhere}
.lt-sigue{border-color:var(--lt-ambar);background:#FFF9EE}
.lt-sigue ul{margin:6px 0 0;padding-left:20px;color:#5E3900;font-size:14px}
.lt-sigue .lt-eti{font-weight:700;color:#8F5500;font-size:14px}
.lt-controles{display:flex;flex-direction:column;gap:8px;margin:0 0 6px}
.lt-filtros{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;max-width:100%}
.lt-btn{font:inherit;font-size:14px;min-height:44px;min-width:44px;padding:0 16px;border-radius:999px;border:1px solid var(--lt-gris);background:var(--lt-bg);color:var(--lt-azul);cursor:pointer;white-space:nowrap}
.lt-btn[aria-pressed="true"]{background:var(--lt-azul);color:#fff;border-color:var(--lt-azul);font-weight:700}
.lt-fila-c{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.lt-busca{flex:1;min-width:180px;min-height:44px;font:inherit}
.lt-chk{display:flex;gap:8px;align-items:center;min-height:44px;font-size:14px}
.lt-chk input{width:22px;height:22px}
.lt-cuenta{font-size:12px;color:var(--lt-muted);margin:0 0 4px}
.lt-vacio{text-align:center;padding:28px 12px;border:1px dashed var(--lt-gris);border-radius:12px;margin-top:10px}
.lt-vacio .lt-ico{font-size:32px}
.lt-vacio p{margin:6px 0;color:var(--lt-muted)}
.lt-vacio strong{color:var(--lt-azul);font-size:16px}
.lt-linea{position:relative;margin-top:8px}
.lt-linea::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:4px;margin-left:-2px;border-radius:2px;background:var(--lt-espina)}
.lt-linea ol{list-style:none;margin:0;padding:0}
.lt-mes{position:relative;z-index:1;display:flex;justify-content:center;margin:20px 0 6px}
.lt-mes span{background:var(--lt-azul);color:#fff;padding:8px 18px;border-radius:999px;font-weight:700;font-size:15px;text-transform:capitalize}
.lt-fecha{position:relative;z-index:1;display:flex;justify-content:center;margin:14px 0 6px}
.lt-caja{background:var(--lt-bg);border:2px solid var(--lt-azul);border-radius:14px;padding:4px 14px;text-align:center;min-width:84px;color:var(--lt-azul)}
.lt-caja small{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.lt-caja b{display:block;font-size:28px;line-height:1}
.lt-largo{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.lt-ev{position:relative;display:grid;grid-template-columns:1fr 64px 1fr;align-items:start}
.lt-nodo{grid-column:2;grid-row:1;justify-self:center;margin-top:8px;z-index:1;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--lt-bg);border:3px solid var(--ac,#1A2C45);color:var(--ac,#1A2C45)}
.lt-nodo.lt-p{border-style:dashed}
.lt-carta{position:relative;grid-row:1;display:block;width:100%;min-width:0;min-height:44px;margin:0 0 14px;padding:12px 14px;text-align:left;font:inherit;color:inherit;background:var(--lt-bg);border:1px solid var(--lt-line);border-left:5px solid var(--ac,#1A2C45);border-radius:12px;overflow-wrap:anywhere}
button.lt-carta{cursor:pointer}
button.lt-carta:hover{border-color:var(--ac,#1A2C45);box-shadow:0 2px 10px rgba(26,44,69,.14)}
.lt-carta:focus-visible,.lt-btn:focus-visible,.lt-m button:focus-visible,.lt-m a:focus-visible,.lt-m [tabindex]:focus-visible{outline:3px solid var(--lt-turq);outline-offset:2px}
.lt-carta.lt-p{border-style:dashed;border-left-style:dashed;background:repeating-linear-gradient(45deg,#F4F4F4,#F4F4F4 8px,#FAFAFA 8px,#FAFAFA 16px)}
.lt-carta::before{content:"";position:absolute;top:26px;width:16px;height:3px;background:var(--lt-espina)}
.lt-izq .lt-carta{grid-column:1;margin-right:14px;text-align:left}
.lt-izq .lt-carta::before{right:-17px}
.lt-der .lt-carta{grid-column:3;margin-left:14px}
.lt-der .lt-carta::before{left:-17px}
.lt-izq .lt-carta{border-left-width:1px;border-right:5px solid var(--ac,#1A2C45)}
.lt-sup{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.lt-ins{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
.lt-hora{margin-left:auto;font-size:12px;color:var(--lt-muted)}
.lt-tit{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:6px;font-size:15px}
.lt-mas{display:block;margin-top:6px;font-size:13px;font-weight:700;color:var(--lt-turq)}
@container (max-width:680px){
  .lt-linea::before{left:28px;margin-left:0}
  .lt-mes{justify-content:flex-start}
  .lt-fecha{justify-content:flex-start;align-items:center;gap:10px}
  .lt-caja{min-width:56px;width:56px;padding:4px 2px;border-radius:12px}
  .lt-caja b{font-size:22px}
  .lt-largo{position:static;width:auto;height:auto;overflow:visible;clip:auto;font-size:14px;font-weight:700;color:var(--lt-azul);background:var(--lt-bg);padding:0 6px}
  .lt-ev{grid-template-columns:56px 1fr}
  .lt-nodo{grid-column:1}
  .lt-izq .lt-carta,.lt-der .lt-carta{grid-column:2;margin:0 0 12px 8px;border-right:1px solid var(--lt-line);border-left:5px solid var(--ac,#1A2C45)}
  .lt-carta.lt-p{border-right-style:dashed}
  .lt-izq .lt-carta::before,.lt-der .lt-carta::before{left:-13px;right:auto;width:12px}
  .lt-hora{margin-left:auto}
}
/* Ventana emergente (vive en <body>, por eso usa @media y no el contenedor) */
.lt-fondo{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(26,44,69,.6)}
.lt-m{display:flex;flex-direction:column;width:min(760px,100%);max-height:min(90vh,920px);background:#fff;color:#1A2C45;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:inherit}
.lt-m-cab{display:flex;gap:12px;align-items:flex-start;padding:16px 16px 12px;border-bottom:1px solid #dde3ea}
.lt-m-cab > div{flex:1;min-width:0}
.lt-m-tit{margin:8px 0 2px;font-size:19px;line-height:1.25;overflow-wrap:anywhere;outline:none}
.lt-m-fecha{font-size:13px;color:#4F5B6C}
.lt-m-x{flex:none;min-width:44px;min-height:44px;border:1px solid #586780;border-radius:999px;background:#fff;color:#1A2C45;font:inherit;font-size:14px;font-weight:700;padding:0 14px;cursor:pointer}
.lt-m-cuerpo{flex:1;overflow:auto;padding:14px 16px;display:grid;gap:12px;align-content:start;-webkit-overflow-scrolling:touch}
.lt-m dl{margin:0;display:grid;gap:10px}
.lt-m dt{font-size:12px;color:#4F5B6C}
.lt-m dd{margin:0;overflow-wrap:anywhere;font-size:15px}
.lt-aviso{padding:10px 12px;border:1px dashed #586780;border-radius:10px;background:#F4F4F4;font-size:14px}
.lt-enlace{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:#1A2C45;color:#fff;font-weight:700;text-decoration:none}
.lt-m-cap{font-size:12px;color:#4F5B6C;margin:0 0 4px}
.lt-iframe{display:block;width:100%;height:clamp(320px,60vh,760px);border:1px solid #dde3ea;border-radius:8px;background:#fff}
.lt-m-pie{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid #dde3ea;background:#F7F9FB}
.lt-m-pie span{font-size:13px;color:#4F5B6C}
.lt-m-pie button{min-height:44px;min-width:44px;padding:0 14px;border-radius:999px;border:1px solid #586780;background:#fff;color:#1A2C45;font:inherit;font-size:14px;cursor:pointer}
.lt-m-pie button[disabled]{opacity:.45;cursor:default}
.lt-m-agarre{display:none}
@media (max-width:640px){
  .lt-fondo{align-items:flex-end;padding:0}
  .lt-m{width:100%;height:94vh;height:94dvh;max-height:none;border-radius:18px 18px 0 0}
  .lt-m-agarre{display:block;width:44px;height:5px;border-radius:3px;background:#B8C3D1;margin:8px auto 0}
  .lt-iframe{height:max(360px,60vh);height:max(360px,60dvh)}
}
@media (prefers-reduced-motion:no-preference){
  .lt-carta{transition:box-shadow .15s ease,border-color .15s ease}
  .lt-fondo{animation:lt-fade .18s ease-out}
  .lt-m{animation:lt-sube .22s ease-out}
  @keyframes lt-fade{from{opacity:0}to{opacity:1}}
  @keyframes lt-sube{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
}
`;

function inyectarEstilos() {
  if (document.getElementById('lt-estilos')) return;
  const s = document.createElement('style'); s.id = 'lt-estilos'; s.textContent = CSS; document.head.appendChild(s);
}

const tipoDe = (e) => TIPOS[e.error ? 'error' : e.tipo] || TIPOS.seguimiento;
const enlaceValido = (e) => !!(e.enlace && /^https:\/\//i.test(e.enlace));
const tieneDetalle = (e) => !!(e.cuerpo || enlaceValido(e) || (e.enlaces || []).length || Object.values(e.detalle || {}).some((v) => v));
const insignia = (t, esc) => `<span class="lt-ins" style="color:${t[1]};background:${t[2]}"><span aria-hidden="true">${t[3] ? esc(t[3]) + ' ' : ''}</span>${esc(t[0])}</span>`;
const insTipo = (e, esc) => { const t = tipoDe(e); return insignia([t.nombre, t.fg, t.bg, t.ico], esc); };
const insBadge = (e, esc) => (e.badge ? insignia([e.badge[0], e.badge[1], e.badge[2]], esc) : '');

let cerrarPrevio = null; // si quedó una ventana abierta de un pintado anterior, se cierra al volver a montar

function resumen(eventos, esc) {
  const reales = eventos.filter((e) => !e.esPrueba);
  if (!reales.length) return '';
  const ms = (e) => new Date(e.cuando).getTime();
  const ini = reales.find((e) => e.id === 'caso-ini') || reales.reduce((a, b) => (ms(b) < ms(a) ? b : a));
  const fin = reales.find((e) => e.id === 'caso-fin');
  const ult = reales.reduce((a, b) => (ms(b) > ms(a) ? b : a));
  const dias = Math.max(0, Math.floor(((fin ? ms(fin) : Date.now()) - ms(ini)) / 86400000));
  const nCom = reales.filter((e) => e.tipo === 'carta' || e.tipo === 'correo_in' || e.tipo === 'correo_out').length;
  const nArc = reales.filter((e) => e.tipo === 'archivo').length + reales.reduce((s, e) => s + (e.nAdjuntos || 0), 0);
  const sigue = [];
  if (!fin) {
    const pend = reales.filter((e) => e.badge && e.badge[0] === DEC.pendiente[0]).length;
    const borr = reales.filter((e) => e.tipo === 'borrador').length;
    const err = reales.filter((e) => e.error).length;
    if (pend) sigue.push(pend === 1 ? 'Esperando la respuesta del propietario' : `Esperando la respuesta del propietario en ${pend} avisos`);
    if (borr) sigue.push(borr === 1 ? 'Hay una carta en borrador sin enviar' : `Hay ${borr} cartas en borrador sin enviar`);
    if (err) sigue.push(err === 1 ? 'Revisar un error de sincronización con Sedi' : `Revisar ${err} errores de sincronización con Sedi`);
  }
  const bloqueDias = dias === 0
    ? `<b>Hoy</b><span>${fin ? 'se abrió y se cerró' : 'se abrió el caso'}</span>`
    : `<b>${dias}</b><span>${dias === 1 ? 'día' : 'días'} ${fin ? 'de duración (caso cerrado)' : 'abierto'}</span>`;
  return `<div class="lt-resumen" role="group" aria-label="Resumen del caso">
    <div class="lt-dato">${bloqueDias}</div>
    <div class="lt-dato"><b>${nCom}</b><span>${nCom === 1 ? 'correo o carta' : 'correos y cartas'}</span></div>
    <div class="lt-dato"><b>${nArc}</b><span>${nArc === 1 ? 'archivo' : 'archivos'}</span></div>
    <div class="lt-dato lt-ancho"><span>Última novedad · ${esc(fechaCorta(ult.cuando))}</span><span class="lt-nov">${esc(ult.titulo)}</span></div>
    ${sigue.length ? `<div class="lt-dato lt-ancho lt-sigue"><span class="lt-eti"><span aria-hidden="true">➜</span> Qué sigue</span><ul>${sigue.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function tarjeta(e, lado, esc) {
  const t = tipoDe(e); const det = tieneDetalle(e);
  const p = e.esPrueba ? ' lt-p' : '';
  const interior = `<span class="lt-sup">${insTipo(e, esc)}${insBadge(e, esc)}<time class="lt-hora" datetime="${esc(String(e.cuando))}">${esc(hora(e.cuando))}</time></span><span class="lt-tit">${esc(e.titulo)}</span>${det ? `<span class="lt-mas">${e.cuerpo ? 'Ver la carta completa' : /^correo_/.test(e.tipo) ? 'Abrir el correo y sus adjuntos' : 'Ver detalle'} <span aria-hidden="true">›</span></span>` : ''}`;
  const carta = det
    ? `<button type="button" class="lt-carta${p}" data-lt-abrir="${esc(e.id)}" aria-haspopup="dialog" style="--ac:${t.ac}">${interior}</button>`
    : `<div class="lt-carta${p}" style="--ac:${t.ac}">${interior}</div>`;
  return `<li class="lt-ev ${lado}"><span class="lt-nodo${p}" style="--ac:${t.ac}" aria-hidden="true">${esc(t.ico)}</span>${carta}</li>`;
}

function lineaHtml(lista, esc) {
  let n = 0; let html = ''; let mes = ''; let diaK = ''; let abiertoDia = false;
  const cierraDia = () => { if (abiertoDia) { html += '</ol></li>'; abiertoDia = false; } };
  html += '<ol class="lt-meses">';
  for (const e of lista) {
    const k = dia(e.cuando);
    if (k.slice(0, 7) !== mes) {
      cierraDia(); mes = k.slice(0, 7); diaK = '';
      const nombre = deClave(k).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      html += `<li class="lt-mes" aria-hidden="false"><span>${esc(nombre)}</span></li>`;
    }
    if (k !== diaK) {
      cierraDia(); diaK = k; const d = deClave(k);
      const rel = etiquetaDia(k);
      const sem = d.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
      const mesCorto = d.toLocaleDateString('es-CO', { month: 'short', timeZone: 'UTC' }).replace('.', '');
      const largo = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      html += `<li class="lt-dia"><div class="lt-fecha"><div class="lt-caja"><small>${esc(rel || sem)}</small><b>${d.getUTCDate()}</b><small>${esc(mesCorto)}</small></div><span class="lt-largo">${esc(rel ? rel + ' · ' + largo : largo)}</span></div><ol>`;
      abiertoDia = true;
    }
    html += tarjeta(e, n % 2 === 0 ? 'lt-izq' : 'lt-der', esc); n++;
  }
  cierraDia();
  return html + '</ol>';
}

/** Pinta la línea de tiempo dentro de `host`. st = {filtro, pruebas, busca, abierto} se conserva entre repintados. */
export function montarLineaTiempo(host, eventos, st, escape) {
  const esc = escape;
  inyectarEstilos();
  if (cerrarPrevio) cerrarPrevio();
  st.abierto = null;
  const nPruebas = eventos.filter((e) => e.esPrueba).length;
  const hayEventos = eventos.length > 0;

  host.innerHTML = `<section class="lt-raiz" aria-labelledby="lt-tit">
    <h3 id="lt-tit" class="lt-h">Línea de tiempo</h3>
    <p class="lt-sub">La historia del caso, fecha por fecha: lo que se hizo, las cartas enviadas y los archivos. Toca un hito para ver el detalle.</p>
    ${hayEventos ? resumen(eventos, esc) : ''}
    ${hayEventos ? `<div class="lt-controles">
      <div class="lt-filtros" role="group" aria-label="Filtrar por tipo">${FILTROS.map(([k, t]) => `<button type="button" class="lt-btn" data-lt-filtro="${k}" aria-pressed="${st.filtro === k}">${t}</button>`).join('')}</div>
      <div class="lt-fila-c">
        <input id="lt-busca" class="v-input lt-busca" type="search" placeholder="Buscar en la línea de tiempo" aria-label="Buscar en la línea de tiempo" value="${esc(st.busca || '')}">
        <label class="lt-chk"><input type="checkbox" id="lt-pruebas" ${st.pruebas ? 'checked' : ''}> Mostrar pruebas${nPruebas ? ` (${nPruebas})` : ''}</label>
        <button type="button" id="lt-orden" class="lt-btn"></button>
      </div></div>
      <p class="lt-cuenta" id="lt-cuenta" aria-live="polite"></p>` : ''}
    <div id="lt-res"></div></section>`;

  const res = host.querySelector('#lt-res');
  let visibles = [];

  const pintar = () => {
    if (!hayEventos) {
      res.innerHTML = `<div class="lt-vacio"><div class="lt-ico" aria-hidden="true">🕰</div><p><strong>Este caso apenas comienza</strong></p><p>Cuando haya seguimientos, cartas o archivos, irán apareciendo aquí en orden, fecha por fecha.</p></div>`;
      return;
    }
    const nuevoPrimero = st.orden === 'nuevo';
    const q = (st.busca || '').trim().toLowerCase();
    let lista = eventos.filter((e) => (st.pruebas || !e.esPrueba) && (st.filtro === 'todo' || e.grupo === st.filtro));
    if (q) lista = lista.filter((e) => (e.titulo + ' ' + Object.values(e.detalle || {}).join(' ')).toLowerCase().includes(q));
    lista = lista.slice().sort((a, b) => String(a.cuando).localeCompare(String(b.cuando)));
    if (nuevoPrimero) lista.reverse();
    visibles = lista;
    host.querySelectorAll('[data-lt-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(st.filtro === b.dataset.ltFiltro)));
    const ordenBtn = host.querySelector('#lt-orden');
    ordenBtn.textContent = nuevoPrimero ? '↑ Ver lo más antiguo primero' : '↓ Ver lo más reciente primero';
    const ocultas = !st.pruebas && nPruebas;
    host.querySelector('#lt-cuenta').textContent = `${pl(lista.length, 'hito', 'hitos')}${ocultas ? `, ${pl(nPruebas, 'prueba oculta', 'pruebas ocultas')}` : ''}`;
    if (!lista.length) {
      res.innerHTML = `<div class="lt-vacio"><div class="lt-ico" aria-hidden="true">🔎</div><p><strong>No encontramos hitos con este filtro</strong></p><p>Prueba con otra categoría o borra la búsqueda.</p><button type="button" class="lt-btn" data-lt-reset>Ver todo</button></div>`;
      return;
    }
    res.innerHTML = `<div class="lt-linea">${lineaHtml(lista, esc)}</div>`;
  };

  /* ── Ventana emergente ── */
  const abrir = (id, opener) => {
    const e = eventos.find((x) => x.id === id); if (!e || !tieneDetalle(e)) return;
    const nav = visibles.filter(tieneDetalle);
    let pos = Math.max(0, nav.findIndex((x) => x.id === id));
    const foco = opener || document.activeElement;
    const overflowPrevio = document.body.style.overflow;
    const fondo = document.createElement('div'); fondo.className = 'lt-fondo';
    const modal = document.createElement('div'); modal.className = 'lt-m';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'lt-m-tit');
    fondo.appendChild(modal); document.body.appendChild(fondo);
    document.body.style.overflow = 'hidden';

    const contenido = (ev) => {
      const filas = Object.entries(ev.detalle || {}).filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('');
      return `<div class="lt-m-agarre" aria-hidden="true"></div>
        <div class="lt-m-cab"><div><span class="lt-sup">${insTipo(ev, esc)}${insBadge(ev, esc)}</span>
          <h2 class="lt-m-tit" id="lt-m-tit" tabindex="-1">${esc(ev.titulo)}</h2>
          <div class="lt-m-fecha">${esc(fechaCompleta(ev.cuando))} (hora de Bogotá)</div></div>
          <button type="button" class="lt-m-x" data-lt-cerrar aria-label="Cerrar ventana"><span aria-hidden="true">✕</span> Cerrar</button></div>
        <div class="lt-m-cuerpo">
          ${ev.esPrueba ? '<div class="lt-aviso"><strong>Esto es una prueba.</strong> No llegó al cliente.</div>' : ''}
          ${filas ? `<dl>${filas}</dl>` : ''}
          ${enlaceValido(ev) ? `<div><a class="lt-enlace" href="${esc(ev.enlace)}" target="_blank" rel="noopener noreferrer">${esc(ev.enlaceTexto || 'Abrir')}</a></div>` : ''}
          ${(ev.enlaces || []).filter((x) => /^https:\/\//i.test(x.url || '')).map((x) => `<div><a class="lt-enlace" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.texto)}</a></div>`).join('')}
          ${ev.cuerpo ? `<div><p class="lt-m-cap">Copia exacta de lo que se envió</p><iframe class="lt-iframe" title="Copia del correo" sandbox="" srcdoc="${esc(ev.cuerpo)}"></iframe></div>` : ''}
        </div>
        ${nav.length > 1 ? `<div class="lt-m-pie"><button type="button" data-lt-nav="-1" ${pos === 0 ? 'disabled' : ''}><span aria-hidden="true">‹</span> Anterior</button><span>${pos + 1} de ${nav.length}</span><button type="button" data-lt-nav="1" ${pos === nav.length - 1 ? 'disabled' : ''}>Siguiente <span aria-hidden="true">›</span></button></div>` : ''}`;
    };
    const dibujar = (enfoca) => {
      modal.innerHTML = contenido(nav[pos]);
      modal.querySelector('[data-lt-cerrar]').onclick = cerrar;
      modal.querySelectorAll('[data-lt-nav]').forEach((b) => { b.onclick = () => { pos += Number(b.dataset.ltNav); st.abierto = nav[pos].id; dibujar(true); }; });
      modal.querySelector('.lt-m-cuerpo').scrollTop = 0;
      if (enfoca) modal.querySelector('#lt-m-tit').focus();
    };
    const focables = () => [...modal.querySelectorAll('button:not([disabled]),a[href],iframe')];
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrar(); return; }
      if (ev.key !== 'Tab') return;
      const f = focables(); if (!f.length) { ev.preventDefault(); return; }
      const dentro = modal.contains(document.activeElement);
      if (ev.shiftKey && (!dentro || document.activeElement === f[0] || document.activeElement === modal.querySelector('#lt-m-tit'))) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && (!dentro || document.activeElement === f[f.length - 1])) { ev.preventDefault(); f[0].focus(); }
    };
    const onFocoFuera = (ev) => { if (!modal.contains(ev.target)) { const f = focables(); (f[0] || modal).focus(); } };
    fondo.addEventListener('mousedown', (ev) => { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocoFuera);
    function cerrar() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocoFuera);
      fondo.remove(); document.body.style.overflow = overflowPrevio;
      st.abierto = null; if (cerrarPrevio === cerrar) cerrarPrevio = null;
      const volver = foco && document.contains(foco) ? foco : host.querySelector('[data-lt-abrir]');
      if (volver && volver.focus) volver.focus();
    }
    cerrarPrevio = cerrar;
    st.abierto = id;
    dibujar(false);
    modal.querySelector('[data-lt-cerrar]').focus();
  };

  if (hayEventos) {
    host.querySelectorAll('[data-lt-filtro]').forEach((b) => { b.onclick = () => { st.filtro = b.dataset.ltFiltro; pintar(); }; });
    host.querySelector('#lt-pruebas').onchange = (ev) => { st.pruebas = ev.target.checked; pintar(); };
    host.querySelector('#lt-orden').onclick = () => { st.orden = st.orden === 'nuevo' ? 'antiguo' : 'nuevo'; pintar(); };
    host.querySelector('#lt-busca').oninput = (ev) => { st.busca = ev.target.value; pintar(); };
  }
  res.onclick = (ev) => {
    const b = ev.target.closest('[data-lt-abrir]');
    if (b) { abrir(b.dataset.ltAbrir, b); return; }
    if (ev.target.closest('[data-lt-reset]')) { st.filtro = 'todo'; st.busca = ''; const c = host.querySelector('#lt-busca'); if (c) c.value = ''; pintar(); }
  };
  pintar();
}
