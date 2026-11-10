-- Prueba de humo de las reservas públicas (SQL 058 y 059).
-- Cómo usarla: pegarla en el editor SQL de Supabase (o execute_sql) después de cualquier
-- cambio en citas, permisos o funciones públicas. NO deja datos: todo ocurre dentro de un
-- bloque que termina a propósito con un error, y eso revierte lo que hizo.
-- Resultado esperado: un error que empieza por "HUMO_OK". Si empieza por "HUMO_FALLA",
-- el texto dice qué paso se rompió.

do $$
declare
  e uuid; n int; v uuid; v2 uuid; t text; r record; ok boolean;
  h text := (select dominio_publico from public.agenda_configuracion limit 1);
  tel text := '3009990001'; cor text := 'humo@example.com';
begin
  select id into e from public.agenda_empresas limit 1;
  select numero_inmueble into n from public.agenda_inmuebles where empresa_id = e and disponible order by numero_inmueble desc limit 1;
  update public.agenda_configuracion set verificar_correo_reserva = true where empresa_id = e;

  set local role anon;

  -- 1. Un visitante no puede generar códigos ni llamar a las funciones base.
  begin perform public.agenda_generar_codigo_verificacion(e, cor); raise exception 'HUMO_FALLA 1: un visitante generó un código';
  exception when insufficient_privilege then null; end;
  begin perform public.agenda_agendar_cita_publica_base(n, current_date + 3, time '09:00', '[PRUEBA] Humo', tel, cor, null, h); raise exception 'HUMO_FALLA 1b: un visitante llamó a la función base';
  exception when insufficient_privilege then null; end;

  -- 2. Sin correo verificado no se puede agendar.
  begin
    perform public.agenda_agendar_cita_publica(n, current_date + 3, time '09:00', '[PRUEBA] Humo', tel, cor, null, h);
    raise exception 'HUMO_FALLA 2: agendó sin verificar el correo';
  exception when others then
    if sqlerrm like 'HUMO_FALLA%' then raise; end if;
    if sqlerrm not like 'Antes de agendar%' then raise exception 'HUMO_FALLA 2: error inesperado: %', sqlerrm; end if;
  end;

  -- 3. Con el código correcto, sí.
  reset role;
  insert into public.agenda_verificaciones_contacto (empresa_id, email, codigo_hash, expira_en)
    values (e, cor, encode(digest('123456', 'sha256'), 'hex'), now() + interval '10 minutes');
  set local role anon;
  ok := public.agenda_verificar_codigo_contacto(cor, '123456', null, h);
  for r in select d::date d, hh::time hh from generate_series(current_date + 2, current_date + 9, interval '1 day') d, unnest(array['09:00','10:00','11:00','14:00','15:00','16:00']) hh loop
    begin
      if v is null then v := public.agenda_agendar_cita_publica(n, r.d, r.hh, '[PRUEBA] Humo', tel, cor, null, h);
      elsif v2 is null then
        -- 4. Cambiar la cita con otro celular debe fallar; con los mismos datos, funcionar.
        begin
          perform public.agenda_reagendar_cita_publica(v, n, r.d, r.hh, '[PRUEBA] Humo', '3000000000', cor, null, h);
          raise exception 'HUMO_FALLA 4: movió la cita con otro celular';
        exception when others then
          if sqlerrm like 'HUMO_FALLA%' then raise; end if;
        end;
        v2 := public.agenda_reagendar_cita_publica(v, n, r.d, r.hh, '[PRUEBA] Humo', tel, cor, null, h);
      end if;
    exception when others then
      if sqlerrm like 'HUMO_FALLA%' then raise; end if;
      t := sqlerrm;
    end;
    exit when v2 is not null;
  end loop;
  if v is null then raise exception 'HUMO_FALLA 3: no se pudo agendar en el inmueble %: %', n, t; end if;
  if v2 is null then raise exception 'HUMO_FALLA 4: no se pudo cambiar la cita: %', t; end if;

  -- 5. Con solo el celular no se ven las citas de otra persona.
  if exists (select 1 from public.agenda_cliente_citas_activas(tel, '', null, h)) then
    raise exception 'HUMO_FALLA 5: se ven citas con solo el celular';
  end if;
  if not exists (select 1 from public.agenda_cliente_citas_activas(tel, cor, null, h)) then
    raise exception 'HUMO_FALLA 5: el cliente no ve su propia cita';
  end if;

  raise exception 'HUMO_OK: permisos, verificación de correo, agendar, cambiar y consulta de citas funcionan (inmueble %, nada quedó guardado)', n;
end $$;
