-- Registro técnico sin cuerpos de solicitudes, correos, contraseñas ni tokens.
begin;
create table if not exists public.agenda_fallos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id),
  firma text not null,
  modulo text not null,
  codigo text not null,
  operacion text not null default '',
  nivel text not null check(nivel in ('aviso','error')),
  http_status integer,
  es_prueba boolean not null default false,
  estado text not null default 'abierto' check(estado in ('abierto','en_revision','resuelto')),
  repeticiones integer not null default 1,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  resolucion text not null default '',
  unique(empresa_id, firma)
);
create index if not exists agenda_fallos_pendientes_idx on public.agenda_fallos(empresa_id, estado, ultima_vez desc);
create table if not exists public.agenda_fallo_eventos (
  id bigint generated always as identity primary key,
  fallo_id uuid not null references public.agenda_fallos(id),
  estado text not null,
  nota text not null default '',
  actor_id uuid,
  creado_en timestamptz not null default now()
);
alter table public.agenda_fallos enable row level security;
alter table public.agenda_fallo_eventos enable row level security;
revoke all on public.agenda_fallos, public.agenda_fallo_eventos from anon, authenticated;
grant select, insert, update, delete on public.agenda_fallos, public.agenda_fallo_eventos to service_role;
grant usage, select on sequence public.agenda_fallo_eventos_id_seq to service_role;

create or replace function public.agenda_fallo_registrar(
  p_empresa_id uuid, p_modulo text, p_codigo text, p_operacion text default '',
  p_nivel text default 'error', p_http_status integer default null, p_es_prueba boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_previo text; v_firma text;
begin
  if p_modulo !~ '^[a-z0-9_-]{1,60}$' or p_codigo !~ '^[A-Z0-9_]{1,80}$'
     or p_operacion !~ '^[a-z0-9_-]{0,80}$' or p_nivel not in ('aviso','error')
     or (p_http_status is not null and p_http_status not between 400 and 599) then
    raise exception 'Formato de fallo inválido';
  end if;
  -- Límite por empresa. No se permite convertir esta entrada en un almacén arbitrario.
  if (select count(*) from public.agenda_fallos where empresa_id=p_empresa_id and ultima_vez>now()-interval '1 minute') >= 100 then
    return null;
  end if;
  v_firma := md5(concat_ws('|',p_modulo,p_codigo,p_operacion,p_http_status,coalesce(p_es_prueba,false)));
  -- Serializa registro y resolución de la misma firma, incluso en el primer INSERT.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || v_firma, 0));
  select estado into v_previo from public.agenda_fallos where empresa_id=p_empresa_id and firma=v_firma;
  insert into public.agenda_fallos(empresa_id,firma,modulo,codigo,operacion,nivel,http_status,es_prueba)
    values(p_empresa_id,v_firma,p_modulo,p_codigo,p_operacion,p_nivel,p_http_status,coalesce(p_es_prueba,false))
  on conflict(empresa_id,firma) do update set
    repeticiones=public.agenda_fallos.repeticiones+1, ultima_vez=now(), estado='abierto',
    nivel=case when excluded.nivel='error' then 'error' else public.agenda_fallos.nivel end
  returning id into v_id;
  if v_previo is null or v_previo='resuelto' then
    insert into public.agenda_fallo_eventos(fallo_id,estado,nota)
      values(v_id,'abierto',case when v_previo='resuelto' then 'El fallo reapareció.' else 'Registro automático.' end);
  end if;
  return v_id;
end $$;
revoke all on function public.agenda_fallo_registrar(uuid,text,text,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.agenda_fallo_registrar(uuid,text,text,text,text,integer,boolean) to service_role;

create or replace function public.agenda_fallos_listar(
  p_empresa_id uuid default null, p_estado text default 'abiertos', p_pruebas boolean default null, p_pagina integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_items jsonb;
begin
  if not public.agenda_es_soporte() and (p_empresa_id is null or not public.agenda_es_admin(p_empresa_id)) then
    raise exception 'No tienes acceso a estos fallos';
  end if;
  if p_estado not in ('abiertos','todos','abierto','en_revision','resuelto') then raise exception 'Filtro inválido'; end if;
  select count(*) into v_total from public.agenda_fallos f
    where (p_empresa_id is null or f.empresa_id=p_empresa_id)
      and (p_pruebas is null or f.es_prueba=p_pruebas)
      and (p_estado='todos' or (p_estado='abiertos' and f.estado<>'resuelto') or f.estado=p_estado);
  select coalesce(jsonb_agg(x order by x.ultima_vez desc),'[]'::jsonb) into v_items from (
    select f.*, e.nombre as empresa_nombre,
      (select coalesce(jsonb_agg(h order by h.creado_en desc),'[]'::jsonb) from (
        select estado, nota, creado_en from public.agenda_fallo_eventos where fallo_id=f.id order by creado_en desc limit 10
      ) h) as historial
    from public.agenda_fallos f join public.agenda_empresas e on e.id=f.empresa_id
    where (p_empresa_id is null or f.empresa_id=p_empresa_id)
      and (p_pruebas is null or f.es_prueba=p_pruebas)
      and (p_estado='todos' or (p_estado='abiertos' and f.estado<>'resuelto') or f.estado=p_estado)
    order by f.ultima_vez desc limit 30 offset greatest(0,least(coalesce(p_pagina,0),10000))*30
  ) x;
  return jsonb_build_object('total',v_total,'items',v_items);
end $$;
revoke all on function public.agenda_fallos_listar(uuid,text,boolean,integer) from public, anon;
grant execute on function public.agenda_fallos_listar(uuid,text,boolean,integer) to authenticated, service_role;

create or replace function public.agenda_fallo_gestionar(p_id uuid, p_estado text, p_nota text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_f public.agenda_fallos;
begin
  select * into v_f from public.agenda_fallos where id=p_id;
  if not found or (not public.agenda_es_soporte() and not public.agenda_es_admin(v_f.empresa_id)) then
    raise exception 'No tienes acceso a este fallo';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_f.empresa_id::text || v_f.firma, 0));
  if p_estado not in ('abierto','en_revision','resuelto') or length(p_nota)>1000
    or (p_estado='resuelto' and length(btrim(coalesce(p_nota,'')))<5) then
    raise exception 'Indica un estado válido y explica la corrección al resolver';
  end if;
  update public.agenda_fallos set estado=p_estado,
    resolucion=case when p_estado='resuelto' then btrim(p_nota) else resolucion end where id=p_id;
  insert into public.agenda_fallo_eventos(fallo_id,estado,nota,actor_id)
    values(p_id,p_estado,btrim(coalesce(p_nota,'')),auth.uid());
end $$;
revoke all on function public.agenda_fallo_gestionar(uuid,text,text) from public, anon;
grant execute on function public.agenda_fallo_gestionar(uuid,text,text) to authenticated, service_role;

-- Los errores de correo de TODAS las funciones existentes entran sin duplicar su lógica SMTP.
create or replace function public.agenda_correo_fallo_registrar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado='fallido' then
    perform public.agenda_fallo_registrar(new.empresa_id,'correo','CORREO_NO_ENVIADO',
      left(regexp_replace(lower(new.destinatario_tipo),'[^a-z0-9_-]','','g'),80),'error',null,new.modo_pruebas);
  end if;
  return new;
exception when others then
  raise warning 'No se pudo registrar el fallo de correo en soporte';
  return new;
end $$;
revoke all on function public.agenda_correo_fallo_registrar() from public, anon, authenticated;
drop trigger if exists agenda_correo_fallo_soporte on public.agenda_correos_log;
create trigger agenda_correo_fallo_soporte after insert on public.agenda_correos_log
  for each row execute function public.agenda_correo_fallo_registrar();
commit;
