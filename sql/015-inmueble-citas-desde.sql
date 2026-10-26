-- 015: "Citas desde" por inmueble. Para inmuebles que todavía no se entregan: se programa una fecha y las
-- visitas solo se pueden agendar a partir de ese día. Sin fecha (null) todo funciona como siempre.
-- La regla vive en agenda_slot_disponible (la usan agendar, mover y los portales) y también en
-- agenda_sugerir_horarios (para no ofrecer días anteriores). Se reescriben las funciones existentes con
-- replace() para que el resto de su lógica quede exactamente igual.

alter table public.agenda_inmuebles add column if not exists citas_desde date;

do $$
declare
  d text;
  nuevo text;
begin
  -- agenda_slot_disponible: ninguna cita antes de la fecha programada
  d := pg_get_functiondef('public.agenda_slot_disponible(uuid,uuid,uuid,date,time,time,uuid)'::regprocedure);
  nuevo := replace(
    d,
    E'  if exists (\n    select 1 from public.agenda_citas c\n    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> ''cancelada''\n      and c.inmueble_id is distinct from p_inmueble_id',
    E'  if v_inmueble.citas_desde is not null and p_fecha < v_inmueble.citas_desde then\n    return false;\n  end if;\n\n  if exists (\n    select 1 from public.agenda_citas c\n    where c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> ''cancelada''\n      and c.inmueble_id is distinct from p_inmueble_id'
  );
  if nuevo = d then raise exception 'No se pudo modificar agenda_slot_disponible; no se cambió nada.'; end if;
  execute nuevo;

  -- agenda_sugerir_horarios: no ofrecer días anteriores a la fecha programada
  d := pg_get_functiondef('public.agenda_sugerir_horarios(uuid,uuid,date,integer)'::regprocedure);
  nuevo := replace(
    d,
    E'  -- Restricción por días permitidos del inmueble',
    E'  -- Inmueble aún no entregado: las citas empiezan en la fecha programada.\n  if v_inmueble.citas_desde is not null and p_fecha < v_inmueble.citas_desde then\n    return;\n  end if;\n\n  -- Restricción por días permitidos del inmueble'
  );
  if nuevo = d then raise exception 'No se pudo modificar agenda_sugerir_horarios; no se cambió nada.'; end if;
  execute nuevo;
end $$;

-- La RPC que guarda la restricción de horario ahora también guarda la fecha (opcional).
drop function if exists public.agenda_actualizar_restriccion_inmueble(uuid, smallint[], time, time, smallint);

create or replace function public.agenda_actualizar_restriccion_inmueble(
  p_inmueble_id uuid,
  p_dias_permitidos smallint[],
  p_hora_desde time,
  p_hora_hasta time,
  p_duracion_minutos smallint default null,
  p_citas_desde date default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
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
        citas_desde = p_citas_desde
    where id = p_inmueble_id;
end;
$$;

revoke all on function public.agenda_actualizar_restriccion_inmueble(uuid, smallint[], time, time, smallint, date) from public, anon;
grant execute on function public.agenda_actualizar_restriccion_inmueble(uuid, smallint[], time, time, smallint, date) to authenticated, service_role;
