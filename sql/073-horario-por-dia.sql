-- 073 · Horario de visitas distinto para cada día de la semana (lo define el arrendatario desde su página).
-- Formato de la columna: {"1":{"desde":"08:00","hasta":"17:00"},"2":{"desde":"08:00","hasta":"12:00"}, ...}  (clave = día ISO: 1 lunes … 7 domingo).
-- Un día que no aparece = no se muestra. Si la columna es null, todo funciona como antes (dias_visita_permitidos + hora_visita_desde/hasta).
-- Compatibilidad: el portal sigue guardando también dias_visita_permitidos (días con horario) y hora_visita_desde/hasta (la hora más temprana / más tarde)
-- para que todo lo que ya los lee siga funcionando; el recorte fino por día lo hace agenda_sugerir_horarios_portal_base.
-- APLICADO en producción el 11-nov-2026. Idempotente.

alter table public.agenda_inmuebles add column if not exists horario_por_dia jsonb;

-- 1) Los horarios que se ofrecen respetan el rango propio de cada día.
create or replace function public.agenda_sugerir_horarios_portal_base(p_empresa_id uuid, p_inmueble_id uuid, p_fecha date, p_intervalo_minutos integer default 30, p_cita_origen_id uuid default null::uuid)
 returns table(asesor_id uuid, asesor_nombre text, tipo_vinculacion text, prioridad integer, hora_inicio time without time zone, hora_fin time without time zone, distancia_km_mas_cercana numeric, tipo_slot text)
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_inmueble record; v_cfg record; v_isodow integer; v_es_festivo boolean; v_es_barato boolean; v_es_alto_valor boolean;
  v_duracion_visita integer;
  v_asesor record; v_jornada_inicio time; v_jornada_fin time; v_alm_activo boolean; v_alm_inicio time; v_alm_fin time;
  v_medio_dia time; v_slot_inicio time; v_slot_fin time; v_dist_min numeric; v_base record; v_paso interval;
  v_traslado interval; v_cand_inicio time; v_cand_fin time; v_cierre_ventana time; v_ya_emitidos time[];
  v_ahora timestamp; v_minimo_datetime_primera timestamp; v_minimo_datetime_mismo timestamp; v_inmueble_ya_tiene_cita boolean;
  v_hay_ventanas boolean;
  v_dia jsonb; v_dia_desde time; v_dia_hasta time;
begin
  select * into v_inmueble from public.agenda_inmuebles where id = p_inmueble_id and empresa_id = p_empresa_id;
  if not found then raise exception 'Inmueble % no encontrado para esta empresa', p_inmueble_id; end if;
  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then raise exception 'No hay configuración para esta empresa'; end if;
  v_isodow := extract(isodow from p_fecha);

  -- Inmueble aún no entregado: las citas empiezan en la fecha programada.
  if v_inmueble.citas_desde is not null and p_fecha < v_inmueble.citas_desde then
    return;
  end if;

  select exists(select 1 from public.agenda_inmueble_ventanas w where w.inmueble_id = p_inmueble_id and w.fecha = p_fecha and w.tipo = 'disponible')
    into v_hay_ventanas;

  -- Restricción por días permitidos del inmueble: si el día no está permitido, no hay nada que ofrecer
  -- (salvo que el arrendatario haya abierto franjas concretas para ese día).
  if v_inmueble.dias_visita_permitidos is not null and not (v_isodow = any(v_inmueble.dias_visita_permitidos)) and not v_hay_ventanas then
    return;
  end if;

  -- Horario propio de ese día de la semana (si el arrendatario lo definió por día).
  v_dia := case when v_inmueble.horario_por_dia is not null then v_inmueble.horario_por_dia -> (v_isodow::text) else null end;
  if v_inmueble.horario_por_dia is not null and v_dia is null and not v_hay_ventanas then
    return;
  end if;
  if v_dia is not null then
    v_dia_desde := (v_dia ->> 'desde')::time;
    v_dia_hasta := (v_dia ->> 'hasta')::time;
  end if;

  v_duracion_visita := coalesce(v_inmueble.duracion_visita_minutos, v_cfg.duracion_visita_minutos);
  v_es_festivo := public.agenda_es_festivo(v_cfg.pais, p_fecha);
  v_ahora := (now() at time zone 'America/Bogota');
  v_minimo_datetime_mismo := v_ahora + (coalesce(v_cfg.horas_minimas_anticipacion_mismo_inmueble, 1) || ' hours')::interval;
  v_traslado := (v_cfg.minutos_traslado_entre_inmuebles || ' minutes')::interval;
  select exists(select 1 from public.agenda_citas c where c.inmueble_id = p_inmueble_id and c.fecha = p_fecha and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null) into v_inmueble_ya_tiene_cita;
  v_es_barato := (
    (lower(coalesce(v_inmueble.tipo_oferta, '')) like 'arriendo%' and v_cfg.valor_minimo_canon_seguimiento > 0 and coalesce(v_inmueble.valor_canon, 0) < v_cfg.valor_minimo_canon_seguimiento)
    or
    (lower(coalesce(v_inmueble.tipo_oferta, '')) like 'venta%' and v_cfg.valor_minimo_venta_seguimiento > 0 and coalesce(v_inmueble.valor_venta, 0) < v_cfg.valor_minimo_venta_seguimiento)
  );
  v_es_alto_valor := (
    (lower(coalesce(v_inmueble.tipo_oferta, '')) like 'arriendo%' and v_cfg.valor_alto_canon_zona > 0 and coalesce(v_inmueble.valor_canon, 0) >= v_cfg.valor_alto_canon_zona)
    or
    (lower(coalesce(v_inmueble.tipo_oferta, '')) like 'venta%' and v_cfg.valor_alto_venta_zona > 0 and coalesce(v_inmueble.valor_venta, 0) >= v_cfg.valor_alto_venta_zona)
  );
  for v_asesor in
    select a.* from public.agenda_asesores a
    where a.empresa_id = p_empresa_id and a.activo
      and exists (select 1 from public.agenda_asesores_ciudades ac join public.agenda_ciudades ci on ci.id = ac.ciudad_id where ac.asesor_id = a.id and v_inmueble.ciudad ilike '%' || ci.nombre || '%')
      and not exists (select 1 from public.agenda_asesores_ausencias au where au.asesor_id = a.id and p_fecha between au.fecha_inicio and au.fecha_fin)
    order by (a.tipo_vinculacion = 'planta') desc, a.prioridad asc, a.nombre
  loop
    if v_isodow = 7 and not v_asesor.atiende_domingo then continue; end if;
    if v_es_festivo and not v_asesor.atiende_festivos then continue; end if;
    if v_isodow = 6 then
      if not v_asesor.atiende_sabado then continue; end if;
      v_jornada_fin := v_asesor.jornada_fin_sabado;
    else
      v_jornada_fin := v_asesor.jornada_fin;
    end if;
    v_jornada_inicio := v_asesor.jornada_inicio;
    -- Restricción por horario permitido del inmueble: acota la jornada efectiva para este inmueble
    -- (si el arrendatario abrió franjas ese día, mandan las franjas y no el horario semanal).
    if not v_hay_ventanas then
      if v_dia is not null then
        -- Horario propio de ese día de la semana.
        if v_dia_desde > v_jornada_inicio then v_jornada_inicio := v_dia_desde; end if;
        if v_dia_hasta < v_jornada_fin then v_jornada_fin := v_dia_hasta; end if;
      else
        if v_inmueble.hora_visita_desde is not null and v_inmueble.hora_visita_desde > v_jornada_inicio then
          v_jornada_inicio := v_inmueble.hora_visita_desde;
        end if;
        if v_inmueble.hora_visita_hasta is not null and v_inmueble.hora_visita_hasta < v_jornada_fin then
          v_jornada_fin := v_inmueble.hora_visita_hasta;
        end if;
      end if;
    end if;
    v_alm_activo := coalesce(v_asesor.almuerzo_activo, v_cfg.almuerzo_activo);
    v_alm_inicio := coalesce(v_asesor.almuerzo_inicio, v_cfg.almuerzo_inicio);
    v_alm_fin := coalesce(v_asesor.almuerzo_fin, v_cfg.almuerzo_fin);
    v_medio_dia := case when v_alm_activo then v_alm_fin else '12:00'::time end;
    v_minimo_datetime_primera := v_ahora + (coalesce(v_asesor.horas_minimas_anticipacion, v_cfg.horas_minimas_anticipacion, 0) || ' hours')::interval;
    v_ya_emitidos := array[]::time[];
    if (not v_inmueble_ya_tiene_cita) or v_hay_ventanas then
      v_slot_inicio := v_jornada_inicio;
      while v_slot_inicio + (v_duracion_visita || ' minutes')::interval <= v_jornada_fin loop
        v_slot_fin := v_slot_inicio + (v_duracion_visita || ' minutes')::interval;
        if (p_fecha + v_slot_inicio) >= v_minimo_datetime_primera
           and not (v_alm_activo and v_slot_inicio < v_alm_fin and v_slot_fin > v_alm_inicio)
           and public.agenda_slot_disponible(p_empresa_id, v_asesor.id, p_inmueble_id, p_fecha, v_slot_inicio, v_slot_fin)
           and (
             v_es_alto_valor
             or not exists (
               select 1 from public.agenda_citas c2 join public.agenda_inmuebles i2 on i2.id = c2.inmueble_id
               where c2.asesor_id = v_asesor.id and c2.fecha = p_fecha and c2.estado <> 'cancelada' and c2.reubicacion_pendiente_desde is null
                 and (c2.hora_inicio >= v_medio_dia) = (v_slot_inicio >= v_medio_dia)
                 and coalesce(public.agenda_distancia_km(v_inmueble.latitud, v_inmueble.longitud, i2.latitud, i2.longitud), 0) > v_cfg.radio_zona_km
             )
           )
        then
          select min(public.agenda_distancia_km(v_inmueble.latitud, v_inmueble.longitud, i.latitud, i.longitud)) into v_dist_min
            from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
            where c.asesor_id = v_asesor.id and c.fecha = p_fecha and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null;
          asesor_id := v_asesor.id; asesor_nombre := v_asesor.nombre; tipo_vinculacion := v_asesor.tipo_vinculacion;
          prioridad := v_asesor.prioridad; hora_inicio := v_slot_inicio; hora_fin := v_slot_fin;
          distancia_km_mas_cercana := v_dist_min; tipo_slot := 'primera';
          v_ya_emitidos := v_ya_emitidos || v_slot_inicio; return next;
        end if;
        v_slot_inicio := v_slot_inicio + (p_intervalo_minutos || ' minutes')::interval;
      end loop;
    end if;
    if v_cfg.modo_mismo_inmueble <> 'desactivado' and v_cfg.separacion_mismo_inmueble_minutos > 0 and not v_es_barato then
      v_paso := (v_cfg.separacion_mismo_inmueble_minutos || ' minutes')::interval;
      for v_base in select c.hora_inicio, c.hora_fin from public.agenda_citas c where c.asesor_id = v_asesor.id and c.fecha = p_fecha and c.estado <> 'cancelada' and (c.reubicacion_pendiente_desde is null or c.id = p_cita_origen_id) and c.inmueble_id = p_inmueble_id loop
        v_cierre_ventana := least(v_jornada_fin, v_base.hora_fin + v_traslado);
        v_cand_inicio := v_base.hora_inicio + v_paso;
        while v_cand_inicio + v_paso <= v_cierre_ventana loop
          v_cand_fin := v_cand_inicio + v_paso;
          if (p_fecha + v_cand_inicio) >= v_minimo_datetime_mismo
             and not (v_cand_inicio = any(v_ya_emitidos))
             and not (v_alm_activo and v_cand_inicio < v_alm_fin and v_cand_fin > v_alm_inicio)
             and public.agenda_slot_disponible(p_empresa_id, v_asesor.id, p_inmueble_id, p_fecha, v_cand_inicio, v_cand_fin)
          then
            asesor_id := v_asesor.id; asesor_nombre := v_asesor.nombre; tipo_vinculacion := v_asesor.tipo_vinculacion;
            prioridad := v_asesor.prioridad; hora_inicio := v_cand_inicio; hora_fin := v_cand_fin;
            distancia_km_mas_cercana := 0; tipo_slot := 'mismo_inmueble';
            v_ya_emitidos := v_ya_emitidos || v_cand_inicio; return next;
          end if;
          v_cand_inicio := v_cand_inicio + v_paso;
        end loop;
      end loop;
    end if;
  end loop;
  return;
end;
$function$;

-- 2) Cuando un administrador guarda un horario uniforme desde la agenda, se descarta el horario por día
--    (si no, el por-día seguiría mandando y el cambio del administrador no se notaría).
create or replace function public.agenda_actualizar_restriccion_inmueble(p_inmueble_id uuid, p_dias_permitidos smallint[], p_hora_desde time without time zone, p_hora_hasta time without time zone, p_duracion_minutos smallint default null::smallint, p_citas_desde date default null::date)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_empresa_id uuid;
begin
  select empresa_id into v_empresa_id from public.agenda_inmuebles where id = p_inmueble_id;
  if v_empresa_id is null then
    raise exception 'Inmueble no encontrado';
  end if;
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No tienes permiso para modificar este inmueble';
  end if;
  if p_duracion_minutos is not null and p_duracion_minutos <= 0 then
    raise exception 'La duración debe ser mayor a cero minutos';
  end if;
  update public.agenda_inmuebles
    set dias_visita_permitidos = p_dias_permitidos,
        hora_visita_desde = p_hora_desde,
        hora_visita_hasta = p_hora_hasta,
        duracion_visita_minutos = p_duracion_minutos,
        citas_desde = p_citas_desde,
        horario_por_dia = null
    where id = p_inmueble_id;
end;
$function$;
