-- El portal conserva la cita de origen como referencia de los turnos escalonados,
-- incluso cuando su horario ya se liberó. Nunca la usa como bloqueo.
-- Un solo motor: la función pública habitual delega en la misma implementación.
begin;
do $$
declare
  motor text;
begin
  if to_regprocedure('public.agenda_sugerir_horarios_portal(uuid,uuid,date,integer,uuid)') is null then
    motor := pg_get_functiondef('public.agenda_sugerir_horarios(uuid,uuid,date,integer)'::regprocedure);
    if motor not like '%for v_base in%' or motor not like '%p_intervalo_minutos integer DEFAULT 30)%' then
      raise exception 'El motor cambió: revisar la migración antes de aplicarla';
    end if;
    motor := replace(motor, 'FUNCTION public.agenda_sugerir_horarios(', 'FUNCTION public.agenda_sugerir_horarios_portal(');
    motor := replace(motor, 'p_intervalo_minutos integer DEFAULT 30)', 'p_intervalo_minutos integer DEFAULT 30, p_cita_origen_id uuid DEFAULT NULL)');
    motor := regexp_replace(motor,
      '(for v_base in [^\n]*?)c\.reubicacion_pendiente_desde is null',
      '\1(c.reubicacion_pendiente_desde is null or c.id = p_cita_origen_id)');
    if motor not like '%or c.id = p_cita_origen_id%' then
      raise exception 'No se encontró el anclaje esperado de los turnos';
    end if;
    execute motor;
  end if;
end $$;

create or replace function public.agenda_sugerir_horarios(
  p_empresa_id uuid, p_inmueble_id uuid, p_fecha date, p_intervalo_minutos integer default 30)
returns table(asesor_id uuid, asesor_nombre text, tipo_vinculacion text, prioridad integer,
  hora_inicio time, hora_fin time, distancia_km_mas_cercana numeric, tipo_slot text)
language sql stable set search_path = '' as $$
  select * from public.agenda_sugerir_horarios_portal(p_empresa_id, p_inmueble_id, p_fecha, p_intervalo_minutos, null)
$$;

-- SECURITY INVOKER conserva las políticas RLS del motor anterior.
-- El portal público lo invoca desde el servidor después de validar el token.
revoke all on function public.agenda_sugerir_horarios_portal(uuid,uuid,date,integer,uuid) from public, anon, authenticated;
grant execute on function public.agenda_sugerir_horarios_portal(uuid,uuid,date,integer,uuid) to authenticated, service_role;
commit;
