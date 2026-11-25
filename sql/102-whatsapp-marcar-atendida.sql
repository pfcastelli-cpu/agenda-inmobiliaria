-- «Atendido»: quita el aviso de que una persona debe atender la conversación, sin cerrarla ni pausar la IA.
-- La IA sigue contestando. Lo puede usar quien pueda responder y vea la conversación.
create or replace function public.agenda_wa_atendida(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select * into v_c from public.agenda_wa_conversaciones where id = p_conv;
  if not found or auth.uid() is null
     or not public.agenda_wa_visible(v_c.empresa_id, v_c.asesor_id, v_c.tema_id)
     or not public.agenda_tiene_permiso(v_c.empresa_id, 'whatsapp.responder') then return; end if;
  update public.agenda_wa_conversaciones
     set requiere_atencion = false, alerta = null, sin_leer = 0,
         motivo_pausa = case when ia_activa then null else motivo_pausa end
   where id = p_conv;
end;
$$;
revoke all on function public.agenda_wa_atendida(uuid) from public, anon;
grant execute on function public.agenda_wa_atendida(uuid) to authenticated, service_role;
