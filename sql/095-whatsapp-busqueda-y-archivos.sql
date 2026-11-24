-- 095 · WhatsApp: búsqueda de inmuebles rápida y tolerante + guardar fotos, audios y documentos de las conversaciones.
-- Aplicar DESPUÉS de 094. Aditivo: no cambia ninguna función ni tabla existente salvo agregar columnas a agenda_wa_mensajes (nueva en 094)
-- y un índice a agenda_inmuebles. Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

-- ============ 1) Búsqueda de inmuebles ============
create extension if not exists pg_trgm with schema extensions;

-- Minúsculas y sin tildes (inmutable para poder indexarla): «Chapinero», «chapínero» y «CHAPINERO» son lo mismo.
create or replace function public.agenda_sin_tildes(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(coalesce(t, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun')
$$;

-- Texto buscable del inmueble (ciudad, zona, dirección, tipo y descripción juntos).
create or replace function public.agenda_inmueble_texto_busqueda(ciudad text, localidad text, barrio text, direccion text, tipo text, descripcion text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select public.agenda_sin_tildes(concat_ws(' ', ciudad, localidad, barrio, direccion, tipo, left(descripcion, 600)))
$$;

create index if not exists agenda_inmuebles_busqueda_trgm on public.agenda_inmuebles
  using gin (public.agenda_inmueble_texto_busqueda(ciudad, localidad, barrio, direccion, tipo_inmueble, descripcion) extensions.gin_trgm_ops);
create index if not exists agenda_inmuebles_disponibles on public.agenda_inmuebles (empresa_id, disponible, numero_inmueble desc);

-- Búsqueda que usa el bot. Solo la ejecuta el servidor (service_role): devuelve datos públicos del inmueble, nunca llaves ni restricciones.
-- Cada palabra de la zona debe aparecer (sin importar tildes ni mayúsculas) o parecerse mucho (errores de digitación); ordena lo más parecido primero.
create or replace function public.agenda_wa_buscar_inmuebles(
  p_empresa_id uuid, p_codigo integer default null, p_operacion text default null, p_ciudad text default null, p_tipo text default null,
  p_zona text default null, p_habitaciones_min integer default null, p_valor_max numeric default null, p_limite integer default 6)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_zona text := public.agenda_sin_tildes(btrim(coalesce(p_zona, '')));
  v_palabras text[] := coalesce(regexp_split_to_array(nullif(v_zona, ''), '\s+'), '{}');
  v_res jsonb; v_total integer;
begin
  with base as (
    select i.numero_inmueble, i.tipo_oferta, i.tipo_inmueble, i.ciudad, i.localidad, i.barrio, i.direccion, i.habitaciones, i.banos, i.parqueaderos,
           i.valor_canon, i.valor_venta, left(i.descripcion, 400) as descripcion,
           public.agenda_inmueble_texto_busqueda(i.ciudad, i.localidad, i.barrio, i.direccion, i.tipo_inmueble, i.descripcion) as texto
      from public.agenda_inmuebles i
     where i.empresa_id = p_empresa_id and i.disponible
       and (p_codigo is null or i.numero_inmueble = p_codigo)
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
revoke all on function public.agenda_wa_buscar_inmuebles(uuid, integer, text, text, text, text, integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.agenda_wa_buscar_inmuebles(uuid, integer, text, text, text, text, integer, numeric, integer) to service_role;

-- ============ 2) Fotos, audios y documentos de las conversaciones ============
alter table public.agenda_wa_mensajes
  add column if not exists media_path text,      -- ruta del archivo en el almacenamiento privado «whatsapp-media»
  add column if not exists media_mime text,
  add column if not exists media_bytes integer,
  add column if not exists media_nombre text,
  add column if not exists media_error text;     -- si no se pudo descargar de WhatsApp (los archivos de Meta caducan)

-- Almacenamiento PRIVADO (nada público): solo se ve con un enlace temporal firmado, y solo quien tiene el permiso «whatsapp.ver» de esa empresa.
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists wa_media_leer on storage.objects;
create policy wa_media_leer on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-media'
         and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and public.agenda_tiene_permiso(((storage.foldername(name))[1])::uuid, 'whatsapp.ver'));
-- Escribir y borrar solo lo hace el servidor (service_role, que no pasa por estas políticas).
