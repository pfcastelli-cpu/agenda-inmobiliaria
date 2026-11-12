-- 082 · Propuestas de compra (inmuebles en VENTA): negociación solo de precio entre el comprador interesado y el propietario, sin texto libre,
--       teléfonos ni mensajes. Cada parte recibe un enlace propio (token); solo se puede responder en el propio turno.
--       Al acordar el valor, el comprador deja los datos básicos para preparar la promesa de compraventa.
--       Nada de esto es vinculante: lo aclaran las páginas y los correos (el compromiso nace con la firma de la promesa).
-- Seguridad: las tablas no se leen directo desde el navegador; todo pasa por funciones. Las que usan tokens solo las ejecuta service_role
-- (las llama la Edge Function portal-negociacion). El panel interno usa agenda_negociaciones_listar (permiso, asesor de la cita o supervisor).
-- Idempotente. APLICADO en producción el 12-nov-2026.

create table if not exists public.agenda_negociaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  cita_id uuid not null unique references public.agenda_citas(id) on delete cascade,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  numero_inmueble text,
  token_comprador uuid not null default gen_random_uuid() unique,
  token_propietario uuid not null default gen_random_uuid() unique,
  cliente_nombre text,
  cliente_email text,
  valor_publicado bigint not null check (valor_publicado > 0),
  valor_vigente bigint check (valor_vigente is null or valor_vigente > 0),
  valor_acordado bigint check (valor_acordado is null or valor_acordado > 0),
  turno text not null default 'comprador' check (turno in ('comprador', 'propietario')),
  estado text not null default 'abierta' check (estado in ('abierta', 'acordada', 'sin_acuerdo', 'vencida')),
  vence_en timestamptz not null default (now() + interval '7 days'),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists agenda_negociaciones_empresa_idx on public.agenda_negociaciones (empresa_id, estado);

create table if not exists public.agenda_negociacion_movimientos (
  id uuid primary key default gen_random_uuid(),
  negociacion_id uuid not null references public.agenda_negociaciones(id) on delete cascade,
  empresa_id uuid not null,
  de text not null check (de in ('comprador', 'propietario')),
  accion text not null check (accion in ('propuesta', 'contrapropuesta', 'acepta', 'rechaza')),
  valor bigint check (valor is null or valor > 0),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_negociacion_mov_idx on public.agenda_negociacion_movimientos (negociacion_id, creado_en);

create table if not exists public.agenda_negociacion_promesa (
  negociacion_id uuid primary key references public.agenda_negociaciones(id) on delete cascade,
  empresa_id uuid not null,
  tipo_persona text not null check (tipo_persona in ('natural', 'juridica')),
  nombre_completo text not null check (char_length(nombre_completo) between 3 and 160),
  tipo_documento text not null check (tipo_documento in ('CC', 'CE', 'PA', 'NIT', 'TI', 'otro')),
  numero_documento text not null check (char_length(numero_documento) between 4 and 30),
  representante_legal text check (representante_legal is null or char_length(representante_legal) <= 160),
  estado_civil text check (estado_civil is null or estado_civil in ('soltero', 'casado', 'union_libre', 'divorciado', 'viudo')),
  email text not null check (char_length(email) between 5 and 160),
  celular text not null check (char_length(celular) between 7 and 20),
  direccion text check (direccion is null or char_length(direccion) <= 200),
  compra_con_otros boolean not null default false,
  otros_compradores text check (otros_compradores is null or char_length(otros_compradores) <= 400),
  forma_pago text not null check (forma_pago in ('contado', 'credito_hipotecario', 'subsidio', 'mixto', 'otro')),
  texto_autorizacion text not null,
  cambios integer not null default 0,
  autorizado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.agenda_negociaciones enable row level security;
alter table public.agenda_negociacion_movimientos enable row level security;
alter table public.agenda_negociacion_promesa enable row level security;
-- Sin políticas para anon ni authenticated: el navegador no lee estas tablas; solo service_role y las funciones SECURITY DEFINER.
grant select, insert, update, delete on public.agenda_negociaciones to service_role;
grant select, insert, update, delete on public.agenda_negociacion_movimientos to service_role;
grant select, insert, update, delete on public.agenda_negociacion_promesa to service_role;

-- Crea la negociación de una cita (solo si el inmueble está en venta y tiene valor). Idempotente: si ya existe la devuelve.
create or replace function public.agenda_negociacion_crear(p_cita_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare c record; i record; n record; v_filas integer := 0; v_creada boolean := false; v_valor bigint;
begin
  select id, empresa_id, inmueble_id, cliente_nombre, cliente_email into c from public.agenda_citas where id = p_cita_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'cita_no_encontrada'); end if;
  select id, numero_inmueble::text as numero, tipo_oferta, valor_venta into i from public.agenda_inmuebles where id = c.inmueble_id;
  if not found or lower(coalesce(i.tipo_oferta, '')) not like 'venta%' then return jsonb_build_object('ok', false, 'error', 'no_es_venta'); end if;
  v_valor := round(coalesce(i.valor_venta, 0))::bigint;
  if v_valor <= 0 then return jsonb_build_object('ok', false, 'error', 'sin_valor'); end if;
  insert into public.agenda_negociaciones (empresa_id, cita_id, inmueble_id, numero_inmueble, cliente_nombre, cliente_email, valor_publicado)
  values (c.empresa_id, c.id, c.inmueble_id, i.numero, c.cliente_nombre, lower(trim(c.cliente_email)), v_valor)
  on conflict (cita_id) do nothing;
  get diagnostics v_filas = row_count;
  v_creada := v_filas > 0;
  select * into n from public.agenda_negociaciones where cita_id = p_cita_id;
  return jsonb_build_object('ok', true, 'creada', v_creada, 'id', n.id, 'empresa_id', n.empresa_id, 'token_comprador', n.token_comprador,
    'token_propietario', n.token_propietario, 'numero_inmueble', n.numero_inmueble, 'inmueble_id', n.inmueble_id, 'cita_id', n.cita_id,
    'cliente_email', n.cliente_email, 'valor_publicado', n.valor_publicado);
end;
$function$;

-- Vista de una negociación para quien tiene un token (comprador o propietario). Cada parte ve lo mismo salvo la identidad de la otra.
create or replace function public.agenda_negociacion_ver(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n record; v_rol text; i record; v_nombre text; v_movs jsonb; v_promesa boolean; v_estado text;
begin
  select * into n from public.agenda_negociaciones where token_comprador = p_token or token_propietario = p_token;
  if not found then return jsonb_build_object('error', 'no_encontrada'); end if;
  v_rol := case when n.token_comprador = p_token then 'comprador' else 'propietario' end;
  if n.estado = 'abierta' and n.vence_en < now() then
    update public.agenda_negociaciones set estado = 'vencida', actualizado_en = now() where id = n.id;
  end if;
  v_estado := case when n.estado = 'abierta' and n.vence_en < now() then 'vencida' else n.estado end;
  select direccion, barrio, ciudad into i from public.agenda_inmuebles where id = n.inmueble_id;
  select coalesce(nombre_comercial, '') into v_nombre from public.agenda_configuracion where empresa_id = n.empresa_id;
  select coalesce(jsonb_agg(jsonb_build_object('de', m.de, 'accion', m.accion, 'valor', m.valor, 'en', m.creado_en) order by m.creado_en), '[]'::jsonb)
    into v_movs from public.agenda_negociacion_movimientos m where m.negociacion_id = n.id;
  select exists (select 1 from public.agenda_negociacion_promesa p where p.negociacion_id = n.id) into v_promesa;
  return jsonb_build_object('rol', v_rol, 'estado', v_estado, 'turno', n.turno, 'numero_inmueble', n.numero_inmueble,
    'direccion', i.direccion, 'barrio', i.barrio, 'ciudad', i.ciudad, 'valor_publicado', n.valor_publicado, 'valor_vigente', n.valor_vigente,
    'valor_acordado', n.valor_acordado, 'vence_en', n.vence_en, 'movimientos', v_movs, 'promesa_enviada', v_promesa, 'empresa', v_nombre,
    'empresa_id', n.empresa_id);
end;
$function$;

-- Un movimiento de la negociación. Solo en el turno de quien tiene el token; el valor es el único dato libre (número entero).
create or replace function public.agenda_negociacion_mover(p_token uuid, p_accion text, p_valor bigint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n record; v_rol text; v_otro text; v_accion text;
begin
  select * into n from public.agenda_negociaciones where token_comprador = p_token or token_propietario = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrada'); end if;
  v_rol := case when n.token_comprador = p_token then 'comprador' else 'propietario' end;
  v_otro := case when v_rol = 'comprador' then 'propietario' else 'comprador' end;
  if n.estado = 'abierta' and n.vence_en < now() then
    update public.agenda_negociaciones set estado = 'vencida', actualizado_en = now() where id = n.id;
    return jsonb_build_object('ok', false, 'error', 'cerrada', 'estado', 'vencida');
  end if;
  if n.estado <> 'abierta' then return jsonb_build_object('ok', false, 'error', 'cerrada', 'estado', n.estado); end if;
  if n.turno <> v_rol then return jsonb_build_object('ok', false, 'error', 'no_es_su_turno'); end if;
  if p_accion not in ('proponer', 'aceptar', 'rechazar') then return jsonb_build_object('ok', false, 'error', 'accion_invalida'); end if;
  if p_accion = 'proponer' and (select count(*) from public.agenda_negociacion_movimientos where negociacion_id = n.id) >= 14 then
    update public.agenda_negociaciones set estado = 'sin_acuerdo', actualizado_en = now() where id = n.id;
    return jsonb_build_object('ok', false, 'error', 'cerrada', 'estado', 'sin_acuerdo');
  end if;

  if p_accion = 'proponer' then
    if p_valor is null or p_valor < (n.valor_publicado * 3 / 10) or p_valor > (n.valor_publicado * 3 / 2) then
      return jsonb_build_object('ok', false, 'error', 'valor_invalido');
    end if;
    v_accion := case when v_rol = 'comprador' then 'propuesta' else 'contrapropuesta' end;
    insert into public.agenda_negociacion_movimientos (negociacion_id, empresa_id, de, accion, valor) values (n.id, n.empresa_id, v_rol, v_accion, p_valor);
    update public.agenda_negociaciones set valor_vigente = p_valor, turno = v_otro, vence_en = now() + interval '7 days', actualizado_en = now() where id = n.id;
    return jsonb_build_object('ok', true, 'evento', v_accion, 'de', v_rol, 'estado', 'abierta', 'turno', v_otro, 'valor', p_valor, 'negociacion_id', n.id, 'empresa_id', n.empresa_id);
  elsif p_accion = 'aceptar' then
    if n.valor_vigente is null then return jsonb_build_object('ok', false, 'error', 'sin_valor'); end if;
    insert into public.agenda_negociacion_movimientos (negociacion_id, empresa_id, de, accion, valor) values (n.id, n.empresa_id, v_rol, 'acepta', n.valor_vigente);
    update public.agenda_negociaciones set estado = 'acordada', valor_acordado = n.valor_vigente, actualizado_en = now() where id = n.id;
    return jsonb_build_object('ok', true, 'evento', 'acepta', 'de', v_rol, 'estado', 'acordada', 'valor', n.valor_vigente, 'negociacion_id', n.id, 'empresa_id', n.empresa_id);
  else
    insert into public.agenda_negociacion_movimientos (negociacion_id, empresa_id, de, accion, valor) values (n.id, n.empresa_id, v_rol, 'rechaza', null);
    update public.agenda_negociaciones set estado = 'sin_acuerdo', actualizado_en = now() where id = n.id;
    return jsonb_build_object('ok', true, 'evento', 'rechaza', 'de', v_rol, 'estado', 'sin_acuerdo', 'negociacion_id', n.id, 'empresa_id', n.empresa_id);
  end if;
end;
$function$;

-- Datos del comprador para preparar la promesa: solo con el token del comprador y cuando el valor ya fue acordado.
create or replace function public.agenda_negociacion_promesa_guardar(p_token uuid, p_datos jsonb, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n record; v_previo integer;
begin
  select * into n from public.agenda_negociaciones where token_comprador = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrada'); end if;
  if n.estado <> 'acordada' then return jsonb_build_object('ok', false, 'error', 'no_acordada'); end if;
  select cambios into v_previo from public.agenda_negociacion_promesa where negociacion_id = n.id;
  if v_previo is not null and v_previo >= 3 then return jsonb_build_object('ok', false, 'error', 'limite'); end if;
  insert into public.agenda_negociacion_promesa (negociacion_id, empresa_id, tipo_persona, nombre_completo, tipo_documento, numero_documento,
    representante_legal, estado_civil, email, celular, direccion, compra_con_otros, otros_compradores, forma_pago, texto_autorizacion)
  values (n.id, n.empresa_id, p_datos ->> 'tipo_persona', p_datos ->> 'nombre_completo', p_datos ->> 'tipo_documento', p_datos ->> 'numero_documento',
    nullif(p_datos ->> 'representante_legal', ''), nullif(p_datos ->> 'estado_civil', ''), p_datos ->> 'email', p_datos ->> 'celular', nullif(p_datos ->> 'direccion', ''),
    coalesce((p_datos ->> 'compra_con_otros')::boolean, false), nullif(p_datos ->> 'otros_compradores', ''), p_datos ->> 'forma_pago', left(coalesce(p_texto, ''), 900))
  on conflict (negociacion_id) do update set tipo_persona = excluded.tipo_persona, nombre_completo = excluded.nombre_completo,
    tipo_documento = excluded.tipo_documento, numero_documento = excluded.numero_documento, representante_legal = excluded.representante_legal,
    estado_civil = excluded.estado_civil, email = excluded.email, celular = excluded.celular, direccion = excluded.direccion,
    compra_con_otros = excluded.compra_con_otros, otros_compradores = excluded.otros_compradores, forma_pago = excluded.forma_pago,
    texto_autorizacion = excluded.texto_autorizacion, cambios = public.agenda_negociacion_promesa.cambios + 1, autorizado_en = now(), actualizado_en = now();
  return jsonb_build_object('ok', true, 'nuevo', v_previo is null, 'negociacion_id', n.id, 'empresa_id', n.empresa_id);
exception when check_violation or invalid_text_representation or not_null_violation then
  return jsonb_build_object('ok', false, 'error', 'datos_invalidos');
end;
$function$;

-- Panel interno: negociaciones de la empresa con su historial y los datos de la promesa. Las ve quien tiene el permiso «pendientes.gestionar»
-- (administración/coordinación), el asesor de la cita y los supervisores de ese asesor.
create or replace function public.agenda_negociaciones_listar(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_todas boolean; v_res jsonb;
begin
  v_todas := public.agenda_tiene_permiso(p_empresa_id, 'pendientes.gestionar');
  select coalesce(jsonb_agg(x order by x ->> 'actualizado_en' desc), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
      'id', n.id, 'numero_inmueble', n.numero_inmueble, 'direccion', i.direccion, 'cliente_nombre', n.cliente_nombre, 'asesor', a.nombre,
      'estado', case when n.estado = 'abierta' and n.vence_en < now() then 'vencida' else n.estado end, 'turno', n.turno, 'valor_publicado', n.valor_publicado,
      'valor_vigente', n.valor_vigente, 'valor_acordado', n.valor_acordado, 'vence_en', n.vence_en, 'creado_en', n.creado_en, 'actualizado_en', n.actualizado_en,
      'movimientos', (select coalesce(jsonb_agg(jsonb_build_object('de', m.de, 'accion', m.accion, 'valor', m.valor, 'en', m.creado_en) order by m.creado_en), '[]'::jsonb)
                      from public.agenda_negociacion_movimientos m where m.negociacion_id = n.id),
      'promesa', (select to_jsonb(p) - 'negociacion_id' - 'empresa_id' from public.agenda_negociacion_promesa p where p.negociacion_id = n.id)
    ) as x
    from public.agenda_negociaciones n
    left join public.agenda_citas c on c.id = n.cita_id
    left join public.agenda_asesores a on a.id = c.asesor_id
    left join public.agenda_inmuebles i on i.id = n.inmueble_id
    where n.empresa_id = p_empresa_id
      and (v_todas or a.usuario_id = auth.uid()
           or exists (select 1 from public.agenda_asesor_supervisores s where s.asesor_id = a.id and s.supervisor_usuario_id = auth.uid()))
    order by n.actualizado_en desc limit 300
  ) q;
  return v_res;
end;
$function$;

revoke all on function public.agenda_negociacion_crear(uuid) from public, anon, authenticated;
revoke all on function public.agenda_negociacion_ver(uuid) from public, anon, authenticated;
revoke all on function public.agenda_negociacion_mover(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.agenda_negociacion_promesa_guardar(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.agenda_negociaciones_listar(uuid) from public, anon;
grant execute on function public.agenda_negociacion_crear(uuid) to service_role;
grant execute on function public.agenda_negociacion_ver(uuid) to service_role;
grant execute on function public.agenda_negociacion_mover(uuid, text, bigint) to service_role;
grant execute on function public.agenda_negociacion_promesa_guardar(uuid, jsonb, text) to service_role;
grant execute on function public.agenda_negociaciones_listar(uuid) to authenticated, service_role;
