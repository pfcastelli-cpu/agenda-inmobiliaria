-- 066 · Registro de cambios del sistema (quién creó, eliminó, desactivó o cambió permisos/accesos/configuración).
-- Complementa la bitácora de citas. Lo llenan disparadores en la base; el navegador solo lo LEE y solo quien tenga el permiso
-- «auditoria.ver» (el rol Superadministrador siempre lo tiene; a los demás roles se les da desde Configuración → Roles).
-- Nunca guarda contraseñas, claves ni tokens: en cambios solo se anotan NOMBRES de campos (y valores de campos simples de asesores/accesos).
-- Un fallo al registrar NUNCA bloquea el cambio original. Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

insert into public.agenda_permisos (clave, categoria, nombre, descripcion, orden) values
  ('auditoria.ver', 'Bitácora', 'Ver el registro de cambios del sistema', 'Quién creó, eliminó o cambió asesores, accesos, roles y configuración.', 502)
on conflict (clave) do nothing;

create table if not exists public.agenda_auditoria (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  creado_en timestamptz not null default now(),
  usuario_id uuid,
  usuario_correo text,
  accion text not null,
  entidad text not null,
  entidad_id text,
  descripcion text,
  detalle jsonb
);
create index if not exists agenda_auditoria_empresa_fecha on public.agenda_auditoria (empresa_id, creado_en desc);
alter table public.agenda_auditoria enable row level security;
drop policy if exists auditoria_lectura on public.agenda_auditoria;
create policy auditoria_lectura on public.agenda_auditoria for select to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'auditoria.ver'));
grant select on public.agenda_auditoria to authenticated;
grant select, insert, update, delete on public.agenda_auditoria to service_role;

create or replace function public.agenda_auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb; v_old jsonb; v_fila jsonb; v_emp uuid; v_cambios text[]; v_detalle jsonb; v_desc text; v_id text;
  v_ocultos text[] := array['calendario_token','token','actualizado_en','creado_en','password','clave','updated_at'];
begin
  begin
    v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    v_fila := coalesce(v_new, v_old);
    v_emp := nullif(v_fila->>'empresa_id', '')::uuid;
    if v_emp is null and tg_table_name = 'agenda_rol_permisos' then
      select r.empresa_id into v_emp from public.agenda_roles r where r.id = (v_fila->>'rol_id')::uuid;
    end if;
    if v_emp is null then return coalesce(new, old); end if;
    v_id := coalesce(v_fila->>'id', v_fila->>'usuario_id', v_fila->>'clave');
    v_desc := coalesce(v_fila->>'nombre', v_fila->>'correo', v_fila->>'nombre_comercial', v_fila->>'permiso', v_id);
    if tg_op = 'UPDATE' then
      select array_agg(k order by k) into v_cambios from jsonb_object_keys(v_new) k
        where v_new->k is distinct from v_old->k and k <> all (v_ocultos);
      if v_cambios is null then return new; end if;
      v_detalle := jsonb_build_object('campos', to_jsonb(v_cambios));
      if tg_table_name in ('agenda_asesores', 'agenda_miembros') then
        v_detalle := v_detalle || jsonb_build_object('cambios', (
          select jsonb_object_agg(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k))
          from unnest(v_cambios) k where k in ('activo','rol','rol_id','nombre','correo','celular','prioridad','tipo_vinculacion','usuario_id')));
      end if;
    elsif tg_table_name in ('agenda_asesores', 'agenda_miembros', 'agenda_roles', 'agenda_rol_permisos') then
      v_detalle := jsonb_build_object('datos', v_fila - v_ocultos);
    end if;
    insert into public.agenda_auditoria (empresa_id, usuario_id, usuario_correo, accion, entidad, entidad_id, descripcion, detalle)
    values (v_emp, auth.uid(), auth.email(),
            case tg_op when 'INSERT' then 'creó' when 'UPDATE' then 'cambió' else 'eliminó' end,
            tg_table_name, v_id, v_desc, v_detalle);
  exception when others then
    null; -- el registro jamás debe impedir el cambio original
  end;
  return coalesce(new, old);
end $$;
revoke all on function public.agenda_auditar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['agenda_asesores','agenda_miembros','agenda_roles','agenda_rol_permisos','agenda_configuracion','agenda_ciudades','agenda_coberturas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists agenda_auditar on public.%I', t);
      execute format('create trigger agenda_auditar after insert or update or delete on public.%I for each row execute function public.agenda_auditar()', t);
    end if;
  end loop;
end $$;
