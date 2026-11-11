-- 072 · Datos para los botones (Waze, Maps, llamar, WhatsApp) de la página que ve el cliente al agendar.
-- Devuelve solo lo necesario de UNA cita de visita (el id de la cita es el que la página acaba de recibir): nombre y celular del asesor,
-- dirección y coordenadas del inmueble. Es la misma información que ya va en el correo de confirmación.
-- Idempotente; solo agrega una función. APLICADO en producción el 11-nov-2026.
create or replace function public.agenda_contacto_visita_publica(p_cita_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'asesor_nombre', a.nombre,
    'asesor_celular', a.celular,
    'direccion', i.direccion,
    'ciudad', i.ciudad,
    'barrio', i.barrio,
    'latitud', i.latitud,
    'longitud', i.longitud
  )
  from public.agenda_citas c
  left join public.agenda_asesores a on a.id = c.asesor_id
  left join public.agenda_inmuebles i on i.id = c.inmueble_id
  where c.id = p_cita_id and c.tipo_cita = 'visita_cliente' and c.estado <> 'cancelada';
$function$;

revoke all on function public.agenda_contacto_visita_publica(uuid) from public;
grant execute on function public.agenda_contacto_visita_publica(uuid) to anon, authenticated, service_role;
