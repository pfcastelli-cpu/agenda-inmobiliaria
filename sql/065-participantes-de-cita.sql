-- 065 · Varias personas en una misma visita: el asesor de la cita sigue siendo uno; aquí se agregan acompañantes
-- (otro asesor, o una persona de la empresa que no es asesor, por ejemplo un administrador o coordinador).
-- No bloquea la agenda de los acompañantes. Idempotente; solo agrega una tabla. PENDIENTE de aplicar (con permiso de Felipe).
create table if not exists public.agenda_cita_participantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  cita_id uuid not null references public.agenda_citas(id) on delete cascade,
  asesor_id uuid references public.agenda_asesores(id) on delete cascade,
  nombre_libre text,
  es_asesor boolean not null default true,
  agregado_por uuid references auth.users(id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  constraint agenda_cita_participantes_quien check (asesor_id is not null or nullif(btrim(nombre_libre), '') is not null)
);
create unique index if not exists agenda_cita_participantes_unico on public.agenda_cita_participantes (cita_id, asesor_id) where asesor_id is not null;
create index if not exists agenda_cita_participantes_cita on public.agenda_cita_participantes (cita_id);
alter table public.agenda_cita_participantes enable row level security;

drop policy if exists participantes_lectura on public.agenda_cita_participantes;
create policy participantes_lectura on public.agenda_cita_participantes for select to authenticated
  using (public.agenda_rol_actual(empresa_id) is not null);
drop policy if exists participantes_alta on public.agenda_cita_participantes;
create policy participantes_alta on public.agenda_cita_participantes for insert to authenticated
  with check (public.agenda_es_admin_o_coord(empresa_id));
drop policy if exists participantes_baja on public.agenda_cita_participantes;
create policy participantes_baja on public.agenda_cita_participantes for delete to authenticated
  using (public.agenda_es_admin_o_coord(empresa_id));

grant select, insert, update, delete on public.agenda_cita_participantes to authenticated;
grant select, insert, update, delete on public.agenda_cita_participantes to service_role;
