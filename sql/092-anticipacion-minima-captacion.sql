-- 092 · Anticipación mínima propia para las CAPTACIONES (consignar un inmueble), separada de la de las visitas.
-- La de visitas existe para que el asesor alcance a buscar llaves; en una captación no hay llaves, así que puede ser menor.
-- Orden: la del asesor para captación → la de la empresa para captación → (si no hay) la de visitas de la empresa.
-- Los valores actuales se copian a la empresa para que nada cambie hasta que Felipe los ajuste. Los asesores que ya tenían
-- una anticipación personal para visitas NO la arrastran a captación (quedan en blanco = usan la de la empresa).
-- Firma y permisos de la función iguales a la 052.

alter table public.agenda_configuracion add column if not exists horas_minimas_anticipacion_captacion integer
  check (horas_minimas_anticipacion_captacion is null or horas_minimas_anticipacion_captacion >= 0);
update public.agenda_configuracion set horas_minimas_anticipacion_captacion = horas_minimas_anticipacion
  where horas_minimas_anticipacion_captacion is null;
alter table public.agenda_asesores add column if not exists horas_minimas_anticipacion_captacion integer
  check (horas_minimas_anticipacion_captacion is null or horas_minimas_anticipacion_captacion >= 0);

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
  v_dur_max constant integer := 90;
  v_dur_min constant integer := 60;
  v_dur integer;
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
      v_minimo := v_ahora + (coalesce(v_asesor.horas_minimas_anticipacion_captacion, v_cfg.horas_minimas_anticipacion_captacion, v_cfg.horas_minimas_anticipacion, 0) || ' hours')::interval;

      v_slot_inicio := v_asesor.jornada_inicio;
      while v_slot_inicio + (v_dur_min || ' minutes')::interval <= v_jornada_fin loop
        -- Ideal 90 min; si no cabe (otra cita, almuerzo, fin de jornada) se ofrece 60 min como mínimo.
        v_slot_fin := null;
        foreach v_dur in array array[v_dur_max, v_dur_min] loop
          if v_slot_inicio + (v_dur || ' minutes')::interval <= v_jornada_fin
             and (v_fecha + v_slot_inicio) >= v_minimo
             and not (coalesce(v_alm_activo, false) and v_slot_inicio < v_alm_fin and v_slot_inicio + (v_dur || ' minutes')::interval > v_alm_inicio)
             and public.agenda_slot_disponible_captacion(p_empresa_id, v_asesor.id, v_fecha, v_slot_inicio, v_slot_inicio + (v_dur || ' minutes')::interval)
          then
            v_slot_fin := v_slot_inicio + (v_dur || ' minutes')::interval;
            exit;
          end if;
        end loop;
        if v_slot_fin is not null then
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


-- Agendar una captación a mano desde la agenda interna usa la misma regla (las demás citas sin inmueble siguen con la de visitas).
create or replace function public.agenda_crear_cita_interna(
  p_empresa_id uuid, p_asesor_id uuid, p_fecha date, p_hora_inicio time without time zone,
  p_inmueble_id uuid default null, p_cliente_nombre text default '', p_cliente_telefono text default '',
  p_cliente_email text default '', p_notas text default '', p_tipo_cita text default 'visita_cliente',
  p_titulo text default '', p_direccion_libre text default '', p_ciudad_libre text default '',
  p_duracion_minutos integer default null, p_cobertura_id uuid default null, p_tipo_inmueble_captacion text default null,
  p_valor_estimado_captacion numeric default null, p_mandato_exclusivo boolean default null, p_origen_captacion text default null,
  p_forzar boolean default false, p_modalidad text default 'presencial', p_enlace_virtual text default ''
) returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_cfg record;
  v_asesor record;
  v_hora_fin time;
  v_id uuid;
  v_duracion int;
  v_alm_activo boolean;
  v_alm_inicio time;
  v_alm_fin time;
  v_minimo timestamp;
  v_forzar boolean := coalesce(p_forzar, false);
begin
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if p_tipo_cita not in ('visita_cliente','inventario','inspeccion','captacion','otro','entrega_inmueble','llaves','firma_contrato','fotografia','mantenimiento','reunion_cliente','tramite','reunion_interna') then
    raise exception 'Tipo de cita no válido: %', p_tipo_cita;
  end if;
  if coalesce(p_modalidad, 'presencial') not in ('presencial','virtual') then
    raise exception 'Modalidad no válida';
  end if;
  if v_forzar and not public.agenda_puede_cruzar(p_empresa_id) then
    raise exception 'Tu empresa no permite agendar sobre un horario ocupado. Pide a un administrador que lo haga.';
  end if;
  if (p_fecha + p_hora_inicio) < (now() at time zone 'America/Bogota') then
    raise exception 'Esa hora ya pasó. Elige una fecha y hora posteriores a la actual.';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No hay configuración para esta empresa';
  end if;
  select * into v_asesor from public.agenda_asesores a where a.id = p_asesor_id and a.empresa_id = p_empresa_id and a.activo;
  if not found then
    raise exception 'Asesor no válido para esta empresa';
  end if;
  if p_tipo_cita = 'visita_cliente' and (p_cliente_nombre is null or p_cliente_nombre = '') then
    raise exception 'El nombre del cliente es obligatorio para una visita con cliente';
  end if;
  if p_inmueble_id is not null then
    if not exists (select 1 from public.agenda_inmuebles i where i.id = p_inmueble_id and i.empresa_id = p_empresa_id) then
      raise exception 'Inmueble no válido para esta empresa';
    end if;
  elsif p_tipo_cita in ('visita_cliente','inventario','inspeccion','entrega_inmueble','fotografia','mantenimiento') then
    raise exception 'Este tipo de cita requiere un inmueble existente';
  end if;

  v_duracion := coalesce(p_duracion_minutos, case p_tipo_cita when 'captacion' then 90 when 'fotografia' then 90 when 'entrega_inmueble' then 60 when 'firma_contrato' then 60 when 'mantenimiento' then 60 when 'tramite' then 60 when 'reunion_interna' then 60 when 'reunion_cliente' then 45 when 'llaves' then 30 else v_cfg.duracion_visita_minutos end);
  if v_duracion is null or v_duracion <= 0 then
    raise exception 'La duración debe ser mayor a cero minutos';
  end if;
  v_hora_fin := p_hora_inicio + (v_duracion || ' minutes')::interval;

  perform public.agenda_bloquear_dia(p_empresa_id, p_fecha);

  if not v_forzar then
    if p_inmueble_id is not null then
      if not public.agenda_slot_disponible(p_empresa_id, p_asesor_id, p_inmueble_id, p_fecha, p_hora_inicio, v_hora_fin) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    else
      v_alm_activo := coalesce(v_asesor.almuerzo_activo, v_cfg.almuerzo_activo);
      v_alm_inicio := coalesce(v_asesor.almuerzo_inicio, v_cfg.almuerzo_inicio);
      v_alm_fin := coalesce(v_asesor.almuerzo_fin, v_cfg.almuerzo_fin);
      if v_alm_activo and p_hora_inicio < v_alm_fin and v_hora_fin > v_alm_inicio then
        raise exception 'Ese horario cae en el horario de almuerzo del asesor';
      end if;
      v_minimo := (now() at time zone 'America/Bogota') + (case when p_tipo_cita = 'captacion' then coalesce(v_asesor.horas_minimas_anticipacion_captacion, v_cfg.horas_minimas_anticipacion_captacion, v_cfg.horas_minimas_anticipacion, 0) else coalesce(v_asesor.horas_minimas_anticipacion, v_cfg.horas_minimas_anticipacion, 0) end || ' hours')::interval;
      if (p_fecha + p_hora_inicio) < v_minimo then
        raise exception 'Ese horario no cumple la anticipación mínima configurada';
      end if;
      if not public.agenda_slot_disponible_captacion(p_empresa_id, p_asesor_id, p_fecha, p_hora_inicio, v_hora_fin) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    end if;
  else
    perform set_config('agenda.cruce_autorizado', 'on', true);
  end if;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, notas, creado_por,
    tipo_cita, titulo, direccion_libre, ciudad_libre,
    cobertura_id, tipo_inmueble_captacion, valor_estimado_captacion, mandato_exclusivo, origen_captacion,
    cruce_autorizado, cruce_autorizado_por, modalidad, enlace_virtual
  ) values (
    p_empresa_id, p_inmueble_id, p_asesor_id, p_fecha, p_hora_inicio, v_hora_fin,
    nullif(coalesce(p_cliente_nombre, ''), ''), coalesce(p_cliente_telefono, ''), coalesce(p_cliente_email, ''), p_notas, auth.uid(),
    p_tipo_cita, p_titulo, p_direccion_libre, p_ciudad_libre,
    p_cobertura_id, p_tipo_inmueble_captacion, p_valor_estimado_captacion, p_mandato_exclusivo, p_origen_captacion,
    v_forzar, case when v_forzar then auth.uid() end, coalesce(p_modalidad, 'presencial'), nullif(btrim(coalesce(p_enlace_virtual, '')), '')
  ) returning id into v_id;

  return v_id;
end;
$function$;
