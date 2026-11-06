-- 050 · «Salud del inmueble» y check-list de solicitudes de propietarios.
-- 1) agenda_solicitudes_propietario gana estado (pendiente / hecha / descartada) para poder marcarlas y avisar al dueño.
-- 2) agenda_salud_inmuebles(): por cada inmueble disponible, cuánto movimiento tuvo (visitas de agenda_citas + citas importadas
--    de Calendar + intereses del bot) y un semáforo. Solo cifras: nunca devuelve datos personales de clientes.
-- 3) agenda_solicitud_marcar_hecha(): cierra una solicitud (el aviso al propietario lo manda la Edge Function avisar-solicitud-hecha).
-- APLICADO 2026-11-05 (migración «salud_inmueble_solicitudes»). Probado: la RPC de salud responde con una sesión simulada de Felipe.

-- ------------------------------------------------------------------ 1) estado de las solicitudes
alter table public.agenda_solicitudes_propietario
  add column if not exists estado text not null default 'pendiente',
  add column if not exists origen text not null default 'propietario',   -- propietario | sistema (sugerencia automática)
  add column if not exists hecha_en timestamptz,
  add column if not exists hecha_por uuid references auth.users(id) on delete set null,
  add column if not exists nota_cierre text,
  add column if not exists propietario_avisado_en timestamptz;

alter table public.agenda_solicitudes_propietario drop constraint if exists agenda_solicitudes_propietario_estado_check;
alter table public.agenda_solicitudes_propietario add constraint agenda_solicitudes_propietario_estado_check
  check (estado in ('pendiente', 'hecha', 'descartada'));
alter table public.agenda_solicitudes_propietario drop constraint if exists agenda_solicitudes_propietario_origen_check;
alter table public.agenda_solicitudes_propietario add constraint agenda_solicitudes_propietario_origen_check
  check (origen in ('propietario', 'sistema'));

create index if not exists agenda_solicitudes_propietario_estado_idx on public.agenda_solicitudes_propietario (empresa_id, estado, creado_en desc);

-- ------------------------------------------------------------------ 2) salud de los inmuebles disponibles
create or replace function public.agenda_salud_inmuebles(p_empresa_id uuid, p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde date := current_date - greatest(coalesce(p_dias, 30), 1);
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'informes.ver') then
    raise exception 'No tienes permiso para ver los informes.';
  end if;
  return coalesce((
    with visitas as (
      -- citas del sistema nuevo (no canceladas, no de prueba)
      select i.numero_inmueble as numero, c.fecha as dia, c.token_cliente::text as persona
        from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
       where c.empresa_id = p_empresa_id and c.estado <> 'cancelada' and not c.es_prueba and c.fecha between v_desde and current_date
      union all
      -- citas importadas de Calendar (se omiten las que el sistema nuevo ya refleja, para no contarlas dos veces)
      select cc.numero_inmueble, (cc.inicio at time zone 'America/Bogota')::date, nullif(cc.cliente_huella, '')
        from public.agenda_citas_calendar cc
       where cc.empresa_id = p_empresa_id and cc.estado = 'activa' and cc.numero_inmueble is not null
         and (cc.inicio at time zone 'America/Bogota')::date between v_desde and current_date
         and not exists (select 1 from public.agenda_citas c2 where c2.empresa_id = cc.empresa_id and c2.evento_calendar_id = cc.evento_id)
    ),
    por_visita as (
      select numero, count(*) as visitas, count(distinct persona) as personas, max(dia) as ultima
        from visitas group by numero
    ),
    por_interes as (
      select numero_inmueble as numero, count(*) as intereses, count(distinct nullif(contacto_huella, '')) as personas_interes
        from public.agenda_intereses_bot
       where empresa_id = p_empresa_id and numero_inmueble is not null and (fecha at time zone 'America/Bogota')::date >= v_desde
       group by numero_inmueble
    ),
    base as (
      select i.numero_inmueble, i.ciudad, i.tipo_oferta, i.tipo_inmueble, i.valor_canon, i.valor_venta,
             extract(day from now() - i.creado_en)::int as dias_en_sistema,
             coalesce(v.visitas, 0) as visitas, coalesce(v.personas, 0) as personas_visitas, v.ultima as ultima_visita,
             coalesce(t.intereses, 0) as intereses, coalesce(t.personas_interes, 0) as personas_interes
        from public.agenda_inmuebles i
        left join por_visita v on v.numero = i.numero_inmueble
        left join por_interes t on t.numero = i.numero_inmueble
       where i.empresa_id = p_empresa_id and i.disponible
    )
    select jsonb_agg(jsonb_build_object(
        'numero_inmueble', b.numero_inmueble, 'ciudad', b.ciudad, 'tipo_oferta', b.tipo_oferta, 'tipo_inmueble', b.tipo_inmueble,
        'valor_canon', b.valor_canon, 'valor_venta', b.valor_venta, 'dias_en_sistema', b.dias_en_sistema,
        'visitas', b.visitas, 'personas_visitas', b.personas_visitas, 'ultima_visita', b.ultima_visita,
        'intereses', b.intereses, 'personas_interes', b.personas_interes,
        'nivel', case when b.dias_en_sistema >= 30 and b.visitas = 0 and b.intereses = 0 then 'rojo'
                      when b.dias_en_sistema >= 30 and b.visitas <= 1 then 'amarillo'
                      else 'verde' end)
      order by case when b.dias_en_sistema >= 30 and b.visitas = 0 and b.intereses = 0 then 0
                    when b.dias_en_sistema >= 30 and b.visitas <= 1 then 1 else 2 end, b.visitas, b.numero_inmueble)
      from base b
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_salud_inmuebles(uuid, integer) from public, anon;
grant execute on function public.agenda_salud_inmuebles(uuid, integer) to authenticated, service_role;

-- ------------------------------------------------------------------ 3) cerrar una solicitud
create or replace function public.agenda_solicitud_marcar_hecha(p_solicitud_id uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sol public.agenda_solicitudes_propietario%rowtype;
begin
  select * into v_sol from public.agenda_solicitudes_propietario where id = p_solicitud_id;
  if not found then raise exception 'Esa solicitud no existe.'; end if;
  if not public.agenda_tiene_permiso(v_sol.empresa_id, 'pendientes.gestionar') then
    raise exception 'No tienes permiso para gestionar solicitudes.';
  end if;
  if v_sol.estado <> 'pendiente' then raise exception 'Esa solicitud ya estaba cerrada.'; end if;
  update public.agenda_solicitudes_propietario
     set estado = 'hecha', hecha_en = now(), hecha_por = auth.uid(), nota_cierre = nullif(left(btrim(coalesce(p_nota, '')), 500), '')
   where id = p_solicitud_id;
  return jsonb_build_object('id', v_sol.id, 'empresa_id', v_sol.empresa_id);
end;
$$;
revoke all on function public.agenda_solicitud_marcar_hecha(uuid, text) from public, anon;
grant execute on function public.agenda_solicitud_marcar_hecha(uuid, text) to authenticated, service_role;
