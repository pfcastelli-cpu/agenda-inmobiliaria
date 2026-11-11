// Edge Function: enviar-informe-equipo
// La llama pg_cron cada día a las 7:00 (ver sql/067) con `x-cron-secreto`. verify_jwt = false.
// Para cada empresa con informe_auto_frecuencia = semanal (lunes) o mensual (día 1) manda un resumen corto por correo a
// informe_auto_destinatarios: citas del periodo, confirmaciones de clientes, solicitudes de propietarios y tickets abiertos.
// Solo cifras, sin datos de clientes. Respeta correo_modo_pruebas y registra en agenda_correos_log.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase, filaCorreo } from '../_shared/plantilla-correo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) return json({ ok: false, error: 'No autorizado.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const hoy = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 10);
  const diaSemana = new Date(hoy + 'T12:00:00Z').getUTCDay(); // 1 = lunes
  const diaMes = Number(hoy.slice(8, 10));

  const { data: empresas, error } = await admin
    .from('agenda_configuracion')
    .select('empresa_id, informe_auto_frecuencia, informe_auto_destinatarios, informe_auto_ultimo, correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, plantilla_enlace_inmueble, dominio_publico, contacto_empresa, correo_contacto, telefono, nombre_comercial, empresa:agenda_empresas(slug)')
    .in('informe_auto_frecuencia', ['semanal', 'mensual']);
  if (error) return json({ ok: false, error: 'No se pudo leer la configuración.' }, 500);

  let enviados = 0;
  for (const c of empresas || []) {
    const toca = (c.informe_auto_frecuencia === 'semanal' && diaSemana === 1) || (c.informe_auto_frecuencia === 'mensual' && diaMes === 1);
    if (!toca || c.informe_auto_ultimo === hoy) continue;
    const destinos = String(c.informe_auto_destinatarios || '').split(/[;,\s]+/).filter((x) => /\S+@\S+\.\S+/.test(x));
    if (!destinos.length || !c.correo_smtp_host || !c.correo_remitente_email) continue;
    const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: c.empresa_id });
    if (!password) continue;

    const dias = c.informe_auto_frecuencia === 'semanal' ? 7 : 30;
    const desde = new Date(Date.parse(hoy + 'T12:00:00Z') - dias * 86400000).toISOString().slice(0, 10);
    const cuenta = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const citasBase = () => admin.from('agenda_citas').select('id', { count: 'exact', head: true }).eq('empresa_id', c.empresa_id).eq('es_prueba', false).eq('tipo_cita', 'visita_cliente').gte('fecha', desde).lt('fecha', hoy);
    const [visitas, canceladas, confirmadas, solicPend, solicHechas, ticketsAbiertos] = await Promise.all([
      cuenta(citasBase().neq('estado', 'cancelada')),
      cuenta(citasBase().eq('estado', 'cancelada')),
      cuenta(citasBase().neq('estado', 'cancelada').not('cliente_confirmado_en', 'is', null)),
      cuenta(admin.from('agenda_solicitudes_propietario').select('id', { count: 'exact', head: true }).eq('empresa_id', c.empresa_id).eq('estado', 'pendiente')),
      cuenta(admin.from('agenda_solicitudes_propietario').select('id', { count: 'exact', head: true }).eq('empresa_id', c.empresa_id).eq('estado', 'hecha').gte('hecha_en', desde)),
      cuenta(admin.from('agenda_tickets').select('id', { count: 'exact', head: true }).eq('empresa_id', c.empresa_id).in('estado', ['abierto', 'en_revision', 'en_espera'])),
    ]);

    const marca = marcaCorreo(c);
    const modoPruebas = c.correo_modo_pruebas !== false;
    const asunto = `Resumen ${c.informe_auto_frecuencia === 'semanal' ? 'semanal' : 'mensual'} de la agenda`;
    const html = correoBase(marca, {
      titulo: asunto,
      tema: 'cambio',
      preheader: `${visitas} visitas en los últimos ${dias} días.`,
      cuerpo: `<p style="margin:0">Así le fue a la agenda del ${desde} al ${hoy}.</p><table style="width:100%;border-collapse:collapse;margin-top:16px">${filaCorreo(marca, 'Visitas de clientes', String(visitas))}${filaCorreo(marca, 'Confirmadas por el cliente', `${confirmadas} de ${visitas}`)}${filaCorreo(marca, 'Canceladas', String(canceladas))}${filaCorreo(marca, 'Solicitudes de propietarios pendientes', String(solicPend))}${filaCorreo(marca, 'Solicitudes resueltas en el periodo', String(solicHechas))}${filaCorreo(marca, 'Tickets de soporte abiertos', String(ticketsAbiertos))}</table><p style="margin:16px 0 0;font-size:13px;color:#63707a">Solo cifras, sin datos de clientes. Puedes cambiar la frecuencia o apagar este resumen en Configuración → Supervisión.</p>`,
      modoPruebas,
      destinatarioReal: destinos.join(', '),
    });
    const transporte = nodemailer.createTransport({
      host: c.correo_smtp_host, port: c.correo_smtp_puerto || 587, secure: c.correo_smtp_seguridad === 'ssl',
      auth: { user: c.correo_smtp_usuario || c.correo_remitente_email, pass: password as string },
    });
    const destino = modoPruebas ? c.correo_pruebas_destino || destinos[0] : destinos.join(', ');
    const log = { empresa_id: c.empresa_id, cita_id: null, destinatario_tipo: 'informe_equipo', destinatario_email: destino, asunto, modo_pruebas: modoPruebas };
    try {
      await transporte.sendMail({ from: `${c.correo_remitente_nombre || c.nombre_comercial || 'Agenda de citas'} <${c.correo_remitente_email}>`, to: destino, subject: asunto, html });
      await admin.from('agenda_correos_log').insert({ ...log, estado: 'enviado', detalle_error: null });
      await admin.from('agenda_configuracion').update({ informe_auto_ultimo: hoy }).eq('empresa_id', c.empresa_id);
      enviados++;
    } catch (e) {
      await admin.from('agenda_correos_log').insert({ ...log, estado: 'fallido', detalle_error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ ok: true, enviados });
});
