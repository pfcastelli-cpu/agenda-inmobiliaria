# Mantenimientos: proceso simple (propuesta, sin aplicar)

Estado: **diseño para aprobar**. No hay código ni SQL de esto. Nació de la revisión de proceso/usabilidad y de la jurídica del 28 nov 2026.
Las citas legales salen de memoria del agente (no se pudo leer el texto oficial): **las cota un abogado**.

## Idea
Cada caso responde tres preguntas: **¿qué sigue?, ¿quién tiene el turno?, ¿desde cuándo?** La persona ve 5 etapas; los estados de SEDI quedan por debajo.
Etapas: 1 Recibido → 2 Definir a quién corresponde → 3 Cotizar y aprobar → 4 Ejecutar → 5 Cierre (informe + encuesta).

## Pasos y estado de SEDI
1. **Recibido.** Acuse de recibo al solicitante. (Agenda: Nuevo; SEDI aún no existe.)
2. **A quién corresponde** (decisión interna, con motivo en una frase y evidencia): por uso/mal uso → arrendatario; no es por uso → propietario. Siempre «según la revisión preliminar».
3. **Camino propietario:** se le informa primero y se le pregunta: «¿envía su propio personal o autoriza proveedor?»
   - Propio → **arreglo propio** (SEDI: Propietario; se marca «Arreglo propio»; una fecha estimada y confirmación de «quedó listo»).
   - Proveedor → cotiza (SEDI: Pendiente cotizar) → se informa/aprueba el valor (SEDI: Cotizado; «Autoriza cotización»).
4. **Camino arrendatario:** se le informa con evidencia, causa preliminar, valor y plazo para responder (3 a 5 días hábiles). Si discrepa, queda «controvertido» y pasa a revisión humana; no se carga solo.
5. **En ejecución** (SEDI: En ejecución).
6. **Cierre:** informe revisado (a quien la persona elija) y encuesta voluntaria al solicitante (SEDI: En encuesta → Finalizada).

La columna «En proceso» de SEDI casi repite el estado; la agenda la deriva sola, no es un campo aparte.

## Reglas jurídicas para el sistema (a cotejar por abogado)
1. No se cobra al arrendatario sin evidencia, causa, valor, notificación escrita y plazo de respuesta registrados.
2. La clasificación siempre dice «preliminar»; la inmobiliaria informa, no decide.
3. No se envía proveedor a cargo del propietario sin su aprobación del valor, salvo urgencia definida en el mandato. El silencio no es aprobación.
4. Ningún correo lleva datos personales de la otra parte.
5. Encuesta opcional, con enlace a la política de datos.
6. Cobro controvertido se detiene.
7. Toda decisión queda con fecha, autor y el texto exacto enviado.
8. Frases prohibidas: «usted es responsable», «se descontará del canon» como hecho, «si no responde se entiende aceptado», amenazas de desalojo o de centrales de riesgo, fechas firmes.

## Sincronización con SEDI
- SEDI es la fuente del estado. La agenda escribe solo si SEDI sigue igual a como se leyó; si no, queda «conflicto: revisar».
- Datos del solicitante y de quien autoriza: SEDI los exige y la agenda no los guarda. Hay que probar si SEDI los trae con el contrato.
- «Descartado» y «Nuevo» no existen en SEDI: definir qué se hace allá.
- SEDI manda su propio correo de informe/encuesta: decidir si se apaga o se coordina, para no duplicar.
- Mostrar «última sincronización».

## Decisiones del administrador (28 nov 2026)
1. **Quién decide «uso o no uso»:** la IA lo revisa con base en normas, decretos, sentencias, la Ley 820 de 2003 y lo ocurrido, y da su **opinión** al arquitecto; el arquitecto o coordinador de inmuebles (persona) es quien **confirma** o no. Sin esa confirmación no se envía proveedor a cargo de nadie (salvo urgencia).
2. **Valor mínimo:** no existe, pero es buena idea. Se deja como ajuste de la empresa (tope bajo el cual solo se informa al propietario). Valor por definir.
3. **Urgencias primero** (fuga de gas, fuga de agua, riesgo eléctrico): se atienden de inmediato y no esperan cotización ni confirmación. Los inmuebles con plan premium, black o platino tienen **póliza hogar**: en esos casos se avisa de inmediato al seguro para que entre a solucionar. Lo normal es que el arquitecto intente que el proveedor cotice de forma virtual; si no alcanza, el proveedor va a verificar.
4. **Sincronización:** se escribe en SEDI también, al mismo tiempo y sin desfase. Ideal lo más automático posible: apenas entra el correo ya se ve aquí y después se refleja en SEDI. Se usará el Claude de Felipe para ejecutar la sincronización por navegador (cola `agenda_sedi_cola`).
5. **Correo propio de SEDI:** no se apaga. Todo se guarda también en SEDI, pero **el informe y la encuesta no se envían desde SEDI**: salen de nuestro sistema con nuestros parámetros. Hay que cuidar qué se escribe en SEDI porque el cliente puede leerlo.
6. **Datos de SEDI:** trae solo al propietario o arrendatario que solicitó la cotización, o como máximo a los codeudores; puede haber varios propietarios. La agenda sigue sin guardar nombres.
7. **IA de redacción:** Gemini revisa ortografía y redacción de los informes. Habrá una sección de configuración para decidir cómo contesta la IA (qué tan amable, qué tan firme), con revisión psicológica y de los agentes que haga falta, para mantener muy buen servicio sin dejar que carguen a la empresa con lo que no le corresponde (que la empresa no pierda dinero).

## Avance (28 nov 2026)
- **Hecho en código** (`casos-mantenimiento.js`, sin SQL): tarjeta «Qué sigue / turno / desde cuándo» con barra de 5 etapas; clasificación (a quién corresponde, motivo, urgencia, póliza de hogar, seguro avisado, arreglo propio, proveedor enviado, confirmada por arquitectura). La pantalla no deja pasar a Pendiente cotizar, Cotizado o En ejecución sin clasificación confirmada, salvo urgencia. Una urgencia con póliza muestra «AVISAR YA al seguro». Probado en la demo.
- **Límite conocido:** hoy cualquier coordinador puede marcar «Confirmada por el arquitecto o el coordinador de inmuebles»; falta un permiso propio para ese rol y que el cambio quede en el historial (el trigger del SQL 122 no mira `datos`).
- **Orden siguiente:** (1) ajuste de cómo contesta la IA (amabilidad/firmeza) y revisión de ortografía y redacción con Gemini en los informes; (2) opinión de la IA sobre «a quién corresponde» con base en la Ley 820 y jurisprudencia, para el arquitecto; (3) cola de sincronización con SEDI en los dos sentidos; (4) informe y encuesta desde nuestro sistema, no desde SEDI. Los puntos 1 y 2 necesitan una función de servidor y la clave de Gemini en Vault (la pega la persona en el ajuste).

## Decisiones pendientes del administrador (anteriores)
1. ¿Quién decide «uso o no uso» y con qué evidencia (fotos)?
2. ¿Hay un valor bajo el cual no se pide aprobación al propietario, y qué pasa si no responde en X días?
3. ¿Siempre se cotiza antes de enviar proveedor, o hay urgencias que se atienden primero?
4. ¿SEDI manda siempre en caso de conflicto, y al principio solo se lee de SEDI?
5. ¿Se apaga el correo propio de SEDI para informe y encuesta?

## Avance 2 (28 nov 2026): IA y prueba local
- **Ajustes de IA** (pestaña «Ajustes de IA» en Casos, `casos-ia.js`): amabilidad, firmeza, protección de la empresa e instrucciones propias, con un ejemplo en vivo de cómo sonaría. Tabla `agenda_casos_ia_ajustes` en `sql/123` (sin aplicar; solo el administrador cambia, quien gestiona casos lee).
- **Función `revisar-redaccion-caso`** (escrita, **sin desplegar**, lleva JWT): modo `redaccion` (ortografía y redacción de informes/cartas) y modo `clasificacion` (opinión preliminar sobre a quién corresponde, con normas «a verificar»; prohíbe inventar sentencias; la confirma el arquitecto o el coordinador de inmuebles). Usa la clave de IA de la empresa (Vault, SQL 028) con el proveedor y modelo configurados; si falla, registra un fallo técnico (`casos-ia`) y la pantalla usa la revisión local.
- **Botón «Pedir opinión de la IA»** en la clasificación de mantenimientos. Antes de enviar nada a la IA se revisa que no haya datos personales.
- **Falta:** conectar la revisión con IA al editor de informes y cartas; cola de sincronización con SEDI en los dos sentidos; informe y encuesta desde nuestro sistema; permiso propio para «confirmar». En la demo la IA es simulada y está marcada así.
- **Prueba local:** `Probar-casos-en-local.bat` (en la carpeta del proyecto de Casos) abre http://localhost:5196/aplicacion/casos-demo.html con datos de ejemplo en memoria.
