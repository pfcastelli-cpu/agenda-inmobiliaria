-- PENDIENTE de aplicar. No ejecutado por Codex en producción.
-- Orden: 1) aplicar esta migración; 2) desplegar las 12 funciones de correo;
-- 3) publicar el frontend. No cambia políticas RLS, permisos de tabla ni SMTP.
begin;

create or replace function public.agenda_contacto_empresa_valido(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; s jsonb; t jsonb; n text; m int;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 65536 then return false; end if;
  foreach k in array array['sitio_web','razon_social','nit','direccion','politica_datos_url','correo_baja'] loop
    if p ? k and jsonb_typeof(p->k) is distinct from 'string' then return false; end if;
    m := case k when 'razon_social' then 180 when 'nit' then 40 when 'direccion' then 400 when 'correo_baja' then 254 else 1000 end;
    if length(coalesce(p->>k,'')) > m then return false; end if;
  end loop;
  foreach k in array array['sitio_web','politica_datos_url'] loop
    n := coalesce(p->>k,'');
    if n <> '' and (n !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' or n ~ '[[:space:]<>"'']') then return false; end if;
  end loop;
  n := coalesce(p->>'correo_baja','');
  if n <> '' and (n !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or n ~ '[<>"'']') then return false; end if;
  if p ? 'sedes' then
    if jsonb_typeof(p->'sedes') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p->'sedes') > 20 then return false; end if;
    for s in select value from jsonb_array_elements(p->'sedes') loop
      if jsonb_typeof(s) is distinct from 'object' then return false; end if;
      foreach k in array array['nombre','ciudad'] loop
        if s ? k and jsonb_typeof(s->k) is distinct from 'string' then return false; end if;
        if length(coalesce(s->>k,'')) > 100 then return false; end if;
      end loop;
      if btrim(coalesce(s->>'nombre','') || coalesce(s->>'ciudad','')) = '' then return false; end if;
      if jsonb_typeof(s->'telefonos') is distinct from 'array' then return false; end if;
      if jsonb_array_length(s->'telefonos') not between 1 and 10 then return false; end if;
      for t in select value from jsonb_array_elements(s->'telefonos') loop
        if jsonb_typeof(t) is distinct from 'object' or jsonb_typeof(t->'numero') is distinct from 'string' then return false; end if;
        n := t->>'numero';
        if length(n) > 40 or n !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(n,'[^0-9]','','g')) not between 7 and 15 then return false; end if;
        foreach k in array array['etiqueta','extension'] loop
          if t ? k and jsonb_typeof(t->k) is distinct from 'string' then return false; end if;
        end loop;
        if length(coalesce(t->>'etiqueta','')) > 60 or coalesce(t->>'extension','') !~ '^[0-9]{0,8}$' then return false; end if;
      end loop;
    end loop;
  end if;
  return true;
end;
$$;
revoke all on function public.agenda_contacto_empresa_valido(jsonb) from public, anon;
grant execute on function public.agenda_contacto_empresa_valido(jsonb) to authenticated, service_role;

alter table public.agenda_configuracion
  add column if not exists contacto_empresa jsonb not null default '{}';
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.agenda_configuracion'::regclass and conname = 'agenda_contacto_empresa_formato') then
    alter table public.agenda_configuracion add constraint agenda_contacto_empresa_formato
      check (public.agenda_contacto_empresa_valido(contacto_empresa));
  end if;
end $$;

-- El slug es único (001). Abortar si no existe la empresa esperada.
-- No buscar por nombres parecidos y no sobrescribir configuraciones ya personalizadas.
do $$ begin
  if (select count(*) from public.agenda_empresas e join public.agenda_configuracion c on c.empresa_id=e.id where e.slug = 'patrimonios') <> 1 then
    raise exception 'No se identificó una única empresa con slug patrimonios. Revisar antes de continuar.';
  end if;
end $$;
update public.agenda_configuracion c
set contacto_empresa = '{
  "sitio_web":"https://www.patrimonios.co",
  "razon_social":"Patrimonios Inmobiliarios S.A.S.",
  "nit":"900.140.990-1",
  "direccion":"Carrera 67 (Av. Boyacá) Nº 167-61, Of. 203, Centro Empresarial Colina Office Park, Bogotá",
  "politica_datos_url":"https://www.patrimonios.co/politicas/politica-de-tratamiento-de-datos",
  "correo_baja":"info@patrimonios.co",
  "sedes":[
    {"nombre":"","ciudad":"Bogotá","telefonos":[{"etiqueta":"","numero":"+57 (601) 917 9987","extension":""}]},
    {"nombre":"","ciudad":"Barranquilla","telefonos":[{"etiqueta":"","numero":"+57 (605) 319 8833","extension":""}]},
    {"nombre":"","ciudad":"Medellín","telefonos":[{"etiqueta":"","numero":"+57 (604) 590 4545","extension":""}]}
  ]
}'::jsonb,
correo_contacto = case when btrim(coalesce(c.correo_contacto,'')) = '' then 'info@patrimonios.co' else c.correo_contacto end
from public.agenda_empresas e
where c.empresa_id = e.id and e.slug = 'patrimonios' and c.contacto_empresa = '{}'::jsonb;

comment on column public.agenda_configuracion.contacto_empresa is
'Contacto y datos legales por empresa: sedes[{nombre,ciudad,telefonos[{etiqueta,numero,extension}]}], sitio_web, razon_social, nit, direccion, politica_datos_url, correo_baja. No contiene secretos.';
commit;

-- Lectura posterior a la aplicación: verificar que SOLO Patrimonios recibió sus datos.
-- select e.slug, c.correo_contacto, c.contacto_empresa
-- from public.agenda_configuracion c join public.agenda_empresas e on e.id=c.empresa_id;
