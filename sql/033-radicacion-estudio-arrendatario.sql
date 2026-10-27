-- 033 · Radicación del estudio de arrendatario (cuando el cliente quiere avanzar)
-- Cada empresa configura, por ciudad, los datos de la aseguradora (póliza/código, asesor que la aseguradora pide, enlaces del estudio para
-- persona natural y jurídica), los costos del estudio (valor y/o porcentaje) y las instrucciones. Al elegir «quiero avanzar» en la encuesta
-- (o con el botón de la cita) el cliente recibe un correo y una página /radicar/<token> con los datos listos para copiar.
-- Una ciudad sin configuración usa la fila «predeterminada» (ciudad_id vacío). Ej.: Medellín usa la póliza de Bogotá.
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/033-radicacion-estudio-arrendatario.sql

alter table public.agenda_configuracion add column if not exists radicacion_activa boolean not null default false;
alter table public.agenda_citas add column if not exists radicacion_enviada_en timestamptz;

create table if not exists public.agenda_radicacion_config (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  ciudad_id uuid references public.agenda_ciudades(id) on delete cascade, -- null = predeterminada
  aseguradora text not null default 'Libertador',
  link_natural text,
  link_juridica text,
  nombre_inmobiliaria text,
  codigo_inmobiliaria text,
  poliza text,
  asesor_nombre text,
  asesor_correo text,
  costo_valor numeric,
  costo_porcentaje numeric,
  costo_iva boolean not null default true,
  costo_nota text,
  instrucciones text not null default '',
  orden smallint not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
-- Una empresa puede tener varias aseguradoras por ciudad (una fila por aseguradora); el cliente ve todas.
create unique index if not exists agenda_radicacion_config_uni on public.agenda_radicacion_config (empresa_id, coalesce(ciudad_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(aseguradora));

alter table public.agenda_radicacion_config enable row level security;
drop policy if exists agenda_radicacion_lectura on public.agenda_radicacion_config;
create policy agenda_radicacion_lectura on public.agenda_radicacion_config for select to authenticated
  using (exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_radicacion_config.empresa_id and m.usuario_id = auth.uid() and m.activo));
drop policy if exists agenda_radicacion_escritura on public.agenda_radicacion_config;
create policy agenda_radicacion_escritura on public.agenda_radicacion_config for all to authenticated
  using (public.agenda_es_admin(empresa_id)) with check (public.agenda_es_admin(empresa_id));
grant select, insert, update, delete on public.agenda_radicacion_config to authenticated;
grant select, insert, update, delete on public.agenda_radicacion_config to service_role;

create or replace function public.agenda_texto_llano(p text)
returns text language sql immutable set search_path to ''
as $$ select regexp_replace(lower(translate(coalesce(p, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouaeiounnuu')), '[^a-z]', '', 'g') $$;

-- Qué configuración aplica a una cita: las aseguradoras de la ciudad del inmueble o, si no hay ninguna, las predeterminadas.
-- Devuelve el JSON que usan la página y el correo: datos del inmueble y del cliente + la lista «aseguradoras» ya con el costo calculado.
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
revoke all on function public.agenda_radicacion_datos(uuid) from public, anon, authenticated;
grant execute on function public.agenda_radicacion_datos(uuid) to service_role;

-- Pública: la página /radicar/<token> (token = token_cliente de la cita o token de su encuesta). No devuelve correo ni datos del cliente.
create or replace function public.agenda_radicacion_publica(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_cita uuid;
  v jsonb;
begin
  select id into v_cita from public.agenda_citas where token_cliente = p_token;
  if v_cita is null then
    select cita_id into v_cita from public.agenda_encuestas_cliente where token = p_token; -- también sirve el token de la encuesta
  end if;
  if v_cita is null then return jsonb_build_object('error', 'no_encontrada'); end if;
  v := public.agenda_radicacion_datos(v_cita);
  if v ? 'error' then return v; end if;
  return v - 'cliente_email' - 'empresa_id';
end;
$function$;
revoke all on function public.agenda_radicacion_publica(uuid) from public;
grant execute on function public.agenda_radicacion_publica(uuid) to anon, authenticated, service_role;

-- Datos iniciales con lo que ya se sabe (editable en Configuración → Radicación). Solo se insertan si la empresa aún no tiene filas.
do $$
declare
  e record;
  v_bog uuid;
  v_baq uuid;
  v_texto text := E'Ten a la mano tu cédula (persona natural) o el RUT y el certificado de existencia (persona jurídica).\nAbre el enlace del estudio y llena tus datos. Cuando te pidan los datos de la inmobiliaria, del asesor y del inmueble, cópialos del cuadro de arriba.\nInvita a tu codeudor para que llene su propio formulario.\nRecibirás la respuesta del estudio el mismo día, siempre que la información esté completa.\nSi te aprueban, revisa el contrato y fírmalo desde tu celular.';
begin
  for e in select id from public.agenda_empresas loop
    if not exists (select 1 from public.agenda_radicacion_config where empresa_id = e.id) then
      select id into v_bog from public.agenda_ciudades where empresa_id = e.id and public.agenda_texto_llano(nombre) = 'bogota' limit 1;
      select id into v_baq from public.agenda_ciudades where empresa_id = e.id and public.agenda_texto_llano(nombre) = 'barranquilla' limit 1;
      insert into public.agenda_radicacion_config (empresa_id, ciudad_id, aseguradora, link_natural, link_juridica, codigo_inmobiliaria, asesor_nombre, asesor_correo, costo_porcentaje, costo_nota, instrucciones)
        values (e.id, null, 'Libertador', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', '1478', 'Luis Jiménez Fino', 'asesor1@patrimonios.co', 15,
                'Estos derechos y la elaboración del contrato se pagan una sola vez, junto con el primer canon, al firmar y recibir el inmueble.', v_texto);
      if v_bog is not null then
        insert into public.agenda_radicacion_config (empresa_id, ciudad_id, aseguradora, link_natural, link_juridica, codigo_inmobiliaria, asesor_nombre, asesor_correo, costo_porcentaje, costo_nota, instrucciones)
          values (e.id, v_bog, 'Libertador', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', '1478', 'Luis Jiménez Fino', 'asesor1@patrimonios.co', 15,
                  'Estos derechos y la elaboración del contrato se pagan una sola vez, junto con el primer canon, al firmar y recibir el inmueble.', v_texto);
      end if;
      if v_baq is not null then
        insert into public.agenda_radicacion_config (empresa_id, ciudad_id, aseguradora, link_natural, link_juridica, codigo_inmobiliaria, asesor_nombre, asesor_correo, costo_porcentaje, costo_nota, instrucciones)
          values (e.id, v_baq, 'Libertador', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', 'https://analisisweb.ellibertador.co/estudio-digital/datos-basicos/natural', '14221', 'Laura Salcedo', 'asesorbqa@patrimonios.co', 20,
                  'Estos derechos y la elaboración del contrato se pagan una sola vez, junto con el primer canon, al firmar y recibir el inmueble.', v_texto);
      end if;
    end if;
  end loop;
end $$;
