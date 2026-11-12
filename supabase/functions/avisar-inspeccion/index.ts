// Edge Function: avisar-inspeccion
// Avisa al arrendatario de una INSPECCIÓN programada (tipo_cita = 'inspeccion'): fecha, hora, quién va, para qué, y el enlace donde verá
// el día de la visita el código de llegada y el de salida. Requiere sesión de un miembro activo de la empresa de la cita.
// El destinatario sale siempre de agenda_arrendatarios (nunca del cuerpo de la solicitud). Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { botonesCorreo, type BotonCorreo } from '../_shared/plantilla-correo.ts';
import { correoVisita } from '../_shared/visita-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITIO_URL = 'https://citas.patrimonios.co';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fechaTexto = (f: string) => { const [a, m, d] = f.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
const horaTexto = (h: string) => { const [H, M] = h.split(':').map(Number); return `${H % 12 === 0 ? 12 : H % 12}:${String(M).padStart(2, '0')} ${H >= 12 ? 'p. m.' : 'a. m.'}`; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400); }
  const citaId = String(body.cita_id || '');
  if (!citaId) return json({ ok: false, error: 'Falta cita_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const interno = jwt.length > 20 && jwt === SERVICE_ROLE_KEY;
  const { data: usuarioData } = interno ? { data: null } : await admin.auth.getUser(jwt);
  const usuario = usuarioData?.user ?? null;
  if (!interno && !usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin.from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, titulo, tipo_cita, estado, token_arrendatario, codigo_asesor')
    .eq('id', citaId).maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);
  if (!interno && usuario) {
    const { data: miembro } = await admin.from('agenda_miembros').select('usuario_id').eq('empresa_id', cita.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
    if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  }
  if (cita.tipo_cita !== 'inspeccion' || !cita.inmueble_id || cita.estado === 'cancelada') {
    return json({ ok: true, enviado: false, motivo: 'Solo se avisa de inspecciones activas sobre un inmueble.' });
  }

  const { data: inmueble } = await admin.from('agenda_inmuebles').select('numero_inmueble, direccion, barrio, ciudad').eq('id', cita.inmueble_id).maybeSingle();
  if (!inmueble) return json({ ok: false, error: 'Inmueble no encontrado.' }, 404);
  const { data: config } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', cita.empresa_id).maybeSingle();
  const modoPruebas = config?.correo_modo_pruebas !== false;
  const marca = marcaCorreo(config);

  const { data: arr } = await admin.from('agenda_arrendatarios').select('nombre, email').eq('empresa_id', cita.empresa_id).eq('numero_inmueble', inmueble.numero_inmueble).maybeSingle();
  let correos = String(arr?.email || '').split(/[;,\s]+/).map((c) => c.trim()).filter((c) => /\S+@\S+\.\S+/.test(c));
  if (!correos.length && modoPruebas && config?.correo_pruebas_destino) correos = ['(este inmueble no tiene correo de arrendatario registrado)'];
  if (!correos.length) return json({ ok: true, enviado: false, motivo: `No hay correo registrado del arrendatario del inmueble Nº ${inmueble.numero_inmueble}. Avísale directamente.` });
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return json({ ok: true, enviado: false, motivo: 'El correo de la empresa no está configurado.' });
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id });
  if (!password) return json({ ok: true, enviado: false, motivo: 'Falta guardar la contraseña SMTP.' });

  let quien = '';
  let celular = '';
  if (cita.asesor_id) {
    const { data: a } = await admin.from('agenda_asesores').select('nombre, celular').eq('id', cita.asesor_id).maybeSingle();
    quien = a?.nombre || '';
    celular = String(a?.celular || '').replace(/\D/g, '');
  }
  const celWa = celular.length === 10 && celular.startsWith('3') ? '57' + celular : celular;
  const lugar = [inmueble.direccion, inmueble.barrio, inmueble.ciudad].filter(Boolean).join(', ');
  const enlaceEncuesta = `${SITIO_URL}/inspeccion/${cita.token_arrendatario}?encuesta=1`;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const botonesAsesor: BotonCorreo[] = celWa.length >= 11 && quien ? [{ texto: `Escribir a ${quien} por WhatsApp`, url: `https://wa.me/${celWa}`, variante: 'whatsapp' as const }, { texto: `Llamar a ${quien}`, url: `tel:+${celWa}`, variante: 'llamar' as const }] : [];
  const nombreSaludo = arr?.nombre ? ' ' + esc(arr.nombre) : '';
  const cajaCodigo = (codigo: string) => `<div style="margin:10px 0 14px;padding:16px;border-radius:14px;background:#f4f6f8;text-align:center;font-size:44px;font-weight:700;letter-spacing:14px;padding-left:28px;color:${marca.principal}">${esc(codigo)}</div>`;
  // Tema de la inspección: la encuesta final cambia un poco según el motivo escrito al programarla.
  const tema = /fotograf|foto/i.test(cita.titulo || '') ? 'fotografía' : /mantenim|repar|arreglo/i.test(cita.titulo || '') ? 'mantenimiento' : /inventar|entrega/i.test(cita.titulo || '') ? 'inventario' : 'inspección';

  let asunto = `Inspección programada · Inmueble ${inmueble.numero_inmueble} · ${fechaTexto(cita.fecha)}`;
  let titulo = 'Tienes una inspección programada';
  let preheader = `Inmueble ${inmueble.numero_inmueble}: ${fechaTexto(cita.fecha)}, ${horaTexto(cita.hora_inicio.slice(0, 5))}. El día de la visita te llegarán tus códigos por correo.`;
  let etiqueta = `Inspección programada · Inmueble ${inmueble.numero_inmueble}`;
  let motivo = 'Te escribimos porque se programó una inspección en tu inmueble. Este aviso sale automáticamente al programarla.';
  let cuerpo = `<p style="margin:0 0 12px">Hola${nombreSaludo}, vamos a hacer una inspección en tu inmueble${cita.titulo ? ` para: <b>${esc(cita.titulo)}</b>` : ''}. Aquí están los datos.</p>
      <p style="margin:0 0 12px"><b>${esc(fechaTexto(cita.fecha))}, ${esc(horaTexto(cita.hora_inicio.slice(0, 5)))}</b><br>${esc(lugar)}${quien ? `<br>Asesor que asistirá: <b>${esc(quien)}</b>` : ''}</p>
      <div style="margin:0 0 12px;padding:14px 16px;border-left:4px solid ${marca.accion};background:#f4f6f8;border-radius:4px"><p style="margin:0 0 6px;font-weight:700">Para tu tranquilidad: cómo reconocer a quien llega</p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.55">Quien llegue se identificará contigo diciéndote este código, que solo tú y nosotros conocemos:</p>
        ${cita.codigo_asesor ? `<div style="margin:0 0 8px;padding:12px;border-radius:12px;background:#ffffff;text-align:center;font-size:36px;font-weight:700;letter-spacing:12px;padding-left:24px;color:${marca.principal}">${esc(cita.codigo_asesor)}</div>` : ''}
        <p style="margin:0;font-size:14px;line-height:1.55">Si el código coincide, sabes que es quien debe ser. Si no lo dice o no coincide, escríbenos o llámanos antes de abrir.</p></div>
      <div style="margin:0 0 12px;padding:14px 16px;background:#f4f6f8;border-radius:4px"><p style="margin:0 0 6px;font-weight:700">Qué más te va a llegar ese día</p>
        <p style="margin:0;font-size:14px;line-height:1.55">No tienes que abrir ningún enlace ni entrar a ningún sistema: todo te llega a este correo. <b>Poco antes de la hora</b> te enviaremos un código de llegada que le dices al asesor cuando esté contigo. <b>Cuando termine la inspección</b>, te llegará un código de salida para que se lo digas al asesor al despedirse, y enseguida te haremos <b>unas preguntas rápidas</b> sobre cómo te fue.</p></div>`;
  let botones: BotonCorreo[] = botonesAsesor;
  let tipoEnvio: 'programada' | 'llegada' | 'salida' | 'encuesta' = 'programada';
  const momento = String(body.momento || 'programada');
  if (momento === 'llegada' || momento === 'salida' || momento === 'encuesta') {
    tipoEnvio = momento;
    const { data: det } = await admin.from('agenda_citas').select('codigo_entrada, codigo_salida, entrada_verificada_en, salida_verificada_en').eq('id', cita.id).maybeSingle();
    const hora = horaTexto(cita.hora_inicio.slice(0, 5));
    if (momento === 'llegada') {
      if (!det?.codigo_entrada || det.entrada_verificada_en) return json({ ok: true, enviado: false, motivo: 'La llegada ya está registrada o no hay código.' });
      asunto = `Inspección de hoy a las ${hora} · Inmueble ${inmueble.numero_inmueble}`;
      titulo = 'Tu número de llegada';
      preheader = 'Díselo al asesor cuando esté contigo en el inmueble.';
      etiqueta = `Inspección de hoy · Inmueble ${inmueble.numero_inmueble} · Código de llegada`;
      motivo = 'Te escribimos porque tu inspección empieza en unos minutos. Este aviso sale automáticamente.';
      cuerpo = `<p style="margin:0 0 8px">Hola${nombreSaludo}. A las <b>${esc(hora)}</b> llega ${quien ? `<b>${esc(quien)}</b>` : 'el asesor'} a tu inmueble. Primero te dirá su código de identificación (el que te enviamos al programar la inspección).</p>
        <p style="margin:0 0 4px">Cuando lo estés viendo en persona y el código coincida, <b>dile este número de llegada</b>:</p>${cajaCodigo(det.codigo_entrada)}
        <p style="margin:0;font-size:13px">Con eso queda registrado que el asesor llegó. Al terminar te enviaremos el número de salida.</p>`;
    } else if (momento === 'salida') {
      if (!det?.entrada_verificada_en || !det.codigo_salida || det.salida_verificada_en) return json({ ok: true, enviado: false, motivo: 'Aún no hay llegada registrada o la salida ya se registró.' });
      asunto = `Inspección de hoy · Inmueble ${inmueble.numero_inmueble}`;
      titulo = 'Tu número de salida';
      preheader = 'Díselo al asesor cuando termine la inspección.';
      etiqueta = `Inspección de hoy · Inmueble ${inmueble.numero_inmueble} · Código de salida`;
      motivo = 'Te escribimos porque el asesor ya registró su llegada. Este aviso sale automáticamente.';
      cuerpo = `<p style="margin:0 0 8px">Hola${nombreSaludo}. Ya registramos la llegada del asesor. Cuando termine la inspección y esté por irse, <b>dile este número de salida</b>:</p>${cajaCodigo(det.codigo_salida)}
        <p style="margin:0;font-size:13px">Con eso queda constancia de que todo salió bien. Después te haremos unas preguntas rápidas, de menos de un minuto.</p>`;
    } else {
      if (!det?.salida_verificada_en) return json({ ok: true, enviado: false, motivo: 'La salida aún no está registrada.' });
      asunto = `Gracias por recibirnos en tu inmueble Nº ${inmueble.numero_inmueble}. ¿Cómo estuvo?`;
      titulo = 'Cuéntanos cómo te fue';
      preheader = 'Solo 1 minuto. Tus respuestas llegan a la coordinación y no se comparten con terceros.';
      etiqueta = `${tema === 'inspección' ? 'Inspección' : tema[0].toUpperCase() + tema.slice(1)} terminada · Inmueble ${inmueble.numero_inmueble}`;
      motivo = 'Te escribimos porque terminó la visita a tu inmueble. Este aviso sale automáticamente.';
      cuerpo = `<p style="margin:0 0 10px">Hola${nombreSaludo}. Gracias por abrirnos la puerta. Cuéntanos en menos de un minuto cómo te fue. <b>Tus respuestas llegan a la coordinación y no se comparten con el propietario ni con terceros.</b></p>
        <p style="margin:0;font-size:13px">Si el asesor no te dio tu código de salida o algo salió mal, escríbenos o llámanos con los botones de abajo.</p>`;
      botones = [{ texto: 'Responder (1 minuto)', url: enlaceEncuesta, variante: 'principal' }, ...botonesAsesor];
    }
  }

  const html = (real: string) => correoVisita(marca, {
    tema: 'arrendatario',
    titulo,
    preheader,
    modoPruebas, destinatarioReal: real,
    etiqueta,
    motivo,
    cuerpo,
    despues: botonesCorreo(marca, botones),
  });

  const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string } });
  let enviados = 0;
  for (const correo of correos) {
    const destino = modoPruebas ? config.correo_pruebas_destino || correo : correo;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({ from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html: html(correo) });
      enviados++;
    } catch (e) { estado = 'fallido'; detalle = e instanceof Error ? e.message : String(e); }
    try {
      await admin.from('agenda_correos_log').insert({ empresa_id: cita.empresa_id, cita_id: cita.id, destinatario_tipo: 'arrendatario', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
    } catch { /* sin registro no hay nada más que hacer */ }
  }
  if (!enviados) return json({ ok: true, enviado: false, motivo: 'Falló el envío del correo. Revisa la bitácora de correos.' });
  if (tipoEnvio === 'programada') await admin.from('agenda_citas').update({ arrendatario_avisado_en: new Date().toISOString(), arrendatario_avisado_por: usuario?.id ?? null }).eq('id', cita.id);
  return json({ ok: true, enviado: true, enviados });
});
