-- Quién está conectado a la plataforma ahora (latido de los últimos 90 s).
-- Solo lo ve quien tenga permiso de ver WhatsApp en esa empresa.
create or replace function public.agenda_wa_conectados(p_empresa_id uuid)
returns table(usuario_id uuid, nombre text, visto_en timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa_id, 'whatsapp.ver') then return; end if;
  return query
    select p.usuario_id,
           coalesce(nullif(a.nombre, ''), 'Usuario') as nombre,
           p.visto_en
      from public.agenda_wa_presencia p
      left join public.agenda_asesores a on a.usuario_id = p.usuario_id and a.empresa_id = p.empresa_id
     where p.empresa_id = p_empresa_id and p.visto_en > now() - interval '90 seconds'
     order by nombre;
end;
$$;
revoke all on function public.agenda_wa_conectados(uuid) from public, anon;
grant execute on function public.agenda_wa_conectados(uuid) to authenticated, service_role;
