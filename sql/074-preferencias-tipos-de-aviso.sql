-- 074 · El propietario elige QUÉ avisos quiere recibir cuando eligió «un correo con cada visita»:
-- cuando se agenda una visita nueva, cuando cambia de hora y cuando se cancela. Por defecto, todos (como hasta ahora).
-- No toca la función agenda_preferencias_guardar (frecuencia + publicidad): los avisos se guardan con una función aparte.
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).
alter table public.agenda_propietario_preferencias
  add column if not exists avisar_nueva boolean not null default true,
  add column if not exists avisar_cambio boolean not null default true,
  add column if not exists avisar_cancelacion boolean not null default true;

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
    'publicidad', v.publicidad,
    'avisar_nueva', v.avisar_nueva,
    'avisar_cambio', v.avisar_cambio,
    'avisar_cancelacion', v.avisar_cancelacion,
    'empresa', v_nombre,
    'correo', regexp_replace(v.email, '^(.{2}).*(@.*)$', '\1***\2')
  );
end;
$function$;

create or replace function public.agenda_preferencias_guardar_avisos(p_token uuid, p_nueva boolean, p_cambio boolean, p_cancelacion boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.agenda_propietario_preferencias
     set avisar_nueva = coalesce(p_nueva, true), avisar_cambio = coalesce(p_cambio, true), avisar_cancelacion = coalesce(p_cancelacion, true),
         actualizado_en = now()
   where token = p_token;
  if not found then
    raise exception 'Este enlace no funciona o ya venció.';
  end if;
end;
$function$;

revoke all on function public.agenda_preferencias_guardar_avisos(uuid, boolean, boolean, boolean) from public;
grant execute on function public.agenda_preferencias_guardar_avisos(uuid, boolean, boolean, boolean) to anon, authenticated, service_role;
