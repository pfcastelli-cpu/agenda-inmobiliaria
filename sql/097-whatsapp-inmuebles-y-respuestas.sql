-- 097 · WhatsApp: ofrecer inmuebles desde la conversación (la IA sigue con ese inmueble), ficha del inmueble dentro del chat y respuestas rápidas.
-- Aplicar DESPUÉS de 094, 095 y 096. Aditivo e idempotente. PENDIENTE de aplicar (con permiso de Felipe).

-- ============ 1) Columnas nuevas ============
alter table public.agenda_wa_conversaciones
  add column if not exists inmuebles_ofrecidos integer[] not null default '{}';   -- inmuebles que el asesor (o la IA) ofreció en esta conversación

alter table public.agenda_whatsapp_config
  add column if not exists respuestas_rapidas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(respuestas_rapidas) = 'array' and length(respuestas_rapidas::text) <= 30000);   -- [{titulo, texto}] mensajes prediseñados

-- ============ 2) Guardar las respuestas rápidas ============
-- p_respuestas: [{ titulo, texto }]. Usa {{nombre}}, {{inmueble}} y {{asesor}} como datos variables. Requiere «whatsapp.configurar».
create or replace function public.agenda_wa_guardar_respuestas(p_empresa_id uuid, p_respuestas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.agenda_tiene_permiso(p_empresa_id, 'whatsapp.configurar') then raise exception 'No tienes permiso para configurar WhatsApp'; end if;
  if jsonb_typeof(p_respuestas) <> 'array' or jsonb_array_length(p_respuestas) > 60 then raise exception 'La lista de respuestas no es válida (máximo 60)'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('titulo', left(btrim(x->>'titulo'), 60), 'texto', left(coalesce(x->>'texto', ''), 1500))), '[]'::jsonb) into v
    from jsonb_array_elements(p_respuestas) x where length(btrim(coalesce(x->>'titulo', ''))) > 0 and length(btrim(coalesce(x->>'texto', ''))) > 0;
  insert into public.agenda_whatsapp_config as c (empresa_id, respuestas_rapidas, actualizado_en, actualizado_por) values (p_empresa_id, v, now(), auth.uid())
  on conflict (empresa_id) do update set respuestas_rapidas = excluded.respuestas_rapidas, actualizado_en = now(), actualizado_por = auth.uid();
end;
$$;
revoke all on function public.agenda_wa_guardar_respuestas(uuid, jsonb) from public, anon;
grant execute on function public.agenda_wa_guardar_respuestas(uuid, jsonb) to authenticated, service_role;

-- ============ 3) Ficha del inmueble dentro de la conversación ============
-- Junta lo que ya existe en la plataforma (inmuebles, arrendatario vigente, propietarios, citas) para quien atiende el chat.
-- Respeta la visibilidad de la conversación; los datos de arrendatario y propietarios solo con el permiso «inmuebles.ver».
create or replace function public.agenda_wa_ficha_inmueble(p_conv uuid, p_numero integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c record; v_n integer; v_i record; v_ver boolean; v_arr jsonb; v_prop jsonb; v_citas jsonb;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id) then return null; end if;
  v_n := coalesce(p_numero, v_c.inmueble_numero);
  if v_n is null then return null; end if;
  select * into v_i from public.agenda_inmuebles i where i.empresa_id = v_c.empresa_id and i.numero_inmueble = v_n;
  if not found then return jsonb_build_object('numero', v_n, 'existe', false); end if;
  v_ver := public.agenda_tiene_permiso(v_c.empresa_id, 'inmuebles.ver');
  if v_ver then
    select to_jsonb(a) - 'empresa_id' - 'sincronizado_en' - 'email' - 'celular' - 'telefono' into v_arr from public.agenda_arrendatarios a where a.empresa_id = v_c.empresa_id and a.numero_inmueble = v_n;
    select coalesce(jsonb_agg(p.nombre), '[]'::jsonb) into v_prop from public.agenda_propietarios p where p.empresa_id = v_c.empresa_id and p.numero_inmueble = v_n;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora_inicio, 'HH24:MI'), 'estado', c.estado) order by c.fecha, c.hora_inicio), '[]'::jsonb) into v_citas
    from (select * from public.agenda_citas c0 where c0.empresa_id = v_c.empresa_id and c0.inmueble_id = v_i.id and c0.fecha >= current_date and c0.estado = 'confirmada' order by c0.fecha, c0.hora_inicio limit 5) c;
  return jsonb_build_object('numero', v_n, 'existe', true, 'tipo_oferta', v_i.tipo_oferta, 'tipo', v_i.tipo_inmueble, 'ciudad', v_i.ciudad, 'zona', concat_ws(' · ', v_i.barrio, v_i.localidad),
    'direccion', v_i.direccion, 'habitaciones', v_i.habitaciones, 'banos', v_i.banos, 'parqueaderos', v_i.parqueaderos,
    'valor', case when v_i.tipo_oferta = 'Venta' then v_i.valor_venta else v_i.valor_canon end, 'disponible', v_i.disponible, 'estado', v_i.estado_crm,
    'arrendatario', v_arr, 'propietarios', v_prop, 'proximas_citas', v_citas);
end;
$$;
revoke all on function public.agenda_wa_ficha_inmueble(uuid, integer) from public, anon;
grant execute on function public.agenda_wa_ficha_inmueble(uuid, integer) to authenticated, service_role;
