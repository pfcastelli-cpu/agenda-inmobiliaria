-- Agenda inmobiliaria | Paso 1 | Ejecutar completo en SQL Editor como postgres.
-- Crea solo empresas y membresías. No crea citas ni modifica auth.users.
-- Ejecutar una vez. Si ya existen estas tablas, se detiene sin reemplazarlas.
-- Ante cualquier error, la transacción completa se revierte.
begin;

do $$
begin
  if not exists (select 1 from auth.users where id = 'f924d6d2-edc2-4ab9-98c2-98e77df09c73'::uuid) then
    raise exception 'El UID indicado no existe en Authentication > Users de este proyecto.';
  end if;
end $$;

create table public.agenda_empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  zona_horaria text not null default 'America/Bogota',
  color_principal text not null default '#1A2C45',
  color_accion text not null default '#00A9A5',
  creada_en timestamptz not null default now()
);

create table public.agenda_miembros (
  empresa_id uuid not null references public.agenda_empresas(id) on delete restrict,
  usuario_id uuid not null references auth.users(id) on delete restrict,
  nombre text not null,
  rol text not null check (rol in ('administrador', 'coordinador', 'asesor')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);
create index agenda_miembros_usuario_idx on public.agenda_miembros(usuario_id);

alter table public.agenda_empresas enable row level security;
alter table public.agenda_miembros enable row level security;
revoke all on public.agenda_empresas, public.agenda_miembros from public, anon, authenticated;
grant select on public.agenda_empresas, public.agenda_miembros to authenticated;

-- Primera etapa: cada usuario consulta sus membresías activas y sus empresas.
-- Nadie puede asignarse roles desde el navegador. La gestión administrativa
-- de otros usuarios se implementará después mediante operaciones autorizadas.
create policy agenda_miembro_lee_su_acceso
on public.agenda_miembros for select to authenticated
using (usuario_id = (select auth.uid()) and activo);

create policy agenda_miembro_lee_empresa
on public.agenda_empresas for select to authenticated
using (exists (
  select 1 from public.agenda_miembros m
  where m.empresa_id = agenda_empresas.id
    and m.usuario_id = (select auth.uid()) and m.activo
));

with empresa as (
  insert into public.agenda_empresas(nombre, slug)
  values ('Patrimonios Inmobiliarios', 'patrimonios') returning id
)
insert into public.agenda_miembros(empresa_id, usuario_id, nombre, rol)
select id, 'f924d6d2-edc2-4ab9-98c2-98e77df09c73'::uuid, 'Felipe', 'administrador'
from empresa;

-- Comprobaciones bajo el rol usado por la aplicación, dentro de la transacción.
select set_config('request.jwt.claim.sub', 'f924d6d2-edc2-4ab9-98c2-98e77df09c73', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.agenda_empresas) <> 1
     or (select count(*) from public.agenda_miembros where rol = 'administrador') <> 1 then
    raise exception 'No pasó la comprobación de acceso del administrador.';
  end if;
  if has_table_privilege(current_user, 'public.agenda_miembros', 'INSERT')
     or has_table_privilege(current_user, 'public.agenda_miembros', 'UPDATE')
     or has_table_privilege(current_user, 'public.agenda_miembros', 'DELETE') then
    raise exception 'Se detectaron permisos de escritura no autorizados.';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.agenda_empresas)
     or exists (select 1 from public.agenda_miembros) then
    raise exception 'Un usuario ajeno puede ver datos de la empresa.';
  end if;
end $$;
reset role;

do $$
begin
  if has_table_privilege('anon', 'public.agenda_empresas', 'SELECT')
     or has_table_privilege('anon', 'public.agenda_miembros', 'SELECT') then
    raise exception 'Se detectó acceso público no autorizado.';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);
commit;

-- Resultado final esperado: una fila con Felipe / administrador / true.
select e.nombre as empresa, m.nombre as usuario, m.rol, m.activo
from public.agenda_empresas e
join public.agenda_miembros m on m.empresa_id = e.id
where e.slug = 'patrimonios'
  and m.usuario_id = 'f924d6d2-edc2-4ab9-98c2-98e77df09c73'::uuid;
