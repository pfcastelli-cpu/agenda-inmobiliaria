-- 069 · (1) No se pueden crear ni mover citas a una hora que ya pasó.
--       (2) Un acompañante que es asesor queda ocupado en SU agenda durante la visita.
-- Cómo funciona (2): al agregar un asesor como acompañante se crea una cita "espejo" en su agenda (tipo «otro», título
-- «Acompaña visita #N», sin inmueble para no chocar con la cita principal). Esa cita bloquea sus horarios en todos los motores
-- (reserva pública, sugerencias, traslados) y se mueve o se cancela sola cuando se mueve o se cancela la cita principal.
-- Agregar o quitar acompañantes se hace por las funciones de abajo (el navegador ya no escribe directo en la tabla).
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

-- ============ (1) Citas en el pasado ============
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
      v_minimo := (now() at time zone 'America/Bogota') + (coalesce(v_asesor.horas_minimas_anticipacion, v_cfg.horas_minimas_anticipacion, 0) || ' hours')::interval;
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

create or replace function public.agenda_crear_cita(
  p_empresa_id uuid, p_inmueble_id uuid, p_asesor_id uuid, p_fecha date, p_hora_inicio time without time zone,
  p_cliente_nombre text, p_cliente_telefono text default ''::text, p_cliente_email text default ''::text, p_notas text default ''::text
) returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_cfg record;
  v_hora_fin time;
  v_id uuid;
begin
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if (p_fecha + p_hora_inicio) < (now() at time zone 'America/Bogota') then
    raise exception 'Esa hora ya pasó. Elige una fecha y hora posteriores a la actual.';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No hay configuración para esta empresa';
  end if;

  if not exists (select 1 from public.agenda_asesores a where a.id = p_asesor_id and a.empresa_id = p_empresa_id and a.activo) then
    raise exception 'Asesor no válido para esta empresa';
  end if;

  if not exists (select 1 from public.agenda_inmuebles i where i.id = p_inmueble_id and i.empresa_id = p_empresa_id) then
    raise exception 'Inmueble no válido para esta empresa';
  end if;

  v_hora_fin := p_hora_inicio + (v_cfg.duracion_visita_minutos || ' minutes')::interval;

  if not public.agenda_slot_disponible(p_empresa_id, p_asesor_id, p_inmueble_id, p_fecha, p_hora_inicio, v_hora_fin) then
    raise exception 'Ese horario ya no está disponible';
  end if;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, notas, creado_por
  ) values (
    p_empresa_id, p_inmueble_id, p_asesor_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- Mover una cita a una hora que ya pasó tampoco se permite (aunque se autorice el cruce).
create or replace function public.agenda_mover_cita(p_cita_id uuid, p_solicitante_asesor_id uuid, p_nueva_fecha date, p_nueva_hora_inicio time without time zone, p_forzar boolean default false)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_cita record;
  v_solicitante record;
  v_duracion int;
  v_hora_fin time;
  v_forzar boolean := coalesce(p_forzar, false);
begin
  select c.empresa_id, c.asesor_id, c.inmueble_id, c.estado, c.hora_inicio, c.hora_fin
    into v_cita from public.agenda_citas c where c.id = p_cita_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_cita.empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if p_solicitante_asesor_id is not null then
    select * into v_solicitante from public.agenda_asesores where id = p_solicitante_asesor_id and empresa_id = v_cita.empresa_id and activo;
    if not found then
      raise exception 'Asesor solicitante no válido';
    end if;
    if v_solicitante.rol not in ('admin','super_admin') and v_solicitante.id <> v_cita.asesor_id then
      raise exception 'Solo puedes mover tus propias citas';
    end if;
    if not public.agenda_asesor_tiene_permiso(p_solicitante_asesor_id, 'mover') then
      raise exception 'No tienes permiso para mover citas. Pide a un administrador que la reprograme.';
    end if;
  end if;
  if v_cita.estado = 'cancelada' then
    raise exception 'Esta cita ya está cancelada';
  end if;
  if v_forzar and not public.agenda_puede_cruzar(v_cita.empresa_id) then
    raise exception 'Tu empresa no permite agendar sobre un horario ocupado. Pide a un administrador que lo haga.';
  end if;
  if (p_nueva_fecha + p_nueva_hora_inicio) < (now() at time zone 'America/Bogota') then
    raise exception 'Esa hora ya pasó. Elige una fecha y hora posteriores a la actual.';
  end if;

  v_duracion := extract(epoch from (v_cita.hora_fin - v_cita.hora_inicio)) / 60;
  v_hora_fin := p_nueva_hora_inicio + (v_duracion || ' minutes')::interval;

  perform public.agenda_bloquear_dia(v_cita.empresa_id, p_nueva_fecha);

  if not v_forzar then
    if v_cita.inmueble_id is not null then
      if not public.agenda_slot_disponible(v_cita.empresa_id, v_cita.asesor_id, v_cita.inmueble_id, p_nueva_fecha, p_nueva_hora_inicio, v_hora_fin, p_cita_id) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    else
      if exists (
        select 1 from public.agenda_citas c
        where c.asesor_id = v_cita.asesor_id and c.fecha = p_nueva_fecha and c.estado <> 'cancelada' and c.id <> p_cita_id
          and c.hora_inicio < v_hora_fin and c.hora_fin > p_nueva_hora_inicio
      ) then
        raise exception 'El asesor ya tiene una cita en ese horario';
      end if;
    end if;
  else
    perform set_config('agenda.cruce_autorizado', 'on', true);
  end if;

  update public.agenda_citas
    set fecha = p_nueva_fecha, hora_inicio = p_nueva_hora_inicio, hora_fin = v_hora_fin, actualizado_en = now(),
        cruce_autorizado = case when v_forzar then true else cruce_autorizado end,
        cruce_autorizado_por = case when v_forzar then auth.uid() else cruce_autorizado_por end
    where id = p_cita_id;
end;
$function$;

-- ============ (2) Acompañantes que bloquean su propia agenda ============
alter table public.agenda_cita_participantes
  add column if not exists cita_espejo_id uuid references public.agenda_citas(id) on delete set null;

create or replace function public.agenda_agregar_participante(
  p_cita_id uuid, p_asesor_id uuid default null, p_nombre_libre text default null, p_forzar boolean default false
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c public.agenda_citas;
  a public.agenda_asesores;
  v_id uuid;
  v_espejo uuid;
  v_choque text;
  v_num text; v_dir text; v_ciu text; v_principal text;
begin
  select * into c from public.agenda_citas where id = p_cita_id;
  if not found then raise exception 'Cita no encontrada'; end if;
  if not public.agenda_es_admin_o_coord(c.empresa_id) then
    raise exception 'Solo administración o coordinación pueden agregar personas a una visita';
  end if;
  if c.estado = 'cancelada' then raise exception 'La cita está cancelada'; end if;

  if p_asesor_id is null then
    if nullif(btrim(coalesce(p_nombre_libre, '')), '') is null then raise exception 'Indica a quién se agrega'; end if;
    insert into public.agenda_cita_participantes (empresa_id, cita_id, nombre_libre, es_asesor)
      values (c.empresa_id, c.id, btrim(p_nombre_libre), false) returning id into v_id;
    return v_id;
  end if;

  select * into a from public.agenda_asesores where id = p_asesor_id and empresa_id = c.empresa_id and activo;
  if not found then raise exception 'Asesor no válido para esta empresa'; end if;
  if a.id = c.asesor_id then raise exception 'Ese asesor ya es el responsable de la visita'; end if;
  if exists (select 1 from public.agenda_cita_participantes p where p.cita_id = c.id and p.asesor_id = a.id) then
    raise exception 'Ya está agregado a esta visita';
  end if;

  -- ¿Ya tiene otra cita a esa hora?
  select coalesce('#' || i.numero_inmueble::text, nullif(x.titulo, ''), x.tipo_cita) into v_choque
    from public.agenda_citas x left join public.agenda_inmuebles i on i.id = x.inmueble_id
    where x.asesor_id = a.id and x.fecha = c.fecha and x.estado <> 'cancelada' and x.reubicacion_pendiente_desde is null
      and x.hora_inicio < c.hora_fin and x.hora_fin > c.hora_inicio
    limit 1;
  if v_choque is not null then
    if not (coalesce(p_forzar, false) and public.agenda_puede_cruzar(c.empresa_id)) then
      raise exception '% ya tiene otra cita (%) en ese horario', a.nombre, v_choque;
    end if;
    perform set_config('agenda.cruce_autorizado', 'on', true);
  end if;

  select i.numero_inmueble::text, i.direccion, i.ciudad into v_num, v_dir, v_ciu from public.agenda_inmuebles i where i.id = c.inmueble_id;
  select ap.nombre into v_principal from public.agenda_asesores ap where ap.id = c.asesor_id;

  insert into public.agenda_citas (empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, cliente_telefono, cliente_email,
                                   notas, creado_por, tipo_cita, titulo, direccion_libre, ciudad_libre, es_prueba)
  values (c.empresa_id, null, a.id, c.fecha, c.hora_inicio, c.hora_fin, '', '',
          'Acompaña la visita de ' || coalesce(v_principal, 'otro asesor'), auth.uid(), 'otro',
          'Acompaña visita' || coalesce(' #' || v_num, ''), coalesce(v_dir, c.direccion_libre, ''), coalesce(v_ciu, c.ciudad_libre, ''), c.es_prueba)
  returning id into v_espejo;

  insert into public.agenda_cita_participantes (empresa_id, cita_id, asesor_id, es_asesor, cita_espejo_id)
    values (c.empresa_id, c.id, a.id, coalesce(a.rol, 'asesor') = 'asesor', v_espejo) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.agenda_quitar_participante(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare p public.agenda_cita_participantes;
begin
  select * into p from public.agenda_cita_participantes where id = p_id;
  if not found then return; end if;
  if not public.agenda_es_admin_o_coord(p.empresa_id) then
    raise exception 'Solo administración o coordinación pueden quitar personas de una visita';
  end if;
  if p.cita_espejo_id is not null then
    update public.agenda_citas set estado = 'cancelada', motivo_cancelacion = 'Se quitó el acompañamiento', actualizado_en = now() where id = p.cita_espejo_id;
  end if;
  delete from public.agenda_cita_participantes where id = p_id;
end;
$function$;

revoke all on function public.agenda_agregar_participante(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.agenda_quitar_participante(uuid) from public, anon;
grant execute on function public.agenda_agregar_participante(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.agenda_quitar_participante(uuid) to authenticated, service_role;

-- El navegador ya no inserta ni borra directo: pasa por las funciones de arriba (así nunca queda un acompañante sin su cita espejo).
drop policy if exists participantes_alta on public.agenda_cita_participantes;
drop policy if exists participantes_baja on public.agenda_cita_participantes;
revoke insert, update, delete on public.agenda_cita_participantes from authenticated;

-- La cita espejo sigue a la principal: misma fecha y hora; si la principal se cancela, la espejo también.
create or replace function public.agenda_sincronizar_acompanantes()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.fecha is distinct from old.fecha or new.hora_inicio is distinct from old.hora_inicio
     or new.hora_fin is distinct from old.hora_fin or (new.estado = 'cancelada' and old.estado is distinct from 'cancelada') then
    update public.agenda_citas e
       set fecha = new.fecha, hora_inicio = new.hora_inicio, hora_fin = new.hora_fin,
           estado = case when new.estado = 'cancelada' then 'cancelada' else e.estado end,
           motivo_cancelacion = case when new.estado = 'cancelada' then 'Se canceló la visita principal' else e.motivo_cancelacion end,
           actualizado_en = now()
      from public.agenda_cita_participantes p
     where p.cita_id = new.id and p.cita_espejo_id = e.id and e.estado <> 'cancelada';
  end if;
  return new;
end;
$function$;
revoke all on function public.agenda_sincronizar_acompanantes() from public, anon, authenticated;

drop trigger if exists agenda_citas_sincronizar_acompanantes on public.agenda_citas;
create trigger agenda_citas_sincronizar_acompanantes
  after update of fecha, hora_inicio, hora_fin, estado on public.agenda_citas
  for each row execute function public.agenda_sincronizar_acompanantes();

-- Acompañantes que ya estaban agregados antes de este cambio: se les crea su cita espejo (si no chocan con otra).
do $$
declare r record; v_espejo uuid;
begin
  for r in
    select p.id as pid, p.asesor_id, c.*
      from public.agenda_cita_participantes p join public.agenda_citas c on c.id = p.cita_id
     where p.asesor_id is not null and p.cita_espejo_id is null and c.estado <> 'cancelada' and c.fecha >= (now() at time zone 'America/Bogota')::date
  loop
    begin
      insert into public.agenda_citas (empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin, cliente_telefono, cliente_email,
                                       notas, tipo_cita, titulo, direccion_libre, ciudad_libre, es_prueba)
      values (r.empresa_id, null, r.asesor_id, r.fecha, r.hora_inicio, r.hora_fin, '', '', 'Acompaña una visita', 'otro',
              'Acompaña visita' || coalesce((select ' #' || i.numero_inmueble::text from public.agenda_inmuebles i where i.id = r.inmueble_id), ''),
              coalesce((select i.direccion from public.agenda_inmuebles i where i.id = r.inmueble_id), r.direccion_libre, ''),
              coalesce((select i.ciudad from public.agenda_inmuebles i where i.id = r.inmueble_id), r.ciudad_libre, ''), r.es_prueba)
      returning id into v_espejo;
      update public.agenda_cita_participantes set cita_espejo_id = v_espejo where id = r.pid;
    exception when others then
      null; -- si choca con otra cita del acompañante, se deja sin espejo (no se inventan cruces)
    end;
  end loop;
end $$;
