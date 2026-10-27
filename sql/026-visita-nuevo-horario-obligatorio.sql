-- 026 · Visita «pendiente de nuevo horario»: cuando el arrendatario no puede, el cambio es OBLIGATORIO y vence
-- Antes: el arrendatario «proponía» otra hora y la cita seguía igual hasta que el cliente aceptara (el correo decía «si no te parece, no hagas nada»).
-- Ahora: si quien ocupa el inmueble no puede (propone otra hora, bloquea un día o pausa las visitas), la cita queda marcada con
--   reubicacion_pendiente_desde (ya existía, sql/017) + un VENCIMIENTO (reubicacion_vence_en): el cliente debe elegir nueva hora antes de esa fecha;
--   si no lo hace, la visita se cancela sola y se avisa a todas las partes. Reglas y textos: supabase/functions/_shared/reubicacion.ts.
-- Procesar vencimientos y recordatorios: la Edge Function portal-visita (acción interna «procesar_reubicaciones», sin token: solo actúa sobre lo vencido
-- y es idempotente) llamada por pg_cron cada 10 minutos. Los últimos pasos (cron) se aplican DESPUÉS de desplegar portal-visita.

alter table public.agenda_citas
  add column if not exists reubicacion_vence_en timestamptz,
  add column if not exists reubicacion_motivo text check (reubicacion_motivo in ('dia_no_disponible', 'otra_hora', 'pausa')),
  add column if not exists reubicacion_recordada_en timestamptz,
  add column if not exists reubicacion_recordada2_en timestamptz;

create index if not exists agenda_citas_reubicacion_idx on public.agenda_citas(reubicacion_vence_en)
  where reubicacion_pendiente_desde is not null and estado = 'confirmada';

-- Bitácora del arrendatario: pausar visitas y visitas canceladas por vencimiento.
alter table public.agenda_arrendatario_acciones drop constraint if exists agenda_arrendatario_acciones_accion_check;
alter table public.agenda_arrendatario_acciones add constraint agenda_arrendatario_acciones_accion_check
  check (accion in ('horario_actualizado', 'cita_cancelada', 'propuesta_creada', 'propuesta_aceptada', 'propuesta_rechazada',
                    'ventanas_guardadas', 'ventanas_borradas', 'cita_reubicada', 'pausa_visitas', 'visita_vencida'));

-- ---------------------------------------------------------------- tareas programadas (aplicar al final)
-- select cron.schedule('reubicaciones-procesar', '*/10 * * * *',
--   $$select net.http_post(url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/portal-visita',
--                          headers := '{"Content-Type":"application/json"}'::jsonb,
--                          body := '{"accion":"procesar_reubicaciones"}'::jsonb)$$);
-- Cierres y recordatorios de tickets de soporte (sql/024–025), cada hora:
-- select cron.schedule('tickets-mantenimiento', '15 * * * *', $$select public.agenda_ticket_mantenimiento()$$);
