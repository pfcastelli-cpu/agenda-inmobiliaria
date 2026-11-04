-- 046 · Demanda sin tope: el tope de citas deja de bloquear la página pública por defecto
-- Contexto: antes, si se guardaba un «tope de citas activas», al llegar a ese número la reserva pública dejaba de dar horarios y ofrecía lista de
-- espera (sql/035). Decisión de Felipe: no se deja de atender clientes; si la demanda es muy alta se sube el precio. Ahora la demanda alta es solo
-- una SEÑAL de gestión (Informes → Alertas de demanda) y el bloqueo es una opción del administrador, APAGADA por defecto.
-- Cambios:
--   1) agenda_configuracion.demanda_bloquear_por_tope boolean not null default false (interruptor; Configuración → Demanda lo enciende).
--   2) agenda_inmueble_llena() solo responde true si el interruptor está encendido. La usan agenda_agenda_llena_publica (la página pública)
--      y agenda_agendar_cita_publica (sql/035), así que ambas respetan el interruptor sin tocarlas.
-- El tope guardado se conserva (sirve de referencia para las alertas). Es seguro repetirlo.
-- Dependencia: el front funciona sin este SQL, pero mientras no se aplique, cualquier tope guardado SIGUE bloqueando (regla vieja); la pantalla lo avisa.
-- Aplicar (con permiso de Felipe): npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/046-demanda-sin-tope.sql

alter table public.agenda_configuracion
  add column if not exists demanda_bloquear_por_tope boolean not null default false;

create or replace function public.agenda_inmueble_llena(p_inmueble_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(k.demanda_bloquear_por_tope, false)
     and coalesce(i.tope_citas_activas, k.demanda_tope_citas) is not null
     and (select count(*) from public.agenda_citas c
           where c.inmueble_id = i.id and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null and c.tipo_cita = 'visita_cliente'
             and c.fecha >= (now() at time zone 'America/Bogota')::date) >= coalesce(i.tope_citas_activas, k.demanda_tope_citas)
  from public.agenda_inmuebles i join public.agenda_configuracion k on k.empresa_id = i.empresa_id
  where i.id = p_inmueble_id;
$function$;
revoke all on function public.agenda_inmueble_llena(uuid) from public, anon;
grant execute on function public.agenda_inmueble_llena(uuid) to service_role, authenticated;
