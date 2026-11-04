// Subpestañas dentro de una pestaña larga de Configuración (Empresa, Correo, Ciudades y festivos…).
// No cambia ningún campo ni su guardado: solo reparte los bloques ya dibujados en paneles y deja visible uno.
// Los paneles ocultos siguen dentro del <form>, así que «Guardar» guarda todo y los valores no se pierden al cambiar.
// Accesible: roles tablist/tab/tabpanel, flechas, Inicio/Fin. En celular la barra se desliza de lado.

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Reparte `nodos` en grupos según el título (h2/h3) que contengan; lo que no lleva título sigue al grupo anterior.
// grupoDe(textoNormalizadoDelTitulo) devuelve el id del grupo o undefined (= seguir en el actual).
export function repartir(nodos, grupoDe, inicial) {
  const reparto = {};
  let actual = inicial;
  for (const n of nodos) {
    const h = n.matches?.('h2, h3') ? n : n.querySelector?.('h2, h3');
    if (h) { const g = grupoDe(normalizar(h.textContent)); if (g) actual = g; }
    (reparto[actual] ||= []).push(n);
  }
  return reparto;
}

function leerPref(clave) { try { return localStorage.getItem(clave); } catch { return null; } }
function guardarPref(clave, v) { try { localStorage.setItem(clave, v); } catch { /* sin almacenamiento: no pasa nada */ } }

// grupos: [{ id, titulo, nodos: Node[], guardar?: false }]   (guardar:false = en esa subpestaña se oculta el botón Guardar)
// opciones: { id (para recordar la última), etiqueta (nombre accesible), contenedor, antes (nodo delante del cual va la barra), botonGuardar }
export function montarSubpestanas({ id, etiqueta, contenedor, antes, grupos, botonGuardar }) {
  const prefijo = `ads-${id}-${Math.random().toString(36).slice(2, 7)}`;
  const claveAlmacen = `ad-sub-${id}`;
  const lista = grupos.filter((g) => g.nodos?.length);
  if (lista.length < 2) return null;

  const barra = document.createElement('div');
  barra.className = 'ad-sub-barra';
  const tablist = document.createElement('div');
  tablist.className = 'ad-sub-tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', etiqueta);
  barra.append(tablist);

  // Marca la posición ANTES de mover nada: `antes` puede acabar dentro de un panel (y entonces la barra quedaría oculta con él).
  const marca = document.createComment('subpestanas');
  antes.before(marca);
  const botones = new Map();
  const paneles = new Map();
  for (const g of lista) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `${prefijo}-t-${g.id}`;
    b.className = 'ad-sub-tab';
    b.setAttribute('role', 'tab');
    b.dataset.sub = g.id;
    b.textContent = g.titulo;
    tablist.append(b);
    botones.set(g.id, b);

    // Un panel por cada padre distinto (en Correo, parte de los bloques está dentro del <form> y parte fuera).
    const porPadre = new Map();
    for (const n of g.nodos) { const p = n.parentNode; if (!porPadre.has(p)) porPadre.set(p, []); porPadre.get(p).push(n); }
    const divs = [];
    let k = 0;
    for (const [, ns] of porPadre) {
      const d = document.createElement('div');
      d.className = 'ad-subpanel';
      d.id = `${prefijo}-p-${g.id}-${k++}`;
      d.setAttribute('role', 'tabpanel');
      d.setAttribute('aria-labelledby', b.id);
      d.dataset.sub = g.id;
      ns[0].before(d);
      d.append(...ns);
      divs.push(d);
    }
    b.setAttribute('aria-controls', divs.map((d) => d.id).join(' '));
    paneles.set(g.id, divs);
  }
  marca.replaceWith(barra);

  const ids = lista.map((g) => g.id);
  function activar(gid, { foco = false, recordar = true } = {}) {
    if (!botones.has(gid)) return;
    for (const g of lista) {
      const on = g.id === gid;
      const b = botones.get(g.id);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      paneles.get(g.id).forEach((d) => { d.hidden = !on; });
    }
    if (botonGuardar) botonGuardar.hidden = lista.find((g) => g.id === gid)?.guardar === false;
    const b = botones.get(gid);
    if (recordar) guardarPref(claveAlmacen, gid);
    if (foco) b.focus();
    b.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  tablist.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) activar(b.dataset.sub, { foco: true }); });
  tablist.addEventListener('keydown', (e) => {
    const i = ids.indexOf(e.target.closest('[role=tab]')?.dataset.sub);
    if (i < 0) return;
    const mover = { ArrowRight: (i + 1) % ids.length, ArrowLeft: (i - 1 + ids.length) % ids.length, Home: 0, End: ids.length - 1 }[e.key];
    if (mover === undefined) return;
    e.preventDefault();
    activar(ids[mover], { foco: true });
  });
  // Si el navegador reclama un campo obligatorio vacío que está en una subpestaña oculta, la abrimos para que se vea.
  contenedor.addEventListener('invalid', (e) => {
    const p = e.target.closest?.('.ad-subpanel');
    if (p?.hidden) activar(p.dataset.sub, { recordar: false });
  }, true);

  const guardada = leerPref(claveAlmacen);
  activar(ids.includes(guardada) ? guardada : ids[0], { recordar: false });
  return { activar };
}

// Usado por el buscador: si el elemento está en una subpestaña oculta, abre esa subpestaña.
export function abrirSubpestanaDe(elemento) {
  const panel = elemento?.closest?.('.ad-subpanel');
  if (panel?.hidden) panel.parentNode.closest('.ad-subbody')?.querySelector(`.ad-sub-tab[data-sub="${panel.dataset.sub}"]`)?.click();
}
