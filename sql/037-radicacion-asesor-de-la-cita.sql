-- 037 · Radicación: el asesor que va en el formulario de la aseguradora es el que atendió al cliente (el asesor de la cita)
-- Antes se tomaba el asesor fijo de cada ciudad (Configuración → Radicación). Ahora ese dato solo se usa si la cita no tiene asesor.
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/037-radicacion-asesor-de-la-cita.sql

create or replace function public.agenda_radicacion_datos(p_cita_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_cita record;
  v_inm record;
  v_emp record;
  v_ciudad_cfg uuid;
  v_lista jsonb;
  v_asesor record;
begin
  select c.id, c.empresa_id, c.cliente_nombre, c.cliente_email, c.inmueble_id, c.token_cliente, c.asesor_id into v_cita
    from public.agenda_citas c where c.id = p_cita_id;
  -- El asesor que va en el formulario de la aseguradora es el que ATENDIÓ al cliente (el de la cita), no uno fijo por ciudad.
  select a.nombre, btrim(split_part(replace(coalesce(a.correo, ''), ',', ';'), ';', 1)) as correo into v_asesor
    from public.agenda_asesores a where a.id = (select asesor_id from public.agenda_citas where id = p_cita_id);
  if not found or v_cita.inmueble_id is null then return jsonb_build_object('error', 'no_encontrada'); end if;
  select numero_inmueble, direccion, ciudad, barrio, tipo_oferta, valor_canon, tiene_administracion, administracion_incluida, valor_administracion
    into v_inm from public.agenda_inmuebles where id = v_cita.inmueble_id;
  select nombre_comercial into v_emp from public.agenda_configuracion where empresa_id = v_cita.empresa_id;

  -- ¿Hay filas propias para la ciudad del inmueble? (la más específica gana; si no, las predeterminadas)
  select k.ciudad_id into v_ciudad_cfg
  from public.agenda_radicacion_config k
  join public.agenda_ciudades ci on ci.id = k.ciudad_id
  where k.empresa_id = v_cita.empresa_id and public.agenda_texto_llano(ci.nombre) <> ''
    and public.agenda_texto_llano(v_inm.ciudad) like public.agenda_texto_llano(ci.nombre) || '%'
  order by length(public.agenda_texto_llano(ci.nombre)) desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'aseguradora', k.aseguradora, 'link_natural', k.link_natural, 'link_juridica', k.link_juridica,
      'nombre_inmobiliaria', coalesce(nullif(k.nombre_inmobiliaria, ''), v_emp.nombre_comercial),
      'codigo_inmobiliaria', k.codigo_inmobiliaria, 'poliza', k.poliza, 'asesor_nombre', coalesce(nullif(v_asesor.nombre, ''), k.asesor_nombre), 'asesor_correo', coalesce(nullif(v_asesor.correo, ''), k.asesor_correo),
      'costo_valor', coalesce(k.costo_valor, case when k.costo_porcentaje is not null and v_inm.valor_canon is not null then round(v_inm.valor_canon * k.costo_porcentaje / 100) end),
      'costo_porcentaje', k.costo_porcentaje, 'costo_iva', k.costo_iva, 'costo_nota', k.costo_nota, 'instrucciones', k.instrucciones
    ) order by k.orden, k.aseguradora), '[]'::jsonb)
  into v_lista
  from public.agenda_radicacion_config k
  where k.empresa_id = v_cita.empresa_id and k.ciudad_id is not distinct from v_ciudad_cfg;
  if jsonb_array_length(v_lista) = 0 then return jsonb_build_object('error', 'sin_configuracion'); end if;

  return jsonb_build_object(
    'aseguradoras', v_lista,
    'numero_inmueble', v_inm.numero_inmueble, 'direccion', v_inm.direccion, 'ciudad', v_inm.ciudad, 'barrio', v_inm.barrio,
    'canon', v_inm.valor_canon,
    'administracion', case when coalesce(v_inm.tiene_administracion, false) and not coalesce(v_inm.administracion_incluida, false) then v_inm.valor_administracion end,
    'administracion_incluida', coalesce(v_inm.administracion_incluida, false),
    'cliente_nombre', v_cita.cliente_nombre, 'cliente_email', v_cita.cliente_email, 'empresa_id', v_cita.empresa_id
  );
end;
$function$;
