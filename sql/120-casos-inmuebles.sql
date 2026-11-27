-- Casos de inmuebles: terminaciones, mantenimientos locativos, PQRs y asambleas.
-- ARCHIVO DE REFERENCIA: NO aplicado en producción. Aplicar solo con permiso de Felipe.
-- (Número 120 a propósito, lejos de los que usa la otra sesión del bot de WhatsApp; renumerar al unir ramas.)
--
-- Reglas de negocio (de la operación real):
--  * Una terminación se cierra solo con acta de entrega y fecha real confirmada.
--  * PQRs y mantenimientos son cosas distintas: no se duplican.
--  * Sedi no tiene API de escritura: toda acción que deba reflejarse en Sedi queda en una cola
--    (agenda_sedi_cola) que se ejecuta controlando el navegador de Felipe (ver docs/SINCRONIZAR-SEDI-CHROME.md).
--  * Datos personales de clientes: la tabla guarda número de contrato, copropiedad y rol; nombres, cédulas,
--    celulares y correos se quedan en Sedi. El reporte los resuelve al enviar, nunca se copian aquí.

create table if not exists public.agenda_casos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.agenda_empresas(id) on delete cascade,
  tipo text not null check (tipo in ('terminacion', 'mantenimiento', 'pqr', 'asamblea')),
  titulo text not null check (length(titulo) between 3 and 200),
  descripcion text,
  inmueble_id uuid references public.agenda_inmuebles(id) on delete set null,
  copropiedad text,                 -- p. ej. «Sky Club 104»
  unidad text,                      -- p. ej. «Apto 403»
  contrato_ref text,                -- p. ej. «CT-7875»
  sedi_numero text,                 -- número del proceso/caso en Sedi cuando ya existe
  estado text not null default 'inicial',
  prioridad smallint not null default 3 check (prioridad between 1 and 3), -- 1 urgente, 2 esta semana, 3 pendiente
  fecha_limite date,
  responsable_usuario_id uuid,
  parte text check (parte in ('propietario', 'arrendatario', 'ambos', 'interno')) default 'interno',
  datos jsonb not null default '{}'::jsonb,   -- campos propios de cada tipo (ver docs/CASOS-INMUEBLES.md)
  drive_carpeta_url text,
  origen text not null default 'manual' check (origen in ('manual', 'correo', 'whatsapp', 'sedi', 'asistente')),
  sincroniza_sedi boolean not null default true,
  sedi_estado text not null default 'pendiente' check (sedi_estado in ('pendiente', 'sincronizado', 'error', 'no_aplica')),
  sedi_sincronizado_en timestamptz,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  cerrado_en timestamptz
);
create index if not exists agenda_casos_empresa_idx on public.agenda_casos (empresa_id, tipo, estado);
create index if not exists agenda_casos_limite_idx on public.agenda_casos (empresa_id, fecha_limite) where cerrado_en is null;
create unique index if not exists agenda_casos_sedi_uq on public.agenda_casos (empresa_id, tipo, sedi_numero) where sedi_numero is not null;

create table if not exists public.agenda_casos_seguimientos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  texto text not null check (length(texto) between 1 and 400),  -- límite de Sedi (~400)
  visible_en_reporte boolean not null default false,
  autor uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_casos_seg_idx on public.agenda_casos_seguimientos (caso_id, creado_en);

-- Fotos y documentos: viven en Drive; aquí solo el enlace (y el id si se tiene).
create table if not exists public.agenda_casos_archivos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  nombre text not null,
  drive_url text not null check (drive_url ~* '^https://(drive|docs)\.google\.com/'),
  drive_file_id text,
  tipo text not null default 'foto' check (tipo in ('foto', 'documento', 'acta', 'carta', 'otro')),
  mostrar_en_reporte boolean not null default true,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index if not exists agenda_casos_arch_idx on public.agenda_casos_archivos (caso_id);

-- Cola de trabajo para Sedi (se ejecuta en el Chrome de Felipe).
create table if not exists public.agenda_sedi_cola (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  accion text not null check (accion in ('crear', 'seguimiento', 'cambiar_estado', 'cerrar', 'adjuntar')),
  payload jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'hecho', 'error', 'omitido')),
  intentos int not null default 0,
  error text,
  creado_en timestamptz not null default now(),
  hecho_en timestamptz
);
create index if not exists agenda_sedi_cola_idx on public.agenda_sedi_cola (empresa_id, estado, creado_en);

-- Registro de reportes enviados (sin datos personales: solo tipo de destinatario y modo).
create table if not exists public.agenda_casos_reportes (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  destinatario text not null check (destinatario in ('propietario', 'arrendatario')),
  modo text not null check (modo in ('prueba', 'real')),
  enviado_por uuid default auth.uid(),
  enviado_en timestamptz not null default now()
);

alter table public.agenda_casos enable row level security;
alter table public.agenda_casos_seguimientos enable row level security;
alter table public.agenda_casos_archivos enable row level security;
alter table public.agenda_sedi_cola enable row level security;
alter table public.agenda_casos_reportes enable row level security;

-- Quién gestiona: administrador y coordinador (mismo criterio que Asambleas y Pendientes).
create or replace function public.agenda_gestiona_casos(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.agenda_rol_actual(p_empresa_id) in ('administrador', 'coordinador'), false)
$$;
revoke all on function public.agenda_gestiona_casos(uuid) from public, anon;
grant execute on function public.agenda_gestiona_casos(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['agenda_casos', 'agenda_casos_seguimientos', 'agenda_casos_archivos', 'agenda_sedi_cola', 'agenda_casos_reportes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.agenda_gestiona_casos(empresa_id))', t || '_leer', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- Escritura desde la pantalla: insertar y actualizar (nunca borrar: se cierra o se descarta).
drop policy if exists agenda_casos_insertar on public.agenda_casos;
create policy agenda_casos_insertar on public.agenda_casos for insert to authenticated with check (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_actualizar on public.agenda_casos;
create policy agenda_casos_actualizar on public.agenda_casos for update to authenticated
  using (public.agenda_gestiona_casos(empresa_id)) with check (public.agenda_gestiona_casos(empresa_id));
grant insert, update on public.agenda_casos to authenticated;

drop policy if exists agenda_casos_seg_insertar on public.agenda_casos_seguimientos;
create policy agenda_casos_seg_insertar on public.agenda_casos_seguimientos for insert to authenticated with check (public.agenda_gestiona_casos(empresa_id));
grant insert on public.agenda_casos_seguimientos to authenticated;

drop policy if exists agenda_casos_arch_insertar on public.agenda_casos_archivos;
create policy agenda_casos_arch_insertar on public.agenda_casos_archivos for insert to authenticated with check (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_arch_actualizar on public.agenda_casos_archivos;
create policy agenda_casos_arch_actualizar on public.agenda_casos_archivos for update to authenticated
  using (public.agenda_gestiona_casos(empresa_id)) with check (public.agenda_gestiona_casos(empresa_id));
grant insert, update on public.agenda_casos_archivos to authenticated;

-- La cola la actualiza el asistente de Chrome (con la sesión de Felipe) solo por esta función.
create or replace function public.agenda_sedi_marcar(p_id uuid, p_estado text, p_sedi_numero text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select * into v_c from public.agenda_sedi_cola where id = p_id;
  if not found or not public.agenda_gestiona_casos(v_c.empresa_id) then raise exception 'sin permiso'; end if;
  if p_estado not in ('en_proceso', 'hecho', 'error', 'omitido') then raise exception 'estado no válido'; end if;
  update public.agenda_sedi_cola
     set estado = p_estado, error = left(p_error, 500), intentos = intentos + case when p_estado = 'en_proceso' then 1 else 0 end,
         hecho_en = case when p_estado in ('hecho', 'omitido') then now() else hecho_en end
   where id = p_id;
  if p_estado = 'hecho' then
    update public.agenda_casos
       set sedi_numero = coalesce(nullif(p_sedi_numero, ''), sedi_numero), sedi_estado = 'sincronizado', sedi_sincronizado_en = now()
     where id = v_c.caso_id
       and not exists (select 1 from public.agenda_sedi_cola q where q.caso_id = v_c.caso_id and q.id <> p_id and q.estado in ('pendiente', 'en_proceso', 'error'));
  elsif p_estado = 'error' then
    update public.agenda_casos set sedi_estado = 'error' where id = v_c.caso_id;
  end if;
end $$;
revoke all on function public.agenda_sedi_marcar(uuid, text, text, text) from public, anon;
grant execute on function public.agenda_sedi_marcar(uuid, text, text, text) to authenticated, service_role;

-- Automático: cada cambio relevante deja su tarea en la cola de Sedi.
create or replace function public.agenda_casos_a_cola() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'agenda_casos' then
    if not new.sincroniza_sedi or new.tipo = 'asamblea' then return new; end if;
    if tg_op = 'INSERT' and new.sedi_numero is null then
      insert into public.agenda_sedi_cola (empresa_id, caso_id, accion, payload) values (new.empresa_id, new.id, 'crear', jsonb_build_object('tipo', new.tipo, 'titulo', new.titulo, 'contrato_ref', new.contrato_ref, 'datos', new.datos));
    elsif tg_op = 'UPDATE' and new.estado is distinct from old.estado then
      insert into public.agenda_sedi_cola (empresa_id, caso_id, accion, payload)
      values (new.empresa_id, new.id, case when new.cerrado_en is not null and old.cerrado_en is null then 'cerrar' else 'cambiar_estado' end, jsonb_build_object('estado', new.estado, 'datos', new.datos));
    end if;
    if tg_op = 'UPDATE' then new.actualizado_en := now(); end if;
  elsif tg_table_name = 'agenda_casos_seguimientos' then
    if exists (select 1 from public.agenda_casos c where c.id = new.caso_id and c.sincroniza_sedi and c.tipo <> 'asamblea') then
      insert into public.agenda_sedi_cola (empresa_id, caso_id, accion, payload) values (new.empresa_id, new.caso_id, 'seguimiento', jsonb_build_object('texto', new.texto));
    end if;
  elsif tg_table_name = 'agenda_casos_archivos' then
    if new.tipo in ('acta', 'carta', 'documento') and exists (select 1 from public.agenda_casos c where c.id = new.caso_id and c.sincroniza_sedi and c.tipo <> 'asamblea') then
      insert into public.agenda_sedi_cola (empresa_id, caso_id, accion, payload) values (new.empresa_id, new.caso_id, 'adjuntar', jsonb_build_object('nombre', new.nombre, 'drive_url', new.drive_url));
    end if;
  end if;
  return new;
end $$;
revoke all on function public.agenda_casos_a_cola() from public, anon, authenticated;

drop trigger if exists casos_a_cola_ins on public.agenda_casos;
create trigger casos_a_cola_ins after insert on public.agenda_casos for each row execute function public.agenda_casos_a_cola();
drop trigger if exists casos_a_cola_upd on public.agenda_casos;
create trigger casos_a_cola_upd before update on public.agenda_casos for each row execute function public.agenda_casos_a_cola();
drop trigger if exists casos_seg_a_cola on public.agenda_casos_seguimientos;
create trigger casos_seg_a_cola after insert on public.agenda_casos_seguimientos for each row execute function public.agenda_casos_a_cola();
drop trigger if exists casos_arch_a_cola on public.agenda_casos_archivos;
create trigger casos_arch_a_cola after insert on public.agenda_casos_archivos for each row execute function public.agenda_casos_a_cola();

-- Regla de negocio en el servidor: una terminación no se cierra sin acta de entrega y fecha real.
create or replace function public.agenda_casos_validar_cierre() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo = 'terminacion' and new.cerrado_en is not null and old.cerrado_en is null
     and (coalesce(new.datos ->> 'fecha_entrega_real', '') = '' or coalesce(new.datos ->> 'acta_entrega', '') not in ('si', 'sí', 'true')) then
    raise exception 'Una terminación solo se cierra con acta de entrega y fecha real de entrega';
  end if;
  return new;
end $$;
drop trigger if exists casos_validar_cierre on public.agenda_casos;
create trigger casos_validar_cierre before update on public.agenda_casos for each row execute function public.agenda_casos_validar_cierre();


-- Comunicaciones de un caso (cartas al arrendatario, avisos al propietario, informes y encuestas).
-- Guarda UNA COPIA de lo enviado con saludo genérico (sin nombres): el nombre real vive en el correo enviado (Gmail) y en Sedi.
-- Nunca se borra: queda el historial de qué se envió, cuándo y quién lo aprobó.
create table if not exists public.agenda_casos_comunicaciones (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.agenda_casos(id) on delete cascade,
  empresa_id uuid not null,
  plantilla text not null check (plantilla in ('entrega_a_tiempo', 'renovado_820', 'aviso_propietario', 'informe_mantenimiento', 'encuesta_mantenimiento', 'otra')),
  destinatario text not null check (destinatario in ('arrendatario', 'propietario', 'otra')),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'prueba')),
  asunto text not null check (char_length(asunto) between 3 and 200),
  cuerpo_html text not null check (char_length(cuerpo_html) <= 200000),
  -- Para las cartas al arrendatario que dependen del aval del propietario:
  propietario_decision text check (propietario_decision in ('pendiente', 'acepta', 'rechaza', 'sin_respuesta')),
  propietario_avisado_en timestamptz,
  propietario_decidio_en timestamptz,
  correo_enlace text,
  creada_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  enviada_por uuid,
  enviada_en timestamptz
);
create index if not exists agenda_casos_comunicaciones_caso on public.agenda_casos_comunicaciones (caso_id, creado_en desc);
alter table public.agenda_casos_comunicaciones enable row level security;
drop policy if exists agenda_casos_comunicaciones_leer on public.agenda_casos_comunicaciones;
create policy agenda_casos_comunicaciones_leer on public.agenda_casos_comunicaciones for select to authenticated using (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_comunicaciones_insertar on public.agenda_casos_comunicaciones;
create policy agenda_casos_comunicaciones_insertar on public.agenda_casos_comunicaciones for insert to authenticated with check (public.agenda_gestiona_casos(empresa_id));
drop policy if exists agenda_casos_comunicaciones_actualizar on public.agenda_casos_comunicaciones;
create policy agenda_casos_comunicaciones_actualizar on public.agenda_casos_comunicaciones for update to authenticated
  using (public.agenda_gestiona_casos(empresa_id) and estado = 'borrador') with check (public.agenda_gestiona_casos(empresa_id));
revoke all on public.agenda_casos_comunicaciones from anon;
grant select, insert, update on public.agenda_casos_comunicaciones to authenticated;
grant select, insert, update, delete on public.agenda_casos_comunicaciones to service_role;

-- Control de envíos y decisiones (revisión de diseño): quién aprobó, a qué rol y correo (enmascarado), qué revisión pasó,
-- vínculo entre la carta al arrendatario y el aviso al propietario, y token de un solo uso para que el propietario decida
-- desde una página de confirmación (los enlaces del correo solo abren la página; la decisión se guarda al pulsar Confirmar).
alter table public.agenda_casos_comunicaciones add column if not exists aprobada_por uuid;
alter table public.agenda_casos_comunicaciones add column if not exists aprobada_en timestamptz;
alter table public.agenda_casos_comunicaciones add column if not exists correo_mascara text;
alter table public.agenda_casos_comunicaciones add column if not exists ligada_a uuid references public.agenda_casos_comunicaciones(id);
alter table public.agenda_casos_comunicaciones add column if not exists revision jsonb;
alter table public.agenda_casos_comunicaciones add column if not exists token_hash text;
alter table public.agenda_casos_comunicaciones add column if not exists token_expira timestamptz;
-- Evita enviar dos veces la misma carta (un reenvío o recordatorio queda ligado con ligada_a).
create unique index if not exists agenda_casos_comunicaciones_una_vez
  on public.agenda_casos_comunicaciones (caso_id, plantilla, destinatario) where estado = 'enviada' and ligada_a is null;
