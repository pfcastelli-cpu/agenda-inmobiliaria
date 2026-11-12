-- 079 · Encuesta de salida de la inspección: al registrarse la salida, el arrendatario recibe por correo un enlace (/inspeccion/<token>?encuesta=1)
-- con 4 preguntas de un toque y un comentario opcional. Las respuestas llegan a la coordinación y NO se muestran al propietario.
-- `alerta` queda en true cuando el trato fue 1-2, la identificación fue «no» o pidió que lo llamen (para que la coordinación revise).
-- Idempotente. PENDIENTE de aplicar (con permiso de Felipe).
alter table public.agenda_citas
  add column if not exists encuesta_inspeccion jsonb,
  add column if not exists encuesta_inspeccion_en timestamptz;

-- La coordinación (miembros de la empresa) puede leerlas desde la agenda; el RLS de la tabla ya limita por empresa.
grant select (encuesta_inspeccion, encuesta_inspeccion_en) on public.agenda_citas to authenticated;

create or replace function public.agenda_inspeccion_encuesta(p_token uuid, p_respuestas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v record;
  v_punt int;
  v_trato int;
  v_ident text;
  v_dur text;
  v_com text;
  v_llamar boolean;
  v_alerta boolean;
begin
  select id, tipo_cita, estado, salida_verificada_en, encuesta_inspeccion_en into v
    from public.agenda_citas where token_arrendatario = p_token and tipo_cita = 'inspeccion';
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrada'); end if;
  if v.salida_verificada_en is null then return jsonb_build_object('ok', false, 'error', 'aun_no'); end if;
  if v.encuesta_inspeccion_en is not null then return jsonb_build_object('ok', true, 'ya_respondida', true); end if;

  v_punt := nullif(p_respuestas ->> 'puntualidad', '')::int;
  v_trato := nullif(p_respuestas ->> 'trato', '')::int;
  v_ident := p_respuestas ->> 'identificacion';
  v_dur := p_respuestas ->> 'duracion';
  v_com := left(coalesce(p_respuestas ->> 'comentario', ''), 300);
  v_llamar := coalesce((p_respuestas ->> 'quiere_llamada')::boolean, false);
  if v_punt is not null and v_punt not between 1 and 5 then raise exception 'Respuesta no válida'; end if;
  if v_trato is not null and v_trato not between 1 and 5 then raise exception 'Respuesta no válida'; end if;
  if v_ident is not null and v_ident not in ('si', 'no', 'no_recuerdo') then raise exception 'Respuesta no válida'; end if;
  if v_dur is not null and v_dur not in ('corta', 'justa', 'larga') then raise exception 'Respuesta no válida'; end if;
  v_alerta := coalesce(v_trato <= 2, false) or v_ident = 'no' or v_llamar;

  update public.agenda_citas
     set encuesta_inspeccion = jsonb_strip_nulls(jsonb_build_object('puntualidad', v_punt, 'trato', v_trato, 'identificacion', v_ident, 'duracion', v_dur, 'comentario', nullif(v_com, ''), 'quiere_llamada', v_llamar, 'alerta', v_alerta)),
         encuesta_inspeccion_en = now()
   where id = v.id and encuesta_inspeccion_en is null;
  return jsonb_build_object('ok', true, 'alerta', v_alerta);
end;
$function$;

revoke all on function public.agenda_inspeccion_encuesta(uuid, jsonb) from public;
grant execute on function public.agenda_inspeccion_encuesta(uuid, jsonb) to anon, authenticated, service_role;
