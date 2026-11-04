# Estado actual

Actualizado: 04-nov-2026. Detalle completo anterior: `docs/historico/ESTADO-2026-11-04-completo.md` (buscar por palabra clave, no leer entero).

## Prioridad inmediata

- Probar con sesión real: aviso al arrendatario (botones sugerir hora/día/pausa), informe del propietario (sugerencia de arrendar), formulario de cambio de precio en `/propietario/`, y los correos nuevos en Gmail/Outlook.
- Revisar y, si Felipe autoriza, publicar «Eliminar usuario» (Superadministrador): código en `administracion.js`, `administracion.css`, `sesion.js` (revisar: cambió mucho) y acción `eliminar` en `gestion-accesos`. Sin desplegar ni probar con red real.
- Subir los 3 Excel de portales (foto inicial). Verificar el interruptor «Habilitar /consignar» (en producción aparece encendido; Felipe debe confirmar que fue a propósito).
- Pendiente: proponer 3 horarios distintos en el portal del arrendatario (hoy solo propone 1; requiere portal + BD).

## Correos (publicado en commits aed8065 y 25081a3; Supabase desplegado)

- Plantilla común `supabase/functions/_shared/plantilla-correo.ts` + fotos por tema en `marca-correo.ts` (`TemaFoto`) y `aplicacion/public/correo/foto-*.jpg` (con logo; solo se usan fotos temáticas con slug `patrimonios`).
- Catálogo visual: `node tests/generar-catalogo-correos.mjs` → `tmp/catalogo-correos.html` → PDF `Catalogo-de-correos.pdf` (raíz, sin versionar).
- Consignación: foto llaves, pasos y botón 📎 al script de Apps Script (secreto opcional `CAPTACION_INFO_INMUEBLE_URL`). Cambio de precio: venta/arriendo/ambos, valor, estudio de mercado sin costo. Informe y página `/propietario/`: sugerencia de arrendar si el inmueble es solo venta.
- Pendiente: la encuesta al cliente (`enviar-encuesta-cliente`) conserva diseño propio; el resumen semanal no tiene la sugerencia de arriendo.
- Modo de pruebas ACTIVO: todo va a `correo_pruebas_destino`. Los correos del sistema viejo (Google Calendar) siguen llegando a clientes reales.

## Base de datos aplicada en producción

- 041/042 captación por ciudad y `/consignar` (+ `captacion_publica_activa`); 044 tipos de actividad; 045 soporte inmutable; 046 demanda sin tope (alertas en Informes); 047 roles propios y 32 permisos (Fase A: solo afinan la pantalla; el rol base manda en RLS); 048 confirmación del arrendatario (+ cron `recordar-arrendatario` cada hora al minuto 5).
- Sin aplicar: `sql/043-captacion-video.sql` (video de `/consignar`).
- Pruebas de producción: citas `[PRUEBA]` con `es_prueba=true`, canceladas, nunca borradas.

## Reglas operativas vigentes

- No aplicar SQL, desplegar funciones, commit ni push sin autorización expresa de Felipe para esa tarea.
- Publicar: primero push (Netlify), después funciones (`--use-api --yes`; públicas con `--no-verify-jwt`).
- La verificación de correo para reservas debe quedar encendida antes de clientes reales.

## Cómo actualizar este archivo

Reemplazar lo superado (no acumular bitácora); máximo ~3 KB. Mover lo cerrado a `docs/historico/`. Sin secretos ni datos personales.
