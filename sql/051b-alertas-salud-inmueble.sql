-- 051 · Aviso automático a propietarios de inmuebles «sin movimiento» (semáforo rojo).
-- agenda_alertas_salud: un registro por correo enviado; sirve para no repetir (mínimo 30 días) y para respetar
-- la respuesta del propietario ("seguir igual" = no volver a escribir en 90 días, "esperar un mes" = 30 días).
-- agenda_alerta_responder(): la llama la página pública del propietario (el token del inmueble es la credencial).
-- NO APLICADO todavía (pendiente de OK de Felipe).
create table if not exists public.agenda_alertas_salud (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  numero_inmueble integer not null,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  nivel text not null default 'rojo',
  visitas integer not null default 0,
  enviada_en timestamptz not null default now(),
  respuesta text check (respuesta in ('seguir', 'esperar')),
  respondida_en timestamptz,
  posponer_hasta timestamptz,
  modo_pruebas boolean not null default true
);
create index if not exists agenda_alertas_salud_idx on public.agenda_alertas_salud (empresa_id, numero_inmueble, enviada_en desc);
alter table public.agenda_alertas_salud enable row level security;
drop policy if exists agenda_alertas_salud_select on public.agenda_alertas_salud;
create policy agenda_alertas_salud_select on public.agenda_alertas_salud for select to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'informes.ver'));
grant select, insert, update, delete on public.agenda_alertas_salud to authenticated, service_role;

create or replace function public.agenda_alerta_responder(p_token uuid, p_respuesta text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_inm public.agenda_inmuebles%rowtype;
  v_id uuid;
begin
  if p_respuesta not in ('seguir', 'esperar') then raise exception 'Respuesta no válida.'; end if;
  select * into v_inm from public.agenda_inmuebles where token_informe_propietario = p_token;
  if not found then return jsonb_build_object('error', 'no_encontrado'); end if;
  select id into v_id from public.agenda_alertas_salud
   where empresa_id = v_inm.empresa_id and numero_inmueble = v_inm.numero_inmueble
   order by enviada_en desc limit 1;
  if v_id is null then
    insert into public.agenda_alertas_salud (empresa_id, numero_inmueble, inmueble_id, enviada_en)
    values (v_inm.empresa_id, v_inm.numero_inmueble, v_inm.id, now()) returning id into v_id;
  end if;
  update public.agenda_alertas_salud
     set respuesta = p_respuesta, respondida_en = now(),
         posponer_hasta = now() + case when p_respuesta = 'seguir' then interval '90 days' else interval '30 days' end
   where id = v_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.agenda_alerta_responder(uuid, text) from public;
grant execute on function public.agenda_alerta_responder(uuid, text) to anon, authenticated, service_role;
