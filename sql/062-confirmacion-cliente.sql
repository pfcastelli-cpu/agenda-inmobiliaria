-- 062 · Confirmación de asistencia del CLIENTE (quien visita el inmueble), un día antes.
-- Igual que el arrendatario (sql/048): el token de la cita (agenda_citas.token_cliente) es la credencial, sin login.
--   * cliente_confirmado_en: cuándo confirmó (null = sin confirmar por el cliente).
--   * cliente_recordado_en: cuándo se le mandó el recordatorio automático (evita duplicados).
--   * Si la visita cambia de fecha u hora, ambas marcas se limpian.
-- PENDIENTE de aplicar (con permiso de Felipe). Idempotente. Solo agrega; no borra ni cambia datos existentes.
-- Orden: 1) este SQL  2) desplegar recordar-cliente (--no-verify-jwt)  3) programar el cron (bloque final).

alter table public.agenda_citas
  add column if not exists cliente_confirmado_en timestamptz,
  add column if not exists cliente_recordado_en timestamptz;

-- Reemplaza la función del trigger de 048 para que limpie también las marcas del cliente.
create or replace function public.agenda_citas_limpiar_confirmacion()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.arrendatario_confirmado_en := null;
  new.arrendatario_recordado_en := null;
  new.cliente_confirmado_en := null;
  new.cliente_recordado_en := null;
  return new;
end $$;

create or replace function public.agenda_cliente_confirmar(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.agenda_citas; ahora timestamp; marca timestamptz;
begin
  if p_token is null then return jsonb_build_object('error','Este enlace no es válido.'); end if;
  select * into c from public.agenda_citas where token_cliente = p_token and tipo_cita = 'visita_cliente' for update;
  if not found then return jsonb_build_object('error','Este enlace no es válido o ya no está activo.'); end if;
  if c.estado = 'cancelada' then return jsonb_build_object('error','Esta visita fue cancelada, no necesitas confirmar.'); end if;
  if c.cliente_confirmado_en is not null then
    return jsonb_build_object('resultado','ya_confirmada','confirmado_en',c.cliente_confirmado_en);
  end if;
  ahora := now() at time zone 'America/Bogota';
  if c.fecha + c.hora_inicio <= ahora then return jsonb_build_object('error','Esta visita ya pasó.'); end if;
  marca := now();
  update public.agenda_citas set cliente_confirmado_en = marca where id = c.id;
  return jsonb_build_object('resultado','confirmada','confirmado_en',marca);
end $$;

revoke all on function public.agenda_cliente_confirmar(uuid) from public;
grant execute on function public.agenda_cliente_confirmar(uuid) to anon, authenticated, service_role;

-- Recordatorio automático (corre cada hora; la función recordar-cliente solo actúa sobre visitas de las próximas 24 h).
-- Ejecutar DESPUÉS de aplicar este archivo y desplegar la función:
-- select cron.schedule(
--   'recordar-cliente', '10 * * * *',
--   $job$
--   select net.http_post(
--     url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/recordar-cliente',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')),
--     body := '{}'::jsonb);
--   $job$);
-- Para apagarlo: select cron.unschedule('recordar-cliente');
