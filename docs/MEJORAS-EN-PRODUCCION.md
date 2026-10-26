# Cómo mejorar el sistema cuando ya esté en producción

Hoy todo se prueba directo en la base real porque aún no hay clientes reales (`correo_modo_pruebas = true`, los correos van a
pf.castelli@patrimonios.co). Cuando se apague el modo de pruebas esto cambia: un error en un horario o en un correo afecta
a personas de verdad. Esta es la forma de seguir mejorando sin ese riesgo. Sirve igual para Claude Code, Codex o una persona.

## 1. Un segundo entorno para ensayar (lo primero que hay que montar)
- Crear un proyecto Supabase de pruebas (o una rama de Supabase) con la misma estructura (`sql/001`…`NNN` en orden) y datos falsos.
  Las Edge Functions se despliegan primero ahí (`--project-ref` del proyecto de pruebas) y se prueban con correos al buzón de pruebas.
- El front end: Netlify publica una vista previa por rama sin gastar créditos de producción. Probar ahí apuntando al proyecto de pruebas.
- Regla: nada nuevo toca el proyecto real sin haber pasado antes por el de pruebas.

## 2. Respaldos y vuelta atrás
- Código: Git/GitHub. Volver atrás = `git revert <commit>` y volver a desplegar las funciones de ese commit.
- Datos: antes de cada migración, copiar a `respaldos/` (fuera de git) las tablas y funciones que toca (ejemplos: `respaldos/agenda_configuracion-antes-016-…json`,
  `respaldos/funciones-horarios-antes-017-…json`). Verificar que el respaldo no está vacío. Activar el respaldo semanal a Drive (`sincronizacion/respaldo-drive.gs`)
  y, cuando haya clientes reales, el respaldo diario/«point in time» del plan de pago de Supabase.
- Cada archivo `sql/NNN-*.sql` debe poder repetirse sin daño (`if not exists`, `create or replace`) y traer una nota de cómo deshacerlo.

## 3. Cambios de base de datos sin sorpresas
1. Escribir el SQL como archivo en `sql/` y probarlo primero en el entorno de pruebas.
2. Probar las funciones críticas (horarios, disponibilidad) dentro de una transacción que se deshace: `begin; …consultas de prueba…; rollback;`.
3. Cambios aditivos primero (columnas/tablas nuevas con valor por defecto); romper o borrar algo solo en un segundo paso, cuando ya nada lo usa.
4. Aplicar en horas de baja actividad y revisar enseguida los registros de errores de Supabase.

## 4. Interruptores por empresa («feature flags»)
- Las funciones nuevas importantes entran apagadas y se encienden por empresa (una columna o un campo `funciones_activas` en `agenda_configuracion`).
  Se activan primero para una empresa piloto o solo en el entorno de pruebas, y si algo falla se apagan sin desplegar nada.
- Ejemplo pendiente: las franjas del arrendatario (SQL 017) podrían salir detrás de uno de estos interruptores.

## 5. Orden de salida (siempre el mismo)
1. Migración SQL → 2. Edge Functions (primero las que solo leen/ extienden) → 3. Front end (push sin `[skip netlify]`) → 4. Prueba corta en producción con una cita de prueba → 5. Anotar en `docs/ESTADO-ACTUAL.md`.
Las funciones nuevas nunca se despliegan antes que la migración que necesitan (pasó con SQL 016).

## 6. Vigilar después de publicar
- Mirar `agenda_correos_log` (correos fallidos u omitidos) y los registros de las Edge Functions durante los primeros días.
- Avisos al equipo: un cambio visible para asesores o clientes se avisa antes (qué cambia y desde cuándo).
- Cuando se apague el modo de pruebas: hacerlo con una orden explícita de Felipe, con una cita real de bajo riesgo primero.

## 7. Qué no automatizar sin supervisión
Cambios de horario de citas ya confirmadas, envíos masivos a propietarios y cualquier tarea programada que escriba en la base. Siempre con tope, bitácora y botón de detener.
