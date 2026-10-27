// Única puerta del navegador hacia las funciones de soporte de la base (sql/022–025). Las pantallas no llaman a `supabase.rpc`
// directamente: así los nombres de las funciones y el manejo de errores viven en un solo lugar.
// Todos los métodos devuelven { data, error } con `error` ya en texto para el usuario (o null).
import { limpiarError } from './formato.js';

export function crearApiSoporte(supabase) {
  const rpc = async (nombre, params) => {
    const { data, error } = await supabase.rpc(nombre, params);
    return { data: error ? null : data, error: error ? limpiarError(error.message) : null };
  };
  return {
    crear: (empresaId, borrador, pagina) => rpc('agenda_ticket_crear', { p_empresa_id: empresaId, p_tipo: borrador.tipo, p_titulo: borrador.titulo, p_descripcion: borrador.descripcion, p_pagina: pagina || '' }),
    detalle: (id, como = null) => rpc('agenda_ticket_detalle', { p_id: id, p_como: como }),
    responder: (id, { texto = null, estado = null, como = null } = {}) => rpc('agenda_ticket_responder', { p_id: id, p_texto: texto, p_estado: estado, p_como: como }),
    calificar: (id, puntos, comentario = '') => rpc('agenda_ticket_calificar', { p_id: id, p_puntos: puntos, p_comentario: comentario }),
    gestionar: (id, cambios = {}) => rpc('agenda_ticket_gestionar', { p_id: id, p_estado: null, p_prioridad: null, p_asignacion: null, ...cambios }),
    agregarNota: (id, texto) => rpc('agenda_ticket_nota_agregar', { p_id: id, p_texto: texto }),
    metricas: (empresaId, dias = 30) => rpc('agenda_ticket_metricas', { p_empresa_id: empresaId, p_dias: dias }),
    // Solo soporte.
    empresas: () => rpc('agenda_soporte_empresas', {}),
    listaSoporte: ({ estado, empresaId, asignacion }) => rpc('agenda_soporte_tickets', { p_estado: estado, p_empresa_id: empresaId || null, p_asignacion: asignacion || null }),
    diagnostico: (empresaId) => rpc('agenda_soporte_diagnostico', { p_empresa_id: empresaId }),
    // Acceso de ayuda (administrador de la empresa).
    accesoEstado: (empresaId) => rpc('agenda_soporte_acceso_estado', { p_empresa_id: empresaId }),
    accesoOtorgar: (empresaId, horas) => rpc('agenda_soporte_acceso_otorgar', { p_empresa_id: empresaId, p_horas: horas }),
    accesoRevocar: (empresaId) => rpc('agenda_soporte_acceso_revocar', { p_empresa_id: empresaId }),
    // Correos: se disparan sin esperar y un fallo de correo nunca rompe la acción del usuario.
    avisar: (ticketId, evento) => { supabase.functions.invoke('avisar-ticket', { body: { ticket_id: ticketId, evento } }).catch(() => {}); },
    // Campana.
    mantenimiento: () => rpc('agenda_ticket_mantenimiento', {}),
    avisos: (limite = 30) => rpc('agenda_notificaciones_mias', { p_limite: limite }),
    marcarAvisos: ({ id = null, ticketId = null } = {}) => rpc('agenda_notificaciones_marcar', { p_id: id, p_ticket_id: ticketId }),
  };
}
