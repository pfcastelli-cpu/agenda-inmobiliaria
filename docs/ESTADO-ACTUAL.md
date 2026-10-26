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
- SQL 001–015: aplicadas. **SQL 016 (`sql/016-contacto-empresa.sql`): PREPARADA, NO aplicada.** Lectura previa de producción (solo SELECT,
  26-oct): hay una única empresa, slug `patrimonios`, y la columna `contacto_empresa` aún no existe; la guarda de 016 pasaría.
- Edge Functions en Supabase: siguen desplegadas con la versión ANTERIOR (fijos escritos en el código, desplegada el 26-oct). El código nuevo está
  en el repo pero NO desplegado. **No desplegar las 12 funciones antes de aplicar 016**: sus consultas piden la columna nueva y fallarían.
- Front end: el editor nuevo llega a producción solo con un push que no lleve `[skip netlify]`; hasta aplicar 016 el editor se oculta y
  muestra un aviso (la UI detecta que la columna no existe).
- `correo_modo_pruebas` sigue ACTIVO; no se tocó SMTP, JWT, RLS ni credenciales.

## Pruebas
- Ejecutadas: `node --test tests/contacto-empresa.test.mjs` 12/12 (aislamiento A/B, escape, enlaces, teléfonos/extensiones, captación, datos de Patrimonios, análisis de las 12 funciones);
  `git diff --check` limpio; revisión de código y de 016 por Claude (sin ejecutar el SQL). Codex además: build con salida temporal y vista previa sintética en Chrome (320–1280 px).
- Pendientes: ejecutar y verificar 016 en PostgreSQL; guardado/lectura con sesión y RLS reales; envío y recepción de las 12 funciones; Outlook y celular físicos.

## Siguiente paso
Con autorización explícita de Felipe, en este orden: (1) aplicar 016 y leer los datos por empresa; (2) desplegar las 12 funciones con la CLI
(comando y lista de públicas en `CLAUDE.md`); (3) push del front end sin `[skip netlify]` si aún no está publicado; (4) mandar un correo de prueba
de cada tipo en modo de pruebas y revisarlos. Después, lo pendiente de producto: ver «Pendiente / próximos pasos» en
`docs/historico/CLAUDE-completo-2026-10-26.md`.

## Respaldo y reversión
El historial de git (GitHub) es el respaldo del código y permite volver a cualquier commit. Los datos de Supabase se respaldan con
`sincronizacion/respaldo-drive.gs` (semanal a Drive; ver si está activado). Antes de aplicar SQL 016 conviene un respaldo de `agenda_configuracion`.

## No incluir en commits
`.agents/`, `.claude/`, `skills-lock.json`, la guía PDF, `supabase/.temp/` y los HTML reales de `correos/pruebas-enviadas/`.
