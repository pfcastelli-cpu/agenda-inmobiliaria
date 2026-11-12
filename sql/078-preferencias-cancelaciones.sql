-- 078 · El propietario elige POR SEPARADO cómo quiere enterarse de las visitas y de las cancelaciones.
-- frecuencia_cancelacion: null = igual que las visitas (como hasta ahora) · 'cada_cita' = un correo por cada cancelación · 'ninguna' = no avisar por correo.
-- (Si el propietario eligió resumen semanal/mensual, las cancelaciones siempre aparecen en ese resumen.)
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).
alter table public.agenda_propietario_preferencias
  add column if not exists frecuencia_cancelacion text;
alter table public.agenda_propietario_preferencias drop constraint if exists agenda_propietario_pref_frec_canc_chk;
alter table public.agenda_propietario_preferencias
  add constraint agenda_propietario_pref_frec_canc_chk check (frecuencia_cancelacion is null or frecuencia_cancelacion in ('cada_cita', 'ninguna'));

create or replace function public.agenda_preferencias_obtener(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v record;
  v_nombre text;
begin
  select * into v from public.agenda_propietario_preferencias where token = p_token;
  if not found then
    return jsonb_build_object('error', 'no_encontrada');
  end if;
  select coalesce(nombre_comercial, '') into v_nombre from public.agenda_configuracion where empresa_id = v.empresa_id;
  return jsonb_build_object(
    'frecuencia', v.frecuencia,
    'frecuencia_cancelacion', v.frecuencia_cancelacion,
    'publicidad', v.publicidad,
    'avisar_nueva', v.avisar_nueva,
    'avisar_cambio', v.avisar_cambio,
    'avisar_cancelacion', v.avisar_cancelacion,
    'empresa', v_nombre,
    'correo', regexp_replace(v.email, '^(.{2}).*(@.*)$', '\1***\2')
  );
end;
$function$;

create or replace function public.agenda_preferencias_guardar_cancelacion(p_token uuid, p_frecuencia text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_frecuencia is not null and p_frecuencia not in ('cada_cita', 'ninguna') then
    raise exception 'Opción no válida';
  end if;
  update public.agenda_propietario_preferencias
     set frecuencia_cancelacion = p_frecuencia, actualizado_en = now()
   where token = p_token;
  if not found then
    raise exception 'Este enlace no funciona o ya venció.';
  end if;
end;
$function$;

revoke all on function public.agenda_preferencias_guardar_cancelacion(uuid, text) from public;
grant execute on function public.agenda_preferencias_guardar_cancelacion(uuid, text) to anon, authenticated, service_role;
