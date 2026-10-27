// Edge Function: avisar-encuesta-respondida
// Avisos por correo cuando un cliente responde la encuesta de su visita:
//   1) Al ASESOR de esa visita, de inmediato, si el cliente quiere avanzar, una segunda visita o que lo contacten
//      (intención «avanzar», «segunda_visita» o «resolver_dudas»): es una oportunidad que hay que atender.
//   2) A la administración, según Configuración de cada empresa (`encuesta_aviso_admin`): «cada» encuesta contestada
//      (valor por defecto), un «semanal» (resumen de los últimos 7 días) o «ninguna».
// Entradas:
//   - { token }  → la llama la página pública de la encuesta justo después de guardar la respuesta. Solo actúa sobre esa
//                  encuesta y solo una vez (cada aviso se «reclama» con una marca atómica en agenda_encuestas_cliente).
//   - Encabezado x-cron-secreto + { tarea: 'barrido' } → recoge encuestas contestadas (últimos 2 días) cuyo aviso no salió.
//   - Encabezado x-cron-secreto + { tarea: 'semanal' } → manda el resumen semanal a las empresas que lo eligieron.
// verify_jwt = false: el token de la encuesta (o el secreto del cron) es la credencial.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieContacto, type MarcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secreto',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function esc(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const IMPRESION: Record<string, [string, string]> = {
  me_gusto_mucho: ['😍', 'Le gustó mucho'],
  me_gusto: ['🙂', 'Le gustó'],
  no_seguro: ['😐', 'No está seguro'],
  no_me_gusto: ['🙁', 'No le gustó'],
};
const INTENCION: Record<string, [string, string]> = {
  avanzar: ['✅', 'Quiere avanzar con este inmueble'],
  segunda_visita: ['🏡', 'Quiere una segunda visita'],
  resolver_dudas: ['📲', 'Pide que lo contacten para resolver dudas'],
  ver_otras: ['🔎', 'Quiere ver otras opciones similares'],
  no_interesa: ['❌', 'No le interesa este inmueble'],
};
const MOTIVO: Record<string, string> = {
  precio: 'Precio alto',
  ubicacion: 'Ubicación',
  estado: 'Estado del inmueble',
  tamano: 'Tamaño o distribución',
  ruido: 'Ruido o sector',
};
const INTENCIONES_CALIENTES = ['avanzar', 'segunda_visita', 'resolver_dudas'];
const estrellas = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;

function correosDe(texto: string | null | undefined): string[] {
  return String(texto || '')
    .split(/[;,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /\S+@\S+\.\S+/.test(c));
}

// ---- Correo (SMTP de la empresa) -----------------------------------------------------------
const cacheCorreo = new Map<string, { config: Cfg; marca: MarcaCorreo; transporte: ReturnType<typeof nodemailer.createTransport>; modoPruebas: boolean } | null>();
async function contextoCorreo(admin: Admin, empresaId: string) {
  if (cacheCorreo.has(empresaId)) return cacheCorreo.get(empresaId)!;
  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, dominio_publico, nombre_comercial, contacto_empresa, correo_contacto, telefono, encuesta_aviso_admin, encuesta_aviso_correos, alerta_baja_calificacion, alerta_baja_incluye_asesor, empresa:agenda_empresas(slug)',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();
  let resultado = null;
  if (config?.correo_smtp_host && config.correo_remitente_email) {
    const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
    if (password) {
      resultado = {
        config,
        marca: marcaCorreo(config),
        modoPruebas: config.correo_modo_pruebas !== false,
        transporte: nodemailer.createTransport({
          host: config.correo_smtp_host,
          port: config.correo_smtp_puerto || 587,
          secure: config.correo_smtp_seguridad === 'ssl',
          auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
        }),
      };
    }
  }
  cacheCorreo.set(empresaId, resultado);
  return resultado;
}

function plantilla(opts: { marca: MarcaCorreo; remitente: string; modoPruebas: boolean; destinatarioReal: string; titulo: string; cuerpo: string; boton?: { texto: string; url: string } }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.destinatarioReal)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(opts.marca, opts.titulo, 'ninguna')}
<div style="padding:28px 26px">
<h1 style="color:${opts.marca.principal};font-size:24px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-.01em;margin:0 0 12px">${esc(opts.titulo)}</h1>
<div style="color:#4d4d4d;font-size:14px;line-height:1.6">${opts.cuerpo}</div>
${opts.boton ? `<p style="margin:22px 0 0;text-align:center"><a href="${esc(opts.boton.url)}" style="display:inline-block;background:${opts.marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(opts.boton.texto)}</a></p>` : ''}
</div></div>
<p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${esc(opts.remitente)}</p>
${pieContacto(opts.marca)}
</div></body></html>`;
}

async function enviar(
  admin: Admin,
  empresaId: string,
  citaId: string | null,
  destinatarios: string[],
  asunto: string,
  titulo: string,
  cuerpo: string,
  boton?: { texto: string; url: string },
): Promise<number> {
  const ctx = await contextoCorreo(admin, empresaId);
  if (!ctx || !destinatarios.length) return 0;
  const { config, marca, transporte, modoPruebas } = ctx;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  let enviados = 0;
  for (const real of destinatarios) {
    const destino = modoPruebas ? config.correo_pruebas_destino || real : real;
    let estado: 'enviado' | 'fallido' = 'enviado';
    let detalle: string | null = null;
    try {
      await transporte.sendMail({
        from: `${remitente} <${config.correo_remitente_email}>`,
        to: destino,
        subject: asunto,
        html: plantilla({ marca, remitente, modoPruebas, destinatarioReal: real, titulo, cuerpo, boton }),
      });
      enviados++;
    } catch (e) {
      estado = 'fallido';
      detalle = e instanceof Error ? e.message : String(e);
    }
    try {
      await admin.from('agenda_correos_log').insert({
        empresa_id: empresaId, cita_id: citaId, destinatario_tipo: 'interno', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas,
      });
    } catch { /* sin registro no hay nada más que hacer */ }
  }
  return enviados;
}

// Administradores activos de la empresa (sus correos de acceso) o, si Configuración define destinatarios, esos.
async function destinatariosAdmin(admin: Admin, empresaId: string, config: Cfg): Promise<string[]> {
  const extra = correosDe(config.encuesta_aviso_correos);
  if (extra.length) return extra;
  const { data: miembros } = await admin.from('agenda_miembros').select('usuario_id').eq('empresa_id', empresaId).eq('rol', 'administrador').eq('activo', true);
  const correos: string[] = [];
  for (const m of miembros || []) {
    const { data } = await admin.auth.admin.getUserById(m.usuario_id);
    if (data?.user?.email) correos.push(data.user.email);
  }
  return [...new Set(correos)];
}

// Quién supervisa a un asesor: su supervisor (ficha del asesor, pestaña Equipo) + los correos que Configuración defina para los avisos de encuesta.
// Si no hay ninguno de los dos, los administradores activos. Así los avisos no «enloquecen» a todo el equipo.
async function destinatariosSupervision(admin: Admin, empresaId: string, config: Cfg, supervisorId: string | null): Promise<string[]> {
  const correos = new Set<string>(correosDe(config.encuesta_aviso_correos));
  if (supervisorId) {
    const { data: sup } = await admin.from('agenda_asesores').select('correo, correos_adicionales').eq('id', supervisorId).maybeSingle();
    for (const c of [...correosDe(sup?.correo), ...correosDe(sup?.correos_adicionales)]) correos.add(c);
  }
  if (correos.size) return [...correos];
  return await destinatariosAdmin(admin, empresaId, config);
}

// ---- Una encuesta contestada ---------------------------------------------------------------
async function procesarEncuesta(admin: Admin, filtro: { token?: string; id?: string }) {
  let q = admin.from('agenda_encuestas_cliente').select('id, cita_id, inmueble_id, empresa_id, calificacion, comentario, respondido_en, impresion, intencion, motivo, aviso_admin_en, aviso_asesor_en, aviso_calidad_en');
  q = filtro.token ? q.eq('token', filtro.token) : q.eq('id', filtro.id as string);
  const { data: enc } = await q.maybeSingle();
  if (!enc || !enc.respondido_en) return { asesor: 0, admin: 0 };

  const [{ data: cita }, { data: inmueble }] = await Promise.all([
    admin.from('agenda_citas').select('fecha, hora_inicio, cliente_nombre, cliente_email, cliente_telefono, asesor_id').eq('id', enc.cita_id).maybeSingle(),
    admin.from('agenda_inmuebles').select('numero_inmueble, direccion').eq('id', enc.inmueble_id).maybeSingle(),
  ]);
  if (!cita) return { asesor: 0, admin: 0 };
  const ctx = await contextoCorreo(admin, enc.empresa_id);
  if (!ctx) return { asesor: 0, admin: 0 };
  const dominio = ctx.config.dominio_publico || 'citas.patrimonios.co';
  let asesor: { nombre: string; correo: string | null; correos_adicionales: string | null; supervisor_id: string | null } | null = null;
  if (cita.asesor_id) {
    const { data } = await admin.from('agenda_asesores').select('nombre, correo, correos_adicionales, supervisor_id').eq('id', cita.asesor_id).maybeSingle();
    asesor = data;
  }
  const num = inmueble?.numero_inmueble ?? '';
  const imp = enc.impresion ? IMPRESION[enc.impresion] : null;
  const intn = enc.intencion ? INTENCION[enc.intencion] : null;
  const filaDato = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#6b6b6b;font-size:13px;vertical-align:top;width:34%">${k}</td><td style="padding:6px 0;color:#1a2c45;font-size:14px;font-weight:600">${v}</td></tr>`;
  const resultado = { asesor: 0, admin: 0 };

  // 1) Aviso inmediato al asesor: el cliente quiere avanzar / otra visita / que lo contacten.
  if (enc.intencion && INTENCIONES_CALIENTES.includes(enc.intencion) && !enc.aviso_asesor_en && asesor) {
    const { data: reclamo } = await admin.from('agenda_encuestas_cliente').update({ aviso_asesor_en: new Date().toISOString() }).eq('id', enc.id).is('aviso_asesor_en', null).select('id').maybeSingle();
    const correos = [...new Set([...correosDe(asesor.correo), ...correosDe(asesor.correos_adicionales)])];
    if (reclamo && correos.length) {
      const contacto = [cita.cliente_telefono ? `📞 <a href="tel:${esc(cita.cliente_telefono)}" style="color:inherit">${esc(cita.cliente_telefono)}</a>` : '', cita.cliente_email ? `✉️ <a href="mailto:${esc(cita.cliente_email)}" style="color:inherit">${esc(cita.cliente_email)}</a>` : ''].filter(Boolean).join(' · ');
      resultado.asesor = await enviar(
        admin, enc.empresa_id, enc.cita_id, correos,
        `${intn ? intn[0] : '✅'} ${cita.cliente_nombre} quiere dar el siguiente paso · Inmueble ${num}`,
        'Un cliente quiere dar el siguiente paso',
        `<p style="margin:0 0 12px;text-align:justify">Hola ${esc(asesor.nombre)}, <b>${esc(cita.cliente_nombre)}</b> respondió la encuesta de su visita al inmueble Nº ${esc(String(num))}${inmueble?.direccion ? ` (${esc(inmueble.direccion)})` : ''}. Conviene contactarlo pronto.</p>
<table style="width:100%;border-collapse:collapse">
${intn ? filaDato('Siguiente paso', `${intn[0]} ${esc(intn[1])}`) : ''}
${imp ? filaDato('Impresión', `${imp[0]} ${esc(imp[1])}`) : ''}
${filaDato('Atención del asesor', estrellas(enc.calificacion))}
${contacto ? filaDato('Contacto', contacto) : ''}
</table>
${enc.comentario ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f4f4f4;border-radius:10px;text-align:justify">«${esc(enc.comentario)}»</p>` : ''}`,
        { texto: 'Ver la encuesta', url: `https://${dominio}/?encuesta=${enc.id}` },
      );
    }
  }

  // 2) Calificación baja: alerta a quien supervisa («revisar qué pasó»). Al asesor solo si la empresa lo activó.
  const modo = ctx.config.encuesta_aviso_admin || 'cada';
  const umbral = Number(ctx.config.alerta_baja_calificacion ?? 2);
  const esBaja = (enc.calificacion != null && enc.calificacion <= umbral) || enc.impresion === 'no_me_gusto';
  if (esBaja && !enc.aviso_calidad_en) {
    const ahora = new Date().toISOString();
    // Si el aviso a la administración es «cada encuesta», esta alerta lo reemplaza para esta opinión (un solo correo).
    const marcas: Record<string, string> = { aviso_calidad_en: ahora };
    if (modo === 'cada' && !enc.aviso_admin_en) marcas.aviso_admin_en = ahora;
    const { data: reclamo } = await admin.from('agenda_encuestas_cliente').update(marcas).eq('id', enc.id).is('aviso_calidad_en', null).select('id').maybeSingle();
    if (reclamo) {
      enc.aviso_admin_en = marcas.aviso_admin_en ?? enc.aviso_admin_en;
      const correos = await destinatariosSupervision(admin, enc.empresa_id, ctx.config, asesor?.supervisor_id ?? null);
      if (ctx.config.alerta_baja_incluye_asesor && asesor) for (const c of [...correosDe(asesor.correo), ...correosDe(asesor.correos_adicionales)]) if (!correos.includes(c)) correos.push(c);
      resultado.admin += await enviar(
        admin, enc.empresa_id, enc.cita_id, correos,
        `⚠️ Revisar: calificación baja · Inmueble ${num}${asesor ? ` · ${asesor.nombre}` : ''}`,
        'Una visita recibió una calificación baja',
        `<p style="margin:0 0 12px;text-align:justify">Conviene revisar qué pasó en esta visita y hablar con el asesor y, si hace falta, con el cliente. Una calificación baja es un indicio para conversar, no una conclusión.</p>
<table style="width:100%;border-collapse:collapse">
${filaDato('Inmueble', `Nº ${esc(String(num))}${inmueble?.direccion ? ` · ${esc(inmueble.direccion)}` : ''}`)}
${filaDato('Cliente', esc(cita.cliente_nombre))}
${asesor ? filaDato('Asesor', esc(asesor.nombre)) : ''}
${imp ? filaDato('Impresión', `${imp[0]} ${esc(imp[1])}`) : ''}
${intn ? filaDato('Siguiente paso', `${intn[0]} ${esc(intn[1])}`) : ''}
${enc.motivo && MOTIVO[enc.motivo] ? filaDato('Motivo', esc(MOTIVO[enc.motivo])) : ''}
${filaDato('Atención del asesor', estrellas(enc.calificacion))}
</table>
${enc.comentario ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f4f4f4;border-radius:10px;text-align:justify">«${esc(enc.comentario)}»</p>` : ''}`,
        { texto: 'Ver la encuesta', url: `https://${dominio}/?encuesta=${enc.id}` },
      );
    }
  }

  // 3) Aviso a la administración, según Configuración (por defecto: cada encuesta).
  if (modo === 'cada' && !enc.aviso_admin_en) {
    const { data: reclamo } = await admin.from('agenda_encuestas_cliente').update({ aviso_admin_en: new Date().toISOString() }).eq('id', enc.id).is('aviso_admin_en', null).select('id').maybeSingle();
    if (reclamo) {
      const correos = await destinatariosSupervision(admin, enc.empresa_id, ctx.config, asesor?.supervisor_id ?? null);
      resultado.admin += await enviar(
        admin, enc.empresa_id, enc.cita_id, correos,
        `${imp ? imp[0] : '⭐'} Nueva opinión de un cliente · Inmueble ${num}`,
        'Un cliente respondió la encuesta',
        `<table style="width:100%;border-collapse:collapse">
${filaDato('Inmueble', `Nº ${esc(String(num))}${inmueble?.direccion ? ` · ${esc(inmueble.direccion)}` : ''}`)}
${filaDato('Cliente', esc(cita.cliente_nombre))}
${asesor ? filaDato('Asesor', esc(asesor.nombre)) : ''}
${imp ? filaDato('Impresión', `${imp[0]} ${esc(imp[1])}`) : ''}
${intn ? filaDato('Siguiente paso', `${intn[0]} ${esc(intn[1])}`) : ''}
${enc.motivo && MOTIVO[enc.motivo] ? filaDato('Motivo', esc(MOTIVO[enc.motivo])) : ''}
${filaDato('Atención del asesor', estrellas(enc.calificacion))}
</table>
${enc.comentario ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f4f4f4;border-radius:10px;text-align:justify">«${esc(enc.comentario)}»</p>` : ''}`,
        { texto: 'Ver la encuesta', url: `https://${dominio}/?encuesta=${enc.id}` },
      );
    }
  }
  return resultado;
}

// ---- Tareas del cron -----------------------------------------------------------------------
async function barrido(admin: Admin) {
  const desde = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data } = await admin
    .from('agenda_encuestas_cliente')
    .select('id')
    .not('respondido_en', 'is', null)
    .gte('respondido_en', desde)
    .or('aviso_admin_en.is.null,aviso_asesor_en.is.null')
    .limit(30);
  let n = 0;
  for (const e of data || []) {
    const r = await procesarEncuesta(admin, { id: e.id });
    n += r.admin + r.asesor;
  }
  return n;
}

async function semanal(admin: Admin) {
  const { data: configs } = await admin.from('agenda_configuracion').select('empresa_id').eq('encuesta_aviso_admin', 'semanal');
  let enviados = 0;
  const hace7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const hace6 = new Date(Date.now() - 6 * 86400_000).toISOString();
  const asunto = 'Resumen semanal de opiniones de clientes';
  for (const c of configs || []) {
    const { count: yaEnviado } = await admin.from('agenda_correos_log').select('id', { count: 'exact', head: true }).eq('empresa_id', c.empresa_id).eq('asunto', asunto).eq('estado', 'enviado').gte('creado_en', hace6);
    if ((yaEnviado || 0) > 0) continue;
    const { data: encuestas } = await admin
      .from('agenda_encuestas_cliente')
      .select('cita_id, inmueble_id, calificacion, comentario, impresion, intencion, motivo, respondido_en')
      .eq('empresa_id', c.empresa_id)
      .not('respondido_en', 'is', null)
      .gte('respondido_en', hace7)
      .order('respondido_en', { ascending: true });
    if (!encuestas?.length) continue;
    const ctx = await contextoCorreo(admin, c.empresa_id);
    if (!ctx) continue;
    const ids = [...new Set(encuestas.map((e) => e.inmueble_id))];
    const { data: inmuebles } = await admin.from('agenda_inmuebles').select('id, numero_inmueble').in('id', ids);
    const numDe = new Map((inmuebles || []).map((i) => [i.id, i.numero_inmueble]));
    const cal = encuestas.filter((e) => e.calificacion).map((e) => e.calificacion as number);
    const promedio = cal.length ? (cal.reduce((a, b) => a + b, 0) / cal.length).toFixed(1) : '—';
    const cuenta = (campo: 'impresion' | 'intencion', k: string) => encuestas.filter((e) => e[campo] === k).length;
    const lineas = encuestas.slice(0, 30).map((e) => {
      const imp = e.impresion ? IMPRESION[e.impresion] : null;
      const intn = e.intencion ? INTENCION[e.intencion] : null;
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #efefef;font-size:13px">Inmueble ${esc(String(numDe.get(e.inmueble_id) ?? ''))} · ${imp ? `${imp[0]} ${esc(imp[1])}` : 'sin impresión'}${intn ? ` · ${intn[0]} ${esc(intn[1])}` : ''}${e.motivo && MOTIVO[e.motivo] ? ` · ${esc(MOTIVO[e.motivo])}` : ''} · ${estrellas(e.calificacion)}</td></tr>`;
    });
    const correos = await destinatariosAdmin(admin, c.empresa_id, ctx.config);
    enviados += await enviar(
      admin, c.empresa_id, null, correos, asunto, 'Opiniones de la última semana',
      `<p style="margin:0 0 10px">${encuestas.length} ${encuestas.length === 1 ? 'cliente respondió' : 'clientes respondieron'} la encuesta. Calificación promedio de la atención: <b>${promedio}</b> de 5.</p>
<p style="margin:0 0 12px">😍 ${cuenta('impresion', 'me_gusto_mucho')} · 🙂 ${cuenta('impresion', 'me_gusto')} · 😐 ${cuenta('impresion', 'no_seguro')} · 🙁 ${cuenta('impresion', 'no_me_gusto')} &nbsp;|&nbsp; ✅ ${cuenta('intencion', 'avanzar')} quieren avanzar</p>
<table style="width:100%;border-collapse:collapse">${lineas.join('')}</table>
${encuestas.length > 30 ? `<p style="margin:10px 0 0;font-size:12px">Se muestran las primeras 30; el detalle completo está en la Bitácora.</p>` : ''}`,
      { texto: 'Ver todas en la Bitácora', url: `https://${ctx.config.dominio_publico || 'citas.patrimonios.co'}/` },
    );
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* sin cuerpo */ }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const tarea = String(body.tarea || '');
  if (tarea) {
    const dado = req.headers.get('x-cron-secreto') || '';
    if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);
    try {
      if (tarea === 'barrido') return json({ ok: true, enviados: await barrido(admin) });
      if (tarea === 'semanal') return json({ ok: true, enviados: await semanal(admin) });
    } catch (e) {
      console.error('avisar-encuesta-respondida', tarea, e instanceof Error ? e.message : e);
      return json({ ok: false, error: 'Falló la tarea.' }, 500);
    }
    return json({ ok: false, error: 'Tarea desconocida.' }, 400);
  }

  const token = String(body.token || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return json({ ok: false, error: 'Token inválido.' }, 400);
  try {
    const r = await procesarEncuesta(admin, { token });
    return json({ ok: true, ...r });
  } catch (e) {
    console.error('avisar-encuesta-respondida', e instanceof Error ? e.message : e);
    return json({ ok: false, error: 'No se pudo enviar el aviso.' }, 500);
  }
});
