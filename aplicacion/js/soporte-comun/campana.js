// Campana de notificaciones del soporte: contador de no leídas + panel con los avisos (respuestas, ticket resuelto, recordatorios…).
// La usan la app de cada empresa y la consola /soporte. No conoce ninguna de las dos: recibe dónde pintarse y qué hacer al abrir un aviso.
//   const campana = montarCampana({ contenedor, api, onAbrir: (aviso) => {...} });   campana.destruir() al cerrar sesión.
// Se actualiza sola cada 45 s (solo con la pestaña visible), al volver a la pestaña y cuando alguien dispara `soporte:avisos`
// (p. ej. al abrir un ticket, para que el contador baje de inmediato).
import { escapar, hace } from './formato.js';

const ICONO = { respuesta: '💬', mensaje: '💬', nuevo: '🆕', calificar: '⭐', cerrado: '✔', asignado: '👤', reabierto: '↩', calificado: '⭐', recordatorio: '⏰', sla: '⚠', estado: 'ℹ' };
export const EVENTO_AVISOS = 'soporte:avisos';
const INTERVALO_MS = 45000;

const ESTILO = `
.cmp-caja { position: relative; display: inline-flex; }
.cmp-boton { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 999px; border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; opacity: .9; }
.cmp-boton:hover, .cmp-boton:focus-visible { opacity: 1; outline: 2px solid currentColor; outline-offset: 2px; }
.cmp-boton svg { width: 22px; height: 22px; }
.cmp-numero { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #b3261e; color: #fff; font: 700 12px/20px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; }
.cmp-panel { position: fixed; z-index: 1000; width: min(380px, calc(100vw - 16px)); max-height: min(70vh, 560px); display: flex; flex-direction: column; background: #fff; color: #2b3440; border: 1px solid #dfe5ea; border-radius: 14px; box-shadow: 0 12px 40px #0003; font: 14px/1.4 system-ui, sans-serif; }
.cmp-panel[hidden] { display: none; }
.cmp-cabeza { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #dfe5ea; }
.cmp-cabeza strong { font-size: 15px; }
.cmp-todas { background: none; border: 0; color: #1a2c45; text-decoration: underline; cursor: pointer; font: inherit; font-size: 13px; min-height: 44px; padding: 0 4px; }
.cmp-lista { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.cmp-item { display: grid; grid-template-columns: 28px 1fr; gap: 8px; width: 100%; text-align: left; padding: 12px 14px; border: 0; border-bottom: 1px solid #eef1f4; background: #fff; color: inherit; cursor: pointer; font: inherit; min-height: 56px; }
.cmp-item:hover, .cmp-item:focus-visible { background: #f3f7fa; outline: none; }
.cmp-item.nueva { background: #eef6ff; }
.cmp-item.nueva .cmp-titulo { font-weight: 700; }
.cmp-titulo { display: block; }
.cmp-cuerpo { display: block; color: #6b7785; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmp-cuando { display: block; color: #6b7785; font-size: 12px; margin-top: 2px; }
.cmp-vacio { padding: 26px 16px; text-align: center; color: #6b7785; }
.cmp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

function inyectarEstilo() {
  if (document.getElementById('cmp-estilo')) return;
  const s = document.createElement('style');
  s.id = 'cmp-estilo';
  s.textContent = ESTILO;
  document.head.appendChild(s);
}

export function montarCampana({ contenedor, api, onAbrir, intervaloMs = INTERVALO_MS }) {
  inyectarEstilo();
  const caja = document.createElement('div');
  caja.className = 'cmp-caja';
  caja.innerHTML = `<button type="button" class="cmp-boton" aria-haspopup="true" aria-expanded="false" aria-controls="cmp-panel" aria-label="Notificaciones">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      <span class="cmp-numero" hidden></span></button>
    <span class="cmp-sr" role="status" aria-live="polite"></span>
    <div class="cmp-panel" id="cmp-panel" role="region" aria-label="Notificaciones" hidden></div>`;
  contenedor.appendChild(caja);
  const boton = caja.querySelector('.cmp-boton');
  const numero = caja.querySelector('.cmp-numero');
  const anuncio = caja.querySelector('.cmp-sr');
  const panel = caja.querySelector('.cmp-panel');
  let estado = { no_leidas: 0, items: [] };
  let anterior = null;
  let temporizador = null;
  let cargando = false;

  function pintarContador() {
    const n = estado.no_leidas;
    numero.hidden = n === 0;
    numero.textContent = n > 99 ? '99+' : String(n);
    boton.setAttribute('aria-label', n ? `Notificaciones: ${n} sin leer` : 'Notificaciones');
    if (anterior !== null && n > anterior) anuncio.textContent = `Tienes ${n - anterior} ${n - anterior === 1 ? 'aviso nuevo' : 'avisos nuevos'} de soporte.`;
    anterior = n;
  }

  function pintarPanel() {
    const lista = estado.items.length
      ? `<ul class="cmp-lista">${estado.items.map((a) => `<li><button type="button" class="cmp-item${a.leida ? '' : ' nueva'}" data-aviso="${escapar(a.id)}">
            <span aria-hidden="true">${ICONO[a.tipo] || '•'}</span>
            <span><span class="cmp-titulo">${escapar(a.titulo)}</span>${a.cuerpo ? `<span class="cmp-cuerpo">${escapar(a.cuerpo)}</span>` : ''}<span class="cmp-cuando">${escapar(hace(a.creada_en))}${a.leida ? '' : ' · sin leer'}</span></span></button></li>`).join('')}</ul>`
      : '<p class="cmp-vacio">No tienes avisos por ahora. Cuando soporte responda o cambie un ticket, lo verás aquí.</p>';
    panel.innerHTML = `<div class="cmp-cabeza"><strong>Notificaciones</strong>${estado.no_leidas ? '<button type="button" class="cmp-todas">Marcar todas como leídas</button>' : ''}</div>${lista}`;
    const todas = panel.querySelector('.cmp-todas');
    if (todas) todas.onclick = async () => { await api.marcarAvisos(); await refrescar(); };
    panel.querySelectorAll('[data-aviso]').forEach((b) => {
      b.onclick = async () => {
        const aviso = estado.items.find((a) => a.id === b.dataset.aviso);
        cerrar();
        if (!aviso) return;
        await api.marcarAvisos({ id: aviso.id });
        refrescar();
        onAbrir?.(aviso);
      };
    });
  }

  function posicionar() {
    const r = boton.getBoundingClientRect();
    const ancho = Math.min(380, window.innerWidth - 16);
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8))}px`;
    panel.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 120)}px`;
  }
  function abrir() {
    pintarPanel();
    panel.hidden = false;
    posicionar();
    boton.setAttribute('aria-expanded', 'true');
    (panel.querySelector('.cmp-item, .cmp-todas') || panel).focus?.();
  }
  function cerrar() {
    panel.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
  }

  async function refrescar() {
    if (cargando) return;
    cargando = true;
    const { data } = await api.avisos(30);
    cargando = false;
    if (!data) return;
    estado = data;
    pintarContador();
    if (!panel.hidden) pintarPanel();
  }

  boton.onclick = () => { if (panel.hidden) { abrir(); refrescar(); } else { cerrar(); boton.focus(); } };
  const alEscape = (e) => { if (e.key === 'Escape' && !panel.hidden) { cerrar(); boton.focus(); } };
  const alClicFuera = (e) => { if (!panel.hidden && !caja.contains(e.target)) cerrar(); };
  const alVolver = () => { if (document.visibilityState === 'visible') refrescar(); };
  document.addEventListener('keydown', alEscape);
  document.addEventListener('click', alClicFuera);
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener(EVENTO_AVISOS, refrescar);
  window.addEventListener('resize', cerrar);
  temporizador = setInterval(() => { if (document.visibilityState === 'visible') refrescar(); }, intervaloMs);

  // Al montar: aplica las reglas del tiempo (cierres, recordatorios) y trae los avisos.
  api.mantenimiento().finally(refrescar);

  return {
    refrescar,
    destruir() {
      clearInterval(temporizador);
      document.removeEventListener('keydown', alEscape);
      document.removeEventListener('click', alClicFuera);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(EVENTO_AVISOS, refrescar);
      window.removeEventListener('resize', cerrar);
      caja.remove();
    },
  };
}
