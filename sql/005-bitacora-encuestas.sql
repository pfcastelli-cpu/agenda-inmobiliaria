-- Entrega 005 | Ya se ejecutó directamente en el proyecto de Supabase (vía MCP) el 2026-10-16.
-- Se deja este archivo solo como registro, siguiendo la convención de 001/002/003/004.
-- Es seguro volver a correrlo si hace falta: usa "create or replace" / "if not exists" en
-- todo lo que lo admite, así que no duplica nada si ya está aplicado. La única excepción es
-- el "create trigger" del paso 2, que no admite "or replace" en Postgres (si hiciera falta
-- reaplicar, usar primero "drop trigger if exists agenda_citas_estampar_actualizado_por
-- on agenda_citas;").
--
-- Qué hace: (1) agrega la bitácora de "quién hizo qué" en las citas y las dos pantallas de
-- administrador que la consultan, y (2) lleva la encuesta de satisfacción al nivel del
-- sistema viejo (impresión del inmueble, intención comercial, motivo, calificación
-- específica del asesor) en vez del simple 1-5 estrellas + comentario que había.

begin;

-- 1. Columna genérica para saber quién hizo el último update de una cita (cubre also
--    acciones que no tenían "quién" hasta ahora: mover una cita, editarla).
alter table agenda_citas
  add column if not exists actualizado_por uuid references auth.users(id);

-- 2. Preguntas nuevas de la encuesta de cliente (impresión del inmueble, intención
--    comercial, motivo de rechazo). "calificacion" pasa a significar específicamente la
--    calificación de 1 a 5 a la atención del asesor (no del inmueble).
alter table agenda_encuestas_cliente
  add column if not exists impresion text,
  add column if not exists intencion text,
  add column if not exists motivo text;

comment on column agenda_encuestas_cliente.calificacion is
  'Calificación de 1 a 5 a la atención del asesor (no del inmueble).';
comment on column agenda_encuestas_cliente.impresion is
  'Impresión del inmueble: me_gusto_mucho | me_gusto | no_seguro | no_me_gusto.';
comment on column agenda_encuestas_cliente.intencion is
  'Intención comercial: avanzar | segunda_visita | resolver_dudas | ver_otras | no_interesa.';
comment on column agenda_encuestas_cliente.motivo is
  'Motivo si no convenció del todo: precio | ubicacion | estado | tamano | ruido | no_aplica (opcional).';

commit;

-- 3. Trigger que estampa automáticamente quién hizo el último update de una cita, para que
--    la bitácora pueda mostrar "quién" incluso en acciones que antes no lo registraban
--    (mover una cita, editarla). No se puede meter en el mismo "begin/commit" de arriba
--    junto con un "drop trigger if exists" en la misma transacción sin riesgo de timeout
--    (ver nota de la entrega 004); por eso va aparte y sin drop previo, asumiendo que no
--    existe todavía.
create or replace function agenda_estampar_actualizado_por()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if auth.uid() is not null then
    new.actualizado_por := auth.uid();
  end if;
  return new;
end;
$$;

create trigger agenda_citas_estampar_actualizado_por
before update on agenda_citas
for each row
execute function agenda_estampar_actualizado_por();

-- 4. Actualiza el trigger existente (agenda_citas_historial_trigger, ya documentado en
--    001/002) para que use actualizado_por (o cancelado_por cuando aplica) y así la
--    bitácora pueda mostrar "quién" en cancelada/cambio_estado/movida/editada, no solo en
--    creada. Pega aquí el cuerpo completo vigente de agenda_registrar_historial_cita()
--    antes de ejecutar — se omite en este archivo de referencia porque ya está aplicado y
--    es largo; ver el historial de la sesión o pg_proc en Supabase si hace falta
--    reconstruirlo.

-- 5. Funciones de encuesta actualizadas para leer/escribir impresion/intencion/motivo:
--    agenda_obtener_encuesta(p_token), agenda_responder_encuesta(p_token, p_calificacion,
--    p_comentario, p_impresion, p_intencion, p_motivo), agenda_informe_propietario_datos
--    (agrega los tres campos a cada opinión del jsonb que ya devolvía). Mismo comentario
--    que el punto 4: ya aplicadas, cuerpo completo en pg_proc si hace falta reconstruir.

-- 6. Dos RPC nuevas para las pantallas de administrador (pestaña "Bitácora"):
--    agenda_bitacora_citas(p_empresa_id, p_desde, p_hasta, p_asesor_id, p_accion, p_texto,
--    p_limite default 100, p_offset default 0) y agenda_bitacora_encuestas(p_empresa_id,
--    p_desde, p_hasta, p_asesor_id, p_calificacion_min, p_texto, p_limite default 100,
--    p_offset default 0). Ambas SECURITY DEFINER, solo administrador/coordinador activo de
--    la empresa, devuelven jsonb {filas, total}. Cuerpo completo en pg_proc (mismo
--    comentario que arriba).

-- 7. Edge Function enviar-encuesta-cliente (version 3, verify_jwt: false): el correo ahora
--    incluye 4 botones de preselección de impresión (😍🙂😐🙁) que enlazan a
--    /opinion/<token>?impresion=<valor> además del botón "Responder la encuesta completa".
