-- 036 · Interruptor para apagar temporalmente la verificación del correo en la reserva pública (solo para pruebas)
-- Hoy, un correo nuevo debe confirmar un código de 6 dígitos antes de reservar. Con verificar_correo_reserva = false la página pública no lo pide.
-- OJO: con el interruptor apagado cualquiera puede reservar con un correo ajeno; usarlo solo mientras se prueba y volver a encenderlo.
-- Es seguro repetirlo. Aplicar: npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/036-interruptor-verificacion-correo.sql

alter table public.agenda_configuracion add column if not exists verificar_correo_reserva boolean not null default true;

create or replace function public.agenda_correo_requiere_verificacion(p_correo text, p_empresa_slug text default null::text, p_host text default null::text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_empresa_id uuid;
  v_correo text := lower(trim(p_correo));
  v_confiable boolean;
  v_activa boolean;
begin
  v_empresa_id := public.agenda_resolver_empresa_publica(p_empresa_slug, p_host);
  select coalesce(verificar_correo_reserva, true) into v_activa from public.agenda_configuracion where empresa_id = v_empresa_id;
  if not coalesce(v_activa, true) then
    return false; -- interruptor apagado (modo de pruebas): no se pide el código
  end if;
  if v_correo = '' then
    return true;
  end if;

  select exists(
    select 1 from public.agenda_citas c
    where c.empresa_id = v_empresa_id and lower(trim(c.cliente_email)) = v_correo
  ) or exists(
    select 1 from public.agenda_verificaciones_contacto v
    where v.empresa_id = v_empresa_id and lower(trim(v.email)) = v_correo and v.verificado
  ) into v_confiable;

  return not v_confiable;
end;
$function$;
