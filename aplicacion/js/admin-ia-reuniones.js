// Pestañas de Configuración: «Inteligencia artificial» (filtro de opiniones) y «Reuniones virtuales» (Meet/Teams/Zoom).
// Módulo aparte de administracion.js a propósito: cada pestaña nueva de Configuración debería vivir en su propio archivo
// y administracion.js solo la registra (botón en el HTML + una línea en abrirSubtab).
// Todas las claves y credenciales se guardan en Vault vía RPC; el navegador nunca las vuelve a recibir.
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ctx = { el, empresaId, aviso(texto, error?), vigente() } — vigente() devuelve false si el usuario ya cambió de pestaña.
const PROVEEDORES_IA = {
  anthropic: { nombre: 'Anthropic (Claude)', modelo: 'claude-haiku-5-5', prefijo: 'sk-ant-…', ayuda: 'Crea la clave en console.anthropic.com → API keys.' },
  openai: { nombre: 'OpenAI (ChatGPT)', modelo: 'gpt-4o-mini', prefijo: 'sk-…', ayuda: 'Crea la clave en platform.openai.com → API keys.' },
  google: { nombre: 'Google (Gemini)', modelo: 'gemini-2.0-flash', prefijo: 'AIza…', ayuda: 'Crea la clave en aistudio.google.com → Get API key.' },
};

export async function iaTab(ctx) {
  const { el, empresaId, aviso, vigente } = ctx;
  el.innerHTML = '<p class="ad-muted">Cargando…</p>';
  const { data: estado, error } = await supabase.rpc('agenda_ia_estado', { p_empresa_id: empresaId });
  if (!vigente()) return;
  if (error) { el.innerHTML = '<p class="error">No se pudo leer el estado de la inteligencia artificial. Aplica primero los SQL 028 y 030.</p>'; return; }
  const c = estado.comentarios || {};
  const tiene = estado.tiene_clave;
  const prov = PROVEEDORES_IA[estado.proveedor] ? estado.proveedor : 'anthropic';
  el.innerHTML = `<h2>Inteligencia artificial</h2>
 <p>Cuando un cliente deja un comentario en la encuesta, la IA lo revisa antes de que el propietario lo lea en su informe: conserva solo lo que dice <strong>del inmueble</strong> y quita críticas o comentarios sobre la inmobiliaria o los asesores, datos personales e insultos. El comentario original lo ve solo la administración en la Bitácora.</p>
 <div class="ad-correo-estado ${tiene && estado.activa ? 'ad-correo-estado-ok' : 'ad-correo-estado-pendiente'}">${tiene ? (estado.activa ? `✅ Filtro activo con ${esc(PROVEEDORES_IA[prov].nombre)} — los comentarios se revisan automáticamente (cada 10 minutos aprox.).` : '⏸ Hay una clave guardada, pero el filtro está apagado.') : '⚠️ Sin clave: los comentarios de los clientes no se muestran a los propietarios hasta que configures una.'}</div>
 <form id="ad-ia-form">
  <div class="ad-grid">
   <label>Proveedor de IA<select name="ia_proveedor">${Object.entries(PROVEEDORES_IA).map(([k, v]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${v.nombre}</option>`).join('')}</select></label>
   <label>Modelo <small class="ad-muted">(déjalo vacío para usar el recomendado)</small><input name="ia_modelo" value="${esc(estado.modelo || '')}" placeholder="${esc(PROVEEDORES_IA[prov].modelo)}" autocomplete="off"></label>
   <label>Clave de API${tiene ? ' · <small class="ad-muted">ya guardada, deja este campo vacío para conservarla</small>' : ''}<span class="ad-correo-password-row"><input name="ia_clave" type="password" placeholder="${tiene ? '••••••••••••••••' : 'Pega aquí la clave'}" autocomplete="new-password"><button type="button" class="ad-link-btn" data-reveal-ia>Mostrar</button></span></label>
  </div>
  <p class="ad-note" data-ayuda-ia></p>
  <p class="ad-note">La clave queda cifrada en la bóveda de Supabase y no se vuelve a mostrar. Si cambias de proveedor, pega también la clave nueva. El costo es mínimo: una opinión equivale a una fracción de centavo. Los nombres de modelos cambian con el tiempo: si el proveedor retira uno, escribe aquí el vigente.</p>
  <label class="ad-check"><input type="checkbox" name="ia_activa" ${estado.activa ? 'checked' : ''}> Filtrar las opiniones con IA</label>
  <div class="ad-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
   <button type="submit">Guardar</button>
   <button type="button" data-probar-ia ${tiene ? '' : 'disabled'}>Probar la clave</button>
   ${tiene ? '<button type="button" class="ad-link-btn" data-quitar-ia style="color:#B3261E">Quitar la clave</button>' : ''}
  </div>
  <p class="ad-probar-ia-resultado ad-muted" role="status" style="margin-top:8px"></p>
 </form>
 <p class="ad-note">Comentarios: ${c.publicable || 0} publicados · ${c.pendiente || 0} por revisar · ${c.sin_contenido || 0} sin nada del inmueble · ${c.error || 0} con error.</p>`;
  const resultado = el.querySelector('.ad-probar-ia-resultado');
  const selProv = el.querySelector('[name=ia_proveedor]');
  const pintarAyuda = () => {
    const p = PROVEEDORES_IA[selProv.value];
    el.querySelector('[data-ayuda-ia]').textContent = `${p.ayuda} La clave suele empezar por ${p.prefijo}`;
    el.querySelector('[name=ia_modelo]').placeholder = p.modelo;
    el.querySelector('[name=ia_clave]').placeholder = tiene && selProv.value === prov ? '••••••••••••••••' : 'Pega aquí la clave (' + p.prefijo + ')';
  };
  selProv.onchange = pintarAyuda;
  pintarAyuda();
  el.querySelector('[data-reveal-ia]').onclick = (ev) => { const i = el.querySelector('[name=ia_clave]'); const m = i.type === 'password'; i.type = m ? 'text' : 'password'; ev.currentTarget.textContent = m ? 'Ocultar' : 'Mostrar'; };
  el.querySelector('#ad-ia-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.ia_proveedor.value !== prov && tiene && !f.ia_clave.value.trim()) { aviso('Cambiaste de proveedor: pega también la clave de ese proveedor.', true); return; }
    const b = f.querySelector('button[type=submit]');
    b.disabled = true;
    const { error: err } = await supabase.rpc('agenda_guardar_clave_ia', {
      p_empresa_id: empresaId, p_clave: f.ia_clave.value || null, p_activa: f.ia_activa.checked, p_quitar: false,
      p_proveedor: f.ia_proveedor.value, p_modelo: f.ia_modelo.value.trim() || null,
    });
    b.disabled = false;
    if (err) { aviso(err.message || 'No se pudo guardar la clave.', true); return; }
    aviso('Configuración de inteligencia artificial guardada.');
    await iaTab(ctx);
  };
  el.querySelector('[data-probar-ia]').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; resultado.classList.remove('error'); resultado.textContent = 'Probando…';
    try {
      const { data, error: err } = await supabase.functions.invoke('filtrar-opiniones', { body: { empresa_id: empresaId, probar: true } });
      if (err || !data?.ok) { resultado.textContent = '❌ ' + (data?.error || 'No se pudo probar la clave.'); resultado.classList.add('error'); }
      else resultado.textContent = `✅ La clave funciona. Texto de ejemplo ya filtrado: «${data.ejemplo || '(sin contenido)'}»${data.revisados_ahora ? ` · Se revisaron ${data.revisados_ahora} comentarios pendientes.` : ''}`;
    } catch { resultado.textContent = '❌ No se pudo conectar con el servicio.'; resultado.classList.add('error'); }
    b.disabled = false;
  };
  const quitar = el.querySelector('[data-quitar-ia]');
  if (quitar) quitar.onclick = async () => {
    if (!confirm('¿Quitar la clave? Los comentarios nuevos dejarán de mostrarse a los propietarios hasta que guardes otra.')) return;
    const { error: err } = await supabase.rpc('agenda_guardar_clave_ia', { p_empresa_id: empresaId, p_clave: null, p_activa: false, p_quitar: true });
    if (err) { aviso(err.message || 'No se pudo quitar la clave.', true); return; }
    aviso('Clave eliminada.');
    await iaTab(ctx);
  };
}

// ---------------------------------------------------------------------------------------------------------
// Reuniones virtuales. Cada proveedor pide campos distintos; el JSON resultante se guarda completo en Vault.
const PROVEEDORES_REUNION = {
  manual: { nombre: 'Enlace manual (el asesor pega su propio enlace)', campos: [], ayuda: 'No hay que configurar nada: al marcar «reunión virtual» en una cita, el asesor pega el enlace que quiera (Meet, Teams, Zoom, WhatsApp…).' },
  google_meet: {
    nombre: 'Google Meet (Google Workspace)',
    campos: [
      { k: 'client_email', t: 'Correo de la cuenta de servicio', ph: 'nombre@proyecto.iam.gserviceaccount.com' },
      { k: 'private_key', t: 'Clave privada de la cuenta de servicio', ph: '-----BEGIN PRIVATE KEY-----…', area: true },
      { k: 'usuario_organizador', t: 'Correo de Workspace que organiza las reuniones', ph: 'citas@tuempresa.com' },
    ],
    ayuda: 'Necesitas un administrador de Google Workspace. Abajo están los pasos completos, uno por uno.',
    guia: true,
  },
  microsoft_teams: {
    nombre: 'Microsoft Teams (Microsoft 365)',
    campos: [
      { k: 'tenant_id', t: 'ID del directorio (tenant)', ph: '00000000-0000-0000-0000-000000000000' },
      { k: 'client_id', t: 'ID de la aplicación (cliente)', ph: '00000000-0000-0000-0000-000000000000' },
      { k: 'client_secret', t: 'Secreto de la aplicación', ph: '', secreto: true },
      { k: 'usuario_organizador', t: 'Correo del usuario que organiza', ph: 'citas@tuempresa.com' },
    ],
    ayuda: 'Registra una aplicación en Microsoft Entra ID (Azure) con el permiso de aplicación Calendars.ReadWrite y concédele consentimiento de administrador.',
  },
  zoom: {
    nombre: 'Zoom',
    campos: [
      { k: 'account_id', t: 'Account ID', ph: '' },
      { k: 'client_id', t: 'Client ID', ph: '' },
      { k: 'client_secret', t: 'Client Secret', ph: '', secreto: true },
    ],
    ayuda: 'Crea una app «Server-to-Server OAuth» en marketplace.zoom.us con el permiso meeting:write:meeting:admin (o meeting:write:admin) y copia sus tres datos.',
  },
};

// Texto que se copia con el botón «Copiar». El alcance (scope) NO es una página web: es un texto que se pega en un campo de Google.
const ALCANCE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
const copiable = (texto) => `<span class="ad-copiable"><code>${esc(texto)}</code><button type="button" class="ad-secondary" data-copiar="${esc(texto)}">Copiar</button></span>`;

function guiaGoogleMeet() {
  return `<details class="ad-guia" open><summary>Cómo conectar Google Meet, paso a paso</summary>
 <p class="ad-note">Quién lo hace: una persona con acceso de <strong>superadministrador</strong> a Google Workspace (la misma que administra los correos de la empresa). Toma unos 15 minutos. Los nombres de los menús son los que Google usa hoy; si alguno se ve distinto, busca el más parecido.</p>
 <h4>Parte A. Crear el proyecto y la cuenta de servicio (Google Cloud)</h4>
 <ol>
  <li>Entra a <strong>console.cloud.google.com</strong> con la cuenta de administrador de Workspace.</li>
  <li>Arriba, junto al logo de Google Cloud, abre el selector de proyectos y pulsa <strong>Proyecto nuevo</strong>. Ponle un nombre (por ejemplo «Agenda citas») y pulsa <strong>Crear</strong>. Luego asegúrate de que ese proyecto quede seleccionado.</li>
  <li>Abre el menú (☰) → <strong>APIs y servicios</strong> → <strong>Biblioteca</strong>. Busca <strong>Google Calendar API</strong>, ábrela y pulsa <strong>Habilitar</strong>.</li>
  <li>Menú (☰) → <strong>IAM y administración</strong> → <strong>Cuentas de servicio</strong> → <strong>Crear cuenta de servicio</strong>. Escribe un nombre (por ejemplo «agenda-meet») y pulsa <strong>Listo</strong> (no hace falta asignarle roles).</li>
  <li>Verás la cuenta en la lista. Copia su <strong>correo</strong> (termina en <code>.iam.gserviceaccount.com</code>); lo pegarás en el primer campo de esta pantalla.</li>
  <li>Pulsa el correo de la cuenta para abrirla. En la pestaña <strong>Detalles</strong> busca el <strong>ID único</strong> (un número largo, de unas 21 cifras) y cópialo: es el «ID de cliente» que pide la Parte B.</li>
  <li>Abre la pestaña <strong>Claves</strong> → <strong>Agregar clave</strong> → <strong>Crear clave nueva</strong> → tipo <strong>JSON</strong> → <strong>Crear</strong>. Se descarga un archivo <code>.json</code>. Es la única copia: guárdalo en un lugar seguro y no lo envíes por chat ni correo. Si Google dice que la creación de claves está bloqueada, un administrador de la organización debe quitar esa restricción («Restringir la creación de claves de cuentas de servicio»).</li>
 </ol>
 <h4>Parte B. Autorizar a la cuenta en Google Workspace (delegación en todo el dominio)</h4>
 <ol>
  <li>Entra a <strong>admin.google.com</strong> como superadministrador.</li>
  <li>Menú (☰) → <strong>Seguridad</strong> → <strong>Acceso y control de datos</strong> → <strong>Controles de API</strong>. Abajo, en «Delegación en todo el dominio», pulsa <strong>Administrar la delegación en todo el dominio</strong>.</li>
  <li>Pulsa <strong>Añadir nueva</strong>.</li>
  <li>En <strong>ID de cliente</strong> pega el ID único que copiaste en la Parte A (el número largo, no el correo).</li>
  <li>En <strong>Ámbitos de OAuth</strong> pega exactamente este texto (no es un enlace ni una página: es un permiso que se escribe en ese campo):
   ${copiable(ALCANCE_CALENDAR)}</li>
  <li>Pulsa <strong>Autorizar</strong>. Google puede tardar unos minutos (a veces hasta 24 horas) en aplicarlo.</li>
 </ol>
 <h4>Parte C. Elegir quién organiza las reuniones</h4>
 <ol>
  <li>Escoge un usuario real de tu dominio de Workspace, con licencia y calendario, por ejemplo <code>citas@tuempresa.com</code>. Las reuniones se crean en su calendario y él figura como organizador; los asesores y el cliente reciben el enlace.</li>
  <li>Debe ser un correo de tu dominio (no un Gmail personal) y estar activo.</li>
 </ol>
 <h4>Parte D. Qué pegar en esta pantalla</h4>
 <ol>
  <li>Arriba, en «Proveedor», deja <strong>Google Meet</strong>.</li>
  <li><strong>Correo de la cuenta de servicio</strong>: el campo <code>client_email</code> del archivo JSON (o el correo copiado en la Parte A).</li>
  <li><strong>Clave privada</strong>: abre el archivo JSON con el Bloc de notas, copia todo lo que está entre las comillas de <code>private_key</code>, desde <code>-----BEGIN PRIVATE KEY-----</code> hasta <code>-----END PRIVATE KEY-----</code>, y pégalo. Si ves símbolos <code>\n</code>, déjalos tal cual.</li>
  <li><strong>Correo de Workspace que organiza</strong>: el usuario de la Parte C.</li>
  <li>Pulsa <strong>Guardar</strong>. La clave queda cifrada y no se vuelve a mostrar.</li>
 </ol>
 <h4>Parte E. Probar</h4>
 <ol>
  <li>Pulsa <strong>Crear una reunión de prueba</strong>. Si todo está bien, verás ✅ y un enlace de ejemplo que se cancela solo.</li>
  <li>Si aparece un error de «unauthorized_client» o «delegación», revisa que el ID de cliente y el ámbito de la Parte B estén exactos y espera unos minutos. Si dice que no encuentra al usuario, revisa el correo de la Parte C. Si dice que la API no está habilitada, repite el paso 3 de la Parte A en el mismo proyecto de la cuenta de servicio.</li>
 </ol>
 <p class="ad-note">Si ya tienes una cuenta de servicio para leer correos, puedes reutilizarla: solo agrégale el ámbito de arriba en la delegación (separando los ámbitos con coma) y habilita Google Calendar API en su proyecto.</p>
</details>`;
}

export async function reunionesTab(ctx) {
  const { el, empresaId, aviso, vigente } = ctx;
  el.innerHTML = '<p class="ad-muted">Cargando…</p>';
  const { data: estado, error } = await supabase.rpc('agenda_videollamada_estado', { p_empresa_id: empresaId });
  if (!vigente()) return;
  if (error) { el.innerHTML = '<p class="error">No se pudo leer el estado de las reuniones virtuales. Aplica primero el SQL 030.</p>'; return; }
  const prov = PROVEEDORES_REUNION[estado.proveedor] ? estado.proveedor : 'manual';
  el.innerHTML = `<h2>Reuniones virtuales</h2>
 <p>Permite agendar citas por videollamada (por ejemplo captaciones, asesorías o, a futuro, consultas). Si configuras Google Meet, Microsoft Teams o Zoom, el enlace se crea automáticamente al guardar la cita.</p>
 <div class="ad-correo-estado ${prov !== 'manual' && estado.tiene_credenciales ? 'ad-correo-estado-ok' : 'ad-correo-estado-pendiente'}">${prov === 'manual' ? 'Modo enlace manual: el asesor pega el enlace en cada cita.' : estado.tiene_credenciales ? '✅ Configurado: ' + esc(PROVEEDORES_REUNION[prov].nombre) : '⚠️ Faltan las credenciales.'}</div>
 <form id="ad-reunion-form">
  <div class="ad-grid"><label>Proveedor<select name="proveedor">${Object.entries(PROVEEDORES_REUNION).map(([k, v]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${v.nombre}</option>`).join('')}</select></label></div>
  <div data-campos></div>
  <p class="ad-note" data-ayuda></p>
  <div data-guia></div>
  <div class="ad-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
   <button type="submit">Guardar</button>
   <button type="button" data-probar-reunion ${prov !== 'manual' && estado.tiene_credenciales ? '' : 'disabled'}>Crear una reunión de prueba</button>
  </div>
  <p class="ad-probar-reunion-resultado ad-muted" role="status" style="margin-top:8px"></p>
 </form>`;
  const sel = el.querySelector('[name=proveedor]');
  const pintar = () => {
    const p = PROVEEDORES_REUNION[sel.value];
    el.querySelector('[data-campos]').innerHTML = p.campos.length
      ? `<div class="ad-grid">${p.campos.map((c) => `<label>${c.t}${estado.tiene_credenciales && sel.value === prov ? ' <small class="ad-muted">(guardado; vacío = conservar)</small>' : ''}${c.area ? `<textarea name="${c.k}" rows="4" placeholder="${esc(c.ph)}" autocomplete="off"></textarea>` : `<input name="${c.k}" type="${c.secreto ? 'password' : 'text'}" placeholder="${esc(c.ph)}" autocomplete="off">`}</label>`).join('')}</div>`
      : '';
    el.querySelector('[data-ayuda]').textContent = p.ayuda;
    el.querySelector('[data-guia]').innerHTML = p.guia ? guiaGoogleMeet() : '';
  };
  sel.onchange = pintar;
  pintar();
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-copiar]');
    if (!b) return;
    const texto = b.dataset.copiar;
    try { await navigator.clipboard.writeText(texto); b.textContent = '¡Copiado!'; }
    catch {
      const code = b.parentNode.querySelector('code');
      const r = document.createRange(); r.selectNodeContents(code);
      const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
      b.textContent = 'Selecciona y copia (Ctrl+C)';
    }
    setTimeout(() => { b.textContent = 'Copiar'; }, 2500);
  });
  el.querySelector('#ad-reunion-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const p = PROVEEDORES_REUNION[f.proveedor.value];
    let credenciales = null;
    if (p.campos.length) {
      const valores = Object.fromEntries(p.campos.map((c) => [c.k, (f[c.k].value || '').trim()]));
      const llenos = Object.values(valores).filter(Boolean).length;
      if (llenos && llenos < p.campos.length) { aviso('Completa todos los campos del proveedor (o déjalos todos vacíos para conservar los guardados).', true); return; }
      if (llenos) credenciales = JSON.stringify(valores);
      else if (!estado.tiene_credenciales || f.proveedor.value !== prov) { aviso('Pega las credenciales del proveedor.', true); return; }
    }
    const b = f.querySelector('button[type=submit]');
    b.disabled = true;
    const { error: err } = await supabase.rpc('agenda_guardar_credenciales_videollamada', { p_empresa_id: empresaId, p_proveedor: f.proveedor.value, p_credenciales: credenciales, p_quitar: false });
    b.disabled = false;
    if (err) { aviso(err.message || 'No se pudo guardar.', true); return; }
    aviso('Reuniones virtuales guardadas.');
    await reunionesTab(ctx);
  };
  el.querySelector('[data-probar-reunion]').onclick = async (ev) => {
    const b = ev.currentTarget;
    const r = el.querySelector('.ad-probar-reunion-resultado');
    b.disabled = true; r.classList.remove('error'); r.textContent = 'Probando…';
    try {
      const { data, error: err } = await supabase.functions.invoke('crear-videollamada', { body: { empresa_id: empresaId, probar: true } });
      if (err || !data?.ok) { r.textContent = '❌ ' + (data?.error || 'No se pudo crear la reunión de prueba.'); r.classList.add('error'); }
      else r.textContent = `✅ Funciona. Enlace de ejemplo (ya cancelado): ${data.enlace_ejemplo || ''}`;
    } catch { r.textContent = '❌ No se pudo conectar con el servicio.'; r.classList.add('error'); }
    b.disabled = false;
  };
}
