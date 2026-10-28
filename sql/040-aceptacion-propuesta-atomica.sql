-- Dos clics simultáneos deben ver la misma confirmación, sin avisos contradictorios.
begin;
create or replace function public.agenda_propuesta_aceptar(p_cita_id uuid, p_rol text, p_propuesta_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.agenda_citas; p public.agenda_cita_propuestas; h record; ahora timestamp; propuesta_id uuid;
begin
  if p_rol not in ('cliente','arrendatario') then raise exception 'Rol inválido'; end if;
  select * into c from public.agenda_citas where id=p_cita_id;
  if not found then return jsonb_build_object('error','Esta visita ya no está disponible.'); end if;
  select * into p from public.agenda_cita_propuestas
    where cita_id=c.id and (p_propuesta_id is null or id=p_propuesta_id)
    order by creado_en desc limit 1;
  if not found or p.propuesto_por=p_rol then return jsonb_build_object('error','Ya no hay una propuesta pendiente para aceptar.'); end if;
  propuesta_id:=p.id;
  -- Mismo orden de candados que las reservas y movimientos: día, después cita.
  perform public.agenda_bloquear_dia(c.empresa_id,p.fecha);
  select * into c from public.agenda_citas where id=p_cita_id for update;
  select * into p from public.agenda_cita_propuestas where id=propuesta_id for update;
  ahora:=now() at time zone 'America/Bogota';
  if p.estado='aceptada' and c.estado='confirmada' and c.fecha=p.fecha and c.hora_inicio=p.hora_inicio
      and c.reubicacion_pendiente_desde is null then
    return jsonb_build_object('resultado','ya_aceptada','cita',jsonb_build_object('fecha',c.fecha,'hora_inicio',c.hora_inicio,'hora_fin',c.hora_fin));
  end if;
  if p.estado<>'pendiente' or c.estado<>'confirmada' or c.fecha<>p.cita_fecha or c.hora_inicio<>p.cita_hora
    or c.fecha+c.hora_inicio<=ahora or p.fecha+p.hora_inicio<=ahora
    or (c.reubicacion_vence_en is not null and c.reubicacion_vence_en<now())
    or (c.reubicacion_vence_en is null and p.creado_en<now()-interval '48 hours') then
    return jsonb_build_object('error','Esta propuesta ya no está vigente. Actualiza la página para ver tu visita.');
  end if;
  select * into h from public.agenda_sugerir_horarios_portal(c.empresa_id,c.inmueble_id,p.fecha,30,c.id)
    where hora_inicio=p.hora_inicio order by prioridad limit 1;
  if h is null or not public.agenda_slot_disponible(c.empresa_id,h.asesor_id,c.inmueble_id,p.fecha,h.hora_inicio,h.hora_fin,c.id) then
    update public.agenda_cita_propuestas set estado='expirada',respondido_en=now() where id=p.id;
    return jsonb_build_object('error','Esa hora ya no está disponible. Elige otra.','codigo','PROPUESTA_NO_DISPONIBLE');
  end if;
  update public.agenda_citas set fecha=p.fecha,hora_inicio=h.hora_inicio,hora_fin=h.hora_fin,asesor_id=h.asesor_id,
    reubicacion_pendiente_desde=null,reubicacion_vence_en=null,reubicacion_motivo=null,
    reubicacion_recordada_en=null,reubicacion_recordada2_en=null,actualizado_en=now() where id=c.id;
  update public.agenda_cita_propuestas set estado='aceptada',respondido_en=now() where id=p.id;
  return jsonb_build_object('resultado','aceptada','propuesta',jsonb_build_object('id',p.id,'fecha',p.fecha,'hora_inicio',p.hora_inicio),
    'cita',jsonb_build_object('fecha',p.fecha,'hora_inicio',h.hora_inicio,'hora_fin',h.hora_fin));
exception when exclusion_violation or unique_violation then
  return jsonb_build_object('error','Esa hora acaba de ser tomada. Elige otra.','codigo','PROPUESTA_NO_DISPONIBLE');
end $$;
revoke all on function public.agenda_propuesta_aceptar(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.agenda_propuesta_aceptar(uuid,text,uuid) to service_role;
commit;
