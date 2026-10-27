// Edge Function: enviar-radicacion-cliente
// Le manda al cliente que quiere avanzar con un inmueble el correo para radicar su estudio de arrendatario en la aseguradora:
// enlaces (persona natural / jurídica), datos listos para copiar (póliza o código de la inmobiliaria, asesor, inmueble, canon,
// administración), pasos y costos del estudio. Todo sale de Configuración → Radicación, por ciudad (sql/033).
// Quién la llama (desplegar con --no-verify-jwt; la autorización se valida aquí):
//   - avisar-encuesta-respondida, con la service role, cuando el cliente elige «quiero avanzar» (solo si la empresa activó radicacion_activa).
//   - un miembro de la empresa con sesión (botón «Enviar información para radicar» de la cita): { cita_id, forzar:true } reenvía aunque ya se haya enviado.
// Cada cita recibe el correo automático una sola vez (agenda_citas.radicacion_enviada_en). Respeta correo_modo_pruebas.
// Si avisar_asesor no es false, también le avisa al asesor de la cita para que esté pendiente.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieContacto, type MarcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const esc = (v: string | number | null | undefined) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cop = (n: number | null | undefined) => (n == null ? '' : '$ ' + Math.round(Number(n)).toLocaleString('es-CO'));
const urlSegura = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');
const correoValido = (c: string | null | undefined) => (c && /^\S+@\S+\.\S+$/.test(c.trim()) ? c.trim() : '');

async function log(admin: Admin, fila: Record<string, unknown>) {
  try { await admin.from('agenda_correos_log').insert(fila); } catch { /* sin registro no hay nada más que hacer */ }
}

// Pasos configurables: una línea de texto = un paso.
export function pasosDe(instrucciones: string): string[] {
  return String(instrucciones || '').split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 12);
}

function filaDato(k: string, v: string, marca: MarcaCorreo) {
  return v ? `<tr><td style="padding:9px 0;border-bottom:1px solid #efefef;color:#6b6b6b;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid #efefef;color:${marca.principal};font-size:15px;font-weight:600;overflow-wrap:anywhere">${v}</td></tr>` : '';
}
function boton(url: string, texto: string, marca: MarcaCorreo, principal: boolean) {
  return `<p style="margin:10px 0;text-align:center"><a href="${esc(url)}" target="_blank" style="display:inline-block;${principal ? `background:${marca.principal};color:#ffffff` : `color:${marca.principal};border:2px solid ${marca.principal}`};text-decoration:none;font-weight:600;font-size:15px;padding:${principal ? '15px 26px' : '12px 22px'};border-radius:999px">${esc(texto)}</a></p>`;
}

// deno-lint-ignore no-explicit-any
type Aseguradora = Record<string, any>;

// Un bloque por aseguradora: enlaces, datos para copiar, pasos y costos. Con varias aseguradoras cada bloque lleva su título.
// deno-lint-ignore no-explicit-any
function bloqueAseguradora(marca: MarcaCorreo, d: Record<string, any>, a: Aseguradora, varias: boolean, paginaUrl: string, principal: boolean) {
  const pasos = pasosDe(a.instrucciones);
  const costoTxt = a.costo_porcentaje != null ? `${Number(a.costo_porcentaje)}%${a.costo_iva ? ' + IVA' : ''}` : a.costo_valor != null ? `${cop(a.costo_valor)}${a.costo_iva ? ' + IVA' : ''}` : '';
  const ejemplo = a.costo_porcentaje != null && a.costo_valor != null ? `Con el canon de este inmueble (${cop(d.canon)}) serían aproximadamente ${cop(a.costo_valor)}${a.costo_iva ? ' + IVA' : ''}.` : '';
  const natural = urlSegura(a.link_natural);
  const juridica = urlSegura(a.link_juridica);
  const mismoEnlace = natural && natural === juridica;
  const datos = [
    filaDato('Aseguradora', esc(a.aseguradora), marca),
    filaDato('Código de la inmobiliaria', esc(a.codigo_inmobiliaria), marca),
    filaDato('Póliza', esc(a.poliza), marca),
    filaDato('Inmobiliaria', esc(a.nombre_inmobiliaria), marca),
    filaDato('Asesor', esc(a.asesor_nombre), marca),
    filaDato('Correo del asesor', esc(a.asesor_correo), marca),
    filaDato('Dirección del inmueble', esc([d.direccion, d.barrio].filter(Boolean).join(', ')), marca),
    filaDato('Valor del canon', esc(cop(d.canon)), marca),
    filaDato('Administración', d.administracion ? esc(cop(d.administracion)) : d.administracion_incluida ? 'Incluida en el canon' : '', marca),
  ].join('');
  return `${varias ? `<h2 style="color:${marca.principal};font-size:20px;margin:28px 0 4px;border-top:2px solid #efefef;padding-top:18px">Con ${esc(a.aseguradora)}</h2>` : ''}
${boton(natural || paginaUrl, natural ? (mismoEnlace ? 'Iniciar mi estudio' : 'Iniciar mi estudio · persona natural') : 'Ver cómo iniciar mi estudio', marca, principal)}
${juridica && !mismoEnlace ? boton(juridica, 'Soy persona jurídica (empresa)', marca, false) : ''}
${mismoEnlace ? `<p style="margin:0;text-align:center;color:#6b6b6b;font-size:12.5px">El mismo enlace sirve para persona natural y jurídica.</p>` : ''}
<h2 style="color:${marca.principal};font-size:18px;margin:22px 0 6px">Datos para copiar en el formulario</h2>
<p style="color:#6b6b6b;font-size:13px;margin:0 0 6px">La aseguradora te los va a pedir. Cópialos tal cual:</p>
<table style="width:100%;border-collapse:collapse">${datos}</table>
${pasos.length ? `<h2 style="color:${marca.principal};font-size:18px;margin:24px 0 8px">Así funciona</h2><table style="width:100%;border-collapse:collapse">${pasos.map((p, i) => `<tr><td style="vertical-align:top;padding:5px 12px 5px 0;width:30px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:${marca.principal};color:#fff;font-weight:600;font-size:13px">${i + 1}</span></td><td style="padding:5px 0;color:#4d4d4d;font-size:14px;line-height:1.55">${esc(p)}</td></tr>`).join('')}</table>` : ''}
${costoTxt ? `<div style="background:#f4f4f4;border-radius:16px;padding:16px 18px;margin:22px 0 0"><div style="font-weight:600;color:${marca.principal};font-size:15px;margin-bottom:4px">💰 Costo del estudio y del contrato: ${esc(costoTxt)}</div><div style="color:#4d4d4d;font-size:13.5px;line-height:1.6">${ejemplo ? esc(ejemplo) + ' ' : ''}${esc(a.costo_nota || '')}</div></div>` : ''}`;
}

// deno-lint-ignore no-explicit-any
function construirHtml(marca: MarcaCorreo, d: Record<string, any>, extra: { modoPruebas: boolean; real: string; paginaUrl: string; asesorWa: string; asesorNombreCita: string }) {
  const nombre = String(d.cliente_nombre || '').split(' ')[0];
  const lista: Aseguradora[] = d.aseguradoras || [];
  const varias = lista.length > 1;
  const nombres = lista.map((a) => a.aseguradora).join(' o ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${extra.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(extra.real)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(marca, 'Tu siguiente paso', 'ninguna')}
<div style="padding:28px 26px 8px">
<h1 style="color:${marca.principal};font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-.01em;margin:0 0 10px">¡Vamos por tu nuevo hogar! 🏡</h1>
<p style="color:#4d4d4d;font-size:15px;line-height:1.65;margin:0 0 14px;text-align:justify">Hola${nombre ? ' ' + esc(nombre) : ''}, nos alegra que quieras avanzar con el inmueble Nº ${esc(d.numero_inmueble)} (${esc(d.direccion || '')}). El siguiente paso es un <strong>estudio en línea con ${esc(nombres)}</strong>: es 100% digital y la respuesta llega el mismo día cuando la información está completa.${varias ? ' Elige la opción que prefieras.' : ''}</p>
${lista.map((a, i) => bloqueAseguradora(marca, d, a, varias, extra.paginaUrl, i === 0)).join('')}
${boton(extra.paginaUrl, 'Ver esta información en una página', marca, false)}
${extra.asesorWa ? `<p style="margin:6px 0 0;text-align:center"><a href="https://wa.me/${extra.asesorWa}?text=${encodeURIComponent('Hola, quiero avanzar con el inmueble Nº ' + d.numero_inmueble + ' y tengo una duda sobre el estudio.')}" target="_blank" style="color:${marca.principal};font-weight:600;font-size:14px;text-decoration:none">💬 ¿Dudas? Escríbele a ${esc(extra.asesorNombreCita || 'tu asesor')} por WhatsApp</a></p>` : ''}
</div></div>
${pieContacto(marca)}
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body: { cita_id?: string; forzar?: boolean; avisar_asesor?: boolean } = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const citaId = String(body.cita_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(citaId)) return json({ ok: false, error: 'Falta la cita.' }, 400);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const interno = jwt === SERVICE_ROLE_KEY;

  const { data: cita } = await admin.from('agenda_citas')
    .select('id, empresa_id, tipo_cita, estado, cliente_nombre, cliente_email, token_cliente, asesor_id, radicacion_enviada_en').eq('id', citaId).maybeSingle();
  if (!cita) return json({ ok: false, error: 'No se encontró la cita.' }, 404);
  if (!interno) {
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const { data: m } = u?.user ? await admin.from('agenda_miembros').select('rol').eq('empresa_id', cita.empresa_id).eq('usuario_id', u.user.id).eq('activo', true).maybeSingle() : { data: null };
    if (!m) return json({ ok: false, error: 'No tienes permiso para esta cita.' }, 403);
  }
  const manual = !interno && body.forzar === true;

  const { data: cfg } = await admin.from('agenda_configuracion').select('radicacion_activa').eq('empresa_id', cita.empresa_id).maybeSingle();
  if (!manual && !cfg?.radicacion_activa) return json({ ok: true, enviado: false, motivo: 'La radicación automática está apagada.' });
  if (cita.tipo_cita !== 'visita_cliente' || cita.estado === 'cancelada') return json({ ok: true, enviado: false, motivo: 'Solo aplica a visitas de clientes activas.' });
  if (!manual && cita.radicacion_enviada_en) return json({ ok: true, enviado: false, motivo: 'Ya se envió.' });
  const para = correoValido(cita.cliente_email);
  if (!para) return json({ ok: true, enviado: false, motivo: 'El cliente no dejó un correo válido.' });

  const { data: d } = await admin.rpc('agenda_radicacion_datos', { p_cita_id: cita.id });
  if (!d || d.error) return json({ ok: true, enviado: false, motivo: d?.error === 'sin_configuracion' ? 'No hay datos de radicación para la ciudad de este inmueble (Configuración → Radicación).' : 'No se pudo preparar la información.' });

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
  const dominio = String(config.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const paginaUrl = `https://${dominio}/radicar/${cita.token_cliente}`;

  let asesor: { nombre: string; celular: string | null; correo: string | null; correos_adicionales: string | null } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin.from('agenda_asesores').select('nombre, celular, correo, correos_adicionales').eq('id', cita.asesor_id).maybeSingle();
    asesor = data;
  }
  const dig = String(asesor?.celular || '').replace(/\D/g, '');
  const asesorWa = dig.length === 10 && dig.startsWith('3') ? '57' + dig : dig.length >= 11 ? dig : '';

  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const asunto = `Siguiente paso para el inmueble Nº ${d.numero_inmueble}: tu estudio toma unos 10 minutos`;
  const destino = modoPruebas ? config.correo_pruebas_destino || para : para;
  let estado: 'enviado' | 'fallido' = 'enviado';
  let detalle: string | null = null;
  try {
    await transporte.sendMail({
      from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto,
      html: construirHtml(marca, d, { modoPruebas, real: para, paginaUrl, asesorWa, asesorNombreCita: asesor?.nombre || '' }),
    });
  } catch (e) {
    estado = 'fallido';
    detalle = e instanceof Error ? e.message : String(e);
  }
  await log(admin, { empresa_id: cita.empresa_id, cita_id: cita.id, destinatario_tipo: 'cliente', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
  if (estado === 'fallido') return json({ ok: false, enviado: false, error: 'No se pudo enviar el correo.' }, 502);
  await admin.from('agenda_citas').update({ radicacion_enviada_en: new Date().toISOString() }).eq('id', cita.id);

  // Aviso al asesor para que esté pendiente (los automáticos lo incluyen en su propio aviso de «siguiente paso»).
  if (asesor && body.avisar_asesor !== false) {
    const correos = [...new Set(`${asesor.correo || ''};${asesor.correos_adicionales || ''}`.split(/[;,\s]+/).filter((c) => /\S+@\S+\.\S+/.test(c)))];
    const asuntoA = `Radicación enviada a ${cita.cliente_nombre} · Inmueble ${d.numero_inmueble}`;
    for (const real of correos) {
      const destA = modoPruebas ? config.correo_pruebas_destino || real : real;
      let estA: 'enviado' | 'fallido' = 'enviado';
      let detA: string | null = null;
      try {
        await transporte.sendMail({
          from: `${remitente} <${config.correo_remitente_email}>`, to: destA, subject: asuntoA,
          html: `<div style="font-family:Poppins,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#4d4d4d;font-size:14px;line-height:1.6">${modoPruebas ? `<p style="background:#FEF3C7;color:#92400E;padding:10px 14px;border-radius:8px;font-weight:600">MODO DE PRUEBAS — iba dirigido a: ${esc(real)}</p>` : ''}<p>Hola ${esc(asesor.nombre)}, <b>${esc(cita.cliente_nombre)}</b> quiere avanzar con el inmueble Nº ${esc(d.numero_inmueble)} y ya le enviamos el correo para radicar su estudio (${esc((d.aseguradoras || []).map((x: Aseguradora) => x.aseguradora).join(' / '))}). <b>Está pendiente de que lo complete</b>: contáctalo pronto para resolverle dudas y acompañarlo, y revisa tu correo por si la aseguradora te lo consulta.</p><p>📞 ${esc(cita.cliente_email || '')}</p></div>`,
        });
      } catch (e) { estA = 'fallido'; detA = e instanceof Error ? e.message : String(e); }
      await log(admin, { empresa_id: cita.empresa_id, cita_id: cita.id, destinatario_tipo: 'interno', destinatario_email: destA, asunto: asuntoA, estado: estA, detalle_error: detA, modo_pruebas: modoPruebas });
    }
  }
  return json({ ok: true, enviado: true });
});
