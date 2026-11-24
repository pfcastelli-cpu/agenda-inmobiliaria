# Plantillas de WhatsApp (Meta): qué son y cuáles crear

**Para qué sirven.** WhatsApp solo deja escribirle libremente a un cliente durante las **24 horas siguientes a su último mensaje**.
Pasado ese tiempo, un asesor (o el bot) solo puede enviar una **plantilla**: un texto fijo, con huecos para datos, que Meta aprueba antes.
La bandeja de la plataforma (WhatsApp → Conversaciones) detecta cuándo se pasó de las 24 h y solo deja enviar una plantilla registrada.

## Cuántas y cuáles (empezar con 3)
Categoría **Utilidad** (más barata y se aprueba más fácil que Marketing). Idioma **Español (es)**. Sin imágenes ni botones al principio.

| Nombre en Meta | Cuándo se usa | Texto (los {{n}} son los datos que se completan al enviar) |
|---|---|---|
| `retomar_conversacion` | El cliente dejó de responder y un asesor quiere retomar | `Hola {{1}}, soy {{2}} de Patrimonios Inmobiliarios. Quedé pendiente de tu consulta sobre {{3}}. ¿Sigues interesado? Respóndeme por aquí y te ayudo.` |
| `seguimiento_visita` | Después de una visita, para saber qué le pareció | `Hola {{1}}, gracias por visitar {{2}} con Patrimonios Inmobiliarios. ¿Cómo te pareció? Si quieres avanzar o ver otras opciones, escríbeme por aquí.` |
| `aviso_asesor_te_escribe` | Un asesor necesita escribirle a quien ya hablaba con el bot | `Hola {{1}}, soy {{2}}, asesor de Patrimonios Inmobiliarios. Estoy atendiendo tu solicitud. ¿Te puedo ayudar por este chat?` |

En Meta, al crear cada plantilla hay que dar **ejemplos** de los datos (p. ej. {{1}} = «Carolina», {{2}} = «Luis», {{3}} = «apartamento en Chapinero»).

## Cómo crearlas (Meta Business Suite)
1. Entrar a **business.facebook.com** con la cuenta que administra el WhatsApp de Patrimonios.
2. Menú **Administrador de WhatsApp** → **Plantillas de mensajes** → **Crear plantilla**.
3. Categoría: **Utilidad**. Nombre: el de la tabla (minúsculas y guion bajo). Idioma: **Español**.
4. Pegar el **Cuerpo** de la tabla, agregar los ejemplos de las variables y enviar a revisión.
5. Meta responde entre minutos y 24 horas. Cuando diga **Aprobada**, registrarla en la plataforma:
   **WhatsApp → Ajustes e interruptor → Plantillas aprobadas por Meta → Añadir plantilla** con el **mismo nombre**, idioma `es` y el mismo texto.
6. Probar desde una conversación de prueba con más de 24 h de antigüedad.

> Reglas de Meta que conviene recordar: no empezar ni terminar la plantilla con una variable; no meter dos variables seguidas; no pedir
> contraseñas ni datos financieros; si se rechaza como «Marketing», se puede volver a enviar mejor redactada o aceptar la categoría.

## ¿Quién las crea?
Se pueden crear a mano (10 minutos cada una) o con ayuda de Claude en el navegador de Felipe (Chrome), con Felipe presente para iniciar
sesión y aprobar cualquier verificación. Claude no escribe contraseñas ni códigos.
