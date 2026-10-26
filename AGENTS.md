# Instrucciones para Codex

Este proyecto usa **`CLAUDE.md`** como fuente única de instrucciones para todas las herramientas. Léelo primero
y síguelo como si fuera este archivo; no se duplica aquí.

Orden para retomar el trabajo:
1. `CLAUDE.md` (arquitectura, reglas de seguridad, comandos, mapa de módulos, colaboración).
2. `docs/ESTADO-ACTUAL.md` (trabajo vigente, qué quedó a medias, siguiente paso).
3. `git status` y `git diff`.
4. Solo entonces, los módulos que la tarea necesite.

Regla: una sola herramienta modifica el checkout a la vez. Si cambias una regla o comando, edita `CLAUDE.md`, no este archivo.
