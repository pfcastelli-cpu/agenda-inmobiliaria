# Correos por inmueble y contrato (lector automático)

Estado: **construido en local, sin aplicar ni desplegar** (28 nov 2026). Decisiones de Felipe: leer solicitudes@, info@ y contabilidad@ (entrantes y salientes);
guardar resumen + enlace; el correo y sus adjuntos van a Drive; cada correo se une a un **inmueble y un contrato** (no a un caso);
Sedi se llena desde una lista de pendientes con botón; se autoriza que Claude escriba seguimientos en Sedi.

## Piezas
| Pieza | Archivo | Qué hace |
|---|---|---|
| Tablas | `sql/124-correos-inmueble.sql` (SIN aplicar) | `agenda_inmueble_correos` (un correo = una fila: inmueble, contrato, fecha real, resumen, enlaces, estado de Sedi) y `agenda_inmueble_contratos_resumen` (resumen breve por contrato: propietario / arrendatario). |
| Lector | `sincronizacion/archivo-correos-inmuebles.gs` | Mismo proyecto de Apps Script del vigilante (reutiliza su cuenta de servicio, Gemini con topes y el índice de arrendados). Cada 15 min lee los 3 buzones, filtra lo que importa, une a inmueble/contrato, guarda en Drive y escribe en Supabase. |
| Pantalla | `aplicacion/js/casos-correos.js` | Pestaña «Correos por inmueble»: elegir inmueble, filtrar por contrato, resumen del contrato, línea de tiempo con enlaces; «Por asignar» para corregir. Bloque «Correos por anotar en Sedi» dentro de «Sincronizar con Sedi». |

## Cómo une un correo a un inmueble y contrato (en este orden)
1. Correo del arrendatario (hoja de arrendados del vigilante). 2. Número de contrato (CT-####) en asunto o cuerpo. 3. Dirección completa del inmueble en el texto.
Si no logra unirlo: en solicitudes@/info@ queda **«Por asignar»** (si habla de terminación/entrega/asamblea/captación); en **contabilidad@ se ignora** (privacidad).
La parte (propietario / arrendatario / interno) y el resumen salen de Gemini (con topes); sin cupo, se usa el extracto de Gmail.

## Drive
`Correos de inmuebles / Inmueble <N°> / <contrato> / <aaaa-mm-dd hhmm - asunto>/` con `correo.html` y los adjuntos. Se comparte con el dominio por enlace (si la política de Workspace lo impide, compartir la carpeta raíz a mano con el equipo; o poner su id en `ARCH_CARPETA_ID`).
El «link que muestra el correo y sus adjuntos» es la carpeta de cada correo. Adjuntos > 20 MB quedan solo en Gmail.

## Puesta en marcha (cuando Felipe lo autorice)
1. Aplicar `sql/124-correos-inmueble.sql` en Supabase (confirmar antes: es producción).
2. En el proyecto de Apps Script del vigilante: pegar `archivo-correos-inmuebles.gs` como archivo nuevo; propiedades `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `EMPRESA_ID` (opcionales `ARCH_BUZONES`, `ARCH_CARPETA_ID`, `ARCH_DESDE`).
3. `contabilidad@` debe quedar dentro de la delegación de todo el dominio (ya vale para todo el dominio con `gmail.readonly`). No está en la lista de buzones excluidos.
4. Ejecutar `verificarArchivo()`, luego `archivarCorreos()` a mano una vez (primera vez lee 60 días), revisar la carpeta de Drive y la pantalla, y entonces `instalarDisparadorArchivo()`.
5. Publicar el front (push a `main` → Netlify) con el mismo orden de siempre.

## Sincronizar con Sedi
Sedi no tiene API para escribir. Cada correo importante deja en la lista el texto listo (≤ 400 caracteres, con fecha real y enlace). Felipe pulsa «Copiar instrucción para Claude» y la pega con Sedi abierto; Claude anota cada seguimiento, **lee de vuelta que quedó escrito** y lo marca hecho. Más automático: una tarea programada en el computador de Felipe (Claude + Chrome) que corra la misma instrucción cada día; requiere que el PC y la sesión de Sedi estén abiertos.
**Por verificar con un caso real antes de escribir en masa:** en qué pantalla de Sedi se anota un seguimiento de contrato/inmueble cuando no hay proceso de terminación abierto (hoy solo vimos seguimientos en Reparaciones locativas y Terminaciones). No se envía ningún correo desde Sedi.

## Pendiente / riesgos
- Probar el lector con red real (no se ha corrido nunca): revisar falsos positivos y el costo de Gemini (comparte cuota con el ruteador).
- Correos de contabilidad@ unidos por dirección pueden incluir facturación: confirmar con Felipe si se quieren o solo contratos/terminaciones.
- El historial de contratos anteriores de un inmueble aparece solo cuando hay correos archivados de esos contratos (hacer una corrida con `archivarDesde('2025/01/01')` si se quiere traer lo viejo).
- Resumen por contrato: se regenera 3 contratos por corrida.
