-- 045 · Soporte: lo escrito en un ticket no se edita ni se borra (candado en la base)
-- Sobre sql/022–025. NO está aplicado en ninguna base: revisar y aplicar a mano (Supabase > SQL editor). Es idempotente.
-- Qué garantiza, aunque alguien salte la pantalla o llame a la API directamente:
--   1) El texto original del ticket (tipo, título, detalles, página, autor, empresa, fecha) NO se puede cambiar nunca después de crearlo.
--   2) Los mensajes del hilo y el historial de cambios son solo-anexar: no se editan ni se borran
--      (solo desaparecen en cascada cuando se borra el ticket completo, p. ej. al limpiar pruebas).
--   3) Quien escribió el ticket, una vez que soporte respondió, solo puede AGREGAR comentarios nuevos (cada uno queda con autor, hora y orden),
--      marcar «ya quedó resuelto», reabrir (si está resuelto) y calificar. Eso ya lo hacía agenda_ticket_responder; ahora además:
--   4) Una persona que ya no está activa en la empresa deja de poder escribir en sus tickets (antes bastaba haberlo creado).
--   5) Tope contra inundación: máximo 30 mensajes por hora de la misma persona en el mismo ticket.
-- Trazabilidad: cada mensaje guarda autor_id, autor_nombre, autor_tipo y creado_en; cada cambio de estado/prioridad/asignación queda en
-- agenda_ticket_eventos (quién y cuándo). Nada de eso se puede reescribir.
-- Cómo se prueba (con datos de prueba, nunca con tickets reales): ver el bloque de comentarios al final.

-- ------------------------------------------------------------------ 1) el contenido original del ticket es inmutable
create or replace function public.agenda_ticket_proteger_contenido()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.empresa_id is distinct from old.empresa_id
     or new.usuario_id is distinct from old.usuario_id
     or new.usuario_nombre is distinct from old.usuario_nombre
     or new.tipo is distinct from old.tipo
     or new.titulo is distinct from old.titulo
     or new.descripcion is distinct from old.descripcion
     or new.pagina is distinct from old.pagina
     or new.numero is distinct from old.numero
     or new.creado_en is distinct from old.creado_en then
    raise exception 'El contenido original del ticket no se puede modificar. Agrega un comentario nuevo en el mismo ticket.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists agenda_ticket_contenido_inmutable on public.agenda_tickets;
create trigger agenda_ticket_contenido_inmutable before update on public.agenda_tickets
  for each row execute function public.agenda_ticket_proteger_contenido();

-- ------------------------------------------------------------------ 2) mensajes e historial: solo anexar
-- Borrar es válido únicamente cuando el ticket padre ya no existe (borrado en cascada).
create or replace function public.agenda_ticket_solo_anexar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.agenda_tickets t where t.id = old.ticket_id) then
    return old;
  end if;
  raise exception 'Los mensajes y el historial de un ticket no se pueden editar ni borrar. Agrega un comentario nuevo.' using errcode = 'P0001';
end;
$$;
drop trigger if exists agenda_mensajes_solo_anexar on public.agenda_ticket_mensajes;
create trigger agenda_mensajes_solo_anexar before update or delete on public.agenda_ticket_mensajes
  for each row execute function public.agenda_ticket_solo_anexar();
drop trigger if exists agenda_eventos_solo_anexar on public.agenda_ticket_eventos;
create trigger agenda_eventos_solo_anexar before update or delete on public.agenda_ticket_eventos
  for each row execute function public.agenda_ticket_solo_anexar();

-- Cinturón y tirantes: el navegador nunca escribe estas tablas (ya estaba así en 022–024; se repite por si alguien lo cambió).
revoke insert, update, delete, truncate, references, trigger on public.agenda_tickets from anon, authenticated;
revoke all on public.agenda_ticket_mensajes, public.agenda_ticket_eventos, public.agenda_ticket_notas from anon, authenticated;
grant select on public.agenda_tickets to authenticated;
grant select, insert, update, delete on public.agenda_tickets to service_role;
grant select, insert, update, delete on public.agenda_ticket_mensajes to service_role;
grant select, insert on public.agenda_ticket_eventos to service_role;

-- ------------------------------------------------------------------ 3) quién es quien llama (reemplaza 024): el solicitante debe seguir activo
create or replace function public.agenda_ticket_rol(p_id uuid, p_como text default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_como = 'solicitante' and t.usuario_id = auth.uid() and public.agenda_rol_actual(t.empresa_id) is not null then 'solicitante'
    when public.agenda_es_soporte() then 'soporte'
    when t.usuario_id = auth.uid() and public.agenda_rol_actual(t.empresa_id) is not null then 'solicitante'
    when public.agenda_rol_actual(t.empresa_id) = 'administrador' then 'empresa'
  end from public.agenda_tickets t where t.id = p_id
$$;
revoke all on function public.agenda_ticket_rol(uuid, text) from public, anon, authenticated;
grant execute on function public.agenda_ticket_rol(uuid, text) to service_role;

-- ------------------------------------------------------------------ 4) responder (reemplaza 024): igual, más tope de mensajes
create or replace function public.agenda_ticket_responder(p_id uuid, p_texto text default null, p_estado text default null, p_como text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.agenda_tickets%rowtype;
  v_rol text;
  v_nombre text;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_nuevo text;
  v_reabre boolean;
begin
  select * into v_t from public.agenda_tickets where id = p_id for update;
  if not found then raise exception 'Ticket no encontrado'; end if;
  v_rol := public.agenda_ticket_rol(p_id, p_como);
  if v_rol is null then raise exception 'No tienes acceso a este ticket'; end if;
  if v_texto = '' and p_estado is null then raise exception 'Escribe un mensaje'; end if;
  if length(v_texto) > 4000 then raise exception 'El mensaje es demasiado largo (máximo 4000 letras)'; end if;
  if v_texto <> '' and (select count(*) from public.agenda_ticket_mensajes m
                         where m.ticket_id = p_id and m.autor_id = auth.uid() and m.creado_en > now() - interval '1 hour') >= 30 then
    raise exception 'Enviaste muchos mensajes seguidos. Espera un rato antes de escribir otro.';
  end if;
  v_nombre := public.agenda_ticket_nombre(v_t.empresa_id);

  if v_rol = 'solicitante' then
    if v_t.estado in ('cerrado', 'descartado') then raise exception 'Este ticket ya está cerrado. Crea uno nuevo si el problema continúa.'; end if;
    if p_estado is not null and p_estado <> 'resuelto' then raise exception 'Estado no permitido'; end if;
    v_nuevo := case when p_estado = 'resuelto' then 'resuelto' when v_t.estado in ('en_espera', 'resuelto') then 'abierto' else v_t.estado end;
  else
    if p_estado is not null and p_estado not in ('abierto', 'en_revision', 'en_espera', 'resuelto', 'cerrado', 'descartado') then raise exception 'Estado no válido'; end if;
    v_nuevo := coalesce(p_estado, case when v_texto <> '' and v_t.estado in ('abierto', 'en_revision') then 'en_espera' else v_t.estado end);
  end if;
  v_reabre := v_t.estado in ('resuelto', 'cerrado') and v_nuevo in ('abierto', 'en_revision', 'en_espera');

  if v_texto <> '' then
    insert into public.agenda_ticket_mensajes (ticket_id, autor_id, autor_nombre, autor_tipo, texto)
    values (p_id, auth.uid(), v_nombre, case v_rol when 'solicitante' then 'solicitante' when 'soporte' then 'soporte' else 'empresa' end, v_texto);
  end if;
  update public.agenda_tickets
     set estado = v_nuevo,
         actualizado_en = now(),
         ultima_actividad_en = now(),
         respuesta = case when v_rol <> 'solicitante' and v_texto <> '' then left(v_texto, 4000) else respuesta end,
         primera_respuesta_en = case when v_rol <> 'solicitante' and v_texto <> '' then coalesce(primera_respuesta_en, now()) else primera_respuesta_en end,
         asignado_a = case when v_rol = 'soporte' and asignado_a is null then auth.uid() else asignado_a end,
         asignado_nombre = case when v_rol = 'soporte' and asignado_a is null then v_nombre else asignado_nombre end,
         reabierto_n = reabierto_n + case when v_reabre then 1 else 0 end,
         resuelto_en = case when v_nuevo in ('resuelto', 'cerrado', 'descartado') then coalesce(resuelto_en, now()) else null end
   where id = p_id;
  if v_nuevo <> v_t.estado then
    perform public.agenda_ticket_evento(p_id, 'estado', jsonb_build_object('de', v_t.estado, 'a', v_nuevo), v_nombre);
  end if;
  if v_reabre then perform public.agenda_ticket_evento(p_id, 'reabierto', '{}'::jsonb, v_nombre); end if;
  if v_rol = 'soporte' then
    insert into public.agenda_soporte_auditoria (empresa_id, actor_id, actor_nombre, actor_tipo, accion, detalle)
    values (v_t.empresa_id, auth.uid(), v_nombre, 'soporte', 'ticket_respondido', jsonb_build_object('ticket', v_t.numero, 'estado', v_nuevo));
  end if;
  return jsonb_build_object('estado', v_nuevo, 'rol', v_rol, 'con_mensaje', v_texto <> '');
end;
$$;
revoke all on function public.agenda_ticket_responder(uuid, text, text, text) from public, anon;
grant execute on function public.agenda_ticket_responder(uuid, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ cómo probarlo (en una empresa de prueba, con un ticket de prueba)
-- a) Como usuario normal (rol authenticated) o desde el SQL editor con un ticket de prueba:
--      update public.agenda_tickets set descripcion = 'cambiado' where id = '<ticket>';      -- debe fallar: «El contenido original…»
--      update public.agenda_ticket_mensajes set texto = 'x' where ticket_id = '<ticket>';    -- debe fallar: «…no se pueden editar ni borrar»
--      delete from public.agenda_ticket_mensajes where ticket_id = '<ticket>';              -- debe fallar
--      delete from public.agenda_tickets where id = '<ticket>';                              -- debe funcionar y llevarse el hilo (limpieza de pruebas)
-- b) Estado y respuestas normales (siguen funcionando): select public.agenda_ticket_responder('<ticket>', 'hola', null, null);
-- c) Desde la pantalla: crear ticket, responder como soporte, volver como quien lo escribió: debe verse el aviso
--    «Soporte ya respondió…» y solo poder agregar comentarios; el texto original no ofrece ningún botón de edición.
