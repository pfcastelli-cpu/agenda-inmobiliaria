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

## Segunda tanda (11-nov; SQL 068 y 069 YA APLICADOS; falta 070, desplegar `enviar-correo-propietario`, commit y push)
- **SQL 070 y 071 YA APLICADOS (11-nov) y `enviar-correo-propietario` redesplegada.** 071 da lectura a `cliente_confirmado_en` (agenda_citas da SELECT por columna: al agregar columnas que el navegador lee, otorgar también su SELECT). Falta: commit y push del front (etiqueta «Agendada», varios inmuebles, pestañas de Pendientes, buscador).
- Copia de pruebas y trabajo en paralelo con otra herramienta: guía en `docs/AMBIENTE-DE-PRUEBAS.md` (copia NO creada aún).
- `sql/070` (informe del propietario con varios inmuebles: función `agenda_informe_propietario_inmuebles`, solo muestra inmuebles cuyos propietarios incluyen a todos los del enlace). El front de `propietario.js` ya la llama y es tolerante. Etiqueta de la tarjeta «Confirmada» renombrada a «Agendada» (no confundir con «Confirmada por el cliente»).
- `sql/068` (estudios con responsable y fecha límite) y `sql/069` (no crear/mover citas en el pasado; acompañantes crean cita «espejo» y bloquean su agenda; altas/bajas de acompañantes por funciones `agenda_agregar_participante` / `agenda_quitar_participante`). El front de acompañantes YA llama a esas funciones: hasta aplicar 069 el botón de agregar persona avisa que falta el SQL.
- Front: Pendientes agrupa pestañas Publicidad / Propietarios / Estudios / Salud (menú lateral solo «Pendientes»), texto blanco en botones de Salud, tabla de Salud con filtro y orden, buscador de inmuebles en la actividad interna (`buscador-inmuebles.js`), «Anotar estudio pendiente» con responsable y fecha.
- Función `enviar-correo-propietario` (hay que redesplegarla, `--no-verify-jwt`): aviso «te avisará cada vez que se asigne una cita», botones «Ver el informe» y «Configurar mis avisos o darme de baja» (preferencias ya existían en sql/032) y cabecera List-Unsubscribe.

## Pendiente de aplicar (11-nov, sin commit ni push)

- **SQL 061–067 YA APLICADOS en producción (11-nov)**, verificado (columnas, tablas, permiso `auditoria.ver`, 7 disparadores, cron de festivos). Quedan SIN programar los crons de 062 (`recordar-cliente`) y 067 (`informe-equipo`).
- **Funciones YA DESPLEGADAS (11-nov)**: las 2 nuevas, `portal-visita`, `filtrar-opiniones`, `avisar-solicitud-hecha`, `enviar-solicitud-propietario` y las demás que usan `_shared/marca-correo.ts` (excepto `crear-videollamada`, no tocada). Crons `recordar-cliente` (cada hora, min 10) e `informe-equipo` (diario 7:00 Colombia; el informe está apagado por defecto) YA PROGRAMADOS. Falta: push. (Texto histórico del orden:) desplegar `recordar-cliente` (`--no-verify-jwt`), `portal-visita`, `filtrar-opiniones`, `avisar-solicitud-hecha` y `enviar-solicitud-propietario` (pública, `--no-verify-jwt`), `enviar-informe-equipo` (`--no-verify-jwt`, cron al final de 067) y TODAS las funciones que envían correos a propietarios (por `_shared/marca-correo.ts`: botón «Quiero consignar» ahora lleva a /consignar o a `consignar_url`); 3) programar el cron al final de 062; 4) push.
- Hecho en front: ficha de asesor, avisos legibles, sin "Supabase" en textos, actividad interna (dirección, hora de fin, tipo "Visita de un cliente"), botón "Cambiar de asesor", ICS oculto, modelo de IA con lista, confirmación del cliente en `/visita/`, menú Propietarios (con contador) y Salud fuera de Configuración, Informes con filtro/orden y gráficas arriba, Estudios con lista de inmuebles, tickets con confirmación y formulario limpio, botón de llegada configurable (apagado por defecto).
- Hecho también: acompañantes en una visita (065) y destinatarios elegidos de avisos de propietarios + informe de gestión (064).
- Hecho también: Registro de cambios del sistema (066, permiso `auditoria.ver`, menú «Registro»), resumen automático por correo (067), `consignar_url` configurable (063).
- Falta: horarios recurrentes/indefinidos del arrendatario (hoy son franjas por fecha en `agenda_inmueble_ventanas`; requiere tabla de patrones semanales y que el motor o un job los materialice), saber QUIÉN dio clic en «Quiero consignar» (requiere enlace con token por destinatario).

## Pendiente de autorizar (botones de la visita)
- Correo de confirmación al cliente (`enviar-correo-cita`): botones Maps, Waze, WhatsApp y Llamar (código listo, falta redesplegar con `--no-verify-jwt`).
- Página tras agendar (`reservar.js`): mismos botones, usa `sql/072-contacto-visita-publica.sql` (falta aplicar en producción; sin él la página queda como antes).
- Falta commit/push. No probado con red real ni en el navegador (solo `npm run build`).

## Pendiente de autorizar (horario por día del arrendatario)
- `sql/073-horario-por-dia.sql`: columna `agenda_inmuebles.horario_por_dia` + `agenda_sugerir_horarios_portal_base` respeta el rango de cada día + guardar horario uniforme desde la agenda lo limpia. SIN aplicar.
- `portal-visita` (guardar_horario acepta `por_dia`) y `arrendatario.js` (modo «mismo horario» / «distinto por día», selectores cada 30 min, resumen). SIN desplegar.
- ORDEN: aplicar SQL 073 PRIMERO, luego desplegar `portal-visita` (consulta la columna nueva; sin SQL fallaría). Después push (Netlify).
- Sin probar en navegador ni con red real; solo `npm run build`.
- Agenda interna (agenda-real.js) aún no edita el horario por día: solo lo limpia si el admin guarda uno uniforme.
- ACTUALIZACIÓN 11-nov-2026: SQL 072 y 073 YA APLICADOS en producción. Siguen sin desplegar: `portal-visita` y `enviar-correo-cita`; y sin commit/push.

## Pendiente de autorizar (11-nov-2026, lote 3)
- `sql/074-preferencias-tipos-de-aviso.sql`: el propietario elige qué avisos recibe (visita nueva / cambio de hora / cancelación). SIN aplicar.
- `sql/075-tickets-prioridad-y-tiempos.sql`: prioridad baja/media/alta al crear el ticket + tiempos de respuesta por empresa (admin los edita en Soporte). SIN aplicar.
- Funciones a desplegar: `notificar-cambio-cita` (cancelación a propietario y arrendatario con explicación, datos del asesor, botones WhatsApp/llamar e informe), `enviar-correo-propietario` (respeta avisos), `avisar-ticket` (plazo real). `portal-visita` y `enviar-correo-cita` siguen sin desplegar. Los SQL 072/073 ya están aplicados.
- ORDEN: aplicar 074 y 075 ANTES de desplegar/subir (la pantalla de tickets y la de preferencias llaman funciones nuevas; si faltan, quedan tolerantes pero sin la función nueva). Luego push.
- Sin probar en navegador ni con red real; solo `npm run build`.
- ACTUALIZACIÓN 11-nov-2026: SQL 074 y 075 aplicados; desplegadas portal-visita, enviar-correo-cita, enviar-correo-propietario (públicas), notificar-cambio-cita y avisar-ticket (con JWT). Falta solo lo visible del front (push → Netlify).

## Aplicado y desplegado (inspecciones con código de llegada y salida, 11-nov-2026)
SQL 076 aplicado y `avisar-inspeccion` desplegada el 11-nov-2026; NO probado con red real:
- `sql/076-inspeccion-codigos.sql`: códigos de 4 dígitos (distintos) por inspección, ilegibles desde la agenda; `agenda_inspeccion_registrar_codigo` (5 intentos → bloqueo 15 min, solo el día de la cita) y `agenda_inspeccion_publica`.
- Página pública `/inspeccion/<token>` (`aplicacion/inspeccion.html`, `js/inspeccion.js`, rutas en `netlify.toml` y `vite.config.js`): el arrendatario ve el código de llegada el día de la cita y, ya registrada la llegada, el de salida.
- Agenda (`agenda-real.js`, `cargarInspecciones`): quien inspecciona escribe los códigos; se guarda hora de llegada, salida y duración. Si el SQL no está aplicado, el bloque no aparece.
- Edge Function nueva `avisar-inspeccion` (correo al arrendatario con enlace y datos del asesor; JWT, SIN `--no-verify-jwt`).
Orden: aplicar 076 → desplegar `avisar-inspeccion` → commit/push. Con modo pruebas de correo activo.

## Correos pulidos y respuesta al propietario (12-nov-2026, desplegado)
- `correoBase` acepta `etiqueta` (de qué trata/a quién va) y `motivo` (por qué y cuándo se envía); usado en cancelaciones, aviso de visitas, confirmación al cliente y respuesta al propietario.
- Aviso de visitas al arrendatario: una tarjeta por visita con día grande. Confirmación al cliente: botón principal «Confirmo que asistiré».  Se REVIRTIÓ la confirmación con un toque (por antivirus de correo): el portal sigue pidiendo el último toque.
- Cancelación por el cliente: el correo pregunta el motivo (botones → `/visita/<token>?motivo=`); `portal-visita` acción `motivo` lo guarda en la cita si no había.
- Nueva función `responder-propietario` (JWT) + botón en Solicitudes (admin-propietarios.js) y página `/responder/<id de la solicitud>` (login del asesor; el botón del correo de asesoría ahora lleva ahí).
- Vista previa de correos para soporte de plataforma: `/correos` (`correos.html`, `js/correos.js`) + función `vista-previa-correos` (JWT, solo `agenda_soporte_usuarios`). Las muestras están escritas a mano dentro de la función: si cambias un correo real, actualiza su muestra. SIN probar con sesión de soporte.
