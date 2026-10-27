-- 031 · Supervisión de citas (señales de citas dudosas), registro de llegada con ubicación y alerta de calificación baja
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/031-supervision-citas-llegada-alertas.sql
--
-- 1) Alertas de encuesta con calificación baja: van a quien supervisa (supervisor del asesor en Equipo → correos de Configuración →
--    administradores); el asesor solo las recibe si la empresa lo activa (alerta_baja_incluye_asesor).
-- 2) Llegada: el asesor toca «Llegué a la visita» y se guarda su ubicación SOLO en ese instante (no hay rastreo continuo).
--    Se compara con las coordenadas del inmueble; no bloquea nada, deja evidencia. Se puede exigir por empresa (exigir_llegada).
-- 3) Supervisión: agenda_supervision_resumen calcula, solo para administradores, señales por cita y por asesor.
--    Una señal es un indicio para conversar y revisar, nunca una prueba.

alter table public.agenda_configuracion
  add column if not exists alerta_baja_calificacion smallint not null default 2,
  add column if not exists alerta_baja_incluye_asesor boolean not null default false,
  add column if not exists exigir_llegada boolean not null default false,
  add column if not exists llegada_radio_metros integer not null default 300;

alter table public.agenda_encuestas_cliente
  add column if not exists aviso_calidad_en timestamptz;

alter table public.agenda_citas
  add column if not exists llegada_en timestamptz,
  add column if not exists llegada_lat numeric,
  add column if not exists llegada_lon numeric,
  add column if not exists llegada_distancia_m integer,
  add column if not exists llegada_valida boolean;

-- ============================== Llegada ==============================
create or replace function public.agenda_registrar_llegada(p_cita_id uuid, p_lat numeric, p_lon numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cita record;
  v_inm record;
  v_cfg record;
  v_dist_km numeric;
  v_m integer;
  v_valida boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ahora timestamp := (now() at time zone 'America/Bogota');
begin
  select * into v_cita from public.agenda_citas where id = p_cita_id;
  if not found then raise exception 'Cita no encontrada'; end if;
  if not (
    exists (select 1 from public.agenda_asesores a where a.id = v_cita.asesor_id and a.usuario_id = auth.uid())
    or public.agenda_es_admin(v_cita.empresa_id)
  ) then
    raise exception 'Solo el asesor de la cita puede registrar su llegada.';
  end if;
  if v_cita.estado = 'cancelada' then raise exception 'La cita está cancelada.'; end if;
  if v_cita.fecha <> v_hoy then raise exception 'La llegada solo se registra el día de la cita.'; end if;
  if v_ahora < (v_cita.fecha + v_cita.hora_inicio) - interval '90 minutes' then
    raise exception 'Todavía es muy temprano para registrar la llegada.';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'No se recibió una ubicación válida.';
  end if;
  select * into v_cfg from public.agenda_configuracion where empresa_id = v_cita.empresa_id;
  select latitud, longitud into v_inm from public.agenda_inmuebles where id = v_cita.inmueble_id;
  if v_inm.latitud is not null and v_inm.longitud is not null then
    v_dist_km := public.agenda_distancia_km(p_lat, p_lon, v_inm.latitud, v_inm.longitud);
    v_m := round(v_dist_km * 1000);
    v_valida := v_m <= coalesce(v_cfg.llegada_radio_metros, 300);
  end if;
  update public.agenda_citas
     set llegada_en = now(), llegada_lat = p_lat, llegada_lon = p_lon, llegada_distancia_m = v_m, llegada_valida = v_valida
   where id = p_cita_id;
  return jsonb_build_object('valida', v_valida, 'distancia_m', v_m);
end;
$function$;
revoke all on function public.agenda_registrar_llegada(uuid, numeric, numeric) from public, anon;
grant execute on function public.agenda_registrar_llegada(uuid, numeric, numeric) to authenticated, service_role;

-- ============================== Supervisión ==============================
create or replace function public.agenda_supervision_resumen(p_empresa_id uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_exigir boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_res jsonb;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'Solo los administradores pueden ver la supervisión.';
  end if;
  if p_hasta - p_desde > 190 then
    raise exception 'Elige un periodo de máximo 6 meses.';
  end if;
  select exigir_llegada into v_exigir from public.agenda_configuracion where empresa_id = p_empresa_id;

  with base as (
    select c.id, c.fecha, c.hora_inicio, c.estado, c.cliente_nombre, c.cliente_telefono, c.cliente_email, c.asesor_id, c.creado_por,
           c.creado_en, c.actualizado_en, c.llegada_en, c.llegada_valida, c.inmueble_id,
           regexp_replace(coalesce(c.cliente_telefono, ''), '\D', '', 'g') as tel,
           lower(btrim(coalesce(c.cliente_email, ''))) as mail,
           a.nombre as asesor_nombre,
           regexp_replace(coalesce(a.celular, ''), '\D', '', 'g') as a_tel,
           lower(coalesce(a.correo, '') || ',' || coalesce(a.correos_adicionales, '')) as a_mails
    from public.agenda_citas c
    join public.agenda_asesores a on a.id = c.asesor_id
    where c.empresa_id = p_empresa_id and c.tipo_cita = 'visita_cliente' and not c.es_prueba
      and c.fecha between p_desde and p_hasta
  ),
  rep as (
    select tel, count(*) filter (where estado <> 'cancelada') n, count(distinct fecha) filter (where estado <> 'cancelada') dias,
           count(distinct lower(btrim(cliente_nombre))) filter (where estado <> 'cancelada') nombres
    from base where length(tel) >= 7 group by tel
  ),
  senales as (
    select b.*,
      (b.tel = '' or b.tel !~ '^(57)?(3[0-9]{9}|60[0-9]{8}|[0-9]{7})$' or b.tel ~ '(\d)\1{6,}' or b.tel ~ '(0123456|1234567|2345678|3456789|9876543|8765432)') as tel_invalido,
      coalesce((r.dias >= 3 or r.nombres >= 2), false) as tel_repetido,
      ((length(b.tel) >= 7 and length(b.a_tel) >= 7 and right(b.tel, 10) = right(b.a_tel, 10))
        or (b.mail <> '' and position(b.mail in b.a_mails) > 0)) as contacto_del_asesor,
      (b.mail = '' or b.mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or b.mail ~ '@(example|test|prueba|mailinator|yopmail|tempmail|correo)\.' or split_part(b.mail, '@', 1) ~ '^(test|prueba|asdf|xx+|aaa+|nn|no|na)$') as correo_dudoso,
      (length(btrim(b.cliente_nombre)) < 4 or btrim(b.cliente_nombre) !~ ' ' or b.cliente_nombre ~* '(prueba|test|asdf|xxx|fulano|sin nombre)') as nombre_dudoso,
      (b.creado_por is not null and b.creado_en > ((b.fecha + b.hora_inicio) at time zone 'America/Bogota') - interval '2 hours') as con_prisa,
      (b.creado_por is not null) as registrada_por_equipo,
      (coalesce(v_exigir, false) and b.fecha < v_hoy and b.estado in ('confirmada', 'completada') and b.llegada_en is null) as sin_llegada,
      (b.estado = 'cancelada' and (b.actualizado_en at time zone 'America/Bogota')::date = b.fecha) as cancelada_mismo_dia
    from base b left join rep r on r.tel = b.tel
  ),
  puntuadas as (
    select s.*,
      (case when s.estado = 'cancelada' then 0 else
        (case when s.contacto_del_asesor then 5 else 0 end) + (case when s.tel_invalido then 3 else 0 end)
        + (case when s.tel_repetido then 2 else 0 end) + (case when s.correo_dudoso then 2 else 0 end)
        + (case when s.nombre_dudoso then 2 else 0 end) + (case when s.con_prisa then 1 else 0 end)
        + (case when s.sin_llegada then 2 else 0 end) end) as puntaje
    from senales s
  ),
  enc as (
    select c.asesor_id, count(*) filter (where e.enviada_en is not null) enviadas, count(*) filter (where e.respondido_en is not null) respondidas
    from base c join public.agenda_encuestas_cliente e on e.cita_id = c.id group by c.asesor_id
  ),
  por_asesor as (
    select p.asesor_id, p.asesor_nombre,
      count(*) filter (where p.estado <> 'cancelada') as citas,
      count(*) filter (where p.estado <> 'cancelada' and p.registrada_por_equipo) as registradas_por_equipo,
      count(*) filter (where p.puntaje >= 3) as dudosas,
      count(*) filter (where p.con_prisa and p.estado <> 'cancelada') as con_prisa,
      count(*) filter (where p.cancelada_mismo_dia) as canceladas_mismo_dia,
      count(*) filter (where p.sin_llegada) as sin_llegada,
      count(*) filter (where p.llegada_valida is true) as llegadas_validas,
      count(*) filter (where p.llegada_en is not null and p.llegada_valida is not true) as llegadas_lejos,
      coalesce(max(e.enviadas), 0) as encuestas_enviadas, coalesce(max(e.respondidas), 0) as encuestas_respondidas
    from puntuadas p left join enc e on e.asesor_id = p.asesor_id group by p.asesor_id, p.asesor_nombre
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'exigir_llegada', coalesce(v_exigir, false),
    'empresa', (select jsonb_build_object('citas', coalesce(sum(citas), 0), 'dudosas', coalesce(sum(dudosas), 0),
                  'encuestas_enviadas', coalesce(sum(encuestas_enviadas), 0), 'encuestas_respondidas', coalesce(sum(encuestas_respondidas), 0)) from por_asesor),
    'asesores', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('nivel',
        case when a.dudosas >= 3 or (a.citas >= 4 and a.dudosas::numeric / a.citas >= 0.25) then 'revisar'
             when a.dudosas >= 1 or a.sin_llegada >= 2 then 'atencion' else 'ok' end) order by a.dudosas desc, a.citas desc) from por_asesor a), '[]'::jsonb),
    'citas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'fecha', x.fecha, 'hora_inicio', x.hora_inicio, 'asesor', x.asesor_nombre, 'cliente', x.cliente_nombre,
        'telefono', x.cliente_telefono, 'correo', x.cliente_email, 'puntaje', x.puntaje,
        'senales', array_remove(array[
          case when x.contacto_del_asesor then 'El teléfono o correo del cliente es del propio asesor' end,
          case when x.tel_invalido then 'Teléfono con formato raro o inválido' end,
          case when x.tel_repetido then 'Mismo teléfono en varias citas o con varios nombres' end,
          case when x.correo_dudoso then 'Correo vacío o dudoso' end,
          case when x.nombre_dudoso then 'Nombre incompleto o genérico' end,
          case when x.con_prisa then 'Registrada con menos de 2 h de anticipación o ya empezada' end,
          case when x.sin_llegada then 'Pasó y no registró llegada' end], null))
        order by x.puntaje desc, x.fecha desc)
      from (select * from puntuadas where puntaje >= 3 order by puntaje desc, fecha desc limit 100) x), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$;
revoke all on function public.agenda_supervision_resumen(uuid, date, date) from public, anon;
grant execute on function public.agenda_supervision_resumen(uuid, date, date) to authenticated, service_role;

-- ============================== Visor de encuesta (botón «Ver la encuesta» de los correos) ==============================
-- Solo administradores, coordinadores o el asesor de esa visita. Devuelve el comentario original y el estado del filtro de IA.
create or replace function public.agenda_encuesta_detalle(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v record;
begin
  select e.id, e.empresa_id, e.respondido_en, e.calificacion, e.impresion, e.intencion, e.motivo, e.comentario,
         e.comentario_inmueble, e.comentario_revision,
         c.cliente_nombre, c.cliente_telefono, c.cliente_email, c.fecha, c.hora_inicio, c.asesor_id,
         a.nombre as asesor_nombre, a.usuario_id as asesor_usuario, i.numero_inmueble, i.direccion
    into v
  from public.agenda_encuestas_cliente e
  join public.agenda_citas c on c.id = e.cita_id
  left join public.agenda_asesores a on a.id = c.asesor_id
  left join public.agenda_inmuebles i on i.id = e.inmueble_id
  where e.id = p_id;
  if not found then
    return jsonb_build_object('error', 'no_encontrada');
  end if;
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v.empresa_id and m.usuario_id = auth.uid() and m.activo
      and (m.rol in ('administrador', 'coordinador') or m.usuario_id = v.asesor_usuario)
  ) then
    return jsonb_build_object('error', 'sin_permiso');
  end if;
  return jsonb_build_object(
    'respondido_en', v.respondido_en, 'calificacion', v.calificacion, 'impresion', v.impresion, 'intencion', v.intencion,
    'motivo', v.motivo, 'comentario', v.comentario, 'comentario_inmueble', v.comentario_inmueble, 'comentario_revision', v.comentario_revision,
    'cliente_nombre', v.cliente_nombre, 'cliente_telefono', v.cliente_telefono, 'cliente_email', v.cliente_email,
    'fecha', v.fecha, 'hora_inicio', v.hora_inicio, 'asesor_nombre', v.asesor_nombre, 'numero_inmueble', v.numero_inmueble, 'direccion', v.direccion
  );
end;
$function$;
revoke all on function public.agenda_encuesta_detalle(uuid) from public, anon;
grant execute on function public.agenda_encuesta_detalle(uuid) to authenticated, service_role;
