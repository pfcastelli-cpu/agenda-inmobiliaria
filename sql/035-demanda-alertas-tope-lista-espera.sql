-- 035 · Demanda por inmueble: histórico del sistema anterior, tablero con alertas rápidas, tope de citas y lista de espera
-- Contexto: un inmueble recién publicado puede recibir decenas de pedidos de cita en un día mientras solo se acepta una radicación; eso llena la
-- agenda del equipo con un solo inmueble. Este script agrega:
--   1) agenda_demanda_eventos: citas pedidas en el sistema anterior (importadas de su calendario .ics) para medir la demanda. No es la agenda viva.
--   2) agenda_demanda_resumen: por inmueble, cuántos pedidos en 24 h / 48 h / 7 días y cuántas personas distintas (solo administradores).
--   3) Tope de citas activas por inmueble (ajuste de empresa y por inmueble) y lista de espera cuando se llena.
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/035-demanda-alertas-tope-lista-espera.sql

alter table public.agenda_configuracion
  add column if not exists demanda_umbral_info smallint not null default 3,
  add column if not exists demanda_umbral_urgente smallint not null default 5,
  add column if not exists demanda_tope_citas smallint; -- null = sin tope
alter table public.agenda_inmuebles add column if not exists tope_citas_activas smallint; -- null = usa el de la empresa

-- 1) Histórico de demanda --------------------------------------------------------------------------
create table if not exists public.agenda_demanda_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  uid text not null,
  numero_inmueble integer not null,
  fecha_cita date,
  hora_cita time,
  pedida_en timestamptz not null,
  cliente_nombre text,
  cliente_telefono text,
  cliente_email text,
  cancelada boolean not null default false,
  origen text not null default 'ics',
  creado_en timestamptz not null default now(),
  unique (empresa_id, uid)
);
create index if not exists agenda_demanda_eventos_inmueble_idx on public.agenda_demanda_eventos (empresa_id, numero_inmueble, pedida_en);
alter table public.agenda_demanda_eventos enable row level security;
drop policy if exists agenda_demanda_eventos_admin on public.agenda_demanda_eventos;
create policy agenda_demanda_eventos_admin on public.agenda_demanda_eventos for all to authenticated
  using (public.agenda_es_admin(empresa_id)) with check (public.agenda_es_admin(empresa_id));
grant select, insert, update, delete on public.agenda_demanda_eventos to authenticated, service_role;

-- 2) Resumen de demanda (administradores) ------------------------------------------------------------
create or replace function public.agenda_demanda_resumen(p_empresa_id uuid, p_dias integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_cfg record;
  v_res jsonb;
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 14), 90)));
begin
  -- Sin sesión de usuario (auth.uid() nulo) solo entra la service_role (la función avisar-demanda); un usuario debe ser administrador.
  if auth.uid() is not null and not public.agenda_es_admin(p_empresa_id) then
    raise exception 'Solo los administradores pueden ver la demanda.';
  end if;
  select demanda_umbral_info, demanda_umbral_urgente, demanda_tope_citas into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;

  with pedidos as (
    -- Citas pedidas en esta agenda (reales, de visita con cliente; las canceladas también son demanda).
    select i.numero_inmueble, c.creado_en as pedida_en,
           coalesce(nullif(regexp_replace(coalesce(c.cliente_telefono, ''), '\D', '', 'g'), ''), nullif(lower(c.cliente_email), ''), lower(c.cliente_nombre)) as persona
    from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = p_empresa_id and c.tipo_cita = 'visita_cliente' and not c.es_prueba and c.creado_en >= v_desde
    union all
    -- Citas pedidas en el sistema anterior (calendario importado).
    select e.numero_inmueble, e.pedida_en,
           coalesce(nullif(regexp_replace(coalesce(e.cliente_telefono, ''), '\D', '', 'g'), ''), nullif(lower(e.cliente_email), ''), lower(e.cliente_nombre))
    from public.agenda_demanda_eventos e
    where e.empresa_id = p_empresa_id and e.pedida_en >= v_desde
  ),
  por_inmueble as (
    select p.numero_inmueble,
           count(*) as pedidos,
           count(*) filter (where p.pedida_en >= now() - interval '24 hours') as pedidos_24h,
           count(*) filter (where p.pedida_en >= now() - interval '48 hours') as pedidos_48h,
           count(*) filter (where p.pedida_en >= now() - interval '7 days') as pedidos_7d,
           count(distinct p.persona) as personas,
           min(p.pedida_en) as primer_pedido, max(p.pedida_en) as ultimo_pedido
    from pedidos p group by p.numero_inmueble
  ),
  activas as (
    select i.numero_inmueble, count(*) as activas
    from public.agenda_citas c join public.agenda_inmuebles i on i.id = c.inmueble_id
    where c.empresa_id = p_empresa_id and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null
      and c.fecha >= (now() at time zone 'America/Bogota')::date and c.tipo_cita = 'visita_cliente'
    group by i.numero_inmueble
  )
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(p_dias, 14), 90)),
    'umbral_info', v_cfg.demanda_umbral_info, 'umbral_urgente', v_cfg.demanda_umbral_urgente, 'tope_empresa', v_cfg.demanda_tope_citas,
    'promedio_pedidos_por_inmueble', (select round(avg(pedidos)::numeric, 1) from por_inmueble),
    'inmuebles', coalesce((select jsonb_agg(jsonb_build_object(
        'numero_inmueble', pi.numero_inmueble, 'direccion', i.direccion, 'barrio', i.barrio, 'ciudad', i.ciudad, 'tipo_oferta', i.tipo_oferta,
        'valor_canon', i.valor_canon, 'valor_venta', i.valor_venta, 'estado_crm', i.estado_crm,
        'pedidos', pi.pedidos, 'pedidos_24h', pi.pedidos_24h, 'pedidos_48h', pi.pedidos_48h, 'pedidos_7d', pi.pedidos_7d, 'personas', pi.personas,
        'primer_pedido', pi.primer_pedido, 'ultimo_pedido', pi.ultimo_pedido,
        'activas', coalesce(a.activas, 0), 'tope', coalesce(i.tope_citas_activas, v_cfg.demanda_tope_citas)
      ) order by pi.pedidos_24h desc, pi.pedidos_48h desc, pi.pedidos desc)
      from por_inmueble pi
      left join public.agenda_inmuebles i on i.empresa_id = p_empresa_id and i.numero_inmueble = pi.numero_inmueble
      left join activas a on a.numero_inmueble = pi.numero_inmueble), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$;
revoke all on function public.agenda_demanda_resumen(uuid, integer) from public, anon;
grant execute on function public.agenda_demanda_resumen(uuid, integer) to authenticated, service_role;

-- 3) Tope de citas activas y lista de espera ---------------------------------------------------------
create table if not exists public.agenda_lista_espera (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  inmueble_id uuid not null references public.agenda_inmuebles(id) on delete cascade,
  nombre text not null,
  telefono text not null,
  email text not null,
  atendido boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists agenda_lista_espera_inmueble_idx on public.agenda_lista_espera (inmueble_id, creado_en);
alter table public.agenda_lista_espera enable row level security;
drop policy if exists agenda_lista_espera_equipo on public.agenda_lista_espera;
create policy agenda_lista_espera_equipo on public.agenda_lista_espera for all to authenticated
  using (exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_lista_espera.empresa_id and m.usuario_id = auth.uid() and m.activo))
  with check (exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_lista_espera.empresa_id and m.usuario_id = auth.uid() and m.activo));
grant select, insert, update, delete on public.agenda_lista_espera to authenticated, service_role;

-- ¿Ya se llenó la agenda de ese inmueble? (citas activas de visita desde hoy, sin contar las liberadas por reubicación)
create or replace function public.agenda_inmueble_llena(p_inmueble_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(i.tope_citas_activas, k.demanda_tope_citas) is not null
     and (select count(*) from public.agenda_citas c
           where c.inmueble_id = i.id and c.estado <> 'cancelada' and c.reubicacion_pendiente_desde is null and c.tipo_cita = 'visita_cliente'
             and c.fecha >= (now() at time zone 'America/Bogota')::date) >= coalesce(i.tope_citas_activas, k.demanda_tope_citas)
  from public.agenda_inmuebles i join public.agenda_configuracion k on k.empresa_id = i.empresa_id
  where i.id = p_inmueble_id;
$function$;
revoke all on function public.agenda_inmueble_llena(uuid) from public, anon;
grant execute on function public.agenda_inmueble_llena(uuid) to service_role, authenticated;

-- Pública: la página de reserva pregunta esto antes de mostrar horarios.
create or replace function public.agenda_agenda_llena_publica(p_numero_inmueble integer, p_empresa_slug text default null, p_host text default null)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_id uuid;
begin
  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select id into v_id from public.agenda_inmuebles where empresa_id = v_empresa and numero_inmueble = p_numero_inmueble;
  return coalesce(public.agenda_inmueble_llena(v_id), false);
end;
$function$;
revoke all on function public.agenda_agenda_llena_publica(integer, text, text) from public;
grant execute on function public.agenda_agenda_llena_publica(integer, text, text) to anon, authenticated, service_role;

create or replace function public.agenda_lista_espera_unirse(
  p_numero_inmueble integer, p_nombre text, p_telefono text, p_email text, p_empresa_slug text default null, p_host text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa uuid;
  v_inm uuid;
begin
  if p_nombre is null or length(trim(p_nombre)) < 2 then raise exception 'Escribe tu nombre completo'; end if;
  if p_email is null or p_email not like '%@%.%' then raise exception 'Escribe un correo electrónico válido.'; end if;
  if p_telefono is null or length(regexp_replace(p_telefono, '\D', '', 'g')) < 7 then raise exception 'Escribe un número de celular válido.'; end if;
  v_empresa := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select id into v_inm from public.agenda_inmuebles where empresa_id = v_empresa and numero_inmueble = p_numero_inmueble;
  if v_inm is null then raise exception 'Inmueble no encontrado'; end if;
  if exists (select 1 from public.agenda_lista_espera where inmueble_id = v_inm and lower(email) = lower(trim(p_email)) and not atendido) then return; end if;
  insert into public.agenda_lista_espera (empresa_id, inmueble_id, nombre, telefono, email) values (v_empresa, v_inm, trim(p_nombre), trim(p_telefono), lower(trim(p_email)));
end;
$function$;
revoke all on function public.agenda_lista_espera_unirse(integer, text, text, text, text, text) from public;
grant execute on function public.agenda_lista_espera_unirse(integer, text, text, text, text, text) to anon, authenticated, service_role;

-- La reserva pública respeta el tope (misma función de siempre, sql/029, con la revisión del tope dentro del candado del día).
create or replace function public.agenda_agendar_cita_publica(
  p_numero_inmueble integer, p_fecha date, p_hora_inicio time without time zone,
  p_cliente_nombre text, p_cliente_telefono text default ''::text, p_cliente_email text default ''::text,
  p_empresa_slug text default null::text, p_host text default null::text
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_empresa_id uuid;
  v_inmueble record;
  v_cfg record;
  v_hora_fin time;
  v_elegido record;
  v_id uuid;
begin
  if p_cliente_nombre is null or length(trim(p_cliente_nombre)) < 2 then
    raise exception 'Escribe tu nombre completo';
  end if;
  if p_cliente_email is null or trim(p_cliente_email) = '' or p_cliente_email not like '%@%.%' then
    raise exception 'Escribe un correo electrónico válido. Allí enviaremos los datos de tu asesor y de la visita.';
  end if;
  if p_cliente_telefono is null or length(regexp_replace(p_cliente_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Escribe un número de celular válido. Por ahí te contactará tu asesor.';
  end if;

  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);

  select * into v_inmueble from public.agenda_inmuebles
    where empresa_id = v_empresa_id and numero_inmueble = p_numero_inmueble and disponible;
  if not found then
    raise exception 'Inmueble no encontrado o no disponible';
  end if;

  select * into v_cfg from public.agenda_configuracion where empresa_id = v_empresa_id;
  v_hora_fin := p_hora_inicio + (v_cfg.duracion_visita_minutos || ' minutes')::interval;

  perform public.agenda_bloquear_dia(v_empresa_id, p_fecha);

  if coalesce(public.agenda_inmueble_llena(v_inmueble.id), false) then
    raise exception 'Este inmueble ya tiene la agenda completa. Déjanos tus datos en la lista de espera y te avisamos si se libera un turno.';
  end if;

  select s.asesor_id, s.hora_fin into v_elegido
    from public.agenda_sugerir_horarios(v_empresa_id, v_inmueble.id, p_fecha, 30) s
    where s.hora_inicio = p_hora_inicio
    order by s.prioridad
    limit 1;

  if v_elegido.asesor_id is null then
    raise exception 'Ese horario ya no está disponible. Por favor elige otro.';
  end if;

  insert into public.agenda_citas (
    empresa_id, inmueble_id, asesor_id, fecha, hora_inicio, hora_fin,
    cliente_nombre, cliente_telefono, cliente_email, tipo_cita, creado_por
  ) values (
    v_empresa_id, v_inmueble.id, v_elegido.asesor_id, p_fecha, p_hora_inicio, v_elegido.hora_fin,
    trim(p_cliente_nombre), trim(p_cliente_telefono), trim(p_cliente_email), 'visita_cliente', null
  ) returning id into v_id;

  return v_id;
end;
$function$;

-- 4) Avisos de demanda por correo (para no depender de que alguien abra el tablero) -------------------------------------
-- La función avisar-demanda corre cada hora, calcula la demanda y manda UN correo por inmueble y nivel (no repite en 24 h; sube de nivel sí avisa).
create table if not exists public.agenda_demanda_avisos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  numero_inmueble integer not null,
  nivel text not null check (nivel in ('atencion', 'urgente')),
  enviado_en timestamptz not null default now()
);
create index if not exists agenda_demanda_avisos_idx on public.agenda_demanda_avisos (empresa_id, numero_inmueble, enviado_en desc);
alter table public.agenda_demanda_avisos enable row level security;
grant select on public.agenda_demanda_avisos to authenticated;
grant select, insert, update, delete on public.agenda_demanda_avisos to service_role;
drop policy if exists agenda_demanda_avisos_admin on public.agenda_demanda_avisos;
create policy agenda_demanda_avisos_admin on public.agenda_demanda_avisos for select to authenticated using (public.agenda_es_admin(empresa_id));

-- Cron (ejecutar a mano DESPUÉS de desplegar avisar-demanda con --no-verify-jwt): cada hora en punto.
--   select cron.schedule('demanda-avisar', '0 * * * *', $job$
--     select net.http_post(
--       url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/avisar-demanda',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')),
--       body := '{}'::jsonb) $job$);
