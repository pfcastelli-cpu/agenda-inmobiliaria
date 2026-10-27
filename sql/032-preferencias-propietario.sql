-- 032 · Preferencias de correo del propietario (sustituye al «solicitar la baja» por correo)
-- Cada propietario (por correo y empresa) elige: un correo con cada visita, resumen semanal, resumen mensual o ninguno, y si quiere
-- recibir publicidad. La página pública /preferencias/<token> lo guarda; los correos al propietario lo respetan
-- (enviar-correo-propietario, notificar-cambio-cita, enviar-informe-propietario y el nuevo enviar-resumen-propietarios).
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/032-preferencias-propietario.sql

create table if not exists public.agenda_propietario_preferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  email text not null,
  token uuid not null unique default gen_random_uuid(),
  frecuencia text not null default 'cada_cita' check (frecuencia in ('cada_cita','semanal','mensual','ninguna')),
  publicidad boolean not null default true,
  ultimo_resumen_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, email)
);

alter table public.agenda_propietario_preferencias enable row level security;
drop policy if exists agenda_propietario_pref_lectura on public.agenda_propietario_preferencias;
create policy agenda_propietario_pref_lectura on public.agenda_propietario_preferencias for select to authenticated
  using (exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_propietario_preferencias.empresa_id and m.usuario_id = auth.uid() and m.activo));
grant select on public.agenda_propietario_preferencias to authenticated;
grant select, insert, update, delete on public.agenda_propietario_preferencias to service_role;

-- Pública: quien tiene el enlace ve y cambia SUS preferencias (el token es la credencial).
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
    'empresa', v_nombre,
    'correo', regexp_replace(v.email, '^(.{2}).*(@.*)$', '\1***\2')
  );
end;
$function$;

create or replace function public.agenda_preferencias_guardar(p_token uuid, p_frecuencia text, p_publicidad boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_frecuencia not in ('cada_cita','semanal','mensual','ninguna') then
    raise exception 'Opción no válida';
  end if;
  update public.agenda_propietario_preferencias
     set frecuencia = p_frecuencia, publicidad = coalesce(p_publicidad, true), actualizado_en = now()
   where token = p_token;
  if not found then
    raise exception 'Este enlace no funciona o ya venció.';
  end if;
end;
$function$;

revoke all on function public.agenda_preferencias_obtener(uuid) from public;
revoke all on function public.agenda_preferencias_guardar(uuid, text, boolean) from public;
grant execute on function public.agenda_preferencias_obtener(uuid) to anon, authenticated, service_role;
grant execute on function public.agenda_preferencias_guardar(uuid, text, boolean) to anon, authenticated, service_role;

-- Cron del resumen (ejecutar a mano DESPUÉS de desplegar enviar-resumen-propietarios con --no-verify-jwt).
-- Corre todos los días a las 7:00 a. m. (Bogotá); la función decide quién toca (lunes = semanal, día 1 = mensual) y no repite envíos.
--   select cron.schedule('propietarios-resumen', '0 12 * * *', $job$
--     select net.http_post(
--       url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/enviar-resumen-propietarios',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')),
--       body := '{}'::jsonb) $job$);
