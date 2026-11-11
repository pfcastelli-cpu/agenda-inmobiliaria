// Edge Function: recordar-cliente
// La llama pg_cron cada hora (ver sql/062) con el encabezado `x-cron-secreto` (CRON_ENCUESTAS_SECRETO). verify_jwt = false.
// Un día antes, le manda al CLIENTE que va a visitar un inmueble un correo con el botón «Confirmo que asistiré».
// Cuando confirma, la agenda interna lo muestra («Confirmada por el cliente»); si no, queda «Sin confirmar por el cliente».
// Respeta correo_modo_pruebas, deja registro en agenda_correos_log y marca cliente_recordado_en para no repetir.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { botonConfirmarAsistencia, correoVisita } from '../_shared/visita-correo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';
const SITIO_URL = 'https://citas.patrimonios.co';
const MAX_POR_CORRIDA = 30;
const HORAS_ANTES = 24;
const HORAS_MINIMAS = 2;
const HORAS_DESDE_CREACION = 3; // no se recuerda una cita recién creada: ya recibió su confirmación

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function ahoraBogota() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' });
  return { fecha: s.slice(0, 10), pared: Date.parse(s.replace(' ', 'T') + 'Z') };
}
function mas(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function formatearFecha(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const ahora = ahoraBogota();

  const { data: citas, error } = await admin
    .from('agenda_citas')
    .select('id, empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, cliente_nombre, cliente_email, token_cliente, creado_en')
    .eq('tipo_cita', 'visita_cliente')
    .eq('estado', 'confirmada')
    .eq('es_prueba', false)
    .is('reubicacion_pendiente_desde', null)
    .is('cliente_confirmado_en', null)
    .is('cliente_recordado_en', null)
    .not('cliente_email', 'is', null)
    .not('token_cliente', 'is', null)
    .gte('fecha', ahora.fecha)
    .lte('fecha', mas(ahora.fecha, 1))
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });
  if (error) return json({ ok: false, error: 'No se pudieron leer las visitas.' }, 500);

  const candidatas = (citas || []).filter((c) => {
    const faltaMs = Date.parse(`${c.fecha}T${c.hora_inicio.slice(0, 5)}:00Z`) - ahora.pared;
    const desdeCreacion = Date.now() - new Date(c.creado_en).getTime();
    return faltaMs <= HORAS_ANTES * 3600_000 && faltaMs >= HORAS_MINIMAS * 3600_000 &&
      desdeCreacion >= HORAS_DESDE_CREACION * 3600_000 && /\S+@\S+\.\S+/.test(c.cliente_email || '');
  }).slice(0, MAX_POR_CORRIDA);

  let enviados = 0;
  let omitidos = 0;
  // deno-lint-ignore no-explicit-any
  const cacheEmpresa = new Map<string, { config: Record<string, any> | null; password: string | null }>();
  for (const c of candidatas) {
    try {
      if (!cacheEmpresa.has(c.empresa_id)) {
        const { data: config } = await admin
          .from('agenda_configuracion')
          .select('correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, plantilla_enlace_inmueble, dominio_publico, contacto_empresa, correo_contacto, telefono, nombre_comercial, empresa:agenda_empresas(slug)')
          .eq('empresa_id', c.empresa_id)
          .maybeSingle();
        const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: c.empresa_id });
        cacheEmpresa.set(c.empresa_id, { config, password: (password as string) || null });
      }
      const { config, password } = cacheEmpresa.get(c.empresa_id)!;
      if (!config?.correo_smtp_host || !config.correo_remitente_email || !password) { omitidos++; continue; }
      const modoPruebas = config.correo_modo_pruebas !== false;
      const destino = modoPruebas ? config.correo_pruebas_destino || c.cliente_email : c.cliente_email;

      // Se reserva la marca ANTES de enviar para que dos corridas seguidas no manden el correo dos veces.
      const { data: reservada } = await admin.from('agenda_citas').update({ cliente_recordado_en: new Date().toISOString() })
        .eq('id', c.id).is('cliente_recordado_en', null).is('cliente_confirmado_en', null).select('id');
      if (!reservada?.length) { omitidos++; continue; }

      let direccion = '';
      let numero = '';
      if (c.inmueble_id) {
        const { data: inm } = await admin.from('agenda_inmuebles').select('numero_inmueble, direccion, ciudad').eq('id', c.inmueble_id).maybeSingle();
        numero = String(inm?.numero_inmueble ?? '');
        direccion = [inm?.direccion, inm?.ciudad].filter(Boolean).join(', ');
      }
      const marca = marcaCorreo(config);
      const asunto = `Confirma tu visita${numero ? ` · Inmueble ${numero}` : ''}`;
      const html = correoVisita(marca, {
        tema: 'visita',
        titulo: 'Confirma tu visita',
        preheader: 'Cuéntanos si podrás asistir: toca el botón.',
        modoPruebas,
        destinatarioReal: c.cliente_email,
        cuerpo: `<p style="margin:0 0 12px">Hola${c.cliente_nombre ? ' ' + esc(String(c.cliente_nombre).split(' ')[0]) : ''}. Tienes una visita programada <b>${esc(formatearFecha(c.fecha))} a las ${esc(formatearHora(c.hora_inicio.slice(0, 5)))}</b>${direccion ? ` en ${esc(direccion)}` : ''}.</p>
          <p style="margin:0 0 12px">¿Podrás asistir? Confírmalo con un toque. Si no te queda bien, entra a tu visita y elige otro horario o cancélala: así el horario queda libre para otra persona.</p>`,
        despues: `${botonConfirmarAsistencia(`${SITIO_URL}/visita/${c.token_cliente}?accion=confirmar`, marca, 'Confirmo que asistiré')}
          <p style="font-size:13px;margin:12px 0 0"><a href="${SITIO_URL}/visita/${c.token_cliente}">Ver, cambiar o cancelar mi visita</a></p>`,
      });
      const transporte = nodemailer.createTransport({
        host: config.correo_smtp_host,
        port: config.correo_smtp_puerto || 587,
        secure: config.correo_smtp_seguridad === 'ssl',
        auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password },
      });
      const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
      const log = { empresa_id: c.empresa_id, cita_id: c.id, destinatario_tipo: 'cliente', destinatario_email: destino, asunto, modo_pruebas: modoPruebas };
      try {
        await transporte.sendMail({ from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html });
        await admin.from('agenda_correos_log').insert({ ...log, estado: 'enviado', detalle_error: null });
        enviados++;
      } catch (e) {
        await admin.from('agenda_citas').update({ cliente_recordado_en: null }).eq('id', c.id);
        await admin.from('agenda_correos_log').insert({ ...log, estado: 'fallido', detalle_error: e instanceof Error ? e.message : String(e) });
        omitidos++;
      }
    } catch (e) {
      console.error('recordar-cliente', c.id, e instanceof Error ? e.message : e);
      omitidos++;
    }
  }
  return json({ ok: true, enviados, omitidos });
});
