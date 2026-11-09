# Estado actual

Actualizado: 06-nov-2026. Detalle anterior: `docs/historico/ESTADO-2026-11-04-completo.md` (buscar por palabra clave, no leer entero).

## Urgente (06-nov, tras la simulación de 2 semanas)

- **Desplegadas el 06-nov** (verify_jwt conservado: públicas sin JWT; `enviar-informe-propietario` y `avisar-arrendatario` con JWT): calendario-ics, enviar-correo-cita, enviar-correo-propietario, enviar-encuesta-cliente, enviar-encuestas-pendientes, enviar-resumen-propietarios, recordar-arrendatario, enviar-informe-propietario, avisar-arrendatario. Calendario por asesor probado (200 / 404 con token inválido); el enlace «Todas las agendas» (token en `agenda_calendario_empresa`) NO se pudo probar con red real: abrirlo/suscribirlo y confirmar.
- Probado con red real el 06-nov: `gestion-accesos` v17 (alta por invitación `sim+invitacion@example.com`, «Eliminar usuario»), alta de asesor desde el formulario (`[SIM] Asesor Alta Formulario`) y enlace «Todas las agendas» (200, text/calendar, 146 eventos). El correo de invitación a una dirección real no se vio llegar (se usó example.com).
- Usuarios de prueba `sim+prueba2`, `sim+prueba3` y `sim+invitacion` ya eliminados (06-nov). Queda el asesor `[SIM] Asesor Alta Formulario` (sin acceso).

## Pendiente de desplegar (09-nov)

- Se quitó el botón temporal «Crear usuario de prueba» (`administracion.js`, `sesion.js`) y la opción `sin_credenciales` de `gestion-accesos`. Falta redesplegar `gestion-accesos` (con JWT, sin `--no-verify-jwt`) para que producción deje de aceptarla; hasta entonces solo un administrador autenticado podría usarla.
- Errores rojos revisados en CSS e inline: todos con texto rojo y contraste ≥ 6:1 (claro y oscuro); el aviso flotante de error es texto blanco sobre rojo oscuro.

## Revisión 07-nov (correos, contraste y citas)

- `enviar-informe-propietario` v17: el correo salía en blanco (plantilla vieja en un comentario se tragó el `return`); corregido, desplegado y verificado en Gmail.
- `sql/056-arreglo-cancelar-y-mover-cita.sql` aplicado en producción: cancelar y mover cita fallaban con «permission denied for table agenda_citas» desde la 055 (`select *` en funciones SECURITY INVOKER). Probados con red real: cancelar, mover y radicación, con sus correos (llegan completos al correo de pruebas). Citas de prueba creadas ese día quedaron canceladas y marcadas.
- Contraste corregido (rojo de errores en accesos en modo oscuro, «Volver a la agenda», avatares). Checklist para probar antes de salir: `docs/CHECKLIST-PRUEBAS.md`.
- Probado también con red real el 07-nov (todo llega completo al correo de pruebas): contraseña olvidada, solicitud del propietario («Pedir una asesoría»), ticket de soporte (#7, de prueba, queda en la consola), aviso al arrendatario + «Confirmo que estaré» (inmueble 990005 puesto en «Rentando» solo durante la prueba y devuelto a «Disponible»), cancelar y mover. Vista móvil (375 px) sin desbordes en propietario, arrendatario, reservar, inicio y administración.
- Encuestas: ya probadas antes (pausa `encuestas_pausadas` activa a propósito). Recordatorio de 24 h al arrendatario: el job pg_cron `recordar-arrendatario` corre cada hora y su última ejecución (09-nov) terminó bien; el correo que manda es el mismo del aviso, ya probado. Regla: SQL/docs/funciones con `[skip netlify]` en el commit para ahorrar créditos.

## Aplicado en producción el 06-nov

- `sql/054-correcciones-simulacion.sql`: modo pruebas exige destino, trigger de permisos mover/cancelar del asesor, fechas de bitácora e informe en hora de Bogotá, informe del propietario sin comentarios de clientes ni nota del asesor y solo visitas completadas, encuesta respondible una vez, `agenda_correos_log` acepta `solicitud_propietario`, `propietario_informe`, `estudio_mercado`.
- `sql/055-proteger-tokens.sql`: token del calendario de la empresa en `agenda_calendario_empresa` (solo admin); `agenda_citas.token_cliente/token_arrendatario` ya no se pueden leer desde el navegador (hay que listar columnas, nunca `select('*')` sobre `agenda_citas`; columna nueva → `grant select (col) on public.agenda_citas to authenticated`).
- Estudios de mercado probados de punta a punta en producción con el inmueble de prueba 990004 (botón del propietario → lista Estudios → PDF → envío al correo de pruebas): funciona.

- `sql/056-captador-primero.sql` aplicado el 09-nov (archivo de referencia sin commitear): el portal ofrece primero al captador (activo y con horarios), si no a la planta de la ciudad, si no al freelance. La función anterior quedó como `agenda_sugerir_horarios_portal_base`. Verificado: inmueble 455 → solo Luis Jiménez; 695 → solo Laura Salcedo.

## Trabajo de otras sesiones sin commitear (no tocar sin revisar)

- Alertas de salud del inmueble («inmueble sin movimiento»): `sql/051-alertas-salud-inmueble.sql`, función `enviar-alerta-salud`, cambios en `admin-propietarios.js` y `propietario.js`. Hay dos archivos `sql/051-*`: renumerar uno.

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
