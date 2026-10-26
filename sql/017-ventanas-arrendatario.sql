-- 017 · Ventanas de disponibilidad del arrendatario (bloques) y portal único por inmueble
-- Problema: en un inmueble "Rentando" cada visita tenía su propio correo, su propio enlace y su propia
-- negociación hora por hora. Ahora el arrendatario tiene UN enlace por inmueble (agenda_inmuebles.token_arrendatario)
-- donde ve todas sus visitas y, para una fecha concreta, declara:
--   * 'bloqueo'    : franjas en las que NO puede recibir visitas, o
--   * 'disponible' : hasta 3 franjas (p. ej. de 2 h) en las que SÍ puede; fuera de ellas ese día no se ofrece nada.
-- El motor de horarios (agenda_slot_disponible / agenda_sugerir_horarios) respeta esas franjas, así que lo que se
-- ofrece a los clientes ya está "pre-aceptado" por el arrendatario. Las visitas ya agendadas que quedan fuera se marcan
-- con agenda_citas.reubicacion_pendiente_desde y el cliente elige él mismo otro turno dentro de las franjas.
-- Dentro de una franja los turnos salen cada `separacion_mismo_inmueble_minutos` (Configuración) para varios clientes.
-- Referencia de lo aplicado en Supabase el 26-oct-2026.

alter table public.agenda_inmuebles
  add column if not exists token_arrendatario uuid not null default gen_random_uuid();
create unique index if not exists agenda_inmuebles_token_arrendatario_idx on public.agenda_inmuebles(token_arrendatario);

alter table public.agenda_citas
  add column if not exists reubicacion_pendiente_desde timestamptz;

create table if not exists public.agenda_inmueble_ventanas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  inmueble_id uuid not null references public.agenda_inmuebles(id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('disponible', 'bloqueo')),
  desde time not null,
  hasta time not null check (hasta > desde),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_inmueble_ventanas_idx on public.agenda_inmueble_ventanas(inmueble_id, fecha);

alter table public.agenda_inmueble_ventanas enable row level security;
drop policy if exists inmueble_ventanas_lectura on public.agenda_inmueble_ventanas;
create policy inmueble_ventanas_lectura on public.agenda_inmueble_ventanas
  for select to authenticated
  using (exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = agenda_inmueble_ventanas.empresa_id and m.usuario_id = auth.uid() and m.activo
  ));
grant select on public.agenda_inmueble_ventanas to authenticated;
grant select, insert, update, delete on public.agenda_inmueble_ventanas to service_role;

-- Bitácora: nuevas acciones del arrendatario.
alter table public.agenda_arrendatario_acciones drop constraint if exists agenda_arrendatario_acciones_accion_check;
alter table public.agenda_arrendatario_acciones add constraint agenda_arrendatario_acciones_accion_check
  check (accion in ('horario_actualizado', 'cita_cancelada', 'propuesta_creada', 'propuesta_aceptada', 'propuesta_rechazada',
                    'ventanas_guardadas', 'ventanas_borradas', 'cita_reubicada'));

-- agenda_slot_disponible: agrega las franjas del arrendatario (bloqueo / disponible) al resto de reglas.
create or replace function public.agenda_slot_disponible(p_empresa_id uuid, p_asesor_id uuid, p_inmueble_id uuid, p_fecha date, p_hora_inicio time without time zone, p_hora_fin time without time zone, p_ignorar_cita_id uuid default null::uuid)
 returns boolean
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_cfg record;
  v_inmueble record;
  v_mismo record;
  v_prevo record;
  v_nexto record;
  v_buffer numeric;
  v_dist numeric;
begin
  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  select * into v_inmueble from public.agenda_inmuebles where id = p_inmueble_id and empresa_id = p_empresa_id;
  if v_cfg is null or v_inmueble is null then
    return false;
  end if;

  if v_inmueble.citas_desde is not null and p_fecha < v_inmueble.citas_desde then
    return false;
  end if;

  -- Franjas del arrendatario para esa fecha.
  if exists (
    select 1 from public.agenda_inmueble_ventanas w
    where w.inmueble_id = p_inmueble_id and w.fecha = p_fecha and w.tipo = 'bloqueo'
      and w.desde < p_hora_fin and w.hasta > p_hora_inicio
  ) then
    return false;
  end if;
  if exists (select 1 from public.agenda_inmueble_ventanas w where w.inmueble_id = p_inmueble_id and w.fecha = p_fecha and w.tipo = 'disponible')
     and not exists (
       select 1 from public.agenda_inmueble_ventanas w
       where w.inmueble_id = p_inmueble_id and w.fecha = p_fecha and w.tipo = 'disponible'
         and w.desde <= p_hora_inicio and w.hasta >= p_hora_fin
     ) then
    return false;
  end if;

  if exists (
    select 1 from public.agenda_citas c
    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
      and c.inmueble_id is distinct from p_inmueble_id
      and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
      and c.hora_inicio < p_hora_fin and c.hora_fin > p_hora_inicio
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.agenda_citas c
    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
      and c.inmueble_id = p_inmueble_id
      and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
      and c.hora_inicio < p_hora_fin and c.hora_fin > p_hora_inicio
  ) then
    if v_cfg.modo_mismo_inmueble = 'desactivado' then
      return false;
    end if;
  end if;

  if v_cfg.modo_mismo_inmueble <> 'desactivado' then
    for v_mismo in
      select c.hora_inicio from public.agenda_citas c
      where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
        and c.inmueble_id = p_inmueble_id
        and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
    loop
      v_buffer := case when v_cfg.modo_mismo_inmueble = 'simultaneo' then 0
                       else v_cfg.separacion_mismo_inmueble_minutos end;
      if v_buffer > 0 and abs(extract(epoch from (p_hora_inicio - v_mismo.hora_inicio)) / 60) < v_buffer then
        return false;
      end if;
    end loop;
  end if;

  select c.id, c.hora_fin, i.latitud as lat_i, i.longitud as lon_i into v_prevo
    from public.agenda_citas c
    join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
      and c.hora_fin <= p_hora_inicio
      and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
      and (c.inmueble_id is distinct from p_inmueble_id or v_cfg.modo_mismo_inmueble = 'desactivado')
    order by c.hora_fin desc
    limit 1;

  if found then
    v_dist := public.agenda_distancia_km(v_prevo.lat_i, v_prevo.lon_i, v_inmueble.latitud, v_inmueble.longitud);
    v_buffer := case when v_dist is null then v_cfg.minutos_traslado_entre_inmuebles * 2
                      else greatest(v_cfg.minutos_traslado_entre_inmuebles, ceil(v_dist * v_cfg.factor_red_vial / v_cfg.velocidad_estimada_kmh * 60)) end;
    if extract(epoch from (p_hora_inicio - v_prevo.hora_fin)) / 60 < v_buffer then
      return false;
    end if;
  end if;

  select c.id, c.hora_inicio, i.latitud as lat_i, i.longitud as lon_i into v_nexto
    from public.agenda_citas c
    join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
      and c.hora_inicio >= p_hora_fin
      and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
      and (c.inmueble_id is distinct from p_inmueble_id or v_cfg.modo_mismo_inmueble = 'desactivado')
    order by c.hora_inicio asc
    limit 1;

  if found then
    v_dist := public.agenda_distancia_km(v_inmueble.latitud, v_inmueble.longitud, v_nexto.lat_i, v_nexto.lon_i);
    v_buffer := case when v_dist is null then v_cfg.minutos_traslado_entre_inmuebles * 2
                      else greatest(v_cfg.minutos_traslado_entre_inmuebles, ceil(v_dist * v_cfg.factor_red_vial / v_cfg.velocidad_estimada_kmh * 60)) end;
    if extract(epoch from (v_nexto.hora_inicio - p_hora_fin)) / 60 < v_buffer then
      return false;
    end if;
  end if;

  return true;
end;
$function$;

-- agenda_sugerir_horarios: con franjas 'disponible' ese día, (a) el día puede estar fuera de los días permitidos,
-- (b) no se recorta por el horario semanal, (c) aunque el inmueble ya tenga cita ese día se ofrecen turnos de
-- "primera" dentro de la franja. Los turnos se validan con agenda_slot_disponible (que aplica las franjas).
create or replace function public.agenda_sugerir_horarios(p_empresa_id uuid, p_inmueble_id uuid, p_fecha date, p_intervalo_minutos integer default 30)
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

  v_duracion_visita := coalesce(v_inmueble.duracion_visita_minutos, v_cfg.duracion_visita_minutos);
  v_es_festivo := public.agenda_es_festivo(v_cfg.pais, p_fecha);
  v_ahora := (now() at time zone 'America/Bogota');
  v_minimo_datetime_mismo := v_ahora + (coalesce(v_cfg.horas_minimas_anticipacion_mismo_inmueble, 1) || ' hours')::interval;
  v_traslado := (v_cfg.minutos_traslado_entre_inmuebles || ' minutes')::interval;
  select exists(select 1 from public.agenda_citas c where c.inmueble_id = p_inmueble_id and c.fecha = p_fecha and c.estado <> 'cancelada') into v_inmueble_ya_tiene_cita;
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
      if v_inmueble.hora_visita_desde is not null and v_inmueble.hora_visita_desde > v_jornada_inicio then
        v_jornada_inicio := v_inmueble.hora_visita_desde;
      end if;
      if v_inmueble.hora_visita_hasta is not null and v_inmueble.hora_visita_hasta < v_jornada_fin then
        v_jornada_fin := v_inmueble.hora_visita_hasta;
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
               where c2.asesor_id = v_asesor.id and c2.fecha = p_fecha and c2.estado <> 'cancelada'
                 and (c2.hora_inicio >= v_medio_dia) = (v_slot_inicio >= v_medio_dia)
                 and coalesce(public.agenda_distancia_km(v_inmueble.latitud, v_inmueble.longitud, i2.latitud, i2.longitud), 0) > v_cfg.radio_zona_km
             )
           )
        then
          select min(public.agenda_distancia_km(v_inmueble.latitud, v_inmueble.longitud, i.latitud, i.longitud)) into v_dist_min
            from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
            where c.asesor_id = v_asesor.id and c.fecha = p_fecha and c.estado <> 'cancelada';
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
      for v_base in select c.hora_inicio, c.hora_fin from public.agenda_citas c where c.asesor_id = v_asesor.id and c.fecha = p_fecha and c.estado <> 'cancelada' and c.inmueble_id = p_inmueble_id loop
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
