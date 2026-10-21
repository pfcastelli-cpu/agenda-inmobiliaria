-- 009 · Los pendientes que salen de los portales los cierra el sistema, no una persona.
-- Ejecutado en producción el 21-oct-2026 (migración "pendientes_portales_solo_sistema").
--
-- Cambia agenda_pendiente_actualizar (creada en 008):
--   * Un pendiente con origen 'portales' no se puede pasar a 'cerrado' a mano: se cierra solo cuando
--     el siguiente Excel del portal ya no muestra el problema (agenda_portales_guardar).
--   * Descartar ("no aplica") y reabrir un descartado solo puede hacerlo administrador/coordinador, y
--     descartar exige un motivo escrito.
--   * "En proceso" / volver a "abierto" lo puede hacer quien ve el pendiente (el asesor responsable).
create or replace function public.agenda_pendiente_actualizar(p_id uuid, p_estado text, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_p public.agenda_pendientes%rowtype;
  v_rol text;
begin
  if p_estado not in ('abierto','en_proceso','cerrado','descartado') then
    raise exception 'Estado no válido';
  end if;
  select * into v_p from public.agenda_pendientes where id = p_id;
  if not found or not public.agenda_puede_ver_pendiente(v_p.empresa_id, v_p.nivel, v_p.responsable_usuario_id) then
    raise exception 'No tienes acceso a este pendiente';
  end if;
  v_rol := public.agenda_rol_actual(v_p.empresa_id);

  if p_estado = 'cerrado' and v_p.origen = 'portales' then
    raise exception 'Este pendiente lo marca como resuelto el sistema cuando el próximo Excel del portal ya no muestre el problema.';
  end if;
  if p_estado = 'descartado' then
    if v_rol not in ('administrador','coordinador') then
      raise exception 'Solo administrador o coordinador pueden descartar un pendiente';
    end if;
    if nullif(btrim(coalesce(p_nota,'')), '') is null then
      raise exception 'Para descartar hay que escribir el motivo';
    end if;
  end if;
  if v_p.estado in ('cerrado','descartado') and p_estado in ('abierto','en_proceso')
     and (v_rol not in ('administrador','coordinador') or v_p.estado = 'cerrado') then
    raise exception 'Este pendiente ya está resuelto';
  end if;

  update public.agenda_pendientes set
    estado = p_estado,
    actualizado_en = now(),
    cerrado_en = case when p_estado in ('cerrado','descartado') then now() else null end,
    cerrado_por = case when p_estado in ('cerrado','descartado') then auth.uid() else null end,
    cierre_tipo = case when p_estado in ('cerrado','descartado') then 'manual' else null end,
    nota_cierre = case when p_estado in ('cerrado','descartado') then nullif(btrim(coalesce(p_nota,'')), '') else null end
  where id = p_id;
end;
$$;
revoke all on function public.agenda_pendiente_actualizar(uuid, text, text) from public, anon;
grant execute on function public.agenda_pendiente_actualizar(uuid, text, text) to authenticated, service_role;
