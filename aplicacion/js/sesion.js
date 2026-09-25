import { hayConfiguracionSupabase, supabase } from './cliente-supabase.js';

const MENSAJE_CONFIG =
  'Falta la configuración de Supabase. Copia el archivo .env.example a .env (junto a package.json) y vuelve a iniciar el servidor con npm run dev.';

export function obtenerMensajeConfiguracion() {
  return hayConfiguracionSupabase() ? null : MENSAJE_CONFIG;
}

function textoErrorAutenticacion(error) {
  const codigo = error?.code || '';
  const mensaje = (error?.message || '').toLowerCase();
  if (codigo === 'invalid_credentials' || mensaje.includes('invalid login')) {
    return 'No pudimos iniciar sesión. Revisa el correo y la contraseña.';
  }
  if (mensaje.includes('email not confirmed')) {
    return 'Esta cuenta todavía no está confirmada. Pide ayuda a quien administra el acceso.';
  }
  if (mensaje.includes('failed to fetch') || mensaje.includes('network')) {
    return 'No hay conexión con el servicio de acceso. Revisa internet e inténtalo de nuevo.';
  }
  return 'No se pudo completar el acceso. Inténtalo de nuevo.';
}

export async function consultarAccesoActual() {
  if (!supabase) {
    throw new Error(MENSAJE_CONFIG);
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    const sinSesion =
      error.name === 'AuthSessionMissingError' ||
      (error.message || '').toLowerCase().includes('session missing');
    if (sinSesion) {
      return { usuario: null, membresia: null };
    }
    throw new Error(textoErrorAutenticacion(error));
  }

  const usuario = data.user;
  if (!usuario) {
    return { usuario: null, membresia: null };
  }

  const { data: filas, error: errorMembresia } = await supabase
    .from('agenda_miembros')
    .select(
      'nombre, rol, activo, empresa_id, agenda_empresas ( id, nombre, slug, zona_horaria, color_principal, color_accion )',
    )
    .eq('usuario_id', usuario.id)
    .eq('activo', true)
    .limit(2);

  if (errorMembresia) {
    throw new Error('No se pudo leer tu membresía en la empresa. Inténtalo de nuevo.');
  }

  const fila = filas?.[0];
  if (!fila?.agenda_empresas) {
    return { usuario, membresia: null };
  }

  return {
    usuario,
    membresia: {
      nombre: fila.nombre,
      rol: fila.rol,
      empresa: fila.agenda_empresas,
    },
  };
}

export async function iniciarSesionConCorreo(correo, contrasena) {
  if (!supabase) {
    throw new Error(MENSAJE_CONFIG);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: correo.trim(),
    password: contrasena,
  });

  if (error) {
    throw new Error(textoErrorAutenticacion(error));
  }

  return consultarAccesoActual();
}

export async function cerrarSesion() {
  if (!supabase) {
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
  }
}

export async function solicitarRecuperacion(correo) {
  if (!supabase) {
    throw new Error(MENSAJE_CONFIG);
  }
  const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), {
    redirectTo: window.location.origin + '/',
  });
  if (error) {
    throw new Error('No se pudo enviar el correo de recuperación. Verifica el correo e inténtalo de nuevo.');
  }
}

export async function establecerNuevaContrasena(nuevaContrasena) {
  if (!supabase) {
    throw new Error(MENSAJE_CONFIG);
  }
  if (!nuevaContrasena || nuevaContrasena.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  const { error } = await supabase.auth.updateUser({ password: nuevaContrasena });
  if (error) {
    throw new Error('No se pudo guardar la nueva contraseña. Vuelve a intentarlo.');
  }
}

async function llamarGestionAccesos(accion, datos = {}) {
  if (!supabase) {
    throw new Error(MENSAJE_CONFIG);
  }
  const { data, error } = await supabase.functions.invoke('gestion-accesos', {
    body: { accion, ...datos },
  });
  if (error) {
    throw new Error('No se pudo conectar con el servicio de accesos. Inténtalo de nuevo.');
  }
  if (!data?.ok) {
    throw new Error(data?.error || 'No se pudo completar la operación.');
  }
  return data;
}

export function listarAccesos(empresaId) {
  return llamarGestionAccesos('listar', { empresa_id: empresaId });
}

export function crearAcceso(empresaId, { nombre, correo, rol }) {
  return llamarGestionAccesos('crear', {
    empresa_id: empresaId,
    nombre,
    correo,
    rol,
    redirect_to: window.location.origin + '/',
  });
}

export function cambiarPasswordDeUsuario(empresaId, usuarioId, password) {
  return llamarGestionAccesos('cambiar_password', { empresa_id: empresaId, usuario_id: usuarioId, password });
}

export function reenviarInvitacion(empresaId, usuarioId) {
  return llamarGestionAccesos('reenviar_invitacion', {
    empresa_id: empresaId,
    usuario_id: usuarioId,
    redirect_to: window.location.origin + '/',
  });
}

export function alternarActivoAcceso(empresaId, usuarioId, activo) {
  return llamarGestionAccesos('alternar_activo', { empresa_id: empresaId, usuario_id: usuarioId, activo });
}
