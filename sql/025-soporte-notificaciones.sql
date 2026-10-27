-- 025 · Soporte: notificaciones dentro de la app (campana), recordatorios y calificación desde la primera respuesta
-- Sobre sql/024. Qué agrega:
--   * agenda_notificaciones: avisos por usuario (campana de la app y de /soporte). Los crean TRIGGERS a partir de los mensajes y eventos
--     del ticket (no hay que acordarse de crearlos en cada función): respuesta de soporte, mensaje del usuario, ticket nuevo,
--     resuelto (invita a calificar), cerrado, responsable asignado, reapertura y calificación recibida.
--   * Recordatorio: si un ticket lleva 48 h «esperando al usuario» se le avisa una sola vez. Alerta de SLA: si no hay primera respuesta a
--     tiempo se avisa una vez a quien lo atiende (o a todo soporte y a los administradores de la empresa).
--   * Calificar la atención ya no exige que el ticket esté resuelto: basta con que soporte haya respondido (así el usuario no tiene que
--     «adivinar» cuándo puede calificar). La tasa de respuesta de la calificación se mide contra los tickets que ya tuvieron respuesta.
--   * agenda_ticket_mantenimiento() la puede correr cualquier usuario con sesión (es idempotente y solo aplica las reglas del tiempo);
--     la app la llama al cargar la campana, así no hace falta un cron.
-- Como siempre: la tabla no tiene políticas; el navegador solo usa las funciones agenda_notificaciones_*.

alter table public.agenda_tickets
  add column if not exists recordatorio_enviado_en timestamptz,
  add column if not exists sla_alertado_en timestamptz;

create table if not exists public.agenda_notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  empresa_id uuid references public.agenda_empresas(id) on delete cascade,
  ticket_id uuid references public.agenda_tickets(id) on delete cascade,
  tipo text not null check (tipo in ('respuesta', 'mensaje', 'nuevo', 'calificar', 'cerrado', 'asignado', 'reabierto', 'calificado', 'recordatorio', 'sla', 'estado')),
  titulo text not null,
  cuerpo text not null default '',
  creada_en timestamptz not null default now(),
  leida_en timestamptz
);
create index if not exists agenda_notificaciones_usuario_idx on public.agenda_notificaciones(usuario_id, creada_en desc);
create index if not exists agenda_notificaciones_pendientes_idx on public.agenda_notificaciones(usuario_id) where leida_en is null;
alter table public.agenda_notificaciones enable row level security;
revoke all on public.agenda_notificaciones from anon, authenticated;
grant select, insert, update, delete on public.agenda_notificaciones to service_role;

-- Quién atiende tickets de una empresa: sus administradores y el equipo de soporte de la plataforma.
create or replace function public.agenda_ticket_staff(p_empresa_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.usuario_id from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.rol = 'administrador' and m.activo
  union
  select s.usuario_id from public.agenda_soporte_usuarios s where s.activo
$$;
revoke all on function public.agenda_ticket_staff(uuid) from public, anon, authenticated;
grant execute on function public.agenda_ticket_staff(uuid) to service_role;

create or replace function public.agenda_notif_insertar(p_usuario uuid, p_t public.agenda_tickets, p_tipo text, p_titulo text, p_cuerpo text)
returns void language sql security definer set search_path = '' as $$
  insert into public.agenda_notificaciones (usuario_id, empresa_id, ticket_id, tipo, titulo, cuerpo)
  select p_usuario, p_t.empresa_id, p_t.id, p_tipo, p_titulo, left(coalesce(p_cuerpo, ''), 160) where p_usuario is not null
$$;
revoke all on function public.agenda_notif_insertar(uuid, public.agenda_tickets, text, text, text) from public, anon, authenticated;
grant execute on function public.agenda_notif_insertar(uuid, public.agenda_tickets, text, text, text) to service_role;

-- A quien atiende el ticket (o a todo el equipo si nadie lo atiende), menos a quien hizo la acción.
create or replace function public.agenda_notif_equipo(p_t public.agenda_tickets, p_excluir uuid, p_tipo text, p_titulo text, p_cuerpo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid;
begin
  if p_t.asignado_a is not null then
    if p_t.asignado_a is distinct from p_excluir then perform public.agenda_notif_insertar(p_t.asignado_a, p_t, p_tipo, p_titulo, p_cuerpo); end if;
  else
    for v_u in select * from public.agenda_ticket_staff(p_t.empresa_id) loop
      if v_u is distinct from p_excluir then perform public.agenda_notif_insertar(v_u, p_t, p_tipo, p_titulo, p_cuerpo); end if;
    end loop;
  end if;
end;
$$;
revoke all on function public.agenda_notif_equipo(public.agenda_tickets, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.agenda_notif_equipo(public.agenda_tickets, uuid, text, text, text) to service_role;

-- Mensajes del hilo → avisos.
create or replace function public.agenda_notif_desde_mensaje()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
begin
  select * into v_t from public.agenda_tickets where id = new.ticket_id;
  if not found then return new; end if;
  if new.autor_tipo in ('soporte', 'empresa') then
    if v_t.usuario_id is distinct from new.autor_id then
      perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'respuesta', 'Respondieron tu ticket #' || v_t.numero, new.texto);
    end if;
    update public.agenda_tickets set recordatorio_enviado_en = null where id = new.ticket_id and recordatorio_enviado_en is not null;
  else
    perform public.agenda_notif_equipo(v_t, new.autor_id, 'mensaje', 'Nuevo mensaje en el ticket #' || v_t.numero, new.texto);
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_notif_mensaje on public.agenda_ticket_mensajes;
create trigger agenda_notif_mensaje after insert on public.agenda_ticket_mensajes for each row execute function public.agenda_notif_desde_mensaje();

-- Eventos del ticket → avisos.
create or replace function public.agenda_notif_desde_evento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
  v_u uuid;
  v_nuevo text := new.detalle ->> 'a';
begin
  select * into v_t from public.agenda_tickets where id = new.ticket_id;
  if not found then return new; end if;
  if new.tipo = 'creado' then
    for v_u in select * from public.agenda_ticket_staff(v_t.empresa_id) loop
      if v_u is distinct from new.actor_id then perform public.agenda_notif_insertar(v_u, v_t, 'nuevo', 'Nuevo ticket #' || v_t.numero, v_t.titulo); end if;
    end loop;
  elsif new.tipo = 'estado' and v_t.usuario_id is distinct from new.actor_id then
    if v_nuevo = 'resuelto' then
      -- Si en la misma acción ya se avisó la respuesta, ese aviso se convierte en la invitación a calificar (una sola campanada).
      update public.agenda_notificaciones set tipo = 'calificar', titulo = 'Tu ticket #' || v_t.numero || ' quedó resuelto', cuerpo = 'Cuéntanos cómo te fue: califica la atención.', leida_en = null
       where id = (select n.id from public.agenda_notificaciones n
                    where n.ticket_id = v_t.id and n.usuario_id = v_t.usuario_id and n.tipo = 'respuesta' and n.creada_en > now() - interval '10 seconds'
                    order by n.creada_en desc limit 1);
      if not found then
        perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'calificar', 'Tu ticket #' || v_t.numero || ' quedó resuelto', 'Cuéntanos cómo te fue: califica la atención.');
      end if;
    elsif v_nuevo = 'cerrado' then
      perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'cerrado', 'Se cerró tu ticket #' || v_t.numero, 'Si el problema continúa, crea un ticket nuevo.');
    elsif v_nuevo in ('en_revision', 'descartado') then
      perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'estado', 'Tu ticket #' || v_t.numero || (case v_nuevo when 'en_revision' then ' está en revisión' else ' fue descartado' end), v_t.titulo);
    end if;
  elsif new.tipo = 'asignado' and coalesce(v_nuevo, '') <> '' and v_t.usuario_id is distinct from new.actor_id then
    perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'asignado', v_nuevo || ' atiende tu ticket #' || v_t.numero, v_t.titulo);
  elsif new.tipo = 'reabierto' then
    perform public.agenda_notif_equipo(v_t, new.actor_id, 'reabierto', 'Se reabrió el ticket #' || v_t.numero, v_t.titulo);
  elsif new.tipo = 'calificado' then
    perform public.agenda_notif_equipo(v_t, new.actor_id, 'calificado', 'Calificaron con ' || (new.detalle ->> 'puntos') || ' de 5 el ticket #' || v_t.numero, coalesce(nullif(v_t.calificacion_comentario, ''), v_t.titulo));
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_notif_evento on public.agenda_ticket_eventos;
create trigger agenda_notif_evento after insert on public.agenda_ticket_eventos for each row execute function public.agenda_notif_desde_evento();

-- ------------------------------------------------------------------ lo que usa el navegador
create or replace function public.agenda_notificaciones_mias(p_limite integer default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'no_leidas', (select count(*) from public.agenda_notificaciones n where n.usuario_id = auth.uid() and n.leida_en is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'titulo', x.titulo, 'cuerpo', x.cuerpo, 'ticket_id', x.ticket_id,
                                                          'empresa_id', x.empresa_id, 'creada_en', x.creada_en, 'leida', x.leida_en is not null) order by x.creada_en desc)
                         from (select * from public.agenda_notificaciones n where n.usuario_id = auth.uid() order by n.creada_en desc limit greatest(1, least(coalesce(p_limite, 30), 50))) x), '[]'::jsonb))
$$;
revoke all on function public.agenda_notificaciones_mias(integer) from public, anon;
grant execute on function public.agenda_notificaciones_mias(integer) to authenticated, service_role;

-- Marca como leídas: una (p_id), las de un ticket (p_ticket_id) o todas (sin parámetros).
create or replace function public.agenda_notificaciones_marcar(p_id uuid default null, p_ticket_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.agenda_notificaciones set leida_en = now()
   where usuario_id = auth.uid() and leida_en is null and (p_id is null or id = p_id) and (p_ticket_id is null or ticket_id = p_ticket_id)
$$;
revoke all on function public.agenda_notificaciones_marcar(uuid, uuid) from public, anon;
grant execute on function public.agenda_notificaciones_marcar(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ mantenimiento (reemplaza el de 024)
create or replace function public.agenda_ticket_mantenimiento()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cerrados integer;
  v_resueltos integer;
  v_recordados integer;
  v_alertados integer;
  v_t public.agenda_tickets%rowtype;
  v_u uuid;
begin
  if auth.uid() is null and current_user not in ('postgres', 'service_role') then raise exception 'Se necesita una sesión'; end if;
  -- Resuelto → cerrado a los 5 días.
  with c as (
    update public.agenda_tickets set estado = 'cerrado', actualizado_en = now()
     where estado = 'resuelto' and coalesce(resuelto_en, actualizado_en) < now() - interval '5 days'
     returning id),
  e as (insert into public.agenda_ticket_eventos (ticket_id, actor_nombre, tipo, detalle)
        select id, 'Sistema', 'estado', jsonb_build_object('de', 'resuelto', 'a', 'cerrado', 'auto', true) from c returning 1)
  select count(*) into v_cerrados from c;
  -- Esperando al usuario 7 días sin actividad → resuelto.
  with r as (
    update public.agenda_tickets set estado = 'resuelto', resuelto_en = now(), actualizado_en = now()
     where estado = 'en_espera' and ultima_actividad_en < now() - interval '7 days'
     returning id),
  e as (insert into public.agenda_ticket_eventos (ticket_id, actor_nombre, tipo, detalle)
        select id, 'Sistema', 'estado', jsonb_build_object('de', 'en_espera', 'a', 'resuelto', 'auto', true) from r returning 1)
  select count(*) into v_resueltos from r;
  -- Recordatorio único a las 48 h de espera.
  v_recordados := 0;
  for v_t in
    update public.agenda_tickets set recordatorio_enviado_en = now()
     where estado = 'en_espera' and recordatorio_enviado_en is null and ultima_actividad_en < now() - interval '48 hours' returning *
  loop
    perform public.agenda_notif_insertar(v_t.usuario_id, v_t, 'recordatorio', 'Te estamos esperando en el ticket #' || v_t.numero, 'Responde cuando puedas o márcalo como resuelto si ya quedó listo.');
    v_recordados := v_recordados + 1;
  end loop;
  -- Alerta de SLA: sin primera respuesta a tiempo (una sola vez).
  v_alertados := 0;
  for v_t in
    update public.agenda_tickets set sla_alertado_en = now()
     where estado in ('abierto', 'en_revision') and primera_respuesta_en is null and sla_alertado_en is null and vence_primera_en < now() returning *
  loop
    perform public.agenda_notif_equipo(v_t, null, 'sla', 'Ticket #' || v_t.numero || ' sin respuesta a tiempo', v_t.titulo);
    v_alertados := v_alertados + 1;
  end loop;
  -- Limpieza: avisos de más de 90 días.
  delete from public.agenda_notificaciones where creada_en < now() - interval '90 days';
  return jsonb_build_object('cerrados', v_cerrados, 'resueltos', v_resueltos, 'recordados', v_recordados, 'alertados', v_alertados);
end;
$$;
revoke all on function public.agenda_ticket_mantenimiento() from public, anon;
grant execute on function public.agenda_ticket_mantenimiento() to authenticated, service_role;

-- ------------------------------------------------------------------ calificar desde la primera respuesta (reemplaza el de 024)
create or replace function public.agenda_ticket_calificar(p_id uuid, p_puntos integer, p_comentario text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
begin
  select * into v_t from public.agenda_tickets where id = p_id for update;
  if not found or v_t.usuario_id is distinct from auth.uid() then raise exception 'Solo quien escribió el ticket puede calificarlo'; end if;
  if v_t.primera_respuesta_en is null and v_t.estado not in ('resuelto', 'cerrado') then raise exception 'Puedes calificar cuando soporte te haya respondido'; end if;
  if v_t.resuelto_en is not null and v_t.resuelto_en < now() - interval '28 days' then raise exception 'Ya pasó el plazo para calificar este ticket'; end if;
  if p_puntos is null or p_puntos < 1 or p_puntos > 5 then raise exception 'La calificación va de 1 a 5'; end if;
  update public.agenda_tickets
     set calificacion = p_puntos, calificacion_comentario = left(btrim(coalesce(p_comentario, '')), 1000), calificado_en = now(), actualizado_en = now()
   where id = p_id;
  perform public.agenda_ticket_evento(p_id, 'calificado', jsonb_build_object('puntos', p_puntos), v_t.usuario_nombre);
end;
$$;
revoke all on function public.agenda_ticket_calificar(uuid, integer, text) from public, anon;
grant execute on function public.agenda_ticket_calificar(uuid, integer, text) to authenticated, service_role;

-- ------------------------------------------------------------------ métricas (igual a 024, con la tasa de respuesta de la calificación corregida)
create or replace function public.agenda_ticket_metricas(p_empresa_id uuid default null, p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  v_soporte boolean := public.agenda_es_soporte();
  v_res jsonb;
begin
  if not v_soporte then
    if p_empresa_id is null or public.agenda_rol_actual(p_empresa_id) is distinct from 'administrador' then raise exception 'No tienes acceso a estas métricas'; end if;
  end if;
  with base as (select * from public.agenda_tickets t where p_empresa_id is null or t.empresa_id = p_empresa_id),
       per as (select * from base where creado_en >= v_desde)
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(p_dias, 30), 365)),
    'creados', (select count(*) from per),
    'resueltos', (select count(*) from base where resuelto_en >= v_desde),
    'pendientes', (select count(*) from base where estado in ('abierto', 'en_revision')),
    'en_espera', (select count(*) from base where estado = 'en_espera'),
    'sin_asignar', (select count(*) from base where estado in ('abierto', 'en_revision') and asignado_a is null),
    'vencidos', (select count(*) from base where estado in ('abierto', 'en_revision') and primera_respuesta_en is null and vence_primera_en < now()),
    'antiguos_7d', (select count(*) from base where estado in ('abierto', 'en_revision', 'en_espera') and creado_en < now() - interval '7 days'),
    'primera_respuesta_min', jsonb_build_object(
      'mediana', (select round((percentile_cont(0.5) within group (order by extract(epoch from primera_respuesta_en - creado_en) / 60))::numeric) from per where primera_respuesta_en is not null),
      'p90', (select round((percentile_cont(0.9) within group (order by extract(epoch from primera_respuesta_en - creado_en) / 60))::numeric) from per where primera_respuesta_en is not null),
      'n', (select count(*) from per where primera_respuesta_en is not null)),
    'resolucion_horas', jsonb_build_object(
      'mediana', (select round((percentile_cont(0.5) within group (order by extract(epoch from resuelto_en - creado_en) / 3600))::numeric, 1) from per where resuelto_en is not null),
      'p90', (select round((percentile_cont(0.9) within group (order by extract(epoch from resuelto_en - creado_en) / 3600))::numeric, 1) from per where resuelto_en is not null),
      'n', (select count(*) from per where resuelto_en is not null)),
    'sla_primera_pct', (select round(100.0 * count(*) filter (where primera_respuesta_en <= vence_primera_en)
                                       / nullif(count(*) filter (where primera_respuesta_en is not null or vence_primera_en < now()), 0)) from per),
    'reabiertos_pct', (select round(100.0 * count(*) filter (where reabierto_n > 0) / nullif(count(*) filter (where resuelto_en is not null or reabierto_n > 0), 0)) from per),
    'csat', jsonb_build_object(
      'n', (select count(*) from per where calificacion is not null),
      'promedio', (select round(avg(calificacion), 2) from per where calificacion is not null),
      'positivas_pct', (select round(100.0 * count(*) filter (where calificacion >= 4) / nullif(count(*), 0)) from per where calificacion is not null),
      'tasa_respuesta_pct', (select round(100.0 * count(*) filter (where calificacion is not null) / nullif(count(*) filter (where primera_respuesta_en is not null), 0)) from per),
      'distribucion', (select jsonb_build_object('1', count(*) filter (where calificacion = 1), '2', count(*) filter (where calificacion = 2), '3', count(*) filter (where calificacion = 3),
                                                 '4', count(*) filter (where calificacion = 4), '5', count(*) filter (where calificacion = 5)) from per)),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from (select tipo, count(*) n from per group by tipo) x), '{}'::jsonb),
    'por_prioridad', coalesce((select jsonb_object_agg(prioridad, n) from (select prioridad, count(*) n from per group by prioridad) x), '{}'::jsonb),
    'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from base group by estado) x), '{}'::jsonb),
    'por_empresa', case when p_empresa_id is null and v_soporte then coalesce((
        select jsonb_agg(jsonb_build_object('empresa', x.nombre, 'creados', x.creados, 'pendientes', x.pendientes) order by x.creados desc, x.pendientes desc)
          from (select e.nombre, count(*) filter (where t.creado_en >= v_desde) as creados, count(*) filter (where t.estado in ('abierto', 'en_revision', 'en_espera')) as pendientes
                  from public.agenda_tickets t join public.agenda_empresas e on e.id = t.empresa_id group by e.nombre
                having count(*) filter (where t.creado_en >= v_desde) > 0 or count(*) filter (where t.estado in ('abierto', 'en_revision', 'en_espera')) > 0) x), '[]'::jsonb) else '[]'::jsonb end
  ) into v_res;
  return v_res;
end;
$$;
revoke all on function public.agenda_ticket_metricas(uuid, integer) from public, anon;
grant execute on function public.agenda_ticket_metricas(uuid, integer) to authenticated, service_role;
