# Estado actual (único resumen vigente)

Actualizado: 26-oct-2026. Reemplazar lo superado; no acumular bitácora.

## Carpeta, rama y colaboración
`C:\Users\felca\Documents\agenda-inmobiliaria`, rama `main`, remoto `origin` (github.com/pfcastelli-cpu/agenda-inmobiliaria).
Una sola herramienta edita a la vez. Codex implementó el contacto por empresa; Claude lo revisó y lo commiteó (ver commit más reciente en `git log`).

## Objetivo y resultado
Contacto y datos legales configurables por empresa (varias sedes, varios teléfonos/extensiones, correo, web, razón social, NIT,
dirección, política de datos, correo de baja), para que los correos de cualquier inmobiliaria lleven SUS números y no los de Patrimonios.
- Editor: `aplicacion/js/contacto-empresa.js`, en Administración > Empresa. Backend: `supabase/functions/_shared/contacto-correo.ts`
  integrado en `marca-correo.ts` y en las 12 funciones de correo (que ahora piden `contacto_empresa` y `empresa:agenda_empresas(slug)`).
- Columna nueva JSONB `agenda_configuracion.contacto_empresa`. Contrato y detalles: `docs/CONTACTO-EMPRESA.md`.
- Captación solo con datos legales completos; fotos con logo de Patrimonios solo para el slug exacto `patrimonios`.

## Migraciones y despliegues (remoto vs. local)
- SQL 001–016: APLICADAS en Supabase (016 el 26-oct). La 016 del commit bfbb3d0 tenía un error de sintaxis plpgsql (un `CASE ... THEN`
  dentro de un `IF`); se corrigió en `sql/016-contacto-empresa.sql` (variable `m`) y esa versión corregida es la que se aplicó. **La corrección está
  solo local, sin commitear.** Verificado en producción: una empresa (`patrimonios`) con 3 sedes, NIT, `correo_contacto = info@patrimonios.co`,
  constraint presente, validador rechaza teléfonos inválidos y http, modo de pruebas sigue en `true`.
- Edge Functions: las 12 con contacto por empresa DESPLEGADAS el 26-oct (CLI `--use-api`). Contactos que usan: `agenda_configuracion.contacto_empresa`.
- Front end (editor Administración > Empresa): publicado con el push del 26-oct sin `[skip netlify]` (verificar en citas.patrimonios.co que el despliegue de Netlify terminó).
- Respaldo previo a 016: `respaldos/agenda_configuracion-antes-016-2026-10-26.json` (carpeta fuera de git).

## Pruebas
- Ejecutadas: 12/12 en `tests/contacto-empresa.test.mjs` (no ejecutan SQL; por eso no detectaron el error de 016). Correos reales en modo de pruebas a
  pf.castelli@patrimonios.co tras el despliegue: confirmación al cliente (2 citas), aviso al propietario y encuesta; los cuatro traen las tres sedes
  con teléfonos fijos clicables, info@ y la web.
- Encuesta: correo con 4 botones de impresión desplegado y enviado (clic real sin probar); `marcar-inmueble-no-disponible` con SEQUENCE por hora actual desplegado.
- Sin ver: arrendatario (la cita de prueba es de un Rentando ya cancelado; no llegó aviso), recuperar contraseña, accesos, cambio/cancelación,
  informe del propietario, portal y probar-correo (exigen sesión o cambian estado). Pendientes: Outlook y celular físicos; guardado desde el editor con sesión y RLS.

## Trabajo en curso: franjas del arrendatario y un solo aviso por inmueble (SIN commit, SQL 017 SIN aplicar)
Objetivo: que un arrendatario con varias visitas no negocie una por una. Diseño: `sql/017-ventanas-arrendatario.sql` (tabla `agenda_inmueble_ventanas`,
`agenda_inmuebles.token_arrendatario`, `agenda_citas.reubicacion_pendiente_desde`, y versiones nuevas de `agenda_slot_disponible` y
`agenda_sugerir_horarios` que respetan las franjas). El arrendatario declara, para un día, hasta 3 franjas en las que SÍ puede («disponible») o NO puede
(«bloqueo»); lo que se ofrece a los clientes ya queda dentro de ellas. Las visitas que quedan fuera se marcan «por reubicar»: el cliente recibe un correo y elige
SU nuevo turno al instante (turnos cada `separacion_mismo_inmueble_minutos`), sin pedir otra aceptación; el asesor recibe un correo y ve la marca en la agenda.
- Código hecho (solo local): `portal-visita` (enlace por inmueble, acciones `ventanas_guardar/borrar`, `reagendar` directo si hay reubicación, tope de propuestas 6→3 con aviso
  al asesor, aviso al asesor si el arrendatario cancela), `avisar-arrendatario` (un solo aviso con la lista de todas las visitas próximas y el enlace del inmueble; mismo asunto),
  `notificar-cambio-cita` (parámetro `sin_aviso_arrendatario`), `aplicacion/js/arrendatario.js` (vista del inmueble y del cliente con reubicación), `agenda-real.js` (marca «Reubicación pendiente»).
  También sin commit: aviso flotante de guardado en Administración (`administracion.js/.css`, arregla que «Guardar» no mostrara nada).
- NO hecho / NO probado: aplicar SQL 017 (el sistema bloqueó aplicarlo; hay respaldo de las dos funciones en `respaldos/funciones-horarios-antes-017-2026-10-26.json`), desplegar
  `portal-visita`, `avisar-arrendatario`, `notificar-cambio-cita`, publicar el front end, probar con citas de prueba en el inmueble 127 (Rentando). Falta también: escalar al asesor cuando
  vence una reubicación sin respuesta (requiere una tarea programada, p. ej. `pg_cron`; ver `docs/MEJORAS-EN-PRODUCCION.md`); franjas ofrecidas por el cliente; resumen diario.
- Orden al retomar: (1) autorización de Felipe para aplicar 017; (2) aplicar 017 y probar con `begin; …; rollback;` que `agenda_sugerir_horarios` ofrece turnos solo dentro de las franjas;
  (3) desplegar las 3 funciones (`portal-visita` con `--no-verify-jwt`; `avisar-arrendatario` y `notificar-cambio-cita` con JWT);
  (4) push sin `[skip netlify]`; (5) probar de punta a punta en modo de pruebas; (6) commit.

## Trabajo en curso: encuesta automática y más corta (SIN commit, SQL 018 SIN aplicar)
- Correo de la encuesta (`enviar-encuesta-cliente`): asunto y título «¿Cómo te pareció el inmueble?», sin botón general; solo 4 botones (😍 🙂 😐 🙁) que abren
  `/opinion/<token>?impresion=…` con esa respuesta marcada. No repite si la visita ya recibió su encuesta (`forzar: true` para reenviar).
- Formulario (`opinion.js`): el motivo («por qué no te convenció») solo se pregunta si la impresión fue «No me gustó» o «No estoy seguro»; si gustó se guarda `no_aplica`.
- Envío automático: `sql/018-encuesta-automatica.sql` (`encuesta_automatica`, `encuesta_minutos_despues` = 30 por defecto, `pg_cron` cada 10 min) +
  Edge Function nueva `enviar-encuestas-pendientes` (hora de fin + N min; solo visitas de hoy y ayer; máx. 25 por corrida; 3 fallos y se rinde). Campos nuevos en
  Administración > Empresa («Encuesta al cliente»). Hasta aplicar 018 la agenda sigue mandando la encuesta al marcar «Realizada» (la agenda detecta si la columna existe).
- Avisos al responder (Edge Function nueva `avisar-encuesta-respondida`, pública): la página de la encuesta la llama al guardar. (1) El ASESOR recibe un correo de inmediato si el cliente
  quiere avanzar, una segunda visita o que lo contacten (con contacto del cliente). (2) La administración recibe, según Configuración (`encuesta_aviso_admin`): `cada` (por DEFECTO, como
  pidió Felipe), `semanal` (resumen los lunes 7 a. m., vía cron) o `ninguna`; destinatarios opcionales en `encuesta_aviso_correos`, vacío = administradores activos. Cada aviso sale una sola vez
  (marcas `aviso_admin_en`/`aviso_asesor_en` en `agenda_encuestas_cliente`); el cron `enviar-encuestas-pendientes` hace un barrido de respaldo. Todo en SQL 018.
- Pasos pendientes (detallados en el encabezado de sql/018; desplegar además `avisar-encuesta-respondida` con `--no-verify-jwt`): aplicar 018 → crear el secreto compartido (Vault + `supabase secrets set CRON_ENCUESTAS_SECRETO`) → desplegar
  `enviar-encuestas-pendientes` (`--no-verify-jwt`) y `enviar-encuesta-cliente` → programar el cron → publicar el front end → probar con una visita de prueba.
- Dónde se ven las respuestas: Bitácora → Encuestas de clientes (administrador/coordinador), informe del propietario (`/propietario/<token>`) y Informes.

## Siguiente paso
Lo de arriba. Antes, probar con sesión: guardar en Administración > Empresa (ahora con aviso flotante) y las sedes. Después, pendientes de producto en `docs/historico/CLAUDE-completo-2026-10-26.md`.

## Respaldo y reversión
El historial de git (GitHub) es el respaldo del código y permite volver a cualquier commit. Los datos de Supabase se respaldan con
`sincronizacion/respaldo-drive.gs` (semanal a Drive; ver si está activado). Antes de aplicar SQL 016 conviene un respaldo de `agenda_configuracion`.

## No incluir en commits
`.agents/`, `.claude/`, `skills-lock.json`, la guía PDF, `supabase/.temp/` y los HTML reales de `correos/pruebas-enviadas/`.
