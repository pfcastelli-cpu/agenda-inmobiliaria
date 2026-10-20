-- 006 · Correos adicionales por asesor + enlaces de calendario (suscripción ICS)
-- Ya aplicado en producción (20-oct-2026). Todo es aditivo: no cambia ni borra nada existente.

-- Correos adicionales (texto separado por "; "). No afecta el correo de login.
alter table public.agenda_asesores add column if not exists correos_adicionales text;

-- Token secreto por asesor (su agenda personal) y por empresa (agenda compartida de todos).
-- El enlace .ics lleva este token; quien lo tenga puede ver la agenda, así que se puede
-- regenerar desde Administración → Calendario para invalidar el enlace anterior.
alter table public.agenda_asesores
  add column if not exists calendario_token text unique default encode(extensions.gen_random_bytes(16), 'hex');
alter table public.agenda_configuracion
  add column if not exists calendario_token text unique default encode(extensions.gen_random_bytes(16), 'hex');
