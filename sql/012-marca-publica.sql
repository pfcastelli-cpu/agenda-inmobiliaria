-- 012: marca pública de la empresa (nombre, logo, colores) para las páginas de los clientes.
-- Función de SOLO LECTURA, igual en espíritu a agenda_formato_hora_publico: resuelve la empresa por
-- slug o por dominio (agenda_resolver_empresa_publica) y devuelve únicamente datos de marca que ya
-- son públicos en la práctica. No expone correos, contraseñas ni nada de la configuración interna.
create or replace function public.agenda_marca_publica(p_empresa_slug text default null, p_host text default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid;
begin
  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  return (
    select json_build_object(
      'nombre_comercial', c.nombre_comercial,
      'logo_url', c.logo_url,
      'color_principal', c.color_principal,
      'color_accion', c.color_accion
    )
    from public.agenda_configuracion c
    where c.empresa_id = v_empresa_id
  );
end;
$$;

revoke all on function public.agenda_marca_publica(text, text) from public;
grant execute on function public.agenda_marca_publica(text, text) to anon, authenticated, service_role;
