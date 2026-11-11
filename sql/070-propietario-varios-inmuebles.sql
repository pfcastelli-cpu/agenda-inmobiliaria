-- 070 · Informe del propietario con varios inmuebles.
-- Con el enlace de UN inmueble, el propietario ve la lista de sus otros inmuebles y salta de uno a otro.
-- Seguridad: solo aparecen los inmuebles cuyos propietarios incluyen a TODOS los propietarios del inmueble del enlace
-- (así un copropietario nunca ve inmuebles de otro propietario que no comparte). Devuelve solo lo necesario para navegar.
-- Idempotente; solo agrega una función. PENDIENTE de aplicar (con permiso de Felipe).
create or replace function public.agenda_informe_propietario_inmuebles(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v record;
  v_emails text[];
  r jsonb;
begin
  select id, empresa_id, numero_inmueble into v from public.agenda_inmuebles where token_informe_propietario = p_token;
  if v.id is null then return '[]'::jsonb; end if;

  select coalesce(array_agg(distinct e), '{}') into v_emails from (
    select lower(btrim(x)) as e
    from public.agenda_propietarios p, regexp_split_to_table(coalesce(p.email, ''), '[;,\s]+') x
    where p.empresa_id = v.empresa_id and p.numero_inmueble = v.numero_inmueble
  ) s where e like '%@%';
  if cardinality(v_emails) = 0 then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'numero_inmueble', i.numero_inmueble, 'direccion', i.direccion, 'ciudad', i.ciudad, 'barrio', i.barrio,
           'tipo_oferta', i.tipo_oferta, 'token', i.token_informe_propietario, 'actual', i.id = v.id,
           'visitas', (select count(*) from public.agenda_citas c where c.inmueble_id = i.id and c.tipo_cita = 'visita_cliente' and c.estado = 'completada')
         ) order by i.numero_inmueble), '[]'::jsonb)
    into r
  from public.agenda_inmuebles i
  where i.empresa_id = v.empresa_id
    and i.token_informe_propietario is not null
    and (i.id = v.id or (i.disponible and not coalesce(i.no_disponible_manual, false)))
    and not exists (
      select 1 from unnest(v_emails) em
      where not exists (
        select 1 from public.agenda_propietarios p2, regexp_split_to_table(lower(coalesce(p2.email, '')), '[;,\s]+') x2
        where p2.empresa_id = i.empresa_id and p2.numero_inmueble = i.numero_inmueble and btrim(x2) = em
      )
    );
  return r;
end;
$function$;

revoke all on function public.agenda_informe_propietario_inmuebles(uuid) from public;
grant execute on function public.agenda_informe_propietario_inmuebles(uuid) to anon, authenticated, service_role;
