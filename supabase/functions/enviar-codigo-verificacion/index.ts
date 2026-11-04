// Edge Function: enviar-codigo-verificacion
// Genera (vía agenda_generar_codigo_verificacion, que solo guarda el hash) y
// envía por correo —a través de la API de Resend, para entrega rápida— un
// código de 6 dígitos para confirmar que el correo que escribió un cliente
// en el formulario público de reservas es real, antes de dejarlo agendar
// una cita. No se llama para todos los correos: el frontend primero
// pregunta con agenda_correo_requiere_verificacion si hace falta (se salta
// si ese correo ya tiene una cita registrada antes con esta empresa).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase } from '../_shared/plantilla-correo.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Dirección verificada en Resend para este flujo. Es distinta del correo que
// sigue usando Gmail SMTP (info@patrimonios.co) para las demás
// notificaciones: así no se mezcla reputación de envío ni depende de Gmail
// justo en la ruta donde la velocidad de entrega sí importa.
const REMITENTE_RESEND = 'verificacion@mail.patrimonios.co';

// Mismo encabezado de marca que usa enviar-correo-cita, para que todos los
// correos del flujo de reservas se vean consistentes.
const IMAGEN_ENCABEZADO = 'https://adminpaxzu.patrimonios.co/uploads/images/Cita.jpg';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function escaparHtml(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function registrarLog(
  admin: ReturnType<typeof createClient>,
  fila: {
    empresa_id: string;
    destinatario_email: string | null;
    asunto: string | null;
    estado: 'enviado' | 'fallido' | 'omitido';
    detalle_error?: string | null;
    modo_pruebas: boolean;
  },
) {
  try {
    await admin.from('agenda_correos_log').insert({
      empresa_id: fila.empresa_id,
      cita_id: null,
      destinatario_tipo: 'verificacion',
      destinatario_email: fila.destinatario_email,
      asunto: fila.asunto,
      estado: fila.estado,
      detalle_error: fila.detalle_error ?? null,
      modo_pruebas: fila.modo_pruebas,
    });
  } catch {
    // Si ni el registro del intento se puede guardar, no hay nada más que hacer aquí.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }

  const email = String(body.email || '').trim();
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    return json({ ok: false, error: 'Correo electrónico inválido.' }, 400);
  }
  const host = body.host ? String(body.host) : null;
  const empresaSlug = body.empresa_slug ? String(body.empresa_slug) : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: empresaId, error: errorEmpresa } = await admin.rpc('agenda_resolver_empresa_publica', {
    p_empresa_slug: empresaSlug,
    p_host: host,
  });
  if (errorEmpresa || !empresaId) {
    return json({ ok: false, error: 'No se pudo identificar la empresa.' }, 400);
  }

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select('correo_remitente_nombre, correo_modo_pruebas, correo_pruebas_destino, nombre_comercial, logo_url, imagen_correo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', empresaId)
    .maybeSingle();

  const modoPruebas = config?.correo_modo_pruebas !== false;

  // Generamos y guardamos el código (hasheado) incluso si el correo todavía
  // no está configurado, para que el límite de "máximo 3 por 15 minutos" siga
  // contando igual — pero si no hay cómo enviarlo, lo decimos claramente.
  let codigo: string;
  try {
    const { data, error } = await admin.rpc('agenda_generar_codigo_verificacion', {
      p_empresa_id: empresaId,
      p_email: email,
    });
    if (error) throw error;
    codigo = data as string;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: mensaje || 'No se pudo generar el código.' }, 429);
  }

  if (!RESEND_API_KEY) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: email,
      asunto: null,
      estado: 'omitido',
      detalle_error: 'Falta configurar el secreto RESEND_API_KEY.',
      modo_pruebas: modoPruebas,
    });
    return json({ ok: false, error: 'El envío de correos no está configurado todavía.' }, 503);
  }

  const destinatarioReal = email;
  const asunto = `${codigo} es tu código para confirmar tu correo`;
  const destinatarioEnvio = modoPruebas ? String(config?.correo_pruebas_destino || '').trim() : destinatarioReal;
  if (modoPruebas && !destinatarioEnvio) {
    await registrarLog(admin, { empresa_id: empresaId, destinatario_email: null, asunto, estado: 'omitido', detalle_error: 'Modo de pruebas activo pero falta correo_pruebas_destino.', modo_pruebas: true });
    return json({ ok: false, error: 'El modo de pruebas está activo, pero falta configurar el destinatario de pruebas.' }, 503);
  }
  const nombreRemitente = config?.correo_remitente_nombre || 'Patrimonios Inmobiliarios';
  const marca = marcaCorreo(config);
  const html = correoBase(marca, { titulo: 'Confirma que este correo es tuyo', tema: 'hogar', modoPruebas, destinatarioReal, cuerpo: `<p>Usa este código para terminar de agendar tu visita. Vence en 10 minutos.</p><div style="margin:22px 0;text-align:center"><span style="display:inline-block;background:#f4f6f8;border:1px solid #e6eaee;border-radius:14px;padding:14px;font-family:'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:5px;color:${marca.principal}">${escaparHtml(codigo)}</span></div><p style="color:#8492a6;font-size:12.5px">Si tú no pediste este código, puedes ignorarlo.</p>` });

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${nombreRemitente} <${REMITENTE_RESEND}>`,
        to: destinatarioEnvio,
        subject: asunto,
        html,
      }),
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      throw new Error(`Resend respondió ${resp.status}: ${detalle.slice(0, 300)}`);
    }

    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'enviado',
      modo_pruebas: modoPruebas,
    });

    return json({ ok: true, enviado: true });
  } catch (e) {
    await registrarLog(admin, {
      empresa_id: empresaId,
      destinatario_email: destinatarioEnvio,
      asunto,
      estado: 'fallido',
      detalle_error: e instanceof Error ? e.message : String(e),
      modo_pruebas: modoPruebas,
    });
    return json({ ok: false, error: 'Falló el envío del correo. Intenta de nuevo.' }, 502);
  }
});
