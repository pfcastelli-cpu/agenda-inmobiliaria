-- Historial de cambios de un caso (estado, prioridad, fecha límite, responsable), escrito solo por un trigger.
-- SIN APLICAR. Requiere 120-casos-inmuebles.sql. Idempotente.
-- Solo códigos y fechas (sin datos personales). Nadie escribe a mano aquí: la pantalla solo lee.
-- Nada se borra: la tabla es de solo añadir; ni la pantalla ni el servicio pueden actualizar ni borrar filas.

create table if not exists public.agenda_casos_eventos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  campo text not null check (campo in ('estado', 'prioridad', 'fecha_limite', 'responsable')),
  valor_anterior text,
  valor_nuevo text,
  autor uuid,                                   -- quien hizo el cambio (null si lo hizo el servidor)
  creado_en timestamptz not null default now()
);
create index if not exists agenda_casos_eventos_idx on public.agenda_casos_eventos (caso_id, creado_en);

alter table public.agenda_casos_eventos enable row level security;
drop policy if exists agenda_casos_eventos_leer on public.agenda_casos_eventos;
create policy agenda_casos_eventos_leer on public.agenda_casos_eventos for select to authenticated
  using (public.agenda_gestiona_casos(empresa_id));
revoke all on public.agenda_casos_eventos from anon, authenticated;
grant select on public.agenda_casos_eventos to authenticated;
grant select, insert on public.agenda_casos_eventos to service_role;

-- El trigger corre como dueño (security definer) para poder escribir aunque el usuario no tenga permiso de insertar.
create or replace function public.agenda_casos_registrar_cambios() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_autor uuid := auth.uid();
begin
  if new.estado is distinct from old.estado then
    insert into public.agenda_casos_eventos (caso_id, empresa_id, campo, valor_anterior, valor_nuevo, autor)
    values (new.id, new.empresa_id, 'estado', old.estado, new.estado, v_autor);
  end if;
  if new.prioridad is distinct from old.prioridad then
    insert into public.agenda_casos_eventos (caso_id, empresa_id, campo, valor_anterior, valor_nuevo, autor)
    values (new.id, new.empresa_id, 'prioridad', old.prioridad::text, new.prioridad::text, v_autor);
  end if;
  if new.fecha_limite is distinct from old.fecha_limite then
    insert into public.agenda_casos_eventos (caso_id, empresa_id, campo, valor_anterior, valor_nuevo, autor)
    values (new.id, new.empresa_id, 'fecha_limite', old.fecha_limite::text, new.fecha_limite::text, v_autor);
  end if;
  if new.responsable_usuario_id is distinct from old.responsable_usuario_id then
    -- Solo se guarda que cambió el responsable, no quién era (los nombres se resuelven en la agenda).
    insert into public.agenda_casos_eventos (caso_id, empresa_id, campo, valor_anterior, valor_nuevo, autor)
    values (new.id, new.empresa_id, 'responsable', case when old.responsable_usuario_id is null then null else 'asignado' end,
            case when new.responsable_usuario_id is null then null else 'asignado' end, v_autor);
  end if;
  return null;
end $$;
revoke all on function public.agenda_casos_registrar_cambios() from public, anon, authenticated;

drop trigger if exists casos_registrar_cambios on public.agenda_casos;
create trigger casos_registrar_cambios after update on public.agenda_casos
  for each row execute function public.agenda_casos_registrar_cambios();
