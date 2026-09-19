-- Entrega 003 | Ejecutar UNA sola vez en SQL Editor de Supabase, como admin del proyecto.
-- No modifica ni repite 001 ni 002. No toca las hojas de Google Sheets ni el calendario:
-- este archivo solo crea tablas nuevas en Supabase. No se ejecuta automáticamente:
-- Felipe debe revisarlo y correrlo él mismo cuando esté listo.
begin;

-- ============================================================
-- agenda_inmuebles: espejo de solo lectura del inventario real
-- (hoy viene de la hoja de Sheets de Sedi; el día que Sedi habilite
-- una API para este desarrollo, el trabajo de sincronización cambia
-- de fuente, pero esta tabla no tiene que cambiar).
-- Esta tabla la escribe SIEMPRE un trabajo de sincronización con la
-- llave service_role (nunca el navegador). Por eso no se otorgan
-- permisos de escritura a 'authenticated': solo lectura desde la app.
-- ============================================================
create table public.agenda_inmuebles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete restrict,
  numero_inmueble integer not null,
  estado_inmueble text not null default '',
  estado_crm text not null default '',
  tipo_oferta text not null check (tipo_oferta in ('Venta', 'Arriendo')),
  tipo_inmueble text not null default '',
  uso_inmueble text not null default '',
  direccion text not null check (length(trim(direccion)) > 0),
  pais text not null default 'COLOMBIA',
  ciudad text not null default '',
  localidad text not null default '',
  barrio text not null default '',
  -- numeric(9,6): suficiente para coordenadas de edificio, no de ciudad.
  latitud numeric(9,6),
  longitud numeric(9,6),
  asesor_captacion text not null default '',
  asesor_comercializacion text not null default '',
  habitaciones smallint,
  banos smallint,
  parqueaderos smallint,
  ubicacion_llave text not null default '',
  restricciones_visita text not null default '',
  descripcion text not null default '',
  valor_canon numeric,
  valor_venta numeric,
  canon_tarifa_comision numeric,
  venta_tarifa_comision numeric,
  -- Derivado por el trabajo de sincronización a partir de estado_inmueble/estado_crm.
  disponible boolean not null default true,
  -- No se borra un inmueble solo porque falte en una corrida de sincronización:
  -- se marca aquí, y el trabajo de sincronización decide cuándo es seguro
  -- tratarlo como retirado (por ejemplo, tras varias corridas seguidas sin verlo).
  visto_en_ultima_sincronizacion boolean not null default true,
  -- Cuántas corridas seguidas de sincronización NO lo encontraron en la hoja.
  -- El trabajo de sincronización decide, con este contador, cuándo es seguro
  -- marcar el inmueble como no disponible (por ejemplo, al llegar a 3).
  veces_no_visto integer not null default 0,
  sincronizado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero_inmueble)
);
create index agenda_inmuebles_empresa_idx on public.agenda_inmuebles(empresa_id);
create index agenda_inmuebles_disponible_idx on public.agenda_inmuebles(empresa_id, disponible);

alter table public.agenda_inmuebles enable row level security;
revoke all on public.agenda_inmuebles from public, anon, authenticated;
grant select on public.agenda_inmuebles to authenticated;
create policy inmuebles_lectura on public.agenda_inmuebles for select to authenticated using (
  exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_inmuebles.empresa_id and m.usuario_id = auth.uid() and m.activo)
);
-- Sin políticas de insert/update/delete para 'authenticated' a propósito:
-- solo el trabajo de sincronización (con service_role, que ignora RLS) escribe aquí.

-- ============================================================
-- agenda_citas: el motor de reservas real. Reemplaza al calendario de
-- Google como fuente de verdad, pero NO reemplaza el correo/recordatorio
-- al cliente: evento_calendar_id queda listo para que un paso posterior
-- cree el evento en Calendar a partir de la cita ya confirmada aquí.
-- Todavía NO incluye el algoritmo de prioridad ni de agrupación por
-- zona/traslados: esta es solo la tabla. Esa lógica va en el siguiente
-- paso, en la aplicación, no en esta migración.
-- ============================================================
create table public.agenda_citas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete restrict,
  inmueble_id uuid not null references public.agenda_inmuebles(id) on delete restrict,
  asesor_id uuid references public.agenda_asesores(id) on delete set null,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null check (hora_fin > hora_inicio),
  cliente_nombre text not null check (length(trim(cliente_nombre)) > 0),
  cliente_telefono text not null default '',
  cliente_email text not null default '',
  estado text not null default 'confirmada' check (estado in ('confirmada', 'completada', 'cancelada')),
  evento_calendar_id text not null default '',
  notas text not null default '',
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index agenda_citas_empresa_fecha_idx on public.agenda_citas(empresa_id, fecha);
create index agenda_citas_asesor_fecha_idx on public.agenda_citas(asesor_id, fecha);
create index agenda_citas_inmueble_idx on public.agenda_citas(inmueble_id);

alter table public.agenda_citas enable row level security;
revoke all on public.agenda_citas from public, anon, authenticated;
grant select, insert, update on public.agenda_citas to authenticated;
create policy citas_lectura on public.agenda_citas for select to authenticated using (
  exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_citas.empresa_id and m.usuario_id = auth.uid() and m.activo)
);
create policy citas_alta on public.agenda_citas for insert to authenticated with check (
  exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_citas.empresa_id and m.usuario_id = auth.uid() and m.activo)
);
-- Edición: administradores/coordinadores de la empresa, o el mismo asesor
-- asignado (para marcar realizada/cancelada su propia visita).
create policy citas_edicion on public.agenda_citas for update to authenticated using (
  public.agenda_es_admin(empresa_id)
  or exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = agenda_citas.empresa_id and m.usuario_id = auth.uid() and m.activo and m.rol = 'coordinador'
  )
  or exists (
    select 1 from public.agenda_asesores a
    where a.id = agenda_citas.asesor_id and a.correo = (select email from auth.users where id = auth.uid())
  )
);

commit;

-- Nada que verificar contra datos reales todavía: las tablas quedan vacías
-- hasta que exista el trabajo de sincronización (siguiente paso, aparte de
-- este archivo) y hasta que se creen citas reales desde la aplicación.
