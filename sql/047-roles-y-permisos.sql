-- 047 · Roles propios y permisos por funcionalidad (Fase A)
-- Decisiones de Felipe (04-nov-2026):
--   1) Planta/freelance NO son roles (siguen siendo «tipo de asesor»). Los roles son: Superadministrador, Administrador, Coordinador, Asesor
--      y los que la empresa cree. El superadministrador puede todo.
--   2) Permisos agrupados por categoría con subpermisos (marcar toda la categoría o solo parte).
--   3) Quien tenga el permiso «roles.gestionar» puede crear/editar roles (también los del sistema, salvo el Superadministrador) y asignarlos.
-- Cómo funciona sin romper nada:
--   * Cada rol tiene una «base» (administrador / coordinador / asesor) = el acceso a DATOS que ya imponen las políticas RLS de siempre.
--     agenda_miembros.rol sigue guardando esa base (así RLS, funciones y la Edge Function gestion-accesos no cambian).
--   * Los permisos de cada rol AFINAN lo que se ve y se puede hacer en la pantalla (Fase A) y se irán exigiendo también en la base (Fase B).
--     Un permiso nunca da más datos de los que permite la base del rol.
--   * Toda escritura va por funciones SECURITY DEFINER que validan quién llama; el navegador no escribe estas tablas.
--   * Anti-escalada: nadie puede dar permisos que no tiene (salvo el superadministrador), ni crear un rol con base más alta que la suya,
--     ni dejar a la empresa sin superadministrador activo.
-- Los administradores actuales pasan a Superadministrador (nada cambia para ellos); coordinador y asesor mantienen su rol.
-- Es idempotente. Aplicar con permiso de Felipe.

-- ------------------------------------------------------------------ catálogo de permisos (lo mismo para todas las empresas)
create table if not exists public.agenda_permisos (
  clave text primary key,
  categoria text not null,
  nombre text not null,
  descripcion text,
  orden int not null default 0
);

insert into public.agenda_permisos (clave, categoria, nombre, descripcion, orden) values
  ('agenda.ver_propia',      'Agenda', 'Ver su propia agenda', null, 101),
  ('agenda.ver_todas',       'Agenda', 'Ver la agenda de todos los asesores', null, 102),
  ('agenda.crear',           'Agenda', 'Crear citas', null, 103),
  ('agenda.modificar',       'Agenda', 'Modificar citas', 'Cambiar fecha, hora, asesor o datos de una cita.', 104),
  ('agenda.cancelar',        'Agenda', 'Cancelar o eliminar citas', null, 105),
  ('agenda.reubicar',        'Agenda', 'Reubicar citas y resolver propuestas', null, 106),
  ('agenda.actividades',     'Agenda', 'Crear actividades internas', 'Inventarios, entregas, firmas, trámites, reuniones internas…', 107),
  ('inmuebles.ver',          'Inmuebles', 'Ver inmuebles', null, 201),
  ('inmuebles.editar',       'Inmuebles', 'Editar datos del inmueble', null, 202),
  ('inmuebles.no_disponible','Inmuebles', 'Marcar un inmueble como no disponible', null, 203),
  ('inmuebles.importar',     'Inmuebles', 'Importar inmuebles y reportes de portales', null, 204),
  ('equipo.ver',             'Equipo', 'Ver el equipo de asesores', null, 301),
  ('equipo.crear',           'Equipo', 'Crear fichas de asesores', null, 302),
  ('equipo.editar',          'Equipo', 'Editar fichas (horarios, coberturas, tipo)', null, 303),
  ('equipo.dar_acceso',      'Equipo', 'Dar acceso, cambiar contraseñas y activar o desactivar usuarios', null, 304),
  ('informes.ver',           'Informes', 'Ver informes', null, 401),
  ('informes.exportar',      'Informes', 'Exportar informes', null, 402),
  ('informes.demanda',       'Informes', 'Ver y gestionar alertas de demanda', null, 403),
  ('bitacora.ver',           'Bitácora', 'Ver la bitácora', null, 501),
  ('pendientes.ver',         'Pendientes', 'Ver pendientes', null, 601),
  ('pendientes.gestionar',   'Pendientes', 'Resolver pendientes', null, 602),
  ('captacion.ver',          'Captación', 'Ver captaciones', null, 701),
  ('captacion.crear',        'Captación', 'Agendar captaciones', null, 702),
  ('soporte.crear',          'Soporte', 'Crear tickets de soporte', null, 801),
  ('soporte.ver_empresa',    'Soporte', 'Ver los tickets de toda la empresa', null, 802),
  ('config.empresa',         'Configuración', 'Datos de la empresa, marca y reservas públicas', null, 901),
  ('config.correo',          'Configuración', 'Correo de la empresa', null, 902),
  ('config.ciudades',        'Configuración', 'Ciudades, coberturas y festivos', null, 903),
  ('config.demanda',         'Configuración', 'Demanda y alertas', null, 904),
  ('config.ia_reuniones',    'Configuración', 'Inteligencia artificial y reuniones', null, 905),
  ('roles.ver',              'Roles y permisos', 'Ver roles y quién tiene cada uno', null, 1001),
  ('roles.gestionar',        'Roles y permisos', 'Crear, editar y asignar roles', 'Es el permiso más delicado: quien lo tiene decide quién puede qué.', 1002)
on conflict (clave) do update set categoria = excluded.categoria, nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

-- ------------------------------------------------------------------ roles por empresa
create table if not exists public.agenda_roles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  clave text,                                   -- solo roles del sistema: superadministrador | administrador | coordinador | asesor
  nombre text not null check (length(btrim(nombre)) between 2 and 60),
  descripcion text check (descripcion is null or length(descripcion) <= 300),
  base text not null check (base in ('administrador', 'coordinador', 'asesor')),
  es_super boolean not null default false,
  es_sistema boolean not null default false,
  creado_en timestamptz not null default now(),
  creado_por uuid
);
create unique index if not exists agenda_roles_nombre_unico on public.agenda_roles (empresa_id, lower(btrim(nombre)));
create unique index if not exists agenda_roles_clave_unica on public.agenda_roles (empresa_id, clave) where clave is not null;

create table if not exists public.agenda_rol_permisos (
  rol_id uuid not null references public.agenda_roles(id) on delete cascade,
  permiso text not null references public.agenda_permisos(clave) on delete cascade,
  primary key (rol_id, permiso)
);

alter table public.agenda_miembros add column if not exists rol_id uuid references public.agenda_roles(id) on delete restrict;
create index if not exists agenda_miembros_rol_idx on public.agenda_miembros (rol_id);

-- ------------------------------------------------------------------ RLS: solo lectura para los miembros de la empresa
alter table public.agenda_permisos enable row level security;
alter table public.agenda_roles enable row level security;
alter table public.agenda_rol_permisos enable row level security;
drop policy if exists permisos_leer on public.agenda_permisos;
create policy permisos_leer on public.agenda_permisos for select to authenticated using (true);
drop policy if exists roles_leer on public.agenda_roles;
create policy roles_leer on public.agenda_roles for select to authenticated using (public.agenda_rol_actual(empresa_id) is not null);
drop policy if exists rol_permisos_leer on public.agenda_rol_permisos;
create policy rol_permisos_leer on public.agenda_rol_permisos for select to authenticated
  using (exists (select 1 from public.agenda_roles r where r.id = rol_id and public.agenda_rol_actual(r.empresa_id) is not null));

-- El navegador solo lee. (Desviación consciente de la regla general «CRUD a authenticated»: aquí escribir saltándose las funciones sería una escalada de privilegios.)
revoke all on public.agenda_permisos, public.agenda_roles, public.agenda_rol_permisos from anon, authenticated;
grant select on public.agenda_permisos, public.agenda_roles, public.agenda_rol_permisos to authenticated;
grant select, insert, update, delete on public.agenda_permisos, public.agenda_roles, public.agenda_rol_permisos to service_role;

-- ------------------------------------------------------------------ roles del sistema por empresa
create or replace function public.agenda_roles_sembrar(p_empresa_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_super uuid; v_admin uuid; v_coord uuid; v_asesor uuid;
begin
  insert into public.agenda_roles (empresa_id, clave, nombre, descripcion, base, es_super, es_sistema) values
    (p_empresa_id, 'superadministrador', 'Superadministrador', 'Puede todo, siempre. Es el único que no se puede editar.', 'administrador', true, true),
    (p_empresa_id, 'administrador', 'Administrador', 'Gestiona la operación y la configuración, pero no los roles.', 'administrador', false, true),
    (p_empresa_id, 'coordinador', 'Coordinador', 'Ve toda la agenda, los informes y la bitácora.', 'coordinador', false, true),
    (p_empresa_id, 'asesor', 'Asesor', 'Trabaja su propia agenda.', 'asesor', false, true)
  on conflict (empresa_id, clave) where clave is not null do nothing;
  select id into v_super from public.agenda_roles where empresa_id = p_empresa_id and clave = 'superadministrador';
  select id into v_admin from public.agenda_roles where empresa_id = p_empresa_id and clave = 'administrador';
  select id into v_coord from public.agenda_roles where empresa_id = p_empresa_id and clave = 'coordinador';
  select id into v_asesor from public.agenda_roles where empresa_id = p_empresa_id and clave = 'asesor';
  -- Los permisos iniciales solo se cargan si el rol aún no tiene ninguno (así no se pisan los cambios que haga la empresa).
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_admin) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_admin, clave from public.agenda_permisos where clave <> 'roles.gestionar';
  end if;
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_coord) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_coord, unnest(array[
      'agenda.ver_propia','agenda.ver_todas','agenda.crear','agenda.modificar','agenda.cancelar','agenda.reubicar','agenda.actividades',
      'inmuebles.ver','inmuebles.editar','inmuebles.no_disponible','equipo.ver','informes.ver','informes.exportar','informes.demanda',
      'bitacora.ver','pendientes.ver','pendientes.gestionar','captacion.ver','captacion.crear','soporte.crear','soporte.ver_empresa','roles.ver']);
  end if;
  if not exists (select 1 from public.agenda_rol_permisos where rol_id = v_asesor) then
    insert into public.agenda_rol_permisos (rol_id, permiso) select v_asesor, unnest(array[
      'agenda.ver_propia','agenda.crear','agenda.modificar','agenda.cancelar','agenda.actividades','inmuebles.ver',
      'pendientes.ver','captacion.ver','captacion.crear','soporte.crear']);
  end if;
end;
$$;
revoke all on function public.agenda_roles_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.agenda_roles_sembrar(uuid) to service_role;

select public.agenda_roles_sembrar(id) from public.agenda_empresas;

-- Empresas nuevas reciben sus roles solas.
create or replace function public.agenda_empresa_sembrar_roles() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.agenda_roles_sembrar(new.id); return new; end;
$$;
drop trigger if exists agenda_empresa_roles on public.agenda_empresas;
create trigger agenda_empresa_roles after insert on public.agenda_empresas for each row execute function public.agenda_empresa_sembrar_roles();

-- Miembros existentes: administrador → Superadministrador (no pierden nada); coordinador y asesor → su rol de siempre.
update public.agenda_miembros m set rol_id = r.id
  from public.agenda_roles r
 where m.rol_id is null and r.empresa_id = m.empresa_id and r.es_sistema
   and r.clave = case m.rol when 'administrador' then 'superadministrador' else m.rol end;

-- Si algo cambia agenda_miembros.rol por la vía vieja (gestion-accesos, SQL a mano) sin tocar rol_id, el rol del sistema equivalente se asigna solo.
create or replace function public.agenda_miembro_sincronizar_rol() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.rol_id is not null then return new; end if;
  if tg_op = 'UPDATE' and (new.rol is not distinct from old.rol or new.rol_id is distinct from old.rol_id) then return new; end if;
  if new.rol_id is not null and exists (select 1 from public.agenda_roles r where r.id = new.rol_id and r.base = new.rol) then return new; end if;   -- cambio hecho por las funciones de roles
  select r.id into new.rol_id from public.agenda_roles r
   where r.empresa_id = new.empresa_id and r.es_sistema and r.clave = new.rol;   -- un administrador nuevo por la vía vieja queda como «Administrador» (no super)
  return new;
end;
$$;
drop trigger if exists agenda_miembro_rol_sync on public.agenda_miembros;
create trigger agenda_miembro_rol_sync before insert or update on public.agenda_miembros for each row execute function public.agenda_miembro_sincronizar_rol();

-- ------------------------------------------------------------------ quién puede qué
-- Rol efectivo de quien llama (rol_id, o el del sistema equivalente a su base si aún no tiene).
create or replace function public.agenda_rol_id_actual(p_empresa_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(m.rol_id, (select r.id from public.agenda_roles r where r.empresa_id = m.empresa_id and r.es_sistema and r.clave = m.rol))
    from public.agenda_miembros m
   where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo limit 1
$$;

create or replace function public.agenda_mis_permisos(p_empresa_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rol_id', r.id, 'rol', r.nombre, 'base', r.base, 'es_super', r.es_super,
    'permisos', case when r.es_super then (select coalesce(jsonb_agg(clave order by orden), '[]') from public.agenda_permisos)
                     else (select coalesce(jsonb_agg(rp.permiso), '[]') from public.agenda_rol_permisos rp where rp.rol_id = r.id) end)
    from public.agenda_roles r where r.id = public.agenda_rol_id_actual(p_empresa_id)
$$;

create or replace function public.agenda_tiene_permiso(p_empresa_id uuid, p_permiso text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.es_super or exists (select 1 from public.agenda_rol_permisos rp where rp.rol_id = r.id and rp.permiso = p_permiso)
                     from public.agenda_roles r where r.id = public.agenda_rol_id_actual(p_empresa_id)), false)
$$;

revoke all on function public.agenda_rol_id_actual(uuid), public.agenda_mis_permisos(uuid), public.agenda_tiene_permiso(uuid, text) from public, anon;
grant execute on function public.agenda_rol_id_actual(uuid), public.agenda_mis_permisos(uuid), public.agenda_tiene_permiso(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ listar roles (con permisos y cuántas personas lo tienen)
create or replace function public.agenda_roles_listar(p_empresa_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'roles.ver') and not public.agenda_tiene_permiso(p_empresa_id, 'roles.gestionar') then
    raise exception 'No tienes permiso para ver los roles.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'clave', r.clave, 'nombre', r.nombre, 'descripcion', r.descripcion, 'base', r.base, 'es_super', r.es_super, 'es_sistema', r.es_sistema,
      'personas', (select count(*) from public.agenda_miembros m where m.rol_id = r.id and m.activo),
      'permisos', case when r.es_super then (select coalesce(jsonb_agg(clave order by orden), '[]') from public.agenda_permisos)
                       else (select coalesce(jsonb_agg(rp.permiso), '[]') from public.agenda_rol_permisos rp where rp.rol_id = r.id) end)
    order by r.es_super desc, r.es_sistema desc, r.base, r.nombre) from public.agenda_roles r where r.empresa_id = p_empresa_id), '[]');
end;
$$;
revoke all on function public.agenda_roles_listar(uuid) from public, anon;
grant execute on function public.agenda_roles_listar(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ crear / editar un rol
create or replace function public.agenda_rol_guardar(p_empresa_id uuid, p_rol_id uuid, p_nombre text, p_descripcion text, p_base text, p_permisos text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_yo public.agenda_roles%rowtype;
  v_rol public.agenda_roles%rowtype;
  v_id uuid;
  v_nivel constant jsonb := '{"asesor":1,"coordinador":2,"administrador":3}';
  v_mis text[];
  v_sobran text[];
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'roles.gestionar') then raise exception 'No tienes permiso para gestionar roles.'; end if;
  select * into v_yo from public.agenda_roles where id = public.agenda_rol_id_actual(p_empresa_id);
  p_permisos := coalesce((select array_agg(distinct x) from unnest(p_permisos) x), '{}');
  if exists (select 1 from unnest(p_permisos) x where x not in (select clave from public.agenda_permisos)) then raise exception 'Hay un permiso que no existe.'; end if;
  if p_base not in ('administrador', 'coordinador', 'asesor') then raise exception 'La base del rol no es válida.'; end if;
  if length(btrim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribe un nombre para el rol.'; end if;

  if not v_yo.es_super then
    if (v_nivel ->> p_base)::int > (v_nivel ->> v_yo.base)::int then raise exception 'No puedes crear un rol con más acceso a los datos que el tuyo.'; end if;
    select array_agg(rp.permiso) into v_mis from public.agenda_rol_permisos rp where rp.rol_id = v_yo.id;
    select array_agg(x) into v_sobran from unnest(p_permisos) x where x <> all (coalesce(v_mis, '{}'));
    if v_sobran is not null then raise exception 'No puedes dar permisos que tú no tienes (%).', array_to_string(v_sobran, ', '); end if;
  end if;

  if p_rol_id is null then
    insert into public.agenda_roles (empresa_id, nombre, descripcion, base, creado_por) values (p_empresa_id, btrim(p_nombre), nullif(btrim(coalesce(p_descripcion, '')), ''), p_base, auth.uid())
    returning id into v_id;
  else
    select * into v_rol from public.agenda_roles where id = p_rol_id and empresa_id = p_empresa_id for update;
    if not found then raise exception 'Ese rol no existe.'; end if;
    if v_rol.es_super then raise exception 'El Superadministrador no se puede editar: siempre puede todo.'; end if;
    if not v_yo.es_super and (v_nivel ->> v_rol.base)::int > (v_nivel ->> v_yo.base)::int then raise exception 'No puedes editar un rol con más acceso que el tuyo.'; end if;
    if v_rol.id = v_yo.id and not v_yo.es_super and not ('roles.gestionar' = any (p_permisos)) then raise exception 'No puedes quitarte a ti mismo el permiso de gestionar roles.'; end if;
    update public.agenda_roles set nombre = btrim(p_nombre), descripcion = nullif(btrim(coalesce(p_descripcion, '')), ''),
           base = case when es_sistema then base else p_base end where id = p_rol_id;
    v_id := p_rol_id;
    delete from public.agenda_rol_permisos where rol_id = v_id;
    -- La base del rol viaja con las personas que lo tienen (RLS sigue mirando agenda_miembros.rol).
    update public.agenda_miembros m set rol = (select base from public.agenda_roles where id = v_id) where m.rol_id = v_id;
  end if;
  insert into public.agenda_rol_permisos (rol_id, permiso) select v_id, x from unnest(p_permisos) x;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe un rol con ese nombre.';
end;
$$;

-- ------------------------------------------------------------------ eliminar un rol (solo propios y sin personas)
create or replace function public.agenda_rol_eliminar(p_empresa_id uuid, p_rol_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rol public.agenda_roles%rowtype;
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'roles.gestionar') then raise exception 'No tienes permiso para gestionar roles.'; end if;
  select * into v_rol from public.agenda_roles where id = p_rol_id and empresa_id = p_empresa_id;
  if not found then raise exception 'Ese rol no existe.'; end if;
  if v_rol.es_sistema then raise exception 'Los roles del sistema no se pueden eliminar.'; end if;
  if exists (select 1 from public.agenda_miembros where rol_id = p_rol_id) then raise exception 'Hay personas con este rol. Cámbiales el rol antes de eliminarlo.'; end if;
  delete from public.agenda_roles where id = p_rol_id;
end;
$$;

-- ------------------------------------------------------------------ asignar un rol a una persona
create or replace function public.agenda_miembro_asignar_rol(p_empresa_id uuid, p_usuario_id uuid, p_rol_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_yo public.agenda_roles%rowtype;
  v_nuevo public.agenda_roles%rowtype;
  v_actual public.agenda_roles%rowtype;
  v_nivel constant jsonb := '{"asesor":1,"coordinador":2,"administrador":3}';
  v_mis text[]; v_sobran text[];
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'roles.gestionar') then raise exception 'No tienes permiso para asignar roles.'; end if;
  select * into v_yo from public.agenda_roles where id = public.agenda_rol_id_actual(p_empresa_id);
  select * into v_nuevo from public.agenda_roles where id = p_rol_id and empresa_id = p_empresa_id;
  if not found then raise exception 'Ese rol no existe.'; end if;
  select r.* into v_actual from public.agenda_miembros m join public.agenda_roles r on r.id = coalesce(m.rol_id, (select x.id from public.agenda_roles x where x.empresa_id = m.empresa_id and x.es_sistema and x.clave = m.rol))
   where m.empresa_id = p_empresa_id and m.usuario_id = p_usuario_id;
  if v_actual.id is null then raise exception 'Esa persona no pertenece a tu empresa.'; end if;

  if not v_yo.es_super then
    if v_nuevo.es_super or v_actual.es_super then raise exception 'Solo un Superadministrador puede dar o quitar ese rol.'; end if;
    if (v_nivel ->> v_nuevo.base)::int > (v_nivel ->> v_yo.base)::int or (v_nivel ->> v_actual.base)::int > (v_nivel ->> v_yo.base)::int then
      raise exception 'No puedes asignar ni cambiar roles con más acceso que el tuyo.';
    end if;
    select array_agg(rp.permiso) into v_mis from public.agenda_rol_permisos rp where rp.rol_id = v_yo.id;
    select array_agg(rp.permiso) into v_sobran from public.agenda_rol_permisos rp where rp.rol_id = v_nuevo.id and rp.permiso <> all (coalesce(v_mis, '{}'));
    if v_sobran is not null then raise exception 'Ese rol tiene permisos que tú no tienes, así que no puedes asignarlo.'; end if;
  end if;
  -- Siempre debe quedar al menos un Superadministrador activo.
  if v_actual.es_super and not v_nuevo.es_super
     and not exists (select 1 from public.agenda_miembros m join public.agenda_roles r on r.id = m.rol_id
                      where m.empresa_id = p_empresa_id and m.activo and r.es_super and m.usuario_id <> p_usuario_id) then
    raise exception 'Debe quedar al menos un Superadministrador activo.';
  end if;
  update public.agenda_miembros set rol_id = p_rol_id, rol = v_nuevo.base where empresa_id = p_empresa_id and usuario_id = p_usuario_id;
end;
$$;

revoke all on function public.agenda_rol_guardar(uuid, uuid, text, text, text, text[]), public.agenda_rol_eliminar(uuid, uuid), public.agenda_miembro_asignar_rol(uuid, uuid, uuid) from public, anon;
grant execute on function public.agenda_rol_guardar(uuid, uuid, text, text, text, text[]), public.agenda_rol_eliminar(uuid, uuid), public.agenda_miembro_asignar_rol(uuid, uuid, uuid) to authenticated, service_role;
