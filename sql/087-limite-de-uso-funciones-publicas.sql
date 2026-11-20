-- Límite de uso para funciones públicas (anti-bots / anti-abuso).
-- Cuenta intentos por "clave" (ej. 'recuperar:ip:1.2.3.4') en ventanas fijas de tiempo.
-- Solo la service_role (Edge Functions) puede llamarla; ni anon ni authenticated.
-- Aplicada en producción el 2026-11-20.

create table if not exists public.agenda_limites_uso (
  clave text not null,
  ventana timestamptz not null,
  conteo integer not null default 0,
  primary key (clave, ventana)
);
alter table public.agenda_limites_uso enable row level security;
-- Sin políticas: nadie con anon/authenticated la ve; la service_role salta RLS.
grant select, insert, update, delete on public.agenda_limites_uso to service_role;

-- Devuelve true si PUEDE continuar, false si superó el máximo en la ventana.
create or replace function public.agenda_limitar_uso(p_clave text, p_max integer, p_ventana_seg integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventana timestamptz;
  v_conteo integer;
begin
  if p_clave is null or p_max < 1 or p_ventana_seg < 1 then return true; end if;
  v_ventana := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);
  insert into public.agenda_limites_uso as l (clave, ventana, conteo)
  values (left(p_clave, 200), v_ventana, 1)
  on conflict (clave, ventana) do update set conteo = l.conteo + 1
  returning conteo into v_conteo;
  -- Limpieza ocasional de ventanas viejas (1 de cada 50 llamadas).
  if random() < 0.02 then
    delete from public.agenda_limites_uso where ventana < now() - interval '2 days';
  end if;
  return v_conteo <= p_max;
end;
$$;
revoke all on function public.agenda_limitar_uso(text, integer, integer) from public, anon, authenticated;
grant execute on function public.agenda_limitar_uso(text, integer, integer) to service_role;
