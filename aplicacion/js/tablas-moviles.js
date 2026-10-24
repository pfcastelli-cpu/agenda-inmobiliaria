// En celular y iPad vertical las tablas anchas (Informes, Bitácora, calendario de Administración) se muestran como
// tarjetas: cada celda lleva el nombre de su columna (data-label) y el CSS de agenda.css la pone encima del valor.
// Se hace aquí, una sola vez para todas, porque las tablas se pintan desde varios módulos.
function etiquetar(tabla) {
  const nombres = [...tabla.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  if (!nombres.length) return;
  tabla.querySelectorAll('tbody tr').forEach((fila) => {
    [...fila.children].forEach((celda, i) => {
      if (celda.tagName === 'TD' && !celda.hasAttribute('data-label')) celda.setAttribute('data-label', nombres[i] || '');
    });
  });
}

function revisar() {
  document.querySelectorAll('table.v-tabla-res, table.ad-tabla').forEach(etiquetar);
}

let pendiente = false;
new MutationObserver(() => {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => { pendiente = false; revisar(); });
}).observe(document.body, { childList: true, subtree: true });
revisar();
