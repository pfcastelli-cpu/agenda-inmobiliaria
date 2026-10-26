-- 021 · Pendientes de portales automáticos: se re-evalúan solos contra Sedi y la última exportación de cada portal
-- Antes un pendiente de portales solo podía cerrarse cuando alguien volvía a subir el Excel. Ahora:
--   * Al subir un Excel se guarda además «la foto» de lo publicado en ese portal (agenda_portales_publicaciones).
--   * Cada madrugada (pg_cron, 6:30 a. m. Bogotá) y al subir un Excel, agenda_portales_reevaluar() compara esa foto con el
--     inventario actual de Sedi (agenda_inmuebles) y: abre los pendientes nuevos, mantiene los que siguen mal y cierra solos
--     (cierre_tipo = 'automatico') los que ya se arreglaron en Sedi. Lo que solo se arregla en el portal se cierra al
--     subir el siguiente Excel, que reemplaza la foto.
-- La lógica es la misma de aplicacion/js/portales-logica.js (compararPortal): publicar, despublicar, revisar_codigo, revisar_precio.
-- Los descartados a mano se respetan. Las pruebas de equivalencia se hacen contra ese archivo.
-- Debe aplicarse con autorización de Felipe. Tras aplicarla hay que volver a subir los 3 Excel una vez para que quede la foto.

create or replace function public.agenda_norm(t text)
returns text language sql immutable set search_path = '' as $$
  select lower(btrim(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou')))
$$;

create table if not exists public.agenda_portales_publicaciones (
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  portal text not null check (portal in ('fincaraiz', 'metrocuadrado', 'ciencuadras')),
  codigo text not null,
  oferta text not null check (oferta in ('venta', 'arriendo')),
  precio_venta numeric not null default 0,
  precio_canon numeric not null default 0,
  referencia text not null default '',
  cargado_en timestamptz not null default now(),
  primary key (empresa_id, portal, codigo)
);
alter table public.agenda_portales_publicaciones enable row level security;
drop policy if exists portales_publicaciones_lectura on public.agenda_portales_publicaciones;
create policy portales_publicaciones_lectura on public.agenda_portales_publicaciones
  for select to authenticated
  using (public.agenda_rol_actual(empresa_id) in ('administrador', 'coordinador'));
grant select on public.agenda_portales_publicaciones to authenticated;
grant select, insert, update, delete on public.agenda_portales_publicaciones to service_role;
revoke all on public.agenda_portales_publicaciones from anon;
revoke insert, update, delete, truncate, references, trigger on public.agenda_portales_publicaciones from authenticated;

-- Guarda la foto de un portal (reemplaza la anterior). Solo administrador/coordinador. Mismas validaciones que agenda_portales_guardar.
create or replace function public.agenda_portales_guardar_foto(p_empresa_id uuid, p_portal text, p_registros jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text := public.agenda_rol_actual(p_empresa_id);
  v_n integer;
begin
  if v_rol is null or v_rol not in ('administrador', 'coordinador') then
    raise exception 'Solo administrador o coordinador pueden cargar portales';
  end if;
  if p_portal not in ('fincaraiz', 'metrocuadrado', 'ciencuadras') then
    raise exception 'Portal no válido: %', p_portal;
  end if;
  if jsonb_typeof(p_registros) is distinct from 'array' or jsonb_array_length(p_registros) < 10 or jsonb_array_length(p_registros) > 5000 then
    raise exception 'El archivo trae menos de 10 (o demasiadas) publicaciones activas: no se cambió nada.';
  end if;
  delete from public.agenda_portales_publicaciones where empresa_id = p_empresa_id and portal = p_portal;
  insert into public.agenda_portales_publicaciones (empresa_id, portal, codigo, oferta, precio_venta, precio_canon, referencia)
  select p_empresa_id, p_portal, btrim(r ->> 'codigo'),
         case when r ->> 'oferta' = 'venta' then 'venta' else 'arriendo' end,
         greatest(coalesce((r ->> 'precioVenta')::numeric, 0), 0), greatest(coalesce((r ->> 'precioCanon')::numeric, 0), 0),
         left(coalesce(r ->> 'referencia', ''), 300)
    from jsonb_array_elements(p_registros) r
   where btrim(coalesce(r ->> 'codigo', '')) <> ''
  on conflict (empresa_id, portal, codigo) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.agenda_portales_guardar_foto(uuid, text, jsonb) from public, anon;
grant execute on function public.agenda_portales_guardar_foto(uuid, text, jsonb) to authenticated, service_role;

-- Re-evalúa los pendientes de portales. Sin parámetros: todas las empresas y portales que tengan foto. Solo servicio / cron.
create or replace function public.agenda_portales_reevaluar(p_empresa_id uuid default null, p_portal text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp uuid;
  v_portal text;
  v_nombre text;
  v_items jsonb;
  v_item jsonb;
  v_resp record;
  v_claves text[];
  v_insertado boolean;
  v_nuevos integer;
  v_cerrados integer;
  v_total integer;
  v_resumen jsonb := '[]'::jsonb;
begin
  for v_emp in
    select distinct empresa_id from public.agenda_portales_publicaciones where p_empresa_id is null or empresa_id = p_empresa_id
  loop
    foreach v_portal in array array['fincaraiz', 'metrocuadrado', 'ciencuadras'] loop
      if p_portal is not null and v_portal <> p_portal then continue; end if;
      select count(*) into v_total from public.agenda_portales_publicaciones where empresa_id = v_emp and portal = v_portal;
      if v_total < 10 then continue; end if;   -- foto incompleta: no se toca nada
      v_nombre := case v_portal when 'fincaraiz' then 'Fincaraíz' when 'metrocuadrado' then 'Metrocuadrado' else 'Ciencuadras' end;

      with sedi as (
        select i.numero_inmueble, i.estado_crm, i.direccion,
               case v_portal when 'fincaraiz' then nullif(btrim(coalesce(i.codigo_fincaraiz, '')), '')
                             when 'metrocuadrado' then nullif(btrim(coalesce(i.codigo_metrocuadrado, '')), '')
                             else nullif(btrim(coalesce(i.codigo_ciencuadras, '')), '') end as cod,
               public.agenda_norm(i.estado_crm) in ('disponible', 'rentando') as publicable,
               case when left(public.agenda_norm(i.tipo_oferta), 1) = 'v' then 'venta' else 'arriendo' end as oferta_sedi,
               coalesce(i.valor_venta, 0) as valor_venta, coalesce(i.valor_canon, 0) as valor_canon,
               coalesce(nullif(btrim(coalesce(i.asesor_comercializacion, '')), ''), nullif(btrim(coalesce(i.asesor_captacion, '')), ''), '') as resp
          from public.agenda_inmuebles i where i.empresa_id = v_emp
      ), pub as (
        select * from public.agenda_portales_publicaciones where empresa_id = v_emp and portal = v_portal
      ), mon as (
        select s.numero_inmueble, p.codigo,
               case s.oferta_sedi when 'venta' then s.valor_venta else s.valor_canon end as precio_sedi,
               case s.oferta_sedi when 'venta' then p.precio_venta else p.precio_canon end as precio_portal,
               s.oferta_sedi
          from sedi s join pub p on p.codigo = s.cod where s.publicable
      )
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items from (
        -- 1) Sedi dice que debe estar publicado (tiene código del portal) y el portal no lo muestra activo.
        select jsonb_build_object('tipo', 'publicar', 'numero_inmueble', s.numero_inmueble,
                 'clave', 'portal:' || v_portal || ':publicar:' || s.numero_inmueble,
                 'titulo', 'Publicar inmueble ' || s.numero_inmueble || ' en ' || v_nombre,
                 'detalle', btrim('Sedi tiene el código ' || s.cod || ' para ' || v_nombre || ' y el inmueble está ' || coalesce(s.estado_crm, '') || ', pero no aparece activo en el archivo del portal. ' || coalesce(s.direccion, '')),
                 'responsable_nombre', s.resp,
                 'datos', jsonb_build_object('codigo', s.cod, 'estado_crm', s.estado_crm, 'direccion', coalesce(s.direccion, ''))) as x
          from sedi s where s.cod is not null and s.publicable and not exists (select 1 from pub p where p.codigo = s.cod)
        union all
        -- 2) Publicado en el portal sin código en Sedi.
        select jsonb_build_object('tipo', 'revisar_codigo', 'numero_inmueble', null,
                 'clave', 'portal:' || v_portal || ':revisar_codigo:' || p.codigo,
                 'titulo', 'Publicación ' || p.codigo || ' en ' || v_nombre || ' sin código en Sedi',
                 'detalle', btrim('Está activa en ' || v_nombre || ' pero ningún inmueble de Sedi tiene ese código. O se baja del portal, o falta registrar el código en Sedi. ' || p.referencia),
                 'responsable_nombre', '',
                 'datos', jsonb_build_object('codigo', p.codigo, 'referencia', p.referencia, 'oferta', p.oferta))
          from pub p where not exists (select 1 from sedi s where s.cod = p.codigo)
        union all
        -- 3) Publicado, pero Sedi dice que ya no está disponible.
        select jsonb_build_object('tipo', 'despublicar', 'numero_inmueble', s.numero_inmueble,
                 'clave', 'portal:' || v_portal || ':despublicar:' || s.numero_inmueble,
                 'titulo', 'Despublicar inmueble ' || s.numero_inmueble || ' de ' || v_nombre,
                 'detalle', btrim('En Sedi está "' || coalesce(nullif(s.estado_crm, ''), 'sin estado') || '" pero sigue activo en ' || v_nombre || ' (' || p.codigo || '). ' || coalesce(s.direccion, '')),
                 'responsable_nombre', s.resp,
                 'datos', jsonb_build_object('codigo', p.codigo, 'estado_crm', s.estado_crm, 'direccion', coalesce(s.direccion, '')))
          from pub p join sedi s on s.cod = p.codigo where not s.publicable
        union all
        -- 4) Precio distinto (según la oferta de Sedi).
        select jsonb_build_object('tipo', 'revisar_precio', 'numero_inmueble', m.numero_inmueble,
                 'clave', 'portal:' || v_portal || ':revisar_precio:' || m.numero_inmueble,
                 'titulo', 'Precio distinto en ' || v_nombre || ': inmueble ' || m.numero_inmueble,
                 'detalle', 'Sedi: $' || replace(to_char(round(m.precio_sedi), 'FM999,999,999,999,999'), ',', '.') || ' · ' || v_nombre || ': $' || replace(to_char(round(m.precio_portal), 'FM999,999,999,999,999'), ',', '.') || ' (' || m.oferta_sedi || '). Hay que corregir el que esté mal.',
                 'responsable_nombre', (select s.resp from sedi s where s.numero_inmueble = m.numero_inmueble limit 1),
                 'datos', jsonb_build_object('codigo', m.codigo, 'precio_sedi', m.precio_sedi, 'precio_portal', m.precio_portal, 'oferta', m.oferta_sedi,
                          'direccion', coalesce((select s.direccion from sedi s where s.numero_inmueble = m.numero_inmueble limit 1), '')))
          from mon m where m.precio_sedi > 0 and m.precio_portal > 0 and abs(m.precio_sedi - m.precio_portal) >= 1
      ) q;

      v_claves := '{}';
      v_nuevos := 0;
      for v_item in select * from jsonb_array_elements(v_items) loop
        v_claves := v_claves || (v_item ->> 'clave');
        select * into v_resp from public.agenda_resolver_responsable(v_emp, v_item ->> 'responsable_nombre');
        insert into public.agenda_pendientes as p (empresa_id, tipo, origen, portal, numero_inmueble, titulo, detalle,
          clave, responsable_nombre, responsable_usuario_id, nivel, fecha_limite, datos)
        values (v_emp, v_item ->> 'tipo', 'portales', v_portal, nullif(v_item ->> 'numero_inmueble', '')::integer,
          v_item ->> 'titulo', coalesce(v_item ->> 'detalle', ''), v_item ->> 'clave',
          coalesce(v_item ->> 'responsable_nombre', ''), v_resp.usuario_id, coalesce(v_resp.nivel, 1),
          current_date + 3, coalesce(v_item -> 'datos', '{}'::jsonb))
        on conflict (empresa_id, clave) where clave is not null do update
          set titulo = excluded.titulo, detalle = excluded.detalle, datos = excluded.datos,
              responsable_nombre = excluded.responsable_nombre,
              responsable_usuario_id = excluded.responsable_usuario_id, nivel = excluded.nivel,
              actualizado_en = now(),
              estado = case when p.estado = 'cerrado' and p.cierre_tipo = 'automatico' then 'abierto' else p.estado end,
              cerrado_en = case when p.estado = 'cerrado' and p.cierre_tipo = 'automatico' then null else p.cerrado_en end,
              cierre_tipo = case when p.estado = 'cerrado' and p.cierre_tipo = 'automatico' then null else p.cierre_tipo end,
              nota_cierre = case when p.estado = 'cerrado' and p.cierre_tipo = 'automatico' then null else p.nota_cierre end,
              fecha_limite = case when p.estado = 'cerrado' and p.cierre_tipo = 'automatico' then excluded.fecha_limite else p.fecha_limite end
        returning (xmax = 0) into v_insertado;
        if v_insertado then v_nuevos := v_nuevos + 1; end if;
      end loop;

      update public.agenda_pendientes
         set estado = 'cerrado', cierre_tipo = 'automatico', cerrado_en = now(), actualizado_en = now(),
             nota_cierre = 'Ya no aparece al comparar Sedi con el último Excel del portal (' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || ')'
       where empresa_id = v_emp and origen = 'portales' and portal = v_portal
         and estado in ('abierto', 'en_proceso') and not (clave = any(v_claves));
      get diagnostics v_cerrados = row_count;
      v_resumen := v_resumen || jsonb_build_array(jsonb_build_object('empresa', v_emp, 'portal', v_portal,
        'pendientes', coalesce(array_length(v_claves, 1), 0), 'nuevos', v_nuevos, 'cerrados_solos', v_cerrados));
    end loop;
  end loop;
  return v_resumen;
end;
$$;
revoke all on function public.agenda_portales_reevaluar(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_portales_reevaluar(uuid, text) to service_role;

-- Todas las madrugadas a las 6:30 a. m. (Bogotá). Para pausarlo: select cron.unschedule('portales-reevaluar');
select cron.schedule('portales-reevaluar', '30 11 * * *', $job$ select public.agenda_portales_reevaluar(); $job$);
