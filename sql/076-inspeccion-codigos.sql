-- 076 · Código de llegada y de salida para las citas de INSPECCIÓN (tipo_cita = 'inspeccion').
-- Idea: al llegar, el arrendatario ve en su enlace un código de 4 dígitos y se lo dicta a quien hace la inspección; esa persona lo escribe
-- en la agenda. Al salir, otro código distinto (que el arrendatario solo ve DESPUÉS de que la llegada quedó registrada). El sistema guarda
-- las dos horas y calcula cuánto duró. Los códigos NO se pueden leer desde la agenda (sin SELECT para authenticated): solo los ve el arrendatario
-- con su enlace, y solo el día de la cita. Quien inspecciona únicamente puede probar un código con la función de abajo, con tope de intentos.
-- Idempotente. APLICADO en producción el 11-nov-2026.

alter table public.agenda_citas
  add column if not exists codigo_entrada text,
  add column if not exists codigo_salida text,
  add column if not exists entrada_verificada_en timestamptz,
  add column if not exists entrada_verificada_por uuid,
  add column if not exists salida_verificada_en timestamptz,
  add column if not exists codigo_intentos smallint not null default 0,
  add column if not exists codigo_bloqueado_hasta timestamptz;

-- La agenda puede mostrar QUÉ pasó (horas), nunca los códigos ni los intentos.
grant select (entrada_verificada_en, salida_verificada_en, entrada_verificada_por) on public.agenda_citas to authenticated;

-- Al crear (o convertir en) inspección se generan los dos códigos distintos.
create or replace function public.agenda_citas_codigos_inspeccion()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_e text;
  v_s text;
begin
  if new.tipo_cita = 'inspeccion' and new.codigo_entrada is null then
    v_e := lpad((floor(random() * 10000))::int::text, 4, '0');
    loop
      v_s := lpad((floor(random() * 10000))::int::text, 4, '0');
      exit when v_s <> v_e;
    end loop;
    new.codigo_entrada := v_e;
    new.codigo_salida := v_s;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_agenda_citas_codigos_inspeccion on public.agenda_citas;
create trigger trg_agenda_citas_codigos_inspeccion
  before insert or update of tipo_cita on public.agenda_citas
  for each row execute function public.agenda_citas_codigos_inspeccion();

-- Citas de inspección que ya existan: se les generan los códigos.
update public.agenda_citas set tipo_cita = tipo_cita where tipo_cita = 'inspeccion' and codigo_entrada is null;

-- Quien inspecciona (o un administrador/coordinador) escribe el código que le dicta el arrendatario.
-- Devuelve {ok, mensaje, ...}. Los errores se devuelven (no se lanzan) para que el contador de intentos se guarde.
create or replace function public.agenda_inspeccion_registrar_codigo(p_cita_id uuid, p_momento text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_es_asesor boolean;
  v_rol text;
  v_codigo text := btrim(coalesce(p_codigo, ''));
  v_minutos integer;
begin
  if p_momento not in ('entrada', 'salida') then
    return jsonb_build_object('ok', false, 'mensaje', 'Momento no válido.');
  end if;
  select * into v from public.agenda_citas where id = p_cita_id for update;
  if not found or v.tipo_cita <> 'inspeccion' then
    return jsonb_build_object('ok', false, 'mensaje', 'Esta cita no es una inspección.');
  end if;
  v_rol := public.agenda_rol_actual(v.empresa_id);
  select exists(select 1 from public.agenda_asesores a where a.id = v.asesor_id and a.usuario_id = auth.uid()) into v_es_asesor;
  if v_rol is null or not (v_es_asesor or v_rol in ('administrador', 'coordinador')) then
    return jsonb_build_object('ok', false, 'mensaje', 'Solo quien hace la inspección o un coordinador puede registrar el código.');
  end if;
  if v.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'mensaje', 'La cita está cancelada.');
  end if;
  if v.fecha <> v_hoy then
    return jsonb_build_object('ok', false, 'mensaje', 'El código solo se puede registrar el día de la inspección.');
  end if;
  if v.codigo_bloqueado_hasta is not null and v.codigo_bloqueado_hasta > now() then
    return jsonb_build_object('ok', false, 'mensaje', 'Demasiados intentos. Espera unos minutos y pídele el código al arrendatario otra vez.');
  end if;
  if v_codigo !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'mensaje', 'El código tiene 4 números.');
  end if;

  if p_momento = 'entrada' then
    if v.entrada_verificada_en is not null then
      return jsonb_build_object('ok', true, 'mensaje', 'La llegada ya estaba registrada.', 'entrada_en', v.entrada_verificada_en);
    end if;
    if v_codigo <> v.codigo_entrada then
      update public.agenda_citas
         set codigo_intentos = codigo_intentos + 1,
             codigo_bloqueado_hasta = case when codigo_intentos + 1 >= 5 then now() + interval '15 minutes' else null end
       where id = v.id;
      return jsonb_build_object('ok', false, 'mensaje', 'Ese código no coincide con el del arrendatario.');
    end if;
    update public.agenda_citas set entrada_verificada_en = now(), entrada_verificada_por = auth.uid(), codigo_intentos = 0, codigo_bloqueado_hasta = null where id = v.id;
    return jsonb_build_object('ok', true, 'mensaje', 'Llegada registrada. Cuando termines, pídele al arrendatario el código de salida.', 'entrada_en', now());
  end if;

  -- salida
  if v.entrada_verificada_en is null then
    return jsonb_build_object('ok', false, 'mensaje', 'Primero se registra la llegada con el código de llegada.');
  end if;
  if v.salida_verificada_en is not null then
    return jsonb_build_object('ok', true, 'mensaje', 'La salida ya estaba registrada.', 'salida_en', v.salida_verificada_en);
  end if;
  if v_codigo <> v.codigo_salida then
    update public.agenda_citas
       set codigo_intentos = codigo_intentos + 1,
           codigo_bloqueado_hasta = case when codigo_intentos + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = v.id;
    return jsonb_build_object('ok', false, 'mensaje', 'Ese código no coincide con el del arrendatario.');
  end if;
  update public.agenda_citas set salida_verificada_en = now(), codigo_intentos = 0, codigo_bloqueado_hasta = null where id = v.id;
  v_minutos := greatest(0, round(extract(epoch from (now() - v.entrada_verificada_en)) / 60)::int);
  return jsonb_build_object('ok', true, 'mensaje', 'Salida registrada. Duración de la inspección: ' || v_minutos || ' min.', 'salida_en', now(), 'minutos', v_minutos);
end;
$function$;

-- Lo que ve el arrendatario con el enlace /inspeccion/<token> (el token es su credencial). Los códigos aparecen solo el día de la cita;
-- el de salida solo cuando la llegada ya quedó registrada.
create or replace function public.agenda_inspeccion_publica(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_dir text;
  v_asesor text;
  v_empresa text;
begin
  select c.*, i.direccion as i_dir, i.barrio as i_barrio, i.ciudad as i_ciudad
    into v from public.agenda_citas c left join public.agenda_inmuebles i on i.id = c.inmueble_id
   where c.token_arrendatario = p_token and c.tipo_cita = 'inspeccion';
  if not found then return jsonb_build_object('error', 'no_encontrada'); end if;
  select a.nombre into v_asesor from public.agenda_asesores a where a.id = v.asesor_id;
  select coalesce(nombre_comercial, '') into v_empresa from public.agenda_configuracion where empresa_id = v.empresa_id;
  v_dir := concat_ws(', ', nullif(v.i_dir, ''), nullif(v.i_barrio, ''), nullif(v.i_ciudad, ''));
  return jsonb_build_object(
    'empresa', v_empresa,
    'direccion', v_dir,
    'fecha', v.fecha,
    'hora', to_char(v.hora_inicio, 'HH24:MI'),
    'motivo', coalesce(v.titulo, ''),
    'quien', coalesce(v_asesor, ''),
    'cancelada', v.estado = 'cancelada',
    'es_hoy', v.fecha = v_hoy,
    'entrada_en', v.entrada_verificada_en,
    'salida_en', v.salida_verificada_en,
    'codigo_entrada', case when v.estado <> 'cancelada' and v.fecha = v_hoy and v.entrada_verificada_en is null then v.codigo_entrada end,
    'codigo_salida', case when v.estado <> 'cancelada' and v.fecha = v_hoy and v.entrada_verificada_en is not null and v.salida_verificada_en is null then v.codigo_salida end
  );
end;
$function$;

revoke all on function public.agenda_inspeccion_registrar_codigo(uuid, text, text) from public;
revoke all on function public.agenda_inspeccion_publica(uuid) from public;
grant execute on function public.agenda_inspeccion_registrar_codigo(uuid, text, text) to authenticated, service_role;
grant execute on function public.agenda_inspeccion_publica(uuid) to anon, authenticated, service_role;
