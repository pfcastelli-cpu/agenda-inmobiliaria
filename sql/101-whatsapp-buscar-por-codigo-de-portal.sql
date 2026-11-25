-- La IA de WhatsApp ahora encuentra un inmueble por el código de Fincaraíz, Metrocuadrado o Ciencuadras
-- (antes solo por el número interno). Caso real: un cliente llegó con el enlace de Fincaraíz del inmueble 279.
drop function if exists public.agenda_wa_buscar_inmuebles(uuid, integer, text, text, text, text, integer, numeric, integer);

create or replace function public.agenda_wa_buscar_inmuebles(
  p_empresa_id uuid, p_codigo integer default null, p_operacion text default null, p_ciudad text default null,
  p_tipo text default null, p_zona text default null, p_habitaciones_min integer default null, p_valor_max numeric default null,
  p_limite integer default 6, p_codigo_portal text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_zona text := public.agenda_sin_tildes(btrim(coalesce(p_zona, '')));
  v_palabras text[] := coalesce(regexp_split_to_array(nullif(v_zona, ''), '\s+'), '{}');
  v_portal text := nullif(upper(btrim(coalesce(p_codigo_portal, ''))), '');
  v_res jsonb; v_total integer;
begin
  with base as (
    select i.numero_inmueble, i.tipo_oferta, i.tipo_inmueble, i.ciudad, i.localidad, i.barrio, i.direccion, i.habitaciones, i.banos, i.parqueaderos,
           i.valor_canon, i.valor_venta, left(i.descripcion, 400) as descripcion,
           public.agenda_inmueble_texto_busqueda(i.ciudad, i.localidad, i.barrio, i.direccion, i.tipo_inmueble, i.descripcion) as texto
      from public.agenda_inmuebles i
     where i.empresa_id = p_empresa_id and i.disponible
       and (p_codigo is null or i.numero_inmueble = p_codigo)
       and (v_portal is null or upper(btrim(coalesce(i.codigo_fincaraiz, ''))) = v_portal
            or upper(btrim(coalesce(i.codigo_metrocuadrado, ''))) = v_portal
            or upper(btrim(coalesce(i.codigo_ciencuadras, ''))) = v_portal)
       and (p_operacion is null or i.tipo_oferta = p_operacion)
       and (p_ciudad is null or public.agenda_sin_tildes(i.ciudad) like '%' || public.agenda_sin_tildes(p_ciudad) || '%')
       and (p_tipo is null or public.agenda_sin_tildes(i.tipo_inmueble) like '%' || public.agenda_sin_tildes(p_tipo) || '%')
       and (p_habitaciones_min is null or coalesce(i.habitaciones, 0) >= p_habitaciones_min)
       and (p_valor_max is null or coalesce(case when i.tipo_oferta = 'Venta' then i.valor_venta else i.valor_canon end, 0) <= p_valor_max
            or coalesce(case when i.tipo_oferta = 'Venta' then i.valor_venta else i.valor_canon end, 0) = 0)
  ), puntuado as (
    select b.*,
           case when cardinality(v_palabras) = 0 then 1.0
                else extensions.word_similarity(v_zona, b.texto) end as puntaje,
           case when cardinality(v_palabras) = 0 then true
                else (select bool_and(b.texto like '%' || p || '%' or extensions.word_similarity(p, b.texto) >= 0.5) from unnest(v_palabras) p) end as coincide
      from base b
  )
  select count(*) filter (where coincide),
         coalesce(jsonb_agg(to_jsonb(x) - 'texto' - 'puntaje' - 'coincide' order by x.puntaje desc, x.numero_inmueble desc) filter (where x.rn <= greatest(1, least(coalesce(p_limite, 6), 10))), '[]'::jsonb)
    into v_total, v_res
    from (select p.*, row_number() over (order by p.puntaje desc, p.numero_inmueble desc) rn from puntuado p where p.coincide) x;
  return jsonb_build_object('total', coalesce(v_total, 0), 'inmuebles', coalesce(v_res, '[]'::jsonb));
end;
$$;
revoke all on function public.agenda_wa_buscar_inmuebles(uuid, integer, text, text, text, text, integer, numeric, integer, text) from public, anon, authenticated;
grant execute on function public.agenda_wa_buscar_inmuebles(uuid, integer, text, text, text, text, integer, numeric, integer, text) to service_role;
