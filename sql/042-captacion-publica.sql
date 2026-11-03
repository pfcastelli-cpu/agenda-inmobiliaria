-- 042 · Captación pública: el propietario agenda solo su cita de captación (página /consignar)
-- Cita tipo 'captacion' (90 min, prioridad total) con el asesor de mayor prioridad que esté libre en esa ciudad.
-- Mezcla los horarios de todos los asesores de la ciudad (agenda_sugerir_horarios_captacion_ciudad, sql/041).
-- La página está APAGADA hasta activar agenda_configuracion.captacion_publica_activa (Administración → Empresa).
-- Protección contra abuso: máx. 2 captaciones activas por correo o celular y 30 solicitudes públicas por hora y empresa.
-- Los datos del propietario nunca se devuelven a la página; solo horas libres (sin nombres de asesores) y la confirmación.

alter table public.agenda_configuracion add column if not exists captacion_publica_activa boolean not null default false;

create or replace function public.agenda_captacion_publica_config(p_empresa_slug text default null, p_host text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_cfg record;
begin
  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select c.captacion_publica_activa, c.nombre_comercial into v_cfg from public.agenda_configuracion c where c.empresa_id = v_empresa;
  if not coalesce(v_cfg.captacion_publica_activa, false) then
    return jsonb_build_object('activa', false);
  end if;
  return jsonb_build_object(
    'activa', true,
    'nombre', v_cfg.nombre_comercial,
    'ciudades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id, 'nombre', ci.nombre,
        'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'nombre', z.nombre) order by z.nombre) from public.agenda_coberturas z where z.ciudad_id = ci.id), '[]'::jsonb)
      ) order by ci.nombre)
      from public.agenda_ciudades ci
      where ci.empresa_id = v_empresa
        and exists (select 1 from public.agenda_asesores_ciudades x join public.agenda_asesores a on a.id = x.asesor_id where x.ciudad_id = ci.id and a.activo)
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.agenda_captacion_publica_horarios(
  p_ciudad_id uuid, p_fecha_desde date, p_cobertura_id uuid default null, p_empresa_slug text default null, p_host text default null
) returns table(fecha date, hora_inicio time without time zone, hora_fin time without time zone)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
begin
  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  if not coalesce((select c.captacion_publica_activa from public.agenda_configuracion c where c.empresa_id = v_empresa), false) then
    raise exception 'Esta página no está habilitada';
  end if;
  if not exists (select 1 from public.agenda_ciudades ci where ci.id = p_ciudad_id and ci.empresa_id = v_empresa) then
    raise exception 'Ciudad no válida';
  end if;
  return query
    select distinct r.fecha, r.hora_inicio, r.hora_fin
    from public.agenda_sugerir_horarios_captacion_ciudad(v_empresa, p_ciudad_id, p_fecha_desde, 14, p_cobertura_id) r
    order by 1, 2;
end;
$function$;

create or replace function public.agenda_captacion_publica_agendar(
  p_ciudad_id uuid, p_fecha date, p_hora_inicio time without time zone,
  p_nombre text, p_telefono text, p_email text, p_direccion text,
  p_tipo_inmueble text default null, p_gestion text default null, p_valor numeric default null,
  p_barrio text default null, p_observaciones text default null, p_cobertura_id uuid default null,
  p_acepta_datos boolean default false, p_empresa_slug text default null, p_host text default null,
  p_complemento text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_ciudad record;
  v_el record;
  v_id uuid;
  v_token uuid;
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_notas text;
begin
  if p_nombre is null or length(trim(p_nombre)) < 2 then raise exception 'Escribe tu nombre completo'; end if;
  if p_email is null or trim(p_email) not like '%@%.%' or length(p_email) > 120 then raise exception 'Escribe un correo electrónico válido'; end if;
  if length(v_tel) < 7 or length(v_tel) > 15 then raise exception 'Escribe un número de celular válido'; end if;
  if p_direccion is null or length(trim(p_direccion)) < 5 then raise exception 'Escribe la dirección del inmueble'; end if;
  if not coalesce(p_acepta_datos, false) then raise exception 'Debes autorizar el tratamiento de tus datos para continuar'; end if;

  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  if not coalesce((select c.captacion_publica_activa from public.agenda_configuracion c where c.empresa_id = v_empresa), false) then
    raise exception 'Esta página no está habilitada';
  end if;
  select ci.id, ci.nombre into v_ciudad from public.agenda_ciudades ci where ci.id = p_ciudad_id and ci.empresa_id = v_empresa;
  if not found then raise exception 'Ciudad no válida'; end if;
  if p_cobertura_id is not null and not exists (select 1 from public.agenda_coberturas z where z.id = p_cobertura_id and z.ciudad_id = p_ciudad_id) then
    raise exception 'Zona no válida';
  end if;

  perform public.agenda_bloquear_dia(v_empresa, p_fecha);

  if (select count(*) from public.agenda_citas c
        where c.empresa_id = v_empresa and c.tipo_cita = 'captacion' and c.estado <> 'cancelada' and c.fecha >= current_date
          and (lower(c.cliente_email) = lower(trim(p_email)) or regexp_replace(c.cliente_telefono, '\D', '', 'g') = v_tel)) >= 2 then
    raise exception 'Ya tienes citas de captación pendientes con nosotros. Si necesitas cambiarlas, escríbenos o llámanos.';
  end if;
  if (select count(*) from public.agenda_citas c
        where c.empresa_id = v_empresa and c.tipo_cita = 'captacion' and c.creado_por is null and c.creado_en > now() - interval '1 hour') >= 30 then
    raise exception 'Estamos recibiendo muchas solicitudes. Intenta de nuevo en un rato o escríbenos por WhatsApp.';
  end if;

  select r.asesor_id, r.hora_fin, r.asesor_nombre into v_el
    from public.agenda_sugerir_horarios_captacion_ciudad(v_empresa, p_ciudad_id, p_fecha, 1, p_cobertura_id) r
    where r.fecha = p_fecha and r.hora_inicio = p_hora_inicio
    order by r.prioridad, case when r.tipo_vinculacion = 'planta' then 0 else 1 end, r.asesor_nombre
    limit 1;
  if v_el.asesor_id is null then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;

  v_notas := concat_ws(E'\n',
    'Solicitud hecha por el propietario desde la página pública.',
    case when nullif(trim(p_gestion), '') is not null then 'Quiere: ' || left(trim(p_gestion), 40) end,
    case when nullif(trim(p_barrio), '') is not null then 'Barrio o sector: ' || left(trim(p_barrio), 80) end,
    case when nullif(trim(p_complemento), '') is not null then 'Conjunto, edificio o apartamento: ' || left(trim(p_complemento), 100) end,
    case when nullif(trim(p_observaciones), '') is not null then 'Observaciones: ' || left(trim(p_observaciones), 500) end,
    'Autorizó el tratamiento de datos (Ley 1581) el ' || to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') || ' (hora de Bogotá).');

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, notas, creado_por,
    tipo_cita, titulo, direccion_libre, ciudad_libre,
    cobertura_id, tipo_inmueble_captacion, valor_estimado_captacion, origen_captacion
  ) values (
    v_empresa, null, v_el.asesor_id, p_fecha, p_hora_inicio, v_el.hora_fin,
    left(trim(p_nombre), 120), left(trim(p_telefono), 30), lower(trim(p_email)), v_notas, null,
    'captacion', 'Captación web', left(trim(p_direccion), 200), v_ciudad.nombre,
    p_cobertura_id, nullif(left(trim(coalesce(p_tipo_inmueble, '')), 40), ''), p_valor, 'Página web (consigna tu inmueble)'
  ) returning id, token_cliente into v_id, v_token;

  return jsonb_build_object('cita_id', v_id, 'token', v_token, 'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', v_el.hora_fin, 'asesor_nombre', v_el.asesor_nombre);
end;
$function$;

revoke all on function public.agenda_captacion_publica_config(text, text) from public;
revoke all on function public.agenda_captacion_publica_horarios(uuid, date, uuid, text, text) from public;
revoke all on function public.agenda_captacion_publica_agendar(uuid, date, time, text, text, text, text, text, text, numeric, text, text, uuid, boolean, text, text, text) from public;
grant execute on function public.agenda_captacion_publica_config(text, text) to anon, authenticated, service_role;
grant execute on function public.agenda_captacion_publica_horarios(uuid, date, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.agenda_captacion_publica_agendar(uuid, date, time, text, text, text, text, text, text, numeric, text, text, uuid, boolean, text, text, text) to anon, authenticated, service_role;
