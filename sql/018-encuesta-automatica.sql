-- 018 · Encuesta al cliente enviada sola N minutos después de la visita (configurable por empresa)
-- Antes la encuesta salía al instante, cuando el asesor marcaba «Realizada». Ahora una tarea programada
-- (pg_cron cada 10 minutos) llama a la Edge Function `enviar-encuestas-pendientes`, que manda la encuesta de las
-- visitas cuya hora de fin + N minutos ya pasó (solo visitas de hoy y de ayer, una sola vez por visita).
-- PENDIENTE de aplicar (Felipe debe autorizarlo). Pasos, en este orden:
--   1) Aplicar este archivo.
--   2) Crear el secreto compartido (NO va en el repo): generar un valor aleatorio y guardarlo en DOS sitios con el mismo valor:
--        - Supabase Vault:   select vault.create_secret('<valor>', 'cron_encuestas_secreto');
--        - Secreto de la función:  npx supabase secrets set CRON_ENCUESTAS_SECRETO=<valor> --project-ref ykiuuxludyonkhywtmgu
--   3) Desplegar la función:  npx --no-install supabase functions deploy enviar-encuestas-pendientes --project-ref ykiuuxludyonkhywtmgu --use-api --no-verify-jwt
--   4) Programar la tarea (último bloque de este archivo).
-- Para apagar el envío automático de todas las empresas: select cron.unschedule('encuestas-pendientes');

alter table public.agenda_configuracion
  add column if not exists encuesta_automatica boolean not null default true,
  add column if not exists encuesta_minutos_despues integer not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.agenda_configuracion'::regclass and conname = 'agenda_encuesta_minutos_rango') then
    alter table public.agenda_configuracion
      add constraint agenda_encuesta_minutos_rango check (encuesta_minutos_despues between 0 and 1440);
  end if;
end $$;

-- Avisos por correo cuando se responde la encuesta (Edge Function `avisar-encuesta-respondida`):
--   encuesta_aviso_admin: 'cada' (por defecto: un correo por cada encuesta contestada), 'semanal' (resumen de 7 días) o 'ninguna'.
--   encuesta_aviso_correos: destinatarios opcionales (separados por ; o ,); vacío = los administradores activos.
-- Además, SIEMPRE se avisa al asesor de la visita cuando el cliente quiere avanzar, una segunda visita o que lo contacten.
alter table public.agenda_configuracion
  add column if not exists encuesta_aviso_admin text not null default 'cada',
  add column if not exists encuesta_aviso_correos text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.agenda_configuracion'::regclass and conname = 'agenda_encuesta_aviso_admin_valor') then
    alter table public.agenda_configuracion
      add constraint agenda_encuesta_aviso_admin_valor check (encuesta_aviso_admin in ('cada', 'semanal', 'ninguna'));
  end if;
end $$;
-- Marcas para que cada aviso salga una sola vez por encuesta.
alter table public.agenda_encuestas_cliente
  add column if not exists aviso_admin_en timestamptz,
  add column if not exists aviso_asesor_en timestamptz;
-- Las encuestas que ya estaban contestadas antes de esta migración no deben disparar avisos viejos.
update public.agenda_encuestas_cliente
   set aviso_admin_en = coalesce(aviso_admin_en, now()), aviso_asesor_en = coalesce(aviso_asesor_en, now())
 where respondido_en is not null and (aviso_admin_en is null or aviso_asesor_en is null);

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Desplegar también (público, --no-verify-jwt): avisar-encuesta-respondida y enviar-encuesta-cliente.
-- Bloque 4 (ejecutar DESPUÉS de los pasos 2 y 3). El segundo trabajo manda el resumen semanal los lunes 7:00 a. m. (Bogotá):
-- select cron.schedule(
--   'encuestas-pendientes',
--   '*/10 * * * *',
--   $job$
--   select net.http_post(
--     url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/enviar-encuestas-pendientes',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')
--     ),
--     body := '{}'::jsonb
--   );
--   $job$
-- );
-- select cron.schedule(
--   'encuestas-resumen-semanal',
--   '0 12 * * 1',
--   $job$
--   select net.http_post(
--     url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/avisar-encuesta-respondida',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')
--     ),
--     body := '{"tarea":"semanal"}'::jsonb
--   );
--   $job$
-- );
