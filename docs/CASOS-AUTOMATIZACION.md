# Casos: automatización con revisión humana (diseño, sin aplicar)

Estado: **solo diseño**. No hay SQL aplicado, ni código nuevo, ni despliegue. Complementa `CASOS-INMUEBLES.md`.

## Principios
1. **Todo en roles, nunca en personas.** Los textos, permisos, avisos y plantillas dicen «coordinación de inmuebles», «administración» o «responsable del caso». Nunca un nombre propio. Quien ocupe el cargo se asigna en la agenda (`responsable_usuario_id`) y puede cambiar cuando quiera. Los saludos y firmas usan el rol y el nombre del usuario que envía en ese momento.
2. **Una persona revisa antes de que algo salga.** Ningún correo, informe ni foto llega a un propietario o arrendatario sin aprobación humana.
3. **Ley 1581.** Se guardan referencias (contrato, copropiedad, unidad, id del hilo de Gmail), no nombres, cédulas, celulares ni correos de clientes ni el texto de los correos. Al propietario nunca se le muestran datos del arrendatario ni al revés. A la IA se envía solo el texto mínimo, sin firmas ni datos personales.
4. **IA barata primero.** Reglas simples → Gemini (puesto «básico») → modelo principal solo si hace falta.
5. **Nada se borra.** Se cierra, se descarta o se archiva.

## 1. Bandeja «Por revisar» (correos)
- Un vigilante lee la bandeja de la coordinación (Gmail API, solo lectura, cuenta de servicio) cada cierto tiempo.
- Cada correo nuevo genera una **propuesta** con: tipo sugerido (terminación, mantenimiento, PQR, asamblea), copropiedad y unidad detectadas, contrato si lo trae, y un resumen corto sin datos personales.
- Cada propuesta explica en lenguaje simple **por qué** se sugirió («Mencionó “entrega del inmueble” y el contrato CT-xxxx»).
- Botones: **Crear caso**, **Agregar a un caso existente** (si el contrato ya tiene uno abierto), **Descartar** (con motivo). Siempre decide una persona.

## 2. Fotos: la persona decide
- Carpeta del caso en Drive: `1-Antes`, `2-Después`, `3-Documentos`. La carpeta dice el significado; el nombre del archivo no importa.
- Las fotos que llegan por correo se **proponen** en una carpeta según el estado del caso. En la agenda cada foto muestra: «Propuesta: ANTES — porque el caso está abierto».
- Botones por foto: **Confirmar**, **Pasar a Antes/Después**, **No va en el reporte**. Hasta confirmar, la foto no sale en ningún informe.
- Cada control lleva una explicación breve («¿Qué es esto?») para que cualquier persona nueva entienda.

## 3. Informe al propietario o arrendatario
Flujo: **borrador → revisión de texto → revisión humana → envío**.
1. Se arma el borrador con datos del caso, fotos confirmadas y un texto sugerido.
2. **Editable por la persona**: textos y fotos (quitar, reordenar, cambiar el título).
3. **Revisión automática, en este orden:**
   - **Ortografía y redacción**: detecta errores, también los que escriba la persona. Si hay errores, **el botón de enviar queda bloqueado** y se marcan en el texto con la corrección sugerida.
   - **Agente jurídico**: avisa si el texto admite culpa, promete plazos o dinero, da una interpretación del contrato, nombra a terceros o expone datos del otro contratante.
   - **Agente de tono**: cálido, amable y claro, en «usted», sin comprometer a la empresa.
   Cada alerta se explica y se puede aceptar o rechazar la sugerencia. Una alerta jurídica **grave** exige confirmación expresa antes de enviar.
4. **Dos botones:** «Enviar a [propietario/arrendatario]» y «Enviarme una prueba» (a la cuenta de quien trabaja). Con `correo_modo_pruebas` activo, todo va al correo de pruebas.
5. Se deja registro en `agenda_casos_reportes` de quién aprobó, cuándo y con qué texto.

## 4. IA con dos puestos
| Puesto | Para qué | Modelo |
|---|---|---|
| Básico | clasificar correos, extraer contrato/unidad, resúmenes, revisión ortográfica | Gemini (económico) |
| Principal | agente jurídico, agente de tono, casos delicados | el que la empresa elija |
- Si un puesto falla o se agota la cuota, pasa al otro. Se registra el consumo por puesto.
- Las claves van en Vault, nunca en el código. Se agrega una **tabla nueva** de configuración (no se toca la de IA actual del SQL 030, que usa otra sesión).
- Para correos reales de clientes, Gemini con facturación activa (la versión gratuita puede usar los datos para entrenar). Se confirma con la cuenta de la empresa qué incluye el plan.

### Reparto de trabajo y respaldo (decidido por el administrador)
- **Gemini:** redactar bien, corregir ortografía y redacción, clasificar correos. Lo que ofrece el plan de Workspace se prueba antes de depender de él.
- **Claude:** todo lo que dé información de inmuebles, contratos o casos, y el agente jurídico.
- **Respaldo cruzado:** si uno falla, se usa el otro y **se avisa a soporte** con `registrarFallo()` (`_shared/fallos.ts`, tabla `agenda_fallos` del SQL 039, que ya existe y solo guarda módulo, código y estado, sin textos). Se reutiliza tal cual, con módulo `casos-ia`.
- **Modelo vigente:** los nombres de modelos cambian. No se escriben fijos: una función de prueba consulta la lista de modelos disponibles de la API del proveedor, elige el recomendado de cada puesto y hace una llamada corta de prueba. El resultado se muestra en el ajuste («modelo activo, probado el día X») y se repite cada semana o con un botón «Probar ahora». Si el modelo elegido deja de existir, cae al siguiente y avisa a soporte.
- **Dónde pegar la clave:** en el ajuste de IA de la agenda (Vault). Para los casos se agrega un campo propio de Gemini; se define al construir.

## Drive
Carpeta creada el 2026-11-25 en la unidad compartida: `3. Reparaciones locativas / CASOS` (id `1odytxgIr31ZezLZ5ZL7rpLkciQ0r2pRy`). Falta dar escritura a la cuenta de servicio solo sobre esa carpeta.

## 5. Orden de construcción
1. Carpetas de Drive + lista de fotos con confirmación humana.
2. Bandeja «Por revisar» con el vigilante de correos.
3. Informe: edición, revisión ortográfica/jurídica/tono, botón de prueba.
4. Diseño del correo (logo, colores, móvil) con maqueta aprobada antes.
5. Aplicar en conjunto con la sesión del bot de WhatsApp, solo con permiso expreso.

## Pendiente de decisión del administrador
- Crear la carpeta `CASOS` en el Drive y dar escritura a la cuenta de servicio solo ahí.
- Clave de Gemini (la pega la persona en el ajuste; no se escribe en chats ni archivos).


## Informes y encuesta de mantenimientos: resultado de las revisiones (25 nov 2026)

Se revisaron con tres agentes (diseño de correo, usabilidad y jurídico/datos personales) y se aplicó lo encontrado.

**Reglas que quedaron**
- El informe NO dice quién paga ni quién hizo el arreglo, ni nombra propietario o arrendatario. Quien lo revisa elige a quién se envía (propietario, arrendatario u otra persona indicada). Esto corrige la falla de Sedi, que lo manda a quien pidió el arreglo.
- La encuesta va normalmente a quien pidió el arreglo: 4 preguntas (arreglo, puntualidad, trato, orden) y un comentario opcional. Sin costos ni datos de otras personas. Es voluntaria y trae aviso de tratamiento de datos.
- Pie legal en cada correo (responsable, política, derechos). El lema se deja en el pie por decisión de marca (el agente jurídico sugirió quitarlo).
- Enlaces: solo https o rutas del propio sitio. Nunca javascript: ni data:.
- Revisión de textos: BLOQUEAN solo datos personales y riesgo jurídico (promesas, culpables, quién paga). Ortografía, redacción y tono son avisos y se puede enviar de todos modos marcando la casilla. La revisión local es básica; la completa irá con IA antes de cada envío.
- Nada se manda sin que una persona lo apruebe. El modo de pruebas sigue activo.

**Diseño y compatibilidad**
- Tablas y estilos en línea (Outlook de escritorio), fondo en la celda de botones y números, modo claro forzado, encabezado con foto (sin repetir logo), botones de 44 a 56 px, una columna en celular.
- Probado en el panel del navegador a 390, 768 y 1100 px: sin desborde horizontal y sin imágenes rotas. No se ha probado en Outlook real ni en Gmail móvil; falta enviar una prueba real.
- Pantalla de edición: en celular hay pestañas Editar / Vista previa y barra fija con Enviar y Enviarme una prueba; el motivo por el que Enviar está desactivado se ve escrito.

**Pendiente**
- La encuesta en página aún no guarda respuestas (falta el endpoint con token de un solo uso).
- Confirmar con Sedi si seguirá enviando su propio correo a quien pidió el arreglo.
- Enviar el correo de prueba real a la dirección de pruebas antes de activar nada.


## Cartas de terminación y control de comunicaciones (26 nov 2026)

Revisadas por tres agentes (jurídico, psicología/servicio y diseño/usabilidad). Se leyeron las cartas históricas de Drive: eran frías («entrega unilateral por parte de ustedes», «perentoria») y no había ninguna de aviso a tiempo con invitación a mostrar el inmueble.

**Qué hay**
- Tres cartas editables con membrete: entrega a tiempo, contrato prorrogado y aviso al propietario (código: `aplicacion/js/casos-cartas.js`). El saludo es genérico; el nombre real lo pone el envío real.
- Panel «Comunicaciones» en la ficha de la terminación (`casos-comunicaciones.js`): frase de «qué falta», botón sugerido según la clasificación del caso, editor por párrafos (los opcionales se pueden apagar), revisión, vista previa, «Enviarme una prueba», envío con confirmación («Se enviará al ARRENDATARIO. ¿Confirma?») e historial con la copia exacta de cada correo.
- Tabla `agenda_casos_comunicaciones` (en `sql/120`, sin aplicar): guarda asunto, copia del correo, estado (borrador/enviada/prueba), decisión del propietario, quién aprobó y vínculo con el aviso anterior. Un índice evita enviar dos veces la misma carta; un reenvío queda como «Recordatorio» ligado al original.

**Correcciones jurídicas importantes** (fuente leída: normograma de la Ley 820 de 2003; lectura por resumen automático, falta cotejo del abogado)
- La prórroga es por un término igual al inicialmente pactado, no «por un año».
- La indemnización de 3 cánones por terminar antes con preaviso es legal (art. 24 num. 4 y art. 25), no solo contractual; el arrendatario conserva esa salida aunque el aviso sea extemporáneo.
- Sin promesas («no hay ningún riesgo», «siempre»), sin culpa, sin presión. La entrega anticipada solo con aprobación del propietario y acuerdo escrito. Las visitas son voluntarias y con aviso.
- Pie jurídico en cada carta.

**Decisiones de diseño**
- Los botones del propietario abren una página de confirmación con token de un solo uso; la decisión se guarda solo al pulsar «Confirmar» (los antivirus de los correos abren los enlaces y no deben registrar un «acepta» falso). Falta construir esa página y la función de envío.
- La revisión de textos tiene perfil «carta»: no bloquea la palabra propietario/arrendatario, pero sí cédulas, correos y teléfonos con número.

**Pendiente antes de usarlo con clientes**
1. Un abogado humano coteja los arts. 6, 22, 24 y 25 con el texto oficial y el medio de notificación pactado en cada contrato.
2. Construir la función de servidor `enviar-comunicacion-caso` (envía desde solicitudes@, pone el nombre real, guarda la fila) y la página de decisión del propietario.
3. Traer la fecha de vencimiento del contrato desde Sedi (hoy la lista no la trae y la carta queda con un hueco que bloquea el envío).
4. Seguimiento sugerido (psicología): llamada de cortesía al día 2 o 3 sin respuesta; un recordatorio breve al día 5 a 7; no más de dos.

## 27 nov 2026 · Cartas corregidas y línea de tiempo
**Modelo de cartas (corregido).** El propietario NO autoriza «mostrar el inmueble». Autoriza (1) buscar nuevo arrendatario y (2) proponer al arrendatario un acuerdo de terminación anticipada por mutuo acuerdo (art. 21 Ley 820 de 2003), con traslapo. El arrendatario elige: acuerdo o esperar al vencimiento. Si se arrienda, plazo prudencial de {plazoSemanas} semanas (por defecto 2) desde la firma del nuevo contrato. La inmobiliaria solo «propone, sujeto a aprobación del propietario y acuerdo escrito firmado»; nunca promete ni renuncia a indemnización (decisión del propietario). Botones del propietario: «Sí, autorizo buscar nuevo arrendatario» / «Prefiero que me llamen» / «No autorizo por ahora». Pendiente: el abogado redacta el acuerdo de terminación anticipada y coteja arts. 3, 6, 16, 21, 24, 25.
**Línea de tiempo** (`casos-linea-tiempo.js`): une seguimientos, cartas, pruebas (ocultas por defecto, marcadas «no llegó al cliente»), decisiones del propietario, archivos y cola de Sedi; filtros, búsqueda, detalle con copia exacta de la carta. Sin datos personales.
**Seguimientos estructurados (hecho en código, 28 nov 2026, `sql/121` sin aplicar):** formulario con tipo de contacto, resultado, próximo paso y fecha (`casos-seguimientos.js`); la línea de tiempo los muestra; a Sedi sigue yendo un solo texto compuesto (máx. 400). Si la base aún no tiene las columnas, guarda solo el texto. Falta: aplicar el SQL con permiso, probar en el navegador y usar `proxima_fecha` en la pantalla «Hoy».
**Backlog de usabilidad (agentes), en orden:** ~~seguimientos estructurados~~ · ~~tabla de eventos con trigger~~ (hecho en código, 28 nov 2026: `sql/122` sin aplicar registra estado, prioridad, fecha límite y responsable; la línea de tiempo los muestra y, sin el SQL, simplemente no aparecen) · ~~mantenimiento con estados de Sedi~~ (28 nov 2026: leídos del filtro Estado de Reparaciones locativas en SEDI, ruta Inmobiliaria → Reparaciones locativas → Centro de gestión: Propietario, Sin cotización, Pendiente cotizar, En ejecución, En encuesta, Finalizada, Cotizado; son 7, no 11. La columna «En proceso» de Sedi es un texto aparte: «Espera realización propietario», «Proceso de cotización - proveedor», «Pendiente autorización cotización», «Cotizado, Espera aprobación del propietario». Se agregaron «Nuevo» y «Descartado» solo de la agenda; falta confirmar con Felipe si «11» contaba esas subetapas) · ~~cierre de terminación completo~~ (28 nov 2026, `casos-cierre.js`, sin SQL nuevo, guarda en `datos`: quién recibió —propietario, inmobiliaria u otra persona autorizada— y cobro por terminación anticipada —pendiente, cobrado, exonerado por el propietario, no aplica—; la pantalla no deja cerrar con el cobro pendiente. Sugerencia según la clasificación, que decide la persona. No se calcula el valor del cobro ni la retención del depósito, y la regla de cierre aún no está en el servidor) · bloque de retención con propuestas numeradas · pantalla «Hoy / vence esta semana» (con festivos) · PQR con vista tablero y vencimiento · formularios completos · panel de comunicaciones para mantenimiento · avisos automáticos · exportar/imprimir la línea de tiempo.
