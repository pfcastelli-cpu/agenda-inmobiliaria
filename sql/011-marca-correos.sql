-- 011: marca de la empresa en los correos (imagen de encabezado propia por empresa).
-- Las funciones de correo leen imagen_correo_url + color_principal + color_accion
-- (supabase/functions/_shared/marca-correo.ts). Sin imagen configurada, el correo sale con
-- una franja del color de acción en lugar de la imagen de otra empresa.
-- ORDEN: aplicar este SQL PRIMERO, luego desplegar las funciones (sus SELECT piden la columna).
-- Agregar una columna a una tabla existente no necesita GRANT nuevo.
alter table public.agenda_configuracion
  add column if not exists imagen_correo_url text
  check (imagen_correo_url is null or imagen_correo_url ~ '^https://');

-- Patrimonios conserva la imagen que ya usaban los correos.
update public.agenda_configuracion
   set imagen_correo_url = 'https://adminpaxzu.patrimonios.co/uploads/images/Cita.jpg'
 where imagen_correo_url is null and nombre_comercial ilike '%patrimonios%';
