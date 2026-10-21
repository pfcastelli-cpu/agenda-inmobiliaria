-- 008 · Pendientes (tareas con dueño) + comparación de portales
-- Ejecutado en producción el 21-oct-2026 (migración "pendientes_portales").
--
-- Idea: una tarea no desaparece porque alguien marque un correo como leído; vive aquí hasta que
-- se cierra. Las alimenta (a) la comparación de los Excel de los portales (esta entrega) y
-- (b) más adelante el ruteador de info@ (origen = 'correo').
--
-- Quién ve qué (se aplica en la base de datos, no solo en pantalla):
--   administrador -> todo
--   coordinador   -> lo suyo y lo de asesores (nivel <= 2); NUNCA lo de un administrador (nivel 3)
--   asesor        -> solo lo que tiene su usuario como responsable
-- Un pendiente sin responsable con cuenta (p. ej. el asesor aún no tiene acceso) lo ven
-- administrador y coordinador.

-- 1) Pendientes
create table if not exists public.agenda_pendientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  tipo text not null check (tipo in ('publicar','despublicar','revisar_codigo','revisar_precio',
                                     'asamblea','terminacion','entrega','respuesta','otro')),
  origen text not null check (origen in ('portales','correo','manual')),
  portal text check (portal in ('fincaraiz','metrocuadrado','ciencuadras')),
  numero_inmueble integer,
  titulo text not null,
  detalle text not null default '',
  clave text,                              -- identifica el mismo problema entre cargas
  responsable_nombre text not null default '',
  responsable_usuario_id uuid,
  nivel smallint not null default 1 check (nivel between 1 and 3),
  estado text not null default 'abierto' check (estado in ('abierto','en_proceso','cerrado','descartado')),
  fecha_limite date,
  datos jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  cerrado_en timestamptz,
  cerrado_por uuid,
  cierre_tipo text check (cierre_tipo in ('manual','automatico')),
  nota_cierre text
);
create unique index if not exists agenda_pendientes_clave_uq
  on public.agenda_pendientes (empresa_id, clave) where clave is not null;
create index if not exists agenda_pendientes_estado_idx
  on public.agenda_pendientes (empresa_id, estado, fecha_limite);
create index if not exists agenda_pendientes_resp_idx
  on public.agenda_pendientes (responsable_usuario_id);

-- 2) Cada carga de Excel de un portal (para avisar "hace N días que no se carga")
create table if not exists public.agenda_portales_cargas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  portal text not null check (portal in ('fincaraiz','metrocuadrado','ciencuadras')),
  cargado_en timestamptz not null default now(),
  cargado_por uuid,
  total_activos integer not null default 0,
  resumen jsonb not null default '{}'::jsonb
);
create index if not exists agenda_portales_cargas_idx
  on public.agenda_portales_cargas (empresa_id, portal, cargado_en desc);

alter table public.agenda_pendientes enable row level security;
alter table public.agenda_portales_cargas enable row level security;

-- 3) Visibilidad. SECURITY DEFINER: lee agenda_miembros (que solo permite autolectura al navegador).
create or replace function public.agenda_rol_actual(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select m.rol from public.agenda_miembros m
  where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  limit 1
$$;

create or replace function public.agenda_puede_ver_pendiente(p_empresa_id uuid, p_nivel smallint, p_responsable uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case public.agenda_rol_actual(p_empresa_id)
    when 'administrador' then true
    when 'coordinador' then p_nivel <= 2
    when 'asesor' then p_responsable is not null and p_responsable = auth.uid()
    else false
  end
$$;

drop policy if exists pendientes_lectura on public.agenda_pendientes;
create policy pendientes_lectura on public.agenda_pendientes
  for select to authenticated
  using (public.agenda_puede_ver_pendiente(empresa_id, nivel, responsable_usuario_id));

drop policy if exists portales_cargas_lectura on public.agenda_portales_cargas;
create policy portales_cargas_lectura on public.agenda_portales_cargas
  for select to authenticated
  using (public.agenda_rol_actual(empresa_id) in ('administrador','coordinador'));

-- GRANT explícito (convención desde el 30-oct-2026). El navegador solo LEE; todo cambio pasa por
-- las funciones de abajo, que validan quién llama.
grant select on public.agenda_pendientes to authenticated;
grant select on public.agenda_portales_cargas to authenticated;
grant select, insert, update, delete on public.agenda_pendientes to service_role;
grant select, insert, update, delete on public.agenda_portales_cargas to service_role;
-- Supabase concede por defecto todos los permisos a anon y authenticated en tablas nuevas: se
-- recortan a solo lectura (el RLS ya bloqueaba escrituras, esto lo deja explícito).
revoke all on public.agenda_pendientes, public.agenda_portales_cargas from anon;
revoke insert, update, delete, truncate, references, trigger on public.agenda_pendientes, public.agenda_portales_cargas from authenticated;

-- 4) Resolver a quién pertenece un inmueble según el nombre largo que trae Sedi
--    ("LAURA INES SALCEDO CUETO" -> asesor "Laura Salcedo"): todas las palabras del nombre corto
--    deben estar en el nombre largo. Si hay ficha vinculada a una cuenta, trae su usuario y nivel.
create or replace function public.agenda_resolver_responsable(p_empresa_id uuid, p_nombre text,
  out usuario_id uuid, out nivel smallint)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_largo text := translate(upper(coalesce(p_nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN');
  v_usuario uuid;
  v_rol text;
begin
  usuario_id := null; nivel := 1;
  if btrim(v_largo) = '' then return; end if;
  select a.usuario_id into v_usuario
  from public.agenda_asesores a
  where a.empresa_id = p_empresa_id and a.activo and a.usuario_id is not null
    and not exists (
      select 1 from unnest(string_to_array(translate(upper(a.nombre), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), ' ')) w
      where w <> '' and position(w in v_largo) = 0)
  order by length(a.nombre) desc
  limit 1;
  if v_usuario is null then return; end if;
  usuario_id := v_usuario;
  select m.rol into v_rol from public.agenda_miembros m
   where m.empresa_id = p_empresa_id and m.usuario_id = v_usuario and m.activo limit 1;
  nivel := case v_rol when 'administrador' then 3 when 'coordinador' then 2 else 1 end;
end;
$$;
revoke all on function public.agenda_resolver_responsable(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_resolver_responsable(uuid, text) to service_role;

-- 5) Guardar el resultado de comparar UN portal. Solo administrador/coordinador.
--    p_items: [{clave, tipo, numero_inmueble, titulo, detalle, responsable_nombre, datos}]
--    - Crea los pendientes nuevos y reabre los que se habían cerrado solos y reaparecen.
--    - Respeta los descartados a mano.
--    - Cierra automáticamente (evidencia: ya no aparece en la comparación) los abiertos de ese
--      portal que no vinieron en esta carga.
create or replace function public.agenda_portales_guardar(p_empresa_id uuid, p_portal text,
  p_items jsonb, p_total_activos integer, p_dias_limite integer default 3)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rol text := public.agenda_rol_actual(p_empresa_id);
  v_item jsonb;
  v_resp record;
  v_claves text[] := '{}';
  v_nuevos integer := 0;
  v_cerrados integer := 0;
  v_insertado boolean;
begin
  if v_rol is null or v_rol not in ('administrador','coordinador') then
    raise exception 'Solo administrador o coordinador pueden cargar portales';
  end if;
  if p_portal not in ('fincaraiz','metrocuadrado','ciencuadras') then
    raise exception 'Portal no válido: %', p_portal;
  end if;
  if coalesce(p_total_activos, 0) < 10 then
    raise exception 'El archivo trae menos de 10 publicaciones activas: parece incompleto. No se cambió nada.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_claves := v_claves || (v_item->>'clave');
    select * into v_resp from public.agenda_resolver_responsable(p_empresa_id, v_item->>'responsable_nombre');

    insert into public.agenda_pendientes as p (empresa_id, tipo, origen, portal, numero_inmueble, titulo, detalle,
      clave, responsable_nombre, responsable_usuario_id, nivel, fecha_limite, datos)
    values (p_empresa_id, v_item->>'tipo', 'portales', p_portal, nullif(v_item->>'numero_inmueble','')::integer,
      v_item->>'titulo', coalesce(v_item->>'detalle',''), v_item->>'clave',
      coalesce(v_item->>'responsable_nombre',''), v_resp.usuario_id, coalesce(v_resp.nivel, 1),
      current_date + p_dias_limite, coalesce(v_item->'datos','{}'::jsonb))
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
    returning (xmax = 0) into v_insertado;   -- xmax = 0 solo en filas recién insertadas
    if v_insertado then v_nuevos := v_nuevos + 1; end if;
  end loop;

  update public.agenda_pendientes
     set estado = 'cerrado', cierre_tipo = 'automatico', cerrado_en = now(), actualizado_en = now(),
         nota_cierre = 'Ya no aparece en la comparación con el portal (' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD') || ')'
   where empresa_id = p_empresa_id and origen = 'portales' and portal = p_portal
     and estado in ('abierto','en_proceso') and not (clave = any(v_claves));
  get diagnostics v_cerrados = row_count;

  insert into public.agenda_portales_cargas (empresa_id, portal, cargado_por, total_activos, resumen)
  values (p_empresa_id, p_portal, auth.uid(), p_total_activos,
          jsonb_build_object('pendientes', coalesce(array_length(v_claves, 1), 0), 'cerrados_solos', v_cerrados));

  return jsonb_build_object('pendientes', coalesce(array_length(v_claves, 1), 0),
                            'nuevos', v_nuevos, 'cerrados_solos', v_cerrados);
end;
$$;
revoke all on function public.agenda_portales_guardar(uuid, text, jsonb, integer, integer) from public, anon;
grant execute on function public.agenda_portales_guardar(uuid, text, jsonb, integer, integer) to authenticated, service_role;

-- 6) Cambiar el estado de un pendiente (lo usa la pantalla). Valida que quien llama lo pueda ver.
create or replace function public.agenda_pendiente_actualizar(p_id uuid, p_estado text, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_p public.agenda_pendientes%rowtype;
begin
  if p_estado not in ('abierto','en_proceso','cerrado','descartado') then
    raise exception 'Estado no válido';
  end if;
  select * into v_p from public.agenda_pendientes where id = p_id;
  if not found or not public.agenda_puede_ver_pendiente(v_p.empresa_id, v_p.nivel, v_p.responsable_usuario_id) then
    raise exception 'No tienes acceso a este pendiente';
  end if;
  update public.agenda_pendientes set
    estado = p_estado,
    actualizado_en = now(),
    cerrado_en = case when p_estado in ('cerrado','descartado') then now() else null end,
    cerrado_por = case when p_estado in ('cerrado','descartado') then auth.uid() else null end,
    cierre_tipo = case when p_estado in ('cerrado','descartado') then 'manual' else null end,
    nota_cierre = case when p_estado in ('cerrado','descartado') then nullif(btrim(coalesce(p_nota,'')), '') else null end
  where id = p_id;
end;
$$;
revoke all on function public.agenda_pendiente_actualizar(uuid, text, text) from public, anon;
grant execute on function public.agenda_pendiente_actualizar(uuid, text, text) to authenticated, service_role;
