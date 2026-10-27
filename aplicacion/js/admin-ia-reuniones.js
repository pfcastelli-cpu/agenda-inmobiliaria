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
    ayuda: 'Requiere una cuenta de servicio con delegación en todo el dominio y el permiso https://www.googleapis.com/auth/calendar.events (en la consola de administración de Google Workspace → Seguridad → Control de acceso a la API). Es la misma cuenta que usa el lector de correos, si ya la tienes.',
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
  };
  sel.onchange = pintar;
  pintar();
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
