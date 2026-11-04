// Edge Function: avisar-captacion
// La llama la página pública /consignar justo después de que el propietario agenda su cita de captación (sql/042).
// Envía dos correos: la confirmación al propietario y el aviso al asesor asignado (con los datos del propietario y el inmueble).
// Pública (--no-verify-jwt): la credencial es el token de la cita (token_cliente). Solo actúa sobre citas de captación creadas
// desde la página pública en las últimas 2 horas y no repite el envío (se revisa agenda_correos_log). Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieContacto, type MarcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase, botonesCorreo, filaCorreo } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const esc = (v: string | number | null | undefined) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const correoValido = (c: string | null | undefined) => (c && /^\S+@\S+\.\S+$/.test(c.trim()) ? c.trim() : '');
const wa = (cel: string | null | undefined) => {
  const d = String(cel || '').replace(/\D/g, '');
  return d.length === 10 && d.startsWith('3') ? '57' + d : d.length >= 11 ? d : '';
};
const fechaLarga = (iso: string) => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const hora = (h: string) => String(h).slice(0, 5);

function fila(k: string, v: string, marca: MarcaCorreo) {
  return v ? `<tr><td style="padding:8px 0;border-bottom:1px solid #efefef;color:#6b6b6b;font-size:13px;width:36%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #efefef;color:${marca.principal};font-size:15px;font-weight:600;overflow-wrap:anywhere">${esc(v)}</td></tr>` : '';
}
// Script (Apps Script) donde el propietario va enviando la información de su inmueble para que el asesor llegue con los datos.
const URL_INFO_INMUEBLE = Deno.env.get('CAPTACION_INFO_INMUEBLE_URL') || 'https://script.google.com/a/macros/patrimonios.co/s/AKfycbxOyeD03mhncxQZM6muJbrS5wYeG4ok_QtrqueWhXrVNaxBCylPXhgT4bbp2Zwwc6SNNg/exec';
function envoltura(marca: MarcaCorreo, titulo: string, cuerpo: string, modoPruebas: boolean, real: string, tema: 'llaves' | 'fachada' = 'llaves', botones?: Parameters<typeof correoBase>[1]['botones']) {
  return correoBase(marca, { titulo, cuerpo, tema, botones, modoPruebas, destinatarioReal: real });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body: { cita_id?: string; token?: string } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const citaId = String(body.cita_id || '');
  const token = String(body.token || '');
  if (!/^[0-9a-f-]{36}$/i.test(citaId) || !/^[0-9a-f-]{36}$/i.test(token)) return json({ ok: false, error: 'Faltan datos.' }, 400);

  const { data: cita } = await admin.from('agenda_citas')
    .select('id, empresa_id, tipo_cita, estado, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_telefono, cliente_email, direccion_libre, ciudad_libre, tipo_inmueble_captacion, valor_estimado_captacion, notas, asesor_id, creado_por, creado_en, token_cliente')
    .eq('id', citaId).maybeSingle();
  if (!cita || cita.token_cliente !== token || cita.tipo_cita !== 'captacion' || cita.creado_por !== null || cita.estado === 'cancelada') return json({ ok: false, error: 'No se encontró la cita.' }, 404);
  if (Date.now() - new Date(cita.creado_en).getTime() > 2 * 3600 * 1000) return json({ ok: true, enviado: false, motivo: 'La cita ya no es reciente.' });

  const { count: yaEnviados } = await admin.from('agenda_correos_log').select('id', { count: 'exact', head: true }).eq('cita_id', cita.id).eq('estado', 'enviado');
  if ((yaEnviados ?? 0) > 0) return json({ ok: true, enviado: false, motivo: 'Ya se enviaron los avisos.' });

  const { data: config } = await admin.from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, dominio_publico, nombre_comercial, contacto_empresa, correo_contacto, telefono, empresa:agenda_empresas(slug)')
    .eq('empresa_id', cita.empresa_id).maybeSingle();
  const { data: password } = config?.correo_smtp_host ? await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: cita.empresa_id }) : { data: null };
  if (!config?.correo_smtp_host || !config.correo_remitente_email || !password) return json({ ok: true, enviado: false, motivo: 'El correo de la empresa no está configurado.' });
  const modoPruebas = config.correo_modo_pruebas !== false;
  const marca = marcaCorreo(config as Cfg);
  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';

  let asesor: { nombre: string; celular: string | null; correo: string | null; correos_adicionales: string | null } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin.from('agenda_asesores').select('nombre, celular, correo, correos_adicionales').eq('id', cita.asesor_id).maybeSingle();
    asesor = data;
  }
  const cuando = `${fechaLarga(cita.fecha)}, de ${hora(cita.hora_inicio)} a ${hora(cita.hora_fin)}`;
  const direccion = [cita.direccion_libre, cita.ciudad_libre].filter(Boolean).join(', ');
  const nombre1 = String(cita.cliente_nombre || '').split(' ')[0];
  const resultados: string[] = [];

  async function enviar(tipo: 'cliente' | 'interno', real: string, asunto: string, html: (pruebas: boolean) => string) {
    const destino = modoPruebas ? config!.correo_pruebas_destino || real : real;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({ from: `${remitente} <${config!.correo_remitente_email}>`, to: destino, subject: asunto, html: html(modoPruebas) });
    } catch (e) { estado = 'fallido'; detalle = e instanceof Error ? e.message : String(e); }
    try { await admin.from('agenda_correos_log').insert({ empresa_id: cita!.empresa_id, cita_id: cita!.id, destinatario_tipo: tipo, destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas }); } catch { /* sin registro */ }
    resultados.push(`${tipo}:${estado}`);
  }

  // 1) Confirmación al propietario.
  const para = correoValido(cita.cliente_email);
  if (para) {
    const waAs = wa(asesor?.celular);
    await enviar('cliente', para, `Recibimos tu solicitud: ${fechaLarga(cita.fecha)} a las ${hora(cita.hora_inicio)}`, (p) => envoltura(marca, '¡Gracias por confiar en nosotros! 🔑', `
<p style="margin:0 0 16px">Hola${nombre1 ? ' ' + esc(nombre1) : ''}, ¡qué alegría que nos confíes tu inmueble! Tu cita quedó agendada y <b>${esc(asesor?.nombre || 'tu asesor')}</b> irá a conocerlo, tomar las fotos y explicarte cómo lo publicamos y administramos.</p>
<table role="presentation" style="width:100%;border-collapse:collapse">${filaCorreo(marca, '📅 Cuándo', cuando)}${filaCorreo(marca, '📍 Dónde', direccion)}${filaCorreo(marca, '🙋 Tu asesor', asesor?.nombre || '')}</table>
<p style="margin:22px 0 8px;font-weight:700;color:${marca.principal}">Así seguimos juntos</p>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
<tr><td style="padding:6px 0;width:34px;font-size:20px;vertical-align:top">1️⃣</td><td style="padding:6px 0"><b>Cuéntanos de tu inmueble</b> con el botón de abajo. Así tu asesor llega con los datos listos y la visita rinde más.</td></tr>
<tr><td style="padding:6px 0;font-size:20px;vertical-align:top">2️⃣</td><td style="padding:6px 0"><b>Visita y fotos:</b> te acompañamos en la fecha acordada.</td></tr>
<tr><td style="padding:6px 0;font-size:20px;vertical-align:top">3️⃣</td><td style="padding:6px 0"><b>Publicamos</b> tu inmueble y te vamos contando cómo avanza.</td></tr>
</table>
${botonesCorreo(marca, [{ texto: '📎 Enviar la información de mi inmueble', url: URL_INFO_INMUEBLE, variante: 'principal' }, waAs ? { texto: 'Escribir a mi asesor', url: `https://wa.me/${waAs}?text=${encodeURIComponent('Hola, agendé una cita para captar mi inmueble y quiero consultar algo.')}`, variante: 'whatsapp' } : null, asesor?.celular ? { texto: 'Llamar al asesor', url: `tel:${asesor.celular.replace(/\D/g, '')}`, variante: 'llamar' } : null].filter(Boolean) as any)}
<p style="margin:20px 0 0;font-size:14px;line-height:1.6">¿Necesitas cambiar la hora o tienes una duda? Escríbele o llámale a tu asesor${asesor?.celular ? ' al <b>' + esc(asesor.celular) + '</b>' : ''}: te responde con gusto. 💙</p>`, p, para, 'llaves'));
  }

  // 2) Aviso al asesor.
  if (asesor) {
    const correos = [...new Set(`${asesor.correo || ''};${asesor.correos_adicionales || ''}`.split(/[;,\s]+/).filter((c) => correoValido(c)))];
    const waProp = wa(cita.cliente_telefono);
    const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
    for (const real of correos) {
      await enviar('interno', real, `Nueva captación · ${cita.ciudad_libre} · ${fechaLarga(cita.fecha)} ${hora(cita.hora_inicio)}`, (p) => envoltura(marca, 'Tienes una nueva captación 🔑', `
<p style="color:#4d4d4d;font-size:15px;line-height:1.65;margin:0 0 14px">Hola ${esc(asesor!.nombre)}, un propietario agendó por la página pública. La cita ya está en tu agenda y el propietario recibió el enlace para enviarte la información del inmueble. <b>Verifica que el inmueble esté en tu zona de cobertura</b>; si no, avisa a la administración para reasignarla.</p>
<table style="width:100%;border-collapse:collapse">${fila('Cuándo', cuando, marca)}${fila('Propietario', cita.cliente_nombre || '', marca)}${fila('Celular', cita.cliente_telefono || '', marca)}${fila('Correo', cita.cliente_email || '', marca)}${fila('Dirección', direccion, marca)}${fila('Tipo de inmueble', cita.tipo_inmueble_captacion || '', marca)}${fila('Valor esperado', cita.valor_estimado_captacion ? '$ ' + Math.round(Number(cita.valor_estimado_captacion)).toLocaleString('es-CO') : '', marca)}</table>
<p style="color:#6b6b6b;font-size:13px;line-height:1.6;margin:14px 0 0;white-space:pre-line">${esc(String(cita.notas || '').replace(/^Solicitud hecha por el propietario desde la página pública\.\n?/, ''))}</p>
${botonesCorreo(marca, [{ texto: 'Ver la dirección en Google Maps', url: mapa, variante: 'mapa' }, waProp ? { texto: 'Escribir al propietario', url: `https://wa.me/${waProp}?text=${encodeURIComponent('Hola ' + nombre1 + ', soy ' + asesor!.nombre + '. Recibí tu solicitud para consignar tu inmueble y quiero confirmar la cita.')}`, variante: 'whatsapp' } : null, cita.cliente_telefono ? { texto: 'Llamar al propietario', url: `tel:${cita.cliente_telefono.replace(/\D/g, '')}`, variante: 'llamar' } : null].filter(Boolean) as any)}`, p, real, 'fachada'));
    }
  }
  return json({ ok: true, enviado: resultados.some((r) => r.endsWith(':enviado')), resultados });
});
