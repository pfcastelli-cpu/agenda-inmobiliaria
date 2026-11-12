-- 083: la conversación de compra ya no se cierra sola. Vigencia de 21 días; al pasar queda «en pausa» y se reactiva con el siguiente movimiento.
-- Además: registro de contactos (clic al WhatsApp del asesor) para trazabilidad. APLICAR en Supabase (pendiente).
alter table public.agenda_negociaciones alter column vence_en set default (now() + interval '21 days');
update public.agenda_negociaciones set estado = 'abierta', actualizado_en = now() where estado = 'vencida';

create table if not exists public.agenda_negociacion_contactos (
  id uuid primary key default gen_random_uuid(),
  negociacion_id uuid not null references public.agenda_negociaciones(id) on delete cascade,
  empresa_id uuid not null,
  rol text not null check (rol in ('comprador', 'propietario')),
  canal text not null check (canal in ('whatsapp', 'llamada', 'pagina')),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_neg_contactos_neg_idx on public.agenda_negociacion_contactos (negociacion_id, creado_en);
alter table public.agenda_negociacion_contactos enable row level security;
grant select, insert, update, delete on public.agenda_negociacion_contactos to service_role;

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
  v_estado := n.estado;
  select direccion, barrio, ciudad into i from public.agenda_inmuebles where id = n.inmueble_id;
  select coalesce(nombre_comercial, '') into v_nombre from public.agenda_configuracion where empresa_id = n.empresa_id;
  select coalesce(jsonb_agg(jsonb_build_object('de', m.de, 'accion', m.accion, 'valor', m.valor, 'en', m.creado_en) order by m.creado_en), '[]'::jsonb)
    into v_movs from public.agenda_negociacion_movimientos m where m.negociacion_id = n.id;
  select exists (select 1 from public.agenda_negociacion_promesa p where p.negociacion_id = n.id) into v_promesa;
  return jsonb_build_object('rol', v_rol, 'estado', v_estado, 'turno', n.turno, 'numero_inmueble', n.numero_inmueble,
    'direccion', i.direccion, 'barrio', i.barrio, 'ciudad', i.ciudad, 'valor_publicado', n.valor_publicado, 'valor_vigente', n.valor_vigente,
    'valor_acordado', n.valor_acordado, 'vence_en', n.vence_en, 'en_pausa', (n.estado = 'abierta' and n.vence_en < now()), 'movimientos', v_movs, 'promesa_enviada', v_promesa, 'empresa', v_nombre,
    'empresa_id', n.empresa_id);
end;
$function$;

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
    update public.agenda_negociaciones set valor_vigente = p_valor, turno = v_otro, vence_en = now() + interval '21 days', actualizado_en = now() where id = n.id;
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
      'estado', n.estado, 'turno', n.turno, 'valor_publicado', n.valor_publicado,
      'valor_vigente', n.valor_vigente, 'valor_acordado', n.valor_acordado, 'vence_en', n.vence_en, 'en_pausa', (n.estado = 'abierta' and n.vence_en < now()), 'creado_en', n.creado_en, 'actualizado_en', n.actualizado_en,
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
