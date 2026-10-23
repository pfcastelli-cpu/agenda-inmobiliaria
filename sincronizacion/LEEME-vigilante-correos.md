# Vigilante de correos — puesta en marcha

Script: `sincronizacion/vigilante-correos.gs`. Va en un proyecto de Apps Script **nuevo**, aparte
del ruteador y del de sincronización. Tiempo estimado: 20–30 minutos, una sola vez.

## Qué hace
Lee (solo lectura) los buzones que pongas en `BUZONES` (hoy: `solicitudes@`, `info@`, `soporte@`, `publicidad@`, `asesorbqa@` y `asesor1@`) y anota en
una hoja los correos de **terminación / no renovación de contrato, entrega de inmueble, asamblea y
captación**: de quién, fecha, asunto, resumen, inmueble y contrato (si lo deduce del correo del
arrendatario o del número de contrato), y el enlace al correo original. **Solo revisa los últimos 3 meses**
(propiedad `DESDE` para cambiarlo a mano) y luego revisa cada 15 minutos.

**Historial de cada conversación (pestaña "Hilos").** Para cada terminación o entrega lee TODOS los mensajes de
la conversación y deja una fila con el **estado vigente**: terminación solicitada, entrega programada,
**prórroga**, **entrega cancelada**, entregado, y la fecha de entrega que vale hoy, más una línea de tiempo de los
cambios. Si hay prórroga, nueva fecha o cancelación, manda el mensaje más reciente. Una vez al día vuelve a mirar
las que siguen abiertas, porque una respuesta como "perfecto, la corremos" puede no traer palabras clave.

**Qué NO revisa:** citas (invitaciones de calendario y "Citas Bogotá/Barranquilla/Medellín"), correos de
Ciencuadras, Metrocuadrado, Fincaraíz y Properati, notificaciones automáticas (Sedi, Google, bot de WhatsApp,
avisos del ruteador) y buzones de administradores.

**Cuánto cuesta (muy poco).** Gmail filtra por palabras clave en los servidores de Google, así que solo se leen los
correos que pueden importar. Gemini se usa solo para: (1) el estado vigente de conversaciones con señales de cambio y
(2) un resumen por conversación, **solo de correos entrantes**, con el modelo más barato disponible (se detecta solo),
tope de 12 llamadas por corrida y 150 por día, y pausa de una hora si Google responde "sin cuota" (la clave se
comparte con el ruteador de `info@`: lo ideal es una clave propia en otro proyecto).

Qué garantiza para que no se pierda nada (candado: dos corridas nunca se pisan; si se acaba el tiempo, sigue justo donde quedó):
- Lee **cada buzón directamente**: no depende de que alguien reenvíe a `info@`.
- Hoja **Cobertura**: en cada corrida anota cuántos mensajes vio por buzón frente al total del buzón.
- Si una corrida falla, llega un correo. Si deja de correr más de 3 horas, llega otro (vigilancia).
- Resumen diario a las 7 a. m., una línea por conversación (sin repetidos): sin respuesta nuestra, novedades de
  24 h y cambios de estado, con enlace a la fila de la hoja. Si no hay nada, no llega correo.
- Es amplio a propósito: prefiere anotar de más y descartar a mano que perder un correo.

Qué **no** hace: no marca, mueve ni borra correos (permiso `gmail.readonly`), no lee buzones que no
estén en la lista, rechaza los de administradores (Felipe, Gino, Ángela) aunque se pongan, y no
guarda el cuerpo completo de los correos.

## Paso 1 — Cuenta de servicio (Google Cloud)
1. Entra a https://console.cloud.google.com con `pf.castelli@patrimonios.co`. Puedes usar el mismo
   proyecto de tu clave de Gemini o crear uno nuevo ("Vigilante de correos").
2. **APIs y servicios → Biblioteca →** busca **Gmail API → Habilitar**.
3. **IAM y administración → Cuentas de servicio → Crear cuenta de servicio.** Nombre:
   `vigilante-correos`. No le asignes roles. Listo.
4. Abre esa cuenta → pestaña **Claves → Agregar clave → Crear clave nueva → JSON**. Se descarga un
   archivo `.json`. *Si dice que la política de la organización no permite crear claves:* en
   **IAM y administración → Políticas de la organización** busca
   `iam.disableServiceAccountKeyCreation` y desactívala para este proyecto (eres super administrador).
5. En **Detalles** de la cuenta de servicio, copia el **ID único** (un número largo). Lo usas en el
   paso 2.

## Paso 2 — Autorizarla en Workspace (consola de administración)
1. https://admin.google.com → **Seguridad → Control de acceso y de datos → Controles de API →
   Administrar la delegación en todo el dominio → Añadir nueva.**
2. **ID de cliente:** el número del paso 1.5. **Ámbitos de OAuth:**
   `https://www.googleapis.com/auth/gmail.readonly` → **Autorizar.**

## Paso 3 — Apps Script
1. https://script.google.com → **Nuevo proyecto** → llámalo "Vigilante de correos". Pega todo el
   contenido de `vigilante-correos.gs`.
2. **⚙️ Configuración del proyecto → Propiedades del script**, agrega:

| Propiedad | Valor |
|---|---|
| `SA_EMAIL` | El correo de la cuenta de servicio (termina en `.iam.gserviceaccount.com`) |
| `SA_PRIVATE_KEY` | El campo `private_key` del JSON, completo, desde `-----BEGIN PRIVATE KEY-----` hasta `-----END PRIVATE KEY-----`, tal cual aparece (con los `\n`) |
| `BUZONES` | `solicitudes@patrimonios.co,info@patrimonios.co,soporte@patrimonios.co,publicidad@patrimonios.co,asesorbqa@patrimonios.co,asesor1@patrimonios.co` (separadas por coma; si se pegan sin coma también las entiende) |
| `GEMINI_API_KEY` | Tu clave de Gemini (opcional: sin ella funciona con reglas, sin resumen) |
| `HOJA_ARRENDADOS_ID` | `11bwWCu-2H6gtPkRpiNWmqsjjwOmN-MNp3fjB434MouM` (para deducir el inmueble por el correo del arrendatario) |
| `ALERTA_A` | Opcional. Por defecto `pf.castelli@patrimonios.co` |
| `DESDE` | Opcional (`aaaa/mm/dd`). Por defecto, 92 días atrás (unos 3 meses) |

3. Ejecuta **`verificarConfiguracion`** (te pedirá autorizar el script la primera vez). Debe decir
   "OK" por cada buzón con su cantidad de mensajes. Si un buzón da error 401/403, revisa el paso 2.
4. Ejecuta **`iniciarHistorico`**. Recorre los últimos 3 meses y se reanuda solo cada minuto hasta terminar
   (puede tardar un rato según el tamaño de los buzones). `probarGemini` comprueba la clave y muestra qué modelo se eligió.
5. Ejecuta **`instalarDisparadores`** para que quede corriendo solo.
6. Se crea una hoja **"Vigilante de correos — Patrimonios"** en tu Drive (el enlace sale en el
   registro de ejecución). Avísale a Claude y la lee desde ahí.

## Seguridad
- El archivo `.json` es una llave que puede **leer** esos buzones. No lo compartas ni lo pegues en
  ningún chat. Después de pegarlo en las propiedades, guárdalo en un lugar privado o elimínalo.
- Comparte el proyecto de Apps Script solo contigo.
- Si algo se filtra: en Google Cloud elimina la clave de la cuenta de servicio, o en la consola de
  administración quita la delegación. Con cualquiera de las dos el acceso se corta al instante.

## Búsquedas puntuales
`rastrearPalabra("solicitudes@patrimonios.co", "Linda Ortiz")` anota en la pestaña **Busqueda** todos
los correos de ese buzón (desde `DESDE`) que mencionen ese texto.
