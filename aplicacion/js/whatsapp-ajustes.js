// Ajustes del bot de WhatsApp, ordenados en pestañas: Interruptor y conexión · Reglas del bot · Ciudades y contactos · Temas y equipo · Respuestas y plantillas.
// Un solo botón «Guardar cambios»: guarda la configuración (agenda_wa_guardar_config, sql/094), los temas (agenda_wa_guardar_temas, sql/096) y las
// respuestas rápidas (agenda_wa_guardar_respuestas, sql/097). Todo exige el permiso «whatsapp.configurar».
// Los secretos (token de WhatsApp, clave de Anthropic) NO se escriben aquí: van en las funciones de Supabase.
const MODOS = [
  ['anterior', 'Bot anterior', 'Responde el bot de siempre (Apps Script). La plataforma no hace nada. Es como está hoy.'],
  ['observador', 'Observador', 'Sigue respondiendo el bot anterior. La plataforma guarda una copia para que veas las conversaciones aquí.'],
  ['pruebas', 'Pruebas', 'La plataforma responde SOLO a tus números de prueba. Los demás clientes siguen con el bot anterior.'],
  ['nuevo', 'Bot nuevo', 'La plataforma responde a todos los clientes. El Apps Script solo reenvía lo que llega y no contesta.'],
];
const PESTANAS = [['conexion', 'Interruptor y conexión'], ['reglas', 'Reglas del bot'], ['alertas', 'Alertas'], ['ciudades', 'Ciudades y contactos'], ['temas', 'Temas y equipo'], ['respuestas', 'Respuestas y plantillas']];
// Lo que el bot hace por su cuenta (etiquetas invisibles que emite la IA) y a quién le avisa.
const ACCIONES = [
  ['Buscar inmuebles', 'Consulta el catálogo real de la plataforma (disponibles, por ciudad, zona, precio, habitaciones o código) y da el enlace de ficha y de reserva de visita.', 'Siempre activa'],
  ['Cliente interesado (INTERES)', 'Un cliente quiere un inmueble concreto: la conversación pasa a una persona y se avisa por correo.', 'Correo de asesores'],
  ['Propietario que quiere consignar (CONSIGNAR)', 'Da el enlace para consignar el inmueble y avisa al equipo.', 'Correo de asesores'],
  ['Trámite de contabilidad (CONTABILIDAD)', 'Pagos, certificados, cuentas de cobro: lo recoge y avisa al área contable.', 'Correo de contabilidad'],
  ['Entrega o devolución (ENTREGA)', 'Recoge los datos de la entrega o devolución del inmueble.', 'Correo de solicitudes'],
  ['Pedir una persona (HUMANO)', 'El cliente pide hablar con alguien o la pregunta necesita criterio humano: pausa la IA y marca «Atención».', 'Correo de asesores'],
  ['Clasificar (TEMA, PERFIL, SIN_INMUEBLE)', 'Internas: ponen el tema, el perfil (propietario, arrendatario, interesado…) y la alerta «Inmueble?» cuando no identifica el inmueble.', 'Solo la bandeja'],
];
const CAMPOS_CONTACTO = [
  ['wa_contabilidad', 'WhatsApp de contabilidad', '57300…'],
  ['wa_locativas', 'WhatsApp de reparaciones locativas', '57300…'],
  ['correo_asesores', 'Correo que recibe los avisos de clientes interesados', 'asesores@…'],
  ['correo_contabilidad', 'Correo de contabilidad', 'contabilidad@…'],
  ['correo_solicitudes', 'Correo de solicitudes (entregas y devoluciones)', 'solicitudes@…'],
];

export async function renderWhatsappAjustes({ el, supabase, empresaId, escape: esc, toast, alGuardar }) {
  el.innerHTML = '<p class="v-muted">Cargando ajustes…</p>';
  const { data: c, error } = await supabase.from('agenda_whatsapp_config').select('*').eq('empresa_id', empresaId).maybeSingle();
  if (error) { el.innerHTML = `<p class="wa-error" role="alert">${esc(error.message)}</p>`; return; }
  const cfg = c || { modo: 'anterior', numeros_prueba: [], numeros_bloqueados: [], phone_number_id: '', modelo: 'claude-haiku-5-5', compartir_whatsapp_asesor: true, reglas_adicionales: '', reactivar_ia_horas: null, contactos: {}, plantillas: [] };
  let plantillas = Array.isArray(cfg.plantillas) ? cfg.plantillas.map((p) => ({ ...p })) : [];
  let respuestas = Array.isArray(cfg.respuestas_rapidas) ? cfg.respuestas_rapidas.map((r) => ({ ...r })) : [];
  const respuestasDisponibles = 'respuestas_rapidas' in cfg;   // false si el SQL 097 aún no está aplicado
  const ct = cfg.contactos || {};
  const url = `${(import.meta.env?.VITE_SUPABASE_URL || 'https://ykiuuxludyonkhywtmgu.supabase.co').replace(/\/$/, '')}/functions/v1/whatsapp-webhook`;

  // Ciudades de la plataforma (las mismas de la agenda): un número de WhatsApp de asesor por ciudad.
  let ciudades = [];
  try { const r = await supabase.from('agenda_ciudades').select('id, nombre').eq('empresa_id', empresaId).order('nombre'); ciudades = r.data || []; } catch { /* sin ciudades */ }
  const porCiudad = Object.fromEntries((Array.isArray(ct.por_ciudad) ? ct.por_ciudad : []).map((x) => [x.ciudad_id, x.whatsapp]));

  // Temas y responsables (sql/096).
  let temas = []; let asesoresAcceso = []; let temasDisponibles = true;
  try {
    const [t, ta, d] = await Promise.all([
      supabase.from('agenda_wa_temas').select('id, clave, nombre, descripcion').eq('empresa_id', empresaId).eq('activo', true).order('orden'),
      supabase.from('agenda_wa_tema_asesores').select('tema_id, asesor_id').eq('empresa_id', empresaId),
      supabase.rpc('agenda_wa_destinos_transferencia', { p_empresa: empresaId }),
    ]);
    if (t.error) temasDisponibles = false;
    asesoresAcceso = Array.isArray(d.data) ? d.data : [];
    temas = (t.data || []).map((x) => ({ ...x, asesor_ids: (ta.data || []).filter((r) => r.tema_id === x.id).map((r) => r.asesor_id) }));
  } catch { temasDisponibles = false; }

  const TIPOS_ALERTA = { pide_asesor: 'El cliente pide hablar con una persona', fallo_entrega: 'Un mensaje no se entregó', inmueble: 'La IA no identificó el inmueble', ia_sin_respuesta: 'La IA no pudo responder', otro: 'Otros motivos' };
  const AL = { orden: 'antigua', sonido: true, repetir: 5, ...(ct.alertas || {}) };
  AL.prioridad = [...new Set([...(Array.isArray(AL.prioridad) ? AL.prioridad : []).filter((k) => TIPOS_ALERTA[k]), ...Object.keys(TIPOS_ALERTA)])];
  let pestana = 'conexion';
  el.innerHTML = `<form class="wa-aj" id="wa-aj" novalidate>
  <nav class="wa-aj-nav" role="tablist" aria-label="Secciones de los ajustes">${PESTANAS.map(([k, t]) => `<button type="button" role="tab" data-p="${k}" aria-selected="${k === pestana}">${esc(t)}</button>`).join('')}</nav>

  <section class="wa-aj-panel" data-panel="conexion">
    <div class="wa-sec"><h3>Interruptor</h3>
      <p class="wa-nota">Cambia entre el bot de siempre y el de la plataforma sin perder nada. Puedes volver atrás cuando quieras.</p>
      <div class="wa-modos">${MODOS.map(([v, t, d]) => `<label class="wa-modo-op"><input type="radio" name="modo" value="${v}" ${cfg.modo === v ? 'checked' : ''}><span><strong>${esc(t)}</strong><small>${esc(d)}</small></span></label>`).join('')}</div></div>
    <div class="wa-sec"><h3>Conexión con WhatsApp</h3>
      <label class="v-field">Identificador del número (Phone number ID de Meta)<input name="phone_number_id" inputmode="numeric" value="${esc(cfg.phone_number_id || '')}" placeholder="Solo números"><small>Lo ves en Meta → WhatsApp → Configuración de la API.</small></label>
      <div class="wa-grid2">
        <label class="v-field">Números de prueba<textarea name="numeros_prueba" rows="3" placeholder="573001234567">${esc((cfg.numeros_prueba || []).join('\n'))}</textarea><small>Uno por línea, con indicativo. En modo «Pruebas» solo a estos responde la plataforma.</small></label>
        <label class="v-field">Números bloqueados<textarea name="numeros_bloqueados" rows="3">${esc((cfg.numeros_bloqueados || []).join('\n'))}</textarea><small>El bot nunca les responde.</small></label>
      </div>
      <label class="v-field">Dirección base de los enlaces del bot (opcional)<input name="enlaces_base" value="${esc(cfg.enlaces_base || '')}" placeholder="Vacío = https://citas.patrimonios.co"><small>Sirve para probar sin mandar a los clientes a páginas no publicadas. Déjalo vacío al terminar las pruebas.</small></label>
      <p class="wa-nota">Webhook para Meta (cuando se apunte directo): <code>${esc(url)}</code><br>Los secretos (<code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_APP_SECRET</code>, <code>WHATSAPP_VERIFY_TOKEN</code>, <code>BOT_REENVIO_SECRET</code>, <code>ANTHROPIC_API_KEY</code>) se guardan en las funciones de Supabase, nunca aquí.</p></div>
  </section>

  <section class="wa-aj-panel" data-panel="reglas" hidden>
    <div class="wa-sec"><h3>Reglas y normas de la empresa</h3>
      <p class="wa-nota" id="wa-estado-reglas"></p>
      <p class="wa-nota">Es el «reglamento» del bot: cómo habla, qué puede y no puede prometer, cómo atiende arriendos, ventas, captaciones, contabilidad, locativas y entregas, y cuándo pasa a una persona. También lo usa la IA que revisa los mensajes de los asesores. Aquí ya está cargado el texto con el que funciona hoy: edítalo con calma. Los textos entre dobles corchetes (<code>[[URL_CONSIGNAR]]</code>, <code>[[BLOQUE_ASESOR]]</code>, <code>[[WA_CONTABILIDAD]]</code>, <code>[[NUM_LOCATIVAS]]</code>) los reemplaza el sistema: no los borres. Un cambio vale desde el siguiente mensaje de un cliente.</p>
      <label class="v-field">Reglas y normas<textarea class="wa-grande" name="prompt_reglas" rows="14" spellcheck="true"></textarea></label>
      <label class="v-field">Información de la empresa (servicios, tarifas, enlaces, horarios, sedes)<textarea class="wa-grande" name="prompt_info" rows="10" spellcheck="true"></textarea></label>
      <div class="wa-acciones"><button type="button" class="v-btn" id="wa-volver-orig">Volver al texto original</button></div></div>
    <div class="wa-sec"><h3>Cómo atiende</h3>
      <div class="wa-grid2">
        <label class="v-field">Modelo de IA<input name="modelo" value="${esc(cfg.modelo || 'claude-haiku-5-5')}"></label>
        <label class="v-field">Reactivar la IA sola tras (horas sin que un asesor escriba)<input type="number" min="1" max="720" name="reactivar" value="${esc(cfg.reactivar_ia_horas ?? '')}" placeholder="Vacío = nunca"></label>
      </div>
      <label class="wa-check"><input type="checkbox" name="compartir" ${cfg.compartir_whatsapp_asesor !== false ? 'checked' : ''}> Cuando el cliente pida una persona, el bot también le da el WhatsApp del asesor de su ciudad</label>
      <label class="wa-check"><input type="checkbox" name="revisar" ${cfg.revisar_mensajes_asesor !== false ? 'checked' : ''}> Antes de enviar, la IA revisa el mensaje del asesor: corrige errores, sugiere mejor redacción y avisa si algo va contra las normas o la ley</label>
      <label class="v-field">Indicaciones adicionales para la IA (se suman a las reglas)<textarea name="reglas" rows="4" maxlength="8000">${esc(cfg.reglas_adicionales || '')}</textarea></label></div>
    <div class="wa-sec"><h3>Qué hace el bot por su cuenta</h3>
      <p class="wa-nota">Son las funciones del bot de siempre, ya integradas. Los destinatarios de los avisos se configuran en «Ciudades y contactos».</p>
      <ul class="wa-acciones-bot">${ACCIONES.map(([t, d, q]) => `<li><strong>${esc(t)}</strong><span>${esc(d)}</span><em>${esc(q)}</em></li>`).join('')}</ul></div>
  </section>

  <section class="wa-aj-panel" data-panel="alertas" hidden>
    <div class="wa-sec"><h3>Cuando hace falta una persona</h3>
      <p class="wa-nota">Cuando una conversación necesita a un humano (el cliente pide un asesor, un mensaje no se entregó, la IA no supo qué inmueble o no pudo responder), la bandeja suena, muestra un aviso rojo y la sube al inicio de la lista. Aquí defines cómo se ordenan esas alertas.</p>
      <label class="wa-check"><input type="checkbox" name="al_sonido" ${AL.sonido !== false ? 'checked' : ''}> Hacer sonar una alerta cuando llega una nueva (cada persona puede silenciarla con la campana de la lista)</label>
      <label class="v-field">Repetir el sonido mientras haya alertas sin atender, cada (minutos)<input type="number" min="0" max="120" name="al_repetir" value="${esc(AL.repetir ?? 5)}"><small>0 = suena solo una vez por alerta.</small></label>
      <label class="v-field">Orden de las alertas en la lista
        <select name="al_orden">${[['antigua', 'La que lleva más tiempo esperando, primero'], ['reciente', 'La más reciente, primero'], ['prioridad', 'Por tipo de motivo (el orden de abajo) y luego la más antigua']].map(([v, t]) => `<option value="${v}" ${AL.orden === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <div class="v-field">Prioridad por tipo de motivo (se usa con la última opción)
        <ol class="wa-prio" id="al-prio">${(AL.prioridad).map((k) => `<li data-k="${esc(k)}"><span>${esc(TIPOS_ALERTA[k] || k)}</span><button type="button" class="wa-sec-btn" data-sube aria-label="Subir">↑</button><button type="button" class="wa-sec-btn" data-baja aria-label="Bajar">↓</button></li>`).join('')}</ol></div></div>
  </section>

  <section class="wa-aj-panel" data-panel="ciudades" hidden>
    <div class="wa-sec"><h3>WhatsApp del asesor por ciudad</h3>
      <p class="wa-nota">Son las ciudades de la plataforma. Cuando un cliente pide una persona, el bot le da el número de su ciudad. Déjalo vacío si en esa ciudad atienden solo desde aquí.</p>
      ${ciudades.length ? `<div class="wa-grid2">${ciudades.map((ci) => `<label class="v-field">${esc(ci.nombre)}<input data-ciudad="${esc(ci.id)}" data-nombre="${esc(ci.nombre)}" value="${esc(porCiudad[ci.id] || '')}" placeholder="57300…" inputmode="tel"></label>`).join('')}</div>` : '<p class="v-muted">No hay ciudades creadas en la plataforma (Administración → Ciudades).</p>'}
      <details class="wa-aviso-det"><summary>Números antiguos (se usan solo si no hay números por ciudad)</summary>
        <div class="wa-grid2"><label class="v-field">Bogotá y Medellín<input name="c_wa_bogota_medellin" value="${esc(ct.wa_bogota_medellin || '')}" placeholder="57300…"></label>
        <label class="v-field">Barranquilla<input name="c_wa_barranquilla" value="${esc(ct.wa_barranquilla || '')}" placeholder="57300…"></label></div></details></div>
    <div class="wa-sec"><h3>Otros contactos que usa el bot</h3>
      <div class="wa-grid2">${CAMPOS_CONTACTO.map(([k, t, ph]) => `<label class="v-field">${esc(t)}<input name="c_${k}" value="${esc(ct[k] || '')}" placeholder="${esc(ph)}"></label>`).join('')}</div></div>
  </section>

  <section class="wa-aj-panel" data-panel="temas" hidden>
    <div class="wa-sec"><h3>Temas y responsables</h3>
      <p class="wa-nota">La IA clasifica cada conversación en uno de estos temas (por ejemplo «Contabilidad», «Reparaciones locativas», «Asesor Bogotá»). Cada tema tiene responsables: ellos ven la cola de «sin asignar» de ese tema y uno la toma. Un tema sin responsables lo ve todo el que pueda ver WhatsApp. La «descripción» le explica a la IA cuándo usar el tema.</p>
      ${temasDisponibles ? '<div id="wa-temas"></div><div class="wa-acciones"><button type="button" class="v-btn" id="wa-tema-mas">Añadir tema</button></div>' : '<p class="wa-nota">Esta parte se activa cuando se aplique el SQL 096.</p>'}</div>
  </section>

  <section class="wa-aj-panel" data-panel="respuestas" hidden>
    <div class="wa-sec"><h3>Respuestas rápidas</h3>
      <p class="wa-nota">Mensajes prediseñados que el asesor elige desde el chat y puede editar antes de enviar. Puedes usar <code>{{nombre}}</code>, <code>{{inmueble}}</code> y <code>{{asesor}}</code>. Para ofrecer inmuebles, en el chat se escribe el número («500, 501») y el botón «Pasar información» envía la ficha de cada uno; la IA sigue atendiendo con esa información.</p>
      ${respuestasDisponibles ? '<div id="wa-resp"></div><div class="wa-acciones"><button type="button" class="v-btn" id="wa-resp-mas">Añadir respuesta</button><button type="button" class="v-btn" id="wa-resp-ejemplos">Cargar ejemplos</button></div>' : '<p class="wa-nota">Esta parte se activa cuando se aplique el SQL 097.</p>'}</div>
    <div class="wa-sec"><h3>Plantillas aprobadas por Meta</h3>
      <p class="wa-nota">Fuera de las 24 horas desde el último mensaje del cliente, WhatsApp solo deja enviar plantillas ya aprobadas. Regístralas con el mismo nombre que tienen en Meta y usa {{1}}, {{2}}… para los datos variables. Guía: docs/PLANTILLAS-META-WHATSAPP.md.</p>
      <div id="wa-plantillas"></div><div class="wa-acciones"><button type="button" class="v-btn" id="wa-plant-mas">Añadir plantilla</button></div></div>
  </section>

  <div class="wa-aj-barra"><span id="wa-aj-msg" role="status" aria-live="polite"></span><button class="v-btn v-primary" type="submit">Guardar cambios</button></div>
</form>`;

  // ---- Pestañas ----
  const mostrar = (k) => {
    pestana = k;
    el.querySelectorAll('.wa-aj-nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === k)));
    el.querySelectorAll('.wa-aj-panel').forEach((s) => { s.hidden = s.dataset.panel !== k; });
  };
  el.querySelectorAll('.wa-aj-nav button').forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.p)));
  el.querySelector('#al-prio')?.addEventListener('click', (ev) => {
    const li = ev.target.closest('li'); if (!li) return;
    if (ev.target.closest('[data-sube]') && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    if (ev.target.closest('[data-baja]') && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
  });

  // ---- Reglas: el texto original ya viene cargado ----
  const campoReglas = el.querySelector('[name=prompt_reglas]');
  const campoInfo = el.querySelector('[name=prompt_info]');
  const estadoReglas = el.querySelector('#wa-estado-reglas');
  let original = null;   // { reglas, info } del texto que trae la plataforma
  const pintarEstadoReglas = () => {
    if (!original) { estadoReglas.innerHTML = 'Cargando el texto actual del bot…'; return; }
    const igual = campoReglas.value.trim() === original.reglas.trim() && campoInfo.value.trim() === original.info.trim();
    estadoReglas.innerHTML = igual ? '<strong>Es el texto original</strong> que viene con la plataforma (si se mejora en futuras versiones, tu empresa lo recibe solo).' : '<strong>Estás usando un texto propio de tu empresa.</strong> «Volver al texto original» lo restaura al guardar.';
  };
  campoReglas.value = cfg.prompt_reglas || ''; campoInfo.value = cfg.prompt_info || '';
  campoReglas.addEventListener('input', pintarEstadoReglas); campoInfo.addEventListener('input', pintarEstadoReglas);
  pintarEstadoReglas();
  (async () => {
    const { data } = await supabase.functions.invoke('whatsapp-redactar', { body: { accion: 'prompt_base', empresa_id: empresaId } });
    if (!data?.ok) { estadoReglas.innerHTML = 'No se pudo cargar el texto original ahora. Si los campos están vacíos, el bot usa el original igual.'; return; }
    original = { reglas: data.reglas, info: data.info };
    if (!campoReglas.value.trim()) campoReglas.value = original.reglas;
    if (!campoInfo.value.trim()) campoInfo.value = original.info;
    pintarEstadoReglas();
  })();
  el.querySelector('#wa-volver-orig').addEventListener('click', () => {
    if (!original) return toast?.('Espera un momento: se está cargando el texto original.');
    if (!window.confirm('Se reemplazará el texto de arriba por el original. ¿Seguro? (Se aplica al guardar.)')) return;
    campoReglas.value = original.reglas; campoInfo.value = original.info; pintarEstadoReglas();
  });

  // ---- Temas ----
  const cajaTemas = el.querySelector('#wa-temas');
  function pintarTemas() {
    if (!cajaTemas) return;
    cajaTemas.innerHTML = temas.map((t, i) => `<div class="wa-tema" data-i="${i}">
      <div class="wa-tema-fila"><input data-k="nombre" placeholder="Nombre (p. ej. Contabilidad)" value="${esc(t.nombre || '')}" aria-label="Nombre del tema">
      <input data-k="clave" placeholder="clave_interna" value="${esc(t.clave || '')}" aria-label="Clave del tema" style="max-width:190px">
      <button type="button" class="v-btn v-quiet" data-quitar-tema="${i}">Quitar</button></div>
      <textarea data-k="descripcion" rows="2" maxlength="600" placeholder="Cuándo usar este tema (para la IA): p. ej. preguntas de pagos, cuentas de cobro, certificados contables." aria-label="Descripción">${esc(t.descripcion || '')}</textarea>
      <div class="wa-checks" aria-label="Responsables"><span class="wa-etq">Responsables:</span>${asesoresAcceso.length ? asesoresAcceso.map((a) => `<label><input type="checkbox" data-asesor="${esc(a.id)}" ${(t.asesor_ids || []).includes(a.id) ? 'checked' : ''}> ${esc(a.nombre)}</label>`).join('') : '<small class="v-muted">Aún no hay asesores con acceso a la plataforma.</small>'}</div></div>`).join('') || '<p class="v-muted">Sin temas todavía: toda conversación sin asignar la ve cualquiera con permiso.</p>';
    cajaTemas.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => { temas[Number(inp.closest('.wa-tema').dataset.i)][inp.dataset.k] = inp.value; }));
    cajaTemas.querySelectorAll('[data-asesor]').forEach((cb) => cb.addEventListener('change', () => {
      const t = temas[Number(cb.closest('.wa-tema').dataset.i)];
      t.asesor_ids = cb.checked ? [...new Set([...(t.asesor_ids || []), cb.dataset.asesor])] : (t.asesor_ids || []).filter((x) => x !== cb.dataset.asesor);
    }));
    cajaTemas.querySelectorAll('[data-quitar-tema]').forEach((b) => b.addEventListener('click', () => { temas.splice(Number(b.dataset.quitarTema), 1); pintarTemas(); }));
  }
  pintarTemas();
  el.querySelector('#wa-tema-mas')?.addEventListener('click', () => { temas.push({ nombre: '', clave: '', descripcion: '', asesor_ids: [] }); pintarTemas(); });

  // ---- Respuestas rápidas ----
  const cajaResp = el.querySelector('#wa-resp');
  function pintarRespuestas() {
    if (!cajaResp) return;
    cajaResp.innerHTML = respuestas.map((r, i) => `<div class="wa-tema" data-i="${i}">
      <div class="wa-tema-fila"><input data-k="titulo" placeholder="Título (lo que ve el asesor)" value="${esc(r.titulo || '')}" aria-label="Título" maxlength="60"><button type="button" class="v-btn v-quiet" data-quitar-resp="${i}">Quitar</button></div>
      <textarea data-k="texto" rows="3" maxlength="1500" placeholder="Hola {{nombre}}, …" aria-label="Texto">${esc(r.texto || '')}</textarea></div>`).join('') || '<p class="v-muted">Aún no hay respuestas rápidas. Pulsa «Cargar ejemplos» para empezar.</p>';
    cajaResp.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => { respuestas[Number(inp.closest('.wa-tema').dataset.i)][inp.dataset.k] = inp.value; }));
    cajaResp.querySelectorAll('[data-quitar-resp]').forEach((b) => b.addEventListener('click', () => { respuestas.splice(Number(b.dataset.quitarResp), 1); pintarRespuestas(); }));
  }
  pintarRespuestas();
  el.querySelector('#wa-resp-mas')?.addEventListener('click', () => { respuestas.push({ titulo: '', texto: '' }); pintarRespuestas(); });
  el.querySelector('#wa-resp-ejemplos')?.addEventListener('click', () => {
    respuestas.push(
      { titulo: 'Tenemos opciones en esa zona', texto: 'Hola {{nombre}}, soy {{asesor}}. Sí tenemos opciones en esa zona. Te cuento los datos de uno y, si te interesa, agendamos la visita. ¿Qué rango de canon manejas?' },
      { titulo: 'Te paso el inmueble', texto: 'Hola {{nombre}}, te comparto la información del inmueble {{inmueble}}. Puedes ver la ficha y reservar la visita en el horario que prefieras desde el enlace.' },
      { titulo: 'Pedir datos para el estudio', texto: 'Hola {{nombre}}, para avanzar con el estudio necesito tu nombre completo, número de documento y correo. Tus datos se tratan según nuestra política de tratamiento de datos personales.' },
      { titulo: 'Seguimiento de visita', texto: 'Hola {{nombre}}, ¿cómo te pareció el inmueble {{inmueble}}? Si quieres, te muestro otras opciones parecidas.' },
    ); pintarRespuestas();
  });

  // ---- Plantillas de Meta ----
  const caja = el.querySelector('#wa-plantillas');
  function pintarPlantillas() {
    caja.innerHTML = plantillas.map((p, i) => `<div class="wa-plant" data-i="${i}">
      <input data-k="nombre" placeholder="nombre_en_meta" value="${esc(p.nombre || '')}" aria-label="Nombre de la plantilla">
      <input data-k="idioma" placeholder="es" value="${esc(p.idioma || 'es')}" aria-label="Idioma">
      <textarea data-k="texto" rows="2" placeholder="Hola {{1}}, …" aria-label="Texto de la plantilla">${esc(p.texto || '')}</textarea>
      <button type="button" class="v-btn v-quiet" data-quitar="${i}">Quitar</button></div>`).join('') || '<p class="v-muted">Sin plantillas registradas.</p>';
    caja.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => { plantillas[Number(inp.closest('.wa-plant').dataset.i)][inp.dataset.k] = inp.value; }));
    caja.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => { plantillas.splice(Number(b.dataset.quitar), 1); pintarPlantillas(); }));
  }
  pintarPlantillas();
  el.querySelector('#wa-plant-mas').addEventListener('click', () => { plantillas.push({ nombre: '', idioma: 'es', texto: '' }); pintarPlantillas(); });

  // ---- Guardar todo ----
  el.querySelector('#wa-aj').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const lineas = (v) => String(v || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    const contactos = { ...ct };
    for (const k of ['wa_bogota_medellin', 'wa_barranquilla', ...CAMPOS_CONTACTO.map(([x]) => x)]) { const v = f[`c_${k}`]?.value.trim(); if (v) contactos[k] = v; else delete contactos[k]; }
    contactos.alertas = { orden: f.al_orden.value, sonido: !!f.al_sonido.checked, repetir: Math.max(0, Math.min(120, Number(f.al_repetir.value) || 0)), prioridad: [...el.querySelectorAll('#al-prio li')].map((x) => x.dataset.k) };
    contactos.por_ciudad = [...el.querySelectorAll('[data-ciudad]')].filter((i) => i.value.trim()).map((i) => ({ ciudad_id: i.dataset.ciudad, ciudad: i.dataset.nombre, whatsapp: i.value.trim() }));
    const modo = f.modo.value;
    // Si el texto es igual al original se guarda vacío: así el bot sigue recibiendo las mejoras de la plataforma.
    const reglasTxt = original && f.prompt_reglas.value.trim() === original.reglas.trim() ? '' : f.prompt_reglas.value;
    const infoTxt = original && f.prompt_info.value.trim() === original.info.trim() ? '' : f.prompt_info.value;
    if (reglasTxt.trim() && !reglasTxt.includes('[[URL_CONSIGNAR]]') && !window.confirm('Las reglas editadas no incluyen [[URL_CONSIGNAR]]: el bot no podrá enviar el enlace para consignar inmuebles. ¿Guardar de todos modos?')) return;
    if (modo === 'nuevo' && !window.confirm('Con «Bot nuevo» la plataforma contestará a TODOS los clientes por WhatsApp. ¿Seguro que el Apps Script ya está reenviando y en modo «nuevo»?')) return;
    const datos = {
      modo, phone_number_id: f.phone_number_id.value.trim(), numeros_prueba: lineas(f.numeros_prueba.value), numeros_bloqueados: lineas(f.numeros_bloqueados.value),
      enlaces_base: f.enlaces_base.value.trim().replace(/\/+$/, ''), prompt_reglas: reglasTxt, prompt_info: infoTxt, revisar_mensajes_asesor: f.revisar.checked,
      modelo: f.modelo.value.trim(), compartir_whatsapp_asesor: f.compartir.checked, reglas_adicionales: f.reglas.value,
      reactivar_ia_horas: f.reactivar.value ? Number(f.reactivar.value) : null, contactos,
      plantillas: plantillas.filter((p) => p.nombre && p.nombre.trim()).map((p) => ({ nombre: p.nombre.trim(), idioma: (p.idioma || 'es').trim(), texto: p.texto || '' })),
    };
    const msg = el.querySelector('#wa-aj-msg');
    const fallo = (e, d) => { msg.textContent = e?.message || d; msg.className = 'wa-error'; };
    msg.className = ''; msg.textContent = 'Guardando…';
    const r1 = await supabase.rpc('agenda_wa_guardar_config', { p_empresa_id: empresaId, p_datos: datos });
    if (r1.error) return fallo(r1.error, 'No se pudo guardar.');
    if (temasDisponibles) {
      const limpio = temas.filter((t) => (t.nombre || '').trim()).map((t) => ({
        nombre: t.nombre.trim(), descripcion: t.descripcion || '', asesor_ids: t.asesor_ids || [],
        clave: (t.clave || t.nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40),
      }));
      const r2 = await supabase.rpc('agenda_wa_guardar_temas', { p_empresa_id: empresaId, p_temas: limpio });
      if (r2.error) return fallo(r2.error, 'No se pudieron guardar los temas.');
    }
    if (respuestasDisponibles) {
      const r3 = await supabase.rpc('agenda_wa_guardar_respuestas', { p_empresa_id: empresaId, p_respuestas: respuestas });
      if (r3.error) return fallo(r3.error, 'No se pudieron guardar las respuestas rápidas.');
    }
    msg.className = ''; msg.textContent = 'Guardado.';
    toast?.('Ajustes de WhatsApp guardados.');
    await alGuardar?.();
  });
}
