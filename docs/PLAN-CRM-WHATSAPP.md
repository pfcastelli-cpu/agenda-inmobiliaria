# Plan: mini-CRM sobre WhatsApp (diseño, sin construir)

Estado: solo diseño (24-nov). Nada de esto existe aún en la base ni en el código.

## Hallazgo clave (CORREGIDO por Felipe, 24-nov: ver sección "Modelo SEDI y correo" al final, que reemplaza lo de contratos)
No existen tablas de contratos, propietarios ni personas. Hoy `agenda_arrendatarios` guarda una fila por inmueble, sincronizada desde una hoja; no guarda histórico. El modelo real (SEDI, software contable) es más rico: ver el final de este archivo.

## Tablas nuevas (todas con empresa_id, RLS con `whatsapp.ver`, escritura por RPC/Edge Function)
- `agenda_crm_vinculos`: conversación ↔ inmueble / arrendatario / cita (origen regla, ia o manual; confianza; confirmado).
- `agenda_crm_resumenes`: resumen vigente con histórico, intención, sentimiento, compromisos y pendientes (jsonb), marca de agua del último mensaje resumido, modelo y tokens.
- `agenda_crm_tareas`: compromisos y pendientes como filas (responsable, vence_el, estado abierta/hecha/descartada) para tablero.
- Fase 3: `agenda_crm_personas`, contratos y propietarios.

## Vinculación (de lo barato a lo caro)
1. Regex sobre mensajes (`/inmuebles/N`, "inmueble N" con palabra clave).
2. Inmuebles que el bot mostró con `buscar_inmuebles`.
3. Teléfono contra citas y arrendatarios.
4. Propuestas de la IA (sin confirmar) y vínculo manual (gana siempre). Confianza < 0.8 queda como "sugerido".

## Resúmenes con IA
- Disparadores: al marcar resuelta, botón "Resumir ahora" y (fase 2) por inactividad.
- Incremental: resumen anterior + mensajes nuevos; modelo barato; no resume pruebas ni menos de 3 mensajes; tope diario por empresa.
- No guardar cédulas, cuentas, claves, datos sensibles ni de menores (prompt + limpieza por regex).

## Pantallas
Pestaña "WhatsApp" en la ficha del inmueble; tablero de pendientes (Vencidos / Hoy / Semana / Sin fecha); línea de tiempo por persona (fase 3).

## Habeas Data (Ley 1581/2012)
Aviso de privacidad en el primer mensaje, política de retención por escrito (consultar abogado), función para suprimir por teléfono, constar que se envía contenido a Anthropic.

## Fases
1. Vínculos + resúmenes + tareas, al resolver y bajo demanda; ficha del inmueble.
2. Cron por inactividad, tablero con vencimientos, vínculo automático por teléfono, tope de gasto, permiso `whatsapp.gestionar`.
3. Personas, contratos/propietarios, retención automática, supresión, avisos de tareas vencidas.

## Decisiones pendientes de Felipe
1. ¿Contrato = (inmueble + arrendatario vigente) por ahora? (recomendado)
2. ¿Quién ve resúmenes/tareas y quién las marca hechas?
3. ¿Cuánto tiempo se guardan las conversaciones? (consultar abogado)
4. ¿Resumen solo al resolver/bajo demanda, o también por inactividad (cuántas horas)?
5. ¿Tope mensual de gasto en IA y modelo?
6. ¿Vínculos automáticos de baja confianza esperan confirmación? (recomendado)
7. ¿Autoriza enviar el contenido de las conversaciones a Anthropic para resumir?

## Modelo SEDI y correo (definido por Felipe, 24-nov) — REEMPLAZA lo anterior sobre contratos
Regla de negocio (así funciona SEDI, la plataforma debe espejarlo):
- Un inmueble tiene 1..N propietarios (con su participación).
- Un inmueble puede arrendarse muchas veces: 1..N contratos en el tiempo, pero SOLO UNO vigente.
- Cada contrato tiene 1..N arrendatarios y 0..N codeudores.
- Los datos salen de SEDI hacia la hoja "inmuebles arrendados" (Sheets); la plataforma los lee de ahí (o de SEDI directo si existe API/MCP; por verificar).

### Tablas (propuesta)
- `agenda_crm_personas`: una por ser humano/empresa (nombre, documento solo como hash para cruzar, correos[], teléfonos[] normalizados).
- `agenda_crm_inmueble_propietarios` (inmueble, persona, % participación, desde/hasta).
- `agenda_crm_contratos` (id SEDI, inmueble, fecha inicio/fin, canon, estado). Índice único parcial: un solo contrato "vigente" por inmueble.
- `agenda_crm_contrato_partes` (contrato, persona, rol arrendatario|codeudor).
- `agenda_crm_eventos`: línea de tiempo única (tipo whatsapp|correo|cita|nota|llamada, persona, inmueble, contrato, fecha, resumen, enlace al original). Todo lo demás (resúmenes, tareas) cuelga de aquí.
- Sincronización por script (Apps Script ya existente en `sincronizacion/`) hoja → tablas; idempotente, conserva histórico de contratos.
- Una persona puede ser propietaria en un inmueble y codeudora en otro: el rol se deduce de las relaciones, no se guarda en la persona.

### Resolución de identidad
Teléfono o correo → persona → roles → inmuebles/contratos. Con eso, cada WhatsApp o correo queda automáticamente en el inmueble y contrato correctos ("Marta: propietaria del 645, codeudora del contrato 812"). Si no coincide nada: bandeja "Por clasificar" y la IA propone con candidatos; confianza baja = confirma un humano.

### Correos
- Cada usuario registra su correo corporativo (consentimiento explícito, solo dominio de la empresa). Lectura SOLO LECTURA vía Gmail API con cuenta de servicio y delegación de dominio (ver skill leer-correos-empresa-gmail-api); también buzones compartidos (solicitudes@, info@, soporte@).
- Se leen solo hilos con direcciones conocidas (personas) o que mencionen un inmueble; los personales no se tocan. El usuario puede excluir un hilo.
- Se guarda: ids, remitente/destinatarios, fecha, asunto, resumen de la IA y enlace al hilo en Gmail. Cuerpo completo y adjuntos NO se copian (menos riesgo Habeas Data; se abren en Gmail).
- Clasificación en cascada: dirección ↔ persona → código/dirección de inmueble en asunto/cuerpo → Claude con candidatos → "Por clasificar".

### Automatización con Claude
- Ficha 360 antes de llamar o responder: quién es, qué inmuebles/contratos, últimos hilos, compromisos abiertos.
- Borradores de respuesta con todo el contexto (pasan por la misma revisión de normas).
- Detección de compromisos y pendientes en correos y WhatsApp → tareas con responsable y fecha.
- Alertas: contrato próximo a vencer, arrendatario molesto, propietario sin respuesta, hilo sin contestar N días.
- Resúmenes por inmueble y por contrato (histórico completo, incluso de arrendamientos anteriores).

### Fases revisadas
0. Modelo SEDI (personas, propietarios, contratos, partes) + sincronización desde la hoja.
1. Vínculo WhatsApp ↔ persona/inmueble/contrato + resúmenes + tareas + ficha del inmueble.
2. Correo (lectura, clasificación, línea de tiempo unificada) + tablero de pendientes.
3. Ficha 360, borradores, alertas, retención/supresión Habeas Data.

### Pendiente de Felipe
Estructura real de la hoja de inmuebles arrendados (columnas), si SEDI tiene API/MCP directo, qué buzones primero, y los 7 puntos de decisión de arriba (retención, quién ve, tope de gasto, autorización de enviar datos a Anthropic).

## Ajustes de Felipe (24-nov, 2.ª ronda)
- Relaciones muchos a muchos: una persona puede ser propietaria de varios inmuebles Y arrendataria/codeudora de varios (ya cubierto por las tablas de vínculo; nada se guarda en la persona).
- Correo: SIN cuerpo ni adjuntos. Por hilo: enlace que abre Gmail + resumen muy breve (de qué se habla, en qué van, lo último dicho). Lectura periódica (enviados y recibidos) por script/cron, incremental (historyId), que actualiza el resumen del hilo.
- Asambleas: hoy `asambleas.js` solo lee un JSON/CSV exportado de la hoja «Asambleas ensayo» (sin base de datos; Apps Script `vigilante-asambleas.gs` mira correos). Meta: pasarlas a tabla en la base, vinculadas a inmueble/copropiedad y a los propietarios (personas), con estado (detectada, avisada al propietario, asistió/delegó, acta) y alerta si hay una citación sin avisar. Reutiliza la misma lectura de correo.
- Correos de prueba por envío: hoy solo hay un interruptor GLOBAL (correo_modo_pruebas). Falta, en cada lugar donde sale un correo a propietario/cliente/arrendatario (informe del propietario, estudio de mercado, aviso de asamblea, etc.), un botón «Enviarme una prueba» que mande ese mismo correo SOLO al usuario que lo pulsa, con aviso «PRUEBA» y, junto a él, «Reportar problema con este correo» que cree un ticket (tickets.js) con el correo y los datos adjuntos.
