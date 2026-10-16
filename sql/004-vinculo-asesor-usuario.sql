-- Entrega 004 | Ya se ejecutó directamente en el proyecto de Supabase (vía MCP) el 2026-10-16.
-- Se deja este archivo solo como registro, siguiendo la convención de 001/002/003.
-- Es seguro volver a correrlo si hace falta: usa "if not exists" en todo, así que no falla
-- ni duplica nada si ya está aplicado.
--
-- Qué hace: vincula la ficha de un asesor (agenda_asesores, pestaña "Equipo") con su
-- cuenta de acceso al sistema (auth.users / agenda_miembros, pestaña "Accesos"). Antes
-- las dos tablas no tenían relación: crear un asesor en Equipo no creaba ni vinculaba
-- ningún acceso. Con esta columna, el botón "Dar acceso" de cada ficha puede guardar
-- a qué usuario de auth.users quedó conectada esa ficha, y mostrar en la tarjeta si
-- ya tiene acceso o no.
begin;

alter table agenda_asesores
  add column if not exists usuario_id uuid references auth.users(id) on delete set null;

-- Un mismo usuario de acceso no puede quedar vinculado a dos fichas de asesor distintas.
create unique index if not exists agenda_asesores_usuario_id_unico
  on agenda_asesores (usuario_id)
  where usuario_id is not null;

commit;
