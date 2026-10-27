-- 030 · IA con varios proveedores + asesor puede agendar con cruce (con aviso) + reuniones virtuales
-- Es seguro repetirlo. Aplicar con: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/030-ia-multiproveedor-cruces-videollamada.sql
--
-- 1) IA: la empresa elige proveedor (Anthropic/Claude, OpenAI/ChatGPT, Google/Gemini) y, si quiere, el modelo. La clave sigue en Vault.
-- 2) Cruces: un asesor (o solo administradores, según el ajuste) puede agendar en un horario ocupado si confirma una advertencia.
--    La confirmación queda registrada en la cita (cruce_autorizado, cruce_autorizado_por).
-- 3) Reuniones virtuales: cada cita puede ser presencial o virtual con enlace (Google Meet, Microsoft Teams, Zoom o enlace manual).
--    Las credenciales del proveedor van en Vault (JSON) y solo las lee la Edge Function crear-videollamada (service_role).

-- ============================== 1) IA multiproveedor ==============================
alter table public.agenda_configuracion
  add column if not exists ia_proveedor text not null default 'anthropic',
  add column if not exists ia_modelo text;
do $$ begin
  alter table public.agenda_configuracion add constraint agenda_configuracion_ia_proveedor_chk check (ia_proveedor in ('anthropic','openai','google'));
exception when duplicate_object then null; end $$;

drop function if exists public.agenda_guardar_clave_ia(uuid, text, boolean, boolean);
create or replace function public.agenda_guardar_clave_ia(
  p_empresa_id uuid, p_clave text, p_activa boolean default true, p_quitar boolean default false,
  p_proveedor text default null, p_modelo text default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret_id uuid;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'No tienes permisos de administrador en esta empresa.';
  end if;
  select ia_clave_secret_id into v_secret_id from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No existe configuración para esta empresa.';
  end if;
  if p_proveedor is not null and p_proveedor not in ('anthropic','openai','google') then
    raise exception 'Proveedor de IA no válido.';
  end if;

  if coalesce(p_quitar, false) then
    update public.agenda_configuracion set ia_clave_secret_id = null where empresa_id = p_empresa_id;
    if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
    return;
  end if;

  if p_clave is not null and length(btrim(p_clave)) > 0 then
    if length(btrim(p_clave)) < 20 then
      raise exception 'La clave parece incompleta. Cópiala completa desde el panel de tu proveedor de IA.';
    end if;
    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, btrim(p_clave));
    else
      v_secret_id := vault.create_secret(btrim(p_clave), 'agenda_ia_' || p_empresa_id::text,
        'Clave de API de IA (filtro de opiniones) para empresa ' || p_empresa_id::text);
    end if;
  end if;

  update public.agenda_configuracion
     set ia_clave_secret_id = v_secret_id,
         ia_filtro_activo = coalesce(p_activa, true),
         ia_proveedor = coalesce(p_proveedor, ia_proveedor),
         ia_modelo = case when p_proveedor is null and p_modelo is null then ia_modelo else nullif(btrim(coalesce(p_modelo, '')), '') end
   where empresa_id = p_empresa_id;
end;
$function$;

create or replace function public.agenda_ia_estado(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cfg record;
  v_conteo jsonb;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'No tienes permisos de administrador en esta empresa.';
  end if;
  select ia_clave_secret_id is not null as tiene_clave, ia_filtro_activo as activa, ia_proveedor, ia_modelo
    into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  select coalesce(jsonb_object_agg(comentario_revision, n), '{}'::jsonb) into v_conteo
    from (select comentario_revision, count(*) n from public.agenda_encuestas_cliente
           where empresa_id = p_empresa_id and comentario_revision is not null group by 1) t;
  return jsonb_build_object('tiene_clave', coalesce(v_cfg.tiene_clave, false), 'activa', coalesce(v_cfg.activa, true),
    'proveedor', coalesce(v_cfg.ia_proveedor, 'anthropic'), 'modelo', v_cfg.ia_modelo, 'comentarios', v_conteo);
end;
$function$;

-- Devuelve {clave, proveedor, modelo} como JSON en texto (solo service_role).
drop function if exists public.agenda_obtener_clave_ia(uuid);
create or replace function public.agenda_obtener_clave_ia(p_empresa_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'vault'
as $function$
  select jsonb_build_object('clave', s.decrypted_secret, 'proveedor', c.ia_proveedor, 'modelo', c.ia_modelo)
  from public.agenda_configuracion c
  join vault.decrypted_secrets s on s.id = c.ia_clave_secret_id
  where c.empresa_id = p_empresa_id and c.ia_filtro_activo;
$function$;

revoke all on function public.agenda_guardar_clave_ia(uuid, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.agenda_guardar_clave_ia(uuid, text, boolean, boolean, text, text) to authenticated, service_role;
revoke all on function public.agenda_ia_estado(uuid) from public, anon;
grant execute on function public.agenda_ia_estado(uuid) to authenticated, service_role;
revoke all on function public.agenda_obtener_clave_ia(uuid) from public, anon, authenticated;
grant execute on function public.agenda_obtener_clave_ia(uuid) to service_role;

-- ============================== 2) Cruces autorizados ==============================
alter table public.agenda_configuracion
  add column if not exists asesores_pueden_cruzar boolean not null default true;
alter table public.agenda_citas
  add column if not exists cruce_autorizado boolean not null default false,
  add column if not exists cruce_autorizado_por uuid;

-- La regla anti-doble-reserva (sql/029) se salta solo cuando la función autorizada lo declara en esa transacción.
create or replace function public.agenda_citas_sin_choque()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_modo text;
begin
  if new.estado = 'cancelada' or new.fecha is null or new.hora_inicio is null or new.hora_fin is null then
    return new;
  end if;
  if current_setting('agenda.cruce_autorizado', true) = 'on' then
    return new;
  end if;
  if new.fecha < (now() at time zone 'America/Bogota')::date then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.estado <> 'cancelada'
     and new.fecha = old.fecha and new.hora_inicio = old.hora_inicio and new.hora_fin = old.hora_fin
     and new.asesor_id is not distinct from old.asesor_id and new.inmueble_id is not distinct from old.inmueble_id then
    return new;
  end if;

  perform public.agenda_bloquear_dia(new.empresa_id, new.fecha);
  select modo_mismo_inmueble into v_modo from public.agenda_configuracion where empresa_id = new.empresa_id;

  if exists (
    select 1 from public.agenda_citas c
    where c.id <> new.id and c.empresa_id = new.empresa_id and c.fecha = new.fecha and c.estado <> 'cancelada'
      and c.hora_inicio < new.hora_fin and c.hora_fin > new.hora_inicio
      and (
        (c.asesor_id = new.asesor_id and (c.inmueble_id is distinct from new.inmueble_id or coalesce(v_modo, 'desactivado') = 'desactivado'))
        or (new.inmueble_id is not null and c.inmueble_id = new.inmueble_id and c.asesor_id is distinct from new.asesor_id)
      )
  ) then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;
  return new;
end;
$function$;

-- Quién puede autorizar un cruce: cualquier miembro activo si la empresa lo permite; si no, solo administradores.
create or replace function public.agenda_puede_cruzar(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo)
     and (public.agenda_es_admin(p_empresa_id)
          or coalesce((select asesores_pueden_cruzar from public.agenda_configuracion where empresa_id = p_empresa_id), true));
$function$;
revoke all on function public.agenda_puede_cruzar(uuid) from public, anon;
grant execute on function public.agenda_puede_cruzar(uuid) to authenticated, service_role;

-- Qué choca con un horario propuesto (para mostrar la advertencia antes de confirmar).
-- Devuelve {libre, puede_cruzar, conflictos:[{tipo, detalle, hora_inicio, hora_fin}]}.
create or replace function public.agenda_conflictos_cita(
  p_empresa_id uuid, p_asesor_id uuid, p_inmueble_id uuid, p_fecha date, p_hora_inicio time, p_duracion_minutos integer default null,
  p_ignorar_cita_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_cfg record;
  v_fin time;
  v_lista jsonb := '[]'::jsonb;
  v_r record;
  v_alm_activo boolean;
  v_alm_ini time;
  v_alm_fin time;
begin
  if not exists (select 1 from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo) then
    raise exception 'No perteneces a esta empresa';
  end if;
  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  v_fin := p_hora_inicio + (coalesce(p_duracion_minutos, v_cfg.duracion_visita_minutos, 60) || ' minutes')::interval;

  -- Otras citas del mismo asesor que se cruzan.
  for v_r in
    select c.hora_inicio, c.hora_fin, coalesce(i.numero_inmueble::text, c.titulo, c.tipo_cita) as lugar
    from public.agenda_citas c left join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = p_empresa_id and c.asesor_id = p_asesor_id and c.fecha = p_fecha and c.estado <> 'cancelada'
      and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
      and c.hora_inicio < v_fin and c.hora_fin > p_hora_inicio
  loop
    v_lista := v_lista || jsonb_build_object('tipo', 'asesor_ocupado',
      'detalle', 'El asesor ya tiene otra cita (' || v_r.lugar || ')', 'hora_inicio', v_r.hora_inicio, 'hora_fin', v_r.hora_fin);
  end loop;

  -- Otro asesor en el mismo inmueble a la misma hora.
  if p_inmueble_id is not null then
    for v_r in
      select c.hora_inicio, c.hora_fin, a.nombre as asesor
      from public.agenda_citas c join public.agenda_asesores a on a.id = c.asesor_id
      where c.empresa_id = p_empresa_id and c.inmueble_id = p_inmueble_id and c.asesor_id <> p_asesor_id and c.fecha = p_fecha
        and c.estado <> 'cancelada' and (p_ignorar_cita_id is null or c.id <> p_ignorar_cita_id)
        and c.hora_inicio < v_fin and c.hora_fin > p_hora_inicio
    loop
      v_lista := v_lista || jsonb_build_object('tipo', 'inmueble_ocupado',
        'detalle', 'El inmueble ya tiene una cita con ' || v_r.asesor, 'hora_inicio', v_r.hora_inicio, 'hora_fin', v_r.hora_fin);
    end loop;

    if exists (select 1 from public.agenda_inmueble_ventanas w where w.inmueble_id = p_inmueble_id and w.fecha = p_fecha
                and w.tipo = 'bloqueo' and w.desde < v_fin and w.hasta > p_hora_inicio) then
      v_lista := v_lista || jsonb_build_object('tipo', 'ventana_arrendatario',
        'detalle', 'El arrendatario bloqueó ese horario', 'hora_inicio', p_hora_inicio, 'hora_fin', v_fin);
    end if;
  end if;

  -- Almuerzo del asesor.
  select coalesce(a.almuerzo_activo, v_cfg.almuerzo_activo), coalesce(a.almuerzo_inicio, v_cfg.almuerzo_inicio), coalesce(a.almuerzo_fin, v_cfg.almuerzo_fin)
    into v_alm_activo, v_alm_ini, v_alm_fin from public.agenda_asesores a where a.id = p_asesor_id;
  if coalesce(v_alm_activo, false) and p_hora_inicio < v_alm_fin and v_fin > v_alm_ini then
    v_lista := v_lista || jsonb_build_object('tipo', 'almuerzo', 'detalle', 'Cae en el horario de almuerzo del asesor',
      'hora_inicio', v_alm_ini, 'hora_fin', v_alm_fin);
  end if;

  -- Si nada se cruza pero el motor de horarios lo rechaza (traslado, anticipación...), se avisa en general.
  if jsonb_array_length(v_lista) = 0 and p_inmueble_id is not null
     and not public.agenda_slot_disponible(p_empresa_id, p_asesor_id, p_inmueble_id, p_fecha, p_hora_inicio, v_fin, p_ignorar_cita_id) then
    v_lista := v_lista || jsonb_build_object('tipo', 'traslado',
      'detalle', 'No alcanza el tiempo de traslado entre citas o el horario no cumple las reglas de la agenda', 'hora_inicio', p_hora_inicio, 'hora_fin', v_fin);
  end if;

  return jsonb_build_object('libre', jsonb_array_length(v_lista) = 0, 'puede_cruzar', public.agenda_puede_cruzar(p_empresa_id), 'conflictos', v_lista);
end;
$function$;
revoke all on function public.agenda_conflictos_cita(uuid, uuid, uuid, date, time, integer, uuid) from public, anon;
grant execute on function public.agenda_conflictos_cita(uuid, uuid, uuid, date, time, integer, uuid) to authenticated, service_role;

-- ============================== 3) Reuniones virtuales ==============================
alter table public.agenda_configuracion
  add column if not exists videollamada_proveedor text not null default 'manual',
  add column if not exists videollamada_secret_id uuid;
do $$ begin
  alter table public.agenda_configuracion add constraint agenda_configuracion_videollamada_chk check (videollamada_proveedor in ('manual','google_meet','microsoft_teams','zoom'));
exception when duplicate_object then null; end $$;

alter table public.agenda_citas
  add column if not exists modalidad text not null default 'presencial',
  add column if not exists enlace_virtual text,
  add column if not exists proveedor_virtual text,
  add column if not exists virtual_evento_id text;
do $$ begin
  alter table public.agenda_citas add constraint agenda_citas_modalidad_chk check (modalidad in ('presencial','virtual'));
exception when duplicate_object then null; end $$;

-- Guardar proveedor y credenciales (JSON) — solo administradores. p_credenciales vacío = conservar las actuales.
create or replace function public.agenda_guardar_credenciales_videollamada(
  p_empresa_id uuid, p_proveedor text, p_credenciales text default null, p_quitar boolean default false
) returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret_id uuid;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'No tienes permisos de administrador en esta empresa.';
  end if;
  if p_proveedor not in ('manual','google_meet','microsoft_teams','zoom') then
    raise exception 'Proveedor de reuniones no válido.';
  end if;
  select videollamada_secret_id into v_secret_id from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No existe configuración para esta empresa.';
  end if;

  if coalesce(p_quitar, false) or p_proveedor = 'manual' then
    update public.agenda_configuracion set videollamada_proveedor = 'manual', videollamada_secret_id = null where empresa_id = p_empresa_id;
    if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
    return;
  end if;

  if p_credenciales is not null and length(btrim(p_credenciales)) > 0 then
    begin
      perform btrim(p_credenciales)::jsonb;
    exception when others then
      raise exception 'Las credenciales no tienen formato válido.';
    end;
    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, btrim(p_credenciales));
    else
      v_secret_id := vault.create_secret(btrim(p_credenciales), 'agenda_videollamada_' || p_empresa_id::text,
        'Credenciales de reuniones virtuales para empresa ' || p_empresa_id::text);
    end if;
  elsif v_secret_id is null then
    raise exception 'Faltan las credenciales del proveedor.';
  end if;

  update public.agenda_configuracion set videollamada_proveedor = p_proveedor, videollamada_secret_id = v_secret_id where empresa_id = p_empresa_id;
end;
$function$;

create or replace function public.agenda_videollamada_estado(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v record;
begin
  if not exists (select 1 from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo) then
    raise exception 'No perteneces a esta empresa';
  end if;
  select videollamada_proveedor, videollamada_secret_id is not null as tiene into v
    from public.agenda_configuracion where empresa_id = p_empresa_id;
  return jsonb_build_object('proveedor', coalesce(v.videollamada_proveedor, 'manual'), 'tiene_credenciales', coalesce(v.tiene, false));
end;
$function$;

-- Solo service_role (la usa crear-videollamada). Nunca el navegador.
create or replace function public.agenda_obtener_credenciales_videollamada(p_empresa_id uuid)
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $function$
  select s.decrypted_secret from public.agenda_configuracion c
  join vault.decrypted_secrets s on s.id = c.videollamada_secret_id
  where c.empresa_id = p_empresa_id;
$function$;

revoke all on function public.agenda_guardar_credenciales_videollamada(uuid, text, text, boolean) from public, anon;
grant execute on function public.agenda_guardar_credenciales_videollamada(uuid, text, text, boolean) to authenticated, service_role;
revoke all on function public.agenda_videollamada_estado(uuid) from public, anon;
grant execute on function public.agenda_videollamada_estado(uuid) to authenticated, service_role;
revoke all on function public.agenda_obtener_credenciales_videollamada(uuid) from public, anon, authenticated;
grant execute on function public.agenda_obtener_credenciales_videollamada(uuid) to service_role;

-- ============================== 4) Crear / mover cita interna con cruce y modalidad ==============================
-- Se reemplazan las versiones anteriores (mismos parámetros + p_forzar, p_modalidad, p_enlace_virtual al final).
drop function if exists public.agenda_crear_cita_interna(uuid, uuid, date, time, uuid, text, text, text, text, text, text, text, text, integer, uuid, text, numeric, boolean, text);
create or replace function public.agenda_crear_cita_interna(
  p_empresa_id uuid, p_asesor_id uuid, p_fecha date, p_hora_inicio time without time zone,
  p_inmueble_id uuid default null, p_cliente_nombre text default ''::text, p_cliente_telefono text default ''::text,
  p_cliente_email text default ''::text, p_notas text default ''::text, p_tipo_cita text default 'visita_cliente'::text,
  p_titulo text default ''::text, p_direccion_libre text default ''::text, p_ciudad_libre text default ''::text,
  p_duracion_minutos integer default null, p_cobertura_id uuid default null, p_tipo_inmueble_captacion text default null,
  p_valor_estimado_captacion numeric default null, p_mandato_exclusivo boolean default null, p_origen_captacion text default null,
  p_forzar boolean default false, p_modalidad text default 'presencial', p_enlace_virtual text default ''
) returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_cfg record;
  v_asesor record;
  v_hora_fin time;
  v_id uuid;
  v_duracion int;
  v_alm_activo boolean;
  v_alm_inicio time;
  v_alm_fin time;
  v_minimo timestamp;
  v_forzar boolean := coalesce(p_forzar, false);
begin
  if not exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    raise exception 'No perteneces a esta empresa';
  end if;
  if p_tipo_cita not in ('visita_cliente','inventario','inspeccion','captacion','otro') then
    raise exception 'Tipo de cita no válido: %', p_tipo_cita;
  end if;
  if coalesce(p_modalidad, 'presencial') not in ('presencial','virtual') then
    raise exception 'Modalidad no válida';
  end if;
  if v_forzar and not public.agenda_puede_cruzar(p_empresa_id) then
    raise exception 'Tu empresa no permite agendar sobre un horario ocupado. Pide a un administrador que lo haga.';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No hay configuración para esta empresa';
  end if;
  select * into v_asesor from public.agenda_asesores a where a.id = p_asesor_id and a.empresa_id = p_empresa_id and a.activo;
  if not found then
    raise exception 'Asesor no válido para esta empresa';
  end if;
  if p_tipo_cita = 'visita_cliente' and (p_cliente_nombre is null or p_cliente_nombre = '') then
    raise exception 'El nombre del cliente es obligatorio para una visita con cliente';
  end if;
  if p_inmueble_id is not null then
    if not exists (select 1 from public.agenda_inmuebles i where i.id = p_inmueble_id and i.empresa_id = p_empresa_id) then
      raise exception 'Inmueble no válido para esta empresa';
    end if;
  elsif p_tipo_cita <> 'captacion' then
    raise exception 'Este tipo de cita requiere un inmueble existente';
  end if;

  v_duracion := coalesce(p_duracion_minutos, case when p_tipo_cita = 'captacion' then 90 else v_cfg.duracion_visita_minutos end);
  if v_duracion is null or v_duracion <= 0 then
    raise exception 'La duración debe ser mayor a cero minutos';
  end if;
  v_hora_fin := p_hora_inicio + (v_duracion || ' minutes')::interval;

  perform public.agenda_bloquear_dia(p_empresa_id, p_fecha);

  if not v_forzar then
    if p_inmueble_id is not null then
      if not public.agenda_slot_disponible(p_empresa_id, p_asesor_id, p_inmueble_id, p_fecha, p_hora_inicio, v_hora_fin) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    else
      v_alm_activo := coalesce(v_asesor.almuerzo_activo, v_cfg.almuerzo_activo);
      v_alm_inicio := coalesce(v_asesor.almuerzo_inicio, v_cfg.almuerzo_inicio);
      v_alm_fin := coalesce(v_asesor.almuerzo_fin, v_cfg.almuerzo_fin);
      if v_alm_activo and p_hora_inicio < v_alm_fin and v_hora_fin > v_alm_inicio then
        raise exception 'Ese horario cae en el horario de almuerzo del asesor';
      end if;
      v_minimo := (now() at time zone 'America/Bogota') + (coalesce(v_asesor.horas_minimas_anticipacion, v_cfg.horas_minimas_anticipacion, 0) || ' hours')::interval;
      if (p_fecha + p_hora_inicio) < v_minimo then
        raise exception 'Ese horario no cumple la anticipación mínima configurada';
      end if;
      if not public.agenda_slot_disponible_captacion(p_empresa_id, p_asesor_id, p_fecha, p_hora_inicio, v_hora_fin) then
        raise exception 'Ese horario ya no está disponible';
      end if;
    end if;
  else
    perform set_config('agenda.cruce_autorizado', 'on', true);
  end if;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, notas, creado_por,
    tipo_cita, titulo, direccion_libre, ciudad_libre,
    cobertura_id, tipo_inmueble_captacion, valor_estimado_captacion, mandato_exclusivo, origen_captacion,
    cruce_autorizado, cruce_autorizado_por, modalidad, enlace_virtual
  ) values (
    p_empresa_id, p_inmueble_id, p_asesor_id, p_fecha, p_hora_inicio, v_hora_fin,
    nullif(coalesce(p_cliente_nombre, ''), ''), coalesce(p_cliente_telefono, ''), coalesce(p_cliente_email, ''), p_notas, auth.uid(),
    p_tipo_cita, p_titulo, p_direccion_libre, p_ciudad_libre,
    p_cobertura_id, p_tipo_inmueble_captacion, p_valor_estimado_captacion, p_mandato_exclusivo, p_origen_captacion,
    v_forzar, case when v_forzar then auth.uid() end, coalesce(p_modalidad, 'presencial'), nullif(btrim(coalesce(p_enlace_virtual, '')), '')
  ) returning id into v_id;

  return v_id;
end;
$function$;
revoke all on function public.agenda_crear_cita_interna(uuid, uuid, date, time, uuid, text, text, text, text, text, text, text, text, integer, uuid, text, numeric, boolean, text, boolean, text, text) from public, anon;
grant execute on function public.agenda_crear_cita_interna(uuid, uuid, date, time, uuid, text, text, text, text, text, text, text, text, integer, uuid, text, numeric, boolean, text, boolean, text, text) to authenticated, service_role;

drop function if exists public.agenda_mover_cita(uuid, uuid, date, time);
create or replace function public.agenda_mover_cita(
  p_cita_id uuid, p_solicitante_asesor_id uuid, p_nueva_fecha date, p_nueva_hora_inicio time without time zone,
  p_forzar boolean default false
) returns void
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
  select * into v_cita from public.agenda_citas where id = p_cita_id;
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
revoke all on function public.agenda_mover_cita(uuid, uuid, date, time, boolean) from public, anon;
grant execute on function public.agenda_mover_cita(uuid, uuid, date, time, boolean) to authenticated, service_role;
