// Editor independiente. Persiste con el formulario de Empresa, sin consultas adicionales.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CAMPOS = [
  ['sitio_web', 'Sitio web de la empresa (HTTPS)', 'url', 1000],
  ['razon_social', 'Razón social', 'text', 180], ['nit', 'NIT / identificación tributaria', 'text', 40],
  ['direccion', 'Dirección legal', 'text', 400],
  ['politica_datos_url', 'Enlace HTTPS de la política de datos', 'url', 1000],
  ['correo_baja', 'Correo para solicitar baja de publicidad (vacío: correo de contacto)', 'email', 254],
];
const vacio = () => ({ nombre: '', ciudad: '', telefonos: [{ etiqueta: '', numero: '', extension: '' }] });

export function validarContactoEmpresa(datos) {
  for (const [campo, etiqueta, tipo, max] of CAMPOS) {
    const valor = datos[campo] ?? '';
    if (typeof valor !== 'string' || valor.length > max) throw new Error(`${etiqueta}: valor demasiado largo.`);
    if (valor && tipo === 'url') {
      let url; try { url = new URL(valor); } catch { throw new Error(`${etiqueta}: escribe un enlace HTTPS válido.`); }
      if (url.protocol !== 'https:' || url.username || url.password || /[\s<>"']/.test(valor)) throw new Error(`${etiqueta}: usa HTTPS sin credenciales ni espacios.`);
    }
    if (valor && tipo === 'email' && !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(valor)) throw new Error('Revisa el correo de baja.');
  }
  if (!Array.isArray(datos.sedes) || datos.sedes.length > 20) throw new Error('Puedes configurar hasta 20 sedes.');
  for (const [i, sede] of datos.sedes.entries()) {
    if (typeof sede.nombre !== 'string' || typeof sede.ciudad !== 'string' || sede.nombre.length > 100 || sede.ciudad.length > 100 || !(sede.nombre.trim() || sede.ciudad.trim())) throw new Error(`Sede ${i + 1}: indica nombre o ciudad (máximo 100 caracteres).`);
    if (!Array.isArray(sede.telefonos) || !sede.telefonos.length || sede.telefonos.length > 10) throw new Error(`Sede ${i + 1}: indica entre 1 y 10 teléfonos.`);
    for (const p of sede.telefonos) {
      if (typeof p.numero !== 'string' || !/^\+?[\d ().-]+$/.test(p.numero) || p.numero.length > 40 || p.numero.replace(/\D/g, '').length < 7 || p.numero.replace(/\D/g, '').length > 15) throw new Error(`Sede ${i + 1}: revisa el número (7 a 15 dígitos; incluye el indicativo).`);
      if (typeof p.etiqueta !== 'string' || p.etiqueta.length > 60) throw new Error(`Sede ${i + 1}: la etiqueta admite hasta 60 caracteres.`);
      if (typeof p.extension !== 'string' || (p.extension && !/^\d{1,8}$/.test(p.extension))) throw new Error(`Sede ${i + 1}: la extensión admite hasta 8 dígitos.`);
    }
  }
  return datos;
}

export function htmlContactoEmpresa(config) {
  if (!Object.hasOwn(config, 'contacto_empresa')) return '<p class="ad-note">La configuración ampliada de contacto aún no está habilitada. Puedes seguir editando el teléfono general y el correo de contacto.</p>';
  const datos = config.contacto_empresa || {};
  return `<section data-contacto-empresa aria-label="Contacto y datos legales">
    <h3>Contacto y datos legales</h3><div class="ad-grid">${CAMPOS.map(([clave, etiqueta, tipo, max]) => `<label>${etiqueta}<input data-contacto-campo="${clave}" type="${tipo}" maxlength="${max}" value="${esc(datos[clave])}"></label>`).join('')}</div>
    <p class="ad-muted">Estos datos aparecen en los correos de esta empresa. La captación comercial a propietarios solo se muestra con razón social, NIT, dirección, política de datos y correo de baja o contacto completos.</p>
    <h3>Sedes y teléfonos</h3><p class="ad-muted">Incluye el indicativo internacional para llamar desde celular. Si no agregas sedes se usa el teléfono general.</p>
    <div data-sedes-lista></div><button type="button" data-contacto-accion="agregar-sede">Agregar sede</button>
    <p class="ad-muted">Los cambios se aplican al pulsar «Guardar configuración».</p>
  </section>`;
}

export function montarContactoEmpresa(form, config) {
  const seccion = form.querySelector('[data-contacto-empresa]');
  if (!seccion) return { leer: () => ({}) };
  let sedes = structuredClone(Array.isArray(config.contacto_empresa?.sedes) ? config.contacto_empresa.sedes : []);
  const lista = seccion.querySelector('[data-sedes-lista]');
  const campo = (clave, etiqueta, valor, max, extra = '') => `<label>${etiqueta}<input data-sede-campo="${clave}" value="${esc(valor)}" maxlength="${max}" ${extra}></label>`;
  const recogerSedes = () => [...lista.querySelectorAll('[data-sede]')].map(el => ({
    nombre: el.querySelector('[data-sede-campo=nombre]').value.trim(),
    ciudad: el.querySelector('[data-sede-campo=ciudad]').value.trim(),
    telefonos: [...el.querySelectorAll('[data-telefono]')].map(t => Object.fromEntries(['etiqueta','numero','extension'].map(k => [k, t.querySelector(`[data-sede-campo=${k}]`).value.trim()]))),
  }));
  const pintar = () => {
    lista.innerHTML = sedes.length ? sedes.map((s, i) => `<fieldset data-sede="${i}"><legend>Sede ${i + 1}</legend>
      <div class="ad-grid">${campo('nombre','Nombre de la sede',s.nombre,100)}${campo('ciudad','Ciudad',s.ciudad,100)}</div>
      ${(Array.isArray(s.telefonos) ? s.telefonos : []).map((p, j) => `<div class="ad-contacto-telefono" data-telefono="${j}">
        ${campo('etiqueta','Etiqueta (opcional)',p.etiqueta,60)}${campo('numero','Número con indicativo',p.numero,40,'type="tel" placeholder="+57 601 123 4567" required')}${campo('extension','Extensión (opcional)',p.extension,8,'inputmode="numeric" pattern="[0-9]{1,8}"')}
        <button type="button" data-contacto-accion="quitar-telefono" aria-label="Quitar teléfono ${j + 1} de sede ${i + 1}">Quitar teléfono</button></div>`).join('')}
      <div class="ad-actions"><button type="button" data-contacto-accion="agregar-telefono" ${s.telefonos?.length >= 10 ? 'disabled' : ''}>Agregar teléfono</button><button type="button" data-contacto-accion="quitar-sede">Quitar sede</button></div></fieldset>`).join('') : '<p class="ad-muted">No hay sedes configuradas.</p>';
    seccion.querySelector('[data-contacto-accion=agregar-sede]').disabled = sedes.length >= 20;
  };
  seccion.addEventListener('click', e => {
    const boton = e.target.closest('[data-contacto-accion]'); if (!boton) return;
    sedes = recogerSedes();
    const i = Number(boton.closest('[data-sede]')?.dataset.sede), j = Number(boton.closest('[data-telefono]')?.dataset.telefono);
    const accion = boton.dataset.contactoAccion;
    if (accion === 'agregar-sede' && sedes.length < 20) sedes.push(vacio());
    if (accion === 'quitar-sede') sedes.splice(i, 1);
    if (accion === 'agregar-telefono' && sedes[i]?.telefonos.length < 10) sedes[i].telefonos.push({ etiqueta: '', numero: '', extension: '' });
    if (accion === 'quitar-telefono') sedes[i]?.telefonos.splice(j, 1);
    pintar();
    const destino = accion === 'agregar-sede' ? lista.lastElementChild?.querySelector('input') : accion === 'agregar-telefono' ? Array.from(lista.querySelectorAll(`[data-sede="${i}"] [data-telefono]`)).at(-1)?.querySelector("input") : seccion.querySelector('[data-contacto-accion=agregar-sede]');
    destino?.focus();
  });
  pintar();
  return { leer() {
    const datos = Object.fromEntries(CAMPOS.map(([k]) => [k, seccion.querySelector(`[data-contacto-campo=${k}]`).value.trim()]));
    datos.sedes = recogerSedes();
    return { contacto_empresa: validarContactoEmpresa(datos) };
  } };
}
