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
- Calidad de geolocalización: ahora solo lista inmuebles disponibles. Restricción de horario
  por inmueble: botón "Borrar restricciones".

## Pendiente / próximos pasos conocidos
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
