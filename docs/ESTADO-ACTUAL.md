# Estado actual

Actualizado: 03-nov-2026.

## Prioridad inmediata

- Subir una vez los 3 Excel de portales para crear la foto inicial.
- Probar con sesión real: Administración > Empresa, sedes, botones de encuesta desde correo y marca «Reubicación pendiente».
- Antes de publicar el front pendiente, revisar el diff y obtener autorización de Felipe.

## Captación por ciudad y página pública `/consignar` (03-nov, sin commit ni push)

- SQL 041 APLICADO (horarios de captación por ciudad, todos los asesores mezclados, 7 días; `agenda_sugerir_horarios_captacion_ciudad`). Causa del «no hay horarios»: ninguna cobertura tenía asesores.
- SQL 042 APLICADO en producción (columna `captacion_publica_activa` por defecto apagada; RPC `agenda_captacion_publica_config/horarios/agendar`, ejecutables por `anon`). Probado: validaciones, asignación al asesor de mayor prioridad, horario ya tomado, tope por correo/celular.
- Edge Function `avisar-captacion` DESPLEGADA (pública, sin JWT). Prueba real con cita `[PRUEBA]` (Barranquilla, cancelada después): 2 correos enviados al destino de pruebas, segunda llamada no reenvía. El interruptor quedó APAGADO.
- Front: `consignar.html` + `js/consignar.js` (vista previa simulada `tests/fixtures/consignar-preview.html`: flujo completo OK), `captacion-horarios.js` (formulario interno: ciudad → zona opcional, horarios mezclados, lista de orígenes ampliada), coberturas agrupadas por ciudad en `administracion.js`, interruptor «Habilitar /consignar» en Administración → Empresa, enlace a meet.new cuando Meet no está conectado. `vite build` y 48 pruebas pasan.
- Siguiente: Felipe autoriza el push (Netlify) → activar el interruptor «Habilitar /consignar» en Administración → Empresa. Archivos del propietario (Drive) y tipos de inmueble: sin cambios por ahora.

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
