// Edge Function: vista-previa-correos
// Para el equipo de soporte de la plataforma (agenda_soporte_usuarios): devuelve el catálogo de correos que envía el sistema, armados
// con datos de ejemplo y con la marca de la empresa, para revisar su formato sin enviar nada ni tocar datos.
// OJO: los textos de ejemplo se escriben aquí a mano (los correos reales se arman dentro de cada función). Si cambias un correo real,
// actualiza también su muestra. Requiere sesión (JWT) de un usuario de soporte activo.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { botonesCorreo, correoBase, type BotonCorreo } from '../_shared/plantilla-correo.ts';
import { botonConfirmarAsistencia, correoVisita, enlaceVisita } from '../_shared/visita-correo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const SITIO = 'https://citas.patrimonios.co';
const P = 'margin:0 0 10px;text-align:justify';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ ok: false, error: 'Sesión no válida.' }, 401);
  const { data: soporte } = await admin.from('agenda_soporte_usuarios').select('usuario_id').eq('usuario_id', u.user.id).eq('activo', true).maybeSingle();
  if (!soporte) return json({ ok: false, error: 'Solo para el equipo de soporte de la plataforma.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const sel = 'empresa_id, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, correo_remitente_nombre, empresa:agenda_empresas(slug, nombre)';
  const consulta = admin.from('agenda_configuracion').select(sel);
  const { data: configs } = await (body.empresa_id ? consulta.eq('empresa_id', String(body.empresa_id)) : consulta).limit(20);
  const lista = (configs || []).map((c: Record<string, unknown>) => ({ id: c.empresa_id, nombre: String((c.empresa as Record<string, unknown> | null)?.nombre || c.nombre_comercial || 'Empresa') }));
  const config = (configs || [])[0];
  const marca = marcaCorreo(config);
  const T = 'sim+prueba@example.com';
  const dir = 'Calle 12 # 5-30, CENTRO, Chía';
  const wa = (t: string) => ({ texto: t, url: 'https://wa.me/573001112233', variante: 'whatsapp' as const });
  const llamar = (t: string) => ({ texto: t, url: 'tel:+573001112233', variante: 'llamar' as const });
  const base = { modoPruebas: false, destinatarioReal: T };

  const datos = (filas: [string, string][]) => `<table role="presentation" width="100%" style="border-collapse:collapse">${filas.map(([a, b]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ebee;color:#63707a;font-size:13px;width:36%">${a}</td><td style="padding:10px 0;border-bottom:1px solid #e7ebee;font-weight:600;color:${marca.principal}">${b}</td></tr>`).join('')}</table>`;
  const tarjeta = (dia: string, num: number, mes: string, hora: string, extra: string) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:2px solid ${marca.principal};border-radius:14px;margin:0 0 18px;overflow:hidden"><tr><td style="background:${marca.principal};color:#ffffff;padding:12px 16px"><div style="font-size:24px;font-weight:700;text-transform:capitalize">${dia} ${num}</div><div style="font-size:15px">de ${mes}</div></td></tr><tr><td style="padding:14px 16px"><div style="font-size:30px;font-weight:700;color:${marca.principal}">${hora}</div>${extra}</td></tr></table>`;
  const motivoOpciones = ['Ya encontré otro inmueble', 'Cambié de planes', 'El precio no me convenció', 'No pude en ese horario', 'Otra razón (escribirla)'].map((t) => enlaceVisita(`${SITIO}/visita/ejemplo?motivo=x`, t, marca)).join('');
  const asesorBotones: BotonCorreo[] = [wa('Escribir a Andrés por WhatsApp'), llamar('Llamar a Andrés')];

  const correos = [
    { grupo: 'Cliente', nombre: 'Confirmación de la visita', cuando: 'Al instante de agendar una visita desde la página pública.', para: 'Cliente', asunto: 'Tu visita está confirmada',
      html: correoVisita(marca, { ...base, etiqueta: 'Confirmación de visita · Inmueble 1234', motivo: 'Te escribimos porque acabas de agendar una visita. Este correo sale automáticamente al agendar.', puntualidad: true,
        titulo: 'Tu visita está confirmada', cuerpo: `<p style="margin:0 0 12px">Hola María. Estos son los datos de tu visita.</p>${datos([['Inmueble', '1234'], ['Fecha', 'martes, 17 de noviembre de 2026'], ['Hora', '3:00 p. m.'], ['Dirección', dir], ['Tu asesor', 'Andrés Gil · 300 111 2233']])}`,
        boton: { texto: 'Confirmo que asistiré', url: `${SITIO}/visita/ejemplo` },
        despues: botonesCorreo(marca, [{ texto: 'Cómo llegar (Google Maps)', url: 'https://maps.google.com', variante: 'mapa' }, { texto: 'Cómo llegar (Waze)', url: 'https://waze.com', variante: 'waze' }, ...asesorBotones]) }) },
    { grupo: 'Cliente', nombre: 'Recordatorio de la visita', cuando: 'Antes de la visita, si el cliente aún no la ha confirmado.', para: 'Cliente', asunto: 'Recordatorio: confirma tu visita',
      html: correoVisita(marca, { ...base, etiqueta: 'Recordatorio de visita · Inmueble 1234', motivo: 'Te enviamos este recordatorio porque tienes una visita próxima que aún no has confirmado.', titulo: 'Confirma tu visita',
        cuerpo: `<p style="margin:0 0 12px">Hola María. Tu visita es <b>mañana, 3:00 p. m.</b> Toca el botón para avisarnos que irás.</p>`, despues: botonConfirmarAsistencia(`${SITIO}/visita/ejemplo?accion=confirmar`, marca, 'Confirmo que asistiré') }) },
    { grupo: 'Cliente', nombre: 'Cancelación (cancela el cliente)', cuando: 'Cuando el cliente cancela desde su enlace.', para: 'Cliente', asunto: 'Visita cancelada',
      html: correoBase(marca, { ...base, tema: 'cambio', etiqueta: 'Cancelación de visita · Aviso a quien iba a visitar · Inmueble 1234', motivo: 'Te escribimos ahora porque se canceló una visita que habías agendado. Este aviso sale automáticamente en el momento del cambio.', titulo: 'Cancelaste tu visita',
        cuerpo: `<p style="${P}">Hola María, cancelamos tu visita del martes 17 de noviembre, 3:00 p. m. al inmueble en ${dir}.</p><p style="${P}">Ya se quitó del calendario de tu teléfono. Cuando quieras, puedes elegir otro horario.</p><div style="margin:18px 0 0;padding:14px 16px;border-radius:12px;background:#f4f6f8"><p style="margin:0 0 4px;font-weight:700">¿Nos cuentas por qué cancelaste?</p>${motivoOpciones}</div>`,
        botones: [{ texto: 'Agendar otro horario', url: SITIO, variante: 'principal' }] }) },
    { grupo: 'Cliente', nombre: 'Cambio de hora de la visita', cuando: 'Cuando el asesor mueve la visita o el arrendatario propone otra hora.', para: 'Cliente', asunto: 'Tu visita cambió de hora',
      html: correoBase(marca, { ...base, tema: 'cambio', etiqueta: 'Cambio de hora de visita · Aviso a quien iba a visitar · Inmueble 1234', motivo: 'Te escribimos ahora porque se cambió la hora de una visita que habías agendado. Este aviso sale automáticamente en el momento del cambio.', titulo: 'Tu visita cambió de hora',
        cuerpo: `<p style="${P}">Hola María, tu visita se movió: <s>martes 17, 3:00 p. m.</s> → <b>miércoles 18 de noviembre, 10:00 a. m.</b></p>`, botones: [{ texto: 'Ver, cambiar o cancelar mi visita', url: SITIO, variante: 'principal' }, ...asesorBotones] }) },
    { grupo: 'Arrendatario', nombre: 'Aviso de visitas programadas', cuando: 'Al agendarse una visita a un inmueble arrendado (un solo correo con todas las visitas próximas).', para: 'Arrendatario', asunto: 'Visitas programadas en tu vivienda',
      html: correoVisita(marca, { ...base, tema: 'arrendatario', etiqueta: 'Aviso de visita · Inmueble 1234', motivo: 'Te escribimos porque se agendó una visita a tu inmueble. Este aviso sale automáticamente cuando se agenda.', titulo: 'Tienes 2 visitas programadas',
        cuerpo: `<p style="margin:0 0 12px">Hola Óscar. Para cada visita, toca <b>«Confirmo que estaré»</b>.</p><p style="margin:0 0 12px"><b>Inmueble 1234</b><br>${dir}</p>`, boton: { texto: 'Organizar mis visitas y horarios', url: SITIO },
        despues: tarjeta('martes', 17, 'noviembre de 2026', '3:00 p. m.', botonConfirmarAsistencia(SITIO, marca)) + tarjeta('viernes', 20, 'noviembre de 2026', '3:00 p. m.', botonConfirmarAsistencia(SITIO, marca)) + botonesCorreo(marca, asesorBotones) }) },
    { grupo: 'Arrendatario', nombre: 'Cancelación de la visita', cuando: 'Cuando se cancela una visita a su inmueble.', para: 'Arrendatario', asunto: 'Se canceló la visita a tu vivienda',
      html: correoBase(marca, { ...base, tema: 'cambio', etiqueta: 'Cancelación de visita · Aviso a quien vive en el inmueble · Inmueble 1234', motivo: 'Te escribimos ahora porque se canceló una visita a este inmueble. Este aviso sale automáticamente en el momento del cambio.', titulo: 'Se canceló la visita a tu vivienda',
        cuerpo: `<p style="${P}">Hola Óscar, la visita del martes 17 de noviembre, 3:00 p. m. fue cancelada.</p><p style="${P}"><b>¿Qué pasó?</b> La persona interesada canceló su visita desde su enlace.</p><p style="${P}"><b>¿Tienes que hacer algo?</b> No. Gracias por tu colaboración.</p>`, botones: asesorBotones }) },
    { grupo: 'Arrendatario', nombre: 'Inspección programada', cuando: 'Cuando se programa una inspección (botón «Avisar al arrendatario» de la cita).', para: 'Arrendatario', asunto: 'Inspección programada',
      html: correoVisita(marca, { ...base, tema: 'arrendatario', titulo: 'Tienes una inspección programada', cuerpo: `<p style="margin:0 0 12px">Hola Óscar. Vamos a hacer una inspección en tu inmueble.</p><p style="margin:0 0 12px"><b>jueves, 19 de noviembre, 9:00 a. m.</b><br>${dir}<br>Irá: <b>Laura Rojas</b></p><div style="padding:12px 14px;border-left:4px solid ${marca.accion};background:#f4f6f8;border-radius:4px"><b>Para tu seguridad: códigos de la visita</b><br>El día de la inspección verás un código de llegada y otro de salida.</div>`, despues: botonesCorreo(marca, [{ texto: 'Ver mis códigos de seguridad', url: SITIO, variante: 'principal' }, ...asesorBotones]) }) },
    { grupo: 'Propietario', nombre: 'Visita nueva en su inmueble', cuando: 'Cuando se agenda una visita (si el propietario eligió «un correo con cada visita»).', para: 'Propietario', asunto: 'Nueva visita a tu inmueble',
      html: correoBase(marca, { ...base, tema: 'visita', titulo: 'Agendamos una visita a tu inmueble', cuerpo: `<p style="${P}">Hola Mario, el martes 17 de noviembre a las 3:00 p. m. un cliente visitará tu inmueble Nº 1234 (${dir}).</p>`, botones: [{ texto: 'Ver el informe de mi inmueble', url: SITIO, variante: 'principal' }, ...asesorBotones] }) },
    { grupo: 'Propietario', nombre: 'Cancelación de una visita', cuando: 'Cuando se cancela una visita a su inmueble.', para: 'Propietario', asunto: 'Visita cancelada en tu inmueble',
      html: correoBase(marca, { ...base, tema: 'cambio', etiqueta: 'Cancelación de visita · Aviso al propietario · Inmueble Nº 1234', motivo: 'Te escribimos ahora porque se canceló una visita a este inmueble. Este aviso sale automáticamente en el momento del cambio.', titulo: 'Se canceló una visita en tu inmueble',
        cuerpo: `<p style="${P}">Hola Mario, te avisamos que la visita del martes 17 de noviembre, 3:00 p. m. a tu inmueble Nº 1234 (${dir}) fue cancelada.</p><p style="${P}"><b>¿Qué pasó?</b> La persona interesada canceló su visita desde su enlace.</p><p style="${P}"><b>Estado del inmueble:</b> arrendado y ocupado; las visitas se coordinan con quien vive allí.</p><p style="${P}"><b>¿Tienes que hacer algo?</b> No tienes que hacer nada.</p><p style="${P}"><b>Tu asesor a cargo:</b> Andrés Gil · 300 111 2233.</p>`,
        botones: [{ texto: 'Ver el informe de mi inmueble', url: SITIO, variante: 'principal' }, ...asesorBotones] }) },
    { grupo: 'Propietario', nombre: 'Respuesta del asesor a su solicitud', cuando: 'Cuando un asesor le responde desde el sistema (botón «Responder al propietario»).', para: 'Propietario', asunto: 'Respuesta a tu solicitud',
      html: correoBase(marca, { ...base, tema: 'sala', etiqueta: 'Respuesta a tu solicitud de asesoría · Inmueble Nº 1234', motivo: 'Te escribimos porque hiciste una solicitud desde el informe de tu inmueble. Para responder, solo responde a este correo.', titulo: 'Andrés Gil te respondió',
        cuerpo: `<p style="margin:0 0 12px">Hola Mario,</p><p style="margin:0 0 12px">Con gusto te ayudo. ¿Te parece si hablamos mañana en la mañana?</p><p style="margin:16px 0 0;font-weight:700">Andrés Gil</p>` }) },
    { grupo: 'Asesor', nombre: 'Aviso de solicitud del propietario', cuando: 'Cuando el propietario pide asesoría o cambio de precio desde su informe.', para: 'Asesor', asunto: 'Pidió una asesoría — inmueble Nº 1234',
      html: correoBase(marca, { ...base, tema: 'sala', titulo: 'Pidió una asesoría', cuerpo: `<p>El propietario del inmueble Nº 1234 escribió desde el informe en vivo:</p>${datos([['Inmueble', 'Nº 1234'], ['Mensaje del propietario', 'Quiero revisar el canon.'], ['Quién escribió', 'Mario Vélez · mario@example.com']])}`, botones: [{ texto: '✉️ Responder al propietario', url: `${SITIO}/responder/ejemplo`, variante: 'principal' }] }) },
  ];
  return json({ ok: true, empresas: lista, empresa_usada: config?.empresa_id || null, correos });
});
