-- Pruebas con datos sintéticos dentro de una transacción que termina en ROLLBACK.
begin;
do $$
declare
  inm record; slot record; candidata record; prueba uuid; empresa uuid; fallo uuid; admin_id uuid; n integer;
begin
  select * into inm from public.agenda_inmuebles where numero_inmueble=127 limit 1;
  empresa:=inm.empresa_id;
  select h.*,d::date as fecha into slot from generate_series(current_date+7,current_date+20,interval '1 day') d
    cross join lateral public.agenda_sugerir_horarios(empresa,inm.id,d::date,30) h
    where not exists(select 1 from public.agenda_citas c where c.inmueble_id=inm.id and c.fecha=d::date and c.estado<>'cancelada')
    order by d,h.hora_inicio limit 1;
  if slot is null then raise exception 'No se encontró un horario para la prueba'; end if;
  insert into public.agenda_citas(empresa_id,inmueble_id,asesor_id,fecha,hora_inicio,hora_fin,cliente_nombre,cliente_email,estado,tipo_cita,es_prueba)
    values(empresa,inm.id,slot.asesor_id,slot.fecha,slot.hora_inicio,slot.hora_fin,'[PRUEBA] Regresión SQL','qa@example.invalid','confirmada','visita_cliente',true)
    returning id into prueba;
  select * into candidata from public.agenda_sugerir_horarios_portal(empresa,inm.id,slot.fecha,30,prueba)
    where hora_inicio>slot.hora_inicio order by hora_inicio desc limit 1;
  if candidata is null then raise exception 'No se encontró un turno escalonado para la prueba'; end if;
  update public.agenda_citas set reubicacion_pendiente_desde=now(),reubicacion_vence_en=now()+interval '2 days' where id=prueba;
  if not exists(select 1 from public.agenda_sugerir_horarios_portal(empresa,inm.id,slot.fecha,30,prueba)
    where hora_inicio=candidata.hora_inicio and hora_fin=candidata.hora_fin and asesor_id=candidata.asesor_id) then
    raise exception 'La liberación de la hora perdió la propuesta';
  end if;
  if not public.agenda_slot_disponible(empresa,candidata.asesor_id,inm.id,slot.fecha,candidata.hora_inicio,candidata.hora_fin,prueba) then
    raise exception 'La propuesta conservada no pasó la comprobación de disponibilidad';
  end if;
  raise notice 'PASS: turno conservado tras liberar el horario original';
  fallo:=public.agenda_fallo_registrar(empresa,'pruebas','PRUEBA_REGISTRO','regresion','error',500,true);
  perform public.agenda_fallo_registrar(empresa,'pruebas','PRUEBA_REGISTRO','regresion','error',500,true);
  select repeticiones into n from public.agenda_fallos where id=fallo;
  if n<>2 then raise exception 'La agrupación de fallos no funcionó'; end if;
  select usuario_id into admin_id from public.agenda_miembros where empresa_id=empresa and rol='administrador' and activo limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform public.agenda_fallo_gestionar(fallo,'resuelto','Prueba de regresión SQL verificada.');
  perform public.agenda_fallo_registrar(empresa,'pruebas','PRUEBA_REGISTRO','regresion','error',500,true);
  if not exists(select 1 from public.agenda_fallos where id=fallo and estado='abierto' and repeticiones=3) then
    raise exception 'No se reabrió un fallo que reapareció';
  end if;
  if (public.agenda_fallos_listar(empresa,'abiertos',true,0)->>'total')::int<1 then raise exception 'La lista no muestra el fallo'; end if;
  insert into public.agenda_correos_log(empresa_id,cita_id,destinatario_tipo,destinatario_email,asunto,estado,modo_pruebas)
    values(empresa,prueba,'cliente','qa@example.invalid','[PRUEBA] Registro de fallo SMTP','fallido',true);
  if not exists(select 1 from public.agenda_fallos where empresa_id=empresa and modulo='correo' and codigo='CORREO_NO_ENVIADO' and es_prueba) then
    raise exception 'El error SMTP no entró al registro';
  end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  begin
    perform public.agenda_fallos_listar(empresa,'todos',null,0);
    raise exception 'FALLO: un usuario ajeno pudo consultar fallos';
  exception when raise_exception then
    if sqlerrm<>'No tienes acceso a estos fallos' then raise; end if;
  end;
  raise notice 'PASS: agrupación, reapertura, consulta, registro SMTP y denegación de acceso';
end $$;
set local role authenticated;
do $$ begin
  begin
    perform * from public.agenda_fallos;
    raise exception 'FALLO: lectura directa permitida';
  exception when insufficient_privilege then null; end;
  begin
    perform public.agenda_fallo_registrar(gen_random_uuid(),'pruebas','PRUEBA_REGISTRO');
    raise exception 'FALLO: registro directo permitido';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: tablas privadas y registro reservado al servidor';
end $$;
reset role;
rollback;
