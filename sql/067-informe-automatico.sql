-- 067 · Informe automático del equipo por correo (apagado por defecto). Idempotente; solo agrega columnas.
-- La administración lo enciende en Configuración → Supervisión: frecuencia (semanal los lunes / mensual el día 1) y destinatarios.
-- PENDIENTE de aplicar (con permiso de Felipe). Orden: 1) este SQL  2) desplegar enviar-informe-equipo (--no-verify-jwt)  3) cron (bloque final).
alter table public.agenda_configuracion
  add column if not exists informe_auto_frecuencia text not null default 'apagado',
  add column if not exists informe_auto_destinatarios text,
  add column if not exists informe_auto_ultimo date;
alter table public.agenda_configuracion drop constraint if exists agenda_configuracion_informe_auto_frecuencia_check;
alter table public.agenda_configuracion add constraint agenda_configuracion_informe_auto_frecuencia_check
  check (informe_auto_frecuencia in ('apagado', 'semanal', 'mensual'));

-- Corre todos los días a las 7:00 (hora de Colombia = 12:00 UTC); la función decide si hoy toca enviar:
-- select cron.schedule('informe-equipo', '0 12 * * *', $job$
--   select net.http_post(
--     url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/enviar-informe-equipo',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')),
--     body := '{}'::jsonb);
-- $job$);
-- Para apagarlo del todo: select cron.unschedule('informe-equipo');
