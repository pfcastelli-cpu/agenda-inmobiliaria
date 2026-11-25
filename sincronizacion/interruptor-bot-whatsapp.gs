/**
 * INTERRUPTOR DEL BOT DE WHATSAPP (Apps Script del bot actual → plataforma nueva)
 * ------------------------------------------------------------------------------
 * Pegar este archivo COMPLETO como un archivo nuevo del proyecto de Apps Script del bot («Script Whatsapp»), y hacer SOLO dos cambios
 * pequeños en «Código» (abajo, «Cambio 1» y «Cambio 2»). Nada más del bot actual se toca.
 *
 * CÓMO FUNCIONA
 *  - Mientras la propiedad del script PLATAFORMA_ACTIVA no sea exactamente «si», este archivo NO HACE NADA: el bot sigue igual que hoy.
 *  - Con PLATAFORMA_ACTIVA = «si», cada mensaje que llega se reenvía a la plataforma. La plataforma contesta si ella atiende a ese número
 *    (según el interruptor «Anterior / Observador / Pruebas / Nuevo» de la pantalla WhatsApp → Ajustes):
 *        · «atiende: true»  → el bot anterior se calla (la plataforma responde).
 *        · «atiende: false» → el bot anterior responde como siempre (modo anterior, observador, número que no es de prueba, o cualquier error).
 *  - Si la plataforma no contesta, tarda o falla, gana el bot anterior: el cliente nunca se queda sin respuesta.
 *  - Volver atrás en 10 segundos: poner PLATAFORMA_ACTIVA en «no» (o borrarla) en Configuración del proyecto → Propiedades del script.
 *
 * PROPIEDADES DEL SCRIPT (Configuración del proyecto → Propiedades del script)
 *    PLATAFORMA_URL      = https://ykiuuxludyonkhywtmgu.supabase.co/functions/v1/whatsapp-webhook
 *    PLATAFORMA_SECRETO  = (el mismo valor del secreto BOT_REENVIO_SECRET de las funciones de Supabase; inventar uno largo y aleatorio)
 *    PLATAFORMA_ACTIVA   = si   (o no)
 *
 * CAMBIO 1 — en doPost(e), justo DESPUÉS de la línea  «const data = JSON.parse(e.postData.contents);»  agregar:
 *
 *      if (plataformaAtiende_(e.postData.contents, data)) return outputOk();
 *
 * CAMBIO 2 — en enviarMensajeWhatsApp(numeroDestino, texto), justo ANTES del «return» final (cuando el envío salió bien), agregar:
 *
 *      try { copiarRespuestaAPlataforma_(numeroDestino, texto); } catch (errCopia) {}
 *
 *   (Sirve para que en modo «Observador» la bandeja de la plataforma también muestre lo que contestó el bot anterior.)
 */

function plataformaActiva_() {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty('PLATAFORMA_ACTIVA') === 'si' && !!p.getProperty('PLATAFORMA_URL') && !!p.getProperty('PLATAFORMA_SECRETO');
}

/** Reenvía el mensaje a la plataforma. Devuelve true SOLO si la plataforma dijo que ella lo atiende. Ante cualquier duda, false. */
function plataformaAtiende_(contenidoCrudo, data) {
  try {
    if (!plataformaActiva_()) return false;
    const mensaje = data && data.entry && data.entry[0] && data.entry[0].changes && data.entry[0].changes[0] &&
                    data.entry[0].changes[0].value && data.entry[0].changes[0].value.messages;
    if (!mensaje || !mensaje.length) { reenviarFallosDeEntrega_(contenidoCrudo, data); return false; } // lecturas y entregas OK no se reenvían
    const p = PropertiesService.getScriptProperties();
    const r = UrlFetchApp.fetch(p.getProperty('PLATAFORMA_URL'), {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-reenvio-secret': p.getProperty('PLATAFORMA_SECRETO') },
      payload: contenidoCrudo,
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return false;
    const j = JSON.parse(r.getContentText());
    return j && j.atiende === true;
  } catch (err) {
    try { Logger.log('Plataforma no disponible, responde el bot anterior: ' + err); } catch (e2) {}
    return false;
  }
}

/** Si Meta avisa que un mensaje NO se entregó («failed»), se lo cuenta a la plataforma para marcarlo en rojo. Nunca interrumpe nada. */
function reenviarFallosDeEntrega_(contenidoCrudo, data) {
  try {
    const estados = data && data.entry && data.entry[0] && data.entry[0].changes && data.entry[0].changes[0] &&
                    data.entry[0].changes[0].value && data.entry[0].changes[0].value.statuses;
    if (!estados || !estados.some(function (s) { return s && s.status === 'failed'; })) return;
    const p = PropertiesService.getScriptProperties();
    UrlFetchApp.fetch(p.getProperty('PLATAFORMA_URL'), {
      method: 'post', contentType: 'application/json',
      headers: { 'x-reenvio-secret': p.getProperty('PLATAFORMA_SECRETO') },
      payload: contenidoCrudo, muteHttpExceptions: true
    });
  } catch (err) {}
}

/** Le cuenta a la plataforma lo que contestó el bot anterior (solo para el historial). Nunca interrumpe el envío. */
function copiarRespuestaAPlataforma_(numeroDestino, texto) {
  if (!plataformaActiva_()) return;
  const p = PropertiesService.getScriptProperties();
  UrlFetchApp.fetch(p.getProperty('PLATAFORMA_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-reenvio-secret': p.getProperty('PLATAFORMA_SECRETO') },
    payload: JSON.stringify({ bot_anterior: { phone_number_id: String(PHONE_NUMBER_ID), telefono: String(numeroDestino), texto: String(texto) } }),
    muteHttpExceptions: true
  });
}

/** Prueba rápida desde el editor: ejecutar y mirar el registro. No envía nada a ningún cliente (si el modo no es «anterior», queda una conversación de prueba en la bandeja). */
function probarConexionPlataforma() {
  const ejemplo = { entry: [{ changes: [{ value: { metadata: { phone_number_id: String(PHONE_NUMBER_ID) }, messages: [{ id: 'prueba-' + Date.now(), from: '570000000000', type: 'text', text: { body: 'hola' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
  Logger.log('¿La plataforma atiende el número 570000000000? → ' + plataformaAtiende_(JSON.stringify(ejemplo), ejemplo) + '  (false es lo normal si ese número no es de prueba)');
}
