-- 063 · Ajustes varios (11-nov). Idempotente; solo agrega columnas con valor por defecto.
-- PENDIENTE de aplicar (con permiso de Felipe).
-- Botón «Llegué a la visita»: apagado por defecto; la administración lo enciende en Configuración → Supervisión.
alter table public.agenda_configuracion add column if not exists mostrar_boton_llegada boolean not null default false;
alter table public.agenda_configuracion add column if not exists consignar_url text; -- destino del botón «Quiero consignar» de los correos a propietarios (https). Vacío = /consignar de la agenda.
