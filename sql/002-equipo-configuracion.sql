-- Ejecutar una sola vez en SQL Editor. No repetir 001.
begin;
create function public.agenda_es_admin(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.agenda_miembros where empresa_id=p_empresa and usuario_id=auth.uid() and activo and rol='administrador');
$$;
revoke all on function public.agenda_es_admin(uuid) from public;
grant execute on function public.agenda_es_admin(uuid) to authenticated;
create table public.agenda_configuracion (
 empresa_id uuid primary key references public.agenda_empresas(id),
 nombre_comercial text not null check(length(trim(nombre_comercial)) between 1 and 120),
 logo_url text not null default '' check(logo_url='' or logo_url ~ '^https://'),
 color_principal text not null default '#1A2C45' check(color_principal ~ '^#[0-9a-fA-F]{6}$'),
 color_accion text not null default '#00A9A5' check(color_accion ~ '^#[0-9a-fA-F]{6}$'),
 correo_contacto text not null default '', telefono text not null default '',
 ciudades text not null default 'Bogotá, Barranquilla, Medellín',
 enlace_documentos text not null default '' check(enlace_documentos='' or enlace_documentos ~ '^https://')
);
insert into public.agenda_configuracion(empresa_id,nombre_comercial,color_principal,color_accion)
select id,nombre,color_principal,color_accion from public.agenda_empresas;
create table public.agenda_asesores (
 id uuid primary key default gen_random_uuid(),
 empresa_id uuid not null references public.agenda_empresas(id),
 nombre text not null check(length(trim(nombre)) between 1 and 120),
 correo text not null check(correo=lower(trim(correo)) and correo ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 celular text not null check(celular ~ '^\+[1-9][0-9]{7,14}$'),
 ciudades text not null check(length(trim(ciudades))>0),
 rol text not null default 'asesor' check(rol in ('asesor','coordinador')),
 prioridad integer not null default 3 check(prioridad between 1 and 5),
 activo boolean not null default true,
 creado_en timestamptz not null default now(),
 unique(empresa_id,correo)
);
-- Son fichas de equipo. No conceden acceso ni crean cuentas Auth.
alter table public.agenda_configuracion enable row level security;
alter table public.agenda_asesores enable row level security;
revoke all on public.agenda_configuracion,public.agenda_asesores from public,anon,authenticated;
grant select,insert,update on public.agenda_configuracion,public.agenda_asesores to authenticated;
create policy configuracion_lectura on public.agenda_configuracion for select to authenticated using (
 exists(select 1 from public.agenda_miembros m where m.empresa_id=agenda_configuracion.empresa_id and m.usuario_id=auth.uid() and m.activo));
create policy configuracion_alta on public.agenda_configuracion for insert to authenticated with check(public.agenda_es_admin(empresa_id));
create policy configuracion_edicion on public.agenda_configuracion for update to authenticated using(public.agenda_es_admin(empresa_id)) with check(public.agenda_es_admin(empresa_id));
create policy asesores_lectura on public.agenda_asesores for select to authenticated using(public.agenda_es_admin(empresa_id));
create policy asesores_alta on public.agenda_asesores for insert to authenticated with check(public.agenda_es_admin(empresa_id));
create policy asesores_edicion on public.agenda_asesores for update to authenticated using(public.agenda_es_admin(empresa_id)) with check(public.agenda_es_admin(empresa_id));
commit;
