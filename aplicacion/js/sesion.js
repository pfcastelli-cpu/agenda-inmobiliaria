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
