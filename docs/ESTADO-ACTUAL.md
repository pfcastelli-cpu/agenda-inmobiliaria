# Estado actual

Actualizado: 03-nov-2026.

## Prioridad inmediata

- Subir una vez los 3 Excel de portales para crear la foto inicial.
- Probar con sesión real: Administración > Empresa, sedes, botones de encuesta desde correo y marca «Reubicación pendiente».
- Antes de publicar el front pendiente, revisar el diff y obtener autorización de Felipe.

## Estado técnico resumido

- La aplicación real está en `aplicacion/`; la raíz contiene una demo vieja.
- Supabase, SQL y funciones tienen cambios aplicados o desplegados hasta la migración 040 según la documentación previa.
- El código pendiente del último bloque de trabajo sigue sin commit ni push. Incluye soporte, reservas, visitas, funciones relacionadas y documentación asociada.
- No aplicar SQL, desplegar funciones, hacer commit ni hacer push sin autorización expresa para esa tarea.
- El modo de correos de pruebas sigue activo. No apagarlo antes de verificar destinatarios y configuración.
- La verificación de correo para reservas debe quedar encendida antes de recibir clientes reales.
- Outlook, dispositivos físicos, importación ICS real y algunas pantallas/correos siguen pendientes de prueba según el área modificada.

## Cómo actualizar este archivo

- Reemplazar lo superado; no acumular bitácora.
- Escribir solo: objetivo vigente, archivos o migraciones afectados, pruebas ejecutadas, estado de publicación y siguiente acción.
- Mover decisiones cerradas, pruebas antiguas y despliegues históricos a `docs/historico/`.
- No incluir tokens, secretos, datos personales ni cuerpos completos de funciones.

## Referencias bajo demanda

- Código: `docs/GUIA-DEL-CODIGO.md`.
- Producción: `docs/PUESTA-EN-MARCHA-PATRIMONIOS.md` y `docs/MEJORAS-EN-PRODUCCION.md`.
- Historial detallado: `docs/historico/CLAUDE-completo-2026-10-26.md`.
- Estado anterior al resumen corto: consultar Git con `git log -- docs/ESTADO-ACTUAL.md`.
