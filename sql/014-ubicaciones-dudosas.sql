-- 014: alerta cuando las coordenadas de un inmueble no coinciden con su dirección.
-- Sedi a veces trae coordenadas de otro sitio (p. ej. el inmueble 71: "CL 23 #72A-91" con coordenadas a ~6 km).
-- Método (sin servicios externos): las direcciones colombianas son una cuadrícula (calle/carrera). Por cada ciudad
-- con suficientes inmuebles se ajusta, con lo que ya está cargado, un plano  latitud = f(calle, carrera)  y
-- longitud = f(calle, carrera)  (2 pasadas: la 2.ª ignora los puntos muy raros para que un error no contamine el
-- modelo). Un inmueble se marca "ubicación dudosa" si su coordenada queda a más de max(3,5 km, 4 x el error
-- típico) de donde su dirección dice que debería estar (en ciudades distintas de Bogotá, más holgado: max(8 km, 5 x).
-- Las diagonales no se usan (en el norte se numeran como carreras y en el sur como calles). Es una alerta, no una corrección.
-- Funciones: agenda_ols_plano (matemática), agenda_ubicaciones_dudosas_calc (el cálculo, no expuesta) y
-- agenda_ubicaciones_dudosas (la que usa la pantalla; exige ser miembro activo de la empresa).

create or replace function public.agenda_ols_plano(n float8, sx float8, sy float8, sxx float8, syy float8, sxy float8, sz float8, sxz float8, syz float8)
returns float8[]
language sql
immutable
set search_path = ''
as $$
  select case when d = 0 or d is null then null else array[
    (sz*(sxx*syy - sxy*sxy) - sx*(sxz*syy - sxy*syz) + sy*(sxz*sxy - sxx*syz)) / d,
    (n*(sxz*syy - sxy*syz) - sz*(sx*syy - sxy*sy) + sy*(sx*syz - sxz*sy)) / d,
    (n*(sxx*syz - sxz*sxy) - sx*(sx*syz - sxz*sy) + sz*(sx*sxy - sxx*sy)) / d
  ] end
  from (select n*(sxx*syy - sxy*sxy) - sx*(sx*syy - sxy*sy) + sy*(sx*sxy - sxx*sy) as d) q;
$$;

create or replace function public.agenda_ubicaciones_dudosas_calc(p_empresa_id uuid)
returns table(inmueble_id uuid, numero_inmueble integer, direccion text, ciudad text, barrio text,
              latitud numeric, longitud numeric, lat_esperada numeric, lon_esperada numeric, km numeric)
language sql
stable
set search_path = ''
as $$
  with src as (
    select i.id, i.numero_inmueble, i.direccion, i.ciudad, i.barrio, i.latitud::float8 la, i.longitud::float8 lo,
           regexp_match(
             regexp_replace(upper(i.direccion), '\s*N[°º]\s*', ' # ', 'g'),
             '^\s*(?:AVENIDA\s+|AV\.?\s+)?(CALLE|CL|AC|CARRERA|KR|CR|CRA|AK|TRANSVERSAL|TV)\.?\s*(\d{1,3})(?!\d)(?:\s*(?:BIS\y|[A-Z]\y)){0,3}\s*(?:#|-)?\s*(\d{1,3})(?!\d)'
           ) m,
           case when i.ciudad ilike 'bogot%' then 'BOG' else upper(left(coalesce(i.ciudad, '?'), 5)) end ciu
    from public.agenda_inmuebles i
    where i.empresa_id = p_empresa_id
  ),
  p as (
    select id, numero_inmueble, direccion, ciudad, barrio, la, lo, ciu,
           case when m[1] in ('CALLE','CL','AC') then m[2]::float8 else m[3]::float8 end as calle,
           case when m[1] in ('CALLE','CL','AC') then m[3]::float8 else m[2]::float8 end as carr
    from src
    where m is not null and la is not null and lo is not null and not (la = 0 and lo = 0)
      and la between -4.2 and 13.5 and lo between -79 and -66.8
  ),
  ciudades as (select ciu from p group by ciu having count(*) >= 15 and count(distinct calle) >= 4 and count(distinct carr) >= 4),
  pc as (select p.* from p join ciudades using (ciu)),
  -- Pasada 1: con todos los puntos
  f1 as (
    select ciu,
      public.agenda_ols_plano(count(*)::float8, sum(calle), sum(carr), sum(calle*calle), sum(carr*carr), sum(calle*carr), sum(la), sum(calle*la), sum(carr*la)) as ca,
      public.agenda_ols_plano(count(*)::float8, sum(calle), sum(carr), sum(calle*calle), sum(carr*carr), sum(calle*carr), sum(lo), sum(calle*lo), sum(carr*lo)) as co
    from pc group by ciu
  ),
  r1 as (
    select pc.*, f1.ca, f1.co,
      sqrt(power((pc.la - (f1.ca[1] + f1.ca[2]*pc.calle + f1.ca[3]*pc.carr)) * 111.2, 2)
         + power((pc.lo - (f1.co[1] + f1.co[2]*pc.calle + f1.co[3]*pc.carr)) * 111.2 * cos(radians(pc.la)), 2)) as km1
    from pc join f1 using (ciu)
  ),
  corte1 as (select ciu, 3 * percentile_cont(0.5) within group (order by km1) + 1.5 as maximo from r1 group by ciu),
  keep as (select r1.* from r1 join corte1 using (ciu) where r1.km1 <= corte1.maximo),
  -- Pasada 2: sin los puntos muy raros
  f2 as (
    select ciu,
      public.agenda_ols_plano(count(*)::float8, sum(calle), sum(carr), sum(calle*calle), sum(carr*carr), sum(calle*carr), sum(la), sum(calle*la), sum(carr*la)) as ca,
      public.agenda_ols_plano(count(*)::float8, sum(calle), sum(carr), sum(calle*calle), sum(carr*carr), sum(calle*carr), sum(lo), sum(calle*lo), sum(carr*lo)) as co
    from keep group by ciu
  ),
  r2 as (
    select pc.*, f2.ca, f2.co,
      f2.ca[1] + f2.ca[2]*pc.calle + f2.ca[3]*pc.carr as la_esp,
      f2.co[1] + f2.co[2]*pc.calle + f2.co[3]*pc.carr as lo_esp
    from pc join f2 using (ciu)
  ),
  r3 as (
    select r2.*, sqrt(power((la - la_esp) * 111.2, 2) + power((lo - lo_esp) * 111.2 * cos(radians(la)), 2)) as km2
    from r2
  ),
  umbral as (
    select ciu, case when ciu = 'BOG' then greatest(3.5, 4 * percentile_cont(0.5) within group (order by km2))
                     else greatest(8.0, 5 * percentile_cont(0.5) within group (order by km2)) end as maximo
    from r3 where id in (select id from keep) group by ciu
  )
  select r3.id, r3.numero_inmueble, r3.direccion, r3.ciudad, r3.barrio,
         round(r3.la::numeric, 6), round(r3.lo::numeric, 6), round(r3.la_esp::numeric, 6), round(r3.lo_esp::numeric, 6),
         round(r3.km2::numeric, 1)
  from r3 join umbral using (ciu)
  where r3.km2 > umbral.maximo
  order by r3.km2 desc;
$$;

create or replace function public.agenda_ubicaciones_dudosas(p_empresa_id uuid)
returns table(inmueble_id uuid, numero_inmueble integer, direccion text, ciudad text, barrio text,
              latitud numeric, longitud numeric, lat_esperada numeric, lon_esperada numeric, km numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No tienes permiso para ver este reporte';
  end if;
  return query select * from public.agenda_ubicaciones_dudosas_calc(p_empresa_id);
end;
$$;

-- El cálculo interno no se expone; solo la función con control de permiso.
revoke all on function public.agenda_ubicaciones_dudosas_calc(uuid) from public, anon, authenticated;
revoke all on function public.agenda_ubicaciones_dudosas(uuid) from public, anon;
grant execute on function public.agenda_ubicaciones_dudosas(uuid) to authenticated, service_role;
grant execute on function public.agenda_ols_plano(float8, float8, float8, float8, float8, float8, float8, float8, float8) to authenticated, service_role;
