// Buscador rápido para las listas desplegables de inmuebles: escribes parte del número, la dirección, el barrio,
// el conjunto o la ciudad y la lista se reduce a lo que coincide. Solo cambia lo que se ve; no toca datos.
// Cada <option> debe traer data-q con el texto en el que se busca (usa textoBusqueda()).
export const textoBusqueda = (i) => [i.numero_inmueble, i.direccion, i.barrio, i.conjunto, i.ciudad, i.tipo_inmueble, i.tipo_oferta]
  .filter((x) => x != null && x !== '').join(' ').toLowerCase();

const sinTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function agregarBuscadorSelect(select, placeholder = 'Buscar por número, dirección, barrio o conjunto…') {
  if (!select || select.dataset.conBuscador) return;
  select.dataset.conBuscador = '1';
  const caja = document.createElement('input');
  caja.type = 'search';
  caja.className = select.className || 'v-input';
  caja.placeholder = placeholder;
  caja.setAttribute('aria-label', 'Buscar inmueble');
  caja.style.cssText = 'margin-bottom:6px;width:100%';
  const opciones = [...select.options];
  caja.oninput = () => {
    const palabras = sinTildes(caja.value).split(/\s+/).filter(Boolean);
    let visibles = 0;
    opciones.forEach((o) => {
      if (!o.value) { o.hidden = false; return; }
      const coincide = !palabras.length || palabras.every((p) => sinTildes(o.dataset.q || o.textContent).includes(p));
      o.hidden = !coincide;
      o.disabled = !coincide;
      if (coincide) visibles++;
    });
    // Si lo seleccionado ya no coincide, se deselecciona para no guardar un inmueble oculto por error.
    if (select.selectedOptions[0]?.hidden) select.value = '';
    // Con una sola coincidencia se elige sola.
    if (palabras.length && visibles === 1) {
      const unica = opciones.find((o) => o.value && !o.hidden);
      if (unica && select.value !== unica.value) { select.value = unica.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    caja.title = palabras.length ? `${visibles} coincidencia(s)` : '';
  };
  select.insertAdjacentElement('beforebegin', caja);
}
