# Plan: bot de WhatsApp dentro de la plataforma (con interruptor)

Revisado el 24-nov-2026 a partir del proyecto de Apps Script «Script Whatsapp» (4 archivos: Código ≈10.500 líneas,
Herramientas ≈5.750 de pruebas y diagnósticos, Promts ≈1.000, Empresa ≈215). No se copió ningún secreto a este repo.

## Cómo funciona hoy (Apps Script)
- Meta llama al `doPost` del Apps Script. Ahí se filtran duplicados, números bloqueados, reacciones, audios, fotos y ubicaciones.
- Claude (modelo configurable, hoy Haiku) responde con un prompt largo (~60.000 caracteres) partido en un bloque fijo (cacheado)
  y uno variable (inmuebles encontrados, horarios, hora). Las reglas de negocio viven en `Promts` y `Empresa`.
- Claude devuelve etiquetas invisibles que el código convierte en acciones: `[AGENDAR]`, `[CANCELAR]`, `[CONSIGNAR]`, `[INTERES]`,
  `[CONTABILIDAD]`, `[ENTREGA]`. Cada una crea una cita en Google Calendar o manda un correo al asesor.
- Los inmuebles salen de una hoja de Google («Inmuebles para WhatsApp»), las citas van a un Calendar por ciudad y el historial
  y el «handoff» (pasar a una persona) viven en hojas. Cuando pasa a una persona, el bot se calla y el cliente escribe al WhatsApp
  personal del asesor (enlace wa.me): son dos conversaciones separadas.
- Hay mucha protección ganada con errores reales: frena bucles, detecta cuenta de Anthropic bloqueada, no contesta a contestadores,
  recuerda al que ya tiene cita, rescata captaciones incompletas, monitor de errores, recordatorios, reporte semanal.

## Qué ya existe en la plataforma y se reutiliza
Inmuebles sincronizados (`agenda_inmuebles`), reserva pública por inmueble (`reservar.js` + RPC), captación pública con horarios y
asignación automática (`consignar.js`, `agenda_captacion_publica_agendar`), portal de la visita (reubicar, cancelar), correos con
modo pruebas, tickets y registro de fallos, roles y permisos.

## Qué falta construir
Canal de WhatsApp (recibir y enviar), tablas de conversaciones y mensajes, respondedor con Claude, bandeja de conversaciones para
asesores, pausa/reactivación de la IA, acción «fuera de cobertura», y el interruptor.

## El interruptor (tres posiciones, por empresa)
1. **Sistema anterior**: responde el Apps Script como hoy. La plataforma no hace nada.
2. **Observador**: responde el Apps Script y la plataforma recibe una copia solo para guardar y mostrar las conversaciones (no responde).
3. **Sistema nuevo**: responde la plataforma; el Apps Script solo reenvía lo que llega y no contesta.
Opción extra: «sistema nuevo solo para estos números» (los de prueba), para probar en producción sin tocar a clientes reales.
Mecánica: el webhook de Meta sigue apuntando al Apps Script; se le agrega al inicio de `doPost` un reenvío a una función de Supabase
según una propiedad del script. Volver atrás es cambiar esa propiedad. Al final de la migración se apunta Meta directo a Supabase.

## Cambios de comportamiento pedidos
- **Visitas solo por el enlace del inmueble.** Se elimina de Claude todo lo de `[AGENDAR]`, horarios sugeridos y Calendar. El bot
  presenta el inmueble y da el enlace de reserva; para cancelar o cambiar, da el enlace del portal de esa visita.
- **Captaciones con horario y asignación inmediata.** El bot pregunta ciudad/zona, ofrece horarios reales de
  `agenda_sugerir_horarios_captacion_ciudad` y agenda con `agenda_captacion_publica_agendar` (asigna al asesor de siempre).
- **Fuera de cobertura.** Botón en la cita de captación: cancela, libera el horario, deja el motivo y manda un correo amable al
  propietario (y WhatsApp si vino del bot). Respeta `correo_modo_pruebas`.
- **Asesor dentro de la conversación.** Bandeja en la plataforma: ve la conversación en vivo, escribe, y al escribir la IA se pausa en
  ese chat; botón «Reactivar IA». Reactivación automática opcional tras N horas sin actividad.

## Reglas de WhatsApp a tener presentes
- Fuera de las 24 h desde el último mensaje del cliente solo se pueden enviar plantillas aprobadas por Meta (hay que crearlas).
- El token de WhatsApp está escrito dentro del Apps Script: pasarlo a secretos de Supabase y rotarlo al migrar.
- Las reglas y datos de empresa (`Promts`, `Empresa`) pasan a una tabla editable por el administrador, conservando la separación
  bloque fijo / variable para no perder el ahorro por caché.

## Fases
- **0 — Base segura:** tablas, webhook de Supabase que guarda mensajes, interruptor en el Apps Script, bandeja de solo lectura
  (modo observador). No cambia nada para los clientes.
- **1 — IA en la plataforma:** respondedor con Claude, prompt portado sin Calendar, inmuebles desde la base, enlace de reserva,
  pausa/reactivación y envío del asesor. Probar con números de prueba.
- **2 — Captación y cobertura:** captación en el chat, acción «fuera de cobertura» con correo.
- **3 — Resto de flujos:** contabilidad, locativas, entregas, comprobantes, recordatorios, reportes, rescate de captaciones.
  Luego apuntar Meta directo a Supabase y retirar el Apps Script.

## Decisiones tomadas por Felipe (24-nov-2026)
1. **Captación**: preferencia por el enlace «consigna tu inmueble» (con horarios reales y asignación inmediata), porque el chat falla al entender horas mal escritas. El bot pregunta lo mínimo y envía el enlace; no agenda por chat.
2. **Asesores**: las dos vías, configurable (ajuste «compartir el WhatsApp del asesor»). Todo queda en la bandeja de la plataforma para tener el historial.
3. **Plantillas de Meta**: Felipe no sabe crearlas; guía en `docs/PLANTILLAS-META-WHATSAPP.md` (3 plantillas iniciales).

## Estado de construcción
Construido: interruptor de 4 posiciones (anterior / observador / pruebas / nuevo), webhook, respondedor con Claude (herramienta buscar_inmuebles, etiquetas INTERES/CONSIGNAR/CONTABILIDAD/ENTREGA/HUMANO),
bandeja con pausa/reactivación de IA y escritura del asesor, plantillas fuera de las 24 h, «fuera de zona de cobertura», parche del Apps Script. Ver docs/ESTADO-ACTUAL.md para lo que falta aplicar y probar.
Fase 3 (pendiente): comprobantes de pago/imágenes, recordatorios, reporte semanal, rescate de captaciones incompletas y retiro del Apps Script.
