-- 023 · Soporte de plataforma: consola /soporte para resolverles problemas a TODAS las empresas
-- Quién es quién:
--   * Usuarios de soporte (agenda_soporte_usuarios): personas del equipo de la plataforma, SIN pertenecer a ninguna empresa. Se crean a mano
--     (ver docs/SOPORTE-PLATAFORMA.md). Ven los tickets de todas las empresas, los responden, los cierran y dejan notas internas.
--   * Acceso de ayuda temporal (agenda_soporte_accesos): el ADMINISTRADOR de una empresa lo otorga por 1 a 168 horas y lo puede revocar.
--     Mientras está vigente, soporte puede abrir un «diagnóstico» de SOLO LECTURA de esa empresa (configuración sin secretos, conteos,
--     últimos correos y errores). Nunca ve contraseñas, ni puede entrar como un usuario de la empresa ni cambiar sus datos.
--   * Auditoría (agenda_soporte_auditoria): todo lo que soporte hace y todo acceso otorgado/revocado queda registrado y la empresa puede verlo.
-- Todo se hace por funciones SECURITY DEFINER que validan quién llama; el navegador no lee estas tablas directamente (sin políticas).

create table if not exists public.agenda_soporte_usuarios (
  usuario_id uuid primary key,
  nombre text not null default '',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create table if not exists public.agenda_soporte_accesos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  otorgado_por uuid not null,
  otorgado_en timestamptz not null default now(),
  vence_en timestamptz not null,
  revocado_en timestamptz
);
create index if not exists agenda_soporte_accesos_idx on public.agenda_soporte_accesos(empresa_id, vence_en desc);
create table if not exists public.agenda_soporte_auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.agenda_empresas(id) on delete cascade,
  actor_id uuid not null,
  actor_nombre text not null default '',
  actor_tipo text not null check (actor_tipo in ('empresa', 'soporte')),
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists agenda_soporte_auditoria_idx on public.agenda_soporte_auditoria(empresa_id, creado_en desc);
create table if not exists public.agenda_ticket_notas (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.agenda_tickets(id) on delete cascade,
  autor_id uuid not null,
  autor_nombre text not null default '',
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_ticket_notas_idx on public.agenda_ticket_notas(ticket_id, creado_en);

-- Sin políticas: ningún usuario del navegador lee ni escribe estas tablas directamente; solo las funciones de abajo (y el servicio).
alter table public.agenda_soporte_usuarios enable row level security;
alter table public.agenda_soporte_accesos enable row level security;
alter table public.agenda_soporte_auditoria enable row level security;
alter table public.agenda_ticket_notas enable row level security;
revoke all on public.agenda_soporte_usuarios, public.agenda_soporte_accesos, public.agenda_soporte_auditoria, public.agenda_ticket_notas from anon, authenticated;
grant select, insert, update, delete on public.agenda_soporte_usuarios, public.agenda_soporte_accesos, public.agenda_soporte_auditoria, public.agenda_ticket_notas to service_role;

create or replace function public.agenda_es_soporte()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid() and s.activo)
$$;
revoke all on function public.agenda_es_soporte() from public, anon;
grant execute on function public.agenda_es_soporte() to authenticated, service_role;

create or replace function public.agenda_soporte_yo()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('es_soporte', exists (select 1 from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid() and s.activo),
                            'nombre', coalesce((select s.nombre from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid() and s.activo), ''))
$$;
revoke all on function public.agenda_soporte_yo() from public, anon;
grant execute on function public.agenda_soporte_yo() to authenticated, service_role;

-- ¿Esta empresa tiene un acceso de ayuda vigente?
create or replace function public.agenda_soporte_acceso_vigente(p_empresa_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(a.vence_en) from public.agenda_soporte_accesos a
   where a.empresa_id = p_empresa_id and a.revocado_en is null and a.vence_en > now()
$$;
revoke all on function public.agenda_soporte_acceso_vigente(uuid) from public, anon, authenticated;
grant execute on function public.agenda_soporte_acceso_vigente(uuid) to service_role;

-- ------------------------------------------------------------------ lado SOPORTE
create or replace function public.agenda_soporte_empresas()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre,
            'acceso_hasta', public.agenda_soporte_acceso_vigente(e.id),
            'tickets_abiertos', (select count(*) from public.agenda_tickets t where t.empresa_id = e.id and t.estado in ('abierto', 'en_revision'))) order by e.nombre)
          from public.agenda_empresas e), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_soporte_empresas() from public, anon;
grant execute on function public.agenda_soporte_empresas() to authenticated, service_role;

create or replace function public.agenda_soporte_tickets(p_estado text default null, p_empresa_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'orden')::int, (x ->> 'creado_en') desc) from (
      select jsonb_build_object('id', t.id, 'numero', t.numero, 'empresa_id', t.empresa_id, 'empresa_nombre', e.nombre,
               'usuario_nombre', t.usuario_nombre, 'tipo', t.tipo, 'titulo', t.titulo, 'descripcion', t.descripcion, 'pagina', t.pagina,
               'estado', t.estado, 'respuesta', t.respuesta, 'creado_en', t.creado_en, 'actualizado_en', t.actualizado_en,
               'acceso_hasta', public.agenda_soporte_acceso_vigente(t.empresa_id),
               'notas', (select count(*) from public.agenda_ticket_notas n where n.ticket_id = t.id),
               'orden', case when t.estado in ('abierto', 'en_revision') then 0 else 1 end) as x
        from public.agenda_tickets t join public.agenda_empresas e on e.id = t.empresa_id
       where (p_estado is null or p_estado = 'todos' or (p_estado = 'abiertos' and t.estado in ('abierto', 'en_revision')) or t.estado = p_estado)
         and (p_empresa_id is null or t.empresa_id = p_empresa_id)
       order by t.creado_en desc limit 300) q), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_soporte_tickets(text, uuid) from public, anon;
grant execute on function public.agenda_soporte_tickets(text, uuid) to authenticated, service_role;

create or replace function public.agenda_soporte_notas(p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('autor', n.autor_nombre, 'texto', n.texto, 'creado_en', n.creado_en) order by n.creado_en)
                     from public.agenda_ticket_notas n where n.ticket_id = p_ticket_id), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_soporte_notas(uuid) from public, anon;
grant execute on function public.agenda_soporte_notas(uuid) to authenticated, service_role;

-- Responder / cerrar un ticket (la respuesta le llega a quien lo escribió) y, opcionalmente, dejar una nota interna.
create or replace function public.agenda_soporte_responder(p_ticket_id uuid, p_estado text, p_respuesta text default null, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
  v_nombre text;
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  if p_estado not in ('abierto', 'en_revision', 'resuelto', 'descartado') then raise exception 'Estado no válido'; end if;
  select * into v_t from public.agenda_tickets where id = p_ticket_id;
  if not found then raise exception 'Ticket no encontrado'; end if;
  select s.nombre into v_nombre from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid();
  update public.agenda_tickets
     set estado = p_estado,
         respuesta = case when p_respuesta is null then respuesta else left(btrim(p_respuesta), 4000) end,
         actualizado_en = now(),
         resuelto_en = case when p_estado in ('resuelto', 'descartado') then coalesce(resuelto_en, now()) else null end
   where id = p_ticket_id;
  if p_nota is not null and length(btrim(p_nota)) > 0 then
    insert into public.agenda_ticket_notas (ticket_id, autor_id, autor_nombre, texto) values (p_ticket_id, auth.uid(), coalesce(v_nombre, ''), left(btrim(p_nota), 4000));
  end if;
  insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
  values (v_t.empresa_id, auth.uid(), coalesce(v_nombre, ''), 'soporte', 'ticket_respondido', jsonb_build_object('ticket', v_t.numero, 'estado', p_estado));
end;
$$;
revoke all on function public.agenda_soporte_responder(uuid, text, text, text) from public, anon;
grant execute on function public.agenda_soporte_responder(uuid, text, text, text) to authenticated, service_role;

-- Diagnóstico de SOLO LECTURA. Exige un acceso de ayuda vigente de esa empresa. Sin secretos ni correos de personas.
create or replace function public.agenda_soporte_diagnostico(p_empresa_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text;
  v_hasta timestamptz;
  v_cfg record;
  v_res jsonb;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.agenda_es_soporte() then raise exception 'No tienes acceso de soporte'; end if;
  v_hasta := public.agenda_soporte_acceso_vigente(p_empresa_id);
  if v_hasta is null then raise exception 'La empresa no ha dado acceso de ayuda (o ya venció). Pídele a su administrador que lo active en Soporte.'; end if;
  select s.nombre into v_nombre from public.agenda_soporte_usuarios s where s.usuario_id = auth.uid();
  select * into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  v_res := jsonb_build_object(
    'acceso_hasta', v_hasta,
    'empresa', (select jsonb_build_object('nombre', e.nombre, 'slug', e.slug) from public.agenda_empresas e where e.id = p_empresa_id),
    'configuracion', jsonb_build_object(
      'correo_configurado', coalesce(v_cfg.correo_smtp_host, '') <> '' and v_cfg.correo_smtp_password_secret_id is not null,
      'modo_pruebas', v_cfg.correo_modo_pruebas, 'encuesta_automatica', v_cfg.encuesta_automatica,
      'encuesta_minutos_despues', v_cfg.encuesta_minutos_despues, 'dominio_publico', v_cfg.dominio_publico),
    'conteos', jsonb_build_object(
      'asesores_activos', (select count(*) from public.agenda_asesores a where a.empresa_id = p_empresa_id and a.activo),
      'inmuebles', (select count(*) from public.agenda_inmuebles i where i.empresa_id = p_empresa_id),
      'inmuebles_disponibles', (select count(*) from public.agenda_inmuebles i where i.empresa_id = p_empresa_id and i.disponible),
      'citas_hoy', (select count(*) from public.agenda_citas c where c.empresa_id = p_empresa_id and c.fecha = v_hoy and c.estado <> 'cancelada'),
      'citas_proximos_7_dias', (select count(*) from public.agenda_citas c where c.empresa_id = p_empresa_id and c.fecha between v_hoy and v_hoy + 7 and c.estado <> 'cancelada'),
      'pendientes_abiertos', (select count(*) from public.agenda_pendientes p where p.empresa_id = p_empresa_id and p.estado in ('abierto', 'en_proceso'))),
    'correos_recientes', coalesce((select jsonb_agg(jsonb_build_object('creado_en', l.creado_en, 'tipo', l.destinatario_tipo, 'estado', l.estado,
         'asunto', l.asunto, 'error', left(regexp_replace(coalesce(l.detalle_error, ''), '[[:alnum:]._%+-]+@[[:alnum:].-]+', '***@***', 'g'), 300), 'modo_pruebas', l.modo_pruebas) order by l.creado_en desc)
       from (select * from public.agenda_correos_log where empresa_id = p_empresa_id order by creado_en desc limit 15) l), '[]'::jsonb),
    'cargas_portales', coalesce((select jsonb_agg(jsonb_build_object('portal', c.portal, 'cargado_en', c.cargado_en, 'total_activos', c.total_activos))
       from (select distinct on (portal) * from public.agenda_portales_cargas where empresa_id = p_empresa_id order by portal, cargado_en desc) c), '[]'::jsonb),
    'tickets_recientes', coalesce((select jsonb_agg(jsonb_build_object('numero', t.numero, 'titulo', t.titulo, 'estado', t.estado, 'creado_en', t.creado_en) order by t.creado_en desc)
       from (select * from public.agenda_tickets where empresa_id = p_empresa_id order by creado_en desc limit 5) t), '[]'::jsonb));
  insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), 'soporte', 'diagnostico_consultado', '{}'::jsonb);
  return v_res;
end;
$$;
revoke all on function public.agenda_soporte_diagnostico(uuid) from public, anon;
grant execute on function public.agenda_soporte_diagnostico(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ lado EMPRESA (solo su administrador)
create or replace function public.agenda_soporte_acceso_otorgar(p_empresa_id uuid, p_horas integer)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text;
  v_vence timestamptz;
begin
  if public.agenda_rol_actual(p_empresa_id) is distinct from 'administrador' then raise exception 'Solo el administrador puede dar acceso de ayuda'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 168 then raise exception 'El acceso puede durar de 1 a 168 horas'; end if;
  select m.nombre into v_nombre from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid();
  update public.agenda_soporte_accesos set revocado_en = now() where empresa_id = p_empresa_id and revocado_en is null and vence_en > now();
  v_vence := now() + make_interval(hours => p_horas);
  insert into public.agenda_soporte_accesos (empresa_id, otorgado_por, vence_en) values (p_empresa_id, auth.uid(), v_vence);
  insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), 'empresa', 'acceso_otorgado', jsonb_build_object('horas', p_horas, 'vence_en', v_vence));
  return v_vence;
end;
$$;
revoke all on function public.agenda_soporte_acceso_otorgar(uuid, integer) from public, anon;
grant execute on function public.agenda_soporte_acceso_otorgar(uuid, integer) to authenticated, service_role;

create or replace function public.agenda_soporte_acceso_revocar(p_empresa_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text;
begin
  if public.agenda_rol_actual(p_empresa_id) is distinct from 'administrador' then raise exception 'Solo el administrador puede quitar el acceso de ayuda'; end if;
  select m.nombre into v_nombre from public.agenda_miembros m where m.empresa_id = p_empresa_id and m.usuario_id = auth.uid();
  update public.agenda_soporte_accesos set revocado_en = now() where empresa_id = p_empresa_id and revocado_en is null and vence_en > now();
  insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
  values (p_empresa_id, auth.uid(), coalesce(v_nombre, ''), 'empresa', 'acceso_revocado', '{}'::jsonb);
end;
$$;
revoke all on function public.agenda_soporte_acceso_revocar(uuid) from public, anon;
grant execute on function public.agenda_soporte_acceso_revocar(uuid) to authenticated, service_role;

-- Estado del acceso + lo que soporte ha hecho en esta empresa (transparencia).
create or replace function public.agenda_soporte_acceso_estado(p_empresa_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.agenda_rol_actual(p_empresa_id) is distinct from 'administrador' then raise exception 'Solo el administrador puede ver esto'; end if;
  return jsonb_build_object(
    'acceso_hasta', public.agenda_soporte_acceso_vigente(p_empresa_id),
    'auditoria', coalesce((select jsonb_agg(jsonb_build_object('creado_en', a.creado_en, 'actor', a.actor_nombre, 'tipo', a.actor_tipo, 'accion', a.accion, 'detalle', a.detalle) order by a.creado_en desc)
                             from (select * from public.agenda_soporte_auditoria where empresa_id = p_empresa_id order by creado_en desc limit 20) a), '[]'::jsonb));
end;
$$;
revoke all on function public.agenda_soporte_acceso_estado(uuid) from public, anon;
grant execute on function public.agenda_soporte_acceso_estado(uuid) to authenticated, service_role;

-- Felipe (dueño de la plataforma) como primer usuario de soporte. Más usuarios: docs/SOPORTE-PLATAFORMA.md.
insert into public.agenda_soporte_usuarios (usuario_id, nombre)
select u.id, 'Felipe Castelli' from auth.users u where lower(u.email) = 'pf.castelli@patrimonios.co'
on conflict (usuario_id) do nothing;
