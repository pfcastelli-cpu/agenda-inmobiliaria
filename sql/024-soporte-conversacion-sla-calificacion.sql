-- 024 · Soporte: conversación (hilo), prioridad, asignación, SLA, calificación, historial y métricas
-- Parte de los tickets de sql/022 y la consola de sql/023. Antes cada ticket tenía UNA sola «respuesta» que se sobrescribía; ahora:
--   * Hilo de mensajes públicos (agenda_ticket_mensajes) entre quien escribió, el administrador de la empresa y soporte.
--     Las notas internas siguen en su tabla aparte (agenda_ticket_notas): nunca llegan a la empresa.
--   * Estados: abierto → en_revision → en_espera («esperando tu respuesta») → resuelto → cerrado (+ descartado).
--     Si quien escribió responde, el ticket vuelve a «abierto» (reapertura). Resuelto se cierra solo a los 5 días;
--     en_espera sin respuesta durante 7 días pasa a resuelto (agenda_ticket_mantenimiento).
--   * Prioridad (baja/normal/alta/urgente), asignación («Tomar») y SLA de primera respuesta (horas corridas; ver agenda_ticket_sla_horas).
--   * Calificación 1–5 con comentario, solo de quien escribió, cuando el ticket está resuelto o cerrado.
--   * Historial inmutable (agenda_ticket_eventos): quién y cuándo cambió estado, prioridad o asignación, reaperturas y calificaciones.
--   * Métricas (agenda_ticket_metricas): primera respuesta y resolución (mediana y p90), pendientes, vencidos, reapertura, CSAT con N.
-- Como en 022/023: el navegador no escribe tablas; todo pasa por funciones SECURITY DEFINER que validan quién llama.
-- Orden de salida: aplicar este SQL ANTES de publicar el front (reemplaza agenda_ticket_actualizar y agenda_soporte_responder).

-- ------------------------------------------------------------------ columnas nuevas
alter table public.agenda_tickets drop constraint if exists agenda_tickets_estado_check;
alter table public.agenda_tickets add constraint agenda_tickets_estado_check
  check (estado in ('abierto', 'en_revision', 'en_espera', 'resuelto', 'cerrado', 'descartado'));

alter table public.agenda_tickets
  add column if not exists prioridad text not null default 'normal' check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  add column if not exists asignado_a uuid,
  add column if not exists asignado_nombre text not null default '',
  add column if not exists vence_primera_en timestamptz,
  add column if not exists primera_respuesta_en timestamptz,
  add column if not exists reabierto_n integer not null default 0,
  add column if not exists calificacion smallint check (calificacion between 1 and 5),
  add column if not exists calificacion_comentario text not null default '' check (length(calificacion_comentario) <= 1000),
  add column if not exists calificado_en timestamptz,
  add column if not exists ultima_actividad_en timestamptz not null default now();

-- Horas (corridas, no hábiles) para la primera respuesta según la prioridad. Ajustable aquí.
create or replace function public.agenda_ticket_sla_horas(p_prioridad text)
returns integer language sql immutable set search_path = '' as $$
  select case p_prioridad when 'urgente' then 2 when 'alta' then 8 when 'baja' then 48 else 24 end
$$;

update public.agenda_tickets set vence_primera_en = creado_en + make_interval(hours => public.agenda_ticket_sla_horas(prioridad)) where vence_primera_en is null;
update public.agenda_tickets set primera_respuesta_en = actualizado_en where primera_respuesta_en is null and respuesta <> '';
update public.agenda_tickets set ultima_actividad_en = actualizado_en;
create index if not exists agenda_tickets_asignado_idx on public.agenda_tickets(asignado_a) where asignado_a is not null;
create index if not exists agenda_tickets_estado_idx on public.agenda_tickets(estado, resuelto_en);

-- ------------------------------------------------------------------ tablas nuevas (sin políticas: solo funciones y servicio)
create table if not exists public.agenda_ticket_mensajes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.agenda_tickets(id) on delete cascade,
  autor_id uuid,
  autor_nombre text not null default '',
  autor_tipo text not null check (autor_tipo in ('solicitante', 'empresa', 'soporte')),
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_ticket_mensajes_idx on public.agenda_ticket_mensajes(ticket_id, creado_en);

create table if not exists public.agenda_ticket_eventos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.agenda_tickets(id) on delete cascade,
  actor_id uuid,
  actor_nombre text not null default '',
  tipo text not null check (tipo in ('creado', 'estado', 'prioridad', 'asignado', 'reabierto', 'calificado', 'nota_interna')),
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists agenda_ticket_eventos_idx on public.agenda_ticket_eventos(ticket_id, creado_en);

alter table public.agenda_ticket_mensajes enable row level security;
alter table public.agenda_ticket_eventos enable row level security;
revoke all on public.agenda_ticket_mensajes, public.agenda_ticket_eventos from anon, authenticated;
grant select, insert, update, delete on public.agenda_ticket_mensajes to service_role;
-- El historial es solo-anexar: ni el servicio lo edita ni lo borra (se borra únicamente en cascada con el ticket).
grant select, insert on public.agenda_ticket_eventos to service_role;

-- Lo que ya existía: la «respuesta» única pasa a ser el primer mensaje del hilo y cada ticket recibe su evento «creado».
insert into public.agenda_ticket_mensajes (ticket_id, autor_nombre, autor_tipo, texto, creado_en)
select t.id, 'Soporte', 'soporte', t.respuesta, t.actualizado_en from public.agenda_tickets t
 where t.respuesta <> '' and not exists (select 1 from public.agenda_ticket_mensajes m where m.ticket_id = t.id);
insert into public.agenda_ticket_eventos (ticket_id, actor_id, actor_nombre, tipo, creado_en)
select t.id, t.usuario_id, t.usuario_nombre, 'creado', t.creado_en from public.agenda_tickets t
 where not exists (select 1 from public.agenda_ticket_eventos e where e.ticket_id = t.id and e.tipo = 'creado');

-- ------------------------------------------------------------------ ayudas internas (no las llama el navegador)
-- Quién es quien llama frente a ese ticket. p_como = 'solicitante' obliga a actuar como quien lo escribió (si lo es),
-- útil cuando una misma persona es soporte y además escribió el ticket.
create or replace function public.agenda_ticket_rol(p_id uuid, p_como text default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_como = 'solicitante' and t.usuario_id = auth.uid() then 'solicitante'
    when public.agenda_es_soporte() then 'soporte'
    when t.usuario_id = auth.uid() then 'solicitante'
    when public.agenda_rol_actual(t.empresa_id) = 'administrador' then 'empresa'
  end from public.agenda_tickets t where t.id = p_id
$$;
revoke all on function public.agenda_ticket_rol(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_ticket_rol(uuid, text) to service_role;

create or replace function public.agenda_ticket_nombre(p_empresa_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.nombre from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid() and s.activo and public.agenda_es_soporte()),
    (select m.nombre from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() limit 1), '')
$$;
revoke all on function public.agenda_ticket_nombre(uuid) from public, anon, authenticated;
grant execute on function public.agenda_ticket_nombre(uuid) to service_role;

create or replace function public.agenda_ticket_evento(p_ticket_id uuid, p_tipo text, p_detalle jsonb default '{}'::jsonb, p_actor_nombre text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.agenda_ticket_eventos (ticket_id, actor_id, actor_nombre, tipo, detalle)
  values (p_ticket_id, auth.uid(), coalesce(p_actor_nombre, 'Sistema'), p_tipo, coalesce(p_detalle, '{}'::jsonb))
$$;
revoke all on function public.agenda_ticket_evento(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.agenda_ticket_evento(uuid, text, jsonb, text) to service_role;

-- ------------------------------------------------------------------ crear (reemplaza 022: ahora registra evento y vencimiento del SLA)
create or replace function public.agenda_ticket_crear(p_empresa_id uuid, p_tipo text, p_titulo text, p_descripcion text, p_pagina text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text;
  v_id uuid;
  v_numero bigint;
begin
  select m.nombre into v_nombre from public.agenda_miembros m
   where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid() and m.activo limit 1;
  if not found then raise exception 'No perteneces a esta empresa'; end if;
  if p_tipo not in ('error', 'mejora', 'duda') then raise exception 'Tipo de ticket no válido'; end if;
  if length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escribe un título de al menos 3 letras'; end if;
  if (select count(*) from public.agenda_tickets t where t.usuario_id = auth.uid() and t.creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de tickets de hoy. Escríbele a tu administrador.';
  end if;
  insert into public.agenda_tickets (empresa_id, usuario_id, usuario_nombre, tipo, titulo, descripcion, pagina, vence_primera_en)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), p_tipo, left(btrim(p_titulo), 140), left(coalesce(p_descripcion, ''), 4000), left(coalesce(p_pagina, ''), 120),
          now() + make_interval(hours => public.agenda_ticket_sla_horas('normal')))
  returning id, numero into v_id, v_numero;
  perform public.agenda_ticket_evento(v_id, 'creado', '{}'::jsonb, coalesce(v_nombre, ''));
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;
revoke all on function public.agenda_ticket_crear(uuid, text, text, text, text) from public, anon;
grant execute on function public.agenda_ticket_crear(uuid, text, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ leer la conversación completa de un ticket
-- Quien escribió y el administrador ven mensajes y eventos públicos; las notas internas solo las ve soporte.
create or replace function public.agenda_ticket_detalle(p_id uuid, p_como text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rol text := public.agenda_ticket_rol(p_id, p_como);
begin
  if v_rol is null then raise exception 'No tienes acceso a este ticket'; end if;
  return jsonb_build_object(
    'rol', v_rol,
    'mensajes', coalesce((select jsonb_agg(jsonb_build_object('autor', m.autor_nombre, 'tipo', m.autor_tipo, 'texto', m.texto, 'creado_en', m.creado_en) order by m.creado_en)
                            from public.agenda_ticket_mensajes m where m.ticket_id = p_id), '[]'::jsonb),
    'notas', case when v_rol = 'soporte' then coalesce((select jsonb_agg(jsonb_build_object('autor', n.autor_nombre, 'texto', n.texto, 'creado_en', n.creado_en) order by n.creado_en)
                            from public.agenda_ticket_notas n where n.ticket_id = p_id), '[]'::jsonb) else '[]'::jsonb end,
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('actor', e.actor_nombre, 'tipo', e.tipo, 'detalle', e.detalle, 'creado_en', e.creado_en) order by e.creado_en)
                            from public.agenda_ticket_eventos e where e.ticket_id = p_id and e.tipo <> 'creado' and (v_rol = 'soporte' or e.tipo <> 'nota_interna')), '[]'::jsonb));
end;
$$;
revoke all on function public.agenda_ticket_detalle(uuid, text) from public, anon;
grant execute on function public.agenda_ticket_detalle(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ responder en el hilo
-- Quien escribió: su mensaje reabre el ticket si estaba «en espera» o «resuelto»; también puede marcarlo resuelto (p_estado = 'resuelto').
-- Soporte / administrador: el mensaje llega por correo a quien escribió; por defecto el ticket queda «en_espera» (esperando su respuesta).
create or replace function public.agenda_ticket_responder(p_id uuid, p_texto text default null, p_estado text default null, p_como text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
  v_rol text;
  v_nombre text;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_nuevo text;
  v_reabre boolean;
begin
  select * into v_t from public.agenda_tickets where id = p_id for update;
  if not found then raise exception 'Ticket no encontrado'; end if;
  v_rol := public.agenda_ticket_rol(p_id, p_como);
  if v_rol is null then raise exception 'No tienes acceso a este ticket'; end if;
  if v_texto = '' and p_estado is null then raise exception 'Escribe un mensaje'; end if;
  if length(v_texto) > 4000 then raise exception 'El mensaje es demasiado largo (máximo 4000 letras)'; end if;
  v_nombre := public.agenda_ticket_nombre(v_t.empresa_id);

  if v_rol = 'solicitante' then
    if v_t.estado in ('cerrado', 'descartado') then raise exception 'Este ticket ya está cerrado. Crea uno nuevo si el problema continúa.'; end if;
    if p_estado is not null and p_estado <> 'resuelto' then raise exception 'Estado no permitido'; end if;
    v_nuevo := case when p_estado = 'resuelto' then 'resuelto' when v_t.estado in ('en_espera', 'resuelto') then 'abierto' else v_t.estado end;
  else
    if p_estado is not null and p_estado not in ('abierto', 'en_revision', 'en_espera', 'resuelto', 'cerrado', 'descartado') then raise exception 'Estado no válido'; end if;
    v_nuevo := coalesce(p_estado, case when v_texto <> '' and v_t.estado in ('abierto', 'en_revision') then 'en_espera' else v_t.estado end);
  end if;
  v_reabre := v_t.estado in ('resuelto', 'cerrado') and v_nuevo in ('abierto', 'en_revision', 'en_espera');

  if v_texto <> '' then
    insert into public.agenda_ticket_mensajes (ticket_id, autor_id, autor_nombre, autor_tipo, texto)
    values (p_id, auth.uid(), v_nombre, case v_rol when 'solicitante' then 'solicitante' when 'soporte' then 'soporte' else 'empresa' end, v_texto);
  end if;
  update public.agenda_tickets
     set estado = v_nuevo,
         actualizado_en = now(),
         ultima_actividad_en = now(),
         respuesta = case when v_rol <> 'solicitante' and v_texto <> '' then left(v_texto, 4000) else respuesta end,
         primera_respuesta_en = case when v_rol <> 'solicitante' and v_texto <> '' then coalesce(primera_respuesta_en, now()) else primera_respuesta_en end,
         asignado_a = case when v_rol = 'soporte' and asignado_a is null then auth.uid() else asignado_a end,
         asignado_nombre = case when v_rol = 'soporte' and asignado_a is null then v_nombre else asignado_nombre end,
         reabierto_n = reabierto_n + case when v_reabre then 1 else 0 end,
         resuelto_en = case when v_nuevo in ('resuelto', 'cerrado', 'descartado') then coalesce(resuelto_en, now()) else null end
   where id = p_id;
  if v_nuevo <> v_t.estado then
    perform public.agenda_ticket_evento(p_id, 'estado', jsonb_build_object('de', v_t.estado, 'a', v_nuevo), v_nombre);
  end if;
  if v_reabre then perform public.agenda_ticket_evento(p_id, 'reabierto', '{}'::jsonb, v_nombre); end if;
  if v_rol = 'soporte' then
    insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
    values (v_t.empresa_id, auth.uid(), v_nombre, 'soporte', 'ticket_respondido', jsonb_build_object('ticket', v_t.numero, 'estado', v_nuevo));
  end if;
  return jsonb_build_object('estado', v_nuevo, 'rol', v_rol, 'con_mensaje', v_texto <> '');
end;
$$;
revoke all on function public.agenda_ticket_responder(uuid, text, text, text) from public, anon;
grant execute on function public.agenda_ticket_responder(uuid, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ gestionar (solo soporte): estado, prioridad y asignación
-- p_asignacion: 'yo' = tomar el ticket, 'nadie' = soltarlo.
create or replace function public.agenda_ticket_gestionar(p_id uuid, p_estado text default null, p_prioridad text default null, p_asignacion text default null)
returns void language plpgsql security definer set search_path = '' as $$
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
                                 then creado_en + make_interval(hours => public.agenda_ticket_sla_horas(p_prioridad)) else vence_primera_en end,
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
$$;
revoke all on function public.agenda_ticket_gestionar(uuid, text, text, text) from public, anon;
grant execute on function public.agenda_ticket_gestionar(uuid, text, text, text) to authenticated, service_role;

-- Nota interna (solo soporte la ve).
create or replace function public.agenda_ticket_nota_agregar(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
  v_nombre text;
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  if length(btrim(coalesce(p_texto, ''))) < 1 then raise exception 'Escribe la nota'; end if;
  select * into v_t from public.agenda_tickets where id = p_id;
  if not found then raise exception 'Ticket no encontrado'; end if;
  v_nombre := public.agenda_ticket_nombre(v_t.empresa_id);
  insert into public.agenda_ticket_notas (ticket_id, autor_id, autor_nombre, texto) values (p_id, auth.uid(), v_nombre, left(btrim(p_texto), 4000));
  perform public.agenda_ticket_evento(p_id, 'nota_interna', '{}'::jsonb, v_nombre);
end;
$$;
revoke all on function public.agenda_ticket_nota_agregar(uuid, text) from public, anon;
grant execute on function public.agenda_ticket_nota_agregar(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ calificar (solo quien escribió; ticket resuelto o cerrado; se puede cambiar 28 días)
create or replace function public.agenda_ticket_calificar(p_id uuid, p_puntos integer, p_comentario text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
begin
  select * into v_t from public.agenda_tickets where id = p_id for update;
  if not found or v_t.usuario_id is distinct from auth.uid() then raise exception 'Solo quien escribió el ticket puede calificarlo'; end if;
  if v_t.estado not in ('resuelto', 'cerrado') then raise exception 'Puedes calificar cuando el ticket esté resuelto'; end if;
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

-- ------------------------------------------------------------------ cierre automático
-- Resuelto → cerrado a los 5 días. En espera del cliente sin actividad 7 días → resuelto. Lo corre la consola de soporte al abrirse
-- (o un cron: ver al final). Reglas iniciales sacadas de la práctica de otros sistemas de soporte; se pueden cambiar aquí.
create or replace function public.agenda_ticket_mantenimiento()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cerrados integer;
  v_resueltos integer;
begin
  if auth.uid() is not null and not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  with c as (
    update public.agenda_tickets set estado = 'cerrado', actualizado_en = now()
     where estado = 'resuelto' and coalesce(resuelto_en, actualizado_en) < now() - interval '5 days'
     returning id),
  e as (insert into public.agenda_ticket_eventos (ticket_id, actor_nombre, tipo, detalle)
        select id, 'Sistema', 'estado', jsonb_build_object('de', 'resuelto', 'a', 'cerrado', 'auto', true) from c returning 1)
  select count(*) into v_cerrados from c;
  with r as (
    update public.agenda_tickets set estado = 'resuelto', resuelto_en = now(), actualizado_en = now()
     where estado = 'en_espera' and ultima_actividad_en < now() - interval '7 days'
     returning id),
  e as (insert into public.agenda_ticket_eventos (ticket_id, actor_nombre, tipo, detalle)
        select id, 'Sistema', 'estado', jsonb_build_object('de', 'en_espera', 'a', 'resuelto', 'auto', true) from r returning 1)
  select count(*) into v_resueltos from r;
  return jsonb_build_object('cerrados', v_cerrados, 'resueltos', v_resueltos);
end;
$$;
revoke all on function public.agenda_ticket_mantenimiento() from public, anon;
grant execute on function public.agenda_ticket_mantenimiento() to authenticated, service_role;
-- Opcional (si la extensión pg_cron está activa): select cron.schedule('tickets-mantenimiento', '15 * * * *', 'select public.agenda_ticket_mantenimiento()');

-- ------------------------------------------------------------------ lista de soporte (reemplaza la de 023)
drop function if exists public.agenda_soporte_tickets(text, uuid);
create or replace function public.agenda_soporte_tickets(p_estado text default null, p_empresa_id uuid default null, p_asignacion text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'numero', q.numero, 'empresa_id', q.empresa_id, 'empresa_nombre', q.empresa_nombre,
             'usuario_nombre', q.usuario_nombre, 'tipo', q.tipo, 'titulo', q.titulo, 'descripcion', q.descripcion, 'pagina', q.pagina,
             'estado', q.estado, 'prioridad', q.prioridad, 'asignado_a', q.asignado_a, 'asignado_nombre', q.asignado_nombre,
             'soy_asignado', q.asignado_a = auth.uid(), 'creado_en', q.creado_en, 'actualizado_en', q.actualizado_en,
             'vence_primera_en', q.vence_primera_en, 'primera_respuesta_en', q.primera_respuesta_en, 'reabierto_n', q.reabierto_n,
             'calificacion', q.calificacion, 'calificacion_comentario', q.calificacion_comentario,
             'acceso_hasta', public.agenda_soporte_acceso_vigente(q.empresa_id), 'notas', q.notas, 'mensajes', q.mensajes)
           order by q.orden, q.prio desc, case when q.orden <= 1 then extract(epoch from q.creado_en) else -extract(epoch from q.creado_en) end)
    from (
      select t.*, e.nombre as empresa_nombre,
             case when t.estado in ('abierto', 'en_revision') then 0 when t.estado = 'en_espera' then 1 else 2 end as orden,
             case t.prioridad when 'urgente' then 3 when 'alta' then 2 when 'normal' then 1 else 0 end as prio,
             (select count(*) from public.agenda_ticket_notas n where n.ticket_id = t.id) as notas,
             (select count(*) from public.agenda_ticket_mensajes m where m.ticket_id = t.id) as mensajes
        from public.agenda_tickets t join public.agenda_empresas e on e.id = t.empresa_id
       where (p_estado is null or p_estado = 'todos' or (p_estado = 'abiertos' and t.estado in ('abierto', 'en_revision')) or t.estado = p_estado)
         and (p_empresa_id is null or t.empresa_id = p_empresa_id)
         and (p_asignacion is null or (p_asignacion = 'mios' and t.asignado_a = auth.uid()) or (p_asignacion = 'sin_asignar' and t.asignado_a is null))
       order by t.creado_en desc limit 300) q), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_soporte_tickets(text, uuid, text) from public, anon;
grant execute on function public.agenda_soporte_tickets(text, uuid, text) to authenticated, service_role;

-- Las dos funciones antiguas dejaban cambiar el estado sin historial; ya no se usan.
drop function if exists public.agenda_soporte_responder(uuid, text, text, text);
drop function if exists public.agenda_ticket_actualizar(uuid, text, text);

-- ------------------------------------------------------------------ métricas
-- Soporte: de todas las empresas o de una. Administrador de empresa: solo la suya (p_empresa_id obligatorio).
-- Tiempos en horas/minutos corridos. Mediana y p90 (no promedio). Los tickets nuevos del periodo p_dias; los pendientes son los de hoy.
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
      'tasa_respuesta_pct', (select round(100.0 * count(*) filter (where calificacion is not null) / nullif(count(*) filter (where estado in ('resuelto', 'cerrado')), 0)) from per),
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
