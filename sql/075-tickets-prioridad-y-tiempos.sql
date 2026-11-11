-- 075 · Tickets: quien escribe el ticket elige la prioridad (baja, media, alta) y el administrador define cuántas horas
-- tiene soporte para la primera respuesta según la prioridad. «Media» es el valor interno 'normal'; 'urgente' lo sigue
-- poniendo solo soporte. Antes los plazos eran fijos (2/8/24/48 h) dentro de agenda_ticket_sla_horas: esa función queda como respaldo.
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

alter table public.agenda_configuracion
  add column if not exists ticket_horas_baja integer not null default 48 check (ticket_horas_baja between 1 and 720),
  add column if not exists ticket_horas_normal integer not null default 24 check (ticket_horas_normal between 1 and 720),
  add column if not exists ticket_horas_alta integer not null default 8 check (ticket_horas_alta between 1 and 720),
  add column if not exists ticket_horas_urgente integer not null default 2 check (ticket_horas_urgente between 1 and 720);

-- Horas de primera respuesta de una empresa para una prioridad (si algo falta, los plazos de siempre).
create or replace function public.agenda_ticket_sla_empresa(p_empresa_id uuid, p_prioridad text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select case p_prioridad when 'urgente' then c.ticket_horas_urgente when 'alta' then c.ticket_horas_alta when 'baja' then c.ticket_horas_baja else c.ticket_horas_normal end
       from public.agenda_configuracion c where c.empresa_id = p_empresa_id),
    public.agenda_ticket_sla_horas(p_prioridad));
$function$;

-- Lo ven todos los miembros activos de la empresa (para decirle al usuario cuánto tardamos).
create or replace function public.agenda_ticket_sla_obtener(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo) then
    raise exception 'No perteneces a esta empresa';
  end if;
  return jsonb_build_object(
    'baja', public.agenda_ticket_sla_empresa(p_empresa_id, 'baja'),
    'normal', public.agenda_ticket_sla_empresa(p_empresa_id, 'normal'),
    'alta', public.agenda_ticket_sla_empresa(p_empresa_id, 'alta'),
    'urgente', public.agenda_ticket_sla_empresa(p_empresa_id, 'urgente'));
end;
$function$;

-- Solo el administrador de la empresa cambia los plazos. Los tickets ya abiertos y sin respuesta conservan su plazo.
create or replace function public.agenda_ticket_sla_guardar(p_empresa_id uuid, p_baja integer, p_normal integer, p_alta integer, p_urgente integer)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if public.agenda_rol_actual(p_empresa_id) is distinct from 'administrador' then
    raise exception 'Solo el administrador puede cambiar los tiempos de respuesta';
  end if;
  if least(p_baja, p_normal, p_alta, p_urgente) < 1 or greatest(p_baja, p_normal, p_alta, p_urgente) > 720 then
    raise exception 'Cada tiempo debe estar entre 1 y 720 horas';
  end if;
  update public.agenda_configuracion
     set ticket_horas_baja = p_baja, ticket_horas_normal = p_normal, ticket_horas_alta = p_alta, ticket_horas_urgente = p_urgente
   where empresa_id = p_empresa_id;
end;
$function$;

-- Crear el ticket con prioridad (se reemplaza la función de 5 parámetros por una con prioridad opcional: sin ella, «media»).
drop function if exists public.agenda_ticket_crear(uuid, text, text, text, text);
create or replace function public.agenda_ticket_crear(p_empresa_id uuid, p_tipo text, p_titulo text, p_descripcion text, p_pagina text default ''::text, p_prioridad text default 'normal'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_nombre text;
  v_id uuid;
  v_numero bigint;
  v_horas integer;
begin
  select m.nombre into v_nombre from public.agenda_miembros m
   where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo limit 1;
  if not found then raise exception 'No perteneces a esta empresa'; end if;
  if p_tipo not in ('error', 'mejora', 'duda') then raise exception 'Tipo de ticket no válido'; end if;
  if coalesce(p_prioridad, 'normal') not in ('baja', 'normal', 'alta') then raise exception 'Prioridad no válida'; end if;
  if length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escribe un título de al menos 3 letras'; end if;
  if (select count(*) from public.agenda_tickets t where t.usuario_id = auth.uid() and t.creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de tickets de hoy. Escríbele a tu administrador.';
  end if;
  v_horas := public.agenda_ticket_sla_empresa(p_empresa_id, coalesce(p_prioridad, 'normal'));
  insert into public.agenda_tickets (empresa_id, usuario_id, usuario_nombre, tipo, titulo, descripcion, pagina, prioridad, vence_primera_en)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), p_tipo, left(btrim(p_titulo), 140), left(coalesce(p_descripcion, ''), 4000), left(coalesce(p_pagina, ''), 120),
          coalesce(p_prioridad, 'normal'), now() + make_interval(hours => v_horas))
  returning id, numero into v_id, v_numero;
  perform public.agenda_ticket_evento(v_id, 'creado', '{}'::jsonb, coalesce(v_nombre, ''));
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'horas', v_horas);
end;
$function$;
revoke all on function public.agenda_ticket_crear(uuid, text, text, text, text, text) from public;
grant execute on function public.agenda_ticket_crear(uuid, text, text, text, text, text) to authenticated, service_role;

-- Cuando soporte cambia la prioridad, el plazo se recalcula con los tiempos de ESA empresa.
create or replace function public.agenda_ticket_gestionar(p_id uuid, p_estado text default null::text, p_prioridad text default null::text, p_asignacion text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_t public.agenda_tickets%rowtype;
  v_nombre text;
  v_nuevo text;
  v_reabre boolean;
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  select * into v_t from public.agenda_tickets where id = p_id for update;
  if not found then raise exception 'Ticket no encontrado'; end if;
  if p_estado is not null and p_estado not in ('abierto', 'en_revision', 'en_espera', 'resuelto', 'cerrado', 'descartado') then raise exception 'Estado no válido'; end if;
  if p_prioridad is not null and p_prioridad not in ('baja', 'normal', 'alta', 'urgente') then raise exception 'Prioridad no válida'; end if;
  if p_asignacion is not null and p_asignacion not in ('yo', 'nadie') then raise exception 'Asignación no válida'; end if;
  v_nombre := public.agenda_ticket_nombre(v_t.empresa_id);
  v_nuevo := coalesce(p_estado, v_t.estado);
  v_reabre := v_t.estado in ('resuelto', 'cerrado') and v_nuevo in ('abierto', 'en_revision', 'en_espera');
  update public.agenda_tickets
     set estado = v_nuevo,
         prioridad = coalesce(p_prioridad, prioridad),
         vence_primera_en = case when p_prioridad is not null and primera_respuesta_en is null
                                 then creado_en + make_interval(hours => public.agenda_ticket_sla_empresa(v_t.empresa_id, p_prioridad)) else vence_primera_en end,
         asignado_a = case p_asignacion when 'yo' then auth.uid() when 'nadie' then null else asignado_a end,
         asignado_nombre = case p_asignacion when 'yo' then v_nombre when 'nadie' then '' else asignado_nombre end,
         reabierto_n = reabierto_n + case when v_reabre then 1 else 0 end,
         resuelto_en = case when v_nuevo in ('resuelto', 'cerrado', 'descartado') then coalesce(resuelto_en, now()) else null end,
         actualizado_en = now(),
         ultima_actividad_en = now()
   where id = p_id;
  if v_nuevo <> v_t.estado then perform public.agenda_ticket_evento(p_id, 'estado', jsonb_build_object('de', v_t.estado, 'a', v_nuevo), v_nombre); end if;
  if v_reabre then perform public.agenda_ticket_evento(p_id, 'reabierto', '{}'::jsonb, v_nombre); end if;
  if p_prioridad is not null and p_prioridad <> v_t.prioridad then
    perform public.agenda_ticket_evento(p_id, 'prioridad', jsonb_build_object('de', v_t.prioridad, 'a', p_prioridad), v_nombre);
  end if;
  if p_asignacion is not null then
    perform public.agenda_ticket_evento(p_id, 'asignado', jsonb_build_object('a', case p_asignacion when 'yo' then v_nombre else '' end), v_nombre);
  end if;
end;
$function$;

revoke all on function public.agenda_ticket_sla_empresa(uuid, text) from public;
revoke all on function public.agenda_ticket_sla_obtener(uuid) from public;
revoke all on function public.agenda_ticket_sla_guardar(uuid, integer, integer, integer, integer) from public;
grant execute on function public.agenda_ticket_sla_empresa(uuid, text) to authenticated, service_role;
grant execute on function public.agenda_ticket_sla_obtener(uuid) to authenticated, service_role;
grant execute on function public.agenda_ticket_sla_guardar(uuid, integer, integer, integer, integer) to authenticated, service_role;
