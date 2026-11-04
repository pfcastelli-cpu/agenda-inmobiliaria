# Estado actual

Actualizado: 03-nov-2026.

## Prioridad inmediata

- Subir una vez los 3 Excel de portales para crear la foto inicial.
- Probar con sesión real: Administración > Empresa, sedes, botones de encuesta desde correo y marca «Reubicación pendiente».
- Antes de publicar el front pendiente, revisar el diff y obtener autorización de Felipe.

## Rediseño de correos (04-nov-2026, local sin commit ni push)

- Añadida `supabase/functions/_shared/plantilla-correo.ts` con layout común: fondo blanco, tarjeta redondeada, título azul, CTAs grandes de contorno y modo de pruebas preservado.
- `correoVisita` ahora usa la foto temática de visita para clientes, botones tipo píldora y aviso suavizado «Planea tu llegada». `avisar-captacion` usa foto de hogar, copy sin «prioridad total» y botones Google Maps, WhatsApp y llamar cuando existe teléfono.
- Se conservaron tokens, URLs, destinatarios, multiempresa y `correo_modo_pruebas`. El cambio local previo `avisar-captacion`: `ninguna` → `hogar` queda preservado.
- Preview generado por helpers reales: `tests/generar-correos-preview.mjs` genera `tests/fixtures/correos-redisenio-preview.html` con `correoBase`/`correoVisita`, datos sintéticos y enlaces `example.com`. Pruebas: `node --test tests/correos-diseno.test.mjs tests/visita-presentacion.test.mjs` (6 pasan). `npm run build` pasa.
- Se copió la función remota descargada `enviar-codigo-verificacion` al checkout y se integró al layout común. Conserva RPC de hash/TTL y Resend; en modo de pruebas falla cerrado si falta `correo_pruebas_destino`, sin fallback a destinatarios reales. No se hizo deploy, commit ni push.
- 04-nov (local): correo de consignación (`avisar-captacion`) rediseñado: foto `llaves`, pasos «Así seguimos juntos» y botón principal 📎 al script de Apps Script (enlace fijo, sobreescribible con el secreto `CAPTACION_INFO_INMUEBLE_URL`). Nuevos temas de foto en `marca-correo.ts` (llaves, fachada, sala, conjunto): aviso al asesor=fachada, visita al propietario=sala, informe=fachada, resumen=conjunto, solicitud propietario=sala, código verificación=hogar. Fotos nuevas generadas en Figma con logo superpuesto (`foto-acceso/soporte/demanda.jpg` en `aplicacion/public/correo/`; se ven en correos reales solo tras push a Netlify): accesos y contraseña=acceso, tickets y prueba de correo=soporte, demanda=demanda, encuesta respondida=opinión. Archivo Figma «Fotos correos Patrimonios» creado en el equipo de Felipe. 56/56 pruebas; sin deploy, commit ni push.
- Integradas las plantillas restantes, incluida radicación y cancelación por inmueble no disponible. Encuesta aprobada conservada. Botones comunes con emojis Maps/Waze/llamada/WhatsApp y ancho uniforme. Validación final local: 56/56 tests pasan y 25/25 funciones tienen sintaxis válida con esbuild. Vistas visita/consignación revisadas en navegador a 320/375 px; falta envío y revisión Gmail/Outlook del nuevo diseño. Sin deploy, commit ni push.

## Confirmación del arrendatario y roles/permisos (04-nov, commit local, SIN push)

- SQL 048 APLICADO en producción (columnas `arrendatario_confirmado_en/recordado_en`, RPC `agenda_arrendatario_confirmar(token)` para anon, trigger que limpia al mover la visita). Funciones desplegadas: `avisar-arrendatario`, `gestion-accesos`, `recordar-arrendatario` (pública, secreto `x-cron-secreto`); `portal-visita` (botón en el portal): verificar que quedó la versión nueva. Cron `recordar-arrendatario` programado cada hora al minuto 5 (apagar: `select cron.unschedule('recordar-arrendatario');`).
- Botón «Confirmo que estaré» en el correo y en `/arrendatario/`; etiqueta ✅/⏳ en la tarjeta de la agenda (`confirmacion-arrendatario.js`); recordatorio 24 h antes. Sin probar con red real: crear cita `[PRUEBA]` en inmueble Rentando y pulsar el botón.
- SQL 047 APLICADO (roles propios y 32 permisos por categoría; admins actuales = Superadministrador). Front: pestaña «Roles y permisos» (`admin-roles.js`), `permisos.js`, selector de rol en Accesos. Fase A: los permisos solo afinan la pantalla; el rol base sigue mandando en RLS (Fase B: exigirlos en la base). Sin ver en pantalla.
- Agenda: al marcar «Realizada» hay respuestas rápidas de un toque; «Informar al arrendatario» muestra primero que el sistema ya avisó. Subpestañas de Ciudades/Festivos corregidas.

## Captación por ciudad y página pública `/consignar` (03-nov, sin commit ni push)

- SQL 041 APLICADO (horarios de captación por ciudad, todos los asesores mezclados, 7 días; `agenda_sugerir_horarios_captacion_ciudad`). Causa del «no hay horarios»: ninguna cobertura tenía asesores.
- SQL 042 APLICADO en producción (columna `captacion_publica_activa` por defecto apagada; RPC `agenda_captacion_publica_config/horarios/agendar`, ejecutables por `anon`). Probado: validaciones, asignación al asesor de mayor prioridad, horario ya tomado, tope por correo/celular.
- Edge Function `avisar-captacion` DESPLEGADA (pública, sin JWT). Prueba real con cita `[PRUEBA]` (Barranquilla, cancelada después): 2 correos enviados al destino de pruebas, segunda llamada no reenvía. El interruptor quedó APAGADO.
- Front: `consignar.html` + `js/consignar.js` (vista previa simulada `tests/fixtures/consignar-preview.html`: flujo completo OK), `captacion-horarios.js` (formulario interno: ciudad → zona opcional, horarios mezclados, lista de orígenes ampliada), coberturas agrupadas por ciudad en `administracion.js`, interruptor «Habilitar /consignar» en Administración → Empresa, enlace a meet.new cuando Meet no está conectado. `vite build` y 48 pruebas pasan.
- Publicado (aa280d4): captación por ciudad y /consignar (apagada). SIN publicar (local): textos de confianza, 3 pasos, preguntas frecuentes (enlace a patrimonios.co/preguntas-frecuentes/generales), bloque de video con miniatura, arreglo visual del interruptor. Cobro tal como lo confirmó Felipe: solo con promesa de compraventa firmada, o contrato de arrendamiento firmado y inmueble entregado.
- `sql/043-captacion-video.sql` (columna `captacion_video_url` + config pública con `video_url`): SIN APLICAR; el campo de Administración solo aparece cuando la columna existe. Pendiente: enlace de los planes de arrendamiento y el video.
- 04-nov, local sin publicar: buscador de Configuración (`admin-buscador.js`) + pulido responsive; 8 tipos nuevos de actividad interna en `agenda-real.js`; casillas y hora de las actividades arregladas. Almuerzo de la empresa APLICADO en producción: 12:00–13:00.
- `sql/044-tipos-actividad-complementarios.sql` (nuevos tipos en CHECK, inmueble opcional en algunos, duración por defecto en `agenda_crear_cita_interna`): APLICADO en producción (04-nov, con autorización de Felipe): restricciones y función verificadas, sin citas existentes afectadas. Falta probar crear cada tipo nuevo desde la pantalla publicada tras el push.
- Revisiones UX/usabilidad/psicología aplicadas (local): ayuda por tipo, captación separada, contacto plegado, «Guardando…», errores a la vista, mensaje de éxito con detalle; buscador con sinónimos y tolerancia a errores. Sin ver en pantalla con sesión: falta que Felipe inicie sesión en http://localhost:5173 (servidor local, base real) para probar en 375/768/1280 px.
- 04-nov, local sin publicar: (a) soporte: `sql/045-soporte-edicion.sql` APLICADO en producción 04-nov (candado en BD: tras responder soporte no se edita; solo comentarios; 3 triggers y tope de 30 mensajes/hora verificados, edición del ticket y de mensajes rechazada) + `tickets.js`; (b) demanda: `sql/046-demanda-sin-tope.sql` APLICADO 04-nov (columna `demanda_bloquear_por_tope` en false; ningún inmueble queda «lleno»; el bloqueo por tope queda apagado por defecto; alertas de demanda ahora en Informes, `informe-demanda.js`); `avisar-demanda` cambiada en código, SIN DESPLEGAR; (c) Configuración: Empresa/Correo/Ciudades en subpestañas (`admin-subpestanas.js`), guía de Google Meet reescrita; (d) permisos por funcionalidad y roles propios: solo DISEÑO (3 fases, ver resumen en la conversación), nada implementado. Nada visto en pantalla con sesión.
- QA 04-nov (producción, citas [PRUEBA] canceladas): inventario, inspección, otra y captación OK; correos de captación/encuesta OK. Pendiente: los correos del sistema VIEJO (Google Calendar, logo patrimonios.co) siguen llegando, incluso a clientes reales, sin marca de prueba.
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
