// Edge Function: avisar-demanda
// Cada hora (pg_cron, sql/035) calcula la demanda por inmueble (pedidos de cita en 24 y 48 horas) y manda UN correo a quien supervisa
// cuando un inmueble pasa a «atención» o «urgente»: probablemente el precio está por debajo del mercado y la agenda se está llenando.
// No repite el mismo nivel en 24 horas; si sube de atención a urgente, avisa de nuevo. Solo SUGIERE: nunca cambia precios ni cierra agendas.
// Destinatarios: correos de aviso de encuesta de Empresa (si hay) o administradores activos. Respeta correo_modo_pruebas.
// Se despliega con --no-verify-jwt; la credencial es el encabezado x-cron-secreto (mismo secreto que las encuestas).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieContacto, type MarcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';

type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cop = (n: number) => '$ ' + Math.round(Number(n)).toLocaleString('es-CO');
const redondear = (n: number) => Math.round(n / 10000) * 10000;

// Misma lógica que aplicacion/js/alertas-demanda.js (se prueba allí con node --test); si cambias una, cambia la otra.
function nivelDemanda(m: Fila, u: { info: number; urgente: number }): 'urgente' | 'atencion' | 'normal' {
  const p24 = Number(m.pedidos_24h || 0);
  const p48 = Number(m.pedidos_48h || 0);
  const llena = m.tope != null && Number(m.activas || 0) >= Number(m.tope);
  if (p24 >= u.urgente || p48 >= u.urgente * 2 || llena) return 'urgente';
  if (p24 >= u.info || p48 >= u.info * 2) return 'atencion';
  return 'normal';
}
function rango(m: Fila, nivel: string) {
  const base = Number(m.valor_canon || m.valor_venta || 0);
  if (!base || nivel === 'normal') return null;
  const [a, b] = nivel === 'urgente' ? [0.08, 0.1] : [0.03, 0.05];
  return { desde: redondear(base * (1 + a)), hasta: redondear(base * (1 + b)), pct: nivel === 'urgente' ? '8–10 %' : '3–5 %' };
}
function texto(m: Fila, nivel: string) {
  const r = rango(m, nivel);
  const dato = `${m.pedidos_24h} ${m.pedidos_24h === 1 ? 'pedido' : 'pedidos'} de cita en 24 h (${m.pedidos_48h} en 48 h) de ${m.personas} ${m.personas === 1 ? 'persona' : 'personas distintas'}`;
  const cola = m.tope != null && m.activas >= m.tope ? ` La agenda ya llegó al tope: ${m.activas} de ${m.tope} citas activas.` : '';
  const sug = r ? `entre ${r.pct} (${cop(r.desde)} a ${cop(r.hasta)})` : 'el precio';
  return nivel === 'urgente'
    ? `${dato}.${cola} Hay mucha más demanda que inmuebles: el precio probablemente está por debajo del mercado y la agenda del equipo se está llenando con un solo inmueble. Sugerencia: considera subir ${sug}, limitar las citas nuevas y agrupar a los interesados en una visita en grupo. Revisa de nuevo en 48 horas.`
    : `${dato}.${cola} El ritmo es alto. Sugerencia: vigílalo; si sigue así mañana, considera subir ${sug}.`;
}

function correosDe(t: string | null | undefined): string[] {
  return String(t || '').split(/[;,\s]+/).map((c) => c.trim()).filter((c) => /\S+@\S+\.\S+/.test(c));
}
async function destinatarios(admin: Admin, empresaId: string, config: Fila): Promise<string[]> {
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

function html(marca: MarcaCorreo, dominio: string, lista: { m: Fila; nivel: string }[], modoPruebas: boolean, real: string) {
  const tarjetas = lista.map(({ m, nivel }) => `<div style="border:1px solid #e5e7eb;border-left:5px solid ${nivel === 'urgente' ? '#DC2626' : '#D97706'};border-radius:12px;padding:12px 14px;margin:0 0 12px">
<div style="font-weight:600;color:${marca.principal};font-size:15px">${nivel === 'urgente' ? '🔴 Urgente' : '🟡 Atención'} · Inmueble ${esc(m.numero_inmueble)}</div>
<div style="color:#6b6b6b;font-size:13px;margin:2px 0 6px">${esc([m.direccion, m.barrio].filter(Boolean).join(', '))} · ${esc(m.tipo_oferta || '')} ${cop(m.valor_canon || m.valor_venta || 0)}</div>
<div style="color:#4d4d4d;font-size:14px;line-height:1.55">${esc(texto(m, nivel))}</div></div>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(real)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(marca, 'Alerta de demanda', 'ninguna')}
<div style="padding:28px 26px"><h1 style="color:${marca.principal};font-size:24px;line-height:1.25;font-weight:600;margin:0 0 12px">Mucha demanda en ${lista.length === 1 ? 'un inmueble' : lista.length + ' inmuebles'}</h1>
<p style="color:#4d4d4d;font-size:14px;line-height:1.6;margin:0 0 14px">Esto es una sugerencia para revisar el precio a tiempo; el sistema no cambia nada solo.</p>
${tarjetas}
<p style="margin:18px 0 0;text-align:center"><a href="https://${dominio}/" style="display:inline-block;background:${marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">Abrir Configuración → Demanda</a></p></div></div>
${pieContacto(marca)}</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: empresas } = await admin.from('agenda_configuracion').select('empresa_id');
  let enviados = 0;
  let alertas = 0;
  for (const e of empresas ?? []) {
    const { data: r, error } = await admin.rpc('agenda_demanda_resumen', { p_empresa_id: e.empresa_id, p_dias: 3 });
    if (error || !r) { console.error('avisar-demanda resumen:', error?.message); continue; }
    const u = { info: Number(r.umbral_info || 3), urgente: Number(r.umbral_urgente || 5) };
    const candidatas = (r.inmuebles || []).map((m: Fila) => ({ m, nivel: nivelDemanda(m, u) })).filter((x: { nivel: string }) => x.nivel !== 'normal');
    if (!candidatas.length) continue;
    // No repetir el mismo nivel en 24 h (subir de atención a urgente sí avisa).
    const { data: previos } = await admin.from('agenda_demanda_avisos').select('numero_inmueble, nivel').eq('empresa_id', e.empresa_id).gte('enviado_en', new Date(Date.now() - 24 * 3600_000).toISOString());
    const yaAvisado = new Set((previos ?? []).map((p) => `${p.numero_inmueble}:${p.nivel}`));
    const urgenteYa = new Set((previos ?? []).filter((p) => p.nivel === 'urgente').map((p) => p.numero_inmueble));
    const nuevas = candidatas.filter((x: { m: Fila; nivel: string }) => !yaAvisado.has(`${x.m.numero_inmueble}:${x.nivel}`) && !(x.nivel === 'atencion' && urgenteYa.has(x.m.numero_inmueble)));
    if (!nuevas.length) continue;
    alertas += nuevas.length;

    const { data: config } = await admin.from('agenda_configuracion')
      .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, dominio_publico, nombre_comercial, contacto_empresa, correo_contacto, telefono, encuesta_aviso_correos, empresa:agenda_empresas(slug)')
      .eq('empresa_id', e.empresa_id).maybeSingle();
    const { data: password } = config?.correo_smtp_host ? await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: e.empresa_id }) : { data: null };
    if (!config?.correo_smtp_host || !config.correo_remitente_email || !password) continue;
    const modoPruebas = config.correo_modo_pruebas !== false;
    const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string } });
    const marca = marcaCorreo(config as Fila);
    const dominio = String(config.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
    const asunto = nuevas.some((x: { nivel: string }) => x.nivel === 'urgente')
      ? `🔴 Demanda urgente: ${nuevas.map((x: { m: Fila }) => 'Inmueble ' + x.m.numero_inmueble).slice(0, 3).join(', ')}`
      : `🟡 Mucha demanda: ${nuevas.map((x: { m: Fila }) => 'Inmueble ' + x.m.numero_inmueble).slice(0, 3).join(', ')}`;
    let algunoOk = false;
    for (const real of await destinatarios(admin, e.empresa_id, config)) {
      const destino = modoPruebas ? config.correo_pruebas_destino || real : real;
      let estado: 'enviado' | 'fallido' = 'enviado';
      let detalle: string | null = null;
      try {
        await transporte.sendMail({ from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html: html(marca, dominio, nuevas, modoPruebas, real) });
        enviados++;
        algunoOk = true;
      } catch (err) {
        estado = 'fallido';
        detalle = err instanceof Error ? err.message : String(err);
      }
      try { await admin.from('agenda_correos_log').insert({ empresa_id: e.empresa_id, cita_id: null, destinatario_tipo: 'interno', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas }); } catch { /* sin registro no hay nada más que hacer */ }
    }
    if (algunoOk) await admin.from('agenda_demanda_avisos').insert(nuevas.map((x: { m: Fila; nivel: string }) => ({ empresa_id: e.empresa_id, numero_inmueble: x.m.numero_inmueble, nivel: x.nivel })));
  }
  return json({ ok: true, alertas, enviados });
});
