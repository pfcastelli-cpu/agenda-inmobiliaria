-- 060 · Supervisores múltiples por asesor
-- Un supervisor es una persona con acceso de coordinador, administrador o superadministrador.
-- No exige que esa persona tenga una ficha en Equipo.
-- Aplicar solo después de verificar en Supabase que el archivo corresponde al código desplegado.

begin;

create table if not exists public.agenda_asesor_supervisores (
  asesor_id uuid not null references public.agenda_asesores(id) on delete cascade,
  supervisor_usuario_id uuid not null references auth.users(id) on delete restrict,
  creado_en timestamptz not null default now(),
  primary key (asesor_id, supervisor_usuario_id)
);

create index if not exists agenda_asesor_supervisores_usuario_idx
  on public.agenda_asesor_supervisores(supervisor_usuario_id);

create or replace function public.agenda_validar_supervisor_asesor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_rol text;
begin
  select a.empresa_id into v_empresa
    from public.agenda_asesores a
   where a.id = new.asesor_id;
  if v_empresa is null then
    raise exception 'El asesor no existe';
  end if;

  select m.rol
    into v_rol
    from public.agenda_miembros m
   where m.empresa_id = v_empresa
     and m.usuario_id = new.supervisor_usuario_id
     and m.activo;
  -- El superadministrador conserva rol base "administrador" en agenda_miembros.
  if v_rol is null or v_rol not in ('administrador', 'coordinador') then
    raise exception 'El supervisor debe ser un coordinador, administrador o superadministrador activo';
  end if;

  if exists (
    select 1 from public.agenda_asesores a
     where a.id = new.asesor_id and a.usuario_id = new.supervisor_usuario_id
  ) then
    raise exception 'Una persona no puede supervisarse a sí misma';
  end if;
  return new;
end;
$$;

drop trigger if exists agenda_validar_supervisor_asesor on public.agenda_asesor_supervisores;
create trigger agenda_validar_supervisor_asesor
before insert or update on public.agenda_asesor_supervisores
for each row execute function public.agenda_validar_supervisor_asesor();

create or replace function public.agenda_guardar_supervisores_asesor(
  p_asesor_id uuid,
  p_supervisor_usuario_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.agenda_asesores where id = p_asesor_id;
  if v_empresa is null or not public.agenda_es_admin(v_empresa) then
    raise exception 'No tienes permiso para cambiar los supervisores de este asesor';
  end if;
  delete from public.agenda_asesor_supervisores where asesor_id = p_asesor_id;
  insert into public.agenda_asesor_supervisores (asesor_id, supervisor_usuario_id)
  select p_asesor_id, x
    from unnest(coalesce(p_supervisor_usuario_ids, '{}'::uuid[])) as ids(x)
   where x is not null
  on conflict do nothing;
end;
$$;
revoke all on function public.agenda_guardar_supervisores_asesor(uuid, uuid[]) from public, anon;
grant execute on function public.agenda_guardar_supervisores_asesor(uuid, uuid[]) to authenticated, service_role;

alter table public.agenda_asesor_supervisores enable row level security;
revoke all on public.agenda_asesor_supervisores from public, anon, authenticated;
grant select, insert, delete on public.agenda_asesor_supervisores to authenticated;
grant select, insert, update, delete on public.agenda_asesor_supervisores to service_role;

drop policy if exists agenda_asesor_supervisores_lectura on public.agenda_asesor_supervisores;
create policy agenda_asesor_supervisores_lectura
on public.agenda_asesor_supervisores for select to authenticated
using (
  public.agenda_es_admin((select a.empresa_id from public.agenda_asesores a where a.id = asesor_id))
);

drop policy if exists agenda_asesor_supervisores_alta on public.agenda_asesor_supervisores;
create policy agenda_asesor_supervisores_alta
on public.agenda_asesor_supervisores for insert to authenticated
with check (
  public.agenda_es_admin((select a.empresa_id from public.agenda_asesores a where a.id = asesor_id))
);

drop policy if exists agenda_asesor_supervisores_baja on public.agenda_asesor_supervisores;
create policy agenda_asesor_supervisores_baja
on public.agenda_asesor_supervisores for delete to authenticated
using (
  public.agenda_es_admin((select a.empresa_id from public.agenda_asesores a where a.id = asesor_id))
);

-- Conserva los supervisores antiguos que ya fueran accesos de rango superior.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'agenda_asesores' and column_name = 'supervisor_id'
  ) then
    insert into public.agenda_asesor_supervisores (asesor_id, supervisor_usuario_id)
    select a.id, s.usuario_id
      from public.agenda_asesores a
      join public.agenda_asesores s on s.id = a.supervisor_id and s.usuario_id is not null
      join public.agenda_miembros m on m.empresa_id = a.empresa_id and m.usuario_id = s.usuario_id and m.activo
     where a.supervisor_id is not null
       and m.rol in ('administrador', 'coordinador')
    on conflict do nothing;
  end if;
end $$;

commit;
