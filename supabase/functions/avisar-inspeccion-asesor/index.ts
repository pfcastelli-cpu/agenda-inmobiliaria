// Edge Function: avisar-inspeccion-asesor
// La llama pg_cron cada 5 minutos (ver sql/077) con el encabezado `x-cron-secreto` (CRON_ENCUESTAS_SECRETO). verify_jwt = false.
// 30 minutos antes de cada inspección de hoy le manda al asesor asignado su «código del asesor»: el que debe decirle al arrendatario al llegar
// para identificarse. Se reserva la marca antes de enviar para no repetir el correo. Respeta correo_modo_pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase } from '../_shared/plantilla-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';
const SITIO_URL = 'https://citas.patrimonios.co';
const MINUTOS_ANTES = 30;
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const horaTexto = (h: string) => { const [H, M] = h.split(':').map(Number); return `${H % 12 === 0 ? 12 : H % 12}:${String(M).padStart(2, '0')} ${H >= 12 ? 'p. m.' : 'a. m.'}`; };

function ahoraBogota() {
  const p = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }); // "YYYY-MM-DD HH:MM:SS"
  return { fecha: p.slice(0, 10), pared: Date.parse(p.replace(' ', 'T') + 'Z') };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const ahora = ahoraBogota();
  const { data: citas, error } = await admin.from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, titulo, codigo_asesor')
    .eq('tipo_cita', 'inspeccion').neq('estado', 'cancelada').eq('fecha', ahora.fecha)
    .is('inspeccion_asesor_avisado_en', null).not('codigo_asesor', 'is', null).not('asesor_id', 'is', null);
  if (error) return json({ ok: false, error: 'No se pudieron leer las inspecciones.' }, 500);

  const candidatas = (citas || []).filter((c) => {
    const faltaMs = Date.parse(`${c.fecha}T${c.hora_inicio.slice(0, 5)}:00Z`) - ahora.pared;
    return faltaMs <= MINUTOS_ANTES * 60_000 && faltaMs >= -15 * 60_000;
  }).slice(0, 30);

  let enviados = 0;
  let omitidos = 0;
  // deno-lint-ignore no-explicit-any
  const cache = new Map<string, { config: Record<string, any> | null; password: string | null }>();
  for (const c of candidatas) {
    try {
      if (!cache.has(c.empresa_id)) {
        const { data: config } = await admin.from('agenda_configuracion')
          .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)')
          .eq('empresa_id', c.empresa_id).maybeSingle();
        const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: c.empresa_id });
        cache.set(c.empresa_id, { config, password: (password as string) || null });
      }
      const { config, password } = cache.get(c.empresa_id)!;
      if (!config?.correo_smtp_host || !config.correo_remitente_email || !password) { omitidos++; continue; }
      const { data: asesor } = await admin.from('agenda_asesores').select('nombre, correo').eq('id', c.asesor_id).maybeSingle();
      const real = String(asesor?.correo || '').split(/[;,\s]+/).find((x) => /\S+@\S+\.\S+/.test(x));
      if (!real) { omitidos++; continue; }
      const modoPruebas = config.correo_modo_pruebas !== false;
      const destino = modoPruebas ? config.correo_pruebas_destino || real : real;

      const { data: reservada } = await admin.from('agenda_citas').update({ inspeccion_asesor_avisado_en: new Date().toISOString() })
        .eq('id', c.id).is('inspeccion_asesor_avisado_en', null).select('id');
      if (!reservada?.length) { omitidos++; continue; }

      let lugar = '';
      let numero = '';
      if (c.inmueble_id) {
        const { data: inm } = await admin.from('agenda_inmuebles').select('numero_inmueble, direccion, barrio, ciudad').eq('id', c.inmueble_id).maybeSingle();
        numero = String(inm?.numero_inmueble ?? '');
        lugar = [inm?.direccion, inm?.barrio, inm?.ciudad].filter(Boolean).join(', ');
      }
      const marca = marcaCorreo(config);
      const asunto = `Tu código para la inspección de las ${horaTexto(c.hora_inicio.slice(0, 5))}${numero ? ` · Inmueble ${numero}` : ''}`;
      const html = correoBase(marca, {
        tema: 'arrendatario', modoPruebas, destinatarioReal: real,
        etiqueta: `Inspección de hoy${numero ? ` · Inmueble ${numero}` : ''} · Aviso al asesor`,
        motivo: 'Te escribimos porque tu inspección empieza en unos 30 minutos. Este aviso sale automáticamente.',
        titulo: 'Tu código para la inspección de hoy',
        cuerpo: `<p style="margin:0 0 12px">Hola${asesor?.nombre ? ' ' + esc(String(asesor.nombre).split(' ')[0]) : ''}. A las <b>${esc(horaTexto(c.hora_inicio.slice(0, 5)))}</b> tienes una inspección${c.titulo ? ` (${esc(c.titulo)})` : ''}${lugar ? ` en ${esc(lugar)}` : ''}.</p>
          <p style="margin:0 0 6px">Al llegar, antes de entrar, <b>dile este código al arrendatario</b>. Así comprueba que eres quien debe ser:</p>
          <div style="margin:10px 0 14px;padding:16px;border-radius:14px;background:#f4f6f8;text-align:center;font-size:44px;font-weight:700;letter-spacing:14px;padding-left:28px;color:${marca.principal}">${esc(c.codigo_asesor)}</div>
          <p style="margin:0 0 6px"><b>Después:</b> el arrendatario recibe por correo un código de llegada. Pídeselo y regístralo en la agenda. Al terminar, haz lo mismo con el código de salida.</p>
          <p style="margin:0;font-size:13px">No compartas este código con nadie más.</p>`,
        botones: [{ texto: 'Abrir la agenda', url: SITIO_URL, variante: 'principal' }],
      });
      const transporte = nodemailer.createTransport({ host: config.correo_smtp_host, port: config.correo_smtp_puerto || 587, secure: config.correo_smtp_seguridad === 'ssl', auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password } });
      const log = { empresa_id: c.empresa_id, cita_id: c.id, destinatario_tipo: 'asesor', destinatario_email: destino, asunto, modo_pruebas: modoPruebas };
      try {
        await transporte.sendMail({ from: `${config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas'} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html });
        await admin.from('agenda_correos_log').insert({ ...log, estado: 'enviado', detalle_error: null });
        enviados++;
        // Al arrendatario le llega por correo su código de llegada (para decírselo al asesor cuando lo vea en persona).
        await fetch(`${SUPABASE_URL}/functions/v1/avisar-inspeccion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
          body: JSON.stringify({ cita_id: c.id, momento: 'llegada' }),
        }).catch(() => {});
      } catch (e) {
        await admin.from('agenda_citas').update({ inspeccion_asesor_avisado_en: null }).eq('id', c.id);
        await admin.from('agenda_correos_log').insert({ ...log, estado: 'fallido', detalle_error: e instanceof Error ? e.message : String(e) });
        omitidos++;
      }
    } catch { omitidos++; }
  }
  return json({ ok: true, enviados, omitidos });
});
