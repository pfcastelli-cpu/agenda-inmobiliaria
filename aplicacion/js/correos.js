// Vista previa de los correos del sistema (/correos). Solo para el equipo de soporte de la plataforma (agenda_soporte_usuarios).
// Pide a la función vista-previa-correos el catálogo armado con datos de ejemplo y la marca de la empresa elegida; no envía nada.
import { supabase } from './cliente-supabase.js';

const raiz = document.getElementById('raiz');
const quien = document.getElementById('quien');
const botonSalir = document.getElementById('salir');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = { empresa: '', grupo: 'todos', datos: null };

function vistaLogin(error = '') {
  quien.textContent = '';
  botonSalir.hidden = true;
  raiz.innerHTML = `<section class="tarjeta login"><h2>Entrar</h2><p class="suave">Solo para el equipo de soporte de la plataforma.</p>
    <form id="form-login"><label>Correo<input type="email" id="email" autocomplete="username" required></label>
    <label>Contraseña<input type="password" id="clave" autocomplete="current-password" required></label>
    ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
    <button class="principal" type="submit">Iniciar sesión</button></form></section>`;
  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const { error: err } = await supabase.auth.signInWithPassword({ email: document.getElementById('email').value.trim(), password: document.getElementById('clave').value });
    if (err) return vistaLogin('No pudimos iniciar sesión. Revisa el correo y la contraseña.');
    arrancar();
  };
}

function pintar() {
  const d = ui.datos;
  const grupos = ['todos', ...new Set(d.correos.map((c) => c.grupo))];
  const visibles = d.correos.filter((c) => ui.grupo === 'todos' || c.grupo === ui.grupo);
  raiz.innerHTML = `<h2>Correos del sistema</h2>
    <p class="suave">Así se ven con datos de ejemplo. No se envía nada, y los botones abren páginas de ejemplo reales (datos de prueba). Cada muestra dice cuándo y a quién se envía el correo real.</p>
    <div class="fila">
      <label>Empresa (colores e imagen)<select id="sel-empresa">${d.empresas.map((e) => `<option value="${esc(e.id)}" ${e.id === (ui.empresa || d.empresa_usada) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>
      <label>Para quién<select id="sel-grupo">${grupos.map((g) => `<option value="${esc(g)}" ${g === ui.grupo ? 'selected' : ''}>${g === 'todos' ? 'Todos' : esc(g)}</option>`).join('')}</select></label>
    </div>
    ${visibles.map((c, i) => `<section class="tarjeta" style="margin-bottom:18px"><h2 style="font-size:18px">${esc(c.nombre)} <small style="color:#6b7785;font-weight:500">· ${esc(c.para)}</small></h2>
      <p class="suave" style="margin:2px 0 4px"><b>Cuándo se envía:</b> ${esc(c.cuando)}</p>
      <p class="suave" style="margin:0 0 10px"><b>Asunto de ejemplo:</b> ${esc(c.asunto)}</p>
      <iframe data-i="${i}" title="${esc(c.nombre)}" style="width:100%;height:640px;border:1px solid #dfe5ea;border-radius:10px;background:#fff" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></section>`).join('')}`;
  raiz.querySelectorAll('iframe').forEach((f) => { f.srcdoc = visibles[Number(f.dataset.i)].html.replace('<head>', '<head><base target="_blank">'); });
  document.getElementById('sel-grupo').onchange = (e) => { ui.grupo = e.target.value; pintar(); };
  document.getElementById('sel-empresa').onchange = (e) => { ui.empresa = e.target.value; cargar(); };
}

async function cargar() {
  raiz.innerHTML = '<p class="suave">Armando los correos…</p>';
  const { data, error } = await supabase.functions.invoke('vista-previa-correos', { body: ui.empresa ? { empresa_id: ui.empresa } : {} });
  if (error || !data?.ok) {
    let msg = data?.error || '';
    try { msg = msg || (await error?.context?.json?.())?.error || ''; } catch { /* sin detalle */ }
    raiz.innerHTML = `<section class="tarjeta login"><h2>Sin acceso</h2><p>${esc(msg || 'No se pudieron cargar los correos.')}</p><p><a href="/">Ir a la agenda</a></p></section>`;
    return;
  }
  ui.datos = data;
  pintar();
}

async function arrancar() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return vistaLogin();
  quien.textContent = data.session.user.email || '';
  botonSalir.hidden = false;
  botonSalir.onclick = async () => { await supabase.auth.signOut(); vistaLogin(); };
  cargar();
}

arrancar();
