-- 007 · Inmuebles "Rentando": horario especial obligatorio + aviso al arrendatario
-- Ya aplicado en producción (21-oct-2026), en tres migraciones.

-- 1) Datos de contacto del arrendatario (los llena la macro de Apps Script desde la hoja
--    InformeGeneralInmueblesArrendados; una fila por inmueble, la del contrato más reciente).
--    Tabla aparte (no columnas en agenda_inmuebles) para no mezclar datos personales con el
--    inventario y poder darles permisos distintos.
create table if not exists public.agenda_arrendatarios (
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  numero_inmueble integer not null,
  nombre text not null default '',
  email text not null default '',
  celular text not null default '',
  telefono text not null default '',
  vencimiento_contrato date,
  sincronizado_en timestamptz not null default now(),
  primary key (empresa_id, numero_inmueble)
);
alter table public.agenda_arrendatarios enable row level security;

drop policy if exists arrendatarios_lectura on public.agenda_arrendatarios;
create policy arrendatarios_lectura on public.agenda_arrendatarios
  for select to authenticated
  using (exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = agenda_arrendatarios.empresa_id and m.usuario_id = auth.uid() and m.activo
  ));

-- GRANT explícito (convención desde el 30-oct-2026). Sin acceso para anon.
grant select on public.agenda_arrendatarios to authenticated;
grant select, insert, update, delete on public.agenda_arrendatarios to service_role;

-- 2) Registro de cuándo se le avisó al arrendatario de cada cita.
alter table public.agenda_citas
  add column if not exists arrendatario_avisado_en timestamptz,
  add column if not exists arrendatario_avisado_por uuid;

-- 3) La bitácora de correos acepta el nuevo tipo de destinatario.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.agenda_correos_log'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%destinatario_tipo%';
  if c is not null then
    execute format('alter table public.agenda_correos_log drop constraint %I', c);
  end if;
end $$;
alter table public.agenda_correos_log
  add constraint agenda_correos_log_destinatario_tipo_check
  check (destinatario_tipo in ('cliente', 'propietario', 'interno', 'verificacion', 'arrendatario'));

-- 4) Horario especial obligatorio: un inmueble con estado CRM "Rentando" que no tenga
--    días u horas permitidas no ofrece ningún horario (ni en la página pública ni en la
--    agenda interna, que usan agenda_sugerir_horarios). Se inserta el chequeo justo después
--    del de días permitidos, sin reescribir el resto de la función.
do $$
declare
  v_def text;
  v_ancla text := E'    return;\n  end if;\n\n  v_duracion_visita :=';
  v_nuevo text := E'    return;\n  end if;\n\n'
    || E'  -- Inmueble rentando (arrendatario adentro): sin horario especial configurado no se ofrece nada.\n'
    || E'  if lower(coalesce(v_inmueble.estado_crm, '''')) = ''rentando''\n'
    || E'     and coalesce(array_length(v_inmueble.dias_visita_permitidos, 1), 0) = 0\n'
    || E'     and v_inmueble.hora_visita_desde is null and v_inmueble.hora_visita_hasta is null then\n'
    || E'    return;\n  end if;\n\n  v_duracion_visita :=';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = 'agenda_sugerir_horarios' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'No se encontró agenda_sugerir_horarios'; end if;
  if position('rentando' in v_def) > 0 then return; end if; -- ya aplicado
  if position(v_ancla in v_def) = 0 then raise exception 'No se encontró el punto de inserción en agenda_sugerir_horarios; no se cambió nada'; end if;
  execute replace(v_def, v_ancla, v_nuevo);
end $$;

-- 5) Avisar al arrendatario no debe aparecer como "editada" en la bitácora de actividad:
--    el trigger de historial ignora los cambios que solo tocan arrendatario_avisado_en.
create or replace function public.agenda_registrar_historial_cita()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.agenda_citas_historial (cita_id, empresa_id, accion, estado_nuevo, fecha_nueva, hora_inicio_nueva, asesor_nuevo, realizado_por)
    values (new.id, new.empresa_id, 'creada', new.estado, new.fecha, new.hora_inicio, new.asesor_id, new.creado_por);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.estado is distinct from old.estado then
      insert into public.agenda_citas_historial (cita_id, empresa_id, accion, estado_anterior, estado_nuevo, motivo, realizado_por)
      values (new.id, new.empresa_id, case when new.estado = 'cancelada' then 'cancelada' else 'cambio_estado' end,
              old.estado, new.estado, new.motivo_cancelacion, coalesce(new.cancelado_por, new.actualizado_por));
    elsif new.fecha is distinct from old.fecha or new.hora_inicio is distinct from old.hora_inicio or new.asesor_id is distinct from old.asesor_id then
      insert into public.agenda_citas_historial (cita_id, empresa_id, accion, fecha_anterior, fecha_nueva, hora_inicio_anterior, hora_inicio_nueva, asesor_anterior, asesor_nuevo, realizado_por)
      values (new.id, new.empresa_id, 'movida', old.fecha, new.fecha, old.hora_inicio, new.hora_inicio, old.asesor_id, new.asesor_id, new.actualizado_por);
    elsif new.arrendatario_avisado_en is not distinct from old.arrendatario_avisado_en then
      insert into public.agenda_citas_historial (cita_id, empresa_id, accion, realizado_por)
      values (new.id, new.empresa_id, 'editada', new.actualizado_por);
    end if;
    return new;
  end if;
  return null;
end;
$function$;
