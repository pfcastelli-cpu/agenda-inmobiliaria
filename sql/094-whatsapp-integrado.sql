-- 094 · WhatsApp dentro de la plataforma: conversaciones, mensajes, configuración e interruptor del bot.
-- Diseño en docs/PLAN-BOT-WHATSAPP.md. TODO ES NUEVO Y ADITIVO: no toca ninguna tabla ni función existente, y mientras el modo sea
-- «anterior» (valor por defecto) la plataforma no responde ni guarda nada: el bot actual (Apps Script) sigue igual.
--
-- Modos de la empresa (agenda_whatsapp_config.modo):
--   anterior   → responde el bot de Apps Script; la plataforma no hace nada.
--   observador → responde el bot de Apps Script; la plataforma guarda una copia para mostrar las conversaciones.
--   pruebas    → responde la plataforma SOLO a numeros_prueba; el resto sigue con el bot de Apps Script.
--   nuevo      → responde la plataforma a todos.
-- Los secretos (token de WhatsApp, clave de Anthropic, secreto del reenvío) NO van en la base: son secretos de las Edge Functions.
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

-- ============ 1) Permisos nuevos ============
insert into public.agenda_permisos (clave, categoria, nombre, descripcion, orden) values
  ('whatsapp.ver',        'WhatsApp', 'Ver las conversaciones de WhatsApp', 'Bandeja de conversaciones del bot y de los asesores.', 1101),
  ('whatsapp.responder',  'WhatsApp', 'Escribir en una conversación y pausar o reactivar la IA', 'Responde al cliente desde la plataforma.', 1102),
  ('whatsapp.configurar', 'WhatsApp', 'Configurar el bot de WhatsApp', 'Interruptor, números de prueba, reglas extra, contactos y plantillas.', 1103)
on conflict (clave) do update set categoria = excluded.categoria, nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

-- Roles del sistema existentes (no se tocan los personalizados). Para empresas nuevas se da el permiso desde Roles y permisos.
insert into public.agenda_rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.agenda_roles r
  join (values ('administrador','whatsapp.ver'), ('administrador','whatsapp.responder'), ('administrador','whatsapp.configurar'),
               ('coordinador','whatsapp.ver'), ('coordinador','whatsapp.responder'),
               ('asesor','whatsapp.ver'), ('asesor','whatsapp.responder')) as p(clave, permiso) on p.clave = r.clave
 where r.es_sistema
on conflict do nothing;

-- ============ 2) Configuración (una fila por empresa) ============
create table if not exists public.agenda_whatsapp_config (
  empresa_id uuid primary key references public.agenda_empresas(id) on delete cascade,
  modo text not null default 'anterior' check (modo in ('anterior', 'observador', 'pruebas', 'nuevo')),
  numeros_prueba text[] not null default '{}',
  numeros_bloqueados text[] not null default '{}',
  phone_number_id text unique,
  modelo text not null default 'claude-haiku-5-5' check (length(modelo) between 3 and 60),
  compartir_whatsapp_asesor boolean not null default true,
  reglas_adicionales text not null default '' check (length(reglas_adicionales) <= 8000),
  -- Reglas y normas de la empresa que lee la IA. Vacío = se usa el texto original que viene con la plataforma (bot-prompt.ts).
  prompt_reglas text not null default '' check (length(prompt_reglas) <= 120000),
  prompt_info text not null default '' check (length(prompt_info) <= 60000),
  revisar_mensajes_asesor boolean not null default true, -- la IA revisa lo que escribe el asesor antes de enviarlo
  -- Dirección base de los enlaces que da el bot (inmuebles, consignar). Vacío = el dominio público de la empresa. Sirve para probar
  -- contra otro sitio (p. ej. uno de pruebas) sin que los clientes reales reciban enlaces de ese sitio.
  enlaces_base text not null default '' check (enlaces_base = '' or enlaces_base ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'),
  reactivar_ia_horas integer check (reactivar_ia_horas is null or reactivar_ia_horas between 1 and 720),
  contactos jsonb not null default '{}'::jsonb,   -- wa_bogota_medellin, wa_barranquilla, wa_contabilidad, wa_locativas, nombre_locativas, correo_asesores, correo_contabilidad, correo_solicitudes
  plantillas jsonb not null default '[]'::jsonb,  -- [{nombre, idioma, texto, parametros}] ya aprobadas en Meta
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

-- ============ 3) Conversaciones y mensajes ============
create table if not exists public.agenda_wa_conversaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  telefono text not null,
  nombre text,
  numero_oculto boolean not null default false,
  ia_activa boolean not null default true,
  estado text not null default 'ia' check (estado in ('ia', 'humano', 'cerrada')),
  motivo_pausa text,
  pausada_en timestamptz,
  asesor_id uuid references public.agenda_asesores(id) on delete set null,
  ciudad text,
  etiquetas text[] not null default '{}',
  ultima_etiqueta jsonb,
  requiere_atencion boolean not null default false,
  resuelta_en timestamptz,   -- cuándo se marcó como resuelta (null = pendiente); si el cliente vuelve a escribir se reabre sola
  resuelta_por uuid,
  nota_cierre text,
  es_prueba boolean not null default false,
  ultimo_texto text,
  ultimo_en timestamptz not null default now(),
  ultimo_cliente_en timestamptz,
  sin_leer integer not null default 0,
  creado_en timestamptz not null default now(),
  unique (empresa_id, telefono)
);
create index if not exists agenda_wa_conv_orden on public.agenda_wa_conversaciones (empresa_id, ultimo_en desc);

-- Optimización: la bandeja filtra por «requiere atención» y por «IA en pausa»; índices parciales (pequeños) para que sea instantáneo.
create index if not exists agenda_wa_conv_atencion on public.agenda_wa_conversaciones (empresa_id, ultimo_en desc) where requiere_atencion or sin_leer > 0;
create index if not exists agenda_wa_conv_pausadas on public.agenda_wa_conversaciones (empresa_id, ultimo_en desc) where not ia_activa;

create table if not exists public.agenda_wa_mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.agenda_wa_conversaciones(id) on delete cascade,
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  wa_id text,
  direccion text not null check (direccion in ('entrada', 'salida')),
  origen text not null check (origen in ('cliente', 'ia', 'asesor', 'sistema', 'bot_anterior')),
  tipo text not null default 'text',
  texto text,
  estado_envio text,
  error text,
  autor_id uuid,
  autor_nombre text,
  creado_en timestamptz not null default now()
);
create unique index if not exists agenda_wa_msg_wa_id on public.agenda_wa_mensajes (empresa_id, wa_id) where wa_id is not null;
create index if not exists agenda_wa_msg_conv on public.agenda_wa_mensajes (conversacion_id, creado_en);

-- ============ 4) RLS y permisos de tabla ============
alter table public.agenda_whatsapp_config enable row level security;
alter table public.agenda_wa_conversaciones enable row level security;
alter table public.agenda_wa_mensajes enable row level security;

drop policy if exists wa_config_leer on public.agenda_whatsapp_config;
create policy wa_config_leer on public.agenda_whatsapp_config for select to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'whatsapp.ver'));
drop policy if exists wa_conv_leer on public.agenda_wa_conversaciones;
create policy wa_conv_leer on public.agenda_wa_conversaciones for select to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'whatsapp.ver'));
drop policy if exists wa_msg_leer on public.agenda_wa_mensajes;
create policy wa_msg_leer on public.agenda_wa_mensajes for select to authenticated
  using (public.agenda_tiene_permiso(empresa_id, 'whatsapp.ver'));

-- El navegador solo LEE; escribir pasa por las funciones de abajo o por las Edge Functions (service_role).
revoke all on public.agenda_whatsapp_config, public.agenda_wa_conversaciones, public.agenda_wa_mensajes from anon, authenticated;
grant select on public.agenda_whatsapp_config, public.agenda_wa_conversaciones, public.agenda_wa_mensajes to authenticated;
grant select, insert, update, delete on public.agenda_whatsapp_config, public.agenda_wa_conversaciones, public.agenda_wa_mensajes to service_role;

-- ============ 5) Funciones que usa la pantalla ============
-- Guardar la configuración (el interruptor incluido). Solo con el permiso «whatsapp.configurar».
create or replace function public.agenda_wa_guardar_config(p_empresa_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_modo text := coalesce(p_datos->>'modo', 'anterior');
  v_pn text := nullif(regexp_replace(coalesce(p_datos->>'phone_number_id', ''), '\D', '', 'g'), '');
  v_prueba text[]; v_bloq text[];
  v_horas integer := nullif(p_datos->>'reactivar_ia_horas', '')::integer;
  v_cont jsonb := coalesce(p_datos->'contactos', '{}'::jsonb);
  v_plant jsonb := coalesce(p_datos->'plantillas', '[]'::jsonb);
  v_reglas text := p_datos->>'prompt_reglas';
  v_info text := p_datos->>'prompt_info';
  v_base text := btrim(coalesce(p_datos->>'enlaces_base', ''));
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa_id, 'whatsapp.configurar') then
    raise exception 'No tienes permiso para configurar el bot de WhatsApp';
  end if;
  if v_modo not in ('anterior', 'observador', 'pruebas', 'nuevo') then raise exception 'Modo no válido'; end if;
  if v_modo in ('observador', 'pruebas', 'nuevo') and v_pn is null then
    raise exception 'Para activar el bot nuevo escribe primero el identificador del número de WhatsApp (Phone number ID de Meta)';
  end if;
  select coalesce(array_agg(d), '{}') into v_prueba from (
    select distinct regexp_replace(x, '\D', '', 'g') d from jsonb_array_elements_text(coalesce(p_datos->'numeros_prueba', '[]'::jsonb)) x
     where length(regexp_replace(x, '\D', '', 'g')) between 10 and 15) q;
  select coalesce(array_agg(d), '{}') into v_bloq from (
    select distinct regexp_replace(x, '\D', '', 'g') d from jsonb_array_elements_text(coalesce(p_datos->'numeros_bloqueados', '[]'::jsonb)) x
     where length(regexp_replace(x, '\D', '', 'g')) between 10 and 15) q;
  if v_modo = 'pruebas' and coalesce(array_length(v_prueba, 1), 0) = 0 then
    raise exception 'En modo pruebas escribe al menos un número de prueba';
  end if;
  if jsonb_typeof(v_cont) <> 'object' or length(v_cont::text) > 4000 then raise exception 'Contactos no válidos'; end if;
  if jsonb_typeof(v_plant) <> 'array' or length(v_plant::text) > 12000 then raise exception 'Plantillas no válidas'; end if;
  if length(coalesce(p_datos->>'reglas_adicionales', '')) > 8000 then raise exception 'Las reglas adicionales son demasiado largas'; end if;
  if v_base <> '' and v_base !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' then raise exception 'La dirección base de los enlaces debe ser como https://sitio.com (sin barra final)'; end if;
  if length(coalesce(v_reglas, '')) > 120000 or length(coalesce(v_info, '')) > 60000 then raise exception 'El texto de reglas o de información de la empresa es demasiado largo'; end if;

  insert into public.agenda_whatsapp_config as c (empresa_id, modo, numeros_prueba, numeros_bloqueados, phone_number_id, modelo,
      compartir_whatsapp_asesor, reglas_adicionales, reactivar_ia_horas, contactos, plantillas, prompt_reglas, prompt_info, revisar_mensajes_asesor, enlaces_base, actualizado_en, actualizado_por)
  values (p_empresa_id, v_modo, v_prueba, v_bloq, v_pn,
      coalesce(nullif(btrim(p_datos->>'modelo'), ''), 'claude-haiku-5-5'),
      coalesce((p_datos->>'compartir_whatsapp_asesor')::boolean, true),
      coalesce(p_datos->>'reglas_adicionales', ''), v_horas, v_cont, v_plant, coalesce(v_reglas, ''), coalesce(v_info, ''),
      coalesce((p_datos->>'revisar_mensajes_asesor')::boolean, true), v_base, now(), auth.uid())
  on conflict (empresa_id) do update set
      modo = excluded.modo, numeros_prueba = excluded.numeros_prueba, numeros_bloqueados = excluded.numeros_bloqueados,
      phone_number_id = excluded.phone_number_id, modelo = excluded.modelo,
      compartir_whatsapp_asesor = excluded.compartir_whatsapp_asesor, reglas_adicionales = excluded.reglas_adicionales,
      reactivar_ia_horas = excluded.reactivar_ia_horas, contactos = excluded.contactos, plantillas = excluded.plantillas,
      prompt_reglas = coalesce(v_reglas, c.prompt_reglas), prompt_info = coalesce(v_info, c.prompt_info),
      revisar_mensajes_asesor = coalesce((p_datos->>'revisar_mensajes_asesor')::boolean, c.revisar_mensajes_asesor),
      enlaces_base = case when p_datos ? 'enlaces_base' then v_base else c.enlaces_base end,
      actualizado_en = now(), actualizado_por = auth.uid();
end;
$$;
revoke all on function public.agenda_wa_guardar_config(uuid, jsonb) from public, anon;
grant execute on function public.agenda_wa_guardar_config(uuid, jsonb) to authenticated, service_role;

-- Pausar o reactivar la IA en una conversación.
create or replace function public.agenda_wa_set_ia(p_conv uuid, p_activa boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_asesor uuid; v_nombre text;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found then raise exception 'Conversación no encontrada'; end if;
  if auth.uid() is null or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then
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
revoke all on function public.agenda_wa_set_ia(uuid, boolean) from public, anon;
grant execute on function public.agenda_wa_set_ia(uuid, boolean) to authenticated, service_role;

create or replace function public.agenda_wa_marcar_leida(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from public.agenda_wa_conversaciones where id = p_conv;
  if v_emp is null or auth.uid() is null or not public.agenda_tiene_permiso(v_emp, 'whatsapp.ver') then return; end if;
  update public.agenda_wa_conversaciones set sin_leer = 0 where id = p_conv;
end;
$$;
revoke all on function public.agenda_wa_marcar_leida(uuid) from public, anon;
grant execute on function public.agenda_wa_marcar_leida(uuid) to authenticated, service_role;

-- Marcar una conversación como resuelta (o reabrirla). Con permiso «whatsapp.responder». La IA no responde en una conversación resuelta
-- hasta que el cliente vuelva a escribir: en ese momento se reabre sola (lo hace whatsapp-webhook).
create or replace function public.agenda_wa_resolver(p_conv uuid, p_resuelta boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record; v_nombre text;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found then raise exception 'Conversación no encontrada'; end if;
  if auth.uid() is null or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then
    raise exception 'No tienes permiso para cambiar esta conversación';
  end if;
  if p_nota is not null and length(p_nota) > 300 then raise exception 'La nota es demasiado larga (máximo 300 letras)'; end if;
  select a.nombre into v_nombre from public.agenda_asesores a where a.empresa_id = v_c.empresa_id and a.usuario_id = auth.uid() and a.activo limit 1;
  if p_resuelta then
    update public.agenda_wa_conversaciones set estado = 'cerrada', resuelta_en = now(), resuelta_por = auth.uid(), nota_cierre = nullif(btrim(coalesce(p_nota, '')), ''),
           requiere_atencion = false, sin_leer = 0 where id = p_conv;
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
revoke all on function public.agenda_wa_resolver(uuid, boolean, text) from public, anon;
grant execute on function public.agenda_wa_resolver(uuid, boolean, text) to authenticated, service_role;
