// Página pública /radicar/<token>: cómo radicar el estudio de arrendatario con la aseguradora, con los datos listos para copiar.
// El token es el de la cita del cliente (token_cliente). Lo que se muestra sale de Configuración → Radicación, por ciudad (RPC agenda_radicacion_publica, sql/033).
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');
const state = { paso: 'cargando', d: null };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = (n) => (n == null ? '' : '$ ' + Math.round(Number(n)).toLocaleString('es-CO'));
const urlSegura = (u) => (u && /^https:\/\/[^\s"'<>]+$/i.test(String(u).trim()) ? String(u).trim() : '');

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/radicar\/([0-9a-f-]{8,})/i);
  return ruta ? ruta[1] : new URLSearchParams(window.location.search).get('token');
}

function fila(titulo, valor) {
  if (!valor) return '';
  return `<div class="rd-fila"><div><small>${esc(titulo)}</small><strong>${esc(valor)}</strong></div><button type="button" class="rd-copiar" data-copiar="${esc(valor)}">Copiar</button></div>`;
}

function bloque(d, a, varias, primero) {
  const natural = urlSegura(a.link_natural);
  const juridica = urlSegura(a.link_juridica);
  const mismo = natural && natural === juridica;
  const pasos = String(a.instrucciones || '').split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  const costo = a.costo_porcentaje != null ? `${Number(a.costo_porcentaje)}%${a.costo_iva ? ' + IVA' : ''}` : a.costo_valor != null ? `${cop(a.costo_valor)}${a.costo_iva ? ' + IVA' : ''}` : '';
  const ejemplo = a.costo_porcentaje != null && a.costo_valor != null ? `Con el canon de este inmueble (${cop(d.canon)}) serían aproximadamente ${cop(a.costo_valor)}${a.costo_iva ? ' + IVA' : ''}. ` : '';
  return `${varias ? `<h2 style="margin-top:26px;border-top:2px solid #efefef;padding-top:16px">Con ${esc(a.aseguradora)}</h2>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;margin:14px 0">
      ${natural ? `<a class="${primero ? 'pu-main' : 'pu-ver-inmueble'}" style="text-align:center;text-decoration:none" href="${esc(natural)}" target="_blank" rel="noopener">${mismo ? 'Iniciar mi estudio' : 'Iniciar mi estudio · persona natural'}</a>` : ''}
      ${juridica && !mismo ? `<a class="pu-ver-inmueble" style="text-align:center;text-decoration:none" href="${esc(juridica)}" target="_blank" rel="noopener">Soy persona jurídica (empresa)</a>` : ''}
      ${mismo ? '<small style="text-align:center;color:#6b6b6b">El mismo enlace sirve para persona natural y jurídica.</small>' : ''}
    </div>
    <h3>Datos para copiar en el formulario</h3>
    <p style="font-size:13px;color:#6b6b6b">La aseguradora te los va a pedir. Toca «Copiar» y pégalos.</p>
    ${fila('Código de la inmobiliaria', a.codigo_inmobiliaria)}${fila('Póliza', a.poliza)}${fila('Inmobiliaria', a.nombre_inmobiliaria)}${fila('Asesor', a.asesor_nombre)}${fila('Correo del asesor', a.asesor_correo)}
    ${fila('Dirección del inmueble', [d.direccion, d.barrio].filter(Boolean).join(', '))}${fila('Valor del canon', cop(d.canon))}${fila('Administración', d.administracion ? cop(d.administracion) : d.administracion_incluida ? 'Incluida en el canon' : '')}
    ${pasos.length ? `<h3 style="margin-top:22px">Así funciona</h3>${pasos.map((p, i) => `<div class="rd-paso"><span class="rd-num">${i + 1}</span><span>${esc(p)}</span></div>`).join('')}` : ''}
    ${costo ? `<div style="background:#f4f4f4;border-radius:14px;padding:14px 16px;margin-top:18px"><strong>💰 Costo del estudio y del contrato: ${esc(costo)}</strong><div style="font-size:13.5px;margin-top:4px">${esc(ejemplo)}${esc(a.costo_nota || '')}</div></div>` : ''}`;
}

function vista() {
  if (state.paso === 'cargando') return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (state.paso === 'error') return `<div class="pu-error">${esc(state.error)}</div>`;
  const d = state.d;
  const lista = d.aseguradoras || [];
  const varias = lista.length > 1;
  return `<div class="pu-card">
    <h2>¡Vamos por tu nuevo hogar! 🏡</h2>
    <p>Inmueble Nº ${esc(d.numero_inmueble)} · ${esc(d.direccion || '')}</p>
    <p>El siguiente paso es un estudio en línea con <strong>${esc(lista.map((a) => a.aseguradora).join(' o '))}</strong>. Es 100% digital y la respuesta llega el mismo día cuando la información está completa.${varias ? ' Elige la opción que prefieras.' : ''}</p>
    ${lista.map((a, i) => bloque(d, a, varias, i === 0)).join('')}
  </div>`;
}

function render() {
  raiz.innerHTML = vista();
  raiz.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = '¡Copiado!'; } catch { b.textContent = 'Selecciónalo y cópialo'; }
    setTimeout(() => { b.textContent = 'Copiar'; }, 1800);
  }));
}

async function iniciar() {
  render();
  if (!hayConfiguracionSupabase()) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  const token = tokenDesdeUrl();
  if (!token) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  const { data, error } = await supabase.rpc('agenda_radicacion_publica', { p_token: token });
  if (error || !data || data.error) {
    state.paso = 'error';
    state.error = data?.error === 'sin_configuracion' ? 'Pídele a tu asesor la información para radicar tu estudio.' : 'Este enlace no funciona o ya venció.';
    render();
    return;
  }
  state.d = data;
  state.paso = 'listo';
  render();
}

aplicarMarcaPublica();
iniciar();
