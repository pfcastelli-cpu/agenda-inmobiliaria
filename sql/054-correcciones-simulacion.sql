-- 054 · Correcciones halladas en la simulación de 2 semanas (nov-2026).
-- Aplicado en producción el 06-nov-2026 (migración correcciones_simulacion_054). Es idempotente.

-- 1) El modo de pruebas nunca puede quedar encendido sin destino (si no, los
--    correos caerían a los destinatarios reales).
alter table public.agenda_configuracion
  drop constraint if exists agenda_configuracion_pruebas_destino_check;
alter table public.agenda_configuracion
  add constraint agenda_configuracion_pruebas_destino_check
  check (not coalesce(correo_modo_pruebas, false) or length(btrim(coalesce(correo_pruebas_destino, ''))) > 0);

-- 2) Permisos «mover» y «eliminar» citas de cada asesor: hasta ahora solo
--    existían en el formulario. Admin y coordinador no se ven afectados;
--    las Edge Functions (service_role, sin auth.uid()) tampoco.
create or replace function public.agenda_citas_permisos_asesor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
  v_mover boolean;
  v_eliminar boolean;
begin
  if auth.uid() is null then return new; end if;

  select m.rol into v_rol
  from public.agenda_miembros m
  where m.empresa_id = old.empresa_id and m.usuario_id = auth.uid() and m.activo
  limit 1;
  if v_rol is null or v_rol in ('administrador', 'coordinador') then return new; end if;

  select a.permiso_mover_citas, a.permiso_eliminar_citas into v_mover, v_eliminar
  from public.agenda_asesores a
  where a.empresa_id = old.empresa_id and a.usuario_id = auth.uid()
  limit 1;
  if not found then return new; end if;

  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' and not coalesce(v_eliminar, false) then
    raise exception 'No tienes permiso para cancelar o eliminar citas.';
  end if;
  if (new.fecha, new.hora_inicio, new.asesor_id) is distinct from (old.fecha, old.hora_inicio, old.asesor_id)
     and not coalesce(v_mover, false) then
    raise exception 'No tienes permiso para mover citas.';
  end if;
  return new;
end;
$$;

drop trigger if exists agenda_citas_permisos_asesor on public.agenda_citas;
create trigger agenda_citas_permisos_asesor
  before update on public.agenda_citas
  for each row execute function public.agenda_citas_permisos_asesor();

-- 3) La bitácora y el informe del propietario filtran por fecha en hora de Bogotá (no UTC).
do $$
declare d text;
begin
  for d in
    select pg_get_functiondef(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('agenda_bitacora_citas', 'agenda_bitacora_encuestas')
  loop
    d := replace(d, 'h.creado_en::date', '(h.creado_en at time zone ''America/Bogota'')::date');
    d := replace(d, 'e.creado_en::date', '(e.creado_en at time zone ''America/Bogota'')::date');
    d := replace(d, 'e.respondido_en::date', '(e.respondido_en at time zone ''America/Bogota'')::date');
    execute d;
  end loop;
end $$;

-- 4) El informe del propietario cuenta solo visitas completadas y fecha de respuesta en Bogotá.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'agenda_informe_propietario_datos';
  d := replace(d, 'estado in (''confirmada'', ''completada'')', 'estado = ''completada''');
  d := replace(d, 'e.respondido_en::date', '(e.respondido_en at time zone ''America/Bogota'')::date');
  -- Decisión de Felipe: el propietario NO ve comentarios escritos por clientes (ni siquiera filtrados);
  -- solo la impresión, intención y motivo estructurados.
  d := replace(d, 'case when e.comentario_revision = ''publicable'' then e.comentario_inmueble else null end as comentario', 'null::text as comentario');
  -- La nota interna del asesor (feedback_cliente) no se muestra al propietario: solo opiniones ya filtradas.
  d := regexp_replace(d, 'union all\s+select ''nota_asesor''.*?\) x;', E') x;');
  execute d;
end $$;

-- 5) La encuesta solo se responde una vez (si no, con el token se podía sobrescribir y reiniciar la moderación).
--    Se elimina además la versión vieja de 3 parámetros.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'agenda_responder_encuesta'
    and pg_get_function_identity_arguments(p.oid) like '%p_impresion%';
  d := replace(d, 'where token = p_token', 'where token = p_token and respondido_en is null');
  d := replace(d, 'Encuesta no encontrada', 'Encuesta no encontrada o ya respondida');
  execute d;
end $$;
drop function if exists public.agenda_responder_encuesta(uuid, smallint, text);

-- 6) La bitácora de correos rechazaba en silencio tres tipos que las funciones sí usan
--    (solicitud_propietario, propietario_informe, estudio_mercado): esos envíos no quedaban registrados.
alter table public.agenda_correos_log drop constraint if exists agenda_correos_log_destinatario_tipo_check;
alter table public.agenda_correos_log add constraint agenda_correos_log_destinatario_tipo_check
  check (destinatario_tipo = any (array['cliente','propietario','interno','verificacion','arrendatario','encuesta_cliente','solicitud_propietario','propietario_informe','estudio_mercado']));

-- Pendiente de decisión (no incluido): revocar SELECT de columnas token_* a
-- authenticated exige antes mover su lectura en el front (administracion.js, agenda-real.js) a RPC.
