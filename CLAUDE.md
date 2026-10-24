# Agenda de citas — Patrimonios Inmobiliarios

Contexto para Claude Code. Lee esto primero. `PROYECTO.md` y los `LEEME-*.md` son bitácoras
históricas de entregas anteriores (algunas describen una demo vieja, ya superada) — este
archivo es el estado real y actual.

## Qué es esto
Sistema de agenda de citas para asesores inmobiliarios (multi-ciudad, multi-asesor,
pensado para venderse como SaaS a otras inmobiliarias). Reemplaza un sistema legado en
Google Calendar + Apps Script + Sheets (ver sección 1 del doc de estado si necesitas el
detalle del legado — está en el proyecto de Claude "Agenda de citas", no en este repo).

## Regla fija: mantener este archivo al día
Este archivo es la única fuente de verdad que CUALQUIER sesión nueva (incluida una de
Claude Code que nunca vio conversaciones anteriores) lee automáticamente al abrir esta
carpeta. Si no se actualiza aquí, la próxima sesión parte de información vieja. Por eso,
cualquier sesión (Cowork o Claude Code) que haga un cambio real en este proyecto (código,
SQL, configuración) debe, antes de darlo por terminado:
1. Actualizar la sección "Estado real" de abajo con lo que se construyó o cambió (una o
   dos líneas por entrega, no una bitácora exhaustiva — el detalle largo, sesión por
   sesión, va en el documento `estado-actual-y-plan.md` del proyecto de Claude "Agenda de
   citas", no aquí).
2. Revisar "Pendiente / próximos pasos conocidos": quitar lo que ya se resolvió con este
   cambio y agregar lo nuevo que haya quedado pendiente.
3. Si el cambio introduce una convención nueva (patrón de código, regla de seguridad,
   tipo de archivo nuevo), documentarla en la sección correspondiente arriba
   (Arquitectura / Convenciones de seguridad establecidas).
4. Si se aplicó SQL directamente en Supabase (vía MCP o el dashboard) sin pasar por un
   archivo, dejar un `sql/00X-descripcion.sql` de referencia como ya se hace (ver
   001-005), aunque sea solo documentación de algo ya ejecutado.
5. Commitear `CLAUDE.md` junto con el cambio de código, en el mismo commit — no en uno
aparte — para que el historial de git amarre código y documentación.

Si un cambio es tan pequeño que de verdad no afecta nada de lo anterior (una corrección
de texto, un ajuste visual menor), no hace falta tocar este archivo — la regla es sobre
cambios reales de funcionalidad, datos o convenciones.

## Arquitectura
- Frontend: Vite + JS vanilla, sin framework. `aplicacion/` es la app real (login, agenda
  interna, reserva pública, configuración). La raíz (`index.html`, `referencia-visual.html`)
  es una demo visual vieja — no tocar, no es la app real.
- Backend: Supabase (`https://ykiuuxludyonkhywtmgu.supabase.co`, project id
  `ykiuuxludyonkhywtmgu`). Postgres + RLS, Supabase Auth, Edge Functions en `supabase/functions/`,
  Supabase Vault para secretos (nunca contraseñas en texto plano ni en columnas normales).
- Hosting: Netlify, conectado a GitHub — cada push a `main` despliega solo a
  `citas.patrimonios.co`.
- Multi-empresa desde el día 1 (`agenda_empresas` + RLS por `empresa_id`).
- Patrón de front end en `aplicacion/js/agenda-real.js`: un objeto `state` global, un
  `render()` que despacha según `state.view`, `nav()` para resaltar la pestaña activa,
  visibilidad de pestañas por rol (`contexto.rol`), iconos Lucide vía `createIcons`/`icon()`,
  `escape()` para texto en HTML, consultas directas con `supabase.from(...)` para paneles de
  administrador (no todo pasa por RPC). Clases CSS reutilizadas: `v-top`, `v-eyebrow`,
  `v-note`, `v-muted`, `v-empty`, `v-btn`, `v-primary`, `v-quiet`, `v-field`, `v-input`,
  `v-error`, `v-filters`. Filtros de selects/fechas se enlazan con `change`, texto libre con
  `input` + debounce (ver patrón en `v-search`/`v-bitacora-texto`).

## Convenciones de seguridad establecidas (seguir siempre)
- Cualquier acción que necesite la `service_role` key de Supabase (crear usuarios, cambiar
  contraseñas, leer secretos de Vault) va en una Edge Function, nunca en el navegador. La
  función verifica ella misma que quien llama es administrador activo de la empresa
  (patrón: leer el JWT del `Authorization` header, `admin.auth.getUser(jwt)`, luego
  chequear `agenda_miembros`).
- Nunca usar `auth.users` directamente en una política RLS ni en SQL que corra como el rol
  `authenticated` — ese rol no tiene permiso sobre esa tabla y falla con
  "permission denied for table users" (bug real que ya pasó y se corrigió en la política
  `citas_edicion`). Usar `auth.email()` / `auth.uid()` en su lugar.
- `agenda_miembros` solo permite autolectura (`authenticated` lee su propia fila, no la de
  otros). Cualquier pantalla de administrador que necesite resolver nombres de otros
  miembros (quién hizo tal acción, lista del equipo) tiene que pasar por una función
  `SECURITY DEFINER` (que corre como su dueño y sí puede leer toda la tabla), nunca por un
  `.select()` anidado desde el navegador. Ejemplos ya construidos:
  `gestion-accesos` (Edge Function), `agenda_bitacora_citas` / `agenda_bitacora_encuestas`
  (RPC). Toda RPC así valida ella misma que quien llama es administrador/coordinador activo
  de esa empresa antes de devolver nada.
- Contraseñas SMTP y similares: se guardan en Supabase Vault vía una función
  `SECURITY DEFINER` que solo puede ejecutar `service_role` (`agenda_obtener_password_correo`).
  Nunca se devuelven al navegador, ni siquiera a un administrador.
- **Tablas nuevas en `public` necesitan GRANT explícito** (aviso de Supabase, vigente desde
  el 30-oct-2026 para proyectos existentes; las tablas actuales no cambian). Toda migración
  que cree una tabla debe incluir en el mismo archivo: `grant select on public.<tabla> to
  anon;` (solo si la página pública la necesita), `grant select, insert, update, delete on
  public.<tabla> to authenticated;` y lo mismo `to service_role;`, además de su RLS. Sin
  eso, supabase-js falla con "permission denied". Agregar columnas a tablas existentes no
  requiere nada.
- `agenda_asesores` (ficha del asesor) y `agenda_miembros` (quién puede iniciar sesión) eran
  tablas separadas sin relación entre sí a propósito — desde la entrega de vínculo
  asesor-usuario (ver abajo) `agenda_asesores.usuario_id` puede vincular una ficha a una
  cuenta de acceso, pero crear un asesor sigue sin dar acceso de login por sí solo; el
  vínculo es un paso explícito ("Dar acceso").

## Estado real (20-oct-2026 en adelante)
Todo lo siguiente ya está construido y probado en algún nivel (ver detalle completo en el
proyecto de Claude "Agenda de citas" → documento `estado-actual-y-plan.md`, que tiene la
bitácora completa sesión por sesión):
- Login, motor de citas con prioridad/zona/traslado real, página pública de reservas,
  captaciones/coberturas, gestión de accesos (crear usuarios, cambiar contraseñas, invitar
  por correo — Edge Function `gestion-accesos`), configuración de correo SMTP (Vault),
  envío real del correo de confirmación al cliente + bitácora de fallos (Edge Function
  `enviar-correo-cita`, tabla `agenda_correos_log`), botón de prueba de configuración de
  correo (Edge Function `probar-correo-config`), corrección del bug de RLS al mover citas.
- Vínculo entre ficha de asesor y cuenta de acceso (`agenda_asesores.usuario_id`, único por
  usuario), con la misma opción invitar-por-correo-vs-contraseña-directa tanto en la ficha
  del asesor como en el formulario genérico "Crear acceso nuevo" de Administración
  (`sql/004-vinculo-asesor-usuario.sql`).
- Bitácora de administrador (pestaña nueva "Bitácora", solo administrador/coordinador):
  dos sub-vistas, "Actividad de citas" (quién creó/canceló/movió/cambió cada cita, con
  filtros de fecha/asesor/acción/texto y paginación) y "Encuestas de clientes" (todas las
  respuestas de encuesta con calificación/impresión/intención/motivo, filtros de
  fecha/asesor/calificación mínima/texto). Se apoya en una columna nueva
  `agenda_citas.actualizado_por` (estampada automáticamente por un trigger `BEFORE UPDATE`)
  que completa el "quién" en acciones que el trigger de historial existente
  (`agenda_citas_historial_trigger`, ya documentado, captura automáticamente creada/
  cancelada/movida/cambio_estado/editada) no podía atribuir antes (mover, editar).
- Encuesta de satisfacción al cliente llevada al nivel del sistema viejo (Apps Script +
  Calendar que reemplazó): además de la calificación de 1-5 a la atención del asesor, ahora
  pregunta impresión del inmueble (con emojis), intención comercial, y motivo si no
  convenció. El correo de la encuesta (`enviar-encuesta-cliente`, Edge Function) incluye
  4 botones de preselección de impresión que preseleccionan esa respuesta al abrir el
  formulario. El informe del propietario (`propietario.js`) y el formulario de la encuesta
  (`opinion.js`) muestran estos campos nuevos; `sql/005-bitacora-encuestas.sql` documenta la
  migración completa (ya aplicada).

- Correos adicionales por asesor (`agenda_asesores.correos_adicionales`, texto separado por
  `;`, no afecta el login) y calendario compartido por enlace de suscripción `.ics`
  (Edge Function `calendario-ics`, `verify_jwt` apagado; el token secreto de la URL es la
  credencial, `calendario_token` por asesor y por empresa, regenerable). Pestaña
  Administración → Calendario. Funciona con Google, Outlook y Apple sin APIs ni costo
  (`sql/006-asesores-correos-adicionales.sql`, ya aplicado).
- Administración → Importar citas: sube un `.ics` de Google/Outlook, vista previa, detecta
  inmueble por `#NN`/`Inmueble NN`, inserta directo en `agenda_citas` (evita duplicados con
  `evento_calendar_id = 'ics:<uid>'`, no envía correos). Sin inmueble solo entra como
  Captación (restricción de la tabla).
- Inmuebles "Rentando" (estado CRM, arrendatario viviendo adentro): el horario especial
  (días u horas) es obligatorio — sin él `agenda_sugerir_horarios` no ofrece nada — y las
  visitas de cliente tienen el botón "Informar al arrendatario" (Edge Function
  `avisar-arrendatario`, exige sesión de miembro, correo SMTP, bitácora con destinatario
  `arrendatario`, marca `agenda_citas.arrendatario_avisado_en`). El contacto sale de la tabla
  `agenda_arrendatarios`, que llena la macro `sincronizarArrendatarios()` de
  `sincronizacion/sincronizar-inmuebles.gs` desde la hoja InformeGeneralInmueblesArrendados
  (`sql/007-inmuebles-rentando.sql`, ya aplicado).
- Acuerdo de horario en inmuebles arrendados (DESPLEGADO el 22-oct-2026: SQL 010 aplicado, funciones `portal-visita`,
  `avisar-arrendatario` y `enviar-correo-cita` desplegadas, push hecho): el correo "Visita programada en tu vivienda" (`avisar-arrendatario`) lleva el botón a
  `citas.patrimonios.co/arrendatario/<token>`; el cliente recibe `/visita/<token>` (misma página,
  `aplicacion/arrendatario.html` + `js/arrendatario.js`, el servidor dice el `rol`). El arrendatario PROPONE otra hora
  (no mueve la cita); el cliente acepta, rechaza (queda la hora original) o contrapropone; cuando la OTRA parte acepta, la
  cita pasa a la nueva hora (en firme) y se mandan los correos de siempre (`enviar-correo-cita` al cliente,
  `enviar-correo-propietario`, y confirmación al arrendatario). NO se avisa al asesor: la agenda se coordina sola. Reglas:
  una propuesta pendiente por cita, vence a las 48 h o si la cita cambia por otra vía, se revalida el horario al aceptar con
  el mismo motor (`agenda_sugerir_horarios` + `agenda_slot_disponible`), máx. 6 propuestas por cita. El arrendatario también
  cancela (avisa al cliente) y edita los días/horas en que se muestra su vivienda (`agenda_inmuebles.dias_visita_permitidos/
  hora_visita_desde/hasta`, 6:00-21:00; las visitas ya agendadas que queden fuera se respetan). El correo de confirmación al
  cliente (`enviar-correo-cita`) avisa que un inmueble rentando está ocupado y que el arrendatario podría proponer otra hora.
  Edge Function `portal-visita` (`verify_jwt` APAGADO: tokens `agenda_citas.token_arrendatario` / `token_cliente` son la
  credencial; cada parte solo ve lo suyo). Tablas `agenda_cita_propuestas` y `agenda_arrendatario_acciones` (auditoría, sin
  pantalla aún). `sql/010-portal-arrendatario.sql`. - Pendientes (pestaña nueva, todos los roles) y Portales (sub-pestaña, admin/coordinador): tabla
  PROBADO de punta a punta el 22-oct-2026 con correo en modo pruebas (proponer, aceptar, contrapropuesta, rechazo, cancelar,
  guardar horario, validaciones, y la página real en producción). Datos de prueba que quedaron en producción (NO borrar sin
  preguntar): inmueble Nº 999901 «PRUEBA» (marcado no disponible), su fila en `agenda_arrendatarios` y una cita cancelada de
  «Cliente de Prueba». NO probado: el botón «Informar al arrendatario» de la agenda (exige sesión) ni el correo real con el
  enlace; `agenda_arrendatarios` sigue vacía hasta pegar la macro `sincronizarArrendatarios`.
  `agenda_pendientes` (tareas con responsable, fecha límite, cierre manual o automático) y
  `agenda_portales_cargas`. Se suben los Excel de Fincaraíz, Metrocuadrado y Ciencuadras
  (`portales-logica.js` los reconoce y compara por CÓDIGO DE PORTAL contra las columnas de portal de
  Sedi → `agenda_inmuebles.codigo_*`): publicar, despublicar, publicado sin código en Sedi, precio
  distinto. Estados publicables: Disponible y Rentando. Visibilidad por jerarquía en la base de datos
  (asesor lo suyo, coordinador hasta nivel asesor, administrador todo); el navegador solo lee y
  escribe por RPC (`agenda_portales_guardar`, `agenda_pendiente_actualizar`). `sql/008` y `sql/009`, ya
  aplicados. Regla: los pendientes de portales NO se cierran a mano, los marca resueltos el sistema
  cuando el siguiente Excel ya no muestra el problema; solo admin/coordinador pueden descartar (con
  motivo). Responsable = asesor de comercialización de Sedi (si está vacío, el de captación). La
  pantalla agrupa por inmueble (el mismo problema en varios portales sale en una tarjeta).
  Convención: lo que se sube en Portales se guarda al instante (sin botón) y el resumen de la última
  carga se recuerda en el navegador (`localStorage`, clave `pendientes_portales_<empresa>`), para que
  no desaparezca al cambiar de pestaña, recargar o volver a entrar. Cualquier pantalla nueva donde se
  suba o se arme algo que el usuario no quiera perder debe seguir este patrón (estado en BD, o al
  menos recordado en el navegador), no solo en variables del módulo.
  La macro de Sedi desplegada en Apps Script TIENE que ser la de `sincronizacion/` (lee las columnas
  de portal y la propiedad `NOMBRE_HOJA` = Inmuebles); la versión vieja no traía los códigos.
- Vigilante de correos (`sincronizacion/vigilante-correos.gs` + `LEEME-vigilante-correos.md`, proyecto de
  Apps Script "Vigilante de correos", YA DESPLEGADO el 21-oct-2026 en la cuenta de Felipe; cuenta de servicio
  `vigilante-correos@spartan-context-131023.iam.gserviceaccount.com` con delegación de dominio `gmail.readonly`):
  lee solo-lectura solicitudes@/info@/soporte@/publicidad@/asesorbqa@/asesor1@ (rechaza buzones de administradores),
  SOLO los últimos 3 meses, y anota en la hoja "Vigilante de correos — Patrimonios" (id
  `1-g1_qVrm4vm1PaHlux-SlEZJ-ZiP78_d0sA7yLqY0IM`): pestaña Correos (terminaciones, entregas, asambleas, captaciones),
  Hilos (estado vigente de cada conversación leyendo TODO el historial: prórroga, cambio de fecha, cancelación,
  entregado), Cobertura y Busqueda. Gmail filtra en el servidor (sin portales ni citas); Gemini solo con topes
  (12/corrida, 150/día, modelo más barato detectado solo, pausa si 429; la clave se comparte con el ruteador de info@).
  Para actualizar el código en Apps Script: copiar el archivo al portapapeles y pegarlo en el editor (Monaco) y
  verificar con SHA-256; no pegar secretos en el repo. Después se conectará a `agenda_pendientes` (origen `correo`).
  23-oct-2026: resumen diario rehecho (Felipe lo calificó inútil: repetía conversaciones y los enlaces a Gmail de buzones
  delegados no abrían). Ahora sale de la pestaña Hilos, UNA entrada por caso (mismo COD o asunto), en 3 secciones sin
  solaparse: SIN RESPUESTA NUESTRA (cliente escribió hace >24 h y nadie contestó), NOVEDADES 24 h y CAMBIOS DE ESTADO
  (prórroga/cancelación/entregado). Enlaces a la fila de la hoja. Hilos ganó columnas `ULTIMO MENSAJE DE` y
  `CAMBIO DE ESTADO EL` (las filas viejas se llenan al reanalizarse). Sin novedades no manda correo. Desplegado en
  Apps Script el 23-oct (no probado aún con datos reales; revisar el correo de las 7 a. m.).
- Respaldo semanal de Supabase a Google Drive: `sincronizacion/respaldo-drive.gs` (mismo proyecto
  de Apps Script que la sincronización de inmuebles; propiedades `RESPALDO_CARPETA_ID` y opcional
  `RESPALDO_CONSERVAR`; no borra nada por defecto; no incluye las cuentas de Supabase Auth).
- Hosting Netlify (plan gratis, créditos): cada push a `main` = 1 despliegue de producción = 15 de
  300 créditos/mes (~20 al mes; las vistas previas de ramas no gastan). Juntar cambios en pocos
  pushes y usar `[skip netlify]` en el mensaje del commit si solo cambian docs/.gs/.sql.
- Usuarios que no son asesores (gerente, directivo, administrador que solo supervisa): se crean en
  Administración → Accesos con rol Administrador/Coordinador, SIN ficha de asesor (la ficha de
  Equipo es solo para quien muestra inmuebles y entra al motor de horarios). Las pantallas de
  Equipo y Accesos lo explican.
- Ficha de asesor <-> acceso: "es asesor" = tener una ficha de Equipo vinculada (`agenda_asesores.usuario_id`)
  a su acceso. `gestion-accesos` vincula solo, al crear un acceso, la ficha sin acceso que tenga el
  mismo correo; acción `vincular_asesor` para accesos/fichas que ya existían. Accesos muestra
  "✓ Es asesor" o el botón "Activar también como asesor" (vale para administrador y coordinador);
  Equipo muestra "Vincular con ese acceso" cuando hay un acceso con el mismo correo sin vincular.
- Rediseño y marca por empresa (23-oct-2026; TODO APLICADO, DESPLEGADO Y PUBLICADO: SQL 011-014, las 11 funciones de correo y el front end): tipografía Bricolage Grotesque (títulos) + Hanken
  Grotesk (texto) en lugar de Poppins; distribución nueva de la agenda (final de `estilos/agenda.css`): menú lateral de color de
  marca en escritorio, barra inferior fija en celular (<=860px), citas como línea de tiempo y cifras del día sin caja; mismo lenguaje en Inmuebles/Equipo (fichas con esquina recta y filo de color), Configuración (pestañas subrayadas), acceso en dos paneles (marca | formulario, vía `:has()` en acceso.css) y páginas públicas (franja delgada, tarjetas con filo de acento); todos los CSS leen la marca de variables (`--empresa-principal/-accion/-texto*`,
  `--tema-fondo/-tinte/-claro`) que aplica `aplicacion/js/paletas.js`. Administración → Configuración tiene 7 paletas
  (clic llena color principal + de botones, vista previa al instante; no necesita columnas nuevas, la paleta se reconoce por
  los dos colores). Convención: ningún color de marca va fijo en CSS/HTML de correos; usar las variables / `marcaCorreo()`.
  Correos: `supabase/functions/_shared/marca-correo.ts` (imagen, colores) usado por enviar-correo-cita, -propietario, -informe,
  avisar-arrendatario, enviar-encuesta-cliente, gestion-accesos y recuperar-contrasena. `sql/011-marca-correos.sql` agrega
  `agenda_configuracion.imagen_correo_url` (campo nuevo en Configuración). (Ya hecho; orden de referencia: SQL 011 primero y luego
  desplegar TODAS las funciones de correo (las 11 que usan `_shared/marca-correo.ts`, incluidas portal-visita,
  marcar-inmueble-no-disponible, enviar-solicitud-propietario y probar-correo-config; sus SELECT piden la columna; el `_shared/` se empaqueta pasando el archivo como `../_shared/marca-correo.ts` en el deploy). No se probó un envío real con el diseño nuevo. Las páginas
  públicas (reservar, opinión, propietario, arrendatario) cargan logo grande + paleta de la empresa con `js/marca-publica.js`, que llama a la RPC pública
  `agenda_marca_publica(p_empresa_slug, p_host)` (`sql/012-marca-publica.sql`, SOLO LECTURA: nombre, logo y colores). SQL 012 YA APLICADO. El logo (`logo_url`, ahora `https://citas.patrimonios.co/logo-patrimonios.png`, recortado sin márgenes, vive en
  `aplicacion/public/`; el original anterior era `https://adminpaxzu.patrimonios.co/uploads/images/LogoGoProR.png`, 1920x1080 con la marca diminuta) se ve grande, sobre
  placa blanca, en la barra del panel, el menú lateral y las páginas públicas. Configuración usa riel lateral de secciones en escritorio. Para ver el panel de administrador sin sesión se
  puede montar en el navegador de desarrollo con `iniciarAdministracion({membresia:{rol:'administrador',empresa:{...}}})`.
- 23-oct-2026 (tarde), YA PUBLICADO: (1) Rentando ofrece por defecto TODO el horario de la empresa (`sql/013`, YA aplicado en Supabase: se quitó el
  bloque "sin horario especial => nada" de `agenda_sugerir_horarios`; el horario especial sigue siendo opcional y se respeta si existe). (2) Alerta de ubicación
  dudosa (`sql/014`, funciones `agenda_ubicaciones_dudosas` / `_calc` / `agenda_ols_plano`, versión final YA APLICADA: sin diagonales, umbral 3,5 km en Bogotá y 20 km en otras ciudades, exige >=4 calles y carreras distintas; hoy marca 71, 73, 350, 399, 448, 391 y, por distancia a la ciudad, 420): ajusta por ciudad un plano
  latitud/longitud = f(calle, carrera) con los inmuebles ya cargados y marca los que quedan lejos de donde su dirección dice; sale en Inmuebles (aviso ámbar) y en
  Administración → Ciudades → Calidad de geolocalización. (3) Pendientes ya no pisa la pestaña actual: `render()` pinta cada vista en un contenedor nuevo. (4) Al agendar
  una visita en un inmueble Rentando, `enviar-correo-cita` llama a `avisar-arrendatario` (llamada interna con service role, sin sesión) para avisar al arrendatario solo;
  en modo de pruebas, si no hay correo de arrendatario se manda igual al correo de pruebas. El portal de acuerdo de horario manda `sin_aviso_arrendatario` para no
  duplicar. (5) Correos al propietario y al arrendatario llevan botón "Ver el inmueble en nuestro sitio" (`plantilla_enlace_inmueble`). (6) `correo_pruebas_destino` =
  pf.castelli@patrimonios.co (modo de pruebas sigue activo). PROBADO EN PRODUCCIÓN el 23-oct con correo en modo pruebas (llegan a pf.castelli@patrimonios.co): reserva pública en el inmueble 127 (Rentando sin horario: ofrece
  8:00-4:00 p. m.), correos al cliente/propietario/arrendatario, propuesta de otra hora, aceptación, correos de "cambió de hora" (parámetro `reagendada`,
  SEQUENCE del .ics sube) y cancelación por el arrendatario, y el formulario "Pedir una asesoría" del informe del propietario. Citas de prueba que quedaron
  CANCELADAS (no borradas): «Prueba Claude (Rentando 127)» y «Prueba Claude 2 (Rentando 127)». NO probado: la agenda interna (exige sesión) ni la encuesta.
  Netlify: si el sitio no se actualiza tras un push, revisar créditos (se agotaron el 23-oct; Felipe los renovó).
- 23-oct-2026, revisión con 5 expertos (diseño/textos, marketing, jurídico, personas reales, ingeniería) y correcciones ya hechas en el repo: contraste de textos en correos, `lang="es"` + viewport en todas las plantillas,
  botones de Waze/Maps/WhatsApp con mejor contraste, textos más cálidos al arrendatario, mensajes de error unificados y botones táctiles de 44-48 px en las páginas públicas, aviso al arrendatario sin
  duplicados (<2 min) y con tiempo límite. PENDIENTE DE DECIDIR (no implementado): aviso de privacidad con casilla obligatoria en Reservar (Ley 1581),
  aviso al asesor cuando el arrendatario propone/acepta/cancela, recordatorio por correo 24 h antes, banner visible de "modo de pruebas", comentario obligatorio al marcar realizada, y CTAs de captación
  de otro inmueble en correos informativos (nunca en acceso/recuperar contraseña/cancelaciones).
- Banner fijo "Modo de pruebas" en la agenda interna (`aplicarAvisoModoPruebas` en agenda-real.js, lee `correo_modo_pruebas`/`correo_pruebas_destino`; se ve mientras el modo siga activo). Publicado el 23-oct; NO verificado con sesión.
- 23-oct-2026 (noche), PROBADO con sesión de Felipe en producción (Chrome): menú (arreglado: desde Pendientes el menú lateral no respondía, el manejador de clics salía antes), Inmuebles (aviso ámbar de ubicación: solo el 399 está disponible entre los marcados; el 71 ya no sale, parece corregido en Sedi), Equipo, Informes, Bitácora, Pendientes, y en la agenda: crear cita (inmueble 127, correos de cliente/propietario/arrendatario llegan en <5 s al correo de pruebas), Mover (guarda), panel Realizada (abre; no se guardó), Cancelar. Citas de prueba: «Prueba Claude 3 (agenda interna)» quedó CANCELADA (no borrada). HALLAZGOS: (1) el botón «Reenviar/Informar al arrendatario» falla con 403 «No perteneces a esta empresa» porque `avisar-arrendatario` pedía la columna `agenda_miembros.id` (no existe); arreglado (`select('usuario_id')`) y DESPLEGADO el 23-oct (versión 6); verificado que ya no da 403 (responde 200 sobre una cita cancelada); el envío real con el botón sobre una cita activa NO se volvió a probar; (2) [RESUELTO la misma noche, ver siguiente viñeta] Mover/Cancelar no mandaban correo; (3) [RESUELTO] el aviso en pantalla ahora se borra solo a los 9 s. Ajustes de estilo hechos: logo y nombre apilados en el menú lateral, botones de los paneles de confirmación con forma de botón, icono alineado.
- 24-oct-2026 (madrugada, UTC), DESPLEGADO Y PROBADO en producción con citas de prueba: (1) Mover y Cancelar desde la agenda interna avisan por correo
  (Edge Function nueva `notificar-cambio-cita`, `verify_jwt` activo: la llama un miembro con sesión o la service role): cliente y propietario
  siempre, arrendatario solo si el inmueble está Rentando; la cancelación manda además un `.ics` METHOD:CANCEL (SEQUENCE = hora actual, para que
  gane a cualquier invitación anterior) y evita duplicados (no repite si ya salió un «Visita cancelada…» en 5 min); la agenda muestra «Se avisó por
  correo al cliente, al propietario y al arrendatario». (2) El correo de confirmación al cliente (`enviar-correo-cita`) trae el botón «Cambiar o cancelar
  mi visita» → `/visita/<token_cliente>` (misma página `arrendatario.js`, `portal-visita`): el cliente CANCELA siempre y CAMBIA la hora al instante
  (acción nueva `reagendar`) si el inmueble NO está Rentando; si está Rentando el cambio sigue siendo acuerdo con el arrendatario (proponer/responder).
  Ambas rutas del cliente avisan vía `notificar-cambio-cita` (origen `cliente`). (3) Los textos dicen vivienda/oficina/local/consultorio/bodega/lote/inmueble
  según `agenda_inmuebles.tipo_inmueble` (helper `sustantivo()` copiado en `avisar-arrendatario`, `portal-visita`, `notificar-cambio-cita` y en
  `arrendatario.js`; «habitado» pasó a «ocupado»). (4) `avisar-arrendatario` ya no da 403 a administradores (pedía la columna inexistente `agenda_miembros.id`;
  ahora `usuario_id`): el botón «Reenviar aviso al arrendatario» se probó y funciona. Funciones desplegadas: notificar-cambio-cita v2, portal-visita v5,
  enviar-correo-cita v11, avisar-arrendatario v7. También probado: encuesta del cliente (`/opinion/<token>`) y el informe del propietario
  (`/propietario/<token_informe_propietario>`): el informe SÍ muestra la opinión del cliente (calificación, impresión, siguiente paso, texto) y la «Nota del
  asesor» (comentario escrito al marcar «Realizada»). Citas de prueba que quedaron (NO borradas): «Prueba Claude 3/4/6» CANCELADAS y «Prueba Claude 5
  (127, comentarios)» REALIZADA, con su encuesta y su nota: aparecen en el informe REAL del propietario del inmueble 127 (pedirle permiso a Felipe antes de quitarlas).
  Hallazgos sin resolver: el correo de la encuesta no lleva el encabezado de marca ni los 4 botones de preselección que describe este archivo (solo un botón);
  `marcar-inmueble-no-disponible` manda su cancelación con SEQUENCE 1 (si la cita se reagendó antes, el calendario del cliente puede ignorarla; usar la hora actual como en `notificar-cambio-cita`);
  nodemailer adjunta además un `invite.ics` duplicado junto a `cancelacion.ics`.
- 24-oct-2026 (sesión 3), COMMITEADO, sin push ni probar con sesión: (1) enlace «Ver informe» (abre `/propietario/<token_informe_propietario>`, lo mismo que ve el propietario) en cada inmueble de
  Inmuebles y en las tablas de Informes, solo admin/coordinador. (2) Informes → panel «Enviar informes a los propietarios» (envío masivo): alcance (requieren atención / con visitas / todos los
  disponibles), tope opcional, confirmación, avance y botón Detener; llama de a 2 a la Edge Function ya existente `enviar-informe-propietario`; omite inmuebles sin correo de propietario
  (`agenda_propietarios`); en modo de pruebas todo va a `correo_pruebas_destino`. (3) CSS para celular (<=860px, final de `agenda.css`): las tarjetas de Inmuebles se apilan, el texto
  largo se parte en líneas y nada se sale de la pantalla (antes se cortaban a la derecha en iPhone).
- Calidad de geolocalización: ahora solo lista inmuebles disponibles. Restricción de horario
  por inmueble: botón "Borrar restricciones".

## Pendiente / próximos pasos conocidos
000000. Vigilante de correos: disparadores YA instalados el 21-oct-2026 (corrida cada 15 min, latido cada hora, resumen diario 7 a. m.);
   recomendado crear una clave de Gemini PROPIA (otro proyecto) para no compartir cuota
   con el ruteador; cruzar la pestaña Hilos con el Cuadro de Entregas y Gestión de terminaciones de Sedi (las 6
   terminaciones seguras de abajo se crean en Sedi después de revisar los correos).
00000. Terminaciones en Sedi (Inmobiliaria -> Terminaciones -> Gestion de terminaciones). REGLA de Felipe: una entrega
   es SEGURA solo si la fecha coincide (o esta a ~5 dias) con el vencimiento del contrato y el aviso se dio a tiempo
   (contrato y Ley 820 de 2003, 3 meses); si no coincide es un ACUERDO (entrega cuando haya nuevo arrendatario) y no se
   carga como entrega segura. Al cargar un caso en Sedi se adjunta SIEMPRE la carta/correo del arrendatario (esta en
   Drive, carpeta de contratos por ciudad y numero de inmueble, subcarpeta "NO RENOVACION" del contrato).
   HECHO el 22-oct-2026: cargados con carta adjunta Imoval XIII (CT-7990), Aquimin (CT-7933), Corales 2 Casa 97
   (CT.B-310), Tribeca 1301 (CT-7947) y Kandinsky 503 (CT-7757) (procesos 8 a 12), y CERRADO Versalles (CT-7983).
   Causa elegida a mano en Aquimin, Corales y Tribeca ("nuevas necesidades"): la carta no la dice; revisar si se quiere otra.
   Cada proceso lleva ademas la carta de aceptacion y 3 seguimientos (carta/correo del arrendatario, aceptacion, carta al
   propietario "pendiente confirmar envio"). Los 5 tienen tambien el correo original (Aquimin e Imoval XIII se
   exportaron de solicitudes@ con `exportarCorreosSedi` / `exportarHilosAPdf(buzon, consulta, prefijo, maximo)` del vigilante,
   que guarda la conversacion en PDF en la carpeta de Drive "Correos para Sedi"; requiere el permiso de Drive, ya autorizado
   el 22-oct-2026). Seguimientos en Sedi: cada uno pide
   confirmar con Aceptar y se guarda al instante; los adjuntos se acumulan y se guardan con Guardar.
   22-oct-2026 (tarde): cargados tambien Montiel 501 (proceso 13, extemporaneo), Molino 704 (14, extemporaneo),
   Mirador 1003 (15, "Envio propuesta 1" = cambio de arrendatario), Torres de la Cien 1204 (16, acuerdo, entrega estimada
   dic-2026) y Gutenberg 410 (17, prorroga autorizada, entrega 30/04/2027), con adjuntos y 3 seguimientos. Como indicar el
   estado de un acuerdo en Sedi: Estado solicitud "Envio propuesta 1" + Observaciones que empiezan por ACUERDO/EXTEMPORANEO;
   causa "Terminacion anticipada de contrato" cuando el aviso llego tarde. Limite de ~400 caracteres por seguimiento; los
   seguimientos NO se pueden borrar (en el proceso 10 quedaron 3 de Montiel por error, con una nota de correccion). La carta
   modelo "RESPUESTA COMUNICACION EXTEMPORANEA" tiene fechas cruzadas en Mirador. Correo a Jessica con el resumen: borrador en
   Gmail de Felipe. Revision hacia atras (enero-julio): sin entregas nuevas >= oct-2026 salvo Verona 170 (entrega 30/11/2026
   por prorroga de 7 meses pedida en feb) y por verificar Oasis 827 (CT.B-289) y Apolo 202 (CT-7901). Funciones nuevas del
   vigilante: exportarCasosATexto, exportarAdjuntosCasos, exportarNoRenovaciones, exportarMirador (pestanas Casos/NoRenov).
   PENDIENTES por decidir (no seguras / sin confirmar): Gutenberg 410 (CT-7636, prorroga a 30/04/2027), Verona 170
   (CT-7702), El Parque 182 (CT.B-316, siniestro/restitucion legal), Isabella 703 (420, sin contrato en arrendados),
   Baleares 7 (CT-227, vence 31/10/2026, no renueva condicionado a reparaciones), Montiel 501 (CT-7858), Molino 704
   (CT-7992), Pontevedra IV 601 (CT-7803, aviso 22/10 para 31/01/2027), Mirador de San Luis 1003 (CT-7709, pide 30/10
   pero vence 31/05/2027), Torres de la Cien 1204 (CT-7911), Trento 1203 (CT-7835), Oficina 311 Colina Office Park
   (CT-7874), Florencia T7 205 e Ikebana locales 10/11 (no figuran en arrendados). Falta verificar con los enviados de
   solicitudes@ que se aviso a propietario y arrendatario en cada caso.
   Errores del Cuadro de Entregas: Prado Park es AP 630 (no 603); Via al Cedro VI AP 415 es el inmueble 489 con
   contrato a 30/09/2027; Corales = COD 589; faltan en el Cuadro Baleares, Montiel, Molino, Pontevedra, Mirador, Torres
   de la Cien, Trento, Oficina 311. Tecnica para adjuntar en Sedi: el formulario vive en un iframe del mismo origen;
   se sirve el PDF desde un servidor local temporal (CORS abierto) y se asigna al input file por JavaScript.
0000. Correos de acceso (invitación y "Olvidé mi contraseña"): NO salen por el correo integrado de
   Supabase (solo entrega a miembros del equipo de Supabase y ~2 por hora). Los envían las Edge
   Functions `gestion-accesos` (invitación/reenvío) y `recuperar-contrasena` (pública, respuesta
   siempre igual, máx. 5 por hora por persona) con `admin.auth.admin.generateLink` + el SMTP de la
   empresa (Vault), respetando `correo_modo_pruebas` y registrando en `agenda_correos_log` (tipo
   `interno`, `detalle_error='acceso:<usuario>'`). Probar con un alias propio. Revisar en Supabase
   Authentication > URL Configuration que Site URL = https://citas.patrimonios.co. Bot de WhatsApp
   (Apps Script): interruptor Calendar/sistema nuevo + API para el bot, en otro proyecto. Activar el
   respaldo a Drive (unidad compartida privada).
000. Pendientes: probar en vivo la pestaña Pendientes → Portales con los 3 Excel; vincular las cuentas
   de los asesores (hoy todos los pendientes salen "sin asignar" porque `agenda_asesores.usuario_id`
   está vacío); siguiente fase: que el ruteador de info@ (Apps Script, Gemini) escriba pendientes de
   asambleas/terminaciones/entregas (origen `correo`), aviso por correo y escalamiento al coordinador/
   administrador al vencer, y verificar respuestas en los enviados de los asesores. Los 21 Disponibles
   sin código de portal se verifican con asesores/propietarios más adelante (no crean pendientes).
00. Pegar `sincronizarArrendatarios` en el proyecto de Apps Script, agregar la propiedad
   `HOJA_ARRENDADOS_ID` (11bwWCu-2H6gtPkRpiNWmqsjjwOmN-MNp3fjB434MouM) y el activador diario;
   hasta entonces `agenda_arrendatarios` está vacía y el botón responde que no hay correo.
0. Probar con red real: suscribir un enlace de Administración → Calendario en Google/Outlook,
   hacer una importación `.ics` pequeña, y el código de verificación de correo (Resend,
   `enviar-codigo-verificacion`, ninguna verificación completada aún; `correo_modo_pruebas`
   sigue en true, apagarlo antes de salir a producción). Los correos adicionales del asesor
   todavía solo se guardan: falta usarlos en los avisos. La función
   `enviar-codigo-verificacion` solo existe en Supabase, no en el repo.
1. **Revisar el estado de git antes de nada.** Verificar con `git log --oneline -5` y
   `git status` que `origin/main` tenga el último commit — puede que falte un `git push`
   después de un commit hecho en una sesión anterior.
2. El correo al propietario sigue pendiente de conectar la Hoja Propietarios de Sheets a
   Supabase (hoy `agenda_inmuebles` no tiene ningún dato de contacto del propietario).
3. Probar de punta a punta con red real (algo que un entorno sin acceso directo al
   computador de Felipe no puede hacer): que el correo de confirmación de cita llegue de
   verdad, que el correo de invitación de accesos llegue de verdad, y que los 4 botones de
   preselección de impresión en el correo de encuesta funcionen clickeados desde un correo
   real.
4. `npm run build` local puede fallar con `EPERM` al intentar limpiar `dist/` si el entorno
   desde el que se corre no tiene permiso de borrar archivos en esta carpeta (pasó en
   Cowork). No es un problema del código — `dist/` está en `.gitignore` y Netlify la
   reconstruye sola en cada deploy. Si hace falta compilar localmente y falla así, borrar
   `dist/` a mano primero o correr con permisos de escritura normales (esto no debería pasar
   corriendo Claude Code directamente en Windows).

## Cómo trabajar con Felipe
Felipe es el CFO y único desarrollador de Patrimonios — no es programador de formación.
Explicar en español, pasos concretos, sin asumir jerga. Confirmar antes de tocar la base de
datos remota de producción (no hay entorno de pruebas separado todavía). No inventar que
algo se probó de punta a punta si no se probó con red real. Felipe le tiene temor a borrar
archivos — nunca borrar nada sin pedir permiso explícito primero, y si lo niega o no
responde, no insistir ni buscar atajos (mover a una carpeta, etc.) sin que él lo pida.
