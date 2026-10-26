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

## Siguiente paso
(1) Probar el editor de sedes con sesión (guardar, RLS). (2) Probar con sesión los correos que faltan. Después, pendientes de producto en `docs/historico/CLAUDE-completo-2026-10-26.md`.

## Respaldo y reversión
El historial de git (GitHub) es el respaldo del código y permite volver a cualquier commit. Los datos de Supabase se respaldan con
`sincronizacion/respaldo-drive.gs` (semanal a Drive; ver si está activado). Antes de aplicar SQL 016 conviene un respaldo de `agenda_configuracion`.

## No incluir en commits
`.agents/`, `.claude/`, `skills-lock.json`, la guía PDF, `supabase/.temp/` y los HTML reales de `correos/pruebas-enviadas/`.
