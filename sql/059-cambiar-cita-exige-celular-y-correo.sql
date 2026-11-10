-- 059 · Ver o cambiar una cita desde la página pública exige celular Y correo
-- Aplicado en producción el 10-nov-2026.
--
-- Antes bastaba con conocer el celular O el correo de un cliente para ver sus citas
-- activas, obtener el id de una cita y moverla. Ahora las tres funciones exigen que
-- coincidan los dos datos (los mismos que el formulario ya pide). El frontend no cambia.
-- El camino recomendado para cambiar una cita sigue siendo el enlace /visita/ del correo.

begin;

create or replace function public.agenda_cliente_citas_activas(
  p_telefono text default '', p_email text default '', p_empresa_slug text default null, p_host text default null
) returns table(fecha date, hora_inicio time, numero_inmueble integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
begin
  if coalesce(trim(p_telefono), '') = '' or coalesce(trim(p_email), '') = '' then
    return;
  end if;
  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  return query
    select c.fecha, c.hora_inicio, i.numero_inmueble
    from public.agenda_citas c
    join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = v_empresa_id
      and c.estado <> 'cancelada'
      and c.tipo_cita = 'visita_cliente'
      and (c.fecha > current_date or (c.fecha = current_date and c.hora_inicio >= current_time))
      and c.cliente_telefono = trim(p_telefono)
      and lower(c.cliente_email) = lower(trim(p_email))
    order by c.fecha, c.hora_inicio;
end;
$$;

create or replace function public.agenda_cita_id_publica(
  p_telefono text default '', p_email text default '', p_fecha date default null, p_hora_inicio time default null, p_numero_inmueble integer default null,
  p_empresa_slug text default null, p_host text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_id uuid;
begin
  if coalesce(trim(p_telefono), '') = '' or coalesce(trim(p_email), '') = ''
     or p_fecha is null or p_hora_inicio is null or p_numero_inmueble is null then
    return null;
  end if;
  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select c.id into v_id
  from public.agenda_citas c
  join public.agenda_inmuebles i on i.id = c.inmueble_id
  where c.empresa_id = v_empresa_id
    and c.estado <> 'cancelada'
    and c.tipo_cita = 'visita_cliente'
    and c.fecha = p_fecha
    and c.hora_inicio = p_hora_inicio
    and i.numero_inmueble = p_numero_inmueble
    and c.cliente_telefono = trim(p_telefono)
    and lower(c.cliente_email) = lower(trim(p_email))
  limit 1;
  return v_id;
end;
$$;

-- La envoltura de reagendar (058) comprueba además que celular y correo sean los de la cita.
create or replace function public.agenda_reagendar_cita_publica(
  p_cita_id uuid, p_numero_inmueble integer, p_fecha date, p_hora_inicio time,
  p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text,
  p_empresa_slug text, p_host text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.agenda_citas c
    where c.id = p_cita_id
      and c.cliente_telefono = trim(coalesce(p_cliente_telefono, ''))
      and lower(c.cliente_email) = lower(trim(coalesce(p_cliente_email, '')))
  ) then
    raise exception 'El celular y el correo deben ser los mismos con los que agendaste. Si no los recuerdas, usa el enlace del correo de confirmación o escríbele a tu asesor.';
  end if;
  perform public.agenda_validar_reserva_publica(p_cliente_email, p_cliente_telefono, p_empresa_slug, p_host, p_cita_id);
  return public.agenda_reagendar_cita_publica_base(
    p_cita_id, p_numero_inmueble, p_fecha, p_hora_inicio,
    p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_empresa_slug, p_host);
end;
$$;

commit;
