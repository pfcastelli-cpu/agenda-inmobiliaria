// Pantalla «WhatsApp»: bandeja de conversaciones del bot (la IA y los asesores en el mismo chat) y ajustes del interruptor.
// Lee las tablas agenda_wa_* (solo lectura por RLS, permiso «whatsapp.ver»); escribir pasa por la función whatsapp-enviar y por las
// funciones de la base agenda_wa_set_ia / agenda_wa_marcar_leida (sql/094). Se actualiza sola cada pocos segundos mientras está abierta.
// Aspecto: imita WhatsApp Web (estilos/whatsapp.css). `puedeFn` permite probar la pantalla con datos de demostración (whatsapp-demo.html).
import '../estilos/whatsapp.css';
import { puede as puedePermisos } from './permisos.js';
import { renderWhatsappAjustes } from './whatsapp-ajustes.js';
import { sonarAlerta } from './whatsapp-presencia.js';

const ORIGEN = { cliente: 'Cliente', ia: '🤖 Asistente IA', asesor: 'Asesor', sistema: 'Sistema', bot_anterior: 'Bot anterior' };
const COLORES = ['#00a884', '#6b3fa0', '#d9534f', '#2f7bd9', '#c77d00', '#009688', '#8e5a3c', '#5c6bc0'];
const FILTROS = [['todas', 'Todas'], ['mias', 'Mías'], ['cola', 'Sin asignar'], ['pendientes', 'Pendientes'], ['atencion', 'Atención'], ['pausadas', 'IA en pausa'], ['resueltas', 'Resueltas'], ['prueba', 'Pruebas']];
const PERFILES = { interesado_arriendo: 'Interesado en arriendo', interesado_compra: 'Interesado en compra', propietario: 'Propietario', arrendatario: 'Arrendatario', consignacion: 'Consignación' };
const TIPO_TXT = { pide_asesor: 'pide hablar con una persona', fallo_entrega: 'un mensaje no se entregó', inmueble: 'inmueble sin identificar', ia_sin_respuesta: 'la IA no pudo responder', otro: 'requiere atención' };
const tituloConv = (c) => `${c.nombre || '+' + c.telefono}${c.inmueble_numero ? ` · Inmueble ${c.inmueble_numero}` : ''}`;
const zona = { timeZone: 'America/Bogota' };
const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-CO', { ...zona, hour: 'numeric', minute: '2-digit' });
const diaClave = (iso) => new Date(iso).toLocaleDateString('en-CA', zona);
const etiquetaDia = (iso) => {
  const d = diaClave(iso);
  const hoy = diaClave(new Date().toISOString());
  const ayer = diaClave(new Date(Date.now() - 86400000).toISOString());
  if (d === hoy) return 'Hoy';
  if (d === ayer) return 'Ayer';
  return new Date(iso).toLocaleDateString('es-CO', { ...zona, weekday: 'long', day: 'numeric', month: 'long' });
};
const fechaLista = (iso) => (diaClave(iso) === diaClave(new Date().toISOString()) ? horaCorta(iso) : etiquetaDia(iso) === 'Ayer' ? 'Ayer' : new Date(iso).toLocaleDateString('es-CO', { ...zona, day: 'numeric', month: 'short' }));
const dentroDe24h = (iso) => !!iso && Date.now() - new Date(iso).getTime() < 24 * 3600 * 1000;
const mensajeError = (e, d) => String(e?.message || d);
const iniciales = (c) => {
  const n = String(c.nombre || '').trim();
  if (!n) return '#';
  const p = n.split(/\s+/);
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
const colorDe = (c) => COLORES[[...String(c.telefono)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORES.length];

export async function renderWhatsapp({ el, supabase, empresaId, escape, toast, puedeFn }) {
  const esc = escape || ((t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  const puede = puedeFn || puedePermisos;
  const verAjustes = puede('whatsapp.configurar');
  const poder = puede('whatsapp.responder');
  const st = { avisados: null, ultimoSonido: 0, tituloOriginal: document.title, convs: [], sel: null, filtro: 'todas', buscar: '', cfg: null, timer: null, pestana: 'chats', firma: '', yaDesplazado: false, urls: {}, fTema: '', fAses: '', meta: { temas: [], asesores: [], yo: null } };
  const verTodas = puede('whatsapp.ver_todas');
  const puedeTomar = puede('whatsapp.tomar');
  const puedeTransferir = puede('whatsapp.transferir') || puede('whatsapp.transferir_todos');

  el.innerHTML = '<p class="v-muted">Cargando WhatsApp…</p>';
  const { data: cfg } = await supabase.from('agenda_whatsapp_config').select('*').eq('empresa_id', empresaId).maybeSingle();
  st.cfg = cfg || { modo: 'anterior', plantillas: [] };
  // Temas, asesores y mi propia ficha (sql/096). Si todavía no está aplicado, la bandeja funciona igual sin esto.
  try {
    const [t, y, d] = await Promise.all([
      supabase.from('agenda_wa_temas').select('id, clave, nombre').eq('empresa_id', empresaId).eq('activo', true).order('orden'),
      supabase.rpc('agenda_wa_mi_asesor', { p_empresa: empresaId }),
      supabase.rpc('agenda_wa_destinos_transferencia', { p_empresa: empresaId }),
    ]);
    st.meta = { temas: t.data || [], yo: y.data || null, asesores: Array.isArray(d.data) ? d.data : [] };
  } catch { /* sin asesores ni temas todavía */ }
  const nombreAsesor = (id) => st.meta.asesores.find((a) => a.id === id)?.nombre || '';
  marco();
  await cargarLista();

  function marco() {
    const modoTxt = { anterior: 'Bot anterior (Apps Script) responde', observador: 'Observador: el bot anterior responde y aquí solo se guarda', pruebas: 'Pruebas: la plataforma responde solo a números de prueba', nuevo: 'Bot nuevo responde' }[st.cfg.modo];
    el.innerHTML = `<section class="wa">
  <header class="wa-cab"><h2>WhatsApp</h2><span class="wa-modo wa-modo-${esc(st.cfg.modo)}">${esc(modoTxt)}</span>
    <nav class="wa-tabs"><button type="button" data-tab="chats" aria-pressed="${st.pestana === 'chats'}">Conversaciones</button>${verAjustes ? `<button type="button" data-tab="ajustes" aria-pressed="${st.pestana === 'ajustes'}">Ajustes e interruptor</button>` : ''}</nav></header>
  <div id="wa-cuerpo"></div></section>`;
    el.querySelectorAll('.wa-tabs button').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.tab === 'ajustes') {
        st.pestana = 'ajustes';
        detener();
        el.querySelectorAll('.wa-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        await renderWhatsappAjustes({ el: el.querySelector('#wa-cuerpo'), supabase, empresaId, escape: esc, toast, alGuardar: async () => { const r = await supabase.from('agenda_whatsapp_config').select('*').eq('empresa_id', empresaId).maybeSingle(); st.cfg = r.data || st.cfg; } });
      } else if (st.pestana !== 'chats') { st.pestana = 'chats'; marco(); await cargarLista(); }
    }));
    if (st.pestana === 'chats') cuerpoChats();
  }

  function cuerpoChats() {
    el.querySelector('#wa-cuerpo').innerHTML = `<div class="wa-grid">
  <aside class="wa-lista"><div class="wa-lista-cab"><span>Chats</span><button type="button" class="wa-icono" id="wa-sonido" aria-pressed="${sonidoActivo()}" title="Activar o silenciar el sonido de las alertas">${sonidoActivo() ? '🔔' : '🔕'}</button></div>
    <button type="button" class="wa-banner" id="wa-banner" hidden></button>
    <div class="wa-filtros"><input id="wa-buscar" type="search" placeholder="Buscar un chat" value="${esc(st.buscar)}" aria-label="Buscar conversación">
      <div class="wa-pildoras" role="group" aria-label="Filtrar">${FILTROS.map(([v, t]) => `<button type="button" data-f="${v}" aria-pressed="${st.filtro === v}">${esc(t)}</button>`).join('')}</div>
      ${st.meta.temas.length || (verTodas && st.meta.asesores.length) ? `<div class="wa-selects">
        ${st.meta.temas.length ? `<select id="wa-ftema" aria-label="Filtrar por tema"><option value="">Todos los temas</option>${st.meta.temas.map((t) => `<option value="${esc(t.id)}" ${st.fTema === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
        ${verTodas && st.meta.asesores.length ? `<select id="wa-fases" aria-label="Filtrar por asesor"><option value="">Todos los asesores</option>${st.meta.asesores.map((a) => `<option value="${esc(a.id)}" ${st.fAses === a.id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select>` : ''}</div>` : ''}</div>
    <ul id="wa-items" class="wa-items"></ul></aside>
  <div class="wa-hilo" id="wa-hilo"><p class="v-muted">Elige una conversación para verla aquí.</p></div></div>`;
    el.querySelector('#wa-sonido')?.addEventListener('click', (ev) => {
      const on = !sonidoActivo();
      try { localStorage.setItem('wa_sonido', on ? 'si' : 'no'); } catch { /* sin almacenamiento */ }
      ev.currentTarget.textContent = on ? '🔔' : '🔕'; ev.currentTarget.setAttribute('aria-pressed', String(on));
      if (on) sonar();
    });
    el.querySelector('#wa-banner')?.addEventListener('click', async () => {
      const primera = ordenar(st.convs.filter(esAlerta))[0];
      if (primera) { st.sel = primera.id; st.firma = ''; st.yaDesplazado = false; }
      st.filtro = 'atencion'; el.querySelectorAll('.wa-pildoras button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === 'atencion'))); pintarLista(); if (primera) await cargarHilo(true); });
    ajustarAlto();
    el.querySelector('#wa-buscar').addEventListener('input', (e) => { st.buscar = e.target.value; pintarLista(); });
    el.querySelector('#wa-ftema')?.addEventListener('change', (e) => { st.fTema = e.target.value; pintarLista(); });
    el.querySelector('#wa-fases')?.addEventListener('change', (e) => { st.fAses = e.target.value; pintarLista(); });
    el.querySelectorAll('.wa-pildoras button').forEach((b) => b.addEventListener('click', () => {
      st.filtro = b.dataset.f;
      el.querySelectorAll('.wa-pildoras button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      pintarLista();
    }));
  }

  // ── Alertas: conversaciones que necesitan a una persona ──
  function sonidoActivo() { try { return localStorage.getItem('wa_sonido') !== 'no'; } catch { return true; } }
  function reglaAl() {
    const a = st.cfg?.contactos?.alertas || {};
    return { orden: a.orden || 'antigua', sonido: a.sonido !== false, repetir: Number.isFinite(Number(a.repetir)) ? Number(a.repetir) : 5, prioridad: Array.isArray(a.prioridad) && a.prioridad.length ? a.prioridad : ['pide_asesor', 'fallo_entrega', 'inmueble', 'ia_sin_respuesta', 'otro'] };
  }
  function tipoAlerta(c) {
    return (c.alerta === 'inmueble_no_identificado' ? 'inmueble' : /no se entreg/i.test(c.motivo_pausa || '') ? 'fallo_entrega'
    : /asesor|persona|humano/i.test(c.motivo_pausa || '') ? 'pide_asesor' : !c.motivo_pausa ? 'ia_sin_respuesta' : 'otro');
  }
  function venceVentana(c) { return c.estado !== 'cerrada' && !!c.ultimo_cliente_en && Date.now() - new Date(c.ultimo_cliente_en).getTime() > 24 * 3600 * 1000; }
  function esAlerta(c) { return c.estado !== 'cerrada' && !!c.requiere_atencion; }
  function espera(c) { return new Date(c.ultimo_cliente_en || c.ultimo_en || 0).getTime(); }
  function ordenAlertas(a, b) {
    const r = reglaAl();
    if (r.orden === 'reciente') return espera(b) - espera(a);
    if (r.orden === 'prioridad') { const d = r.prioridad.indexOf(tipoAlerta(a)) - r.prioridad.indexOf(tipoAlerta(b)); if (d) return d; }
    return espera(a) - espera(b);
  }
  // Las alertas van arriba (según la regla de Ajustes → Alertas); el resto, por la última actividad.
  function ordenar(lista) { const al = lista.filter(esAlerta).sort(ordenAlertas); return [...al, ...lista.filter((c) => !esAlerta(c))]; }
  function sonar() {
    try { sonarAlerta(); } catch { /* sin audio */ }
  }
  function claveAl(c) { return c.id + '|' + (c.motivo_pausa || '') + '|' + (c.alerta || ''); }
  function revisarAlertas() {
    const pend = st.convs.filter(esAlerta);
    const nuevas = st.avisados ? pend.filter((c) => !st.avisados.has(claveAl(c))) : [];
    const r = reglaAl();
    const repite = r.repetir > 0 && pend.length && Date.now() - st.ultimoSonido > r.repetir * 60000;
    if ((nuevas.length || repite) && r.sonido && sonidoActivo()) { sonar(); st.ultimoSonido = Date.now(); }
    st.avisados = new Set(pend.map(claveAl));
    const ban = el.querySelector('#wa-banner');
    if (ban) {
      ban.hidden = !pend.length;
      if (pend.length) {
        const masAntigua = [...pend].sort((a, b) => espera(a) - espera(b))[0];
        ban.innerHTML = `<b>🔔 ${pend.length} ${pend.length === 1 ? 'conversación requiere' : 'conversaciones requieren'} a una persona · toque para abrir</b><small>${esc(tituloConv(masAntigua))} · ${esc(TIPO_TXT[tipoAlerta(masAntigua)])}</small>`;
      }
    }
    const pill = el.querySelector('.wa-pildoras button[data-f="atencion"]');
    if (pill) pill.textContent = pend.length ? `Atención (${pend.length})` : 'Atención';
    document.title = pend.length && document.hidden ? `(${pend.length}) ⚠ ${st.tituloOriginal}` : st.tituloOriginal;
  }
  function ajustarAlto() {
    const g = el.querySelector('.wa-grid'); if (!g) return;
    if (window.innerWidth <= 760) { g.style.height = ''; return; }
    g.style.height = Math.max(440, window.innerHeight - g.getBoundingClientRect().top - 14) + 'px';
  }
  window.addEventListener('resize', () => { if (el.querySelector('.wa-grid')) ajustarAlto(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = st.tituloOriginal; });

  async function cargarLista() {
    if (st.pestana !== 'chats') return;
    const { data, error } = await supabase.from('agenda_wa_conversaciones').select('*').eq('empresa_id', empresaId).order('ultimo_en', { ascending: false }).limit(200);
    if (error) { el.querySelector('#wa-cuerpo').innerHTML = `<p class="wa-error" role="alert">${esc(mensajeError(error, 'No se pudieron cargar las conversaciones.'))}</p>`; return; }
    st.convs = data || [];
    try { const ab = sessionStorage.getItem('wa_abrir'); if (ab) { sessionStorage.removeItem('wa_abrir'); if (st.convs.some((c) => c.id === ab)) { st.sel = ab; st.firma = ''; st.yaDesplazado = false; } } } catch { /* sin almacenamiento */ }
    pintarLista();
    if (st.sel) await cargarHilo(false);
    detener();
    st.timer = setInterval(async () => {
      if (!el.querySelector('.wa')) return detener(); // se cambió de pantalla: el contenedor sigue existiendo pero ya no es esta vista
      if (document.hidden || st.pestana !== 'chats') return;
      const r = await supabase.from('agenda_wa_conversaciones').select('*').eq('empresa_id', empresaId).order('ultimo_en', { ascending: false }).limit(200);
      if (!r.error) { st.convs = r.data || []; pintarLista(); if (st.sel) await cargarHilo(false); }
    }, 8000);
  }
  function detener() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

  function visibles() {
    const q = st.buscar.trim().toLowerCase();
    return st.convs.filter((c) => {
      if (q && !`${c.nombre || ''} ${c.telefono} ${c.inmueble_numero || ''}`.toLowerCase().includes(q)) return false;
      if (st.fTema && c.tema_id !== st.fTema) return false;
      if (st.fAses && c.asesor_id !== st.fAses) return false;
      if (st.filtro === 'mias') return !!c.asesor_id && c.asesor_id === st.meta.yo && c.estado !== 'cerrada';
      if (st.filtro === 'cola') return !c.asesor_id && c.estado !== 'cerrada';
      if (st.filtro === 'pendientes') return c.estado !== 'cerrada';
      if (st.filtro === 'resueltas') return c.estado === 'cerrada';
      if (st.filtro === 'atencion') return c.estado !== 'cerrada' && (c.requiere_atencion || c.sin_leer > 0);
      if (st.filtro === 'pausadas') return !c.ia_activa;
      if (st.filtro === 'prueba') return c.es_prueba;
      return true;
    });
  }

  function pintarLista() {
    const ul = el.querySelector('#wa-items');
    if (!ul) return;
    el.querySelector('.wa-grid')?.classList.toggle('wa-ver-chat', !!st.sel); // en móvil: o la lista o el chat
    const v = ordenar(visibles());
    ul.innerHTML = v.length ? v.map((c) => `<li><button type="button" class="wa-item ${c.id === st.sel ? 'wa-sel' : ''} ${esAlerta(c) ? 'wa-alerta' : ''} ${c.estado === 'cerrada' ? 'wa-cerrada' : ''}" data-id="${esc(c.id)}">
      <span class="wa-av" style="background:${colorDe(c)}" aria-hidden="true">${esc(iniciales(c))}</span>
      <span class="wa-nom">${esc(tituloConv(c))}${c.es_prueba ? '<em>prueba</em>' : ''}</span>
      <span class="wa-fecha ${c.sin_leer ? 'wa-nuevo-f' : ''}">${esc(fechaLista(c.ultimo_en))}</span>
      <span class="wa-sub"><span class="wa-ult">${esc(c.ultimo_texto || '')}</span>
        ${c.estado === 'cerrada' ? '<b class="wa-chip wa-res">✓ Resuelta</b>' : ''}${c.estado === 'cerrada' ? '' : c.ia_activa ? '<b class="wa-chip wa-ia" title="La atiende la IA">🤖 IA</b>' : '<b class="wa-chip">Pausada</b>'}${venceVentana(c) ? '<b class="wa-chip wa-vence" title="Pasaron más de 24 h desde el último mensaje del cliente: solo se le puede escribir con una plantilla">⏳ 24 h vencidas</b>' : ''}${c.sin_leer ? `<b class="wa-badge" aria-label="${c.sin_leer} sin leer">${c.sin_leer}</b>` : ''}</span></button></li>`).join('')
      : '<li class="wa-vacio">No hay conversaciones con este filtro.</li>';
    // Segunda línea de la lista: perfil del contacto y quién la atiende (para ver de un vistazo a quién le toca).
    ul.querySelectorAll('.wa-item').forEach((b) => {
      const c = st.convs.find((x) => x.id === b.dataset.id);
      const etiquetas = [...(c && esAlerta(c) ? [`<b class="wa-chip wa-aten">🔔 ${esc(TIPO_TXT[tipoAlerta(c)])}</b>`] : []), ...(c?.perfiles || []).map((p) => `<b class="wa-chip wa-perfil">${esc(PERFILES[p] || p)}</b>`), c?.asesor_id ? `<b class="wa-chip wa-asesor">👤 ${esc(nombreAsesor(c.asesor_id) || 'Asignada')}</b>` : '<b class="wa-chip wa-cola">Sin asignar</b>'];
      b.insertAdjacentHTML('beforeend', `<span class="wa-etiquetas">${etiquetas.join('')}</span>`);
    });
    ul.querySelectorAll('.wa-item').forEach((b) => b.addEventListener('click', async () => { st.sel = b.dataset.id; st.firma = ''; st.yaDesplazado = false; pintarLista(); await cargarHilo(true); }));
    revisarAlertas();
  }

  // Fotos, notas de voz y documentos: se piden con un enlace temporal firmado (el almacenamiento es privado).
  function medio(m) {
    if (!m.media_path) return '';
    const mime = String(m.media_mime || '');
    const tipo = mime.startsWith('image/') ? 'img' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'doc';
    return `<div class="wa-media wa-media-${tipo}" data-ruta="${esc(m.media_path)}" data-tipo="${tipo}" data-nombre="${esc(m.media_nombre || 'archivo')}">${tipo === 'audio' ? '🎤 Cargando nota de voz…' : tipo === 'img' ? '📷 Cargando foto…' : '📄 Cargando archivo…'}</div>`;
  }
  async function cargarMedios(hilo) {
    for (const nodo of hilo.querySelectorAll('.wa-media[data-ruta]')) {
      const ruta = nodo.dataset.ruta;
      let url = st.urls[ruta];
      if (!url) {
        const r = await supabase.storage?.from('whatsapp-media').createSignedUrl(ruta, 3600);
        url = r?.data?.signedUrl; if (url) st.urls[ruta] = url;
      }
      if (!url) { nodo.textContent = 'No se pudo abrir el archivo'; continue; }
      if (nodo.dataset.tipo === 'img') nodo.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Foto enviada" loading="lazy"></a>`;
      else if (nodo.dataset.tipo === 'audio') nodo.innerHTML = `<audio controls preload="none" src="${esc(url)}"></audio>`;
      else if (nodo.dataset.tipo === 'video') nodo.innerHTML = `<video controls preload="none" src="${esc(url)}"></video>`;
      else nodo.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">📄 ${esc(nodo.dataset.nombre)}</a>`;
    }
  }

  function burbujas(msgs) {
    let ultimoDia = '';
    return msgs.map((m) => {
      const dia = diaClave(m.creado_en);
      const sep = dia !== ultimoDia ? `<div class="wa-dia">${esc(etiquetaDia(m.creado_en))}</div>` : '';
      ultimoDia = dia;
      if (m.tipo === 'evento') return `${sep}<div class="wa-evento">${esc(m.texto)} · ${esc(horaCorta(m.creado_en))}</div>`;
      const sale = m.direccion !== 'entrada';
      const quien = sale ? (m.origen === 'asesor' && m.autor_nombre ? m.autor_nombre : ORIGEN[m.origen] || m.origen) : '';
      const tick = sale && m.estado_envio !== 'fallido' ? '<span class="wa-tick" aria-label="Enviado">✓✓</span>' : '';
      return `${sep}<div class="wa-m wa-${sale ? 'out' : 'in'} wa-o-${esc(m.origen)}">${quien ? `<span class="wa-quien">${esc(quien)}</span>` : ''}${medio(m)}${m.texto || !m.media_path ? `<p>${esc(m.texto || (m.media_error ? '' : '[' + m.tipo + ']'))}</p>` : ''}${m.media_error ? `<small class="wa-fallo">No se pudo guardar el archivo (${esc(m.media_error)})</small>` : ''}
        <span class="wa-pie">${m.estado_envio === 'fallido' ? '<b class="wa-fallo">no se envió</b>' : ''}${esc(horaCorta(m.creado_en))} ${tick}</span>${m.error ? `<small class="wa-fallo">${esc(m.error)}</small>` : ''}</div>`;
    }).join('');
  }

  async function cargarHilo(irAbajo) {
    const conv = st.convs.find((c) => c.id === st.sel);
    const hilo = el.querySelector('#wa-hilo');
    if (!conv || !hilo) return;
    const { data, error } = await supabase.from('agenda_wa_mensajes').select('*').eq('conversacion_id', conv.id).order('creado_en', { ascending: true }).limit(500);
    if (error) { hilo.innerHTML = `<p class="wa-error" role="alert">${esc(mensajeError(error, 'No se pudo cargar el hilo.'))}</p>`; return; }
    const msgs = data || [];
    const firma = `${conv.id}|${msgs.length}|${conv.ia_activa}|${conv.estado}|${conv.asesor_id}|${conv.tema_id}|${conv.alerta}|${(conv.perfiles || []).join(',')}|${conv.inmueble_numero}|${msgs[msgs.length - 1]?.id || ''}`;
    if (!irAbajo && firma === st.firma) return; // nada cambió: no se repinta (conserva lo que se está escribiendo)
    st.firma = firma;
    const borrador = hilo.querySelector('#wa-texto')?.value || '';
    const ventana = dentroDe24h(conv.ultimo_cliente_en);
    const temaDe = st.meta.temas.find((t) => t.id === conv.tema_id);
    const rapidas = Array.isArray(st.cfg.respuestas_rapidas) ? st.cfg.respuestas_rapidas : [];
    const plantillas = Array.isArray(st.cfg.plantillas) ? st.cfg.plantillas : [];
    hilo.innerHTML = `<header class="wa-hcab"><button type="button" class="wa-icono wa-atras" id="wa-atras" aria-label="Volver a los chats">←</button><span class="wa-av" style="background:${colorDe(conv)}" aria-hidden="true">${esc(iniciales(conv))}</span>
      <div><strong>${esc(tituloConv(conv))}</strong><small>+${esc(conv.telefono)}${conv.es_prueba ? ' · número de prueba' : ''}${conv.asesor_id ? ` · Atiende ${esc(nombreAsesor(conv.asesor_id) || 'un asesor')}` : ' · Sin asignar'}${temaDe ? ` · ${esc(temaDe.nombre)}` : ''}</small>
        ${(conv.perfiles || []).length ? `<div class="wa-etiquetas">${conv.perfiles.map((p) => `<b class="wa-chip wa-perfil">${esc(PERFILES[p] || p)}</b>`).join('')}</div>` : ''}</div>
      <div class="wa-hacc">${poder && puedeTomar && !conv.asesor_id && st.meta.yo ? '<button type="button" class="wa-resolver" id="wa-tomar" title="Quedarte con esta conversación: la IA queda en pausa y la atiendes tú">✋ Tomar</button>' : ''}${poder && puedeTransferir && (conv.asesor_id === st.meta.yo || verTodas) ? '<button type="button" class="wa-resolver" id="wa-transferir" title="Pasar la conversación a otro asesor">↪ Transferir</button>' : ''}${poder ? `<button type="button" class="wa-resolver ${conv.estado === 'cerrada' ? 'wa-reabrir' : ''}" id="wa-resolver" title="${conv.estado === 'cerrada' ? 'Volver a dejar esta conversación como pendiente' : 'El tema quedó resuelto: sale de pendientes'}">${conv.estado === 'cerrada' ? '↩ Reabrir' : '✓ Marcar resuelta'}</button>` : ''}${poder ? `<button type="button" class="wa-interr" id="wa-ia" aria-pressed="${conv.ia_activa}" title="Cuando la IA está activa responde sola; al pausarla, atiende una persona"><i aria-hidden="true"></i>${conv.ia_activa ? 'IA activa' : 'IA en pausa'}</button>` : `<span class="wa-chip ${conv.ia_activa ? 'wa-ia-on' : ''}">${conv.ia_activa ? 'IA activa' : 'IA en pausa'}</span>`}${poder ? '<button type="button" class="wa-icono" id="wa-herr-btn" title="Tema, etiquetas, ofrecer inmuebles y enlaces" aria-label="Más acciones">⋮</button>' : ''}</div></header>
      ${conv.estado === 'cerrada' ? `<p class="wa-aviso wa-aviso-ok">✓ Resuelta${conv.nota_cierre ? ': ' + esc(conv.nota_cierre) : ''}. Si el cliente escribe de nuevo, se reabre sola.</p>` : ''}
      ${conv.motivo_pausa && !conv.ia_activa ? `<p class="wa-aviso">${esc(conv.motivo_pausa)}</p>` : ''}
      ${conv.alerta === 'inmueble_no_identificado' ? '<p class="wa-aviso wa-aviso-alerta">⚠ La IA no identificó el inmueble del que habla el cliente. Pregúntale cuál es, o usa los botones de abajo para enviarle el enlace de agendamiento (escribe el número del inmueble) o el de consignar. Queda registrado como caso para corregir.</p>' : ''}
      <div id="wa-panel" class="wa-panel" hidden></div>
      <div class="wa-msgs" id="wa-msgs">${burbujas(msgs)}</div>
      ${poder ? `<div class="wa-mas-panel" id="wa-mas" ${st.masAbierto ? '' : 'hidden'}><strong class="wa-mas-tit">Acciones de esta conversación</strong><div class="wa-herr">${st.meta.temas.length ? `<label>Tema <select id="wa-tema"><option value="">Sin tema</option>${st.meta.temas.map((t) => `<option value="${esc(t.id)}" ${conv.tema_id === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}<button type="button" class="wa-sec-btn" id="wa-etiquetar">🏷 Etiquetas e inmueble</button>${conv.inmueble_numero ? `<button type="button" class="wa-sec-btn" id="wa-ficha">📋 Ficha del inmueble ${esc(conv.inmueble_numero)}</button>` : ''}</div>${ventana ? `<div class="wa-enlaces" aria-label="Ofrecer inmuebles"><span class="wa-enl-ofrecer"><label for="wa-ofrecer-num">Ofrecer inmueble(s):</label><input id="wa-ofrecer-num" type="text" maxlength="40" placeholder="Ej. 500, 501" aria-label="Números de inmueble"><button type="button" class="wa-sec-btn wa-destacado" id="wa-ofrecer" title="Envía la ficha de cada inmueble con su enlace de visita. La IA sigue atendiendo con esa información.">📨 Pasar información</button></span>${rapidas.length ? `<select id="wa-rapidas" aria-label="Respuestas rápidas"><option value="">💬 Respuestas rápidas…</option>${rapidas.map((r, i) => `<option value="${i}">${esc(r.titulo)}</option>`).join('')}</select>` : ''}</div>
      <div class="wa-enlaces" aria-label="Enlaces rápidos"><span>Enviar enlace:</span><button type="button" class="wa-sec-btn" id="wa-enl-consignar" title="Enlace para que un propietario consigne su inmueble">🏡 Consignar inmueble</button><span class="wa-enl-cita"><input id="wa-enl-num" type="text" inputmode="numeric" maxlength="8" placeholder="Nº inmueble" aria-label="Número del inmueble"><button type="button" class="wa-sec-btn" id="wa-enl-cita" title="Enlace para ver el inmueble y agendar la visita">📅 Agendar visita</button></span></div>` : ''}</div>` : ''}
      ${poder && ventana ? '<div id="wa-revision" class="wa-revision" hidden></div>' : ''}
      ${poder ? (ventana ? `<form id="wa-form" class="wa-form"><button type="button" class="wa-mas-btn" id="wa-mas-btn" aria-label="Más acciones" title="Etiquetas, ofrecer inmuebles y enlaces">＋</button><textarea id="wa-texto" rows="1" maxlength="4000" placeholder="Escribe un mensaje. Al enviar, la IA queda en pausa en este chat." aria-label="Mensaje"></textarea><button class="wa-enviar" type="submit" aria-label="Enviar">➤</button></form>`
        : `<div class="wa-form wa-fuera"><p>Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo deja enviar una <strong>plantilla aprobada</strong>.</p>${plantillas.length ? `<select id="wa-plant" aria-label="Plantilla">${plantillas.map((p, i) => `<option value="${i}">${esc(p.nombre)} — ${esc(String(p.texto || '').slice(0, 60))}</option>`).join('')}</select><div id="wa-pars"></div><button type="button" id="wa-env-plant">Enviar plantilla</button>` : '<p>Aún no hay plantillas registradas (Ajustes e interruptor).</p>'}</div>`) : '<p class="wa-solo-ver">Solo puedes ver esta conversación.</p>'}`;
    const alternarMas = () => { const p = hilo.querySelector('#wa-mas'); if (!p) return; p.hidden = !p.hidden; st.masAbierto = !p.hidden; };
    hilo.querySelector('#wa-mas-btn')?.addEventListener('click', alternarMas);
    hilo.querySelector('#wa-herr-btn')?.addEventListener('click', alternarMas);
    hilo.querySelector('#wa-atras')?.addEventListener('click', () => { st.sel = null; hilo.innerHTML = '<p class="v-muted">Elige una conversación para verla aquí.</p>'; pintarLista(); });
    cargarMedios(hilo);
    const caja = hilo.querySelector('#wa-msgs');
    if (caja) caja.scrollTop = irAbajo || !st.yaDesplazado ? caja.scrollHeight : caja.scrollTop;
    st.yaDesplazado = true;
    const t = hilo.querySelector('#wa-texto');
    if (t) {
      if (borrador) t.value = borrador;
      t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; });
      t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); hilo.querySelector('#wa-form').requestSubmit(); } });
    }
    if (conv.sin_leer) { supabase.rpc('agenda_wa_marcar_leida', { p_conv: conv.id }).then(() => { conv.sin_leer = 0; pintarLista(); }); }
    hilo.querySelector('#wa-resolver')?.addEventListener('click', async () => {
      const resolver = conv.estado !== 'cerrada';
      const nota = resolver ? window.prompt('¿Quieres dejar una nota de cierre? (opcional: qué se resolvió o qué quedó acordado)', '') : '';
      if (nota === null) return;
      const { error: e } = await supabase.rpc('agenda_wa_resolver', { p_conv: conv.id, p_resuelta: resolver, p_nota: nota || null });
      if (e) return toast?.(mensajeError(e, 'No se pudo cambiar.'));
      toast?.(resolver ? 'Marcada como resuelta.' : 'Conversación reabierta.');
      await cargarLista(); await cargarHilo(true);
    });
    hilo.querySelector('#wa-ia')?.addEventListener('click', async () => {
      const activar = !conv.ia_activa;
      const { error: e } = await supabase.rpc('agenda_wa_set_ia', { p_conv: conv.id, p_activa: activar });
      if (e) return toast?.(mensajeError(e, 'No se pudo cambiar.'));
      toast?.(activar ? 'La IA volvió a responder.' : 'IA en pausa: atiendes tú.');
      await cargarLista(); await cargarHilo(true);
    });
    // ---- Asesores: tomar, transferir, tema, etiquetas y enlaces rápidos ----
    const panel = hilo.querySelector('#wa-panel');
    const refrescar = async () => { await cargarLista(); await cargarHilo(true); };
    const fallo = async (e, d) => { let m = e?.message; if (e?.context?.json) { try { m = (await e.context.json())?.error || m; } catch { /* sin detalle */ } } toast?.(m || d); };
    hilo.querySelector('#wa-tomar')?.addEventListener('click', async () => {
      const { error: e } = await supabase.rpc('agenda_wa_tomar', { p_conv: conv.id });
      if (e) return toast?.(mensajeError(e, 'No se pudo tomar la conversación.'));
      toast?.('La conversación quedó asignada a ti. La IA está en pausa.'); await refrescar();
    });
    hilo.querySelector('#wa-transferir')?.addEventListener('click', () => {
      const lista = st.meta.asesores.filter((a) => !a.yo && a.id !== conv.asesor_id);
      panel.hidden = false;
      panel.innerHTML = `<strong>Transferir la conversación</strong>
        <select id="wa-tr-quien" aria-label="Asesor">${lista.map((a) => `<option value="${esc(a.id)}" ${a.permitido ? '' : 'disabled'}>${esc(a.nombre)} (${esc(a.rol)})${a.permitido ? '' : ' — sin permiso'}</option>`).join('') || '<option value="">No hay a quién transferir</option>'}</select>
        <input id="wa-tr-nota" maxlength="300" placeholder="Nota para quien la recibe (opcional)" aria-label="Nota">
        <div class="wa-rev-acc"><button type="button" class="wa-rev-btn" id="wa-tr-ok">Transferir</button><button type="button" class="wa-rev-btn wa-sec" id="wa-tr-no">Cancelar</button></div>`;
      panel.querySelector('#wa-tr-no').onclick = () => { panel.hidden = true; panel.innerHTML = ''; };
      panel.querySelector('#wa-tr-ok').onclick = async () => {
        const quien = panel.querySelector('#wa-tr-quien').value;
        if (!quien) return;
        const { error: e } = await supabase.rpc('agenda_wa_transferir', { p_conv: conv.id, p_asesor: quien, p_nota: panel.querySelector('#wa-tr-nota').value.trim() || null });
        if (e) return toast?.(mensajeError(e, 'No se pudo transferir.'));
        toast?.('Conversación transferida.'); st.sel = null; await cargarLista(); el.querySelector('#wa-hilo').innerHTML = '<p class="v-muted">Elige una conversación para verla aquí.</p>';
      };
    });
    hilo.querySelector('#wa-tema')?.addEventListener('change', async (ev) => {
      const { error: e } = await supabase.rpc('agenda_wa_cambiar_tema', { p_conv: conv.id, p_tema: ev.target.value || null });
      if (e) return toast?.(mensajeError(e, 'No se pudo cambiar el tema.'));
      toast?.('Tema actualizado.'); await refrescar();
    });
    hilo.querySelector('#wa-etiquetar')?.addEventListener('click', () => {
      panel.hidden = false;
      panel.innerHTML = `<strong>Etiquetas de la conversación</strong>
        <div class="wa-checks">${Object.entries(PERFILES).map(([k, t]) => `<label><input type="checkbox" value="${k}" ${(conv.perfiles || []).includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
        <label>Inmueble Nº <input id="wa-et-inm" type="text" inputmode="numeric" maxlength="8" value="${esc(conv.inmueble_numero || '')}" placeholder="opcional"></label>
        <div class="wa-rev-acc"><button type="button" class="wa-rev-btn" id="wa-et-ok">Guardar</button><button type="button" class="wa-rev-btn wa-sec" id="wa-et-no">Cancelar</button></div>`;
      panel.querySelector('#wa-et-no').onclick = () => { panel.hidden = true; panel.innerHTML = ''; };
      panel.querySelector('#wa-et-ok').onclick = async () => {
        const perfiles = [...panel.querySelectorAll('.wa-checks input:checked')].map((i) => i.value);
        const n = parseInt(panel.querySelector('#wa-et-inm').value.replace(/\D/g, ''), 10);
        const { error: e } = await supabase.rpc('agenda_wa_etiquetar', { p_conv: conv.id, p_perfiles: perfiles, p_inmueble: n > 0 ? n : null });
        if (e) return toast?.(mensajeError(e, 'No se pudieron guardar las etiquetas.'));
        toast?.('Etiquetas guardadas.'); await refrescar();
      };
    });
    const enviarEnlace = async (enlace) => {
      const { data: r, error: e } = await supabase.functions.invoke('whatsapp-enviar', { body: { conversacion_id: conv.id, enlace } });
      if (e || r?.ok === false) return fallo(e, r?.error || 'No se pudo enviar el enlace.');
      toast?.('Enlace enviado.'); await refrescar();
    };
    // Ofrecer inmuebles por su número: envía la ficha de cada uno y la IA sigue con ellos como contexto.
    hilo.querySelector('#wa-ofrecer')?.addEventListener('click', async () => {
      const txt = hilo.querySelector('#wa-ofrecer-num').value.trim();
      if (!/\d/.test(txt)) return toast?.('Escribe el número de uno o más inmuebles, por ejemplo: 500, 501.');
      const b = hilo.querySelector('#wa-ofrecer'); b.disabled = true;
      const { data: r, error: e } = await supabase.functions.invoke('whatsapp-enviar', { body: { conversacion_id: conv.id, enlace: { tipo: 'ficha', inmuebles: txt } } });
      b.disabled = false;
      if (e || r?.ok === false) return fallo(e, r?.error || 'No se pudo enviar la información.');
      toast?.(`Información enviada${r?.no_disponibles?.length ? ` (no disponibles: ${r.no_disponibles.join(', ')})` : ''}. La IA sigue atendiendo con ese inmueble.`); await refrescar();
    });
    hilo.querySelector('#wa-rapidas')?.addEventListener('change', (ev) => {
      const r = rapidas[Number(ev.target.value)]; ev.target.value = '';
      const t2 = hilo.querySelector('#wa-texto'); if (!r || !t2) return;
      const yoNombre = st.meta.asesores.find((a) => a.yo)?.nombre || '';
      t2.value = String(r.texto || '').replaceAll('{{nombre}}', String(conv.nombre || '').split(' ')[0] || '').replaceAll('{{inmueble}}', conv.inmueble_numero || '').replaceAll('{{asesor}}', yoNombre);
      t2.dispatchEvent(new Event('input')); t2.focus();
    });
    hilo.querySelector('#wa-ficha')?.addEventListener('click', async () => {
      panel.hidden = false; panel.innerHTML = '<p class="wa-rev-carga">Cargando la ficha…</p>';
      const { data: f, error: e } = await supabase.rpc('agenda_wa_ficha_inmueble', { p_conv: conv.id });
      if (e || !f) { panel.innerHTML = `<p>${esc(mensajeError(e, 'No se pudo cargar la ficha.'))}</p>`; return; }
      if (f.existe === false) { panel.innerHTML = `<p>El inmueble Nº ${esc(f.numero)} no existe en la plataforma.</p>`; return; }
      const plata = (v) => (Number(v) > 0 ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v)) : '—');
      panel.innerHTML = `<div class="wa-ficha"><strong>Inmueble Nº ${esc(f.numero)} · ${esc(f.tipo || '')} en ${esc(String(f.tipo_oferta || '').toLowerCase())}</strong>
        <p>${esc(f.zona || f.direccion || '')}${f.ciudad ? ', ' + esc(f.ciudad) : ''} · ${esc(f.habitaciones ?? '–')} alc. · ${esc(f.banos ?? '–')} baños · ${esc(f.parqueaderos ?? '–')} parq. · ${esc(plata(f.valor))}</p>
        <p>${f.disponible ? '<b class="wa-chip wa-res">Disponible</b>' : '<b class="wa-chip wa-aten">No disponible</b>'} ${f.estado ? `<b class="wa-chip">${esc(f.estado)}</b>` : ''}</p>
        ${f.arrendatario ? `<p>Arrendado a <b>${esc(f.arrendatario.nombre || '—')}</b>${f.arrendatario.vencimiento_contrato ? ` · contrato vence ${esc(f.arrendatario.vencimiento_contrato)}` : ''}</p>` : ''}
        ${(f.propietarios || []).length ? `<p>Propietario${f.propietarios.length > 1 ? 's' : ''}: ${esc(f.propietarios.join(', '))}</p>` : ''}
        ${(f.proximas_citas || []).length ? `<p>Próximas visitas: ${f.proximas_citas.map((c) => `${esc(c.fecha)} ${esc(c.hora)}`).join(' · ')}</p>` : '<p class="v-muted">Sin visitas próximas agendadas.</p>'}
        <div class="wa-rev-acc"><button type="button" class="wa-rev-btn wa-sec" id="wa-ficha-no">Cerrar</button></div></div>`;
      panel.querySelector('#wa-ficha-no').onclick = () => { panel.hidden = true; panel.innerHTML = ''; };
    });
    hilo.querySelector('#wa-enl-consignar')?.addEventListener('click', () => enviarEnlace({ tipo: 'consignar' }));
    hilo.querySelector('#wa-enl-cita')?.addEventListener('click', () => {
      const n = hilo.querySelector('#wa-enl-num').value.trim();
      if (!/^\d+$/.test(n)) return toast?.('Escribe el número del inmueble (solo dígitos).');
      enviarEnlace({ tipo: 'cita', inmueble: n });
    });
    const panelRev = hilo.querySelector('#wa-revision');
    const cerrarPanel = () => { if (panelRev) { panelRev.hidden = true; panelRev.innerHTML = ''; } };
    const enviarTexto = async (texto) => {
      const btn = hilo.querySelector('.wa-enviar'); if (btn) btn.disabled = true;
      const { data: r, error: e } = await supabase.functions.invoke('whatsapp-enviar', { body: { conversacion_id: conv.id, texto } });
      if (btn) btn.disabled = false;
      if (e || r?.ok === false) { let m = r?.error; if (!m && e?.context?.json) { try { m = (await e.context.json())?.error; } catch { /* sin detalle */ } } toast?.(m || mensajeError(e, 'No se pudo enviar.')); return; }
      hilo.querySelector('#wa-texto').value = '';
      cerrarPanel();
      await cargarLista(); await cargarHilo(true);
    };
    // Revisión con IA antes de enviar (si la empresa la tiene encendida): el asesor ve el texto sugerido y decide.
    const revisar = async (texto) => {
      panelRev.className = 'wa-revision';
      panelRev.hidden = false;
      panelRev.innerHTML = '<p class="wa-rev-carga">✨ La IA está revisando tu mensaje…</p>';
      const { data: r, error: e } = await supabase.functions.invoke('whatsapp-redactar', { body: { accion: 'revisar', conversacion_id: conv.id, texto } });
      if (e || !r?.ok) {
        // Si la revisión falla no se bloquea el trabajo: se avisa y se deja enviar.
        panelRev.innerHTML = `<p class="wa-rev-carga">No se pudo revisar con la IA (${esc(r?.error || mensajeError(e, 'sin conexión'))}).</p>
          <div class="wa-rev-acc"><button type="button" class="wa-rev-btn" data-r="mio">Enviar mi mensaje</button><button type="button" class="wa-rev-btn wa-sec" data-r="cerrar">Seguir editando</button></div>`;
      } else {
        const igual = r.texto_sugerido.trim() === texto.trim();
        panelRev.className = `wa-revision wa-rev-${r.veredicto}`;
        const titulo = r.veredicto === 'ok' ? '✅ Tu mensaje está bien' : r.veredicto === 'no_enviar' ? '⚠️ Atención: este mensaje puede tener un problema' : '✨ Sugerencia de la IA';
        panelRev.innerHTML = `<div class="wa-rev-tit">${titulo}</div>
          ${r.alertas.length ? `<ul class="wa-rev-alertas">${r.alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          ${igual ? '' : `<div class="wa-rev-sug"><span>Texto sugerido</span><p>${esc(r.texto_sugerido)}</p></div>`}
          ${r.cambios.length ? `<ul class="wa-rev-cambios">${r.cambios.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
          <div class="wa-rev-acc">${igual ? '' : '<button type="button" class="wa-rev-btn" data-r="sug">Usar el sugerido y enviar</button><button type="button" class="wa-rev-btn wa-sec" data-r="editar">Pasarlo a la caja para editarlo</button>'}
            ${igual || !r.errores_ortografia ? `<button type="button" class="wa-rev-btn ${igual ? '' : 'wa-sec'}" data-r="mio">${igual ? 'Enviar' : 'Enviar el mío'}</button>` : '<p class="wa-rev-cli">Hay faltas de ortografía: use el sugerido o corrija su mensaje para poder enviarlo.</p>'}<button type="button" class="wa-rev-btn wa-sec" data-r="cerrar">Seguir editando</button></div>`;
        panelRev.querySelector('[data-r=sug]')?.addEventListener('click', () => enviarTexto(r.texto_sugerido));
        panelRev.querySelector('[data-r=editar]')?.addEventListener('click', () => { const t2 = hilo.querySelector('#wa-texto'); t2.value = r.texto_sugerido; t2.dispatchEvent(new Event('input')); cerrarPanel(); t2.focus(); });
        panelRev.querySelector('[data-r=mio]')?.addEventListener('click', () => {
          if (r.veredicto === 'no_enviar' && !window.confirm('La IA avisó que este mensaje puede ir contra las normas o la ley. ¿Seguro que quieres enviarlo tal cual?')) return;
          enviarTexto(texto);
        });
      }
      panelRev.querySelector('[data-r=cerrar]')?.addEventListener('click', () => { cerrarPanel(); hilo.querySelector('#wa-texto')?.focus(); });
      if (!r?.ok) panelRev.querySelector('[data-r=mio]')?.addEventListener('click', () => enviarTexto(texto));
    };
    hilo.querySelector('#wa-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const texto = hilo.querySelector('#wa-texto').value.trim();
      if (!texto) return;
      if (st.cfg.revisar_mensajes_asesor === false) { await enviarTexto(texto); return; }
      await revisar(texto);
    });
    const sel = hilo.querySelector('#wa-plant');
    if (sel) {
      const pintarPars = () => {
        const p = plantillas[Number(sel.value)];
        const n = Math.max(0, ...(String(p?.texto || '').match(/\{\{(\d+)\}\}/g) || []).map((x) => Number(x.replace(/\D/g, ''))));
        hilo.querySelector('#wa-pars').innerHTML = Array.from({ length: n }, (_, i) => `<input class="wa-par" placeholder="Valor de {{${i + 1}}}" aria-label="Valor ${i + 1}">`).join('');
      };
      sel.addEventListener('change', pintarPars); pintarPars();
      hilo.querySelector('#wa-env-plant').addEventListener('click', async () => {
        const p = plantillas[Number(sel.value)];
        const parametros = [...hilo.querySelectorAll('.wa-par')].map((i) => i.value.trim());
        if (parametros.some((x) => !x)) return toast?.('Completa los valores de la plantilla.');
        const { data: r, error: e } = await supabase.functions.invoke('whatsapp-enviar', { body: { conversacion_id: conv.id, plantilla: { nombre: p.nombre, parametros } } });
        if (e || r?.ok === false) return toast?.(r?.error || mensajeError(e, 'No se pudo enviar la plantilla.'));
        toast?.('Plantilla enviada.'); await cargarLista(); await cargarHilo(true);
      });
    }
  }
}
