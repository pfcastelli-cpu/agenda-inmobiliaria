# Estado actual

Actualizado: 06-nov-2026. Detalle anterior: `docs/historico/ESTADO-2026-11-04-completo.md` (buscar por palabra clave, no leer entero).

## Urgente (06-nov, tras la simulación de 2 semanas)

- **Desplegadas el 06-nov** (verify_jwt conservado: públicas sin JWT; `enviar-informe-propietario` y `avisar-arrendatario` con JWT): calendario-ics, enviar-correo-cita, enviar-correo-propietario, enviar-encuesta-cliente, enviar-encuestas-pendientes, enviar-resumen-propietarios, recordar-arrendatario, enviar-informe-propietario, avisar-arrendatario. Calendario por asesor probado (200 / 404 con token inválido); el enlace «Todas las agendas» (token en `agenda_calendario_empresa`) NO se pudo probar con red real: abrirlo/suscribirlo y confirmar.
- Probado con red real el 06-nov: `gestion-accesos` v17 (alta por invitación `sim+invitacion@example.com`, «Eliminar usuario»), alta de asesor desde el formulario (`[SIM] Asesor Alta Formulario`) y enlace «Todas las agendas» (200, text/calendar, 146 eventos). El correo de invitación a una dirección real no se vio llegar (se usó example.com).
- Usuarios de prueba `sim+prueba2`, `sim+prueba3` y `sim+invitacion` ya eliminados (06-nov). Queda el asesor `[SIM] Asesor Alta Formulario` (sin acceso).

## Revisión general 10-nov (solo lectura; nada aplicado)

- **Corregido el 10-nov** (`sql/058-verificacion-correo-en-servidor.sql`, aplicado en producción, archivo sin commitear): el código de verificación solo lo genera `service_role`; agendar/reagendar públicos son envolturas que exigen correo verificado (si `verificar_correo_reserva` está encendido; hoy apagado) y tope de 5 visitas por contacto en 6 meses (pedido por Felipe); las originales quedaron como `..._base` (solo `service_role`). Probado el 10-nov por la API pública con la llave anon (agendar y reagendar OK; generar código y `_base` → 401) y, en transacción revertida, el flujo del código con la verificación encendida (sin código bloquea; con código agenda). Clientes reales: máximo 3.
- **API de SEDI (evaluada 10-nov, nada construido):** `POST ns3.sedierp.com/API_SIS/api/Login/OauthTokenIntegrador` da token (dura ~8 h) y `POST /api_gbi/api/Inmuebles/InmueblesConsultar {rows:1000}` devuelve 697 inmuebles con 41 campos (Consecutivo = número de inmueble, EstadoInmueble Libre/Arrendado/Retirado, canon, venta, ciudad, barrio, coordenadas, nombre del propietario). Sirve para reemplazar el Excel de inmuebles. No trae correo/teléfono del propietario ni datos del arrendatario: habría que probar `Terceros/*` y los contratos (sin probar). El token también permite insertar/borrar en el ERP: guardar los 4 identificadores en Vault, usar solo rutas `*Consultar`, nunca en el navegador ni en el repo.
- Medio: `agenda_cliente_citas_activas`, `agenda_cita_id_publica` y `agenda_reagendar_cita_publica` funcionan solo con teléfono o correo (quien conozca el celular ve/mueve la cita). `agenda_correo_tiene_password` ejecutable por anon. `enviar-encuesta-cliente` acepta `forzar` sin autenticación.
- 10-nov: `sql/057` aplicado (botones «Eliminar asesor» y «Borrar datos de prueba»); `gestion-accesos` redesplegada (con JWT); SQL repetidos renombrados a `051b` y `056b`; del tope quedan exentos los correos del dominio del remitente de la empresa (patrimonios.co). Commit hecho, **falta push** para que los botones nuevos y las alertas de salud lleguen a la página. Datos de prueba por borrar con el botón: 30 citas, 5 asesores `[SIM]` (los 7 inmuebles 99000x no los toca el botón).
- CLI de Supabase: `npx --no-install supabase` ya no arranca (pide 3.1.0); funciona `node %LOCALAPPDATA%/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/supabase/dist/supabase.js` (3.0.0, ya autenticado).
- Menor: protección de contraseñas filtradas apagada en Auth; ~30 llaves foráneas sin índice; sin cabeceras de seguridad en `netlify.toml`; colores fijos nuevos en `propietario.js` (`#eef8f7`).
- Bien: RLS en todas las tablas, `search_path` en todas las SECURITY DEFINER, cron con Vault, build y prueba de contacto (12/12) pasan.

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

- `sql/056b-captador-primero.sql` aplicado el 09-nov (archivo de referencia sin commitear): el portal ofrece primero al captador (activo y con horarios), si no a la planta de la ciudad, si no al freelance. La función anterior quedó como `agenda_sugerir_horarios_portal_base`. Verificado: inmueble 455 → solo Luis Jiménez; 695 → solo Laura Salcedo.

## Trabajo de otras sesiones sin commitear (no tocar sin revisar)

- Alertas de salud del inmueble («inmueble sin movimiento»): `sql/051b-alertas-salud-inmueble.sql`, función `enviar-alerta-salud`, cambios en `admin-propietarios.js` y `propietario.js`.

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

## Aplicado el 10-nov (sin commitear ni publicar: falta commit y push)

- `sql/059-cambiar-cita-exige-celular-y-correo.sql`: ver citas activas, obtener el id y reagendar desde la página pública exigen celular Y correo (antes bastaba uno). Frontend sin cambios.
- `enviar-encuesta-cliente`: `forzar` solo con sesión o service role. Desplegada el 10-nov (pública, sin JWT).
- `tests/humo-reservas.sql`: prueba de humo que no deja datos (esperado `HUMO_OK`); corrida el 10-nov con resultado HUMO_OK; repetirla tras cualquier cambio en citas o permisos.
- SEDI: la documentación (`tech.sedierp.com`, sección «Portal externo») muestra consultas de inmuebles/contratos, propietarios y arrendatarios, pero son por usuario del portal, no masivas. Los códigos de Metrocuadrado/Fincaraíz/Ciencuadras no vienen en `InmueblesConsultar`: preguntar a SEDI por el campo o seguir con los Excel de portales.
- Decidido no hacer antes de salir: partir `agenda-real.js` (riesgo sin beneficio para el usuario) y entorno de pruebas (requiere crear un segundo proyecto de Supabase).

## Pendiente de aplicar (11-nov, sin commit ni push)

- **SQL 061–067 YA APLICADOS en producción (11-nov)**, verificado (columnas, tablas, permiso `auditoria.ver`, 7 disparadores, cron de festivos). Quedan SIN programar los crons de 062 (`recordar-cliente`) y 067 (`informe-equipo`).
- **Funciones YA DESPLEGADAS (11-nov)**: las 2 nuevas, `portal-visita`, `filtrar-opiniones`, `avisar-solicitud-hecha`, `enviar-solicitud-propietario` y las demás que usan `_shared/marca-correo.ts` (excepto `crear-videollamada`, no tocada). Crons `recordar-cliente` (cada hora, min 10) e `informe-equipo` (diario 7:00 Colombia; el informe está apagado por defecto) YA PROGRAMADOS. Falta: push. (Texto histórico del orden:) desplegar `recordar-cliente` (`--no-verify-jwt`), `portal-visita`, `filtrar-opiniones`, `avisar-solicitud-hecha` y `enviar-solicitud-propietario` (pública, `--no-verify-jwt`), `enviar-informe-equipo` (`--no-verify-jwt`, cron al final de 067) y TODAS las funciones que envían correos a propietarios (por `_shared/marca-correo.ts`: botón «Quiero consignar» ahora lleva a /consignar o a `consignar_url`); 3) programar el cron al final de 062; 4) push.
- Hecho en front: ficha de asesor, avisos legibles, sin "Supabase" en textos, actividad interna (dirección, hora de fin, tipo "Visita de un cliente"), botón "Cambiar de asesor", ICS oculto, modelo de IA con lista, confirmación del cliente en `/visita/`, menú Propietarios (con contador) y Salud fuera de Configuración, Informes con filtro/orden y gráficas arriba, Estudios con lista de inmuebles, tickets con confirmación y formulario limpio, botón de llegada configurable (apagado por defecto).
- Hecho también: acompañantes en una visita (065) y destinatarios elegidos de avisos de propietarios + informe de gestión (064).
- Hecho también: Registro de cambios del sistema (066, permiso `auditoria.ver`, menú «Registro»), resumen automático por correo (067), `consignar_url` configurable (063).
- Falta: horarios recurrentes/indefinidos del arrendatario (hoy son franjas por fecha en `agenda_inmueble_ventanas`; requiere tabla de patrones semanales y que el motor o un job los materialice), saber QUIÉN dio clic en «Quiero consignar» (requiere enlace con token por destinatario).
