-- 068 · Estudios de mercado como tarea pendiente: quién lo hace y para cuándo. Idempotente; solo agrega columnas.
-- PENDIENTE de aplicar (con permiso de Felipe). El front funciona sin estas columnas (crea el estudio sin responsable ni fecha).
alter table public.agenda_estudios_mercado
  add column if not exists responsable_nombre text,
  add column if not exists fecha_limite date;
