-- Correos archivados por INMUEBLE y CONTRATO (historial de cada arriendo) + resumen breve por contrato.
-- Los escribe el lector automático (sincronizacion/archivo-correos-inmuebles.gs, con la service_role).
-- La pantalla solo los lee; el equipo puede corregir a qué inmueble/contrato pertenece y marcar lo ya anotado en Sedi.
-- Se guarda RESUMEN + ENLACES (Gmail y Drive), nunca el texto completo del correo.
-- No se borra nada: lo que no importa se marca 'descartado'.

-- Dependencia (misma definición que sql/120): quién gestiona casos. Con «create or replace» es seguro aunque 120 se aplique después.
create or replace function public.agenda_gestiona_casos(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.agenda_rol_actual(p_empresa_id) in ('administrador', 'coordinador'), false)
$$;
revoke all on function public.agenda_gestiona_casos(uuid) from public, anon;
grant execute on function public.agenda_gestiona_casos(uuid) to authenticated, service_role;

create table if not exists public.agenda_inmueble_correos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  inmueble_cod text,                      -- N° de inmueble en Sedi (null = por asignar)
  contrato_ref text,                      -- p. ej. CT-7960 (null = por asignar)
  buzon text not null,                    -- solicitudes@, info@ o contabilidad@
  mensaje_id text not null,               -- id del mensaje en Gmail (evita duplicados)
  hilo_id text,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  fecha timestamptz not null,             -- fecha REAL del correo
  de text, para text,
  asunto text,
  categoria text,                         -- TERMINACION, ENTREGA, REPARACION, PAGO, OTRO...
  parte text not null default 'otro' check (parte in ('propietario', 'arrendatario', 'interno', 'otro')),
  resumen text,
  adjuntos jsonb not null default '[]'::jsonb,   -- [{nombre, url}] (archivos guardados en Drive)
  enlace_gmail text,
  enlace_drive text,                      -- carpeta con el correo (.html) y sus adjuntos
  asignacion text not null default 'auto' check (asignacion in ('auto', 'por_revisar', 'confirmada')),
  estado text not null default 'activo' check (estado in ('activo', 'descartado')),
  sedi_estado text not null default 'pendiente' check (sedi_estado in ('pendiente', 'hecho', 'omitido', 'error')),
  sedi_texto text,                        -- texto (≤ 400) listo para pegar como seguimiento en Sedi
  sedi_hecho_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (empresa_id, buzon, mensaje_id)
);
create index if not exists agenda_inmueble_correos_idx on public.agenda_inmueble_correos (empresa_id, inmueble_cod, fecha desc);
create index if not exists agenda_inmueble_correos_sedi_idx on public.agenda_inmueble_correos (empresa_id, sedi_estado) where estado = 'activo';

-- Resumen breve de cada contrato (lo que pasó con el propietario y con el arrendatario). Lo regenera el lector.
create table if not exists public.agenda_inmueble_contratos_resumen (
  empresa_id uuid not null,
  inmueble_cod text not null,
  contrato_ref text not null,
  resumen_propietario text,
  resumen_arrendatario text,
  correos int not null default 0,
  primer_correo timestamptz,
  ultimo_correo timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (empresa_id, inmueble_cod, contrato_ref)
);

alter table public.agenda_inmueble_correos enable row level security;
alter table public.agenda_inmueble_contratos_resumen enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agenda_inmueble_correos', 'agenda_inmueble_contratos_resumen'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.agenda_gestiona_casos(empresa_id))', t || '_leer', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Desde la pantalla solo se corrige la asignación, se descarta y se marca lo anotado en Sedi (nada más).
drop policy if exists agenda_inmueble_correos_actualizar on public.agenda_inmueble_correos;
create policy agenda_inmueble_correos_actualizar on public.agenda_inmueble_correos for update to authenticated
  using (public.agenda_gestiona_casos(empresa_id)) with check (public.agenda_gestiona_casos(empresa_id));
revoke update on public.agenda_inmueble_correos from authenticated;
grant update (inmueble_cod, contrato_ref, asignacion, estado, sedi_estado, sedi_hecho_en, parte) on public.agenda_inmueble_correos to authenticated;
