# Estado actual

Actualizado: 06-nov-2026. Detalle anterior: `docs/historico/ESTADO-2026-11-04-completo.md` (buscar por palabra clave, no leer entero).

## Urgente (06-nov, tras la simulación de 2 semanas)

- **Desplegar ya las Edge Functions** (pendiente de autorización; el SQL 055 ya está aplicado y rompió el enlace del calendario de TODA la empresa hasta que se despliegue `calendario-ics`): `npx --no-install supabase functions deploy calendario-ics enviar-correo-cita enviar-correo-propietario enviar-encuesta-cliente enviar-encuestas-pendientes enviar-informe-propietario enviar-resumen-propietarios recordar-arrendatario avisar-arrendatario --project-ref ykiuuxludyonkhywtmgu --use-api --yes --no-verify-jwt`. Estas funciones ya están en `main` (commit 44e5e8a), el front ya publicado.
- `gestion-accesos`: en `main` solo van los arreglos de `crear` (rollback de usuario huérfano). El «Eliminar usuario» (superadmin) sigue SIN commitear en el árbol de trabajo, sin revisar ni desplegar. Desplegar `gestion-accesos` ahora llevaría solo lo commiteado.
- Probar con sesión real tras desplegar: pestaña Administración → Calendario (enlaces), alta de asesor nuevo, alta de acceso con login.

## Aplicado en producción el 06-nov

- `sql/054-correcciones-simulacion.sql`: modo pruebas exige destino, trigger de permisos mover/cancelar del asesor, fechas de bitácora e informe en hora de Bogotá, informe del propietario sin comentarios de clientes ni nota del asesor y solo visitas completadas, encuesta respondible una vez, `agenda_correos_log` acepta `solicitud_propietario`, `propietario_informe`, `estudio_mercado`.
- `sql/055-proteger-tokens.sql`: token del calendario de la empresa en `agenda_calendario_empresa` (solo admin); `agenda_citas.token_cliente/token_arrendatario` ya no se pueden leer desde el navegador (hay que listar columnas, nunca `select('*')` sobre `agenda_citas`; columna nueva → `grant select (col) on public.agenda_citas to authenticated`).
- Estudios de mercado probados de punta a punta en producción con el inmueble de prueba 990004 (botón del propietario → lista Estudios → PDF → envío al correo de pruebas): funciona.

## Trabajo de otras sesiones sin commitear (no tocar sin revisar)

- Alertas de salud del inmueble («inmueble sin movimiento»): `sql/051-alertas-salud-inmueble.sql`, función `enviar-alerta-salud`, cambios en `admin-propietarios.js` y `propietario.js`. Hay dos archivos `sql/051-*`: renumerar uno.
- «Eliminar usuario»: `administracion.js`, `sesion.js`, `administracion.css`, `gestion-accesos`.

## Pendientes de producto

- Simulación 06-nov: datos `[SIM]`/`[PRUEBA]` siguen en producción (4 asesores 990001–990006, 25 citas `es_prueba`); no borrar sin orden. Para probar flujo de arrendatario poner `estado_crm='rentando'` en 990001/3/5/6.
- Pendientes menores: `correo_pruebas_destino` ya no puede quedar vacío (CHECK); el destinatario cae al real si falta solo si se fuerza; enlace `/visita/` fijo en `enviar-correo-cita` (ignora `dominio_publico`); resumen semanal solo manda a propietarios con fila en preferencias; la sincronización con el ERP puede marcar los inmuebles de simulación como no disponibles.
- Subir los 3 Excel de portales; confirmar interruptor «Habilitar /consignar»; proponer 3 horarios en el portal del arrendatario; `sql/043-captacion-video.sql` sin aplicar.

## Reglas operativas vigentes

- Modo de pruebas de correo ACTIVO; no apagar sin orden de Felipe. Verificación de correo para reservas encendida antes de clientes reales.
- Publicar: primero push (Netlify), luego SQL, luego funciones (`--use-api --yes`; públicas con `--no-verify-jwt`).
- No aplicar SQL, desplegar, commit ni push sin autorización expresa de Felipe para esa tarea. Una sola herramienta edita el checkout a la vez.

## Cómo actualizar este archivo

Reemplazar lo superado (no acumular bitácora); máximo ~3 KB. Mover lo cerrado a `docs/historico/`. Sin secretos ni datos personales.
