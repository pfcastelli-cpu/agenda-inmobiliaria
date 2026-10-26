// Edge Function: gestion-accesos
// Crea/gestiona el acceso (login) de miembros de una empresa, sin exponer
// la service_role key al navegador. Solo administradores de la empresa
// pueden usarla — se verifica con el JWT del que llama en cada acción.
//
// El correo con el enlace de un solo uso (invitación) NO lo manda el servicio de correo
// integrado de Supabase (límite de ~2 por hora y solo a miembros del equipo de Supabase):
// aquí se genera el enlace con admin.auth.admin.generateLink y se envía por el SMTP de la
// empresa (el mismo del correo de citas, contraseña en Vault), con su bitácora y modo de
// pruebas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encabezadoImagen, marcaCorreo } from '../_shared/marca-correo.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

const ROLES_VALIDOS = ['administrador', 'coordinador', 'asesor'];

function escaparHtml(valor: string | null | undefined): string {
  if (!valor) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Envía el correo con el enlace de un solo uso. Respeta el modo de pruebas de la empresa
// (va a correo_pruebas_destino con un aviso) y deja registro en agenda_correos_log
// (tipo 'interno'; detalle_error = 'acceso:<usuario>' en los envíos buenos, que sirve de
// marca para limitar los reintentos de "Olvidé mi contraseña").
async function enviarCorreoAcceso(
  admin: ReturnType<typeof createClient>,
  empresaId: string,
  o: { usuarioId: string; correo: string; nombre: string; asunto: string; titulo: string; texto: string; boton: string; enlace: string },
): Promise<{ enviado: boolean; motivo?: string }> {
  const { data: config } = await admin
    .from('agenda_configuracion')
    .select(
      'nombre_comercial, correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion',
    )
    .eq('empresa_id', empresaId)
    .maybeSingle();
  const marca = marcaCorreo(config);
  if (!config?.correo_smtp_host || !config.correo_remitente_email) {
    return { enviado: false, motivo: 'El correo de la empresa no está configurado (Administración → Correo).' };
  }
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
  if (!password) return { enviado: false, motivo: 'Falta guardar la contraseña SMTP del correo de la empresa.' };

  const modoPruebas = config.correo_modo_pruebas !== false;
  const destino = modoPruebas ? config.correo_pruebas_destino || o.correo : o.correo;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Patrimonios Inmobiliarios';
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Poppins,Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
  ${
    modoPruebas
      ? `<div style="background:#FEF3C7;color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600">MODO DE PRUEBAS — este correo iba dirigido en realidad a: ${escaparHtml(o.correo)}</div>`
      : ''
  }
  <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
    ${encabezadoImagen(marca, `${escaparHtml(remitente)}`, 'ninguna')}
    <div style="padding:28px 26px 26px;text-align:center">
      <h1 style="color:${marca.principal};font-size:26px;line-height:1.25;font-family:Poppins,Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-.01em;margin:0 0 8px">${escaparHtml(o.titulo)}</h1>
      <p style="color:#4d4d4d;text-align:justify;font-size:15px;line-height:1.65;margin:0 0 22px">Hola ${escaparHtml(o.nombre)}, ${escaparHtml(o.texto)}</p>
      <a href="${escaparHtml(o.enlace)}" style="display:inline-block;background:${marca.principal};color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:16px 30px;border-radius:999px">${escaparHtml(o.boton)}</a>
      <p style="color:#4d4d4d;text-align:justify;font-size:12.5px;margin:22px 0 0">El enlace es de un solo uso. Si no lo pediste, ignora este correo.</p>
    </div>
  </div>
  <p style="text-align:center;color:#6b6b6b;font-size:11.5px;margin-top:18px">${escaparHtml(remitente)}</p>
</div>
</body>
</html>`;

  const registrar = (estado: 'enviado' | 'fallido', detalle: string | null) =>
    admin.from('agenda_correos_log').insert({
      empresa_id: empresaId,
      cita_id: null,
      destinatario_tipo: 'interno',
      destinatario_email: destino,
      asunto: o.asunto,
      estado,
      detalle_error: detalle,
      modo_pruebas: modoPruebas,
    });

  try {
    const transporte = nodemailer.createTransport({
      host: config.correo_smtp_host,
      port: config.correo_smtp_puerto || 587,
      secure: config.correo_smtp_seguridad === 'ssl',
      auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
    });
    await transporte.sendMail({
      from: `${remitente} <${config.correo_remitente_email}>`,
      to: destino,
      subject: o.asunto,
      html,
    });
    await registrar('enviado', 'acceso:' + o.usuarioId);
    return { enviado: true };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    try {
      await registrar('fallido', detalle);
    } catch {
      // sin más
    }
    return { enviado: false, motivo: 'Falló el envío del correo: ' + detalle };
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

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!jwt) return json({ ok: false, error: 'Falta autenticación.' }, 401);

  const empresaId = String(body.empresa_id || '');
  if (!empresaId) return json({ ok: false, error: 'Falta empresa_id.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Quién llama, y si es administrador activo de esta empresa.
  const { data: quienLlama, error: errorQuienLlama } = await admin.auth.getUser(jwt);
  if (errorQuienLlama || !quienLlama?.user) {
    return json({ ok: false, error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' }, 401);
  }
  const { data: miembroLlamando } = await admin
    .from('agenda_miembros')
    .select('rol, activo')
    .eq('empresa_id', empresaId)
    .eq('usuario_id', quienLlama.user.id)
    .maybeSingle();
  if (!miembroLlamando || !miembroLlamando.activo || miembroLlamando.rol !== 'administrador') {
    return json({ ok: false, error: 'No tienes permisos de administrador en esta empresa.' }, 403);
  }

  const accion = String(body.accion || '');

  try {
    if (accion === 'listar') {
      const { data: miembros, error } = await admin
        .from('agenda_miembros')
        .select('usuario_id, nombre, rol, activo, creado_en')
        .eq('empresa_id', empresaId)
        .order('creado_en', { ascending: true });
      if (error) return json({ ok: false, error: 'No se pudieron leer los accesos.' }, 500);
      const conCorreo = await Promise.all(
        (miembros || []).map(async (m) => {
          const { data: u } = await admin.auth.admin.getUserById(m.usuario_id);
          return {
            usuario_id: m.usuario_id,
            nombre: m.nombre,
            rol: m.rol,
            activo: m.activo,
            correo: u?.user?.email || '(correo no disponible)',
            ultimo_acceso: u?.user?.last_sign_in_at || null,
            invitado_en: u?.user?.invited_at || u?.user?.created_at || null,
          };
        }),
      );
      return json({ ok: true, miembros: conCorreo });
    }

    if (accion === 'crear') {
      const correo = String(body.correo || '').trim().toLowerCase();
      const nombre = String(body.nombre || '').trim();
      const rol = String(body.rol || '');
      const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
      const password = body.password ? String(body.password) : '';
      let asesorId = body.asesor_id ? String(body.asesor_id) : '';
      if (!correo || !nombre || !ROLES_VALIDOS.includes(rol)) {
        return json({ ok: false, error: 'Falta el nombre, el correo, o el rol no es válido.' }, 400);
      }
      if (password && password.length < 8) {
        return json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
      }

      // Si se va a vincular con una ficha de Equipo, validamos antes de crear
      // nada: que exista, que sea de esta empresa, y que no tenga ya un acceso.
      if (asesorId) {
        const { data: ficha, error: errorFicha } = await admin
          .from('agenda_asesores')
          .select('id, usuario_id')
          .eq('id', asesorId)
          .eq('empresa_id', empresaId)
          .maybeSingle();
        if (errorFicha || !ficha) {
          return json({ ok: false, error: 'Esa ficha de asesor no existe en tu empresa.' }, 404);
        }
        if (ficha.usuario_id) {
          return json({ ok: false, error: 'Esa ficha ya tiene un acceso vinculado.' }, 400);
        }
      }

      // Si no se indicó ficha pero ya existe una ficha de Equipo con este mismo correo y sin
      // acceso, se vinculan solas: es la misma persona.
      if (!asesorId) {
        const { data: fichaIgual } = await admin
          .from('agenda_asesores')
          .select('id')
          .eq('empresa_id', empresaId)
          .eq('correo', correo)
          .is('usuario_id', null)
          .limit(1)
          .maybeSingle();
        if (fichaIgual) asesorId = fichaIgual.id;
      }

      let usuarioId: string;
      let enlaceInvitacion = '';
      if (password) {
        // El administrador pone la contraseña directamente: se crea ya
        // confirmado (nadie necesita hacer clic en ningún correo) y el
        // administrador es quien le pasa la contraseña al asesor.
        const { data: creado, error: errorCrear } = await admin.auth.admin.createUser({
          email: correo,
          password,
          email_confirm: true,
          user_metadata: { nombre },
        });
        if (errorCrear || !creado?.user) {
          const msg = (errorCrear?.message || '').toLowerCase().includes('already been registered')
            ? 'Ya existe un usuario con ese correo.'
            : 'No se pudo crear el usuario: ' + (errorCrear?.message || 'error desconocido.');
          return json({ ok: false, error: msg }, 400);
        }
        usuarioId = creado.user.id;
      } else {
        // Se genera una invitación (enlace de un solo uso para elegir su propia contraseña);
        // el correo lo enviamos nosotros más abajo, por el SMTP de la empresa.
        const { data: invitado, error: errorInvitar } = await admin.auth.admin.generateLink({
          type: 'invite',
          email: correo,
          options: { data: { nombre }, redirectTo },
        });
        if (errorInvitar || !invitado?.user || !invitado.properties?.action_link) {
          const msg = (errorInvitar?.message || '').toLowerCase().includes('already been registered')
            ? 'Ya existe un usuario con ese correo.'
            : 'No se pudo crear la invitación: ' + (errorInvitar?.message || 'error desconocido.');
          return json({ ok: false, error: msg }, 400);
        }
        usuarioId = invitado.user.id;
        enlaceInvitacion = invitado.properties.action_link;
      }

      const { error: errorMiembro } = await admin.from('agenda_miembros').insert({
        empresa_id: empresaId,
        usuario_id: usuarioId,
        nombre,
        rol,
        activo: true,
      });
      if (errorMiembro) {
        return json({
          ok: false,
          error: 'Se creó el usuario pero no se pudo vincular a tu empresa: ' + errorMiembro.message,
        }, 500);
      }

      if (asesorId) {
        // No bloqueamos la respuesta por esto: el acceso ya quedó creado y es
        // lo importante. Si el vínculo falla, el admin puede repetir la
        // operación o vincularlo luego manualmente en la base de datos.
        await admin.from('agenda_asesores').update({ usuario_id: usuarioId }).eq('id', asesorId).eq('empresa_id', empresaId);
      }

      if (enlaceInvitacion) {
        const envio = await enviarCorreoAcceso(admin, empresaId, {
          usuarioId,
          correo,
          nombre,
          asunto: 'Te dieron acceso a la agenda de citas',
          titulo: 'Crea tu contraseña',
          texto: 'te dieron acceso a la agenda de citas. Pulsa el botón para elegir tu contraseña y entrar.',
          boton: 'Crear mi contraseña',
          enlace: enlaceInvitacion,
        });
        if (!envio.enviado) {
          return json({
            ok: true,
            usuario_id: usuarioId,
            correo_enviado: false,
            aviso: 'El acceso quedó creado, pero el correo de invitación no salió. ' + (envio.motivo || '') + ' Usa "Reenviar invitación" o ponle una contraseña directa.',
          });
        }
      }

      return json({ ok: true, usuario_id: usuarioId, correo_enviado: Boolean(enlaceInvitacion) });
    }

    if (accion === 'vincular_asesor') {
      const usuarioId = String(body.usuario_id || '');
      const asesorId = String(body.asesor_id || '');
      if (!usuarioId || !asesorId) return json({ ok: false, error: 'Falta el usuario o la ficha.' }, 400);
      const { data: miembro } = await admin
        .from('agenda_miembros')
        .select('usuario_id')
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId)
        .maybeSingle();
      if (!miembro) return json({ ok: false, error: 'Ese usuario no pertenece a tu empresa.' }, 403);
      const { data: ficha } = await admin
        .from('agenda_asesores')
        .select('id, usuario_id')
        .eq('id', asesorId)
        .eq('empresa_id', empresaId)
        .maybeSingle();
      if (!ficha) return json({ ok: false, error: 'Esa ficha de asesor no existe en tu empresa.' }, 404);
      if (ficha.usuario_id && ficha.usuario_id !== usuarioId) {
        return json({ ok: false, error: 'Esa ficha ya está vinculada a otro acceso.' }, 400);
      }
      const { error: errorVinculo } = await admin
        .from('agenda_asesores')
        .update({ usuario_id: usuarioId })
        .eq('id', asesorId)
        .eq('empresa_id', empresaId);
      if (errorVinculo) {
        const msg = errorVinculo.code === '23505' ? 'Ese acceso ya está vinculado a otra ficha de asesor.' : 'No se pudo vincular: ' + errorVinculo.message;
        return json({ ok: false, error: msg }, 400);
      }
      return json({ ok: true });
    }

    if (accion === 'cambiar_password') {
      const usuarioId = String(body.usuario_id || '');
      const password = String(body.password || '');
      if (!usuarioId || password.length < 8) {
        return json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
      }
      const { data: destino } = await admin
        .from('agenda_miembros')
        .select('usuario_id')
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId)
        .maybeSingle();
      if (!destino) return json({ ok: false, error: 'Ese usuario no pertenece a tu empresa.' }, 403);
      const { error: errorUpdate } = await admin.auth.admin.updateUserById(usuarioId, { password });
      if (errorUpdate) return json({ ok: false, error: 'No se pudo cambiar la contraseña: ' + errorUpdate.message }, 400);
      return json({ ok: true });
    }

    if (accion === 'reenviar_invitacion') {
      const usuarioId = String(body.usuario_id || '');
      const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
      const { data: destino } = await admin
        .from('agenda_miembros')
        .select('usuario_id, nombre')
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId)
        .maybeSingle();
      if (!destino) return json({ ok: false, error: 'Ese usuario no pertenece a tu empresa.' }, 403);
      const { data: u } = await admin.auth.admin.getUserById(usuarioId);
      if (!u?.user?.email) return json({ ok: false, error: 'No se encontró el correo de ese usuario.' }, 404);

      // Si todavía no aceptó la invitación se genera una invitación; si ya tiene cuenta
      // activa, el mismo botón le permite restablecer su contraseña.
      let enlace = '';
      let esRecuperacion = false;
      const invitacion = await admin.auth.admin.generateLink({ type: 'invite', email: u.user.email, options: { redirectTo } });
      if (invitacion.data?.properties?.action_link) {
        enlace = invitacion.data.properties.action_link;
      } else {
        const recuperacion = await admin.auth.admin.generateLink({ type: 'recovery', email: u.user.email, options: { redirectTo } });
        if (!recuperacion.data?.properties?.action_link) {
          return json({ ok: false, error: 'No se pudo generar el enlace: ' + (recuperacion.error?.message || 'error desconocido.') }, 400);
        }
        enlace = recuperacion.data.properties.action_link;
        esRecuperacion = true;
      }
      const envio = await enviarCorreoAcceso(admin, empresaId, {
        usuarioId,
        correo: u.user.email,
        nombre: destino.nombre || '',
        asunto: esRecuperacion ? 'Restablece tu contraseña' : 'Te dieron acceso a la agenda de citas',
        titulo: esRecuperacion ? 'Restablece tu contraseña' : 'Crea tu contraseña',
        texto: esRecuperacion
          ? 'pulsa el botón para elegir una contraseña nueva.'
          : 'te dieron acceso a la agenda de citas. Pulsa el botón para elegir tu contraseña y entrar.',
        boton: esRecuperacion ? 'Elegir contraseña nueva' : 'Crear mi contraseña',
        enlace,
      });
      if (!envio.enviado) return json({ ok: false, error: envio.motivo || 'No se pudo enviar el correo.' }, 502);
      return json({ ok: true });
    }

    if (accion === 'alternar_activo') {
      const usuarioId = String(body.usuario_id || '');
      const activo = Boolean(body.activo);
      if (!usuarioId) return json({ ok: false, error: 'Falta el usuario.' }, 400);
      if (usuarioId === quienLlama.user.id && !activo) {
        return json({ ok: false, error: 'No puedes desactivar tu propio acceso.' }, 400);
      }
      const { error: errorUpdate } = await admin
        .from('agenda_miembros')
        .update({ activo })
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId);
      if (errorUpdate) return json({ ok: false, error: 'No se pudo actualizar: ' + errorUpdate.message }, 500);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Acción no reconocida.' }, 400);
  } catch (e) {
    return json({ ok: false, error: 'Error interno: ' + (e instanceof Error ? e.message : String(e)) }, 500);
  }
});
