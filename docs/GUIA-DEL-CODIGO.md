# Guía del código (para quien tome el proyecto sin leer todos los módulos)

Léela después de `CLAUDE.md` y `docs/ESTADO-ACTUAL.md`. Sirve para decidir **dónde** va un cambio sin abrir
`agenda-real.js` entero (2 500 líneas). Si algo de aquí ya no coincide con el código, corrígelo en el mismo cambio.

## 1. Regla de oro: cada función nueva va en su propio módulo
`agenda-real.js` y `administracion.js` son monolitos heredados. **No los engordes.** Para una función nueva:
1. Crea `aplicacion/js/<nombre>.js` que **solo** habla con Supabase y devuelve datos o HTML (ejemplos: `citas-cruce-virtual.js`, `admin-ia-reuniones.js`, `contacto-empresa.js`, `soporte-comun/`).
2. En el monolito deja únicamente el enganche: un `import`, el botón/HTML y la llamada. Si hace falta estado, agrégalo a `state`.
3. Lo que decide una regla de negocio va en la **base** (SQL/RPC), no en el navegador: el navegador solo avisa y pide confirmación.
4. Lógica sin red que se pueda probar → `tests/<nombre>.test.mjs` (Node: `node --test tests/*.test.mjs`).

## 2. Mapa: «quiero cambiar X» → dónde
| Quiero… | Archivo / objeto |
|---|---|
| Agenda interna del asesor, inmuebles, equipo, informes, bitácora | `aplicacion/js/agenda-real.js` (`state`, `render()` por `state.view`) |
| Agendar actividad interna, avisar de cruces, reuniones virtuales de una cita | `citas-cruce-virtual.js` + formulario `renderInterna` y submit `v-interna-form` en `agenda-real.js` |
| Configuración (pestañas Equipo, Ciudades, Empresa, Correo, IA, Reuniones, Calendario, Importar, Accesos) | `administracion.js` (`abrirSubtab`, `marcaForm` = ajustes generales). Pestañas nuevas → módulo propio como `admin-ia-reuniones.js` |
| Reserva pública del cliente (`/reservar`) | `reservar.js` |
| Portal del arrendatario y página de visita (`/arrendatario`, `/visita`) | `arrendatario.js` + función `portal-visita` |
| Resúmenes/estados de visitas y diseño público compartido | `visita-presentacion.js`, `estilos/visita.css`; vista previa en `tests/fixtures/visitas-preview.html` |
| Plantilla compacta de confirmaciones, avisos al arrendatario y cambios | `supabase/functions/_shared/visita-correo.ts` (marca y modo pruebas se reciben del llamador) |
| Encuesta (`/opinion`), informe del propietario (`/propietario`) | `opinion.js`, `propietario.js` |
| Soporte / tickets | `soporte.js`, `tickets.js`, `soporte-comun/` (ver `docs/SOPORTE-PLATAFORMA.md`) |
| Pendientes y portales inmobiliarios | `pendientes.js`, `portales-logica.js` |
| Colores de marca | `paletas.js`, `marca-publica.js`; en correos `_shared/marca-correo.ts` |
| Correos | funciones `enviar-*`, `avisar-*`, `notificar-cambio-cita` (todas leen `agenda_configuracion` para SMTP y `correo_modo_pruebas`) |

## 3. Datos principales (Postgres, todas con `empresa_id` y RLS)
- `agenda_empresas` → `agenda_configuracion` (1 fila por empresa: horarios, reglas, correo, IA, reuniones virtuales).
- `agenda_miembros` (usuario ↔ empresa ↔ rol: administrador / coordinador / asesor) y `agenda_asesores` (ficha; `usuario_id` es el acceso de login).
- `agenda_inmuebles` (+ `agenda_inmueble_ventanas` = franjas del arrendatario; `sin_aviso_arrendatario`; `estado_crm = 'rentando'`).
- `agenda_citas` (`tipo_cita`, `estado`, `es_prueba`, `modalidad`, `enlace_virtual`, `cruce_autorizado`), `agenda_cita_propuestas` (nuevo horario del arrendatario), `agenda_citas_historial`.
- `agenda_encuestas_cliente` (opinión; `comentario` original solo admin, `comentario_inmueble` ya filtrado por IA), `agenda_correos_log`.
- Soporte: `agenda_tickets`, `agenda_ticket_*`, `agenda_notificaciones`.

## 4. Cómo se agenda (lo que más importa)
1. **Qué horarios se ofrecen**: `agenda_sugerir_horarios` (motor: almuerzo, traslado, zonas, ventanas del arrendatario, anticipación) y `agenda_slot_disponible` (valida un horario concreto). Modos de la empresa para el **mismo inmueble** (`modo_mismo_inmueble`): `desactivado` = una sola cita a la vez por asesor; `separado` = varias personas escalonadas cada X minutos; `simultaneo` = varias personas a la misma hora (visita en grupo).
2. **Quién crea la cita**: RPC `agenda_agendar_cita_publica` / `agenda_reagendar_cita_publica` (cliente), `agenda_crear_cita_interna` / `agenda_mover_cita` (equipo). Todas toman `agenda_bloquear_dia(empresa, fecha)` (candado por empresa y día).
3. **Último muro**: trigger `agenda_citas_sin_choque` rechaza cruces reales aunque algo se salte los pasos anteriores. Solo se salta dentro de una transacción donde `agenda_crear_cita_interna`/`agenda_mover_cita` recibieron `p_forzar=true` (asesor confirmó la advertencia; lo permite `asesores_pueden_cruzar` o ser administrador).
4. La página pública vuelve a pedir horarios si la ventana lleva > 1 min abierta (`reservar.js`: `horariosVencidos`).
5. Tras guardar, el navegador llama a `enviar-correo-cita` (cliente, propietario, arrendatario si aplica). **Siempre** respetar `correo_modo_pruebas`.

## 5. Secretos y proveedores externos (patrón único)
Clave o credencial → **Vault** vía RPC `SECURITY DEFINER`: guardar (solo administrador), estado (nunca devuelve el secreto) y obtener (solo `service_role`, solo la lee una Edge Function). Copias de este patrón: correo SMTP, `agenda_guardar_clave_ia`, `agenda_guardar_credenciales_videollamada`.
- **IA** (`filtrar-opiniones`): proveedor `anthropic | openai | google` + modelo editable. Para añadir otro, agregar una rama en `llamarProveedor` y una entrada en `PROVEEDORES_IA` (`admin-ia-reuniones.js`) + el valor en el `check` de SQL 030.
- **Reuniones** (`crear-videollamada`): mapa `PROVEEDORES` (`google_meet`, `microsoft_teams`, `zoom`) + `manual`. Para otro (Webex, Jitsi…): un objeto nuevo en el mapa, su entrada en `PROVEEDORES_REUNION` y el `check` de SQL. El proveedor se elige por empresa en Configuración → Reuniones virtuales.

## 6. Recetas
- **Columna de ajuste nueva**: `alter table agenda_configuracion add column ...` en un `sql/NNN-*.sql`; campo en `marcaForm()` (HTML + `upsert` del submit, protegido con `'columna' in config` para que no rompa antes de aplicar el SQL).
- **Tabla nueva**: en la misma migración, `grant` a `authenticated`/`service_role` (y `anon` solo si la página pública la lee) + RLS por `empresa_id`.
- **Edge Function nueva**: carpeta en `supabase/functions/<nombre>/`, validar JWT a mano si es pública, desplegar con la CLI de `CLAUDE.md` (añadir `--no-verify-jwt` solo a las públicas) y anotarla en el mapa de `CLAUDE.md`.
- **Página pública con token**: el token es la credencial; la función solo devuelve lo de ese token.
- **Antes de dar algo por probado**: build (`npm run build`), pruebas (`node --test tests/*.test.mjs`) y, en SQL, transacción que termina en `raise exception` para deshacer (ver ejemplos en el historial de `docs/ESTADO-ACTUAL.md`).

## 7. Otros negocios (médicos, salones…) — qué ya sirve y qué falta
Ya sirve: multi-empresa con RLS, asesores como «profesionales», citas, correos, marca por empresa, reuniones virtuales, cruces con aviso, visitas escalonadas o en grupo.
Falta para vender a otro sector (en este orden): (1) vocabulario por empresa (inmueble → consultorio/servicio, asesor → profesional, visita → consulta) en una tabla de textos, hoy está fijo en español inmobiliario; (2) «inmueble» opcional en la reserva pública (hoy `numero_inmueble` es obligatorio); (3) catálogo de servicios con duración propia en lugar de `duracion_visita_minutos`; (4) reserva pública con modalidad presencial/virtual; (5) datos sensibles de salud: política de privacidad, consentimiento y cifrado de notas clínicas antes de guardar cualquier dato clínico.
