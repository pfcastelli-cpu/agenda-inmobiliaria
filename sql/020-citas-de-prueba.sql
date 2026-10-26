-- 020 · Marca de «cita de prueba» para poder reconocerlas y limpiar su rastro más adelante
-- Convención (Claude Code / Codex / personas): TODA cita creada para probar el sistema lleva
--   agenda_citas.es_prueba = true   Y   el nombre del cliente empieza por «[PRUEBA] ».
-- Así se ven a simple vista en la agenda (insignia «PRUEBA») y se pueden listar o limpiar con docs/LIMPIAR-PRUEBAS.md.
-- Este archivo NO borra nada: solo agrega la columna y marca las citas de prueba que ya existían.
alter table public.agenda_citas add column if not exists es_prueba boolean not null default false;
create index if not exists agenda_citas_es_prueba_idx on public.agenda_citas(empresa_id) where es_prueba;

update public.agenda_citas
   set es_prueba = true,
       cliente_nombre = case when cliente_nombre like '[PRUEBA]%' then cliente_nombre else '[PRUEBA] ' || cliente_nombre end
 where (cliente_nombre ilike 'Prueba Claude%' or cliente_nombre = 'Cliente de Prueba' or cliente_nombre ilike '[PRUEBA]%')
   and not (es_prueba and cliente_nombre like '[PRUEBA]%');
