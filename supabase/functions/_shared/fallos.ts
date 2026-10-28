// Solo metadatos técnicos controlados. No recibe mensajes, solicitudes, tokens ni contactos.
export async function registrarFallo(admin: any, datos: {
  empresaId: string; modulo: string; codigo: string; operacion?: string;
  nivel?: 'aviso' | 'error'; httpStatus?: number | null; esPrueba?: boolean;
}) {
  try {
    const { error } = await admin.rpc('agenda_fallo_registrar', {
      p_empresa_id: datos.empresaId, p_modulo: datos.modulo, p_codigo: datos.codigo,
      p_operacion: datos.operacion || '', p_nivel: datos.nivel || 'error',
      p_http_status: datos.httpStatus || null, p_es_prueba: datos.esPrueba === true,
    });
    if (error) console.warn('No se pudo registrar un fallo en soporte');
  } catch { console.warn('Registro de fallos temporalmente inaccesible'); }
}
