-- 081 · El equipo puede ver y cambiar las preferencias de correo de un propietario desde la agenda (por ejemplo, si llama por teléfono
-- pidiendo que le vuelvan a avisar de las citas). Exige el permiso «pendientes.gestionar» de la empresa. Si el propietario aún no tiene
-- preferencias, se crean con los valores por defecto al guardar. Idempotente. APLICADO en producción el 12-nov-2026.

create or replace function public.agenda_preferencias_admin_obtener(p_empresa_id uuid, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v record;
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'pendientes.gestionar') then
    raise exception 'No tienes permiso para ver estas preferencias.';
  end if;
  select * into v from public.agenda_propietario_preferencias where empresa_id = p_empresa_id and lower(email) = lower(trim(p_email));
  if not found then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object('existe', true, 'email', v.email, 'frecuencia', v.frecuencia, 'frecuencia_cancelacion', v.frecuencia_cancelacion,
    'publicidad', v.publicidad, 'avisar_nueva', v.avisar_nueva, 'avisar_cambio', v.avisar_cambio, 'avisar_cancelacion', v.avisar_cancelacion,
    'actualizado_en', v.actualizado_en);
end;
$function$;

create or replace function public.agenda_preferencias_admin_guardar(p_empresa_id uuid, p_email text, p_frecuencia text, p_frecuencia_cancelacion text, p_publicidad boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_email text := lower(trim(p_email));
begin
  if not public.agenda_tiene_permiso(p_empresa_id, 'pendientes.gestionar') then
    raise exception 'No tienes permiso para cambiar estas preferencias.';
  end if;
  if v_email !~ '^\S+@\S+\.\S+$' then raise exception 'Escribe un correo válido.'; end if;
  if p_frecuencia not in ('cada_cita', 'semanal', 'mensual', 'ninguna') then raise exception 'Opción no válida.'; end if;
  if p_frecuencia_cancelacion is not null and p_frecuencia_cancelacion not in ('cada_cita', 'ninguna') then raise exception 'Opción no válida.'; end if;
  insert into public.agenda_propietario_preferencias (empresa_id, email) values (p_empresa_id, v_email)
    on conflict (empresa_id, email) do nothing;
  update public.agenda_propietario_preferencias
     set frecuencia = p_frecuencia,
         frecuencia_cancelacion = p_frecuencia_cancelacion,
         avisar_nueva = true, avisar_cambio = true, avisar_cancelacion = coalesce(p_frecuencia_cancelacion, '') <> 'ninguna',
         publicidad_actualizada_en = case when publicidad is distinct from coalesce(p_publicidad, false) then now() else publicidad_actualizada_en end,
         publicidad = coalesce(p_publicidad, false),
         actualizado_en = now()
   where empresa_id = p_empresa_id and lower(email) = v_email;
end;
$function$;

revoke all on function public.agenda_preferencias_admin_obtener(uuid, text) from public, anon;
revoke all on function public.agenda_preferencias_admin_guardar(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.agenda_preferencias_admin_obtener(uuid, text) to authenticated, service_role;
grant execute on function public.agenda_preferencias_admin_guardar(uuid, text, text, text, boolean) to authenticated, service_role;
