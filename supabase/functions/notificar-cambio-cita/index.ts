// Edge Function: notificar-cambio-cita
// Avisa por correo a las personas afectadas cuando una visita se MUEVE de hora o se CANCELA por una vía
// que no manda correos sola: el botón Mover/Cancelar de la agenda interna (llama un miembro con sesión)
// o el enlace del cliente (llama portal-visita con la service role).
//   accion 'movida'    → cliente y propietario reciben el correo de siempre con la hora nueva
//                        (enviar-correo-cita / enviar-correo-propietario con reagendada) y, si el inmueble
//                        está Rentando, el arrendatario recibe el aviso del cambio de hora.
//   accion 'cancelada' → cliente y propietario reciben el aviso de cancelación con la invitación de
//                        calendario en versión CANCEL (se borra de su calendario) y, si está Rentando,
//                        el arrendatario. La cita ya debe estar cancelada en la base.
// origen: 'asesor' (agenda interna) | 'cliente' (enlace del cliente). Los textos cambian según el origen y
// según el tipo de inmueble (vivienda, oficina, local...): no todo lo que se visita es una vivienda.
import { preferenciasDe, urlPreferencias } from '../_shared/preferencias-propietario.ts';
import type { BotonCorreo } from '../_shared/plantilla-correo.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, enlaceInmueble, marcaCorreo, type MarcaCorreo, emojiTitulo, pieContacto } from '../_shared/marca-correo.ts';
import { correoBase } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function esc(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatearFecha(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

// Mismo recorte de dirección que los demás correos: sin torre/apto/oficina.
const REGEX_UNIDAD_INTERNA =
  /\b(AP|APTO|APT|APARTAMENTO|CS|CASA|IN|INT|INTERIOR|PISO|T|TORRE|TO|BLOQUE|BQ|BL|OF|OFC|OFICINA|MZ|MANZANA|CONJ|CON|DP|CONS|CONSULTORIO|LC|LOCAL(ES)?|L)\s*\d+\b/gi;
function limpiarDireccion(d: string | null | undefined): string {
  if (!d) return '';
  return d.replace(REGEX_UNIDAD_INTERNA, ' ').replace(/[,-]{2,}/g, ',').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}

// Cómo llamar al inmueble según su tipo: una oficina o un local no son una "vivienda".
function sustantivo(tipo: string | null | undefined): { n: string; el: string } {
  switch (String(tipo || '').trim().toUpperCase()) {
    case 'APARTAMENTO':
    case 'CASA':
    case 'APARTAESTUDIO':
      return { n: 'vivienda', el: 'la vivienda' };
    case 'OFICINA':
      return { n: 'oficina', el: 'la oficina' };
    case 'LOCAL':
      return { n: 'local', el: 'el local' };
    case 'CONSULTORIO':
      return { n: 'consultorio', el: 'el consultorio' };
    case 'BODEGA':
      return { n: 'bodega', el: 'la bodega' };
    case 'LOTE':
      return { n: 'lote', el: 'el lote' };
    default:
      return { n: 'inmueble', el: 'el inmueble' };
  }
}

function correosDe(texto: string | null | undefined): string[] {
  return String(texto || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
}

// ---- .ics (mismo constructor que enviar-correo-cita; cada función se despliega por separado) ----
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function aFechaICSUTC(fecha: string, hora: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [hh, mm, ss] = hora.split(':').map(Number);
  const dt = new Date(Date.UTC(anio, mes - 1, dia, (hh || 0) + 5, mm || 0, ss || 0));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}
function marcaDeTiempoICSAhora(): string {
  const a = new Date();
  return `${a.getUTCFullYear()}${pad2(a.getUTCMonth() + 1)}${pad2(a.getUTCDate())}T${pad2(a.getUTCHours())}${pad2(a.getUTCMinutes())}${pad2(a.getUTCSeconds())}Z`;
}
function escaparICS(texto: string | null | undefined): string {
  return String(texto || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function plegarLineaICS(linea: string): string {
  const partes: string[] = [];
  let resto = linea;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ' ' + resto.slice(74);
  }
  partes.push(resto);
  return partes.join('\r\n');
}
function icsCancelacion(o: {
  citaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  resumen: string;
  organizadorNombre: string;
  organizadorEmail: string;
  asistenteNombre: string;
  asistenteEmail: string;
}): string {
  // SEQUENCE con la hora actual: tiene que ser mayor que la de cualquier invitación anterior de esta
  // cita (al reagendar ya se usa la hora actual), o el calendario ignora la cancelación.
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Patrimonios Inmobiliarios//Agenda de Citas//ES',
    'METHOD:CANCEL',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:cita-${o.citaId}@patrimonios.co`,
    `DTSTAMP:${marcaDeTiempoICSAhora()}`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTART:${aFechaICSUTC(o.fecha, o.horaInicio)}`,
    `DTEND:${aFechaICSUTC(o.fecha, o.horaFin || o.horaInicio)}`,
    plegarLineaICS(`SUMMARY:${escaparICS(o.resumen)}`),
    plegarLineaICS('DESCRIPTION:Esta visita fue cancelada.'),
    plegarLineaICS(`ORGANIZER;CN=${escaparICS(o.organizadorNombre)}:mailto:${o.organizadorEmail}`),
    plegarLineaICS(`ATTENDEE;CN=${escaparICS(o.asistenteNombre)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${o.asistenteEmail}`),
    'STATUS:CANCELLED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lineas.join('\r\n');
}

function plantilla(o: {
  titulo: string;
  cuerpo: string; // HTML ya escapado
  boton?: { texto: string; url: string };
  botones?: BotonCorreo[];
  modoPruebas: boolean;
  destinatarioReal: string;
  remitente: string;
  marca: MarcaCorreo;
}) {
  return correoBase(o.marca, { titulo: o.titulo, cuerpo: o.cuerpo, tema: 'cambio', modoPruebas: o.modoPruebas, destinatarioReal: o.destinatarioReal, botones: o.botones ?? (o.boton ? [{ ...o.boton, variante: 'principal' }] : undefined) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }
  const citaId = String(body.cita_id || '');
  const accion = String(body.accion || '');
  // 'vencimiento': el arrendatario no podía recibir la visita y el cliente no eligió nueva hora a tiempo (portal-visita / pg_cron).
  const origen = body.origen === 'cliente' ? 'cliente' : body.origen === 'vencimiento' ? 'vencimiento' : 'asesor';
  if (!citaId) return json({ ok: false, error: 'Falta cita_id.' }, 400);
  if (accion !== 'movida' && accion !== 'cancelada') return json({ ok: false, error: 'Acción no reconocida.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const interno = jwt.length > 20 && jwt === SERVICE_ROLE_KEY;
  const { data: usuarioData } = interno ? { data: null } : await admin.auth.getUser(jwt);
  const usuario = usuarioData?.user ?? null;
  if (!interno && !usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, estado, tipo_cita, cliente_nombre, cliente_email, token_arrendatario')
    .eq('id', citaId)
    .maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);

  if (!interno && usuario) {
    const { data: miembro } = await admin
      .from('agenda_miembros')
      .select('usuario_id')
      .eq('empresa_id', cita.empresa_id)
      .eq('usuario_id', usuario.id)
      .eq('activo', true)
      .maybeSingle();
    if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  }

  if (cita.tipo_cita !== 'visita_cliente' || !cita.inmueble_id) {
    return json({ ok: true, notificados: {}, motivo: 'Solo se avisa de visitas de clientes sobre un inmueble.' });
  }
  // La cita tiene que estar en el estado que se dice: así nadie dispara avisos falsos sobre una cita intacta.
  if (accion === 'cancelada' && cita.estado !== 'cancelada') return json({ ok: false, error: 'La cita no está cancelada.' }, 409);
  if (accion === 'movida' && cita.estado === 'cancelada') return json({ ok: false, error: 'La cita está cancelada.' }, 409);

  const { data: inmueble } = await admin
    .from('agenda_inmuebles')
    .select('numero_inmueble, direccion, barrio, ciudad, estado_crm, tipo_inmueble, sin_aviso_arrendatario, token_informe_propietario')
    .eq('id', cita.inmueble_id)
    .maybeSingle();
  if (!inmueble) return json({ ok: false, error: 'Inmueble no encontrado.' }, 404);

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, plantilla_enlace_inmueble, dominio_publico, contacto_empresa, correo_contacto, telefono, nombre_comercial, empresa:agenda_empresas(slug)',
    )
    .eq('empresa_id', cita.empresa_id)
    .maybeSingle();
  const modoPruebas = config?.correo_modo_pruebas !== false;
  const marca = marcaCorreo(config);
  // «Sin aviso al arrendatario»: el inmueble se trata como libre (el propietario maneja la venta en reserva).
  const rentando = String(inmueble.estado_crm || '').trim().toLowerCase() === 'rentando' && inmueble.sin_aviso_arrendatario !== true;
  const sust = sustantivo(inmueble.tipo_inmueble);
  const horaIni = cita.hora_inicio.slice(0, 5);
  const horaFin = (cita.hora_fin || cita.hora_inicio).slice(0, 5);
  const fechaTexto = formatearFecha(cita.fecha);
  const horaTexto = formatearHora(horaIni);
  const lugar = [limpiarDireccion(inmueble.direccion), [inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ')].filter(Boolean).join(', ').replace(/\.+$/, '');
  const lineaVisita = `<b>${esc(fechaTexto)}, ${esc(horaTexto)}</b>`;
  const notificados: Record<string, number> = { cliente: 0, propietario: 0, arrendatario: 0 };

  let asesor: { nombre: string; celular: string } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', cita.asesor_id).maybeSingle();
    asesor = data;
  }

  // ---- Movida: cliente y propietario con los correos de siempre (llevan .ics con SEQUENCE nuevo) ------
  const cabeceras = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY };
  if (accion === 'movida') {
    const resultados = await Promise.allSettled(
      ['enviar-correo-cita', 'enviar-correo-propietario'].map((f) =>
        fetch(`${SUPABASE_URL}/functions/v1/${f}`, {
          method: 'POST',
          headers: cabeceras,
          body: JSON.stringify({ cita_id: cita.id, reagendada: true, sin_aviso_arrendatario: true }),
        }).then((r) => r.ok),
      ),
    );
    notificados.cliente = resultados[0].status === 'fulfilled' && resultados[0].value ? 1 : 0;
    notificados.propietario = resultados[1].status === 'fulfilled' && resultados[1].value ? 1 : 0;
  }

  // ---- Correo propio (cancelación; y aviso al arrendatario en ambas acciones) ------------------------
  if (!config?.correo_smtp_host || !config.correo_remitente_email) {
    return json({ ok: true, notificados, motivo: 'El correo de la empresa no está configurado.' });
  }
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id });
  if (!password) return json({ ok: true, notificados, motivo: 'Falta guardar la contraseña SMTP.' });

  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });

  async function enviar(o: {
    tipo: 'cliente' | 'propietario' | 'arrendatario';
    correos: string[];
    asunto: string;
    titulo: string;
    cuerpo: string;
    boton?: { texto: string; url: string };
    botones?: BotonCorreo[];
    conIcsCancelacion?: boolean;
    asistenteNombre?: string;
  }) {
    for (const correo of o.correos) {
      const destino = modoPruebas ? config!.correo_pruebas_destino || correo : correo;
      let estado: 'enviado' | 'fallido' = 'enviado';
      let detalle: string | null = null;
      try {
        await transporte.sendMail({
          from: `${remitente} <${config!.correo_remitente_email}>`,
          to: destino,
          subject: o.asunto,
          html: plantilla({ titulo: o.titulo, cuerpo: o.cuerpo, boton: o.boton, botones: o.botones, modoPruebas, destinatarioReal: correo, remitente, marca }),
          ...(o.conIcsCancelacion
            ? {
                icalEvent: {
                  method: 'CANCEL',
                  filename: 'cancelacion.ics',
                  content: icsCancelacion({
                    citaId: cita!.id,
                    fecha: cita!.fecha,
                    horaInicio: horaIni,
                    horaFin,
                    resumen: `Visita inmueble Nº ${inmueble!.numero_inmueble} — CANCELADA`,
                    organizadorNombre: remitente,
                    organizadorEmail: config!.correo_remitente_email!,
                    asistenteNombre: o.asistenteNombre || destino,
                    asistenteEmail: destino,
                  }),
                },
              }
            : {}),
        });
        notificados[o.tipo]++;
      } catch (e) {
        estado = 'fallido';
        detalle = e instanceof Error ? e.message : String(e);
      }
      try {
        await admin.from('agenda_correos_log').insert({
          empresa_id: cita!.empresa_id,
          cita_id: cita!.id,
          destinatario_tipo: o.tipo,
          destinatario_email: destino,
          asunto: o.asunto,
          estado,
          detalle_error: detalle,
          modo_pruebas: modoPruebas,
        });
      } catch {
        // Sin registro no hay nada más que hacer.
      }
    }
  }

  const { data: arr } = rentando
    ? await admin.from('agenda_arrendatarios').select('nombre, email').eq('empresa_id', cita.empresa_id).eq('numero_inmueble', inmueble.numero_inmueble).maybeSingle()
    : { data: null };
  let correosArr = correosDe(arr?.email);
  // En modo de pruebas, aunque no haya correo del arrendatario se manda al correo de pruebas para ver cómo le llegaría.
  if (rentando && !correosArr.length && modoPruebas && config.correo_pruebas_destino) correosArr = ['(este inmueble no tiene correo de arrendatario registrado)'];
  const saludoArr = arr?.nombre ? `Hola ${esc(arr.nombre)}, ` : 'Hola, ';

  if (accion === 'movida') {
    // sin_aviso_arrendatario: el cliente eligió dentro de las franjas que el propio arrendatario abrió (ya lo sabe).
    if (rentando && correosArr.length && body.sin_aviso_arrendatario !== true) {
      await enviar({
        tipo: 'arrendatario',
        correos: correosArr,
        asunto: `Cambió la hora de la visita a tu ${sust.n} · ${fechaTexto}`,
        titulo: 'La visita cambió de hora',
        cuerpo: `<p style="margin:0 0 10px;text-align:justify">${saludoArr}la visita a tu ${esc(sust.n)}${lugar ? ` en ${esc(lugar)}` : ''} se movió. La nueva hora es ${lineaVisita}${asesor?.nombre ? `, con ${esc(asesor.nombre)}` : ''}.</p>
<p style="margin:0;text-align:justify">Si esa hora no te sirve, puedes proponer otra con el botón de abajo; la visita solo cambia si la persona interesada la acepta.</p>`,
        boton: { texto: 'Ver la visita o proponer otra hora', url: `${SITIO_URL}/arrendatario/${cita.token_arrendatario}` },
      });
    }
    return json({ ok: true, notificados });
  }

  // ---- Cancelada ------------------------------------------------------------------------------------
  // Evita duplicados si alguien llama dos veces seguidas (doble clic, reintento).
  const { count: yaEnviados } = await admin
    .from('agenda_correos_log')
    .select('id', { count: 'exact', head: true })
    .eq('cita_id', cita.id)
    .like('asunto', 'Visita cancelada%')
    .gte('creado_en', new Date(Date.now() - 5 * 60_000).toISOString());
  if ((yaEnviados || 0) > 0) return json({ ok: true, notificados, motivo: 'Ya se avisó de esta cancelación.' });

  const correosCliente = correosDe(cita.cliente_email).slice(0, 1);
  if (correosCliente.length) {
    const porCliente = origen === 'cliente';
    await enviar({
      tipo: 'cliente',
      correos: correosCliente,
      asunto: `Visita cancelada — ${fechaTexto}`,
      titulo: porCliente ? 'Cancelaste tu visita' : 'Tu visita fue cancelada',
      cuerpo: origen === 'vencimiento'
        ? `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(cita.cliente_nombre)}, cancelamos tu visita del ${lineaVisita} ${esc(sust.el.startsWith('el ') ? 'al ' + sust.el.slice(3) : 'a ' + sust.el)}${lugar ? ` en ${esc(lugar)}` : ''}: quien vive allí no podía recibirte a esa hora y no recibimos una nueva hora a tiempo. Lamentamos el inconveniente.</p>
<p style="margin:0;text-align:justify">Ya se quitó del calendario de tu teléfono. Si sigues interesado, elige una nueva hora cuando quieras${asesor?.nombre ? ` o escríbele a tu asesor, ${esc(asesor.nombre)}` : ''}.</p>`
        : `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(cita.cliente_nombre)}, ${porCliente ? 'cancelamos' : 'te avisamos que se canceló'} tu visita del ${lineaVisita} ${esc(sust.el.startsWith('el ') ? 'al ' + sust.el.slice(3) : 'a ' + sust.el)}${lugar ? ` en ${esc(lugar)}` : ''}${porCliente ? '' : '. Lamentamos el inconveniente'}.</p>
<p style="margin:0;text-align:justify">Ya se quitó del calendario de tu teléfono. ${porCliente ? 'Cuando quieras, puedes elegir otro horario' : 'Puedes elegir otro horario'}${!porCliente && asesor?.nombre ? ` o escribirle a tu asesor, ${esc(asesor.nombre)}` : ''}.</p>`,
      boton: { texto: 'Agendar otro horario', url: `${SITIO_URL}/inmuebles/${inmueble.numero_inmueble}` },
      conIcsCancelacion: true,
      asistenteNombre: cita.cliente_nombre || undefined,
    });
  }

  const { data: propietarios } = await admin
    .from('agenda_propietarios')
    .select('nombre, email')
    .eq('empresa_id', cita.empresa_id)
    .eq('numero_inmueble', inmueble.numero_inmueble);
  const porCorreo = new Map<string, string[]>();
  for (const p of propietarios || []) {
    for (const c of correosDe(String(p.email || '').replace(/;/g, ','))) {
      const nombres = porCorreo.get(c) || [];
      if (p.nombre && !nombres.includes(p.nombre)) nombres.push(p.nombre);
      porCorreo.set(c, nombres);
    }
  }
  const prefsProp = await preferenciasDe(admin, cita.empresa_id, [...porCorreo.keys()]);
  const celularWa = String(asesor?.celular || '').replace(/\D/g, '');
  const motivoPropietario = origen === 'cliente'
    ? 'La persona interesada canceló su visita desde su enlace.'
    : origen === 'vencimiento'
      ? 'Quien vive en el inmueble no podía recibir la visita a esa hora y la persona interesada no eligió una nueva hora a tiempo, así que la visita se canceló.'
      : 'Tu asesor canceló la visita (por ejemplo, por un imprevisto o un cambio de agenda).';
  const accionPropietario = origen === 'cliente'
    ? 'No tienes que hacer nada. La persona puede volver a elegir otro horario cuando quiera; si lo hace, te avisaremos.'
    : origen === 'vencimiento'
      ? 'No tienes que hacer nada. Si la persona sigue interesada, puede elegir otro horario y te avisaremos.'
      : 'No tienes que hacer nada. Tu asesor puede ofrecerle a la persona interesada otro horario; si se agenda, te avisaremos.';
  for (const [correo, nombres] of porCorreo) {
    const prefProp = prefsProp.get(correo.toLowerCase());
    if (prefProp && prefProp.frecuencia !== 'cada_cita') continue; // eligió resumen o ningún correo (sql/032)
    if (prefProp && prefProp.avisar_cancelacion === false) continue; // eligió no recibir el aviso de cancelación (sql/074)
    await enviar({
      tipo: 'propietario',
      correos: [correo],
      asunto: `Visita cancelada en tu inmueble Nº ${inmueble.numero_inmueble}`,
      titulo: 'Se canceló una visita en tu inmueble',
      cuerpo: `<p style="margin:0 0 10px;text-align:justify">Hola ${esc(nombres.join(' y '))}, te avisamos que la visita del ${lineaVisita} a tu inmueble Nº ${esc(String(inmueble.numero_inmueble))}${lugar ? ` (${esc(lugar)})` : ''} fue cancelada.</p>
<p style="margin:0 0 10px;text-align:justify"><b>¿Qué pasó?</b> ${esc(motivoPropietario)}</p>
<p style="margin:0 0 10px;text-align:justify"><b>¿Tienes que hacer algo?</b> ${esc(accionPropietario)}</p>${asesor?.nombre ? `<p style="margin:0 0 10px;text-align:justify"><b>Tu asesor a cargo:</b> ${esc(asesor.nombre)}${asesor.celular ? ` · ${esc(asesor.celular)}` : ''}. Puedes escribirle o llamarle con los botones de abajo.</p>` : ''}${prefProp ? `<p style="margin:12px 0 0;font-size:13px">¿Prefieres otros avisos? <a href="${esc(urlPreferencias(config, prefProp.token))}">Elige qué correos quieres recibir</a>.</p>` : ''}`,
      botones: [
        inmueble.token_informe_propietario ? { texto: 'Ver el informe de mi inmueble', url: `${SITIO_URL}/propietario/${inmueble.token_informe_propietario}`, variante: 'principal' } : { texto: 'Ver el inmueble en nuestro sitio', url: enlaceInmueble(config, inmueble.numero_inmueble), variante: 'principal' },
        celularWa ? { texto: `Escribir a ${asesor?.nombre || 'mi asesor'} por WhatsApp`, url: `https://wa.me/${celularWa}?text=${encodeURIComponent(`Hola${asesor?.nombre ? ' ' + asesor.nombre : ''}, te escribo por la visita cancelada de mi inmueble Nº ${inmueble.numero_inmueble} (${fechaTexto}, ${horaTexto}).`)}`, variante: 'whatsapp' } : null,
        celularWa ? { texto: `Llamar a ${asesor?.nombre || 'mi asesor'}`, url: `tel:${String(asesor?.celular || '').replace(/\s+/g, '')}`, variante: 'llamar' } : null,
      ].filter(Boolean) as BotonCorreo[],
      conIcsCancelacion: true,
      asistenteNombre: nombres[0],
    });
  }

  if (rentando && correosArr.length) {
    await enviar({
      tipo: 'arrendatario',
      correos: correosArr,
      asunto: `Visita cancelada · ${fechaTexto}`,
      titulo: `Se canceló la visita a tu ${sust.n}`,
      cuerpo: `<p style="margin:0 0 10px;text-align:justify">${saludoArr}la visita que estaba programada para ${lineaVisita}${lugar ? ` en ${esc(lugar)}` : ''} fue cancelada.</p>
<p style="margin:0 0 10px;text-align:justify"><b>¿Qué pasó?</b> ${esc(origen === 'cliente' ? 'La persona interesada canceló su visita desde su enlace.' : origen === 'vencimiento' ? 'La persona interesada no eligió una nueva hora a tiempo (cuando se le pidió cambiarla porque no podías recibirla), así que la visita se canceló.' : 'El asesor canceló la visita (por ejemplo, por un imprevisto o un cambio de agenda).')}</p>
<p style="margin:0 0 10px;text-align:justify"><b>¿Tienes que hacer algo?</b> No. Esa hora queda libre para ti y no tienes que preparar nada. Si se agenda otra visita, te avisaremos.</p>${asesor?.nombre ? `<p style="margin:0 0 10px;text-align:justify"><b>Asesor a cargo:</b> ${esc(asesor.nombre)}${asesor.celular ? ` · ${esc(asesor.celular)}` : ''}. Si tienes alguna duda, puedes escribirle o llamarle con los botones de abajo.</p>` : ''}<p style="margin:0;text-align:justify">Gracias por tu colaboración.</p>`,
      botones: [
        celularWa ? { texto: `Escribir a ${asesor?.nombre || 'el asesor'} por WhatsApp`, url: `https://wa.me/${celularWa}?text=${encodeURIComponent(`Hola${asesor?.nombre ? ' ' + asesor.nombre : ''}, te escribo por la visita cancelada del ${fechaTexto} a las ${horaTexto}.`)}`, variante: 'whatsapp' } : null,
        celularWa ? { texto: `Llamar a ${asesor?.nombre || 'el asesor'}`, url: `tel:${String(asesor?.celular || '').replace(/\s+/g, '')}`, variante: 'llamar' } : null,
      ].filter(Boolean) as BotonCorreo[],
    });
  }

  return json({ ok: true, notificados });
});
