# Ambiente de pruebas (copia) y trabajo en paralelo

Objetivo: poder mejorar el sistema, probarlo y revisarlo en la nube **sin tocar clientes reales ni la base de producción**, y solo después aplicar lo aprobado.
Estado: **guía lista, copia NO creada todavía** (nada de esto se ha ejecutado). Se crea justo antes de apagar `correo_modo_pruebas`.

## 1. Qué es la copia
Tres piezas separadas de producción:

| Pieza | Producción (hoy) | Copia de pruebas |
|---|---|---|
| Base de datos y funciones | Supabase `ykiuuxludyonkhywtmgu` | **Segundo proyecto Supabase** (p. ej. `agenda-pruebas`) |
| Página | Netlify, rama `main` → `citas.patrimonios.co` | Netlify, rama `pruebas` → `pruebas.patrimonios.co` (o la URL que Netlify le dé) |
| Correos | SMTP real, modo pruebas ACTIVO | **Sin SMTP real**: ni contraseña ni host; los correos se omiten o van solo al buzón de Felipe |

La página decide a qué base se conecta por dos variables (`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, ver `aplicacion/js/cliente-supabase.js`). Por eso el mismo código sirve para las dos copias: solo cambian esas variables en Netlify.

## 2. Paso a paso (cuando se decida crearla)
1. **Crear el proyecto** en Supabase (otra organización o la misma). Tiene costo mensual propio: confirmar el precio vigente en el panel antes de crearlo.
2. **Copiar la estructura de la base** (sin datos de clientes). Dos caminos:
   - Más fiel: volcado del esquema de producción (`npx supabase db dump --schema public` contra producción) y restaurarlo en la copia. Requiere probarlo la primera vez.
   - Alternativo: aplicar los archivos de `sql/` en orden numérico. Ojo: algunos se aplicaron directo en producción, así que puede no quedar idéntico; comparar después con `list_tables`.
3. **Datos ficticios**: cargar unos pocos inmuebles, asesores y propietarios inventados. **Nunca** copiar correos ni celulares reales de clientes o propietarios.
4. **Secretos de la copia** (Supabase → Edge Functions → Secrets): solo `CRON_ENCUESTAS_SECRETO` (inventado, distinto al de producción). **No** guardar contraseña SMTP en la Bóveda. Resultado: las funciones de correo responden «correo no configurado» y no envían nada.
5. **Seguro extra**: en la copia dejar `correo_modo_pruebas = true` y `correo_pruebas_destino` = correo de Felipe, por si algún día se configura un SMTP de pruebas.
6. **Desplegar las funciones** en la copia: el mismo comando de siempre cambiando `--project-ref` por el de la copia (y las mismas banderas `--no-verify-jwt`).
7. **Netlify**: crear la rama `pruebas` en Git; en Netlify → Site configuration → Branches, activar *branch deploys* y en Environment variables definir `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` **con alcance solo para esa rama** (valores de la copia). La clave publicable no es secreta, pero igual va por el panel, no en el repo.
8. **Crons**: no programarlos en la copia (o programarlos apuntando a la URL de la copia). Si se programan, usar el secreto de la copia.
9. **Aviso visual**: conviene que la página de la copia muestre una franja «PRUEBAS» para no confundirse (pendiente de hacer).

## 3. Flujo de trabajo diario
1. Se desarrolla en una rama (`pruebas` o `feature/...`), nunca directo en `main`.
2. Los SQL y funciones nuevos se aplican **primero en la copia**; se revisa en la URL de pruebas.
3. Felipe aprueba. Entonces, y solo entonces: SQL en producción → funciones en producción → fusionar la rama a `main` (push).
4. Cada SQL nuevo lleva su archivo `sql/NNN-...` y se registra en `docs/ESTADO-ACTUAL.md`.

## 4. Trabajar en paralelo con ChatGPT (Codex) sin pisarse
Regla del proyecto (`CLAUDE.md`): una sola herramienta modifica **una misma carpeta** a la vez. Para trabajar dos a la vez hace falta **otra carpeta con otra rama**:

1. **Antes de empezar**, guardar el trabajo actual con commit (la carpeta nueva parte del último commit; lo que no esté guardado no aparece).
2. Crear la carpeta paralela, fuera de esta:
   ```bash
   git worktree add ../agenda-chatgpt -b feature/nombre-de-la-adicion
   ```
3. Abrir **esa** carpeta (`../agenda-chatgpt`) en ChatGPT/Codex. Ya trae `AGENTS.md` → `CLAUDE.md`, así que conoce las reglas.
4. Acordar con Codex: módulo **nuevo** (`aplicacion/js/<nombre>.js`), tablas nuevas con SQL numerado desde **080** (para no chocar con los 072+ de Claude) y tocar lo mínimo en los archivos compartidos (`agenda-real.js`, `administracion.js`, `index.html`, `ESTADO-ACTUAL.md`), que son los que más generan conflictos.
5. Codex **no** debe tocar producción: su base es la copia de pruebas (sección 2) y no debe usar las llaves de producción.
6. Al terminar, se revisa y se fusiona: `git merge feature/nombre-de-la-adicion` desde la carpeta principal (o un Pull Request en GitHub). Los conflictos se resuelven ahí, con cuidado.
7. Para quitar la carpeta paralela al final: `git worktree remove ../agenda-chatgpt` (borra solo esa carpeta; hacerlo con permiso de Felipe).

## 5. Lo que aún falta para tener la copia
- Decidir el nombre y la organización del segundo proyecto de Supabase y el costo.
- Crear el proyecto, cargar el esquema y los datos ficticios (pasos 1–3).
- Crear la rama `pruebas` y las variables en Netlify (paso 7).
- Franja «PRUEBAS» en la página de la copia (paso 9).
