// Mejoras de uso para las tablas de Informes: filtro de texto sobre las filas y orden ascendente/descendente al hacer clic
// en el título de cada columna. Solo cambia lo que se ve; no toca datos. Las gráficas se suben al principio de la pantalla.
const numero = (t) => {
  const limpio = String(t).replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(limpio);
  return Number.isFinite(n) && /\d/.test(t) ? n : null;
};

export function mejorarTablas(raiz) {
  raiz.querySelectorAll('table').forEach((tabla) => {
    const cuerpo = tabla.tBodies[0];
    const titulos = [...tabla.querySelectorAll('thead th')];
    if (!cuerpo || !titulos.length || tabla.dataset.mejorada) return;
    tabla.dataset.mejorada = '1';
    const filas = () => [...cuerpo.rows];
    if (filas().length > 5) {
      const caja = document.createElement('input');
      caja.type = 'search';
      caja.className = 'v-input';
      caja.placeholder = 'Filtrar esta tabla…';
      caja.setAttribute('aria-label', 'Filtrar esta tabla');
      caja.style.cssText = 'max-width:280px;margin:8px 0';
      caja.oninput = () => {
        const q = caja.value.trim().toLowerCase();
        filas().forEach((f) => { f.hidden = !!q && !f.textContent.toLowerCase().includes(q); });
      };
      (tabla.closest('div[style*="overflow"]') || tabla).insertAdjacentElement('beforebegin', caja);
    }
    titulos.forEach((th, col) => {
      th.style.cursor = 'pointer';
      th.title = 'Clic para ordenar';
      th.setAttribute('aria-sort', 'none');
      th.onclick = () => {
        const asc = th.dataset.orden !== 'asc';
        titulos.forEach((o) => { delete o.dataset.orden; o.setAttribute('aria-sort', 'none'); o.textContent = o.textContent.replace(/ [▲▼]$/, ''); });
        th.dataset.orden = asc ? 'asc' : 'desc';
        th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
        th.textContent += asc ? ' ▲' : ' ▼';
        const valor = (f) => (f.cells[col]?.textContent || '').trim();
        const ordenadas = filas().sort((a, b) => {
          const va = valor(a); const vb = valor(b);
          const na = numero(va); const nb = numero(vb);
          const c = na != null && nb != null ? na - nb : va.localeCompare(vb, 'es', { numeric: true });
          return asc ? c : -c;
        });
        ordenadas.forEach((f) => cuerpo.appendChild(f));
      };
    });
  });
}

// Sube al principio (después de la nota de la pantalla) las secciones que traen gráficas.
export function subirGraficas(main) {
  const hijos = [...main.children];
  const primero = hijos.findIndex((n) => n.tagName === 'H3');
  if (primero < 0) return;
  const grupos = [];
  let actual = null;
  hijos.slice(primero).forEach((n) => { if (n.tagName === 'H3') { actual = [n]; grupos.push(actual); } else actual?.push(n); });
  const nota = main.querySelector('.v-note');
  const ancla = nota ? nota.nextElementSibling : hijos[0];
  const conGrafica = grupos.filter((g) => g.some((n) => n.querySelector?.('svg') || n.tagName === 'svg'));
  conGrafica.forEach((g) => g.forEach((n) => main.insertBefore(n, ancla)));
}
