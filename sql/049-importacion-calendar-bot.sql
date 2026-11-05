-- 049 · Citas importadas de Google Calendar e intereses del bot de WhatsApp (solo para informes a propietarios).
-- Son tablas APARTE de agenda_citas a propósito: así lo importado NUNCA dispara correos, encuestas ni recordatorios del sistema nuevo.
-- Las escribe únicamente el script de Apps Script (service_role); la app solo lee (RLS por empresa).
-- APLICADO 2026-11-05 (migraciones «importacion_calendar_bot» y «citas_calendar_sin_datos_personales»; este archivo ya refleja el estado final).
-- PRIVACIDAD: no se guarda nombre, correo ni teléfono del cliente ni el WhatsApp del bot, solo una huella anónima.

create table if not exists public.agenda_citas_calendar (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  evento_id text not null,                       -- id del evento en Google Calendar (evita duplicados al re-importar)
  ciudad text not null default '',
  calendario_asesor text not null default '',    -- asesor dueño del calendario (ej. Luis Jiménez)
  numero_inmueble integer,                       -- «Código inmueble» de la descripción; null = por revisar
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  asesor_nombre text not null default '',
  cliente_huella text not null default '',       -- SHA-256 (con la empresa como sal) del correo o teléfono: cuenta personas distintas sin identificarlas
  direccion text not null default '',
  titulo text not null default '',
  inicio timestamptz not null,
  fin timestamptz not null,
  estado text not null default 'activa' check (estado in ('activa', 'eliminada')),  -- eliminada = ya no está en Calendar
  importado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, evento_id)
);
create index if not exists agenda_citas_calendar_inmueble_idx on public.agenda_citas_calendar (empresa_id, numero_inmueble, inicio);
create index if not exists agenda_citas_calendar_inicio_idx on public.agenda_citas_calendar (empresa_id, inicio);
create index if not exists agenda_citas_calendar_huella_idx on public.agenda_citas_calendar (empresa_id, numero_inmueble, cliente_huella);

create table if not exists public.agenda_intereses_bot (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  clave text not null,                           -- fecha|contacto|código: evita duplicados
  fecha timestamptz not null,
  ciudad text not null default '',
  contacto_huella text not null default '',      -- huella anónima del WhatsApp; los informes solo muestran conteos
  interes text not null default '',              -- arriendo | venta
  tipo_inmueble text not null default '',
  numero_inmueble integer,                       -- null si el bot escribió «No especificado»
  direccion text not null default '',
  agendo_cita boolean not null default false,
  importado_en timestamptz not null default now(),
  unique (empresa_id, clave)
);
create index if not exists agenda_intereses_bot_inmueble_idx on public.agenda_intereses_bot (empresa_id, numero_inmueble, fecha);
create index if not exists agenda_intereses_bot_huella_idx on public.agenda_intereses_bot (empresa_id, numero_inmueble, contacto_huella);

alter table public.agenda_citas_calendar enable row level security;
alter table public.agenda_intereses_bot enable row level security;
revoke all on public.agenda_citas_calendar, public.agenda_intereses_bot from public, anon, authenticated;
grant select on public.agenda_citas_calendar, public.agenda_intereses_bot to authenticated;
grant select, insert, update, delete on public.agenda_citas_calendar, public.agenda_intereses_bot to service_role;

create policy citas_calendar_lectura on public.agenda_citas_calendar for select to authenticated using (
  exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_citas_calendar.empresa_id and m.usuario_id = auth.uid() and m.activo)
);
create policy intereses_bot_lectura on public.agenda_intereses_bot for select to authenticated using (
  exists (select 1 from public.agenda_miembros m where m.empresa_id = agenda_intereses_bot.empresa_id and m.usuario_id = auth.uid() and m.activo)
);
