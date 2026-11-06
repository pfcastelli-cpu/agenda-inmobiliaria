-- 055 · Protección de tokens secretos (hallazgo de la simulación, nov-2026).
-- Antes, cualquier miembro activo (p. ej. un asesor freelance) podía leer:
--   · agenda_configuracion.calendario_token  (agenda de TODA la empresa)
--   · agenda_citas.token_cliente / token_arrendatario (actuar como cliente o arrendatario)
-- Ahora:
--   · el token del calendario de la empresa vive en su propia tabla, solo para administradores;
--   · authenticated/anon ya no pueden leer las dos columnas de token de agenda_citas
--     (los portales y las Edge Functions las leen con service_role o RPC SECURITY DEFINER, sin cambios).
-- agenda_asesores.calendario_token ya era seguro: esa tabla solo la lee el administrador (RLS).
-- Aplicar junto con el front (administracion.js y agenda-real.js sin select('*') sobre agenda_citas).

-- 1) Token del calendario de la empresa, en tabla propia.
create table if not exists public.agenda_calendario_empresa (
  empresa_id uuid primary key references public.agenda_empresas(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')
);

insert into public.agenda_calendario_empresa (empresa_id, token)
select c.empresa_id, c.calendario_token
from public.agenda_configuracion c
where c.calendario_token is not null
on conflict (empresa_id) do nothing;

alter table public.agenda_calendario_empresa enable row level security;

drop policy if exists calendario_empresa_admin on public.agenda_calendario_empresa;
create policy calendario_empresa_admin on public.agenda_calendario_empresa
  for all to authenticated
  using (public.agenda_es_admin(empresa_id))
  with check (public.agenda_es_admin(empresa_id));

grant select, insert, update, delete on public.agenda_calendario_empresa to authenticated;
grant select, insert, update, delete on public.agenda_calendario_empresa to service_role;

alter table public.agenda_configuracion drop column if exists calendario_token;

-- 2) Columnas de token de agenda_citas fuera del alcance de authenticated/anon.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'agenda_citas'
    and column_name not in ('token_cliente', 'token_arrendatario');

  revoke select on public.agenda_citas from authenticated;
  revoke select on public.agenda_citas from anon;
  execute format('grant select (%s) on public.agenda_citas to authenticated', cols);
end $$;

-- Nota: una columna nueva en agenda_citas hay que concederla a authenticated a mano:
--   grant select (nueva_columna) on public.agenda_citas to authenticated;
