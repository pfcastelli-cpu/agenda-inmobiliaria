-- 048 · Confirmación de asistencia del arrendatario (visitas a inmuebles «Rentando»)
-- El arrendatario pulsa «Confirmo que estaré» en el correo o en su portal /arrendatario/. El token de la cita
-- (agenda_citas.token_arrendatario) es la credencial; no hace falta login.
--   * arrendatario_confirmado_en: cuándo confirmó (null = sin confirmar).
--   * arrendatario_recordado_en: cuándo se le mandó el recordatorio automático (evita duplicados).
--   * Si la visita cambia de fecha u hora, ambas marcas se limpian (la confirmación vieja ya no vale).
-- PENDIENTE de aplicar (con permiso de Felipe). Idempotente.
-- Orden de salida: 1) este SQL  2) funciones (ver docs/ESTADO-ACTUAL.md)  3) programar el recordatorio (bloque final).

alter table public.agenda_citas
  add column if not exists arrendatario_confirmado_en timestamptz,
  add column if not exists arrendatario_recordado_en timestamptz;

-- Una confirmación o recordatorio pertenece a una fecha y hora concretas: si la visita se mueve, se limpian.
create or replace function public.agenda_citas_limpiar_confirmacion()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.arrendatario_confirmado_en := null;
  new.arrendatario_recordado_en := null;
  return new;
end $$;

drop trigger if exists agenda_citas_limpiar_confirmacion on public.agenda_citas;
create trigger agenda_citas_limpiar_confirmacion
  before update of fecha, hora_inicio on public.agenda_citas
  for each row
  when (old.fecha is distinct from new.fecha or old.hora_inicio is distinct from new.hora_inicio)
  execute function public.agenda_citas_limpiar_confirmacion();

-- Confirmar por token (idempotente). Devuelve jsonb:
--   {"resultado":"confirmada"|"ya_confirmada","confirmado_en":...}  o  {"error":"..."}
create or replace function public.agenda_arrendatario_confirmar(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.agenda_citas; ahora timestamp; marca timestamptz;
begin
  if p_token is null then return jsonb_build_object('error','Este enlace no es válido.'); end if;
  select * into c from public.agenda_citas where token_arrendatario = p_token and tipo_cita = 'visita_cliente' for update;
  if not found then return jsonb_build_object('error','Este enlace no es válido o ya no está activo.'); end if;
  if c.estado = 'cancelada' then return jsonb_build_object('error','Esta visita fue cancelada, no necesitas confirmar.'); end if;
  if c.arrendatario_confirmado_en is not null then
    return jsonb_build_object('resultado','ya_confirmada','confirmado_en',c.arrendatario_confirmado_en);
  end if;
  ahora := now() at time zone 'America/Bogota';
  if c.fecha + c.hora_inicio <= ahora then return jsonb_build_object('error','Esta visita ya pasó.'); end if;
  marca := now();
  update public.agenda_citas set arrendatario_confirmado_en = marca where id = c.id;
  return jsonb_build_object('resultado','confirmada','confirmado_en',marca);
end $$;

-- Se llama desde el portal y el correo sin sesión (anon) con el token como credencial; nunca devuelve datos de la cita.
revoke all on function public.agenda_arrendatario_confirmar(uuid) from public;
grant execute on function public.agenda_arrendatario_confirmar(uuid) to anon, authenticated, service_role;
-- La función del trigger no se llama a mano.
revoke all on function public.agenda_citas_limpiar_confirmacion() from public;
grant execute on function public.agenda_citas_limpiar_confirmacion() to service_role;

-- Recordatorio automático (Edge Function `recordar-arrendatario`, pública con secreto, como enviar-encuestas-pendientes).
-- Requiere el secreto `cron_encuestas_secreto` en Vault y CRON_ENCUESTAS_SECRETO en las funciones (sql/018, paso 2).
-- Ejecutar DESPUÉS de aplicar este archivo y desplegar las funciones. Corre cada hora en punto:
-- select cron.schedule(
--   'recordar-arrendatario',
--   '5 * * * *',
--   $job$
--   select net.http_post(
--     url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/recordar-arrendatario',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')
--     ),
--     body := '{}'::jsonb
--   );
--   $job$
-- );
-- Para apagarlo: select cron.unschedule('recordar-arrendatario');
