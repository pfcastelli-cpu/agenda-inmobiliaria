-- 010 · Visita a un inmueble "Rentando": acuerdo de horario entre arrendatario y cliente
-- El correo "Visita programada en tu vivienda" lleva un enlace /arrendatario/<token> y el
-- cliente recibe /visita/<token> cuando hay una propuesta. Todo lo hace la Edge Function
-- `portal-visita` (verify_jwt apagado: el token secreto de la URL es la credencial).
--   * El arrendatario PROPONE otra hora (no mueve la cita). El cliente acepta, rechaza o
--     contrapropone; cuando la otra parte acepta, la cita pasa a la nueva hora (en firme).
--   * El arrendatario también puede cancelar y editar los días/horas en que se muestra su vivienda.
--   * No se avisa al asesor: la agenda se coordina sola (la cita cambia en el sistema).
-- PENDIENTE DE APLICAR en producción (Felipe debe confirmar).

-- 1) Un token secreto por cita para cada parte. Se reparte por correo solo a esa parte; ninguno
--    da acceso a datos de la otra.
alter table public.agenda_citas
  add column if not exists token_arrendatario uuid not null default gen_random_uuid(),
  add column if not exists token_cliente uuid not null default gen_random_uuid();
create unique index if not exists agenda_citas_token_arrendatario_idx on public.agenda_citas(token_arrendatario);
create unique index if not exists agenda_citas_token_cliente_idx on public.agenda_citas(token_cliente);

-- 2) Propuestas de cambio de horario. cita_fecha/cita_hora guardan la hora que tenía la cita al
--    proponer: si la cita cambia por otra vía, la propuesta deja de valer.
create table if not exists public.agenda_cita_propuestas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  cita_id uuid not null references public.agenda_citas(id) on delete cascade,
  propuesto_por text not null check (propuesto_por in ('arrendatario', 'cliente')),
  cita_fecha date not null,
  cita_hora time not null,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null check (hora_fin > hora_inicio),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada', 'reemplazada', 'expirada')),
  creado_en timestamptz not null default now(),
  respondido_en timestamptz
);
-- Una sola propuesta pendiente por cita.
create unique index if not exists agenda_cita_propuestas_pendiente_idx
  on public.agenda_cita_propuestas(cita_id) where estado = 'pendiente';
create index if not exists agenda_cita_propuestas_cita_idx on public.agenda_cita_propuestas(cita_id, creado_en desc);

alter table public.agenda_cita_propuestas enable row level security;
drop policy if exists cita_propuestas_lectura on public.agenda_cita_propuestas;
create policy cita_propuestas_lectura on public.agenda_cita_propuestas
  for select to authenticated
  using (exists (
    select 1 from public.agenda_miembros m
    where m.empresa_id = agenda_cita_propuestas.empresa_id and m.usuario_id = auth.uid() and m.activo
  ));

-- GRANT explícito (convención desde el 30-oct-2026). Sin acceso para anon: solo la Edge Function.
grant select on public.agenda_cita_propuestas to authenticated;
grant select, insert, update, delete on public.agenda_cita_propuestas to service_role;

-- 3) Bitácora de lo que el arrendatario hace desde el portal (auditoría; sin pantalla aún).
create table if not exists public.agenda_arrendatario_acciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  cita_id uuid references public.agenda_citas(id) on delete set null,
  accion text not null check (accion in ('horario_actualizado', 'cita_cancelada', 'propuesta_creada', 'propuesta_aceptada', 'propuesta_rechazada')),
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists agenda_arrendatario_acciones_empresa_idx
  on public.agenda_arrendatario_acciones(empresa_id, creado_en desc);

alter table public.agenda_arrendatario_acciones enable row level security;
drop policy if exists arrendatario_acciones_lectura on public.agenda_arrendatario_acciones;
create policy arrendatario_acciones_lectura on public.agenda_arrendatario_acciones
  for select to authenticated
  using (public.agenda_es_admin(empresa_id));

grant select on public.agenda_arrendatario_acciones to authenticated;
grant select, insert, update, delete on public.agenda_arrendatario_acciones to service_role;
