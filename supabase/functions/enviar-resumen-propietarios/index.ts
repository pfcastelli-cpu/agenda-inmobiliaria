// Edge Function: enviar-resumen-propietarios
// Manda a los propietarios que eligieron «resumen semanal» o «resumen mensual» (sql/032, página /preferencias/<token>) un solo correo
// con lo que pasó con sus inmuebles. La llama pg_cron todos los días a las 7:00 a. m. (Bogotá) con el encabezado x-cron-secreto;
// la propia función decide quién toca: semanal = los lunes, mensual = el día 1, y nunca repite si ya se envió hace poco.
// Si en el periodo no hubo ninguna visita, no se manda nada (solo se anota que ya se revisó).
// Respeta correo_modo_pruebas (todo va a correo_pruebas_destino mientras esté activo). verify_jwt = false: la credencial es el secreto.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo, pieLegal, bloqueCaptacion, type MarcaCorreo } from '../_shared/marca-correo.ts';
import { urlPreferencias } from '../_shared/preferencias-propietario.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';
const MAX_POR_CORRIDA = 40;

type Admin = ReturnType<typeof createClient>;
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}
const esc = (v: string | null | undefined) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function ahoraBogota() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }); // 2026-10-26 15:04:09
  const fecha = s.slice(0, 10);
  const d = new Date(fecha + 'T12:00:00Z');
  return { fecha, diaSemana: d.getUTCDay(), diaMes: d.getUTCDate() };
}
function sumarDias(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fechaLarga = (f: string) => FORMATO_FECHA.format(new Date(f + 'T12:00:00Z'));
function hora12(h: string) {
  const [hh, mm] = h.slice(0, 5).split(':').map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'p. m.' : 'a. m.'}`;
}

async function contextoCorreo(admin: Admin, empresaId: string, cache: Map<string, unknown>) {
  if (cache.has(empresaId)) return cache.get(empresaId) as { config: Cfg; marca: MarcaCorreo; transporte: ReturnType<typeof nodemailer.createTransport>; modoPruebas: boolean } | null;
  const { data: config } = await admin
    .from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, dominio_publico, nombre_comercial, contacto_empresa, correo_contacto, telefono, empresa:agenda_empresas(slug)')
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
  cache.set(empresaId, resultado);
  return resultado;
}

type FilaInmueble = { numero: number; direccion: string; token: string | null; realizadas: number; proximas: { fecha: string; hora: string }[]; canceladas: number };

function htmlResumen(marca: MarcaCorreo, config: Cfg, opts: { modoPruebas: boolean; real: string; periodo: string; filas: FilaInmueble[]; urlPrefs: string; publicidad: boolean }) {
  const dominio = String(config.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const tarjetas = opts.filas.map((f) => `<div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;margin:0 0 12px">
<div style="font-weight:600;color:${marca.principal};font-size:15px">Inmueble Nº ${f.numero}${f.direccion ? ` · ${esc(f.direccion)}` : ''}</div>
<div style="margin:6px 0;font-size:14px">✅ ${f.realizadas} ${f.realizadas === 1 ? 'visita realizada' : 'visitas realizadas'} · 🗓️ ${f.proximas.length} ${f.proximas.length === 1 ? 'próxima' : 'próximas'} · ❌ ${f.canceladas} ${f.canceladas === 1 ? 'cancelada' : 'canceladas'}</div>
${f.proximas.length ? `<div style="font-size:13px;color:#6b6b6b">Próximas: ${f.proximas.slice(0, 5).map((p) => `${esc(fechaLarga(p.fecha))}, ${esc(hora12(p.hora))}`).join(' · ')}</div>` : ''}
${f.token ? `<div style="margin-top:8px"><a href="https://${dominio}/propietario/${f.token}" style="color:${marca.principal};font-weight:600;font-size:13px">📊 Ver el informe en vivo</a></div>` : ''}
</div>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
${opts.modoPruebas ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${esc(opts.real)}</div>` : ''}
<div style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb">
${encabezadoImagen(marca, 'Resumen de tus inmuebles', 'ninguna')}
<div style="padding:28px 26px 8px">
<h1 style="color:${marca.principal};font-size:24px;line-height:1.25;font-weight:600;margin:0 0 12px">Resumen de tus inmuebles</h1>
<p style="color:#4d4d4d;font-size:14px;line-height:1.6;margin:0 0 16px">Esto pasó ${esc(opts.periodo)}:</p>
${tarjetas}
</div>
${opts.publicidad ? bloqueCaptacion(marca) : ''}
</div>
${pieLegal(marca, opts.urlPrefs)}
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const hoy = ahoraBogota();
  const tocaSemanal = hoy.diaSemana === 1;
  const tocaMensual = hoy.diaMes === 1;
  if (!tocaSemanal && !tocaMensual) return json({ ok: true, enviados: 0, motivo: 'Hoy no toca ningún resumen.' });

  const tipos = [tocaSemanal ? 'semanal' : null, tocaMensual ? 'mensual' : null].filter(Boolean) as string[];
  const { data: prefs } = await admin.from('agenda_propietario_preferencias').select('id, empresa_id, email, token, frecuencia, publicidad, ultimo_resumen_en').in('frecuencia', tipos).limit(500);

  const cache = new Map<string, unknown>();
  let enviados = 0;
  let revisados = 0;
  for (const p of prefs ?? []) {
    if (revisados >= MAX_POR_CORRIDA) break;
    const minimoDias = p.frecuencia === 'semanal' ? 5 : 25;
    if (p.ultimo_resumen_en && Date.now() - Date.parse(p.ultimo_resumen_en) < minimoDias * 86400_000) continue;
    revisados++;

    const diasPeriodo = p.frecuencia === 'semanal' ? 7 : 30;
    const desde = sumarDias(hoy.fecha, -diasPeriodo);
    const hasta = sumarDias(hoy.fecha, diasPeriodo);

    // Inmuebles de ese correo (el campo email de agenda_propietarios puede traer varios correos separados por coma o punto y coma).
    const { data: props } = await admin.from('agenda_propietarios').select('numero_inmueble, email').eq('empresa_id', p.empresa_id).ilike('email', `%${p.email}%`);
    const numeros = [...new Set((props ?? []).filter((x) => String(x.email || '').toLowerCase().split(/[;,\s]+/).includes(p.email)).map((x) => x.numero_inmueble))];
    const { data: inmuebles } = numeros.length
      ? await admin.from('agenda_inmuebles').select('id, numero_inmueble, direccion, token_informe_propietario').eq('empresa_id', p.empresa_id).in('numero_inmueble', numeros)
      : { data: [] };
    const ids = (inmuebles ?? []).map((i) => i.id);
    const { data: citas } = ids.length
      ? await admin.from('agenda_citas').select('inmueble_id, fecha, hora_inicio, estado').eq('empresa_id', p.empresa_id).eq('tipo_cita', 'visita_cliente').eq('es_prueba', false).in('inmueble_id', ids).gte('fecha', desde).lte('fecha', hasta)
      : { data: [] };

    const filas: FilaInmueble[] = [];
    for (const i of inmuebles ?? []) {
      const mias = (citas ?? []).filter((c) => c.inmueble_id === i.id);
      const realizadas = mias.filter((c) => c.estado !== 'cancelada' && c.fecha < hoy.fecha).length;
      const proximas = mias.filter((c) => c.estado !== 'cancelada' && c.fecha >= hoy.fecha).sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio)).map((c) => ({ fecha: c.fecha, hora: c.hora_inicio }));
      const canceladas = mias.filter((c) => c.estado === 'cancelada' && c.fecha >= desde && c.fecha < hoy.fecha).length;
      if (realizadas || proximas.length || canceladas) filas.push({ numero: i.numero_inmueble, direccion: i.direccion || '', token: i.token_informe_propietario, realizadas, proximas, canceladas });
    }

    // Sin movimiento no se manda nada, pero se anota la revisión para no repetirla.
    if (filas.length) {
      const ctx = await contextoCorreo(admin, p.empresa_id, cache);
      if (ctx) {
        const { config, marca, transporte, modoPruebas } = ctx as { config: Cfg; marca: MarcaCorreo; transporte: ReturnType<typeof nodemailer.createTransport>; modoPruebas: boolean };
        const destino = modoPruebas ? config.correo_pruebas_destino || p.email : p.email;
        const asunto = p.frecuencia === 'semanal' ? 'Resumen semanal de tus inmuebles' : 'Resumen mensual de tus inmuebles';
        let estado: 'enviado' | 'fallido' = 'enviado';
        let detalle: string | null = null;
        try {
          await transporte.sendMail({
            from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`,
            to: destino,
            subject: asunto,
            html: htmlResumen(marca, config, { modoPruebas, real: p.email, periodo: p.frecuencia === 'semanal' ? 'en la última semana y lo que viene' : 'en el último mes y lo que viene', filas, urlPrefs: urlPreferencias(config, p.token), publicidad: p.publicidad !== false }),
          });
          enviados++;
        } catch (e) {
          estado = 'fallido';
          detalle = e instanceof Error ? e.message : String(e);
        }
        try {
          await admin.from('agenda_correos_log').insert({ empresa_id: p.empresa_id, cita_id: null, destinatario_tipo: 'propietario', destinatario_email: destino, asunto, estado, detalle_error: detalle, modo_pruebas: modoPruebas });
        } catch { /* sin registro no hay nada más que hacer */ }
        if (estado === 'fallido') continue; // se reintenta en la próxima corrida
      } else {
        continue; // correo no configurado: se reintenta cuando lo esté
      }
    }
    await admin.from('agenda_propietario_preferencias').update({ ultimo_resumen_en: new Date().toISOString() }).eq('id', p.id);
  }
  return json({ ok: true, revisados, enviados });
});
