# Agenda de citas - Patrimonios Inmobiliarios

Fuente única de instrucciones para Claude Code y Codex (`AGENTS.md` apunta aquí).

## Inicio de cada tarea
- Leer este archivo y `docs/ESTADO-ACTUAL.md`.
- Ejecutar `git status --short` y `git diff --stat`.
- Abrir solo los archivos directamente relacionados con la tarea. No leer históricos,
  guías completas ni módulos grandes por defecto.
- Para una tarea concreta, preferir `rg` y rangos pequeños de líneas a volcar archivos enteros.

## Qué es
Agenda de citas para asesores inmobiliarios (multi-ciudad, multi-asesor, pensada para venderse como
SaaS). Reemplaza un sistema legado en Google Calendar + Apps Script + Sheets. `PROYECTO.md` y los
`LEEME-*.md` son bitácoras viejas (algunas describen una demo superada); no son fuente de verdad.

## Arquitectura esencial
- Frontend real: Vite + JavaScript vanilla en `aplicacion/`. La raíz es una demo vieja: no tocar.
- Backend: Supabase `ykiuuxludyonkhywtmgu`, Postgres, RLS, Auth, Vault y Edge Functions.
- Multiempresa desde el día 1: filtrar por `empresa_id` y respetar RLS.
- Hosting: Netlify despliega `main` en `citas.patrimonios.co`; agrupar cambios porque el plan tiene créditos.
- Identidad visual: usar variables `--empresa-*`/`--tema-*` y `marcaCorreo()`, nunca colores fijos.
- Datos creados o subidos por usuarios: persistirlos en BD o, como mínimo, `localStorage`.
- Funcionalidad nueva: crear un módulo nuevo cuando corresponda; no inflar un módulo grande sin necesidad.
- Detalles de UI y módulos: consultar `docs/GUIA-DEL-CODIGO.md` solo cuando la tarea los requiera.

## Router rápido: pregunta -> primer lugar que revisar
- Reserva pública, horarios, choque, correo de verificación -> `aplicacion/js/reservar.js` + RPC SQL de agenda.
- Agenda interna, inmuebles, asesores, informes, bitácora -> `aplicacion/js/agenda-real.js`.
- Visita, arrendatario, reubicación, nueva hora -> `aplicacion/js/arrendatario.js` + `portal-visita`.
- Empresa, sedes, correo, IA, reuniones, accesos, importar -> `aplicacion/js/administracion.js` o módulo `admin-*.js`.
- Encuesta, opinión, informe del propietario -> `opinion.js` / `propietario.js` + función `enviar-*` relacionada.
- Soporte, tickets, notificaciones, fallos -> `tickets.js`, `soporte.js`, `soporte-comun/`, `fallos-*.js`.
- Correos que no llegan o destinatario equivocado -> función `enviar-*`/`avisar-*` + `_shared/marca-correo.ts` + `correo_modo_pruebas`.
- Dato que no guarda, permisos o cruce de citas -> `sql/` correspondiente, RPC, grants y RLS antes del frontend.
- Diseño, colores o móvil -> `aplicacion/estilos/` + `paletas.js`/`marca-publica.js`.
- Si la ruta no es evidente -> consultar la tabla completa de `docs/GUIA-DEL-CODIGO.md` por palabra clave.

## Reglas de seguridad (seguir siempre)
- Todo lo que necesite la `service_role` (crear usuarios, cambiar contraseñas, leer Vault) va en una Edge
  Function, nunca en el navegador. La función verifica que quien llama sea administrador activo de la empresa
  (JWT del `Authorization`, `admin.auth.getUser(jwt)`, luego `agenda_miembros`).
- Nunca `auth.users` en políticas RLS ni en SQL del rol `authenticated` (da "permission denied for table users"); usar `auth.email()`/`auth.uid()`.
- `agenda_miembros` solo permite autolectura. Para resolver nombres de otros miembros: función `SECURITY DEFINER`
  (o Edge Function) que valide ella misma que quien llama es admin/coordinador de esa empresa.
- Contraseñas SMTP y similares solo en Vault, vía función `SECURITY DEFINER` ejecutable solo por `service_role`
  (`agenda_obtener_password_correo`). Nunca se devuelven al navegador. No pegar secretos ni datos personales en el repo.
- Tabla nueva en `public`: en la misma migración, `grant select ... to anon` (solo si la página pública la necesita),
  `grant select, insert, update, delete ... to authenticated` y `... to service_role`, más su RLS.
- Crear una ficha de asesor no da acceso de login; el vínculo (`agenda_asesores.usuario_id`) es un paso explícito ("Dar acceso").
- Páginas públicas con token (`/visita/`, `/arrendatario/`, `/propietario/`, `/opinion/`, `calendario-ics`):
  el token es la credencial; cada parte solo ve lo suyo.
- Correos: respetar `correo_modo_pruebas` (sigue ACTIVO: todo va a `correo_pruebas_destino`); apagarlo solo con orden de Felipe.

## Comandos
- Desarrollo: `npm run dev` (Vite). Validación de front end: `npm run build` (puede fallar con `EPERM` al limpiar `dist/`; no es del código: borrar `dist/` a mano con permiso de Felipe).
- Contacto por empresa: `node --test tests/contacto-empresa.test.mjs` (Node 24). El resto se prueba a mano / con red real; no declarar pruebas no ejecutadas.
- Desplegar Edge Functions (preferir CLI para evitar copiar cuerpos completos de funciones al contexto; verificar autenticación antes de desplegar):
  `npx --no-install supabase functions deploy <funciones> --project-ref ykiuuxludyonkhywtmgu --use-api`
  y añadir `--no-verify-jwt` SOLO a las públicas: enviar-correo-cita, enviar-correo-propietario,
  enviar-solicitud-propietario, enviar-encuesta-cliente, recuperar-contrasena, portal-visita, calendario-ics,
  enviar-codigo-verificacion, filtrar-opiniones, enviar-encuestas-pendientes, enviar-resumen-propietarios, enviar-radicacion-cliente, avisar-encuesta-respondida, avisar-demanda, registrar-fallo. Las demás (incl. crear-videollamada) llevan JWT.
- Orden de salida cuando cambian imágenes de correos: primero push a `main` (Netlify publica `/correo/`), después desplegar funciones.
- SQL: archivos en `sql/NNN-descripcion.sql`; si se aplica directo en Supabase, dejar el archivo de referencia.

## Documentación bajo demanda
- Diseño y ubicación de cambios: `docs/GUIA-DEL-CODIGO.md`.
- Salida a clientes reales: `docs/PUESTA-EN-MARCHA-PATRIMONIOS.md` y `docs/MEJORAS-EN-PRODUCCION.md`.
- Empresa y datos legales: `docs/CONTACTO-EMPRESA.md`.
- Pruebas: `docs/LIMPIAR-PRUEBAS.md`.
- Operación externa al desarrollo: `docs/OPERATIVO-FUERA-DE-DESARROLLO.md`.
- Historia y decisiones cerradas: `docs/historico/`; buscar por palabra clave, nunca leerla completa.

## Colaboración entre herramientas (Claude Code / Codex)
- Una sola herramienta modifica este checkout a la vez. No editar en paralelo.
- Quien recibe el trabajo: lee `CLAUDE.md` y `docs/ESTADO-ACTUAL.md`, corre `git status --short` y `git diff --stat`, y solo después
  abre los módulos que la tarea necesita. No releer todo el histórico.
- Al terminar cada avance útil, **reemplazar** (no acumular) lo superado en `docs/ESTADO-ACTUAL.md`. `CLAUDE.md` solo se
  edita si cambia una regla, convención o comando.
- No commitear, hacer push ni desplegar sin que Felipe lo pida o lo haya autorizado para esa tarea.

## Cómo trabajar con Felipe
Felipe es el CFO y único desarrollador de Patrimonios; no es programador de formación. Explicar en español, con pasos
concretos y sin jerga. Confirmar antes de tocar la base de datos remota de producción (no hay entorno de pruebas
separado). No inventar que algo se probó con red real si no se probó. Felipe teme borrar archivos: nunca borrar nada sin
permiso explícito; si lo niega o no responde, no insistir ni buscar atajos (mover a otra carpeta, etc.).
