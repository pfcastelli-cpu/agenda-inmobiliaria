-- 071 · agenda_citas da SELECT por columna a `authenticated`: las columnas nuevas de 062 quedaron sin permiso de lectura y la agenda
-- no podía mostrar «Confirmada por el cliente / Sin confirmar». PENDIENTE de aplicar (con permiso de Felipe).
-- Regla: al agregar columnas a agenda_citas, otorgar también el SELECT de la columna si el navegador la lee.
grant select (cliente_confirmado_en, cliente_recordado_en) on public.agenda_citas to authenticated;
