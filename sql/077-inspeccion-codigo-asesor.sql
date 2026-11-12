-- 077 · Inspecciones: «código del asesor». Al programar la inspección, el arrendatario recibe (en su correo y en su enlace) un código de 4 dígitos
-- que quien llega a inspeccionar debe DECIRLE al llegar, para comprobar que es quien dice ser. Ese mismo código le llega por correo al asesor
-- 30 minutos antes de la cita. Es distinto de los códigos de llegada y salida (sql/076), que el asesor NO conoce de antemano: así el
-- registro de llegada sigue probando que estuvo en el sitio. Idempotente. APLICADO en producción el 12-nov-2026 (cron `avisar-inspeccion-asesor` programado el 12-nov-2026).

alter table public.agenda_citas
  add column if not exists codigo_asesor text,
  add column if not exists inspeccion_asesor_avisado_en timestamptz;
-- Sin grant de SELECT sobre codigo_asesor: no se puede leer desde el navegador de la agenda (solo con service_role o la función pública).

create or replace function public.agenda_citas_codigos_inspeccion()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_e text;
  v_s text;
  v_a text;
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
  if new.tipo_cita = 'inspeccion' and new.codigo_asesor is null then
    loop
      v_a := lpad((floor(random() * 10000))::int::text, 4, '0');
      exit when v_a is distinct from new.codigo_entrada and v_a is distinct from new.codigo_salida;
    end loop;
    new.codigo_asesor := v_a;
  end if;
  return new;
end;
$function$;

-- Inspecciones que ya existan: se les genera el código del asesor.
update public.agenda_citas set tipo_cita = tipo_cita where tipo_cita = 'inspeccion' and codigo_asesor is null;

-- La página del arrendatario (/inspeccion/<token>) ahora también muestra el código del asesor mientras la inspección siga activa.
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
    'codigo_asesor', case when v.estado <> 'cancelada' and v.salida_verificada_en is null and v.fecha >= v_hoy then v.codigo_asesor end,
    'codigo_entrada', case when v.estado <> 'cancelada' and v.fecha = v_hoy and v.entrada_verificada_en is null then v.codigo_entrada end,
    'codigo_salida', case when v.estado <> 'cancelada' and v.fecha = v_hoy and v.entrada_verificada_en is not null and v.salida_verificada_en is null then v.codigo_salida end
  );
end;
$function$;

revoke all on function public.agenda_inspeccion_publica(uuid) from public;
grant execute on function public.agenda_inspeccion_publica(uuid) to anon, authenticated, service_role;

-- Aviso al asesor 30 minutos antes (función avisar-inspeccion-asesor, llamada por pg_cron cada 5 minutos con el mismo secreto de recordar-cliente).
-- select cron.schedule(
--   'avisar-inspeccion-asesor', '*/5 * * * *',
--   $$ select net.http_post(
--        url := 'https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/avisar-inspeccion-asesor',
--        headers := jsonb_build_object('Content-Type', 'application/json',
--          'x-cron-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_encuestas_secreto')),
--        body := '{}'::jsonb) $$);
-- Para apagarlo: select cron.unschedule('avisar-inspeccion-asesor');
