-- 061 · Festivos de Colombia automáticos (Ley Emiliani + Semana Santa), sin escribirlos uno por uno.
-- Es seguro repetirlo: no duplica fechas que ya existan. NO borra ni cambia nada existente.
-- Aplicar (con permiso de Felipe): npx --no-install supabase db query --linked --project-ref ykiuuxludyonkhywtmgu -f sql/061-festivos-automaticos.sql

create or replace function public.agenda_generar_festivos_co(p_anio integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  a int := p_anio % 19; b int := p_anio / 100; c int := p_anio % 100;
  d int := (p_anio / 100) / 4; e int := (p_anio / 100) % 4;
  f int := ((p_anio / 100) + 8) / 25; g int := ((p_anio / 100) - ((p_anio / 100) + 8) / 25 + 1) / 3;
  h int; i int; k int; l int; m int; mes int; dia int;
  pascua date;
  n int := 0;
  r record;
begin
  -- Domingo de Pascua (algoritmo de Meeus/Jones/Butcher)
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  pascua := make_date(p_anio, mes, dia);

  for r in
    select * from (values
      -- fijos
      (make_date(p_anio, 1, 1), 'Año Nuevo'),
      (make_date(p_anio, 5, 1), 'Día del Trabajo'),
      (make_date(p_anio, 7, 20), 'Día de la Independencia'),
      (make_date(p_anio, 8, 7), 'Batalla de Boyacá'),
      (make_date(p_anio, 12, 8), 'Inmaculada Concepción'),
      (make_date(p_anio, 12, 25), 'Navidad'),
      -- Semana Santa (no se trasladan)
      (pascua - 3, 'Jueves Santo'),
      (pascua - 2, 'Viernes Santo'),
      -- trasladados al lunes siguiente (Ley Emiliani)
      (make_date(p_anio, 1, 6)   + ((8 - extract(isodow from make_date(p_anio, 1, 6))::int) % 7), 'Día de los Reyes Magos'),
      (make_date(p_anio, 3, 19)  + ((8 - extract(isodow from make_date(p_anio, 3, 19))::int) % 7), 'Día de San José'),
      (make_date(p_anio, 6, 29)  + ((8 - extract(isodow from make_date(p_anio, 6, 29))::int) % 7), 'San Pedro y San Pablo'),
      (make_date(p_anio, 8, 15)  + ((8 - extract(isodow from make_date(p_anio, 8, 15))::int) % 7), 'Asunción de la Virgen'),
      (make_date(p_anio, 10, 12) + ((8 - extract(isodow from make_date(p_anio, 10, 12))::int) % 7), 'Día de la Raza'),
      (make_date(p_anio, 11, 1)  + ((8 - extract(isodow from make_date(p_anio, 11, 1))::int) % 7), 'Todos los Santos'),
      (make_date(p_anio, 11, 11) + ((8 - extract(isodow from make_date(p_anio, 11, 11))::int) % 7), 'Independencia de Cartagena'),
      -- basados en la Pascua, también al lunes
      (pascua + 39 + ((8 - extract(isodow from pascua + 39)::int) % 7), 'Ascensión del Señor'),
      (pascua + 60 + ((8 - extract(isodow from pascua + 60)::int) % 7), 'Corpus Christi'),
      (pascua + 68 + ((8 - extract(isodow from pascua + 68)::int) % 7), 'Sagrado Corazón')
    ) as t(fecha, nombre)
  loop
    if not exists (select 1 from public.agenda_festivos x where x.pais = 'CO' and x.fecha = r.fecha) then
      insert into public.agenda_festivos (pais, fecha, nombre) values ('CO', r.fecha, r.nombre);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.agenda_generar_festivos_co(integer) from public, anon, authenticated;
grant execute on function public.agenda_generar_festivos_co(integer) to service_role;

-- Carga el año actual y los dos siguientes ahora mismo.
select public.agenda_generar_festivos_co(y) from generate_series(extract(year from now())::int, extract(year from now())::int + 2) y;

-- Cada 1 de diciembre agrega el año que viene (y los dos siguientes) automáticamente.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('festivos-colombia-anual', '0 6 1 12 *',
      $c$select public.agenda_generar_festivos_co(y) from generate_series(extract(year from now())::int + 1, extract(year from now())::int + 3) y$c$);
  end if;
end $$;
