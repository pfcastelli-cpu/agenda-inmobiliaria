import { createClient } from '@supabase/supabase-js';

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
