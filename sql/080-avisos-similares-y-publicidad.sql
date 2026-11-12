-- 080 · (1) «Avisarme de inmuebles similares»: casilla opcional y sin marcar al reservar; la aceptación queda registrada y se puede dar de baja
--           con un clic (/avisos/<token>) o cambiar entre aviso semanal y mensual. Solo se usan precio, área, ubicación y tipo del inmueble
--           de referencia y el correo. Plazo de conservación sugerido por el jurídico: 12 meses sin interacción (luego reconfirmar o suprimir).
--       (2) Publicidad «Te puede interesar» a propietarios: valor por defecto NO para contactos nuevos y registro de cuándo se aceptó/retiró.
--           Los propietarios que ya existen quedan como estaban (decisión pendiente con el abogado de la empresa).
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).

create table if not exists public.agenda_avisos_similares (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  email text not null,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  frecuencia text not null default 'semanal' check (frecuencia in ('semanal', 'mensual')),
  token uuid not null default gen_random_uuid() unique,
  texto_aceptado text not null,
  canal text not null default 'reserva',
  aceptado_en timestamptz not null default now(),
  baja_en timestamptz,
  ultimo_envio_en timestamptz,
  actualizado_en timestamptz not null default now()
);
create unique index if not exists agenda_avisos_similares_uniq on public.agenda_avisos_similares (empresa_id, lower(email), inmueble_id);
alter table public.agenda_avisos_similares enable row level security;
drop policy if exists agenda_avisos_similares_lectura on public.agenda_avisos_similares;
create policy agenda_avisos_similares_lectura on public.agenda_avisos_similares for select to authenticated
  using (exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_avisos_similares.empresa_id and m.usuario_id = auth.uid() and m.activo));
grant select, insert, update, delete on public.agenda_avisos_similares to service_role;
grant select on public.agenda_avisos_similares to authenticated;

-- Registro de la aceptación: lo llama la página de reserva con el id de la cita recién creada (el id solo lo conoce quien reservó).
create or replace function public.agenda_avisos_similares_registrar(p_cita_id uuid, p_frecuencia text, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c record;
  v_token uuid;
begin
  if p_frecuencia not in ('semanal', 'mensual') then raise exception 'Opción no válida'; end if;
  select empresa_id, inmueble_id, lower(trim(cliente_email)) as email, creado_en into c
    from public.agenda_citas where id = p_cita_id;
  if not found or coalesce(c.email, '') = '' or c.creado_en < now() - interval '30 minutes' then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.agenda_avisos_similares (empresa_id, email, inmueble_id, frecuencia, texto_aceptado, canal)
  values (c.empresa_id, c.email, c.inmueble_id, p_frecuencia, left(coalesce(p_texto, ''), 600), 'reserva')
  on conflict (empresa_id, lower(email), inmueble_id)
  do update set frecuencia = excluded.frecuencia, texto_aceptado = excluded.texto_aceptado, aceptado_en = now(), baja_en = null, actualizado_en = now()
  returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$function$;

create or replace function public.agenda_avisos_similares_obtener(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v record; v_nombre text;
begin
  select * into v from public.agenda_avisos_similares where token = p_token;
  if not found then return jsonb_build_object('error', 'no_encontrada'); end if;
  select coalesce(nombre_comercial, '') into v_nombre from public.agenda_configuracion where empresa_id = v.empresa_id;
  return jsonb_build_object('frecuencia', v.frecuencia, 'activo', v.baja_en is null, 'empresa', v_nombre,
    'correo', regexp_replace(v.email, '^(.{2}).*(@.*)$', '\1***\2'));
end;
$function$;

create or replace function public.agenda_avisos_similares_guardar(p_token uuid, p_frecuencia text, p_baja boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_frecuencia is not null and p_frecuencia not in ('semanal', 'mensual') then raise exception 'Opción no válida'; end if;
  update public.agenda_avisos_similares
     set frecuencia = coalesce(p_frecuencia, frecuencia),
         baja_en = case when coalesce(p_baja, false) then now() else null end,
         actualizado_en = now()
   where token = p_token;
  if not found then raise exception 'Este enlace no funciona o ya venció.'; end if;
end;
$function$;

revoke all on function public.agenda_avisos_similares_registrar(uuid, text, text) from public;
revoke all on function public.agenda_avisos_similares_obtener(uuid) from public;
revoke all on function public.agenda_avisos_similares_guardar(uuid, text, boolean) from public;
grant execute on function public.agenda_avisos_similares_registrar(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.agenda_avisos_similares_obtener(uuid) to anon, authenticated, service_role;
grant execute on function public.agenda_avisos_similares_guardar(uuid, text, boolean) to anon, authenticated, service_role;

-- Publicidad a propietarios: por defecto NO para contactos nuevos; se registra cuándo se aceptó o se retiró.
alter table public.agenda_propietario_preferencias
  alter column publicidad set default false,
  add column if not exists publicidad_actualizada_en timestamptz;

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
     set frecuencia = p_frecuencia,
         publicidad_actualizada_en = case when publicidad is distinct from coalesce(p_publicidad, false) then now() else publicidad_actualizada_en end,
         publicidad = coalesce(p_publicidad, false),
         actualizado_en = now()
   where token = p_token;
  if not found then
    raise exception 'Este enlace no funciona o ya venció.';
  end if;
end;
$function$;
