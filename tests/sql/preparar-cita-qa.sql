-- Solo citas sintéticas de esta sesión. No envía correos.
begin;
do $$
declare inm record; slot record; total integer;
begin
  select * into inm from public.agenda_inmuebles where numero_inmueble=127 limit 1;
  if not exists(select 1 from public.agenda_configuracion where empresa_id=inm.empresa_id and correo_modo_pruebas=true and correo_pruebas_destino is not null) then
    raise exception 'La prueba exige el modo de correo de pruebas activo y un destino';
  end if;
  select count(*) into total from public.agenda_citas where cliente_nombre ~ '^Agente Prueba [0-9]+$' and cliente_email ~ '\+agente[0-9]+@patrimonios[.]co$';
  if total not in (0,36) then raise exception 'El grupo sintético cambió: revisar antes de marcar'; end if;
  update public.agenda_citas set es_prueba=true,cliente_nombre='[PRUEBA] '||cliente_nombre
    where cliente_nombre ~ '^Agente Prueba [0-9]+$' and cliente_email ~ '\+agente[0-9]+@patrimonios[.]co$';
  if not exists(select 1 from public.agenda_citas where cliente_nombre='[PRUEBA] QA correcciones 27-oct') then
    select h.*,d::date as fecha into slot from generate_series(current_date+7,current_date+20,interval '1 day') d
      cross join lateral public.agenda_sugerir_horarios(inm.empresa_id,inm.id,d::date,30) h
      where not exists(select 1 from public.agenda_citas c where c.inmueble_id=inm.id and c.fecha=d::date and c.estado<>'cancelada')
      order by d,h.hora_inicio limit 1;
    if slot is null then raise exception 'Sin horario para la prueba'; end if;
    insert into public.agenda_citas(empresa_id,inmueble_id,asesor_id,fecha,hora_inicio,hora_fin,cliente_nombre,cliente_email,cliente_telefono,estado,tipo_cita,es_prueba)
      values(inm.empresa_id,inm.id,slot.asesor_id,slot.fecha,slot.hora_inicio,slot.hora_fin,'[PRUEBA] QA correcciones 27-oct',
        'pf.castelli+qa-correcciones-20261027@patrimonios.co','3000000099','confirmada','visita_cliente',true);
  end if;
end $$;
commit;
-- Esta salida contiene credenciales de la cita sintética. Guardarla solo en respaldos/.
select jsonb_build_object('id',c.id,'es_prueba',c.es_prueba,'nombre',c.cliente_nombre,'fecha',c.fecha,'hora_inicio',c.hora_inicio,
  'token_cliente',c.token_cliente,'token_arrendatario',c.token_arrendatario,'numero',i.numero_inmueble,'modo_pruebas',g.correo_modo_pruebas) as qa
from public.agenda_citas c join public.agenda_inmuebles i on i.id=c.inmueble_id join public.agenda_configuracion g on g.empresa_id=c.empresa_id
where c.cliente_nombre='[PRUEBA] QA correcciones 27-oct';
