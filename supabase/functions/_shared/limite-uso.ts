// Límite de uso para funciones públicas. Usa la RPC agenda_limitar_uso (sql/087).
// Si la RPC falla o aún no existe, deja pasar (no tumbar el servicio por esto).
export function ipDe(req: Request): string {
  const h = req.headers;
  const ip = h.get('cf-connecting-ip') || h.get('x-nf-client-connection-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconocida';
  return ip.slice(0, 64);
}

// true = puede continuar; false = excedió el límite.
// deno-lint-ignore no-explicit-any
export async function permitirUso(admin: any, clave: string, max: number, ventanaSeg: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('agenda_limitar_uso', {
      p_clave: clave, p_max: max, p_ventana_seg: ventanaSeg,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
