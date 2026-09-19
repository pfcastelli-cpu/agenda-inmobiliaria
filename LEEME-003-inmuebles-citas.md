# Actualización: inventario real y motor de citas (borrador, sin ejecutar)

## Qué es esto
sql/003-inmuebles-citas.sql agrega dos tablas nuevas a Supabase: agenda_inmuebles
(espejo de solo lectura del inventario, hoy alimentado desde tu hoja de Sheets
de Sedi) y agenda_citas (donde van a vivir las reservas reales, reemplazando
al calendario de Google como fuente de verdad — sin quitarte el correo/
recordatorio al cliente, que sigue funcionando, solo que se genera un paso
después de que la cita ya existe en Supabase).

Todavía NO se ha ejecutado en tu Supabase. Ábrelo, revísalo, y córrelo tú
mismo en el SQL Editor cuando estés de acuerdo. Una sola vez, como los
anteriores.

## Sobre la sincronización diaria desde Sheets
Como la API de Sedi hoy solo está conectada a tu sitio web (y la respuesta de
Sedi para conectarla también aquí sigue pendiente de esa reunión), la entrada
de datos temporal es: leer tu hoja de Inmuebles (Google Sheets) una vez al día
y copiar esos datos a agenda_inmuebles en Supabase.

Reglas de esa sincronización, para que tus hojas actuales sigan funcionando
exactamente igual que hoy:
- Es de UNA SOLA VÍA: Sheets → Supabase. Nunca escribe de vuelta en la hoja.
- Solo LEE la hoja (igual que abrir el archivo para consultarlo). No usa
  ninguna función que edite, borre o reordene celdas, filas o columnas.
- No depende de que cambies nada en tu hoja actual: ni columnas nuevas, ni
  macros nuevas, ni permisos distintos a los que ya tiene.
- Si un inmueble desaparece de la hoja en una corrida, no se borra de
  Supabase de inmediato: se marca como "no visto" (visto_en_ultima_sincronizacion
  = false) y solo se da por retirado después de varias corridas seguidas sin
  verlo. Así un error temporal de lectura no borra inventario real.
- Los números con coma decimal (como 4,6281 de latitud) hay que leerlos con
  la API de Sheets (que entrega el número ya interpretado), no copiando el
  texto de la celda tal cual aparece — así se evita el error de redondeo que
  ya vimos.

## Cómo queda la sincronización (decidido: Apps Script, no n8n)
No tienes n8n corriendo y no quieres pagar infraestructura nueva solo para
esto, así que la sincronización va en Apps Script: sincronizacion/sincronizar-inmuebles.gs
en este mismo paquete. Es un proyecto NUEVO en script.google.com, separado
del que ya usan tus macros de citas — no lo toca.

Pasos para dejarlo funcionando (después de correr sql/003 en Supabase):
1. Entra a script.google.com > Proyecto nuevo. Ponle un nombre, por ejemplo
   "Sincronización inventario Sedi".
2. Borra el contenido de Código.gs y pega ahí todo el contenido de
   sincronizacion/sincronizar-inmuebles.gs de este paquete.
3. Revisa la constante NOMBRE_HOJA al inicio del archivo: debe decir el
   nombre exacto de la pestaña de tu hoja de Inmuebles donde están los
   datos (no el nombre del archivo, el nombre de la pestaña abajo).
4. Configuración del proyecto (ícono de engranaje) > Propiedades del
   script > Añadir propiedad de script, y agrega estas tres:
   - HOJA_INMUEBLES_ID: 1glxLgXqLSFEahUP6ekMknWtJZuusLZPPF2bJdcRWovM
   - SUPABASE_URL: https://ykiuuxludyonkhywtmgu.supabase.co
   - SUPABASE_SERVICE_KEY: la clave "service_role" de tu proyecto de
     Supabase (Project Settings > API Keys). Es distinta de la clave
     publishable que ya está en .env.example. Cópiala solo aquí, en
     Propiedades del script — nunca la pegues en el código ni en el chat.
5. En el editor, selecciona la función sincronizarInmuebles en el menú
   desplegable de arriba y presiona Ejecutar. La primera vez te va a pedir
   autorizar permisos (acceso a esa hoja y a internet): acéptalos. Revisa
   en "Ejecuciones" (panel izquierdo) que haya terminado sin errores.
6. Activadores (ícono de reloj, panel izquierdo) > Añadir activador >
   Función a ejecutar: sincronizarInmueblesConAvisoDeError > Basado en
   tiempo > Temporizador de día > elige una hora de madrugada (por ejemplo
   4-5 a.m.). Guardar.
7. Si algún día falla, te llega un correo a pf.castelli@patrimonios.co
   diciendo qué pasó, en vez de fallar en silencio.

Reglas de esa sincronización, para que tus hojas actuales sigan funcionando
exactamente igual que hoy:
- Es de UNA SOLA VÍA: Sheets → Supabase. Nunca escribe de vuelta en la hoja.
  El script solo usa getValues() (leer); ninguna línea usa setValue ni
  parecidos.
- No depende de que cambies nada en tu hoja actual: ni columnas nuevas, ni
  macros nuevas, ni permisos distintos a los que ya tiene. Si algún día
  cambian los encabezados de las columnas, el script se detiene con un
  error claro en vez de guardar datos mal ubicados.
- Si un inmueble desaparece de la hoja en una corrida, no se borra de
  Supabase de inmediato: queda con veces_no_visto = 1, 2, 3... y solo se
  marca disponible = false al llegar a 3 corridas seguidas sin verlo (o
  sea, unos 3 días). Un error de un solo día no borra inventario real.
- Los números con coma decimal (como la latitud 4,6281) se leen con
  getValues(), que ya entrega el número interpretado — el mismo problema de
  redondeo que tuve yo leyendo la hoja por fuera no aplica aquí.

## Verificación
Sin pruebas todavía. Esta migración no se ha corrido contra tu Supabase real.
Las tablas quedan vacías hasta que exista el trabajo de sincronización (aparte
de este archivo) y hasta que se creen citas reales desde la aplicación.

## Lo que todavía no incluye esta entrega
El algoritmo de prioridad (por comisión) y de agrupación por zona/traslados
todavía no está escrito. agenda_citas es solo la tabla; la lógica que decide
qué horarios ofrecer va en el siguiente paso.
