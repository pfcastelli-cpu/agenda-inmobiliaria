import { createClient } from '@supabase/supabase-js';

// Se captura el hash de la URL ANTES de crear el cliente, porque supabase-js
// (detectSessionInUrl) lo limpia apenas procesa un enlace de invitación o
// recuperación. Así podemos saber después, en la app, si este acceso vino
// de uno de esos enlaces (para mostrar la pantalla de "define tu contraseña").
const hashInicialCapturado = typeof window !== 'undefined' ? window.location.hash || '' : '';

export function esEnlaceDeInvitacionORecuperacion() {
  return /type=invite|type=recovery/.test(hashInicialCapturado);
}

const url = import.meta.env.VITE_SUPABASE_URL;
const clavePublicable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function hayConfiguracionSupabase() {
  return Boolean(url && clavePublicable);
}

export const supabase = hayConfiguracionSupabase()
  ? createClient(url, clavePublicable, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
