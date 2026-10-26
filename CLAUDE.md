# Agenda de citas — Patrimonios Inmobiliarios

Instrucciones principales para Claude Code **y** Codex (`AGENTS.md` apunta aquí). Se mantiene corto a
propósito. Antes de tocar nada lee también `docs/ESTADO-ACTUAL.md` (trabajo vigente) y corre
`git status` + `git diff`.

## Qué es
Agenda de citas para asesores inmobiliarios (multi-ciudad, multi-asesor, pensada para venderse como
SaaS). Reemplaza un sistema legado en Google Calendar + Apps Script + Sheets. `PROYECTO.md` y los
`LEEME-*.md` son bitácoras viejas (algunas describen una demo superada); no son fuente de verdad.

## Arquitectura esencial
- Frontend: Vite + JS vanilla, sin framework. `aplicacion/` es la app real (login, agenda interna,
  reserva pública, configuración). La raíz (`index.html`, `referencia-visual.html`) es una demo vieja: no tocar.
- Backend: Supabase (project id `ykiuuxludyonkhywtmgu`): Postgres + RLS, Auth, Edge Functions en
  `supabase/functions/`, Vault para secretos. Multi-empresa desde el día 1 (`agenda_empresas`, RLS por `empresa_id`).
- Hosting: Netlify conectado a GitHub; cada push a `main` despliega a `citas.patrimonios.co`
  (plan gratis con créditos: juntar cambios; usar `[skip netlify]` en el commit si solo cambian docs/.gs/.sql/funciones).
- Patrón de `aplicacion/js/agenda-real.js`: objeto `state` global, `render()` despacha por `state.view`,
  `nav()` resalta pestaña, visibilidad por rol (`contexto.rol`), iconos Lucide (`createIcons`/`icon()`),
  `escape()` para texto en HTML, consultas directas con `supabase.from(...)` en paneles de administrador.
  Clases CSS reutilizadas: `v-top`, `v-eyebrow`, `v-note`, `v-muted`, `v-empty`, `v-btn`, `v-primary`,
  `v-quiet`, `v-field`, `v-input`, `v-error`, `v-filters`. Selects/fechas con `change`; texto libre con `input` + debounce.
- Colores de marca: nunca fijos en CSS/HTML; usar variables `--empresa-*`/`--tema-*` (`aplicacion/js/paletas.js`)
  y, en correos, `marcaCorreo()`.
- Tablas anchas: clase `v-tabla-res` (con `<thead>`) para que salgan como tarjetas en celular.
- Lo que el usuario sube o arma y no debe perder: guardarlo en BD (o al menos `localStorage`), no solo en variables del módulo.

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
  enviar-codigo-verificacion. Las demás llevan JWT.
- Orden de salida cuando cambian imágenes de correos: primero push a `main` (Netlify publica `/correo/`), después desplegar funciones.
- SQL: archivos en `sql/NNN-descripcion.sql`; si se aplica directo en Supabase, dejar el archivo de referencia.

## Mapa de módulos
- `aplicacion/js/`: `agenda-real.js` (agenda interna, inmuebles, equipo, informes, bitácora), `administracion.js`
  (accesos, correo, calendario, importar, ciudades, config), `pendientes.js` + `portales-logica.js` (Pendientes/Portales),
  `reservar.js` (reserva pública), `arrendatario.js` (portal `/arrendatario` y `/visita`), `opinion.js` (encuesta),
  `propietario.js` (informe), `paletas.js` / `marca-publica.js` (marca), `tablas-moviles.js`, `sesion.js`,
  `cliente-supabase.js`. `agenda-demo.js` es de la demo vieja.
- `aplicacion/estilos/`: `agenda.css` (grande; rediseño y móvil al final), `acceso.css`, `administracion.css`, `reservar.css`.
- `supabase/functions/`: correos (`enviar-correo-cita`, `-propietario`, `-informe-propietario`, `enviar-solicitud-propietario`,
  `enviar-encuesta-cliente`, `avisar-arrendatario`, `notificar-cambio-cita`, `recuperar-contrasena`, `probar-correo-config`),
  `gestion-accesos`, `portal-visita`, `marcar-inmueble-no-disponible`, `calendario-ics`; compartido en `_shared/marca-correo.ts`.
- `sql/`: migraciones 001–015 (todas aplicadas). `sincronizacion/`: Apps Script (`sincronizar-inmuebles.gs`, `respaldo-drive.gs`, `vigilante-correos.gs`) — se despliegan a mano en Google, no desde este repo.
- `correos/`: fotos y bocetos de correos; `correos/pruebas-enviadas/` son copias HTML de pruebas.

## Dónde consultar detalles según la tarea
- Estado, trabajo en curso y siguiente paso: `docs/ESTADO-ACTUAL.md` (único resumen vigente).
- Historia completa de lo construido, decisiones y pendientes largos: `docs/historico/CLAUDE-completo-2026-10-26.md`
  (copia íntegra del CLAUDE.md anterior; buscar por palabra clave, no leerla entera). Secciones útiles: «Acuerdo de horario en
  inmuebles arrendados», «Rediseño y marca por empresa», «Vigilante de correos», «Pendiente / próximos pasos».
- Asuntos operativos ajenos al desarrollo (terminaciones en Sedi, vigilante de correos, respaldos, bot de WhatsApp):
  `docs/OPERATIVO-FUERA-DE-DESARROLLO.md`.
- Contacto, sedes y datos legales por empresa: `docs/CONTACTO-EMPRESA.md` (contrato, archivos, pruebas y orden de aplicación de SQL 016, pendiente).
- Pruebas: toda cita de prueba lleva `es_prueba = true` y el nombre empieza por «[PRUEBA] »; cómo reconocerlas y limpiarlas: `docs/LIMPIAR-PRUEBAS.md`.
- Cómo mejorar sin riesgo cuando haya clientes reales (entorno de pruebas, respaldos, orden de salida): `docs/MEJORAS-EN-PRODUCCION.md`.
- Estilo de correos: `supabase/functions/_shared/marca-correo.ts`; historia visual en la viñeta del 26-oct del histórico.

## Colaboración entre herramientas (Claude Code / Codex)
- Una sola herramienta modifica este checkout a la vez. No editar en paralelo.
- Quien recibe el trabajo: lee `CLAUDE.md` y `docs/ESTADO-ACTUAL.md`, corre `git status` y `git diff`, y solo después
  abre los módulos que la tarea necesita. No releer todo el histórico.
- Al terminar cada avance útil, **reemplazar** (no acumular) lo superado en `docs/ESTADO-ACTUAL.md`. `CLAUDE.md` solo se
  edita si cambia una regla, convención o comando.
- No commitear, hacer push ni desplegar sin que Felipe lo pida o lo haya autorizado para esa tarea.

## Cómo trabajar con Felipe
Felipe es el CFO y único desarrollador de Patrimonios; no es programador de formación. Explicar en español, con pasos
concretos y sin jerga. Confirmar antes de tocar la base de datos remota de producción (no hay entorno de pruebas
separado). No inventar que algo se probó con red real si no se probó. Felipe teme borrar archivos: nunca borrar nada sin
permiso explícito; si lo niega o no responde, no insistir ni buscar atajos (mover a otra carpeta, etc.).
