// Preferencias de correo del propietario (sql/032): con cada visita, resumen semanal/mensual o ninguno, y si acepta publicidad.
// Las funciones que escriben a propietarios llaman a preferenciasDe() y respetan el resultado. Si la tabla aún no existe o falla la
// consulta, devuelve un mapa vacío y todo se comporta como antes (se envía como siempre): nunca bloquea un correo por error técnico.
import type { createClient } from 'jsr:@supabase/supabase-js@2';

type Admin = ReturnType<typeof createClient>;
export type PreferenciaPropietario = { frecuencia: 'cada_cita' | 'semanal' | 'mensual' | 'ninguna'; publicidad: boolean; token: string; avisar_nueva: boolean; avisar_cambio: boolean; avisar_cancelacion: boolean };

// Crea la preferencia (con valores por defecto) de los correos que aún no la tienen y devuelve todas, por correo en minúsculas.
export async function preferenciasDe(admin: Admin, empresaId: string, correos: string[]): Promise<Map<string, PreferenciaPropietario>> {
  const mapa = new Map<string, PreferenciaPropietario>();
  const emails = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return mapa;
  try {
    await admin.from('agenda_propietario_preferencias').upsert(
      emails.map((email) => ({ empresa_id: empresaId, email })),
      { onConflict: 'empresa_id,email', ignoreDuplicates: true },
    );
    // Los tres avisos (sql/074) se piden aparte: si la columna aún no existe, todo se comporta como antes (se avisa de todo).
    const { data } = await admin.from('agenda_propietario_preferencias').select('email, frecuencia, publicidad, token').eq('empresa_id', empresaId).in('email', emails);
    const { data: avisos } = await admin.from('agenda_propietario_preferencias').select('email, avisar_nueva, avisar_cambio, avisar_cancelacion').eq('empresa_id', empresaId).in('email', emails);
    const porEmail = new Map((avisos ?? []).map((a: { email: string }) => [a.email, a]));
    for (const f of data ?? []) {
      const a = porEmail.get(f.email) as { avisar_nueva?: boolean; avisar_cambio?: boolean; avisar_cancelacion?: boolean } | undefined;
      mapa.set(f.email, { frecuencia: f.frecuencia, publicidad: f.publicidad !== false, token: f.token, avisar_nueva: a?.avisar_nueva !== false, avisar_cambio: a?.avisar_cambio !== false, avisar_cancelacion: a?.avisar_cancelacion !== false });
    }
  } catch (e) {
    console.error('preferencias-propietario:', e instanceof Error ? e.message : e);
  }
  return mapa;
}

// deno-lint-ignore no-explicit-any
export function urlPreferencias(config: any, token: string): string {
  const dominio = String(config?.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  return `https://${dominio}/preferencias/${token}`;
}
