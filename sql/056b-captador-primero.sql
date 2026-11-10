-- 056 · El cliente ve primero al asesor captador del inmueble.
-- Regla (por fecha consultada):
--   1) Si el captador (asesor_captacion; si viene vacío, asesor_comercializacion) es un asesor ACTIVO
--      y tiene horarios libres ese día, solo se ofrece su agenda.
--   2) Si no, los asesores de PLANTA que cubren la ciudad del inmueble (en orden de prioridad).
--   3) Si ninguno de planta tiene horarios, los FREELANCE de la ciudad.
-- Sedi guarda el captador como texto («LUIS ALFREDO JIMENEZ FINO»); se enlaza con la ficha del asesor
-- cuando TODAS las palabras del nombre de la ficha («Luis Jiménez») están en el texto de Sedi.
-- Si dos fichas coinciden, no se adivina: no hay captador y se sigue con planta.
-- No aplicado aún en producción hasta que Felipe lo autorice.

create or replace function public.agenda_norm_nombre(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p_texto, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.agenda_asesor_por_nombre_sedi(p_empresa_id uuid, p_texto text)
returns uuid
language sql
stable
set search_path = ''
as $$
  with t as (
    select string_to_array(public.agenda_norm_nombre(p_texto), ' ') as arr
  ), c as (
    select a.id
    from public.agenda_asesores a, t
    where a.empresa_id = p_empresa_id
      and a.activo
      and public.agenda_norm_nombre(p_texto) <> ''
      and array_length(string_to_array(public.agenda_norm_nombre(a.nombre), ' '), 1) >= 2
      and string_to_array(public.agenda_norm_nombre(a.nombre), ' ') <@ t.arr
  )
  select case when count(*) = 1 then (array_agg(c.id))[1] end from c
$$;

-- La función de horarios actual pasa a ser la «base» (todos los asesores de la ciudad)...
do $$
begin
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agenda_sugerir_horarios_portal_base') then
    alter function public.agenda_sugerir_horarios_portal(uuid, uuid, date, integer, uuid)
      rename to agenda_sugerir_horarios_portal_base;
  end if;
end $$;

-- ...y la que usan el portal público, el arrendatario y la reubicación filtra por niveles.
create or replace function public.agenda_sugerir_horarios_portal(
  p_empresa_id uuid, p_inmueble_id uuid, p_fecha date,
  p_intervalo_minutos integer default 30, p_cita_origen_id uuid default null::uuid)
returns table(asesor_id uuid, asesor_nombre text, tipo_vinculacion text, prioridad integer,
              hora_inicio time without time zone, hora_fin time without time zone,
              distancia_km_mas_cercana numeric, tipo_slot text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_texto text;
  v_cap uuid;
begin
  select coalesce(nullif(btrim(i.asesor_captacion), ''), nullif(btrim(i.asesor_comercializacion), ''))
    into v_texto
  from public.agenda_inmuebles i
  where i.id = p_inmueble_id and i.empresa_id = p_empresa_id;

  v_cap := public.agenda_asesor_por_nombre_sedi(p_empresa_id, v_texto);

  return query
    with b as (
      select s.*,
             case when v_cap is not null and s.asesor_id = v_cap then 0
                  when s.tipo_vinculacion = 'planta' then 1
                  else 2 end as nivel
      from public.agenda_sugerir_horarios_portal_base(p_empresa_id, p_inmueble_id, p_fecha, p_intervalo_minutos, p_cita_origen_id) s
    ), m as (
      select min(b2.nivel) as n from b b2
    )
    select b.asesor_id, b.asesor_nombre, b.tipo_vinculacion, b.prioridad, b.hora_inicio, b.hora_fin,
           b.distancia_km_mas_cercana, b.tipo_slot
    from b, m
    where b.nivel = m.n
    order by b.hora_inicio, b.prioridad;
end;
$$;

revoke all on function public.agenda_sugerir_horarios_portal(uuid, uuid, date, integer, uuid) from public;
grant execute on function public.agenda_sugerir_horarios_portal(uuid, uuid, date, integer, uuid) to authenticated, service_role;
grant execute on function public.agenda_norm_nombre(text) to authenticated, service_role;
grant execute on function public.agenda_asesor_por_nombre_sedi(uuid, text) to authenticated, service_role;
