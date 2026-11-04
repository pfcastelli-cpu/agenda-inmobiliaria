// Configuración > Roles y permisos.
// Cada rol tiene un «acceso a datos» (base) que ya imponen las políticas de la base de datos, y una lista de permisos que afinan
// lo que se ve y se puede hacer en pantalla. Todas las escrituras van por funciones del servidor que validan quién llama;
// aquí solo se muestran sus mensajes de error tal cual.
import { supabase } from './cliente-supabase.js';
import { puede } from './permisos.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASES = {
  asesor: {
    nombre: 'Asesor',
    ayuda: 'Solo verá los datos que le corresponden como asesor (su propia agenda y sus citas).',
  },
  coordinador: {
    nombre: 'Coordinador',
    ayuda: 'Podrá ver los datos de todo el equipo (agenda, informes, bitácora), pero no la configuración de la empresa.',
  },
  administrador: {
    nombre: 'Administrador',
    ayuda: 'Podrá ver y trabajar con todos los datos de la empresa, incluida la configuración.',
  },
};
const ORDEN_BASE = ['asesor', 'coordinador', 'administrador'];

export async function listarRoles(empresaId) {
  const { data, error } = await supabase.rpc('agenda_roles_listar', { p_empresa_id: empresaId });
  if (error) throw new Error(error.message || 'No se pudieron leer los roles.');
  return Array.isArray(data) ? data : [];
}

async function listarCatalogo() {
  const { data, error } = await supabase.from('agenda_permisos').select('clave, categoria, nombre, descripcion, orden').order('orden');
  if (error) throw new Error(error.message || 'No se pudo leer el catálogo de permisos.');
  return data || [];
}

function agrupar(catalogo) {
  const grupos = [];
  for (const p of catalogo) {
    let g = grupos.find((x) => x.categoria === p.categoria);
    if (!g) { g = { categoria: p.categoria, permisos: [] }; grupos.push(g); }
    g.permisos.push(p);
  }
  return grupos;
}

export async function rolesTab({ el, empresaId, aviso, vigente }) {
  el.innerHTML = '<p class="ad-muted">Cargando roles…</p>';
  let roles, catalogo;
  try {
    [roles, catalogo] = await Promise.all([listarRoles(empresaId), listarCatalogo()]);
  } catch (e) {
    if (vigente()) el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return;
  }
  if (!vigente()) return;
  const gestionar = puede('roles.gestionar');
  const grupos = agrupar(catalogo);

  const pintarLista = () => {
    const tarjeta = (r) => {
      const etiqueta = r.es_sistema ? 'Sistema' : 'Propio';
      const permisos = Array.isArray(r.permisos) ? r.permisos.length : 0;
      return `<li class="ad-rol" data-rol="${esc(r.id)}">
        <div class="ad-rol-info">
          <div class="ad-rol-titulo"><strong>${esc(r.nombre)}</strong>
            <span class="ad-pill">${esc(etiqueta)}</span>
            <span class="ad-pill">Datos: ${esc(BASES[r.base]?.nombre || r.base)}</span>
            ${r.es_super ? '<span class="ad-pill">Puede todo</span>' : ''}</div>
          <p class="ad-muted">${esc(r.descripcion || 'Sin descripción.')}</p>
          <p class="ad-muted">${r.es_super ? 'Todos los permisos' : `${permisos} de ${catalogo.length} permisos`} · ${Number(r.personas) || 0} ${Number(r.personas) === 1 ? 'persona' : 'personas'}</p>
        </div>
        <div class="ad-rol-botones">
          <button type="button" data-ver="${esc(r.id)}">${gestionar && !r.es_super ? 'Editar' : 'Ver'}</button>
          ${gestionar ? `<button type="button" data-duplicar="${esc(r.id)}">Duplicar</button>` : ''}
          ${gestionar && !r.es_sistema ? `<button type="button" class="ad-peligro" data-eliminar="${esc(r.id)}">Eliminar</button>` : ''}
        </div>
      </li>`;
    };
    el.innerHTML = `<header class="ad-rol-cabecera"><div><h2>Roles y permisos</h2>
      <p>Un rol dice qué datos ve una persona (su «acceso a datos») y qué puede hacer en cada parte de la agenda. Asigna el rol a cada persona en la pestaña Accesos.</p></div>
      ${gestionar ? '<button type="button" class="ad-primary" data-nuevo>＋ Nuevo rol</button>' : ''}</header>
      ${gestionar ? '' : '<p class="ad-note">Solo puedes consultar los roles. Para cambiarlos necesitas el permiso «Crear, editar y asignar roles».</p>'}
      <ul class="ad-roles">${roles.map(tarjeta).join('') || '<li class="ad-muted">Todavía no hay roles.</li>'}</ul>`;
  };

  const recargar = async (mensaje) => {
    try { roles = await listarRoles(empresaId); } catch (e) { aviso(e.message, true); }
    if (!vigente()) return;
    pintarLista();
    if (mensaje) aviso(mensaje);
  };

  // ---- editor
  const abrirEditor = (rol, { copia = false } = {}) => {
    const esNuevo = !rol || copia;
    const soloLectura = !gestionar || (!!rol && rol.es_super && !copia);
    const esSuper = !!rol && rol.es_super && !copia;
    const sel = new Set(esSuper ? catalogo.map((p) => p.clave) : (rol?.permisos || []));
    const datos = {
      id: esNuevo ? null : rol.id,
      nombre: copia ? `${rol.nombre} (copia)` : (rol?.nombre || ''),
      descripcion: rol?.descripcion || '',
      base: rol?.base || 'asesor',
    };
    const titulo = esNuevo ? (copia ? 'Duplicar rol' : 'Nuevo rol') : (soloLectura ? rol.nombre : `Editar rol: ${rol.nombre}`);
    const dis = soloLectura ? 'disabled' : '';

    const bloqueGrupo = (g, i) => `<fieldset class="ad-perm-grupo" data-grupo="${i}">
      <legend class="ad-sr">${esc(g.categoria)}</legend>
      <label class="ad-check ad-perm-cat"><input type="checkbox" data-cat="${i}" ${dis}> <strong>${esc(g.categoria)}</strong></label>
      <div class="ad-perm-lista">${g.permisos.map((p) => `<label class="ad-check ad-perm-item"><input type="checkbox" data-perm="${esc(p.clave)}" ${dis}>
        <span><span class="ad-perm-nombre">${esc(p.nombre)}</span>${p.descripcion ? `<small class="ad-muted">${esc(p.descripcion)}</small>` : ''}</span></label>`).join('')}</div>
    </fieldset>`;

    el.innerHTML = `<button type="button" class="ad-link-btn" data-volver>← Volver a roles</button>
      <h2>${esc(titulo)}</h2>
      ${esSuper ? '<p class="ad-note"><strong>Puede todo, siempre.</strong> El Superadministrador no se puede modificar: tiene todos los permisos y garantiza que la empresa siempre tenga quién gestione los roles.</p>' : ''}
      ${!gestionar ? '<p class="ad-note">Solo lectura: no tienes permiso para cambiar roles.</p>' : ''}
      <form class="ad-form ad-rol-form" novalidate>
        <div class="ad-grid">
          <label>Nombre<input name="nombre" required maxlength="60" minlength="2" value="${esc(datos.nombre)}" ${dis}></label>
          <label>Acceso a datos
            <select name="base" ${dis}>${ORDEN_BASE.map((b) => `<option value="${b}" ${b === datos.base ? 'selected' : ''}>${BASES[b].nombre}</option>`).join('')}</select>
          </label>
          <label class="ad-rol-desc">Descripción<textarea name="descripcion" maxlength="300" rows="2" ${dis}>${esc(datos.descripcion)}</textarea></label>
        </div>
        <p class="ad-note" data-ayuda-base></p>
        <h3>Permisos</h3>
        <p class="ad-muted">Marca lo que este rol puede hacer. Los permisos afinan la pantalla; nunca dan más datos de los que permite el acceso a datos.</p>
        <div class="ad-perm-grupos">${grupos.map(bloqueGrupo).join('')}</div>
        <p class="error ad-rol-error" role="alert" hidden></p>
        <div class="ad-actions">
          ${soloLectura ? '' : '<button type="submit" class="ad-primary">Guardar rol</button>'}
          <button type="button" data-volver>${soloLectura ? 'Cerrar' : 'Cancelar'}</button>
        </div>
      </form>`;

    const form = el.querySelector('form');
    const actualizar = () => {
      el.querySelector('[data-ayuda-base]').textContent = `Acceso a datos «${BASES[form.base.value].nombre}»: ${BASES[form.base.value].ayuda} Es el máximo de datos que verá; los permisos de abajo afinan lo que puede hacer.`;
      grupos.forEach((g, i) => {
        const n = g.permisos.filter((p) => sel.has(p.clave)).length;
        const cat = form.querySelector(`[data-cat="${i}"]`);
        cat.checked = n === g.permisos.length;
        cat.indeterminate = n > 0 && n < g.permisos.length;
      });
      form.querySelectorAll('[data-perm]').forEach((c) => { c.checked = sel.has(c.dataset.perm); });
    };
    actualizar();
    form.base.addEventListener('change', actualizar);
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.cat !== undefined) {
        const g = grupos[Number(t.dataset.cat)];
        g.permisos.forEach((p) => (t.checked ? sel.add(p.clave) : sel.delete(p.clave)));
        actualizar();
      } else if (t.dataset.perm) {
        if (t.checked) sel.add(t.dataset.perm); else sel.delete(t.dataset.perm);
        actualizar();
      }
    });
    el.querySelectorAll('[data-volver]').forEach((b) => b.addEventListener('click', pintarLista));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.ad-rol-error');
      err.hidden = true;
      const nombre = form.nombre.value.trim();
      if (nombre.length < 2) { err.textContent = 'Escribe un nombre de al menos 2 letras.'; err.hidden = false; form.nombre.focus(); return; }
      const boton = form.querySelector('button[type=submit]');
      boton.disabled = true;
      const { error } = await supabase.rpc('agenda_rol_guardar', {
        p_empresa_id: empresaId,
        p_rol_id: datos.id,
        p_nombre: nombre,
        p_descripcion: form.descripcion.value.trim() || null,
        p_base: form.base.value,
        p_permisos: [...sel],
      });
      if (error) { err.textContent = error.message || 'No se pudo guardar el rol.'; err.hidden = false; boton.disabled = false; return; }
      await recargar(esNuevo ? 'Rol creado.' : 'Rol guardado.');
    });
  };

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-nuevo')) { abrirEditor(null); return; }
    const buscar = (id) => roles.find((r) => r.id === id);
    if (b.dataset.ver) { abrirEditor(buscar(b.dataset.ver)); return; }
    if (b.dataset.duplicar) { abrirEditor(buscar(b.dataset.duplicar), { copia: true }); return; }
    if (b.dataset.eliminar) {
      const r = buscar(b.dataset.eliminar);
      if (!r || !confirm(`¿Eliminar el rol «${r.nombre}»? Esta acción no se puede deshacer.`)) return;
      b.disabled = true;
      const { error } = await supabase.rpc('agenda_rol_eliminar', { p_empresa_id: empresaId, p_rol_id: r.id });
      if (error) { aviso(error.message || 'No se pudo eliminar el rol.', true); b.disabled = false; return; }
      await recargar('Rol eliminado.');
    }
  };

  pintarLista();
}
