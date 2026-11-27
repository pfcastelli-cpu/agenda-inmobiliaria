-- Seguimientos estructurados de Casos: tipo de contacto, resultado, próximo paso y fecha.
-- SIN APLICAR. Requiere que 120-casos-inmuebles.sql ya esté aplicado. Idempotente.
-- Sin datos personales: solo categorías y un texto corto de próximo paso (el aviso de la agenda lo recuerda).
-- El trigger a la cola de Sedi no cambia: sigue enviando solo `texto` (límite de Sedi).

alter table public.agenda_casos_seguimientos
  add column if not exists tipo text not null default 'nota',
  add column if not exists resultado text,
  add column if not exists proximo_paso text,
  add column if not exists proxima_fecha date;

alter table public.agenda_casos_seguimientos drop constraint if exists agenda_casos_seg_tipo_chk;
alter table public.agenda_casos_seguimientos add constraint agenda_casos_seg_tipo_chk
  check (tipo in ('nota', 'llamada', 'correo', 'whatsapp', 'visita', 'carta', 'otro'));

alter table public.agenda_casos_seguimientos drop constraint if exists agenda_casos_seg_resultado_chk;
alter table public.agenda_casos_seguimientos add constraint agenda_casos_seg_resultado_chk
  check (resultado is null or resultado in ('contesto', 'no_contesto', 'acordado', 'pendiente', 'sin_respuesta', 'resuelto'));

alter table public.agenda_casos_seguimientos drop constraint if exists agenda_casos_seg_proximo_chk;
alter table public.agenda_casos_seguimientos add constraint agenda_casos_seg_proximo_chk
  check (proximo_paso is null or length(proximo_paso) between 1 and 200);

-- Para la futura pantalla «Hoy / vence esta semana».
create index if not exists agenda_casos_seg_proxima_idx
  on public.agenda_casos_seguimientos (empresa_id, proxima_fecha) where proxima_fecha is not null;

-- Permisos y RLS ya cubiertos por 120 (misma tabla); no se añaden tablas nuevas.
