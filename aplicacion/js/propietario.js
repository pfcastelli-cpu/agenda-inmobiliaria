import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';

const raiz = document.getElementById('pu-main');

const ETIQUETAS_TIPO = {
  cambio_precio: 'Solicitar cambio de precio',
  cambio_fotos: 'Solicitar cambio de fotos',
  asesoria: 'Pedir una asesoría',
};

const state = {
  paso: 'cargando', // cargando | listo | error
  token: null,
  datos: null,
  errorMsg: '',
  formAbierto: null, // null | 'cambio_precio' | 'cambio_fotos' | 'asesoria'
  enviando: false,
  errorForm: '',
  mensajeExito: '',
};

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/propietario\/([0-9a-f-]{8,})/i);
  if (ruta) return ruta[1];
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}

function escapeHtml(valor) {
  if (valor == null) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatoMoneda(valor) {
  if (!valor) return null;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);
}

function formatoFecha(fechaISO) {
  if (!fechaISO) return null;
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function esMensajeTecnico(msg) {
  return /function|candidate|relation|column|syntax|operator|schema|constraint|duplicate key|null value|permission denied|violates|uuid|pg_|does not exist/i.test(msg || '');
}

function mensajeAmigable(error, generico) {
  const msg = error?.message || '';
  if (!msg || esMensajeTecnico(msg)) return generico;
  return msg;
}

async function cargarInforme() {
  state.token = tokenDesdeUrl();
  if (!state.token) {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no incluye un código válido. Pide a tu asesor que te reenvíe el informe.';
    render();
    return;
  }
  state.paso = 'cargando';
  render();
  const { data, error } = await supabase.rpc('agenda_informe_propietario_datos', { p_token: state.token });
  if (error || !data || data.error === 'no_encontrado') {
    state.paso = 'error';
    state.errorMsg = 'Este enlace no es válido o ya no está activo. Si crees que esto es un error, contacta a tu asesor.';
    render();
    return;
  }
  state.datos = data;
  state.paso = 'listo';
  render();
}

function vistaCargando() {
  return `<div class="pu-spinner">Cargando el informe de tu inmueble…</div>`;
}

function vistaError() {
  return `<div class="pu-error">${escapeHtml(state.errorMsg)}</div>`;
}

function tarjetaInmueble() {
  const d = state.datos;
  const ubicacion = [d.barrio, d.ciudad].filter(Boolean).join(', ');
  const valor = d.tipo_oferta === 'Venta' ? formatoMoneda(d.valor_venta) : formatoMoneda(d.valor_canon);
  const admon = d.tiene_administracion ? formatoMoneda(d.valor_administracion) : null;
  return `
    <div class="pu-card">
      <div style="font-size:13px;color:var(--pu-muted)">Inmueble ${d.numero_inmueble}</div>
      <h2 style="margin-top:4px">${escapeHtml(d.direccion) || 'Tu inmueble'}</h2>
      ${ubicacion ? `<div style="font-size:13px;color:var(--pu-muted)">${escapeHtml(ubicacion)}</div>` : ''}
      <div style="margin-top:10px">
        <span class="pu-badge">${escapeHtml(d.tipo_oferta || 'Sin tipo')}</span>
        ${d.asesor_comercializacion ? `<span class="pu-badge">Asesor: ${escapeHtml(d.asesor_comercializacion)}</span>` : ''}
      </div>
      ${valor ? `<div class="pu-precio">${valor}</div>` : ''}
      ${admon ? `<div style="font-size:13.5px;color:var(--pu-muted);margin:2px 0 4px">Administración: ${admon}${d.administracion_incluida ? ' (incluida en el canon)' : ''}</div>` : ''}
    </div>
  `;
}

function tarjetaPublicacion() {
  const d = state.datos;
  const enlaces = [];
  if (d.codigo_metrocuadrado) {
    enlaces.push({ nombre: 'Metrocuadrado', url: `https://www.metrocuadrado.com/inmueble/i/${encodeURIComponent(d.codigo_metrocuadrado)}` });
  }
  if (d.codigo_fincaraiz) {
    enlaces.push({ nombre: 'Finca Raíz', url: `https://www.fincaraiz.com.co/i/${encodeURIComponent(d.codigo_fincaraiz)}` });
  }
  if (d.enlace_ciencuadras) {
    enlaces.push({ nombre: 'Ciencuadras', url: d.enlace_ciencuadras });
  }
  if (!d.enlace_propio && !enlaces.length) return '';
  return `
    <h3>Cómo está publicado</h3>
    <div class="pu-card">
      ${d.enlace_propio ? `<a class="pu-main" style="display:block;text-align:center;text-decoration:none;line-height:48px;margin-top:0" href="${escapeHtml(d.enlace_propio)}" target="_blank" rel="noopener">Ver en patrimonios.co</a>` : ''}
      ${enlaces.map((e) => `<a class="pu-ver-inmueble" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Ver en ${escapeHtml(e.nombre)}</a>`).join('')}
    </div>
  `;
}

function tarjetaActividad() {
  const d = state.datos;
  return `
    <h3>Actividad</h3>
    <div class="pu-card" style="display:flex;gap:18px;flex-wrap:wrap">
      <div><div style="font-size:24px;font-weight:700;color:var(--pu-navy)">${d.citas_total ?? 0}</div><div style="font-size:13px;color:var(--pu-muted)">Visitas agendadas</div></div>
      <div><div style="font-size:16px;font-weight:600;color:var(--pu-navy)">${d.ultima_fecha ? formatoFecha(d.ultima_fecha) : 'Ninguna todavía'}</div><div style="font-size:13px;color:var(--pu-muted)">Última visita</div></div>
    </div>
  `;
}

function estrellas(calificacion) {
  if (!calificacion) return '';
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= calificacion ? '★' : '☆';
  return `<div style="color:#E6A817;font-size:15px;letter-spacing:1px">${out}</div>`;
}

function tarjetaOpiniones() {
  const opiniones = state.datos.opiniones || [];
  if (!opiniones.length) {
    return `<h3>Opiniones de clientes</h3><p class="pu-vacio">Todavía no hay comentarios registrados sobre las visitas a este inmueble.</p>`;
  }
  return `
    <h3>Opiniones de clientes</h3>
    <div class="pu-card" style="display:flex;flex-direction:column;gap:14px">
      ${opiniones
        .map(
          (o) => `
        <div style="border-bottom:1px solid var(--pu-border);padding-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:13px">${o.fuente === 'encuesta_cliente' ? 'Opinión de un cliente' : 'Nota del asesor'}</strong>
            <span style="font-size:12px;color:var(--pu-muted)">${o.fecha ? formatoFecha(o.fecha) : ''}</span>
          </div>
          ${estrellas(o.calificacion)}
          ${o.comentario ? `<p style="margin:6px 0 0;font-size:14px">${escapeHtml(o.comentario)}</p>` : ''}
        </div>`,
        )
        .join('')}
    </div>
  `;
}

function formularioSolicitud() {
  const tipo = state.formAbierto;
  if (!tipo) return '';
  const esPrecio = tipo === 'cambio_precio';
  return `
    <div class="pu-card" style="margin-top:14px">
      <h3 style="margin-top:0">${ETIQUETAS_TIPO[tipo]}</h3>
      <form id="pu-solicitud-form" data-tipo="${tipo}">
        ${esPrecio ? `<label for="pu-valor-propuesto">¿A cuánto quieres ajustar el precio?</label><input id="pu-valor-propuesto" type="number" min="0" step="1" placeholder="Ej: 850000000">` : ''}
        <label for="pu-detalle">${esPrecio ? 'Cuéntanos por qué (opcional)' : tipo === 'cambio_fotos' ? '¿Qué fotos quieres cambiar o agregar?' : '¿En qué te gustaría que te asesoremos?'}</label>
        <textarea id="pu-detalle" rows="3" placeholder="Escribe aquí…" ${esPrecio ? '' : 'required'}></textarea>
        <label for="pu-nombre">Tu nombre</label>
        <input id="pu-nombre" type="text" required placeholder="Nombre completo">
        <label for="pu-correo">Tu correo</label>
        <input id="pu-correo" type="email" required placeholder="tucorreo@ejemplo.com">
        <div class="pu-error" role="alert" style="${state.errorForm ? '' : 'display:none'}">${escapeHtml(state.errorForm)}</div>
        <button class="pu-main" type="submit" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Enviando…' : 'Enviar solicitud'}</button>
        <button type="button" class="pu-link" id="pu-cancelar-solicitud" style="margin-top:10px">Cancelar</button>
      </form>
    </div>
  `;
}

function accionesSolicitud() {
  return `
    <h3>¿Quieres algo distinto?</h3>
    <p>Estas acciones le envían una solicitud a tu asesor (y a su supervisor); no cambian nada automáticamente en el anuncio.</p>
    ${state.mensajeExito ? `<div class="pu-card" style="background:#eafaf4;border-color:#bfe8d8">${escapeHtml(state.mensajeExito)}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px">
      <button type="button" class="pu-ver-inmueble" data-abrir="cambio_precio">Solicitar cambio de precio</button>
      <button type="button" class="pu-ver-inmueble" data-abrir="cambio_fotos">Solicitar cambio de fotos</button>
      <button type="button" class="pu-ver-inmueble" data-abrir="asesoria">Pedir una asesoría</button>
    </div>
    ${formularioSolicitud()}
  `;
}

function vistaListo() {
  return `
    ${tarjetaInmueble()}
    ${tarjetaPublicacion()}
    ${tarjetaActividad()}
    ${tarjetaOpiniones()}
    <div style="margin-top:28px">${accionesSolicitud()}</div>
  `;
}

function render() {
  if (!hayConfiguracionSupabase()) {
    raiz.innerHTML = `<div class="pu-error">No se pudo conectar con el servicio. Intenta más tarde.</div>`;
    return;
  }
  let html = '';
  if (state.paso === 'cargando') html = vistaCargando();
  else if (state.paso === 'error') html = vistaError();
  else if (state.paso === 'listo') html = vistaListo();
  raiz.innerHTML = html;
  cablear();
}

async function enviarSolicitud(form) {
  const tipo = form.dataset.tipo;
  const valorInput = form.querySelector('#pu-valor-propuesto');
  const detalle = form.querySelector('#pu-detalle').value.trim();
  const nombre = form.querySelector('#pu-nombre').value.trim();
  const correo = form.querySelector('#pu-correo').value.trim();

  if (!nombre || nombre.length < 2) {
    state.errorForm = 'Escribe tu nombre completo.';
    render();
    return;
  }
  if (!correo || !/\S+@\S+\.\S+/.test(correo)) {
    state.errorForm = 'Escribe un correo electrónico válido.';
    render();
    return;
  }
  if (tipo !== 'cambio_precio' && !detalle) {
    state.errorForm = 'Cuéntanos un poco más antes de enviar la solicitud.';
    render();
    return;
  }

  state.enviando = true;
  state.errorForm = '';
  render();

  const { data, error } = await supabase.functions.invoke('enviar-solicitud-propietario', {
    body: {
      token: state.token,
      tipo,
      valor_propuesto: valorInput && valorInput.value ? Number(valorInput.value) : null,
      detalle: detalle || null,
      propietario_nombre: nombre,
      propietario_email: correo,
    },
  });

  state.enviando = false;
  if (error || data?.error) {
    state.errorForm = mensajeAmigable(error, 'No se pudo enviar tu solicitud. Intenta de nuevo en unos minutos.');
    render();
    return;
  }

  state.formAbierto = null;
  state.errorForm = '';
  state.mensajeExito = 'Tu solicitud fue enviada a tu asesor. Se pondrán en contacto contigo pronto.';
  render();
}

function cablear() {
  const botonesAbrir = raiz.querySelectorAll('[data-abrir]');
  botonesAbrir.forEach((b) => {
    b.addEventListener('click', () => {
      state.formAbierto = b.dataset.abrir;
      state.errorForm = '';
      state.mensajeExito = '';
      render();
      const detalle = document.getElementById('pu-detalle');
      if (detalle) detalle.focus();
    });
  });
  const cancelar = document.getElementById('pu-cancelar-solicitud');
  if (cancelar) {
    cancelar.addEventListener('click', () => {
      state.formAbierto = null;
      state.errorForm = '';
      render();
    });
  }
  const form = document.getElementById('pu-solicitud-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      enviarSolicitud(form);
    });
  }
}

cargarInforme();
