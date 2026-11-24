-- 096 · WhatsApp con asesores: temas que reparte la IA, «tomar» y «transferir» conversaciones, y visibilidad por asesor (como una central).
-- Aplicar DESPUÉS de 094 (y 095). Aditivo e idempotente: crea tablas y funciones nuevas, agrega columnas a las tablas de 094 y REEMPLAZA
-- solo las políticas de lectura de 094 (conversaciones y mensajes) y las tres funciones de 094 que cambian de conversación (set_ia, marcar_leida, resolver),
-- para que un asesor sin permiso «ver todas» solo vea lo suyo. PENDIENTE de aplicar (con permiso de Felipe).
--
-- Reglas de visibilidad (en la base, no solo en la pantalla):
--   whatsapp.ver_todas → ve todas las conversaciones.
--   Sin ese permiso, con whatsapp.ver → ve las que tiene asignadas y las «sin asignar» de los temas donde está como responsable
--   (o de temas sin responsables, o sin tema).

-- ============ 1) Permisos nuevos ============
insert into public.agenda_permisos (clave, categoria, nombre, descripcion, orden) values
  ('whatsapp.ver_todas',        'WhatsApp', 'Ver todas las conversaciones de WhatsApp', 'Sin este permiso, cada asesor ve solo sus conversaciones y la cola de sus temas.', 1104),
  ('whatsapp.tomar',            'WhatsApp', 'Tomar conversaciones sin asignar', 'Quedarse con una conversación de la cola.', 1105),
  ('whatsapp.transferir',       'WhatsApp', 'Transferir una conversación a un colega asesor', 'Pasar la conversación a otro asesor.', 1106),
  ('whatsapp.transferir_todos', 'WhatsApp', 'Transferir a cualquier persona (coordinadores y administradores también)', 'Sin este permiso solo se transfiere a colegas asesores.', 1107)
on conflict (clave) do update set categoria = excluded.categoria, nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

insert into public.agenda_rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.agenda_roles r
  join (values ('administrador','whatsapp.ver_todas'), ('administrador','whatsapp.tomar'), ('administrador','whatsapp.transferir'), ('administrador','whatsapp.transferir_todos'),
               ('coordinador','whatsapp.ver_todas'),   ('coordinador','whatsapp.tomar'),   ('coordinador','whatsapp.transferir'),   ('coordinador','whatsapp.transferir_todos'),
               ('asesor','whatsapp.tomar'), ('asesor','whatsapp.transferir')) as p(clave, permiso) on p.clave = r.clave
 where r.es_sistema
on conflict do nothing;

-- ============ 2) Temas (la IA clasifica cada conversación en uno) ============
create table if not exists public.agenda_wa_temas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  clave text not null check (clave ~ '^[a-z0-9_]{2,40}$'),
  nombre text not null check (length(btrim(nombre)) between 2 and 60),
  descripcion text not null default '' check (length(descripcion) <= 600),  -- guía para la IA: cuándo una conversación es de este tema
  orden integer not null default 100,
  activo boolean not null default true,
  unique (empresa_id, clave)
);
-- Quiénes atienden cada tema (la cola «sin asignar» de ese tema la ven ellos). Sin filas = la ve todo el que tenga whatsapp.ver.
create table if not exists public.agenda_wa_tema_asesores (
  tema_id uuid not null references public.agenda_wa_temas(id) on delete cascade,
  asesor_id uuid not null references public.agenda_asesores(id) on delete cascade,
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  primary key (tema_id, asesor_id)
);
create index if not exists agenda_wa_tema_asesores_asesor on public.agenda_wa_tema_asesores (asesor_id);

alter table public.agenda_wa_conversaciones
  add column if not exists tema_id uuid references public.agenda_wa_temas(id) on delete set null,
  add column if not exists alerta text check (alerta is null or length(alerta) <= 60),  -- p. ej. 'inmueble_no_identificado': la IA no supo de qué inmueble hablan
  add column if not exists asignada_en timestamptz,
  add column if not exists asignada_por uuid;
create index if not exists agenda_wa_conv_asesor on public.agenda_wa_conversaciones (empresa_id, asesor_id, ultimo_en desc);

alter table public.agenda_wa_temas enable row level security;
alter table public.agenda_wa_tema_asesores enable row level security;
drop policy if exists wa_temas_leer on public.agenda_wa_temas;
create policy wa_temas_leer on public.agenda_wa_temas for select to authenticated using (public.agenda_tiene_permiso(empresa_id, 'whatsapp.ver'));
drop policy if exists wa_tema_asesores_leer on public.agenda_wa_tema_asesores;
create policy wa_tema_asesores_leer on public.agenda_wa_tema_asesores for select to authenticated using (public.agenda_tiene_permiso(empresa_id, 'whatsapp.ver'));
revoke all on public.agenda_wa_temas, public.agenda_wa_tema_asesores from anon, authenticated;
grant select on public.agenda_wa_temas, public.agenda_wa_tema_asesores to authenticated;
grant select, insert, update, delete on public.agenda_wa_temas, public.agenda_wa_tema_asesores to service_role;

-- ============ 3) Quién puede ver qué ============
create or replace function public.agenda_wa_mi_asesor(p_empresa uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.agenda_asesores a where a.empresa_id = p_empresa and a.usuario_id = auth.uid() and a.activo limit 1
$$;
revoke all on function public.agenda_wa_mi_asesor(uuid) from public, anon;
grant execute on function public.agenda_wa_mi_asesor(uuid) to authenticated, service_role;

create or replace function public.agenda_wa_visible(p_empresa uuid, p_asesor uuid, p_tema uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.agenda_tiene_permiso(p_empresa, 'whatsapp.ver') and (
    public.agenda_tiene_permiso(p_empresa, 'whatsapp.ver_todas')
    or (p_asesor is not null and p_asesor = public.agenda_wa_mi_asesor(p_empresa))
    or (p_asesor is null and (
         p_tema is null
         or not exists (select 1 from public.agenda_wa_tema_asesores ta where ta.tema_id = p_tema)
         or exists (select 1 from public.agenda_wa_tema_asesores ta where ta.tema_id = p_tema and ta.asesor_id = public.agenda_wa_mi_asesor(p_empresa))))
  )
$$;
revoke all on function public.agenda_wa_visible(uuid, uuid, uuid) from public, anon;
grant execute on function public.agenda_wa_visible(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists wa_conv_leer on public.agenda_wa_conversaciones;
create policy wa_conv_leer on public.agenda_wa_conversaciones for select to authenticated
  using (public.agenda_wa_visible(empresa_id, asesor_id, tema_id));
-- Los mensajes se ven si se ve la conversación (la consulta interna también pasa por la política de arriba).
drop policy if exists wa_msg_leer on public.agenda_wa_mensajes;
create policy wa_msg_leer on public.agenda_wa_mensajes for select to authenticated
  using (exists (select 1 from public.agenda_wa_conversaciones c where c.id = conversacion_id));

-- Para las Edge Functions que evalúan con la sesión de quien llama.
create or replace function public.agenda_wa_puede_ver_conv(p_conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.agenda_wa_visible(c.empresa_id, c.asesor_id, c.tema_id) from public.agenda_wa_conversaciones c where c.id = p_conv), false)
$$;
revoke all on function public.agenda_wa_puede_ver_conv(uuid) from public, anon;
grant execute on function public.agenda_wa_puede_ver_conv(uuid) to authenticated, service_role;

-- ============ 4) Funciones de la pantalla ============
-- Guardar los temas y sus responsables (reemplaza la lista; los temas que ya no vienen quedan inactivos, no se borran).
-- p_temas: [{ clave, nombre, descripcion, asesor_ids: [uuid] }]. Requiere «whatsapp.configurar».
create or replace function public.agenda_wa_guardar_temas(p_empresa_id uuid, p_temas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare t jsonb; v_id uuid; v_clave text; v_orden integer := 0; v_aid text;
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa_id, 'whatsapp.configurar') then raise exception 'No tienes permiso para configurar WhatsApp'; end if;
  if jsonb_typeof(p_temas) <> 'array' or jsonb_array_length(p_temas) > 30 then raise exception 'La lista de temas no es válida (máximo 30)'; end if;
  update public.agenda_wa_temas set activo = false where empresa_id = p_empresa_id;
  for t in select * from jsonb_array_elements(p_temas) loop
    v_clave := lower(btrim(coalesce(t->>'clave', '')));
    if v_clave !~ '^[a-z0-9_]{2,40}$' then raise exception 'La clave del tema «%» no es válida: usa letras minúsculas, números y guion bajo', v_clave; end if;
    v_orden := v_orden + 10;
    insert into public.agenda_wa_temas (empresa_id, clave, nombre, descripcion, orden, activo)
    values (p_empresa_id, v_clave, left(btrim(coalesce(t->>'nombre', v_clave)), 60), left(coalesce(t->>'descripcion', ''), 600), v_orden, true)
    on conflict (empresa_id, clave) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, activo = true
    returning id into v_id;
    delete from public.agenda_wa_tema_asesores where tema_id = v_id;
    for v_aid in select jsonb_array_elements_text(coalesce(t->'asesor_ids', '[]'::jsonb)) loop
      insert into public.agenda_wa_tema_asesores (tema_id, asesor_id, empresa_id)
      select v_id, a.id, p_empresa_id from public.agenda_asesores a where a.id = v_aid::uuid and a.empresa_id = p_empresa_id
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.agenda_wa_guardar_temas(uuid, jsonb) from public, anon;
grant execute on function public.agenda_wa_guardar_temas(uuid, jsonb) to authenticated, service_role;

-- Tomar una conversación (de la cola o, con «ver todas», una que tiene otro).
create or replace function public.agenda_wa_tomar(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_yo uuid; v_nombre text;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then raise exception 'Conversación no encontrada'; end if;
  if not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.tomar') or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then
    raise exception 'No tienes permiso para tomar conversaciones';
  end if;
  select a.id, a.nombre into v_yo, v_nombre from public.agenda_asesores a where a.empresa_id = v_c.empresa_id and a.usuario_id = auth.uid() and a.activo limit 1;
  if v_yo is null then raise exception 'Tu usuario no tiene una ficha de asesor activa; pídele a un administrador que te dé acceso'; end if;
  if v_c.asesor_id is not null and v_c.asesor_id <> v_yo and not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.ver_todas') then
    raise exception 'Esta conversación ya la atiende otro asesor';
  end if;
  update public.agenda_wa_conversaciones set asesor_id = v_yo, ia_activa = false, estado = case when estado = 'cerrada' then estado else 'humano' end,
         motivo_pausa = 'Atiende ' || v_nombre, pausada_en = coalesce(pausada_en, now()), requiere_atencion = false, sin_leer = 0,
         asignada_en = now(), asignada_por = auth.uid()
   where id = p_conv;
  insert into public.agenda_wa_mensajes (conversacion_id, empresa_id, direccion, origen, tipo, texto, autor_id, autor_nombre)
  values (p_conv, v_c.empresa_id, 'salida', 'sistema', 'evento', v_nombre || ' tomó la conversación.', auth.uid(), v_nombre);
end;
$$;
revoke all on function public.agenda_wa_tomar(uuid) from public, anon;
grant execute on function public.agenda_wa_tomar(uuid) to authenticated, service_role;

-- Transferir a otro asesor. A colegas asesores: «whatsapp.transferir». A coordinadores/administradores: «whatsapp.transferir_todos».
-- Quien transfiere debe ser el asesor asignado, o tener «ver todas».
create or replace function public.agenda_wa_transferir(p_conv uuid, p_asesor uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_yo uuid; v_nombre_yo text; v_dest record; v_rol_dest text; v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then raise exception 'Conversación no encontrada'; end if;
  if v_nota is not null and length(v_nota) > 300 then raise exception 'La nota es demasiado larga (máximo 300 letras)'; end if;
  select a.id, a.nombre into v_yo, v_nombre_yo from public.agenda_asesores a where a.empresa_id = v_c.empresa_id and a.usuario_id = auth.uid() and a.activo limit 1;
  if not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then raise exception 'No tienes permiso para transferir'; end if;
  if v_c.asesor_id is distinct from v_yo and not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.ver_todas') then
    raise exception 'Solo quien atiende la conversación (o quien ve todas) puede transferirla';
  end if;
  select a.id, a.nombre, a.usuario_id into v_dest from public.agenda_asesores a where a.id = p_asesor and a.empresa_id = v_c.empresa_id and a.activo;
  if not found then raise exception 'El asesor elegido no existe o está inactivo'; end if;
  if v_dest.usuario_id is null then raise exception 'Ese asesor todavía no tiene acceso a la plataforma (no podría ver la conversación)'; end if;
  select m.rol into v_rol_dest from public.agenda_miembros m where m.empresa_id = v_c.empresa_id and m.usuario_id = v_dest.usuario_id and m.activo limit 1;
  if v_rol_dest is null then raise exception 'Ese asesor no tiene acceso activo a la empresa'; end if;
  if v_rol_dest in ('administrador', 'coordinador') then
    if not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.transferir_todos') then raise exception 'No tienes permiso para transferir a coordinadores o administradores'; end if;
  elsif not (public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.transferir') or public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.transferir_todos')) then
    raise exception 'No tienes permiso para transferir conversaciones';
  end if;
  update public.agenda_wa_conversaciones set asesor_id = v_dest.id, ia_activa = false, estado = case when estado = 'cerrada' then estado else 'humano' end,
         motivo_pausa = 'Atiende ' || v_dest.nombre, pausada_en = coalesce(pausada_en, now()), requiere_atencion = true,
         asignada_en = now(), asignada_por = auth.uid()
   where id = p_conv;
  insert into public.agenda_wa_mensajes (conversacion_id, empresa_id, direccion, origen, tipo, texto, autor_id, autor_nombre)
  values (p_conv, v_c.empresa_id, 'salida', 'sistema', 'evento',
          coalesce(v_nombre_yo, 'Un asesor') || ' transfirió la conversación a ' || v_dest.nombre || case when v_nota is not null then ': ' || v_nota else '.' end,
          auth.uid(), v_nombre_yo);
end;
$$;
revoke all on function public.agenda_wa_transferir(uuid, uuid, text) from public, anon;
grant execute on function public.agenda_wa_transferir(uuid, uuid, text) to authenticated, service_role;

-- Asesores con acceso (para el menú de transferir y para mostrar nombres). «permitido» respeta mis permisos; «yo» marca mi propia ficha.
create or replace function public.agenda_wa_destinos_transferencia(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_todos boolean; v_colegas boolean;
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa, 'whatsapp.ver') then return '[]'::jsonb; end if;
  v_todos := public.agenda_tiene_permiso(p_empresa, 'whatsapp.transferir_todos');
  v_colegas := v_todos or public.agenda_tiene_permiso(p_empresa, 'whatsapp.transferir');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'rol', m.rol,
             'permitido', case when m.rol in ('administrador', 'coordinador') then v_todos else v_colegas end,
             'yo', a.usuario_id = auth.uid()) order by a.nombre)
      from public.agenda_asesores a
      join public.agenda_miembros m on m.empresa_id = a.empresa_id and m.usuario_id = a.usuario_id and m.activo
     where a.empresa_id = p_empresa and a.activo and a.usuario_id is not null), '[]'::jsonb);
end;
$$;
revoke all on function public.agenda_wa_destinos_transferencia(uuid) from public, anon;
grant execute on function public.agenda_wa_destinos_transferencia(uuid) to authenticated, service_role;

-- Cambiar el tema de una conversación (si la IA se equivocó).
create or replace function public.agenda_wa_cambiar_tema(p_conv uuid, p_tema uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then raise exception 'Conversación no encontrada'; end if;
  if not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then raise exception 'No tienes permiso para cambiar esta conversación'; end if;
  if p_tema is not null and not exists (select 1 from public.agenda_wa_temas t where t.id = p_tema and t.empresa_id = v_c.empresa_id and t.activo) then raise exception 'Tema no válido'; end if;
  update public.agenda_wa_conversaciones set tema_id = p_tema where id = p_conv;
end;
$$;
revoke all on function public.agenda_wa_cambiar_tema(uuid, uuid) from public, anon;
grant execute on function public.agenda_wa_cambiar_tema(uuid, uuid) to authenticated, service_role;

-- ============ 5) Funciones de 094 que ahora comprueban que la conversación sea visible para quien llama ============
create or replace function public.agenda_wa_set_ia(p_conv uuid, p_activa boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_asesor uuid; v_nombre text;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found then raise exception 'Conversación no encontrada'; end if;
  if auth.uid() is null or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then
    raise exception 'No tienes permiso para cambiar esta conversación';
  end if;
  select a.id, a.nombre into v_asesor, v_nombre from public.agenda_asesores a
   where a.empresa_id = v_c.empresa_id and a.usuario_id = auth.uid() and a.activo limit 1;
  if p_activa then
    update public.agenda_wa_conversaciones set ia_activa = true, estado = 'ia', motivo_pausa = null, pausada_en = null, requiere_atencion = false
     where id = p_conv;
  else
    update public.agenda_wa_conversaciones set ia_activa = false, estado = 'humano', motivo_pausa = 'Pausada por un asesor', pausada_en = now(),
           asesor_id = coalesce(v_asesor, asesor_id)
     where id = p_conv;
  end if;
  insert into public.agenda_wa_mensajes (conversacion_id, empresa_id, direccion, origen, tipo, texto, autor_id, autor_nombre)
  values (p_conv, v_c.empresa_id, 'salida', 'sistema', 'evento',
          case when p_activa then 'La IA volvió a responder esta conversación.' else 'La IA quedó en pausa: atiende una persona.' end,
          auth.uid(), v_nombre);
end;
$$;

create or replace function public.agenda_wa_marcar_leida(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then return; end if;
  update public.agenda_wa_conversaciones set sin_leer = 0 where id = p_conv;
end;
$$;

create or replace function public.agenda_wa_resolver(p_conv uuid, p_resuelta boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_nombre text;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found then raise exception 'Conversación no encontrada'; end if;
  if auth.uid() is null or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then
    raise exception 'No tienes permiso para cambiar esta conversación';
  end if;
  if p_nota is not null and length(p_nota) > 300 then raise exception 'La nota es demasiado larga (máximo 300 letras)'; end if;
  select a.nombre into v_nombre from public.agenda_asesores a where a.empresa_id = v_c.empresa_id and a.usuario_id = auth.uid() and a.activo limit 1;
  if p_resuelta then
    update public.agenda_wa_conversaciones set estado = 'cerrada', resuelta_en = now(), resuelta_por = auth.uid(), nota_cierre = nullif(btrim(coalesce(p_nota, '')), ''),
           requiere_atencion = false, sin_leer = 0, alerta = null where id = p_conv;
  else
    update public.agenda_wa_conversaciones set estado = case when ia_activa then 'ia' else 'humano' end, resuelta_en = null, resuelta_por = null, nota_cierre = null where id = p_conv;
  end if;
  insert into public.agenda_wa_mensajes (conversacion_id, empresa_id, direccion, origen, tipo, texto, autor_id, autor_nombre)
  values (p_conv, v_c.empresa_id, 'salida', 'sistema', 'evento',
          case when p_resuelta then 'Conversación marcada como resuelta' || coalesce(' por ' || v_nombre, '') || case when nullif(btrim(coalesce(p_nota, '')), '') is not null then ': ' || btrim(p_nota) else '.' end
               else 'Conversación reabierta' || coalesce(' por ' || v_nombre, '') || '.' end,
          auth.uid(), v_nombre);
end;
$$;

-- ============ 6) Etiquetas de la conversación: perfil del contacto e inmueble ============
-- perfiles (puede tener varios, p. ej. propietario y arrendatario a la vez): interesado_arriendo, interesado_compra, propietario, arrendatario, consignacion.
-- La IA los propone (etiqueta [PERFIL]), el webhook reconoce arrendatarios por teléfono (hoja de arrendatarios) y el asesor puede corregirlos a mano.
alter table public.agenda_wa_conversaciones
  add column if not exists perfiles text[] not null default '{}'
    check (perfiles <@ array['interesado_arriendo', 'interesado_compra', 'propietario', 'arrendatario', 'consignacion']::text[]),
  add column if not exists inmueble_numero integer;   -- inmueble del que se habla (aparece en el título de la conversación)

create or replace function public.agenda_wa_etiquetar(p_conv uuid, p_perfiles text[], p_inmueble integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then raise exception 'Conversación no encontrada'; end if;
  if not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then raise exception 'No tienes permiso para cambiar esta conversación'; end if;
  if not (coalesce(p_perfiles, '{}') <@ array['interesado_arriendo', 'interesado_compra', 'propietario', 'arrendatario', 'consignacion']::text[]) then raise exception 'Etiqueta no válida'; end if;
  if p_inmueble is not null and not exists (select 1 from public.agenda_inmuebles i where i.empresa_id = v_c.empresa_id and i.numero_inmueble = p_inmueble) then
    raise exception 'No existe el inmueble Nº %', p_inmueble;
  end if;
  update public.agenda_wa_conversaciones set perfiles = coalesce(p_perfiles, '{}'), inmueble_numero = p_inmueble where id = p_conv;
end;
$$;
revoke all on function public.agenda_wa_etiquetar(uuid, text[], integer) from public, anon;
grant execute on function public.agenda_wa_etiquetar(uuid, text[], integer) to authenticated, service_role;
