-- Ajustes de cómo contesta la IA en Casos (amabilidad, firmeza, protección de la empresa, instrucciones propias).
-- SIN APLICAR. Requiere 120-casos-inmuebles.sql (usa agenda_gestiona_casos). Idempotente.
-- No guarda claves ni datos personales: la clave de IA sigue en Vault (agenda_obtener_clave_ia, SQL 028).
-- Una fila por empresa. Solo el administrador cambia los ajustes; quien gestiona casos puede leerlos.

create table if not exists public.agenda_casos_ia_ajustes (
  empresa_id uuid primary key references public.agenda_empresas(id) on delete cascade,
  amabilidad smallint not null default 4 check (amabilidad between 1 and 5),        -- 1 seca ... 5 muy cálida
  firmeza smallint not null default 3 check (firmeza between 1 and 5),              -- 1 muy flexible ... 5 muy firme
  proteccion_empresa smallint not null default 4 check (proteccion_empresa between 1 and 5), -- 5 = no asumir nada que no corresponda
  instrucciones text check (instrucciones is null or char_length(instrucciones) <= 1000),
  revision_ia_activa boolean not null default true,
  actualizado_por uuid default auth.uid(),
  actualizado_en timestamptz not null default now()
);

alter table public.agenda_casos_ia_ajustes enable row level security;

drop policy if exists agenda_casos_ia_ajustes_leer on public.agenda_casos_ia_ajustes;
create policy agenda_casos_ia_ajustes_leer on public.agenda_casos_ia_ajustes for select to authenticated
  using (public.agenda_gestiona_casos(empresa_id));

drop policy if exists agenda_casos_ia_ajustes_insertar on public.agenda_casos_ia_ajustes;
create policy agenda_casos_ia_ajustes_insertar on public.agenda_casos_ia_ajustes for insert to authenticated
  with check (coalesce(public.agenda_rol_actual(empresa_id) = 'administrador', false));

drop policy if exists agenda_casos_ia_ajustes_actualizar on public.agenda_casos_ia_ajustes;
create policy agenda_casos_ia_ajustes_actualizar on public.agenda_casos_ia_ajustes for update to authenticated
  using (coalesce(public.agenda_rol_actual(empresa_id) = 'administrador', false))
  with check (coalesce(public.agenda_rol_actual(empresa_id) = 'administrador', false));

revoke all on public.agenda_casos_ia_ajustes from anon;
grant select, insert, update on public.agenda_casos_ia_ajustes to authenticated;
grant select, insert, update, delete on public.agenda_casos_ia_ajustes to service_role;
