-- 057: eliminar asesores desde Equipo y limpiar datos de prueba.
-- Causa de "no puedo eliminar asesores": la interfaz solo tenía Desactivar/Reactivar y
-- agenda_asesores no tiene política RLS de DELETE (un borrado directo no afecta ninguna fila).
-- Se usan dos funciones con control de administrador en lugar de abrir un DELETE general.

create or replace function public.agenda_eliminar_asesor(p_asesor_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_nombre text;
  v_reales int;
  v_prueba int;
begin
  select empresa_id, nombre into v_empresa, v_nombre from public.agenda_asesores where id = p_asesor_id;
  if not found then raise exception 'Asesor no encontrado'; end if;
  if not public.agenda_es_admin(v_empresa) then raise exception 'Solo un administrador puede eliminar asesores'; end if;

  select count(*) filter (where not es_prueba), count(*) filter (where es_prueba)
    into v_reales, v_prueba from public.agenda_citas where asesor_id = p_asesor_id;
  if v_reales > 0 then
    raise exception '% tiene % cita(s) en su historial. Para no perder ese historial, desactívalo en lugar de eliminarlo.', v_nombre, v_reales;
  end if;

  delete from public.agenda_citas where asesor_id = p_asesor_id and es_prueba;
  delete from public.agenda_asesores where id = p_asesor_id;
  return jsonb_build_object('asesor', v_nombre, 'citas_prueba_borradas', v_prueba);
end;
$function$;

create or replace function public.agenda_limpiar_datos_prueba(p_empresa_id uuid, p_ejecutar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_asesores uuid[];
  v_usuarios uuid[];
  v_citas int;
begin
  if not public.agenda_es_admin(p_empresa_id) then raise exception 'Solo un administrador puede limpiar datos de prueba'; end if;

  select coalesce(array_agg(id), '{}') into v_asesores from public.agenda_asesores
   where empresa_id = p_empresa_id and (nombre like '[SIM]%' or lower(correo) like 'sim+%@example.com');

  select coalesce(array_agg(m.usuario_id), '{}') into v_usuarios
    from public.agenda_miembros m join auth.users u on u.id = m.usuario_id
   where m.empresa_id = p_empresa_id and m.usuario_id <> auth.uid() and lower(u.email) like 'sim+%@example.com';

  select count(*) into v_citas from public.agenda_citas
   where empresa_id = p_empresa_id and (es_prueba or asesor_id = any(v_asesores));

  if p_ejecutar then
    delete from public.agenda_citas where empresa_id = p_empresa_id and (es_prueba or asesor_id = any(v_asesores));
    update public.agenda_asesores set usuario_id = null where usuario_id = any(v_usuarios);
    delete from public.agenda_asesores where id = any(v_asesores);
    update public.agenda_citas set actualizado_por = null where actualizado_por = any(v_usuarios);
    update public.agenda_inmuebles set no_disponible_por = null where no_disponible_por = any(v_usuarios);
    delete from public.agenda_miembros where usuario_id = any(v_usuarios);
    delete from auth.users where id = any(v_usuarios);
  end if;

  return jsonb_build_object('ejecutado', p_ejecutar, 'citas', v_citas,
    'asesores', cardinality(v_asesores), 'usuarios', cardinality(v_usuarios));
end;
$function$;

revoke all on function public.agenda_eliminar_asesor(uuid) from public, anon;
revoke all on function public.agenda_limpiar_datos_prueba(uuid, boolean) from public, anon;
grant execute on function public.agenda_eliminar_asesor(uuid) to authenticated;
grant execute on function public.agenda_limpiar_datos_prueba(uuid, boolean) to authenticated;
