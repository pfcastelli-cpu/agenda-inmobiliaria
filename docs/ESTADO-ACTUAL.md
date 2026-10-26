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

## Franjas del arrendatario, encuesta automática y avisos (26-oct-2026)
APLICADO y desplegado (commit 04ccf99, front end publicado): SQL 017 (franjas por día del arrendatario, enlace único por inmueble, reubicación) y SQL 018 (encuesta automática, avisos).
Funciones desplegadas: portal-visita, avisar-arrendatario, notificar-cambio-cita, enviar-encuesta-cliente, enviar-encuestas-pendientes, avisar-encuesta-respondida.
- PROBADO en modo de pruebas (inmueble 127 Rentando): aviso único con la lista de visitas; franja «disponible» 14–16 → las 2 visitas quedaron «por reubicar», cada cliente y el asesor recibieron su correo;
  el cliente solo ve turnos dentro de la franja (cada 15/30 min, varios clientes en la misma franja) y reagenda al instante; fuera de la franja se rechaza; borrar franjas funciona.
  Avisos de encuesta: al responder con «avanzar» llegó 1 correo al asesor y 2 a la administración (a 2 administradores); la segunda llamada no repite. Citas de prueba de esta sesión quedaron CANCELADAS (no borradas).
- Cron ACTIVOS: `encuestas-pendientes` (cada 10 min, timeout 120 s) y `encuestas-resumen-semanal` (lunes 7 a. m. Bogotá). Para pausar el envío automático: `select cron.unschedule('encuestas-pendientes')`.
- ERROR HALLADO Y CORREGIDO (SQL 019 aplicado, funciones `enviar-encuesta-cliente` y `enviar-encuestas-pendientes` redesplegadas): `agenda_correos_log` NO admitía `destinatario_tipo = 'encuesta_cliente'` y esos registros nunca se guardaban, por lo que el control de «no repetir»
  por bitácora fallaba (3 envíos repetidos en pruebas). Ahora la fuente de verdad es `agenda_encuestas_cliente.enviada_en` y la bitácora admite el tipo. PROBADO: una visita de prueba vencida recibió 1 encuesta; una segunda corrida del cron envió 0.
- La encuesta sale sola N minutos después de terminar la visita (Configuración). Solo se manda al marcar «Realizada» si la empresa desactiva el envío automático.
- Nota: con el modo de pruebas activo las encuestas «enviadas» quedan marcadas y NO se reenviarán a los clientes reales de esas visitas al apagar el modo de pruebas.
- Pendiente por mejorar: turnos cada 15 min también en la lista que ve el cliente (hoy el portal pide 30 min y salen además los de 15 min junto a una visita existente); escalar al asesor cuando vence una reubicación sin respuesta (tarea programada); franjas ofrecidas por el cliente; resumen diario al arrendatario.

## Citas de prueba marcadas y pendientes de portales automáticos (26-oct-2026, APLICADO)
- `sql/020-citas-de-prueba.sql` APLICADO: `agenda_citas.es_prueba` + prefijo «[PRUEBA] »; 11 citas de Claude marcadas (1 sigue activa y 1 «completada»: «Prueba Claude 5 (127, comentarios)»). La agenda muestra la insignia «PRUEBA».
  Las pruebas de Felipe («Pepe», «Gino», «Felipe Castelli», «Pedro Interesado») NO se marcaron. Convención y limpieza (solo con permiso): `docs/LIMPIAR-PRUEBAS.md`.
- `sql/021-portales-automatico.sql` APLICADO: `agenda_portales_publicaciones` (la «foto» de lo publicado en cada portal), RPC `agenda_portales_guardar_foto` (la llama la pestaña Pendientes → Portales al subir un Excel) y
  `agenda_portales_reevaluar()` con cron `portales-reevaluar` (6:30 a. m. Bogotá): compara la foto con Sedi y abre/mantiene/cierra solos los pendientes. PROBADO que coincide con `portales-logica.js` (`compararPortal`) en los 3 portales con datos
  sintéticos dentro de una transacción que se deshizo (Fincaraíz 10/10, Metrocuadrado 11/11, Ciencuadras 15/15 pendientes, mismas claves). La lista de Pendientes ahora trae resumen (inmuebles por corregir, chips por tipo, edad de cada Excel) y secciones plegables.
- IMPORTANTE: la foto está VACÍA hasta que alguien suba los 3 Excel una vez más (Pendientes → Portales); mientras tanto el cron no hace nada y los 49 pendientes abiertos (carga del 21-oct) siguen como estaban.

## Siguiente paso
Subir los 3 Excel de portales una vez (para crear la foto) y probar con sesión (guardar Administración > Empresa, sedes, botones de la encuesta desde el correo, marca «Reubicación pendiente» en la agenda) y los pendientes de producto en `docs/historico/CLAUDE-completo-2026-10-26.md`.

## Respaldo y reversión
El historial de git (GitHub) es el respaldo del código y permite volver a cualquier commit. Los datos de Supabase se respaldan con
`sincronizacion/respaldo-drive.gs` (semanal a Drive; ver si está activado). Antes de aplicar SQL 016 conviene un respaldo de `agenda_configuracion`.

## No incluir en commits
`.agents/`, `.claude/`, `skills-lock.json`, la guía PDF, `supabase/.temp/` y los HTML reales de `correos/pruebas-enviadas/`.
