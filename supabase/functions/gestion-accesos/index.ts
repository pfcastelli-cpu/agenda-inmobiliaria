// Edge Function: gestion-accesos
// Crea/gestiona el acceso (login) de miembros de una empresa, sin exponer
// la service_role key al navegador. Solo administradores de la empresa
// pueden usarla — se verifica con el JWT del que llama en cada acción.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
      if (!correo || !nombre || !ROLES_VALIDOS.includes(rol)) {
        return json({ ok: false, error: 'Falta el nombre, el correo, o el rol no es válido.' }, 400);
      }
      const { data: invitado, error: errorInvitar } = await admin.auth.admin.inviteUserByEmail(correo, {
        data: { nombre },
        redirectTo,
      });
      if (errorInvitar || !invitado?.user) {
        const msg = (errorInvitar?.message || '').toLowerCase().includes('already been registered')
          ? 'Ya existe un usuario con ese correo.'
          : 'No se pudo enviar la invitación: ' + (errorInvitar?.message || 'error desconocido.');
        return json({ ok: false, error: msg }, 400);
      }
      const { error: errorMiembro } = await admin.from('agenda_miembros').insert({
        empresa_id: empresaId,
        usuario_id: invitado.user.id,
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
      return json({ ok: true, usuario_id: invitado.user.id });
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
        .select('usuario_id')
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId)
        .maybeSingle();
      if (!destino) return json({ ok: false, error: 'Ese usuario no pertenece a tu empresa.' }, 403);
      const { data: u } = await admin.auth.admin.getUserById(usuarioId);
      if (!u?.user?.email) return json({ ok: false, error: 'No se encontró el correo de ese usuario.' }, 404);
      const { error: errorInvitar } = await admin.auth.admin.inviteUserByEmail(u.user.email, { redirectTo });
      if (errorInvitar) return json({ ok: false, error: 'No se pudo reenviar: ' + errorInvitar.message }, 400);
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
