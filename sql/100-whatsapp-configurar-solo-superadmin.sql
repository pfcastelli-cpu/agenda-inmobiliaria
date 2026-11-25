-- La configuración de WhatsApp (interruptor, reglas, contactos, plantillas) la ve y la cambia solo el superadministrador.
-- Los demás roles conservan ver/responder/tomar/transferir. El superadministrador tiene todos los permisos por es_super.
delete from public.agenda_rol_permisos rp
 using public.agenda_roles r
 where rp.rol_id = r.id and rp.permiso = 'whatsapp.configurar' and not r.es_super;
