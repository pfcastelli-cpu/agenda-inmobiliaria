-- Presencia: quién está conectado a la plataforma ahora (latido cada ~30 s). El bot lo usa para decidir si un cliente
-- se atiende aquí (hay alguien conectado) o si se le entrega el WhatsApp directo del asesor (nadie conectado).
create table if not exists public.agenda_wa_presencia (
  usuario_id uuid primary key,
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  visto_en timestamptz not null default now()
);
create index if not exists agenda_wa_presencia_empresa on public.agenda_wa_presencia (empresa_id, visto_en desc);
alter table public.agenda_wa_presencia enable row level security;
-- Sin políticas para authenticated: solo se escribe con la función de abajo y solo lo lee el servidor (service_role).
grant select, insert, update, delete on public.agenda_wa_presencia to service_role;

-- Latido: el navegador la llama cada 30 s mientras la plataforma está abierta. Solo cuenta a quien puede ver WhatsApp.
create or replace function public.agenda_wa_latido(p_empresa_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa_id, 'whatsapp.ver') then return; end if;
  insert into public.agenda_wa_presencia (usuario_id, empresa_id, visto_en) values (auth.uid(), p_empresa_id, now())
  on conflict (usuario_id) do update set empresa_id = excluded.empresa_id, visto_en = now();
end $$;
revoke all on function public.agenda_wa_latido(uuid) from public, anon;
grant execute on function public.agenda_wa_latido(uuid) to authenticated, service_role;

-- Al cerrar sesión o la pestaña: se marca como desconectado de inmediato.
create or replace function public.agenda_wa_salir(p_empresa_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  update public.agenda_wa_presencia set visto_en = now() - interval '1 hour' where usuario_id = auth.uid() and empresa_id = p_empresa_id;
end $$;
revoke all on function public.agenda_wa_salir(uuid) from public, anon;
grant execute on function public.agenda_wa_salir(uuid) to authenticated, service_role;
