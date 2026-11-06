-- 051: la alerta de demanda no debe contar las citas importadas de Google Calendar (evento_calendar_id con valor).
-- Motivo: al importar el historial (05-nov-2026) todas tenían creado_en = hoy y se contaron como demanda de las últimas 24 h
-- (alerta «Demanda urgente» falsa en 55 inmuebles). Esa demanda del sistema anterior ya entra por agenda_demanda_eventos.
create or replace function public.agenda_demanda_resumen(p_empresa_id uuid, p_dias integer default 14)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_cfg record;
  v_res jsonb;
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 14), 90)));
begin
  if auth.uid() is not null and not public.agenda_es_admin(p_empresa_id) then
    raise exception 'Solo los administradores pueden ver la demanda.';
  end if;
  select demanda_umbral_info, demanda_umbral_urgente, demanda_tope_citas into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;

  with pedidos as (
    select i.numero_inmueble, c.creado_en as pedida_en,
           coalesce(nullif(regexp_replace(coalesce(c.cliente_telefono, ''), '\D', '', 'g'), ''), nullif(lower(c.cliente_email), ''), lower(c.cliente_nombre)) as persona
    from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = p_empresa_id and c.tipo_cita = 'visita_cliente' and not c.es_prueba and c.creado_en >= v_desde
      and coalesce(c.evento_calendar_id, '') = ''
    union all
    select e.numero_inmueble, e.pedida_en,
           coalesce(nullif(regexp_replace(coalesce(e.cliente_telefono, ''), '\D', '', 'g'), ''), nullif(lower(e.cliente_email), ''), lower(e.cliente_nombre))
    from public.agenda_demanda_eventos e
    where e.empresa_id = p_empresa_id and e.pedida_en >= v_desde
  ),
  por_inmueble as (
    select p.numero_inmueble,
           count(*) as pedidos,
           count(*) filter (where p.pedida_en >= now() - interval '24 hours') as pedidos_24h,
           count(*) filter (where p.pedida_en >= now() - interval '48 hours') as pedidos_48h,
           count(*) filter (where p.pedida_en >= now() - interval '7 days') as pedidos_7d,
           count(distinct p.persona) as personas,
           min(p.pedida_en) as primer_pedido, max(p.pedida_en) as ultimo_pedido
    from pedidos p group by p.numero_inmueble
  ),
  activas as (
    select i.numero_inmueble, count(*) as activas
    from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = p_empresa_id and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null
      and c.fecha >= (now() at time zone 'America/Bogota')::date and c.tipo_cita = 'visita_cliente'
    group by i.numero_inmueble
  )
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(p_dias, 14), 90)),
    'umbral_info', v_cfg.demanda_umbral_info, 'umbral_urgente', v_cfg.demanda_umbral_urgente, 'tope_empresa', v_cfg.demanda_tope_citas,
    'promedio_pedidos_por_inmueble', (select round(avg(pedidos)::numeric, 1) from por_inmueble),
    'inmuebles', coalesce((select jsonb_agg(jsonb_build_object(
        'numero_inmueble', pi.numero_inmueble, 'direccion', i.direccion, 'barrio', i.barrio, 'ciudad', i.ciudad, 'tipo_oferta', i.tipo_oferta,
        'valor_canon', i.valor_canon, 'valor_venta', i.valor_venta, 'estado_crm', i.estado_crm,
        'pedidos', pi.pedidos, 'pedidos_24h', pi.pedidos_24h, 'pedidos_48h', pi.pedidos_48h, 'pedidos_7d', pi.pedidos_7d, 'personas', pi.personas,
        'primer_pedido', pi.primer_pedido, 'ultimo_pedido', pi.ultimo_pedido,
        'activas', coalesce(a.activas, 0), 'tope', coalesce(i.tope_citas_activas, v_cfg.demanda_tope_citas)
      ) order by pi.pedidos_24h desc, pi.pedidos_48h desc, pi.pedidos desc)
      from por_inmueble pi
      left join public.agenda_inmuebles i on i.empresa_id = p_empresa_id and i.numero_inmueble = pi.numero_inmueble
      left join activas a on a.numero_inmueble = pi.numero_inmueble), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$;
