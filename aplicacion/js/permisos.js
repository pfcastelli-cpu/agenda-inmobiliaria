// Permisos de la persona que tiene la sesión abierta (Fase A: afinan lo que se ve en pantalla).
// El rol BASE (administrador / coordinador / asesor) sigue mandando para los datos y las políticas RLS no cambian.
// Si la consulta de permisos falla, se usa el comportamiento antiguo según el rol base: nadie se queda sin acceso por un error.
import { supabase } from './cliente-supabase.js';

const COORDINADOR = [
  'agenda.ver_propia', 'agenda.ver_todas', 'agenda.crear', 'agenda.modificar', 'agenda.cancelar', 'agenda.reubicar', 'agenda.actividades',
  'inmuebles.ver', 'inmuebles.editar', 'inmuebles.no_disponible', 'informes.ver', 'informes.exportar', 'informes.demanda',
  'bitacora.ver', 'pendientes.ver', 'pendientes.gestionar', 'captacion.ver', 'captacion.crear', 'soporte.crear', 'soporte.ver_empresa',
];
const ASESOR = [
  'agenda.ver_propia', 'agenda.crear', 'agenda.modificar', 'agenda.cancelar', 'agenda.actividades', 'inmuebles.ver',
  'pendientes.ver', 'captacion.ver', 'captacion.crear', 'soporte.crear',
];

let estado = { rolBase: null, permisos: null, esSuper: false, rolId: null, rolNombre: null };

export function limpiarPermisos() {
  estado = { rolBase: null, permisos: null, esSuper: false, rolId: null, rolNombre: null };
}

// Carga los permisos del rol de la persona. Nunca lanza error: ante cualquier fallo queda el comportamiento antiguo por rol base.
export async function cargarPermisos(empresaId, rolBase) {
  limpiarPermisos();
  estado.rolBase = rolBase || null;
  if (!supabase || !empresaId) return datosPermisos();
  try {
    const { data, error } = await supabase.rpc('agenda_mis_permisos', { p_empresa_id: empresaId });
    if (!error && data && Array.isArray(data.permisos)) {
      estado = {
        rolBase: data.base || rolBase || null,
        permisos: new Set(data.permisos),
        esSuper: data.es_super === true,
        rolId: data.rol_id || null,
        rolNombre: data.rol || null,
      };
    }
  } catch {
    /* sin permisos del servidor: se usa el rol base */
  }
  return datosPermisos();
}

export function datosPermisos() {
  return { rolId: estado.rolId, rolNombre: estado.rolNombre, esSuper: estado.esSuper, cargados: !!estado.permisos };
}

// ¿Puede hacer esto? El Superadministrador puede todo.
export function puede(clave) {
  if (estado.esSuper) return true;
  if (estado.permisos) return estado.permisos.has(clave);
  // Comportamiento antiguo por rol base.
  if (estado.rolBase === 'administrador') return !clave.startsWith('roles.');
  if (estado.rolBase === 'coordinador') return COORDINADOR.includes(clave);
  if (estado.rolBase === 'asesor') return ASESOR.includes(clave);
  return false;
}
