-- 125 · Actas de entrega (subida desde el caso, copia a Drive por el lector) y casos detectados por correo (verificación + datos).
-- NO aplicado todavía: se revisa y se aplica solo con la orden de Felipe.
-- Depende de: 120 (agenda_casos) y 124 (agenda_inmueble_correos, agenda_gestiona_casos). Aplicar DESPUÉS de 120, 121, 122 y 123.

-- 1) Actas: el asesor sube el archivo a un depósito privado; el lector (Apps Script) lo copia a Drive y deja el enlace.
create table if not exists public.agenda_casos_actas (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  nombre text not null check (char_length(nombre) between 1 and 200),
  ruta text not null,                                   -- ruta dentro del depósito «casos-actas»: <empresa_id>/<caso_id>/<archivo>
  drive_url text check (drive_url is null or drive_url ~* '^https://(drive|docs)\.google\.com/'),
  drive_estado text not null default 'pendiente' check (drive_estado in ('pendiente', 'copiado', 'error')),
  drive_error text,
  subido_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_casos_actas_idx on public.agenda_casos_actas (caso_id);
create index if not exists agenda_casos_actas_pend_idx on public.agenda_casos_actas (drive_estado) where drive_estado = 'pendiente';
alter table public.agenda_casos_actas enable row level security;

drop policy if exists agenda_casos_actas_leer on public.agenda_casos_actas;
create policy agenda_casos_actas_leer on public.agenda_casos_actas for select to authenticated using (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_actas_insertar on public.agenda_casos_actas;
create policy agenda_casos_actas_insertar on public.agenda_casos_actas for insert to authenticated
  with check (public.agenda_gestiona_casos(empresa_id) and exists (select 1 from public.agenda_casos c where c.id = caso_id and c.empresa_id = agenda_casos_actas.empresa_id));   -- el caso debe ser de la misma empresa
revoke all on public.agenda_casos_actas from anon;
grant select, insert on public.agenda_casos_actas to authenticated;
grant select, insert, update, delete on public.agenda_casos_actas to service_role;

-- Depósito privado (no público). Solo administradores y coordinadores de la empresa de la primera carpeta de la ruta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('casos-actas', 'casos-actas', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists casos_actas_subir on storage.objects;
create policy casos_actas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'casos-actas' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.agenda_gestiona_casos(((storage.foldername(name))[1])::uuid));
drop policy if exists casos_actas_ver on storage.objects;
create policy casos_actas_ver on storage.objects for select to authenticated
  using (bucket_id = 'casos-actas' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and public.agenda_gestiona_casos(((storage.foldername(name))[1])::uuid));

-- 2) Casos detectados por correo: estado de verificación y los datos que completa una persona (quién asiste, si se avisó al propietario…).
create table if not exists public.agenda_casos_detectados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  clave text not null check (char_length(clave) between 1 and 300),   -- tipo|inmueble|contrato (o tipo|?|asunto normalizado)
  tipo text not null check (tipo in ('terminacion', 'mantenimiento', 'pqr', 'asamblea')),
  estado text not null default 'por_verificar' check (estado in ('por_verificar', 'verificado', 'descartado')),
  datos jsonb not null default '{}'::jsonb,            -- asistente, propietario_avisado (si|no|pendiente), poder (si|no|pendiente), nota
  verificado_por uuid,
  verificado_en timestamptz,
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, clave)
);
alter table public.agenda_casos_detectados enable row level security;

drop policy if exists agenda_casos_det_leer on public.agenda_casos_detectados;
create policy agenda_casos_det_leer on public.agenda_casos_detectados for select to authenticated using (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_det_insertar on public.agenda_casos_detectados;
create policy agenda_casos_det_insertar on public.agenda_casos_detectados for insert to authenticated with check (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_det_actualizar on public.agenda_casos_detectados;
create policy agenda_casos_det_actualizar on public.agenda_casos_detectados for update to authenticated
  using (public.agenda_gestiona_casos(empresa_id)) with check (public.agenda_gestiona_casos(empresa_id));
revoke all on public.agenda_casos_detectados from anon;
grant select, insert, update on public.agenda_casos_detectados to authenticated;
grant select, insert, update, delete on public.agenda_casos_detectados to service_role;
