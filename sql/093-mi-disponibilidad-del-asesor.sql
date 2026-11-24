-- 093 · «Mi disponibilidad»: cada asesor edita SU jornada, almuerzo, atención de sábado/domingo/festivos y sus ausencias
-- (vacaciones, incapacidades, días libres) sin depender de un administrador.
-- · Es un PERMISO del rol (disponibilidad.editar_propia): el administrador lo activa o quita por rol en Roles y permisos.
--   Por defecto lo tienen Administrador, Coordinador y Asesor del sistema; los roles personalizados NO (se les da a mano).
-- · No se abre la tabla agenda_asesores (tiene datos sensibles): todo pasa por funciones SECURITY DEFINER que solo tocan la
--   ficha ligada al usuario que llama (agenda_asesores.usuario_id = auth.uid()) y validan el permiso.
-- · Quedan igual solo para el administrador: prioridad, vinculación, ciudades/zonas, anticipaciones, rol, correos y acceso.
-- · Cierra un hueco: hasta ahora CUALQUIER miembro de la empresa podía (por la API) borrar ausencias de otros o agregar/quitar
--   festivos. Ahora las ausencias se leen por los miembros pero solo las escribe el administrador (o el propio asesor por función),
--   y los festivos solo los escribe un administrador.
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

-- ============ 1) Permiso nuevo ============
insert into public.agenda_permisos (clave, categoria, nombre, descripcion, orden) values
  ('disponibilidad.editar_propia', 'Equipo', 'Editar su propia disponibilidad',
   'Su jornada, almuerzo, si atiende sábado, domingo o festivos, y registrar sus vacaciones, incapacidades o días libres.', 305)
on conflict (clave) do update set categoria = excluded.categoria, nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

-- Roles del sistema que ya existen (no se tocan los personalizados).
insert into public.agenda_rol_permisos (rol_id, permiso)
select r.id, 'disponibilidad.editar_propia'
  from public.agenda_roles r
 where r.es_sistema and r.clave in ('administrador', 'coordinador', 'asesor')
on conflict do nothing;

-- Empresas nuevas: la siembra de roles incluye el permiso para coordinador y asesor (el administrador ya recibe todos).
create or replace function public.agenda_roles_sembrar(p_empresa_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_super uuid; v_admin uuid; v_coord uuid; v_asesor uuid;
begin
  insert into public.agenda_roles (empresa_id, clave, nombre, descripcion, base, es_super, es_sistema) values
    (p_empresa_id, 'superadministrador', 'Superadministrador', 'Puede todo, siempre. Es el único que no se puede editar.', 'administrador', true, true),
    (p_empresa_id, 'administrador', 'Administrador', 'Gestiona la operación y la configuración, pero no los roles.', 'administrador', false, true),
    (p_empresa_id, 'coordinador', 'Coordinador', 'Ve toda la agenda, los informes y la bitácora.', 'coordinador', false, true),
    (p_empresa_id, 'asesor', 'Asesor', 'Trabaja su propia agenda.', 'asesor', false, true)
  on conflict (empresa_id, clave) where clave is not null do nothing;
  select id into v_super from public.agenda_roles where empresa_id = p_empresa_id and clave = 'superadministrador';
  select id into v_admin from public.agenda_roles where empresa_id = p_empresa_id and clave = 'administrador';
  select id into v_coord from public.agenda_roles where empresa_id = p_empresa_id and clave = 'coordinador';
  select id into v_asesor from public.agenda_roles where empresa_id = p_empresa_id and clave = 'asesor';
  -- Los permisos iniciales solo se cargan si el rol aún no tiene ninguno (así no se pisan los cambios que haga la empresa).
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_admin) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_admin, clave from public.agenda_permisos where clave <> 'roles.gestionar';
  end if;
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_coord) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_coord, unnest(array[
      'agenda.ver_propia','agenda.ver_todas','agenda.crear','agenda.modificar','agenda.cancelar','agenda.reubicar','agenda.actividades',
      'inmuebles.ver','inmuebles.editar','inmuebles.no_disponible','equipo.ver','informes.ver','informes.exportar','informes.demanda',
      'bitacora.ver','pendientes.ver','pendientes.gestionar','captacion.ver','captacion.crear','soporte.crear','soporte.ver_empresa','roles.ver',
      'disponibilidad.editar_propia']);
  end if;
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_asesor) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_asesor, unnest(array[
      'agenda.ver_propia','agenda.crear','agenda.modificar','agenda.cancelar','agenda.actividades','inmuebles.ver',
      'pendientes.ver','captacion.ver','captacion.crear','soporte.crear','disponibilidad.editar_propia']);
  end if;
end;
$$;
revoke all on function public.agenda_roles_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.agenda_roles_sembrar(uuid) to service_role;

-- ============ 2) Ficha propia (solo si tiene el permiso) ============
create or replace function public.agenda_mi_asesor_id(p_empresa_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para continuar'; end if;
  if not public.agenda_tiene_permiso(p_empresa_id, 'disponibilidad.editar_propia') then
    raise exception 'Tu rol no puede editar la disponibilidad. Pídeselo a un administrador.';
  end if;
  select a.id into v_id from public.agenda_asesores a
   where a.empresa_id = p_empresa_id and a.usuario_id = auth.uid() and a.activo
   limit 1;
  if v_id is null then raise exception 'Tu usuario no tiene una ficha de asesor activa en esta empresa'; end if;
  return v_id;
end;
$$;
revoke all on function public.agenda_mi_asesor_id(uuid) from public, anon;
grant execute on function public.agenda_mi_asesor_id(uuid) to authenticated, service_role;

-- ============ 3) Leer mi disponibilidad ============
create or replace function public.agenda_mi_disponibilidad(p_empresa_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_a record; v_cfg record; v_aus jsonb;
begin
  v_id := public.agenda_mi_asesor_id(p_empresa_id);
  select * into v_a from public.agenda_asesores where id = v_id;
  select c.almuerzo_activo, c.almuerzo_inicio, c.almuerzo_fin into v_cfg from public.agenda_configuracion c where c.empresa_id = p_empresa_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'fecha_inicio', x.fecha_inicio, 'fecha_fin', x.fecha_fin, 'motivo', x.motivo)
                           order by x.fecha_inicio desc), '[]'::jsonb)
    into v_aus
    from public.agenda_asesores_ausencias x
   where x.asesor_id = v_id and x.fecha_fin >= current_date - 30;
  return jsonb_build_object(
    'asesor_id', v_a.id, 'nombre', v_a.nombre, 'tipo_vinculacion', v_a.tipo_vinculacion,
    'jornada_inicio', v_a.jornada_inicio, 'jornada_fin', v_a.jornada_fin,
    'atiende_sabado', v_a.atiende_sabado, 'jornada_fin_sabado', v_a.jornada_fin_sabado,
    'atiende_domingo', v_a.atiende_domingo, 'atiende_festivos', v_a.atiende_festivos,
    'almuerzo_activo', v_a.almuerzo_activo, 'almuerzo_inicio', v_a.almuerzo_inicio, 'almuerzo_fin', v_a.almuerzo_fin,
    'empresa_almuerzo_activo', v_cfg.almuerzo_activo, 'empresa_almuerzo_inicio', v_cfg.almuerzo_inicio, 'empresa_almuerzo_fin', v_cfg.almuerzo_fin,
    'ausencias', v_aus);
end;
$$;
revoke all on function public.agenda_mi_disponibilidad(uuid) from public, anon;
grant execute on function public.agenda_mi_disponibilidad(uuid) to authenticated, service_role;

-- ============ 4) Guardar mi jornada ============
-- p_almuerzo: 'empresa' (usa el de la empresa) | 'propio' (el que se indica) | 'sin' (no tiene almuerzo).
create or replace function public.agenda_mi_disponibilidad_guardar(
  p_empresa_id uuid, p_jornada_inicio time, p_jornada_fin time,
  p_atiende_sabado boolean, p_jornada_fin_sabado time, p_atiende_domingo boolean, p_atiende_festivos boolean,
  p_almuerzo text default 'empresa', p_almuerzo_inicio time default null, p_almuerzo_fin time default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.agenda_mi_asesor_id(p_empresa_id);
  if p_jornada_inicio is null or p_jornada_fin is null or p_jornada_inicio >= p_jornada_fin then
    raise exception 'La hora de inicio de la jornada debe ser anterior a la de fin';
  end if;
  if coalesce(p_atiende_sabado, false) and (p_jornada_fin_sabado is null or p_jornada_fin_sabado <= p_jornada_inicio) then
    raise exception 'Indica hasta qué hora atiendes el sábado (después de tu hora de inicio)';
  end if;
  if p_almuerzo not in ('empresa', 'propio', 'sin') then raise exception 'Opción de almuerzo no válida'; end if;
  if p_almuerzo = 'propio' and (p_almuerzo_inicio is null or p_almuerzo_fin is null or p_almuerzo_inicio >= p_almuerzo_fin) then
    raise exception 'El almuerzo debe empezar antes de terminar';
  end if;
  update public.agenda_asesores set
    jornada_inicio = p_jornada_inicio,
    jornada_fin = p_jornada_fin,
    atiende_sabado = coalesce(p_atiende_sabado, false),
    jornada_fin_sabado = case when coalesce(p_atiende_sabado, false) then p_jornada_fin_sabado else jornada_fin_sabado end,
    atiende_domingo = coalesce(p_atiende_domingo, false),
    atiende_festivos = coalesce(p_atiende_festivos, false),
    almuerzo_activo = case p_almuerzo when 'propio' then true when 'sin' then false else null end,
    almuerzo_inicio = case when p_almuerzo = 'propio' then p_almuerzo_inicio end,
    almuerzo_fin = case when p_almuerzo = 'propio' then p_almuerzo_fin end
  where id = v_id and empresa_id = p_empresa_id;
end;
$$;
revoke all on function public.agenda_mi_disponibilidad_guardar(uuid, time, time, boolean, time, boolean, boolean, text, time, time) from public, anon;
grant execute on function public.agenda_mi_disponibilidad_guardar(uuid, time, time, boolean, time, boolean, boolean, text, time, time) to authenticated, service_role;

-- ============ 5) Ausencias propias ============
-- Devuelve cuántas citas vigentes ya tiene en esas fechas, para avisarle que hay que reubicarlas.
create or replace function public.agenda_mi_ausencia_agregar(p_empresa_id uuid, p_inicio date, p_fin date, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nuevo uuid; v_citas integer;
begin
  v_id := public.agenda_mi_asesor_id(p_empresa_id);
  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'La fecha final no puede ser anterior a la inicial'; end if;
  if p_fin < current_date then raise exception 'Las fechas ya pasaron'; end if;
  if p_fin - p_inicio > 365 then raise exception 'Una ausencia no puede durar más de un año'; end if;
  if p_motivo is not null and length(p_motivo) > 120 then raise exception 'El motivo es demasiado largo (máximo 120 letras)'; end if;
  if exists (select 1 from public.agenda_asesores_ausencias x where x.asesor_id = v_id and x.fecha_inicio = p_inicio and x.fecha_fin = p_fin) then
    raise exception 'Ya registraste una ausencia con esas mismas fechas';
  end if;
  insert into public.agenda_asesores_ausencias (asesor_id, fecha_inicio, fecha_fin, motivo)
  values (v_id, p_inicio, p_fin, nullif(btrim(coalesce(p_motivo, '')), '')) returning id into v_nuevo;
  select count(*) into v_citas from public.agenda_citas c
   where c.asesor_id = v_id and c.fecha between greatest(p_inicio, current_date) and p_fin and c.estado <> 'cancelada';
  return jsonb_build_object('id', v_nuevo, 'citas_afectadas', v_citas);
end;
$$;
revoke all on function public.agenda_mi_ausencia_agregar(uuid, date, date, text) from public, anon;
grant execute on function public.agenda_mi_ausencia_agregar(uuid, date, date, text) to authenticated, service_role;

create or replace function public.agenda_mi_ausencia_eliminar(p_empresa_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := public.agenda_mi_asesor_id(p_empresa_id);
  delete from public.agenda_asesores_ausencias where id = p_id and asesor_id = v_id;
end;
$$;
revoke all on function public.agenda_mi_ausencia_eliminar(uuid, uuid) from public, anon;
grant execute on function public.agenda_mi_ausencia_eliminar(uuid, uuid) to authenticated, service_role;

-- ============ 6) Cerrar permisos demasiado abiertos ============
-- Ausencias: los miembros de la empresa las LEEN (los motores de horarios las necesitan); solo el administrador las escribe directo.
drop policy if exists miembros_administran_ausencias on public.agenda_asesores_ausencias;
drop policy if exists ausencias_leer on public.agenda_asesores_ausencias;
drop policy if exists ausencias_admin_escribir on public.agenda_asesores_ausencias;
create policy ausencias_leer on public.agenda_asesores_ausencias for select to authenticated
  using (asesor_id in (select a.id from public.agenda_asesores a
                        where a.empresa_id in (select m.empresa_id from public.agenda_miembros m where m.usuario_id = auth.uid() and m.activo)));
create policy ausencias_admin_escribir on public.agenda_asesores_ausencias for all to authenticated
  using (asesor_id in (select a.id from public.agenda_asesores a where public.agenda_es_admin(a.empresa_id)))
  with check (asesor_id in (select a.id from public.agenda_asesores a where public.agenda_es_admin(a.empresa_id)));

-- Festivos: se leen por todos; solo un administrador agrega o quita.
drop policy if exists miembros_eliminan_festivos on public.agenda_festivos;
drop policy if exists miembros_administran_festivos on public.agenda_festivos;
create policy festivos_admin_eliminan on public.agenda_festivos for delete to authenticated
  using (exists (select 1 from public.agenda_miembros m where m.usuario_id = auth.uid() and m.activo and m.rol = 'administrador'));
create policy festivos_admin_agregan on public.agenda_festivos for insert to authenticated
  with check (exists (select 1 from public.agenda_miembros m where m.usuario_id = auth.uid() and m.activo and m.rol = 'administrador'));
