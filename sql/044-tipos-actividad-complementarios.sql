-- 044 · Más tipos de actividad interna para los asesores (servicios complementarios a las visitas)
-- Nuevos tipos: entrega_inmueble, llaves, firma_contrato, fotografia, mantenimiento, reunion_cliente, tramite, reunion_interna.
-- Con inmueble obligatorio: visita_cliente, inventario, inspeccion, entrega_inmueble, fotografia, mantenimiento.
-- Inmueble opcional (dirección libre o solo título): captacion, llaves, firma_contrato, reunion_cliente, tramite, reunion_interna, otro.
-- Duración por defecto si no se indica: captacion 90, fotografia 90, entrega_inmueble 60, firma_contrato 60, mantenimiento 60,
-- tramite 60, reunion_interna 60, reunion_cliente 45, llaves 30; inventario/inspeccion/otro/visita siguen con la duración de la visita.

alter table public.agenda_citas drop constraint if exists agenda_citas_tipo_cita_check;
alter table public.agenda_citas add constraint agenda_citas_tipo_cita_check check (tipo_cita = any (array[
  'visita_cliente','inventario','inspeccion','captacion','otro',
  'entrega_inmueble','llaves','firma_contrato','fotografia','mantenimiento','reunion_cliente','tramite','reunion_interna']));

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.agenda_citas'::regclass and pg_get_constraintdef(oid) like '%inmueble_id IS NOT NULL%tipo_cita = ''captacion''%' loop
    execute format('alter table public.agenda_citas drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.agenda_citas add constraint agenda_citas_inmueble_o_libre_check check (
  inmueble_id is not null or tipo_cita in ('captacion','llaves','firma_contrato','reunion_cliente','tramite','reunion_interna','otro'));

-- Reescribe agenda_crear_cita_interna (versión con p_forzar) cambiando solo tres cosas: lista de tipos válidos, cuáles exigen
-- inmueble y la duración por defecto. El resto del cuerpo queda exactamente igual.
do $$
declare v_oid oid; v_def text; v_nuevo text;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'agenda_crear_cita_interna' and pg_get_function_identity_arguments(p.oid) like '%p_forzar%';
  v_def := pg_get_functiondef(v_oid);
  v_nuevo := replace(v_def, $a$p_tipo_cita not in ('visita_cliente','inventario','inspeccion','captacion','otro')$a$,
    $b$p_tipo_cita not in ('visita_cliente','inventario','inspeccion','captacion','otro','entrega_inmueble','llaves','firma_contrato','fotografia','mantenimiento','reunion_cliente','tramite','reunion_interna')$b$);
  v_nuevo := replace(v_nuevo, $a$elsif p_tipo_cita <> 'captacion' then$a$,
    $b$elsif p_tipo_cita in ('visita_cliente','inventario','inspeccion','entrega_inmueble','fotografia','mantenimiento') then$b$);
  v_nuevo := replace(v_nuevo, $a$case when p_tipo_cita = 'captacion' then 90 else v_cfg.duracion_visita_minutos end$a$,
    $b$case p_tipo_cita when 'captacion' then 90 when 'fotografia' then 90 when 'entrega_inmueble' then 60 when 'firma_contrato' then 60 when 'mantenimiento' then 60 when 'tramite' then 60 when 'reunion_interna' then 60 when 'reunion_cliente' then 45 when 'llaves' then 30 else v_cfg.duracion_visita_minutos end$b$);
  if v_nuevo = v_def or position('reunion_interna' in v_nuevo) = 0 or position('then 30 else' in v_nuevo) = 0 or position('''fotografia'',''mantenimiento'') then' in v_nuevo) = 0 then
    raise exception 'No se pudo reescribir agenda_crear_cita_interna: el texto original cambió';
  end if;
  execute v_nuevo;
end $$;
