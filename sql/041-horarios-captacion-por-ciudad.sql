-- 041 · Horarios de captación por CIUDAD, mezclando a todos los asesores de la ciudad (varios días)
-- Antes: agenda_sugerir_horarios_captacion exigía una cobertura Y que algún asesor estuviera marcado en ella (hoy ninguno lo está,
--   así que nunca salían horarios) y solo miraba un día.
-- Ahora: se elige la ciudad; entran todos los asesores activos de esa ciudad (agenda_asesores_ciudades). La cobertura es opcional:
--   si se manda y algún asesor la tiene marcada, solo entran esos; si nadie la tiene, se ignora y entra toda la ciudad.
-- Devuelve una fila por día, hora y asesor LIBRE (jornada, almuerzo, ausencias, festivos, anticipación mínima y traslado entre citas).
-- La captación dura 90 min (igual que agenda_crear_cita_interna). La pantalla agrupa por hora y asigna al asesor de mayor
-- prioridad (prioridad 1 antes que 5; a igual prioridad, de planta antes que freelance); si ese está ocupado, la hora se ofrece al siguiente.
-- No modifica nada existente. La función anterior se conserva.

create or replace function public.agenda_sugerir_horarios_captacion_ciudad(
  p_empresa_id uuid,
  p_ciudad_id uuid,
  p_fecha_desde date,
  p_dias integer default 7,
  p_cobertura_id uuid default null,
  p_intervalo_minutos integer default 30
) returns table(
  fecha date,
  asesor_id uuid,
  asesor_nombre text,
  tipo_vinculacion text,
  prioridad integer,
  hora_inicio time without time zone,
  hora_fin time without time zone
)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_cfg record;
  v_asesor record;
  v_dias integer;
  v_i integer;
  v_fecha date;
  v_isodow integer;
  v_es_festivo boolean;
  v_usar_cobertura boolean := false;
  v_duracion constant integer := 90;
  v_jornada_fin time;
  v_alm_activo boolean;
  v_alm_inicio time;
  v_alm_fin time;
  v_slot_inicio time;
  v_slot_fin time;
  v_ahora timestamp;
  v_minimo timestamp;
begin
  -- Quien llama desde la app debe pertenecer a la empresa; la service_role (auth.uid() nulo) pasa.
  if auth.uid() is not null and not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;

  select * into v_cfg from public.agenda_configuracion c where c.empresa_id = p_empresa_id;
  if not found then
    raise exception 'No hay configuración para esta empresa';
  end if;

  v_dias := least(greatest(coalesce(p_dias, 7), 1), 14);
  v_ahora := now() at time zone 'America/Bogota';

  if p_cobertura_id is not null then
    v_usar_cobertura := exists (
      select 1
      from public.agenda_asesores_coberturas ac
      join public.agenda_asesores a on a.id = ac.asesor_id
      where ac.cobertura_id = p_cobertura_id and a.empresa_id = p_empresa_id and a.activo
    );
  end if;

  for v_i in 0 .. v_dias - 1 loop
    v_fecha := greatest(p_fecha_desde, v_ahora::date) + v_i;
    v_isodow := extract(isodow from v_fecha);
    v_es_festivo := public.agenda_es_festivo(v_cfg.pais, v_fecha);

    for v_asesor in
      select a.*
      from public.agenda_asesores a
      where a.empresa_id = p_empresa_id
        and a.activo
        and exists (select 1 from public.agenda_asesores_ciudades x where x.asesor_id = a.id and x.ciudad_id = p_ciudad_id)
        and (not v_usar_cobertura or exists (
              select 1 from public.agenda_asesores_coberturas ac where ac.asesor_id = a.id and ac.cobertura_id = p_cobertura_id))
        and not exists (
              select 1 from public.agenda_asesores_ausencias au
              where au.asesor_id = a.id and v_fecha between au.fecha_inicio and au.fecha_fin)
      order by a.prioridad, case when a.tipo_vinculacion = 'planta' then 0 else 1 end, a.nombre
    loop
      if v_isodow = 7 and not v_asesor.atiende_domingo then continue; end if;
      if v_es_festivo and not v_asesor.atiende_festivos then continue; end if;
      if v_isodow = 6 then
        if not v_asesor.atiende_sabado then continue; end if;
        v_jornada_fin := v_asesor.jornada_fin_sabado;
      else
        v_jornada_fin := v_asesor.jornada_fin;
      end if;
      if v_jornada_fin is null then continue; end if;

      v_alm_activo := coalesce(v_asesor.almuerzo_activo, v_cfg.almuerzo_activo);
      v_alm_inicio := coalesce(v_asesor.almuerzo_inicio, v_cfg.almuerzo_inicio);
      v_alm_fin := coalesce(v_asesor.almuerzo_fin, v_cfg.almuerzo_fin);
      v_minimo := v_ahora + (coalesce(v_asesor.horas_minimas_anticipacion, v_cfg.horas_minimas_anticipacion, 0) || ' hours')::interval;

      v_slot_inicio := v_asesor.jornada_inicio;
      while v_slot_inicio + (v_duracion || ' minutes')::interval <= v_jornada_fin loop
        v_slot_fin := v_slot_inicio + (v_duracion || ' minutes')::interval;
        if (v_fecha + v_slot_inicio) >= v_minimo
           and not (coalesce(v_alm_activo, false) and v_slot_inicio < v_alm_fin and v_slot_fin > v_alm_inicio)
           and public.agenda_slot_disponible_captacion(p_empresa_id, v_asesor.id, v_fecha, v_slot_inicio, v_slot_fin)
        then
          fecha := v_fecha;
          asesor_id := v_asesor.id;
          asesor_nombre := v_asesor.nombre;
          tipo_vinculacion := v_asesor.tipo_vinculacion;
          prioridad := v_asesor.prioridad;
          hora_inicio := v_slot_inicio;
          hora_fin := v_slot_fin;
          return next;
        end if;
        v_slot_inicio := v_slot_inicio + (greatest(coalesce(p_intervalo_minutos, 30), 5) || ' minutes')::interval;
      end loop;
    end loop;
  end loop;
  return;
end;
$function$;

revoke all on function public.agenda_sugerir_horarios_captacion_ciudad(uuid, uuid, date, integer, uuid, integer) from public, anon;
grant execute on function public.agenda_sugerir_horarios_captacion_ciudad(uuid, uuid, date, integer, uuid, integer) to authenticated, service_role;
