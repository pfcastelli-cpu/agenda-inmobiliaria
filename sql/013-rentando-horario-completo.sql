-- 013: inmuebles "Rentando" ofrecen por defecto TODO el horario de la empresa.
-- Antes agenda_sugerir_horarios no devolvía nada para un inmueble rentando sin horario especial, así que si un
-- asesor olvidaba configurarlo, jamás se asignaba una cita. Ahora solo se respeta el horario especial SI existe
-- (días u horas), igual que en cualquier otro inmueble. Se quita únicamente el bloque "sin horario => nada".
-- Se aplica reescribiendo la función existente (así el resto de su lógica queda exactamente igual).
do $$
declare
  d text;
  nuevo text;
begin
  d := pg_get_functiondef('public.agenda_sugerir_horarios(uuid,uuid,date,integer)'::regprocedure);
  nuevo := regexp_replace(
    d,
    '-- Inmueble rentando[^\n]*\n\s*if lower\(coalesce\(v_inmueble\.estado_crm, ''''\)\) = ''rentando''.*?return;\s*end if;\s*',
    '',
    ''
  );
  if nuevo = d or nuevo ilike '%= ''rentando''%' then
    raise exception 'No se pudo quitar el bloque de Rentando; no se cambió nada.';
  end if;
  execute nuevo;
end $$;
