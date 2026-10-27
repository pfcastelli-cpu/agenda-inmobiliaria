-- 028 · Opiniones de la encuesta: filtro con IA antes de llegar al propietario + clave de API por empresa
-- Problema: el comentario libre del cliente iba tal cual al informe del propietario (incluso críticas a la
-- inmobiliaria o al asesor). Ahora:
--   1) la encuesta ya no promete que "va directo al propietario" (textos en opinion.js y enviar-encuesta-cliente);
--   2) el comentario original queda guardado (solo lo ve la administración en la Bitácora y en los avisos internos);
--   3) una función (filtrar-opiniones) lo pasa por IA y guarda solo lo que opina del INMUEBLE, sin datos
--      personales ni comentarios sobre la inmobiliaria/asesores (columna comentario_inmueble);
--   4) el informe del propietario muestra únicamente ese texto filtrado y ya no muestra la calificación del asesor;
--   5) la clave de API de la IA se guarda por empresa en Vault (mismo patrón que la contraseña SMTP).
-- Sin clave, o mientras no se revise, el comentario NO se muestra al propietario (falla cerrado).
-- Aplicar en Supabase (SQL Editor o CLI). Es seguro repetirlo.

-- 1) Configuración de IA por empresa -------------------------------------------------------------
alter table public.agenda_configuracion
  add column if not exists ia_clave_secret_id uuid,
  add column if not exists ia_filtro_activo boolean not null default true;

-- 2) Estado de revisión de cada comentario --------------------------------------------------------
alter table public.agenda_encuestas_cliente
  add column if not exists comentario_inmueble text,
  add column if not exists comentario_revision text,
  add column if not exists comentario_revisado_en timestamptz,
  add column if not exists comentario_intentos smallint not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_encuestas_comentario_revision_chk') then
    alter table public.agenda_encuestas_cliente
      add constraint agenda_encuestas_comentario_revision_chk
      check (comentario_revision is null or comentario_revision in ('pendiente', 'publicable', 'sin_contenido', 'error'));
  end if;
end $$;

comment on column public.agenda_encuestas_cliente.comentario_inmueble is
  'Opinión sobre el inmueble ya filtrada por IA (sin críticas a la inmobiliaria ni datos personales). Es lo único que ve el propietario.';
comment on column public.agenda_encuestas_cliente.comentario_revision is
  'pendiente = falta revisar | publicable = comentario_inmueble listo | sin_contenido = no decía nada del inmueble | error = la IA falló 3 veces.';

-- Los comentarios que ya existían quedan pendientes de revisión.
update public.agenda_encuestas_cliente
   set comentario_revision = 'pendiente'
 where comentario_revision is null
   and respondido_en is not null
   and nullif(btrim(coalesce(comentario, '')), '') is not null;

create index if not exists agenda_encuestas_comentario_pendiente_idx
  on public.agenda_encuestas_cliente (respondido_en)
  where comentario_revision = 'pendiente';

-- 3) Al responder la encuesta, el comentario queda pendiente de revisión --------------------------
create or replace function public.agenda_responder_encuesta(
  p_token uuid, p_calificacion smallint, p_comentario text,
  p_impresion text default null, p_intencion text default null, p_motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  if p_calificacion is not null and (p_calificacion < 1 or p_calificacion > 5) then
    raise exception 'Calificación fuera de rango';
  end if;
  if p_impresion is not null and p_impresion not in ('me_gusto_mucho','me_gusto','no_seguro','no_me_gusto') then
    raise exception 'Impresión no válida';
  end if;
  if p_intencion is not null and p_intencion not in ('avanzar','segunda_visita','resolver_dudas','ver_otras','no_interesa') then
    raise exception 'Intención no válida';
  end if;
  if p_motivo is not null and p_motivo not in ('precio','ubicacion','estado','tamano','ruido','no_aplica') then
    raise exception 'Motivo no válido';
  end if;

  update public.agenda_encuestas_cliente
  set calificacion = p_calificacion, comentario = p_comentario, respondido_en = now(),
      impresion = p_impresion, intencion = p_intencion, motivo = p_motivo,
      comentario_inmueble = null, comentario_intentos = 0, comentario_revisado_en = null,
      comentario_revision = case when v_comentario is null then null else 'pendiente' end
  where token = p_token
  returning id into v_id;

  if v_id is null then
    raise exception 'Encuesta no encontrada';
  end if;

  return jsonb_build_object('id', v_id);
end;
$function$;

-- 4) Informe del propietario: solo el comentario filtrado; sin la calificación del asesor ---------
create or replace function public.agenda_informe_propietario_datos(p_token uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_inmueble record;
  v_citas_total integer;
  v_ultima_fecha date;
  v_opiniones jsonb;
  v_plantilla text;
  v_enlace_propio text;
begin
  select id, empresa_id, numero_inmueble, direccion, ciudad, barrio, tipo_oferta, valor_canon, valor_venta,
         asesor_comercializacion, codigo_metrocuadrado, codigo_fincaraiz, codigo_ciencuadras,
         tiene_administracion, administracion_incluida, valor_administracion
  into v_inmueble
  from public.agenda_inmuebles
  where token_informe_propietario = p_token;

  if v_inmueble.id is null then return jsonb_build_object('error', 'no_encontrado'); end if;

  select count(*), max(fecha) into v_citas_total, v_ultima_fecha
  from public.agenda_citas
  where inmueble_id = v_inmueble.id and tipo_cita = 'visita_cliente' and estado in ('confirmada', 'completada');

  select coalesce(jsonb_agg(jsonb_build_object(
    'fuente', fuente, 'calificacion', calificacion, 'comentario', comentario, 'fecha', fecha,
    'impresion', impresion, 'intencion', intencion, 'motivo', motivo
  ) order by fecha desc), '[]'::jsonb)
  into v_opiniones
  from (
    -- Encuesta: impresión del inmueble, intención y motivo + el comentario YA filtrado por la IA.
    -- Nunca el comentario original ni la calificación del asesor.
    select 'encuesta_cliente'::text as fuente, null::smallint as calificacion,
           case when e.comentario_revision = 'publicable' then e.comentario_inmueble else null end as comentario,
           e.respondido_en::date as fecha, e.impresion, e.intencion, e.motivo
    from public.agenda_encuestas_cliente e
    where e.inmueble_id = v_inmueble.id and e.respondido_en is not null
      and (e.impresion is not null or e.intencion is not null or e.motivo is not null
           or (e.comentario_revision = 'publicable' and e.comentario_inmueble is not null))
    union all
    select 'nota_asesor'::text, null::smallint, c.feedback_cliente, c.fecha,
           null::text, null::text, null::text
    from public.agenda_citas c
    where c.inmueble_id = v_inmueble.id and c.estado = 'completada' and c.feedback_cliente is not null and c.feedback_cliente <> ''
  ) x;

  select plantilla_enlace_inmueble into v_plantilla
  from public.agenda_configuracion where empresa_id = v_inmueble.empresa_id;

  v_enlace_propio := case
    when v_plantilla is not null and v_plantilla like '%{numero}%'
      then replace(v_plantilla, '{numero}', v_inmueble.numero_inmueble::text)
    else null
  end;

  return jsonb_build_object(
    'numero_inmueble', v_inmueble.numero_inmueble, 'direccion', v_inmueble.direccion,
    'ciudad', v_inmueble.ciudad, 'barrio', v_inmueble.barrio, 'tipo_oferta', v_inmueble.tipo_oferta,
    'valor_canon', v_inmueble.valor_canon, 'valor_venta', v_inmueble.valor_venta,
    'asesor_comercializacion', v_inmueble.asesor_comercializacion,
    'citas_total', v_citas_total, 'ultima_fecha', v_ultima_fecha, 'opiniones', v_opiniones,
    'enlace_propio', v_enlace_propio,
    'codigo_metrocuadrado', v_inmueble.codigo_metrocuadrado,
    'codigo_fincaraiz', v_inmueble.codigo_fincaraiz,
    'codigo_ciencuadras', v_inmueble.codigo_ciencuadras,
    'tiene_administracion', v_inmueble.tiene_administracion,
    'administracion_incluida', v_inmueble.administracion_incluida,
    'valor_administracion', v_inmueble.valor_administracion
  );
end;
$function$;

-- 5) Clave de API de la IA (por empresa, en Vault) -------------------------------------------------
-- Guardar: solo administradores. p_clave null o vacía = conservar la actual; p_quitar = borrarla.
create or replace function public.agenda_guardar_clave_ia(
  p_empresa_id uuid, p_clave text, p_activa boolean default true, p_quitar boolean default false
) returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret_id uuid;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'No tienes permisos de administrador en esta empresa.';
  end if;

  select ia_clave_secret_id into v_secret_id from public.agenda_configuracion where empresa_id = p_empresa_id;
  if not found then
    raise exception 'No existe configuración para esta empresa.';
  end if;

  if coalesce(p_quitar, false) then
    update public.agenda_configuracion set ia_clave_secret_id = null where empresa_id = p_empresa_id;
    if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
    return;
  end if;

  if p_clave is not null and length(btrim(p_clave)) > 0 then
    if length(btrim(p_clave)) < 20 then
      raise exception 'La clave parece incompleta. Cópiala completa desde el panel de tu proveedor de IA.';
    end if;
    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, btrim(p_clave));
    else
      v_secret_id := vault.create_secret(
        btrim(p_clave), 'agenda_ia_' || p_empresa_id::text,
        'Clave de API de IA (filtro de opiniones) para empresa ' || p_empresa_id::text
      );
    end if;
  end if;

  update public.agenda_configuracion
     set ia_clave_secret_id = v_secret_id, ia_filtro_activo = coalesce(p_activa, true)
   where empresa_id = p_empresa_id;
end;
$function$;

-- Estado para la pantalla de Configuración (nunca devuelve la clave).
create or replace function public.agenda_ia_estado(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cfg record;
  v_conteo jsonb;
begin
  if not public.agenda_es_admin(p_empresa_id) then
    raise exception 'No tienes permisos de administrador en esta empresa.';
  end if;
  select ia_clave_secret_id is not null as tiene_clave, ia_filtro_activo as activa
    into v_cfg from public.agenda_configuracion where empresa_id = p_empresa_id;
  select coalesce(jsonb_object_agg(comentario_revision, n), '{}'::jsonb) into v_conteo
    from (select comentario_revision, count(*) n from public.agenda_encuestas_cliente
           where empresa_id = p_empresa_id and comentario_revision is not null group by 1) t;
  return jsonb_build_object('tiene_clave', coalesce(v_cfg.tiene_clave, false), 'activa', coalesce(v_cfg.activa, true), 'comentarios', v_conteo);
end;
$function$;

-- Leer la clave: SOLO service_role (la usa la Edge Function filtrar-opiniones). Nunca el navegador.
create or replace function public.agenda_obtener_clave_ia(p_empresa_id uuid)
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $function$
  select decrypted_secret from vault.decrypted_secrets
  where id = (select ia_clave_secret_id from public.agenda_configuracion
               where empresa_id = p_empresa_id and ia_filtro_activo);
$function$;

revoke all on function public.agenda_guardar_clave_ia(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.agenda_guardar_clave_ia(uuid, text, boolean, boolean) to authenticated, service_role;
revoke all on function public.agenda_ia_estado(uuid) from public, anon;
grant execute on function public.agenda_ia_estado(uuid) to authenticated, service_role;
revoke all on function public.agenda_obtener_clave_ia(uuid) from public, anon, authenticated;
grant execute on function public.agenda_obtener_clave_ia(uuid) to service_role;

-- 6) Cron (ejecutar a mano después de desplegar la función filtrar-opiniones, como el de reubicaciones):
--   select cron.schedule('opiniones-filtrar', '*/10 * * * *', $$
--     select net.http_post(
--       url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/filtrar-opiniones',
--       headers := '{"Content-Type":"application/json"}'::jsonb,
--       body := '{}'::jsonb) $$);
