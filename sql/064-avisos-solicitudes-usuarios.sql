-- 064 · Quién recibe copia de las solicitudes de propietarios (usuarios elegidos, no todos).
-- Los administradores y superadministradores siempre pueden VER las solicitudes y el informe de gestión en la pantalla;
-- esto solo decide a quién le llega el CORREO de aviso (además del asesor del inmueble y sus supervisores).
-- Idempotente; solo agrega una tabla. PENDIENTE de aplicar (con permiso de Felipe).
create table if not exists public.agenda_solicitud_avisos_usuarios (
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);
alter table public.agenda_solicitud_avisos_usuarios enable row level security;

drop policy if exists avisos_solicitudes_gestion on public.agenda_solicitud_avisos_usuarios;
create policy avisos_solicitudes_gestion on public.agenda_solicitud_avisos_usuarios
  for all to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'config.empresa'))
  with check (public.agenda_tiene_permiso(empresa_id, 'config.empresa'));

grant select, insert, update, delete on public.agenda_solicitud_avisos_usuarios to authenticated;
grant select, insert, update, delete on public.agenda_solicitud_avisos_usuarios to service_role;
