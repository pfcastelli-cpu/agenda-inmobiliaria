// Botón «mostrar/ocultar» en TODOS los campos de contraseña (también los que se crean después, como los de administración).
// Se carga una sola vez desde cliente-supabase.js. Sin dependencias; accesible (botón con aria-label y aria-pressed).
const OJO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_TACHADO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function envolver(input) {
  if (input.dataset.verContrasena) return;
  input.dataset.verContrasena = '1';
  const caja = document.createElement('span');
  caja.style.cssText = 'position:relative;display:block;width:100%';
  if (getComputedStyle(input).display === 'inline-block' || getComputedStyle(input).display === 'inline') caja.style.display = 'inline-block';
  input.parentNode.insertBefore(caja, input);
  caja.appendChild(input);
  input.style.paddingRight = '44px';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.setAttribute('aria-label', 'Mostrar contraseña');
  boton.setAttribute('aria-pressed', 'false');
  boton.title = 'Mostrar contraseña';
  boton.innerHTML = OJO;
  boton.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;opacity:.65;cursor:pointer;border-radius:8px;padding:0';
  boton.addEventListener('click', () => {
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    boton.innerHTML = ver ? OJO_TACHADO : OJO;
    boton.setAttribute('aria-pressed', String(ver));
    const t = ver ? 'Ocultar contraseña' : 'Mostrar contraseña';
    boton.setAttribute('aria-label', t); boton.title = t;
    input.focus();
  });
  caja.appendChild(boton);
}

function revisar(raiz) {
  try { (raiz.querySelectorAll ? raiz.querySelectorAll('input[type=password]:not([data-ver-contrasena])') : []).forEach(envolver); } catch { /* sin el botón el campo funciona igual */ }
}

if (typeof document !== 'undefined' && !window.__verContrasenaActivo) {
  window.__verContrasenaActivo = true;
  const iniciar = () => {
    revisar(document);
    new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches?.('input[type=password]')) envolver(n); else revisar(n); } }); })
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
}
