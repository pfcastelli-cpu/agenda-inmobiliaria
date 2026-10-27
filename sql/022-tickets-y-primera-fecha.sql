-- 022 · Tickets de soporte + primera fecha con horarios disponibles
-- 1) Tickets: cualquier usuario de la empresa (administrador, coordinador o asesor) reporta un error, propone una mejora o
--    hace una pregunta desde la pestaña «Soporte». Ve solo los suyos; el administrador ve todos, los responde y cambia su estado.
--    El navegador solo LEE la tabla; crear y responder pasan por funciones que validan quién llama (patrón de sql/008).
-- 2) agenda_primera_fecha_publica: primera fecha (desde hoy, máx. p_max_dias) en la que un inmueble tiene horarios; la usa la
--    página pública de reserva para abrir directo en esa fecha (respeta «Citas desde», días/horas permitidos y franjas del arrendatario).

create table if not exists public.agenda_tickets (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  usuario_id uuid not null,
  usuario_nombre text not null default '',
  tipo text not null check (tipo in ('error', 'mejora', 'duda')),
  titulo text not null check (length(btrim(titulo)) between 3 and 140),
  descripcion text not null default '' check (length(descripcion) <= 4000),
  pagina text not null default '' check (length(pagina) <= 120),
  estado text not null default 'abierto' check (estado in ('abierto', 'en_revision', 'resuelto', 'descartado')),
  respuesta text not null default '' check (length(respuesta) <= 4000),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  resuelto_en timestamptz
);
create index if not exists agenda_tickets_empresa_idx on public.agenda_tickets(empresa_id, estado, creado_en desc);
create index if not exists agenda_tickets_usuario_idx on public.agenda_tickets(usuario_id, creado_en desc);

alter table public.agenda_tickets enable row level security;
drop policy if exists tickets_lectura on public.agenda_tickets;
create policy tickets_lectura on public.agenda_tickets
  for select to authenticated
  using (usuario_id = auth.uid() or public.agenda_rol_actual(empresa_id) = 'administrador');
grant select on public.agenda_tickets to authenticated;
grant select, insert, update, delete on public.agenda_tickets to service_role;
revoke all on public.agenda_tickets from anon;
revoke insert, update, delete, truncate, references, trigger on public.agenda_tickets from authenticated;

create or replace function public.agenda_ticket_crear(p_empresa_id uuid, p_tipo text, p_titulo text, p_descripcion text, p_pagina text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
  v_id uuid;
  v_numero bigint;
begin
  select m.nombre into v_nombre from public.agenda_miembros m
   where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo limit 1;
  if not found then raise exception 'No perteneces a esta empresa'; end if;
  if p_tipo not in ('error', 'mejora', 'duda') then raise exception 'Tipo de ticket no válido'; end if;
  if length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escribe un título de al menos 3 letras'; end if;
  if (select count(*) from public.agenda_tickets t where t.usuario_id = auth.uid() and t.creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de tickets de hoy. Escríbele a tu administrador.';
  end if;
  insert into public.agenda_tickets (empresa_id, usuario_id, usuario_nombre, tipo, titulo, descripcion, pagina)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), p_tipo, left(btrim(p_titulo), 140), left(coalesce(p_descripcion, ''), 4000), left(coalesce(p_pagina, ''), 120))
  returning id, numero into v_id, v_numero;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;
revoke all on function public.agenda_ticket_crear(uuid, text, text, text, text) from public, anon;
grant execute on function public.agenda_ticket_crear(uuid, text, text, text, text) to authenticated, service_role;

-- Solo el administrador cambia el estado y responde.
create or replace function public.agenda_ticket_actualizar(p_id uuid, p_estado text, p_respuesta text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.agenda_tickets where id = p_id;
  if v_empresa is null or public.agenda_rol_actual(v_empresa) is distinct from 'administrador' then
    raise exception 'Solo el administrador puede responder tickets';
  end if;
  if p_estado not in ('abierto', 'en_revision', 'resuelto', 'descartado') then raise exception 'Estado no válido'; end if;
  update public.agenda_tickets
     set estado = p_estado,
         respuesta = case when p_respuesta is null then respuesta else left(btrim(p_respuesta), 4000) end,
         actualizado_en = now(),
         resuelto_en = case when p_estado in ('resuelto', 'descartado') then coalesce(resuelto_en, now()) else null end
   where id = p_id;
end;
$$;
revoke all on function public.agenda_ticket_actualizar(uuid, text, text) from public, anon;
grant execute on function public.agenda_ticket_actualizar(uuid, text, text) to authenticated, service_role;

-- Primera fecha con horarios (hora de Bogotá). Devuelve null si no hay ninguna en p_max_dias.
create or replace function public.agenda_primera_fecha_publica(p_numero_inmueble integer, p_empresa_slug text default null, p_host text default null, p_max_dias integer default 90)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  v_inm record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_d date;
  v_fin date;
begin
  select * into v_inm from public.agenda_inmuebles
   where empresa_id = v_empresa_id and numero_inmueble = p_numero_inmueble and disponible and not no_disponible_manual;
  if not found then return null; end if;
  v_d := greatest(v_hoy, coalesce(v_inm.citas_desde, v_hoy));
  v_fin := v_hoy + least(greatest(coalesce(p_max_dias, 90), 1), 180);
  while v_d <= v_fin loop
    -- salta de una vez los días que el inmueble no permite (salvo que el arrendatario haya abierto franjas ese día)
    if (v_inm.dias_visita_permitidos is null or extract(isodow from v_d)::int = any(v_inm.dias_visita_permitidos)
        or exists (select 1 from public.agenda_inmueble_ventanas w where w.inmueble_id = v_inm.id and w.fecha = v_d and w.tipo = 'disponible'))
       and exists (select 1 from public.agenda_sugerir_horarios(v_empresa_id, v_inm.id, v_d, 30)) then
      return v_d;
    end if;
    v_d := v_d + 1;
  end loop;
  return null;
end;
$$;
revoke all on function public.agenda_primera_fecha_publica(integer, text, text, integer) from public;
grant execute on function public.agenda_primera_fecha_publica(integer, text, text, integer) to anon, authenticated, service_role;
