import { construirHtml, htmlAsesor, esc, cop, correoValido, type Aseguradora } from '../_shared/radicacion-correo.ts';
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
import { crearTransporte } from '../_shared/transporte-correo.ts';

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

async function log(admin: Admin, fila: Record<string, unknown>) {
  try { await admin.from('agenda_correos_log').insert(fila); } catch { /* sin registro no hay nada más que hacer */ }
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
    .select('id, empresa_id, tipo_cita, estado, cliente_nombre, cliente_email, cliente_telefono, token_cliente, asesor_id, radicacion_enviada_en').eq('id', citaId).maybeSingle();
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
  const transporte = crearTransporte({
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
  const aWa = (num: string | null | undefined) => { const dg = String(num || '').replace(/\D/g, ''); return dg.length === 10 && dg.startsWith('3') ? '57' + dg : dg.length >= 11 && dg.length <= 13 ? dg : ''; };
  const asesorWa = aWa(asesor?.celular);
  const clienteWa = aWa(cita.cliente_telefono);

  // Descuento por radicar pronto: la fecha límite parte del PRIMER envío (reenviar el correo no la reinicia), así lo prometido es verdad.
  const conDesc = ((d.aseguradoras || []) as Aseguradora[]).find((x) => Number(x.descuento_porcentaje) > 0);
  const limiteMs = conDesc ? new Date(cita.radicacion_enviada_en || Date.now()).getTime() + Number(conDesc.descuento_horas || 24) * 3600 * 1000 : 0;
  const limite = limiteMs > Date.now() ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(limiteMs)) : '';

  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const asunto = `Hoy no pagas nada: inicia tu estudio y asegura el inmueble Nº ${d.numero_inmueble}`;
  const destino = modoPruebas ? config.correo_pruebas_destino || para : para;
  let estado: 'enviado' | 'fallido' = 'enviado';
  let detalle: string | null = null;
  try {
    await transporte.sendMail({
      from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto,
      html: construirHtml(marca, d, { modoPruebas, real: para, paginaUrl, asesorWa, asesorNombreCita: asesor?.nombre || '', limite }),
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
          html: htmlAsesor(marca, d, { asesorNombre: asesor.nombre, clienteNombre: cita.cliente_nombre, clienteEmail: cita.cliente_email, clienteTel: cita.cliente_telefono, clienteWa, modoPruebas, real, limite }),
        });
      } catch (e) { estA = 'fallido'; detA = e instanceof Error ? e.message : String(e); }
      await log(admin, { empresa_id: cita.empresa_id, cita_id: cita.id, destinatario_tipo: 'interno', destinatario_email: destA, asunto: asuntoA, estado: estA, detalle_error: detA, modo_pruebas: modoPruebas });
    }
  }
  return json({ ok: true, enviado: true });
});
