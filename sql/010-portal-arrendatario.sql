-- 010 · Portal del arrendatario (inmuebles "Rentando")
-- El correo "Visita programada en tu vivienda" lleva un enlace /arrendatario/<token> donde el
-- arrendatario puede: (1) actualizar los días y horas en que se muestra su vivienda,
-- (2) mover la visita a otro horario válido, (3) cancelarla. Todo lo hace la Edge Function
-- `portal-arrendatario` (verify_jwt apagado: el token secreto de la URL es la credencial).
-- PENDIENTE DE APLICAR en producción (Felipe debe confirmar).

-- 1) Token secreto por cita. Se reparte por correo solo al arrendatario del inmueble; no da
--    acceso a datos del cliente que visita. Regenerable poniendo uno nuevo.
alter table public.agenda_citas
  add column if not exists token_arrendatario uuid not null default gen_random_uuid();
create unique index if not exists agenda_citas_token_arrendatario_idx
  on public.agenda_citas(token_arrendatario);

-- 2) Bitácora de lo que el arrendatario hace desde el portal (auditoría; sin pantalla aún).
create table if not exists public.agenda_arrendatario_acciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  cita_id uuid references public.agenda_citas(id) on delete set null,
  accion text not null check (accion in ('horario_actualizado', 'cita_movida', 'cita_cancelada')),
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

-- GRANT explícito (convención desde el 30-oct-2026). Sin acceso para anon.
grant select on public.agenda_arrendatario_acciones to authenticated;
grant select, insert, update, delete on public.agenda_arrendatario_acciones to service_role;

-- 3) La bitácora de correos acepta el nuevo tipo de destinatario 'asesor' (aviso al asesor
--    cuando el arrendatario cambia o cancela una visita).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.agenda_correos_log'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%destinatario_tipo%';
  if c is not null then
    execute format('alter table public.agenda_correos_log drop constraint %I', c);
  end if;
end $$;
alter table public.agenda_correos_log
  add constraint agenda_correos_log_destinatario_tipo_check
  check (destinatario_tipo in ('cliente', 'propietario', 'interno', 'verificacion', 'arrendatario', 'asesor'));
