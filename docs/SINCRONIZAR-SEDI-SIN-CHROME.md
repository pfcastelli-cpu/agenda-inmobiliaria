# Sincronizar con Sedi sin tener Claude abierto

Hoy la cola `agenda_sedi_cola` la ejecuta Claude desde el Chrome de Felipe (extensión Claude in Chrome). Funciona, pero necesita el computador encendido, Chrome abierto, la sesión de Sedi activa y a Claude trabajando. Sedi no tiene API para escribir. Estas son las opciones para que el botón «Sincronizar ahora» funcione solo.

## Lo que se verificó (nov 2026)
- **Gemini** tiene un modelo y herramienta de «Computer Use» que maneja un navegador con Playwright (modelo `gemini-2.5-computer-use-preview-10-2025`, en vista previa; hay una versión nueva en la API «Interactions», en beta; la doc recomienda un entorno aislado). Fuente: ai.google.dev/gemini-api/docs/computer-use.
- **Claude** tiene la herramienta «browser use» en la API. La aplicación propia es la que ejecuta el navegador (Anthropic no presta el navegador) y no está disponible en Managed Agents. Se puede conectar a un navegador en la nube (por ejemplo Browserbase o Browserless). Fuente: platform.claude.com/docs (browser use tool).
- No se verificó nada sobre programar ejecuciones con horario en esos servicios: eso lo resuelve nuestro propio disparador.

## Opciones
| | Cómo funciona | Ventajas | Límites |
|---|---|---|---|
| **A. Como hoy** (Claude in Chrome) | Claude opera el Chrome de Felipe | Ya funciona | PC y Claude abiertos |
| **B. Robot en el PC de Felipe** | Script Playwright programado en Windows | Barato, sin IA | PC encendido |
| **C. Robot en la nube (recomendada)** | Un servidor pequeño ejecuta un script Playwright sin pantalla; el botón crea tareas en la cola y el robot las toma | Funciona 24/7, rápido, casi sin costo de IA | Hay que mantenerlo; Sedi puede pedir verificación |
| **D. IA con navegador** (Gemini o Claude) | La IA mira la pantalla y hace clic | No necesita escribir selectores | Lenta (minutos por tarea), cuesta tokens cada vez, menos exacta en formularios |
| **E. Pedirle a Sedi** | API de escritura o importación por archivo | Lo más estable | Depende de Sedi |

## Recomendación
**C + D como respaldo, y pedir E en paralelo.**
1. Robot en la nube con script fijo para las 4 acciones que ya hacemos (crear, seguimiento, cambiar estado, adjuntar). Es lo más rápido y barato.
2. Si un paso falla porque Sedi cambió una pantalla, el robot llama a la IA con navegador (Gemini primero, Claude de respaldo, como en el resto del sistema) para terminar esa tarea, y deja una alerta al soporte (tabla `agenda_fallos`).
3. Preguntar a Sedi si ofrece API de escritura, importación masiva o un usuario de integración.

## Cómo se inicia sesión sin guardar la contraseña
- Felipe inicia sesión **una vez** en la ventana del robot (yo nunca escribo contraseñas). El robot guarda la sesión (cookies) en su perfil y la reutiliza.
- Cuando la sesión caduque, el robot se detiene, avisa («Sedi pide iniciar sesión») y espera. No reintenta con contraseñas.
- Si Sedi permite un **usuario propio para el robot**, es mejor que usar el de Felipe: no lo desconecta y queda un registro aparte.

## Reglas de seguridad
- Primero en modo «ensayo»: el robot muestra lo que haría y una persona aprueba; luego automático por tipo de acción.
- Cada tarea es idempotente (la cola marca `en_proceso`, `hecho`, `error`) y no repite una tarea ya hecha.
- Se detiene ante pantallas inesperadas, verificación en dos pasos o captcha. No los evade.
- Solo escribe lo que está en la cola; nunca lee ni exporta datos de clientes a otros sitios.
- Confirmar con Sedi que su uso permite automatizar el acceso.

## Pasos para construirlo
1. Probar en el PC de Felipe con Playwright y sesión guardada (validar las 4 acciones en un caso de ensayo).
2. Empaquetar el robot (contenedor) y ponerlo en un servidor pequeño (unos 5 a 10 dólares al mes) o en un trabajo programado en la nube.
3. Botón «Sincronizar ahora»: crea/activa la tarea; el robot revisa la cola cada pocos minutos o cuando lo llaman.
4. Alertas y registro en `agenda_fallos`.
5. IA de respaldo (Gemini → Claude).

## Lo que necesita decidir Felipe
- ¿Servidor en la nube o un PC que quede siempre encendido?
- ¿Se puede pedir a Sedi un usuario de integración y preguntar por 2FA, API o importación?
