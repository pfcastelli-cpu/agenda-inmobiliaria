-- 027 · Inmueble "Rentando" sin aviso al arrendatario (venta o arriendo reservado)
-- Caso: el propietario quiere mostrar el inmueble sin que el arrendatario se entere. Con la marca encendida
-- el inmueble se trata como cualquier otro para clientes y correos: no se avisa al arrendatario, no hay
-- acuerdo de horario con él y el portal /arrendatario del inmueble deja de funcionar.
-- Aplicar en Supabase (SQL Editor). Es seguro repetirlo.

alter table public.agenda_inmuebles
  add column if not exists sin_aviso_arrendatario boolean not null default false;

comment on column public.agenda_inmuebles.sin_aviso_arrendatario is
  'true = no se informa al arrendatario de las visitas (el propietario maneja la venta en reserva).';

create or replace function public.agenda_inmueble_aviso_arrendatario(
  p_inmueble_id uuid,
  p_sin_aviso boolean
) returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_empresa_id uuid;
begin
  select empresa_id into v_empresa_id from public.agenda_inmuebles where id = p_inmueble_id;
  if v_empresa_id is null then
    raise exception 'Inmueble no encontrado';
  end if;
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No tienes permiso para modificar este inmueble';
  end if;
  update public.agenda_inmuebles
    set sin_aviso_arrendatario = coalesce(p_sin_aviso, false)
    where id = p_inmueble_id;
end;
$$;

revoke all on function public.agenda_inmueble_aviso_arrendatario(uuid, boolean) from public, anon;
grant execute on function public.agenda_inmueble_aviso_arrendatario(uuid, boolean) to authenticated, service_role;
