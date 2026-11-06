-- 053 · Lista de estudios de mercado: el propietario (o el equipo) lo pide, un asesor sube el PDF y el sistema lo envía.
-- Tabla agenda_estudios_mercado + bucket privado «estudios-mercado» (PDF). Solo administradores/coordinadores de la empresa.
-- Las solicitudes del propietario entran por la Edge Function enviar-solicitud-propietario (service_role); el envío, por enviar-estudio-mercado.
-- NO aplicado todavía (pendiente de OK de Felipe).

create table if not exists public.agenda_estudios_mercado (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  numero_inmueble integer,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  propietario_nombre text,
  propietario_email text,
  origen text not null default 'propietario' check (origen in ('propietario', 'informe', 'manual')),
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'listo', 'enviado', 'descartado')),
  archivo_path text,
  archivo_nombre text,
  subido_en timestamptz,
  subido_por uuid references auth.users(id) on delete set null,
  enviado_en timestamptz,
  enviado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index if not exists agenda_estudios_mercado_estado_idx on public.agenda_estudios_mercado (empresa_id, estado, creado_en desc);

alter table public.agenda_estudios_mercado enable row level security;

create or replace function public.agenda_es_admin_o_coord(p_empresa uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa and m.usuario_id = auth.uid() and m.activo and m.rol in ('administrador', 'coordinador'));
$$;
revoke all on function public.agenda_es_admin_o_coord(uuid) from public, anon;
grant execute on function public.agenda_es_admin_o_coord(uuid) to authenticated, service_role;

drop policy if exists estudios_mercado_equipo on public.agenda_estudios_mercado;
create policy estudios_mercado_equipo on public.agenda_estudios_mercado
  for all to authenticated
  using (public.agenda_es_admin_o_coord(empresa_id))
  with check (public.agenda_es_admin_o_coord(empresa_id));

grant select, insert, update, delete on public.agenda_estudios_mercado to authenticated;
grant select, insert, update, delete on public.agenda_estudios_mercado to service_role;

-- Bucket privado para los PDF. Ruta: <empresa_id>/<estudio_id>.pdf (la primera carpeta es la empresa).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudios-mercado', 'estudios-mercado', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists estudios_mercado_storage on storage.objects;
create policy estudios_mercado_storage on storage.objects
  for all to authenticated
  using (bucket_id = 'estudios-mercado' and public.agenda_es_admin_o_coord(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'estudios-mercado' and public.agenda_es_admin_o_coord(((storage.foldername(name))[1])::uuid));
