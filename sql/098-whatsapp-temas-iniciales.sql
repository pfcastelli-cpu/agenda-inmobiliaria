-- Temas iniciales de WhatsApp (la IA clasifica cada conversación en uno). Se pueden editar en Ajustes → Temas y equipo.
insert into public.agenda_wa_temas (empresa_id, clave, nombre, descripcion, orden)
select e.id, t.clave, t.nombre, t.descripcion, t.orden
from public.agenda_empresas e
cross join (values
  ('arriendos', 'Arriendos', 'Alguien busca o pregunta por un inmueble para arrendar, quiere visitarlo o agendar una cita.', 10),
  ('ventas', 'Ventas', 'Alguien quiere comprar o pregunta por un inmueble en venta.', 20),
  ('consignacion', 'Propietarios / consignación', 'Un propietario quiere ofrecernos su inmueble para arrendar o vender.', 30),
  ('arrendatarios', 'Arrendatarios actuales', 'Un arrendatario con contrato vigente: pagos, reparaciones, entrega o renovación.', 40),
  ('otros', 'Otros', 'Cualquier otra consulta que no encaje en los demás temas.', 90)
) as t(clave, nombre, descripcion, orden)
on conflict (empresa_id, clave) do nothing;
