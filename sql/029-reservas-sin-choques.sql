-- 029 · Reservas simultáneas: nadie puede quedarse con un horario que otra persona ya tomó
-- Problema: agenda_agendar_cita_publica / agenda_reagendar_cita_publica / agenda_crear_cita_interna / agenda_mover_cita
-- primero miran si el horario está libre y después insertan. Sin candado, dos personas que confirman al mismo
-- tiempo ven el horario libre y las dos entran (doble reserva con el mismo asesor o en el mismo inmueble).
-- Solución en dos capas (la base es la que manda, no el navegador):
--   1) un candado por empresa y día que serializa las reservas de ese día: la segunda persona espera unos
--      milisegundos, vuelve a mirar la agenda ya con la reserva de la primera y recibe «ese horario ya no está
--      disponible» (o, en la reserva pública, otro asesor libre si lo hay);
--   2) una regla (trigger) sobre agenda_citas que rechaza cruces reales: el mismo asesor en dos citas que se
--      traslapan (salvo visitas simultáneas al mismo inmueble si la empresa lo permite) o dos asesores distintos
--      al mismo tiempo en el mismo inmueble. Solo mira citas de hoy en adelante y solo cuando cambia algo
--      (fecha, hora, asesor, inmueble o se reactiva una cancelada), así no toca historial ni importaciones viejas.
-- Aplicar en Supabase (SQL Editor o CLI). Es seguro repetirlo.

-- 1) Candado compartido ------------------------------------------------------------------------------
create or replace function public.agenda_bloquear_dia(p_empresa_id uuid, p_fecha date)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_fecha::text, 0));
end;
$function$;

revoke all on function public.agenda_bloquear_dia(uuid, date) from public, anon;
grant execute on function public.agenda_bloquear_dia(uuid, date) to authenticated, service_role;

-- 2) Regla en la tabla de citas ---------------------------------------------------------------------
create or replace function public.agenda_citas_sin_choque()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_modo text;
begin
  if new.estado = 'cancelada' or new.fecha is null or new.hora_inicio is null or new.hora_fin is null then
    return new;
  end if;
  -- Historial: lo que ya pasó no se vuelve a validar.
  if new.fecha < (now() at time zone 'America/Bogota')::date then
    return new;
  end if;
  -- Solo cuando cambia lo que afecta el cruce.
  if tg_op = 'UPDATE' and old.estado <> 'cancelada'
     and new.fecha = old.fecha and new.hora_inicio = old.hora_inicio and new.hora_fin = old.hora_fin
     and new.asesor_id is not distinct from old.asesor_id and new.inmueble_id is not distinct from old.inmueble_id then
    return new;
  end if;

  perform public.agenda_bloquear_dia(new.empresa_id, new.fecha);

  select modo_mismo_inmueble into v_modo from public.agenda_configuracion where empresa_id = new.empresa_id;

  if exists (
    select 1 from public.agenda_citas c
    where c.id <> new.id and c.empresa_id = new.empresa_id and c.fecha = new.fecha and c.estado <> 'cancelada'
      and c.hora_inicio < new.hora_fin and c.hora_fin > new.hora_inicio
      and (
        -- mismo asesor en dos lugares a la vez (o dos veces en el mismo inmueble si la empresa no permite simultáneas)
        (c.asesor_id = new.asesor_id and (c.inmueble_id is distinct from new.inmueble_id or coalesce(v_modo, 'desactivado') = 'desactivado'))
        -- dos asesores distintos a la vez en el mismo inmueble
        or (new.inmueble_id is not null and c.inmueble_id = new.inmueble_id and c.asesor_id is distinct from new.asesor_id)
      )
  ) then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;
  return new;
end;
$function$;

drop trigger if exists agenda_citas_sin_choque_trg on public.agenda_citas;
create trigger agenda_citas_sin_choque_trg
  before insert or update on public.agenda_citas
  for each row execute function public.agenda_citas_sin_choque();

-- 3) Reserva pública: bloquear el día ANTES de elegir asesor, así quien llega segundo recalcula con la agenda real ---
create or replace function public.agenda_agendar_cita_publica(
  p_numero_inmueble integer, p_fecha date, p_hora_inicio time without time zone,
  p_cliente_nombre text, p_cliente_telefono text default ''::text, p_cliente_email text default ''::text,
  p_empresa_slug text default null::text, p_host text default null::text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id uuid;
  v_inmueble record;
  v_cfg record;
  v_hora_fin time;
  v_elegido record;
  v_id uuid;
begin
  if p_cliente_nombre is null or length(trim(p_cliente_nombre)) < 2 then
    raise exception 'Escribe tu nombre completo';
  end if;
  if p_cliente_email is null or trim(p_cliente_email) = '' or p_cliente_email not like '%@%.%' then
    raise exception 'Escribe un correo electrónico válido. Allí enviaremos los datos de tu asesor y de la visita.';
  end if;
  if p_cliente_telefono is null or length(regexp_replace(p_cliente_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Escribe un número de celular válido. Por ahí te contactará tu asesor.';
  end if;

  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);

  select * into v_inmueble from public.agenda_inmuebles
    where empresa_id = v_empresa_id and numero_inmueble = p_numero_inmueble and disponible;
  if not found then
    raise exception 'Inmueble no encontrado o no disponible';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = v_empresa_id;
  v_hora_fin := p_hora_inicio + (v_cfg.duracion_visita_minutos || ' minutes')::interval;

  perform public.agenda_bloquear_dia(v_empresa_id, p_fecha);

  select s.asesor_id, s.hora_fin into v_elegido
    from public.agenda_sugerir_horarios(v_empresa_id, v_inmueble.id, p_fecha, 30) s
    where s.hora_inicio = p_hora_inicio
    order by s.prioridad
    limit 1;

  if v_elegido.asesor_id is null then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, tipo_cita, creado_por
  ) values (
    v_empresa_id, v_inmueble.id, v_elegido.asesor_id, p_fecha, p_hora_inicio, v_elegido.hora_fin,
    trim(p_cliente_nombre), trim(p_cliente_telefono), trim(p_cliente_email), 'visita_cliente', null
  ) returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.agenda_reagendar_cita_publica(
  p_cita_id uuid, p_numero_inmueble integer, p_fecha date, p_hora_inicio time without time zone,
  p_cliente_nombre text, p_cliente_telefono text default ''::text, p_cliente_email text default ''::text,
  p_empresa_slug text default null::text, p_host text default null::text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id uuid;
  v_cita_vieja record;
  v_inmueble record;
  v_cfg record;
  v_hora_fin time;
  v_elegido record;
  v_id uuid;
begin
  if p_cliente_nombre is null or length(trim(p_cliente_nombre)) < 2 then
    raise exception 'Escribe tu nombre completo';
  end if;
  if p_cliente_email is null or trim(p_cliente_email) = '' or p_cliente_email not like '%@%.%' then
    raise exception 'Escribe un correo electrónico válido. Allí enviaremos los datos de tu asesor y de la visita.';
  end if;
  if p_cliente_telefono is null or length(regexp_replace(p_cliente_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Escribe un número de celular válido. Por ahí te contactará tu asesor.';
  end if;

  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);

  select * into v_cita_vieja from public.agenda_citas
    where id = p_cita_id and empresa_id = v_empresa_id and estado <> 'cancelada' and tipo_cita = 'visita_cliente';
  if not found then
    raise exception 'No encontramos esa cita activa para cambiar.';
  end if;

  if not (
    (trim(coalesce(p_cliente_telefono,'')) <> '' and v_cita_vieja.cliente_telefono = trim(p_cliente_telefono))
    or (trim(coalesce(p_cliente_email,'')) <> '' and lower(v_cita_vieja.cliente_email) = lower(trim(p_cliente_email)))
  ) then
    raise exception 'El celular o correo no coincide con los de esa cita. Por seguridad no podemos cambiarla así.';
  end if;

  select * into v_inmueble from public.agenda_inmuebles
    where empresa_id = v_empresa_id and numero_inmueble = p_numero_inmueble and disponible;
  if not found then
    raise exception 'Inmueble no encontrado o no disponible';
  end if;

  if v_inmueble.id <> v_cita_vieja.inmueble_id then
    raise exception 'Solo puedes cambiar la fecha u hora de esta cita, no el inmueble.';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = v_empresa_id;
  v_hora_fin := p_hora_inicio + (v_cfg.duracion_visita_minutos || ' minutes')::interval;

  perform public.agenda_bloquear_dia(v_empresa_id, p_fecha);

  select s.asesor_id, s.hora_fin into v_elegido
    from public.agenda_sugerir_horarios(v_empresa_id, v_inmueble.id, p_fecha, 30) s
    where s.hora_inicio = p_hora_inicio
    order by s.prioridad
    limit 1;

  if v_elegido.asesor_id is null then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;

  update public.agenda_citas
    set estado = 'cancelada',
        motivo_cancelacion = 'Reagendada por el cliente a nueva fecha/hora',
        actualizado_en = now()
    where id = v_cita_vieja.id;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, tipo_cita, creado_por
  ) values (
    v_empresa_id, v_inmueble.id, v_elegido.asesor_id, p_fecha, p_hora_inicio, v_elegido.hora_fin,
    trim(p_cliente_nombre), trim(p_cliente_telefono), trim(p_cliente_email), 'visita_cliente', null
  ) returning id into v_id;

  return v_id;
end;
$function$;
