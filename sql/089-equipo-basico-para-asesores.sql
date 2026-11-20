-- Un asesor (rol no administrador) no puede leer agenda_asesores (RLS: solo administradores) y por eso veía
-- «Todo el equipo» sin nombres y las citas «Sin asesor». agenda_asesores trae datos sensibles (calendario_token,
-- correo, celular), así que NO se abre la tabla: esta función entrega solo lo básico a cualquier miembro activo de la empresa.
create or replace function public.agenda_equipo_basico(p_empresa uuid)
returns table (id uuid, nombre text, color text, tipo_vinculacion text, activo boolean, rol text, es_yo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.nombre, a.color, a.tipo_vinculacion, a.activo, a.rol, (a.usuario_id is not null and a.usuario_id = auth.uid()) as es_yo
    from public.agenda_asesores a
   where a.empresa_id = p_empresa
     and exists (select 1 from public.agenda_miembros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid() and m.activo)
   order by a.nombre;
$$;
revoke all on function public.agenda_equipo_basico(uuid) from public, anon;
grant execute on function public.agenda_equipo_basico(uuid) to authenticated, service_role;
