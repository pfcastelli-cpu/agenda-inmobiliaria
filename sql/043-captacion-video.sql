-- 043 · Video explicativo opcional en la página pública /consignar
-- Enlace de YouTube que la empresa configura en Administración → Empresa. Sin enlace, la página no muestra el bloque de video.
-- Solo se devuelve en agenda_captacion_publica_config (misma función de sql/042) cuando la página está activa.

alter table public.agenda_configuracion add column if not exists captacion_video_url text;

create or replace function public.agenda_captacion_publica_config(p_empresa_slug text default null, p_host text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_cfg record;
begin
  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select c.captacion_publica_activa, c.nombre_comercial, c.captacion_video_url into v_cfg from public.agenda_configuracion c where c.empresa_id = v_empresa;
  if not coalesce(v_cfg.captacion_publica_activa, false) then
    return jsonb_build_object('activa', false);
  end if;
  return jsonb_build_object(
    'activa', true,
    'nombre', v_cfg.nombre_comercial,
    'video_url', nullif(trim(v_cfg.captacion_video_url), ''),
    'ciudades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id, 'nombre', ci.nombre,
        'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'nombre', z.nombre) order by z.nombre) from public.agenda_coberturas z where z.ciudad_id = ci.id), '[]'::jsonb)
      ) order by ci.nombre)
      from public.agenda_ciudades ci
      where ci.empresa_id = v_empresa
        and exists (select 1 from public.agenda_asesores_ciudades x join public.agenda_asesores a on a.id = x.asesor_id where x.ciudad_id = ci.id and a.activo)
    ), '[]'::jsonb)
  );
end;
$function$;
