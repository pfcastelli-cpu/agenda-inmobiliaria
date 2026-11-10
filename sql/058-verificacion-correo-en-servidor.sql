-- 058 · La verificación de correo de las reservas se exige en el servidor
-- Preparado el 10-nov-2026. NO aplicado todavía (aplicar solo con orden de Felipe).
--
-- Qué arregla:
--  1. `agenda_generar_codigo_verificacion` devolvía el código a cualquier visitante.
--     Ahora solo la puede ejecutar `service_role` (la usa la función `enviar-codigo-verificacion`).
--  2. Agendar y reagendar desde la página pública no comprobaban en el servidor que el
--     correo estuviera verificado. Ahora sí (cuando `verificar_correo_reserva` está encendido).
--  3. Un mismo correo o celular no puede agendar más de 5 visitas en 6 meses (tope por
--     periodo: no depende de cuántas citas haya en total; índice por empresa + creado_en).
--  4. `agenda_correo_tiene_password` deja de ser ejecutable por visitantes sin sesión.
--
-- Cómo: las funciones actuales se renombran a `..._base` (ya no las puede llamar el
-- navegador) y se crea una función nueva con el mismo nombre y parámetros que valida y
-- luego llama a la base. El frontend no cambia. Se puede ejecutar más de una vez.
--
-- Quien tenga sesión y sea miembro activo de la empresa no pasa por estas validaciones.

begin;

-- 1) El código solo lo genera el servidor -------------------------------------------
revoke execute on function public.agenda_generar_codigo_verificacion(uuid, text) from public, anon, authenticated;
grant  execute on function public.agenda_generar_codigo_verificacion(uuid, text) to service_role;

-- 4) Saber si hay contraseña SMTP: solo con sesión ------------------------------------
revoke execute on function public.agenda_correo_tiene_password(uuid) from public, anon;
grant  execute on function public.agenda_correo_tiene_password(uuid) to authenticated, service_role;

-- 2 y 3) Validación común -----------------------------------------------------------
create index if not exists agenda_citas_empresa_creado_idx on public.agenda_citas (empresa_id, creado_en desc);

create or replace function public.agenda_validar_reserva_publica(
  p_email text, p_telefono text, p_empresa_slug text, p_host text, p_excluir_cita uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa_id uuid;
  v_correo text := lower(trim(coalesce(p_email, '')));
  v_tel text := trim(coalesce(p_telefono, ''));
  v_activas int;
  v_dominio text;
begin
  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);

  -- El equipo de la empresa (con sesión) no necesita verificar ni tiene tope.
  if auth.uid() is not null and exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = v_empresa_id and m.usuario_id = auth.uid() and m.activo
  ) then
    return;
  end if;

  if public.agenda_correo_requiere_verificacion(p_email, p_empresa_slug, p_host) then
    raise exception 'Antes de agendar necesitamos verificar tu correo. Pide el código y escríbelo para continuar.';
  end if;

  -- Los correos del dominio propio de la empresa (el del remitente configurado) no tienen tope:
  -- el equipo agenda por clientes desde la página pública. No aplica a dominios de correo gratuito.
  select lower(split_part(coalesce(nullif(trim(correo_remitente_email), ''), correo_contacto, ''), '@', 2))
    into v_dominio from public.agenda_configuracion where empresa_id = v_empresa_id;
  if coalesce(v_dominio, '') <> ''
     and v_dominio not in ('gmail.com','hotmail.com','outlook.com','outlook.es','yahoo.com','yahoo.es','live.com','icloud.com','msn.com')
     and split_part(v_correo, '@', 2) = v_dominio then
    return;
  end if;

  select count(*) into v_activas
  from public.agenda_citas c
  where c.empresa_id = v_empresa_id
    and c.estado <> 'cancelada'
    and c.tipo_cita = 'visita_cliente'
    and c.creado_en > now() - interval '6 months'
    and (p_excluir_cita is null or c.id <> p_excluir_cita)
    and ( (v_correo <> '' and lower(trim(c.cliente_email)) = v_correo)
       or (v_tel <> '' and c.cliente_telefono = v_tel) );

  if v_activas >= 5 then
    raise exception 'Ya has agendado varias visitas con nosotros. Para agendar más, escríbenos y con gusto te ayudamos.';
  end if;
end;
$$;

revoke execute on function public.agenda_validar_reserva_publica(text, text, text, text, uuid) from public, anon, authenticated;

-- Renombrar las funciones actuales a _base (solo la primera vez) ------------------------
do $$
begin
  if to_regprocedure('public.agenda_agendar_cita_publica_base(integer, date, time, text, text, text, text, text)') is null then
    alter function public.agenda_agendar_cita_publica(integer, date, time, text, text, text, text, text)
      rename to agenda_agendar_cita_publica_base;
  end if;
  if to_regprocedure('public.agenda_reagendar_cita_publica_base(uuid, integer, date, time, text, text, text, text, text)') is null then
    alter function public.agenda_reagendar_cita_publica(uuid, integer, date, time, text, text, text, text, text)
      rename to agenda_reagendar_cita_publica_base;
  end if;
end $$;

revoke execute on function public.agenda_agendar_cita_publica_base(integer, date, time, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.agenda_reagendar_cita_publica_base(uuid, integer, date, time, text, text, text, text, text) from public, anon, authenticated;

-- Funciones nuevas con el mismo nombre y parámetros que usa reservar.js ------------------
create or replace function public.agenda_agendar_cita_publica(
  p_numero_inmueble integer, p_fecha date, p_hora_inicio time,
  p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text,
  p_empresa_slug text, p_host text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.agenda_validar_reserva_publica(p_cliente_email, p_cliente_telefono, p_empresa_slug, p_host, null);
  return public.agenda_agendar_cita_publica_base(
    p_numero_inmueble, p_fecha, p_hora_inicio,
    p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_empresa_slug, p_host);
end;
$$;

create or replace function public.agenda_reagendar_cita_publica(
  p_cita_id uuid, p_numero_inmueble integer, p_fecha date, p_hora_inicio time,
  p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text,
  p_empresa_slug text, p_host text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.agenda_validar_reserva_publica(p_cliente_email, p_cliente_telefono, p_empresa_slug, p_host, p_cita_id);
  return public.agenda_reagendar_cita_publica_base(
    p_cita_id, p_numero_inmueble, p_fecha, p_hora_inicio,
    p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_empresa_slug, p_host);
end;
$$;

grant execute on function public.agenda_agendar_cita_publica(integer, date, time, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.agenda_reagendar_cita_publica(uuid, integer, date, time, text, text, text, text, text) to anon, authenticated, service_role;

commit;

-- Comprobación después de aplicar (debe dar: false, false, true, true):
-- select has_function_privilege('anon','public.agenda_generar_codigo_verificacion(uuid,text)','execute'),
--        has_function_privilege('anon','public.agenda_agendar_cita_publica_base(integer,date,time,text,text,text,text,text)','execute'),
--        has_function_privilege('anon','public.agenda_agendar_cita_publica(integer,date,time,text,text,text,text,text)','execute'),
--        has_function_privilege('service_role','public.agenda_generar_codigo_verificacion(uuid,text)','execute');
--
-- Para deshacer: borrar las dos funciones nuevas, renombrar las `_base` a su nombre original
-- y devolver `grant execute ... to anon, authenticated` a las tres funciones.
