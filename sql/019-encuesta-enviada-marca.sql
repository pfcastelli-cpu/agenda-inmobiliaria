-- 019 · Marca de «encuesta enviada» y bitácora de correos que sí admite las encuestas
-- Hallazgo del 26-oct-2026: agenda_correos_log solo permitía destinatario_tipo cliente/propietario/interno/verificacion/arrendatario,
-- así que TODOS los registros de las encuestas al cliente (tipo 'encuesta_cliente') se rechazaban en silencio desde que existe la
-- encuesta. Por eso el envío automático (SQL 018) no podía apoyarse en la bitácora para no repetir. Ahora:
--   * agenda_encuestas_cliente.enviada_en marca cuándo salió el correo (única fuente para no repetir);
--   * la bitácora admite 'encuesta_cliente'.
alter table public.agenda_encuestas_cliente add column if not exists enviada_en timestamptz;

-- Las encuestas que ya existían se dan por enviadas (se mandaron a mano al marcar «Realizada» o en pruebas).
update public.agenda_encuestas_cliente set enviada_en = coalesce(enviada_en, creado_en) where enviada_en is null;

alter table public.agenda_correos_log drop constraint if exists agenda_correos_log_destinatario_tipo_check;
alter table public.agenda_correos_log add constraint agenda_correos_log_destinatario_tipo_check
  check (destinatario_tipo in ('cliente', 'propietario', 'interno', 'verificacion', 'arrendatario', 'encuesta_cliente'));
