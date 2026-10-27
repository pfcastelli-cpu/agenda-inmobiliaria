-- 034 · Una visita pendiente de nuevo horario (reubicacion_pendiente_desde) deja LIBRE su horario original
-- Cuando el arrendatario no puede recibir una visita, esa hora es imposible: la cita sigue «confirmada» (el cliente conserva su derecho a elegir
-- otra hora hasta su plazo) pero ya no debe ocupar al asesor ni al inmueble. Este script hace que las funciones de disponibilidad la ignoren:
--   agenda_slot_disponible, agenda_slot_disponible_captacion, agenda_sugerir_horarios, agenda_sugerir_horarios_captacion,
--   agenda_citas_sin_choque (trigger de doble reserva) y agenda_conflictos_cita (aviso de cruce).
-- Técnica: en cada una se agrega «and <alias>.reubicacion_pendiente_desde is null» a cada «<alias>.estado <> 'cancelada'» (menos old/new).
-- Es seguro repetirlo: una función que ya menciona reubicacion_pendiente_desde se deja igual.
-- Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/034-horario-liberado-reubicacion.sql
do $$
declare
  f record;
  v_def text;
  v_nueva text;
  v_total int := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('agenda_slot_disponible', 'agenda_slot_disponible_captacion', 'agenda_sugerir_horarios',
                        'agenda_sugerir_horarios_captacion', 'agenda_citas_sin_choque', 'agenda_conflictos_cita')
  loop
    v_def := pg_get_functiondef(f.oid);
    if v_def like '%reubicacion_pendiente_desde%' then
      continue;
    end if;
    v_nueva := regexp_replace(v_def, '\m(?!old\M|new\M)([a-z_][a-z_0-9]*)\.estado\s*<>\s*''cancelada''', '\1.estado <> ''cancelada'' and \1.reubicacion_pendiente_desde is null', 'g');
    if v_nueva <> v_def then
      execute v_nueva;
      v_total := v_total + 1;
      raise notice 'Actualizada: %', f.proname;
    end if;
  end loop;
  raise notice 'Funciones actualizadas: %', v_total;
end $$;

-- El índice único «un asesor no puede tener dos citas con la misma hora de inicio» también debe ignorar las visitas liberadas.
do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'agenda_citas_asesor_slot_unico'
              and indexdef not like '%reubicacion_pendiente_desde%') then
    create unique index agenda_citas_asesor_slot_unico_nuevo on public.agenda_citas (asesor_id, fecha, hora_inicio)
      where (estado <> 'cancelada' and reubicacion_pendiente_desde is null);
    drop index public.agenda_citas_asesor_slot_unico;
    alter index public.agenda_citas_asesor_slot_unico_nuevo rename to agenda_citas_asesor_slot_unico;
  end if;
end $$;
