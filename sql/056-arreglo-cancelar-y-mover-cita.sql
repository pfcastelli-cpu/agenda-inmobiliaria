-- 056: cancelar y mover una cita desde la agenda fallaban con
--   "permission denied for table agenda_citas".
-- Causa: 055-proteger-tokens.sql quitó el SELECT general de agenda_citas al rol authenticated
-- (solo queda SELECT por columnas, sin los tokens) y estas dos funciones (SECURITY INVOKER)
-- leían la cita con `select *`, que incluye las columnas protegidas.
-- Arreglo: leer solo las columnas que usan. Misma lógica y mismos permisos; no se expone ningún token.
-- Las otras funciones con `select *` (agenda_arrendatario_confirmar, agenda_propuesta_aceptar,
-- agenda_reagendar_cita_publica, agenda_registrar_llegada) son SECURITY DEFINER y no se ven afectadas.

create or replace function public.agenda_cancelar_cita(p_cita_id uuid, p_solicitante_asesor_id uuid, p_motivo text default ''::text)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_cita record;
  v_solicitante record;
begin
  select c.empresa_id, c.asesor_id, c.estado into v_cita from public.agenda_citas c where c.id = p_cita_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_cita.empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;

  if p_solicitante_asesor_id is not null then
    select * into v_solicitante from public.agenda_asesores where id = p_solicitante_asesor_id and empresa_id = v_cita.empresa_id and activo;
    if not found then
      raise exception 'Asesor solicitante no válido';
    end if;

    if v_solicitante.rol not in ('admin','super_admin') and v_solicitante.id <> v_cita.asesor_id then
      raise exception 'Solo puedes cancelar tus propias citas';
    end if;

    if not public.agenda_asesor_tiene_permiso(p_solicitante_asesor_id, 'eliminar') then
      raise exception 'No tienes permiso para cancelar citas. Pide a un administrador que la cancele.';
    end if;
  end if;

  if v_cita.estado = 'cancelada' then
    raise exception 'Esta cita ya está cancelada';
  end if;

  update public.agenda_citas
    set estado = 'cancelada', motivo_cancelacion = coalesce(p_motivo, ''), cancelado_por = auth.uid(), actualizado_en = now()
    where id = p_cita_id;
end;
$function$;

create or replace function public.agenda_mover_cita(p_cita_id uuid, p_solicitante_asesor_id uuid, p_nueva_fecha date, p_nueva_hora_inicio time without time zone, p_forzar boolean default false)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_cita record;
  v_solicitante record;
  v_duracion int;
  v_hora_fin time;
  v_forzar boolean := coalesce(p_forzar, false);
begin
  select c.empresa_id, c.asesor_id, c.inmueble_id, c.estado, c.hora_inicio, c.hora_fin
    into v_cita from public.agenda_citas c where c.id = p_cita_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_cita.empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if p_solicitante_asesor_id is not null then
    select * into v_solicitante from public.agenda_asesores where id = p_solicitante_asesor_id and empresa_id = v_cita.empresa_id and activo;
    if not found then
      raise exception 'Asesor solicitante no válido';
    end if;
    if v_solicitante.rol not in ('admin','super_admin') and v_solicitante.id <> v_cita.asesor_id then
      raise exception 'Solo puedes mover tus propias citas';
    end if;
    if not public.agenda_asesor_tiene_permiso(p_solicitante_asesor_id, 'mover') then
      raise exception 'No tienes permiso para mover citas. Pide a un administrador que la reprograme.';
    end if;
  end if;
  if v_cita.estado = 'cancelada' then
    raise exception 'Esta cita ya está cancelada';
  end if;
  if v_forzar and not public.agenda_puede_cruzar(v_cita.empresa_id) then
    raise exception 'Tu empresa no permite agendar sobre un horario ocupado. Pide a un administrador que lo haga.';
  end if;

  v_duracion := extract(epoch from (v_cita.hora_fin - v_cita.hora_inicio)) / 60;
  v_hora_fin := p_nueva_hora_inicio + (v_duracion || ' minutes')::interval;

  perform public.agenda_bloquear_dia(v_cita.empresa_id, p_nueva_fecha);

  if not v_forzar then
    if v_cita.inmueble_id is not null then
      if not public.agenda_slot_disponible(v_cita.empresa_id, v_cita.asesor_id, v_cita.inmueble_id, p_nueva_fecha, p_nueva_hora_inicio, v_hora_fin, p_cita_id) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    else
      if exists (
        select 1 from public.agenda_citas c
        where c.asesor_id = v_cita.asesor_id and c.fecha = p_nueva_fecha and c.estado <> 'cancelada' and c.id <> p_cita_id
          and c.hora_inicio < v_hora_fin and c.hora_fin > p_nueva_hora_inicio
      ) then
        raise exception 'El asesor ya tiene una cita en ese horario';
      end if;
    end if;
  else
    perform set_config('agenda.cruce_autorizado', 'on', true);
  end if;

  update public.agenda_citas
    set fecha = p_nueva_fecha, hora_inicio = p_nueva_hora_inicio, hora_fin = v_hora_fin, actualizado_en = now(),
        cruce_autorizado = case when v_forzar then true else cruce_autorizado end,
        cruce_autorizado_por = case when v_forzar then auth.uid() else cruce_autorizado_por end
    where id = p_cita_id;
end;
$function$;
