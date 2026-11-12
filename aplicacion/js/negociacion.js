// Página pública /negociacion/<token>: el comprador interesado y el propietario negocian SOLO el valor de compra (sql/082, función portal-negociacion).
// No hay texto libre ni teléfonos: cada parte escribe únicamente una cifra o acepta/da por terminada la conversación, y solo en su turno.
// Si el valor se acuerda, el comprador deja los datos básicos para preparar la promesa. Nada es vinculante hasta la firma de la promesa.
import { supabase, hayConfiguracionSupabase } from './cliente-supabase.js';
import { aplicarMarcaPublica } from './marca-publica.js';

const raiz = document.getElementById('pu-main');
const state = { token: null, paso: 'cargando', d: null, error: '', enviando: false, valor: '', exito: '' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesos = (n) => (n == null ? '—' : `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`);
const soloDigitos = (v) => String(v || '').replace(/\D/g, '').slice(0, 13);
const AVISO = 'Esta propuesta es una manifestación de interés <b>no vinculante</b>: no constituye oferta de compra, promesa ni compraventa. El compromiso nace únicamente con la firma de la promesa de compraventa. Patrimonios actúa como intermediario, no garantiza la aceptación ni la disponibilidad del inmueble y no recibe dinero por este medio.';

function tokenDesdeUrl() {
  const ruta = window.location.pathname.match(/negociacion\/([0-9a-f-]{8,})/i);
  return ruta ? ruta[1] : new URLSearchParams(window.location.search).get('token');
}

async function llamar(cuerpo) {
  const { data, error } = await supabase.functions.invoke('portal-negociacion', { body: { token: state.token, ...cuerpo } });
  if (error) {
    let msg = 'No pudimos completar la acción. Inténtalo de nuevo.';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin detalle */ }
    return { ok: false, error: msg };
  }
  return data;
}

function historial(d) {
  const rot = { propuesta: 'Propuesta del comprador', contrapropuesta: 'Contrapropuesta del propietario', acepta: 'Aceptó', rechaza: 'No continuó' };
  const mov = (d.movimientos || []).slice().reverse();
  if (!mov.length) return '';
  return `<h3 class="pu-seccion">Historial de valores</h3>${mov.map((m) => `<div class="pu-eleccion" style="cursor:default"><span><strong>${esc(m.valor ? pesos(m.valor) : '—')}</strong><small>${esc(rot[m.accion] || m.accion)} · ${esc(new Date(m.en).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }))}</small></span></div>`).join('')}`;
}

function resumen(d) {
  return `<div class="pu-card"><h2>Inmueble Nº ${esc(d.numero_inmueble)}</h2>
    <p>${esc([d.direccion, d.barrio, d.ciudad].filter(Boolean).join(', '))}</p>
    <p style="margin:0">Valor publicado</p><p style="font-size:30px;font-weight:700;color:var(--pu-navy,#1a2c45);margin:0 0 4px">${esc(pesos(d.valor_publicado))}</p>
    ${d.valor_vigente && d.estado === 'abierta' ? `<p style="margin:10px 0 0">Último valor propuesto</p><p style="font-size:24px;font-weight:700;margin:0">${esc(pesos(d.valor_vigente))}</p>` : ''}</div>`;
}

function campoValor(etiqueta, boton) {
  return `<label for="ng-valor">${etiqueta}</label>
    <input id="ng-valor" inputmode="numeric" autocomplete="off" placeholder="Ej.: 450000000" value="${esc(state.valor)}" maxlength="20">
    <p class="pu-nota" id="ng-vista" style="min-height:18px">${state.valor ? esc(pesos(state.valor)) : ''}</p>
    <button class="pu-main" type="button" id="ng-proponer" ${state.enviando ? 'disabled' : ''}>${boton}</button>`;
}

function vistaAbierta(d) {
  const esComprador = d.rol === 'comprador';
  const miTurno = d.turno === d.rol;
  const vence = new Date(d.vence_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
  let acciones = '';
  if (!miTurno) {
    acciones = `<div class="pu-card"><h2>Esperando respuesta</h2><p style="margin:0">Le avisamos a la otra parte. Cuando responda te escribimos por correo. La conversación sigue abierta hasta el ${esc(vence)}.</p></div>`;
  } else if (esComprador) {
    acciones = `<div class="pu-card"><h2>${d.valor_vigente ? 'El propietario propuso otro valor' : 'Propón un valor'}</h2>
      <p>${d.valor_vigente ? `Puedes aceptar ${esc(pesos(d.valor_vigente))} o proponer otro valor.` : 'Escribe el valor que te interesa. Solo se necesita la cifra.'}</p>
      ${d.valor_vigente ? `<button class="pu-main" type="button" id="ng-aceptar" ${state.enviando ? 'disabled' : ''}>Aceptar ${esc(pesos(d.valor_vigente))}</button><h3 class="pu-seccion">O propón otro valor</h3>` : ''}
      ${campoValor('Valor que propones (COP)', 'Enviar mi propuesta')}
      <p style="margin-top:16px"><button class="pu-link" type="button" id="ng-rechazar">No quiero continuar con este inmueble</button></p></div>`;
  } else {
    acciones = `<div class="pu-card"><h2>Responde a la propuesta</h2>
      <p>Puedes aceptar ${esc(pesos(d.valor_vigente))} o proponer otro valor. No se comparten datos personales hasta que se acuerde el valor.</p>
      <button class="pu-main" type="button" id="ng-aceptar" ${state.enviando ? 'disabled' : ''}>Aceptar ${esc(pesos(d.valor_vigente))}</button>
      <h3 class="pu-seccion">O propón otro valor</h3>
      ${campoValor('Valor que propones (COP)', 'Enviar otro valor')}
      <p style="margin-top:16px"><button class="pu-link" type="button" id="ng-rechazar">No quiero continuar</button></p></div>`;
  }
  return `${resumen(d)}${acciones}${historial(d)}<p class="pu-nota" style="margin-top:18px">${AVISO}</p>`;
}

const CAMPOS_PROMESA = `
  <label for="pr-tipo">Compras como</label><select id="pr-tipo"><option value="natural">Persona natural</option><option value="juridica">Empresa</option></select>
  <label for="pr-nombre" id="pr-nombre-et">Nombre completo</label><input id="pr-nombre" maxlength="160" autocomplete="name">
  <label for="pr-tdoc">Tipo de documento</label><select id="pr-tdoc"><option value="CC">Cédula de ciudadanía</option><option value="CE">Cédula de extranjería</option><option value="PA">Pasaporte</option><option value="NIT">NIT</option><option value="otro">Otro</option></select>
  <label for="pr-ndoc">Número de documento</label><input id="pr-ndoc" maxlength="30" inputmode="text" autocomplete="off">
  <div id="pr-rep-caja" hidden><label for="pr-rep">Nombre del representante legal</label><input id="pr-rep" maxlength="160"></div>
  <div id="pr-civil-caja"><label for="pr-civil">Estado civil</label><select id="pr-civil"><option value="">Prefiero decirlo después</option><option value="soltero">Soltero(a)</option><option value="casado">Casado(a)</option><option value="union_libre">Unión marital de hecho</option><option value="divorciado">Divorciado(a)</option><option value="viudo">Viudo(a)</option></select></div>
  <label for="pr-email">Correo electrónico</label><input id="pr-email" type="email" maxlength="160" autocomplete="email" value="">
  <label for="pr-cel">Celular</label><input id="pr-cel" type="tel" maxlength="20" autocomplete="tel">
  <label for="pr-dir">Dirección de notificación (opcional)</label><input id="pr-dir" maxlength="200" autocomplete="street-address">
  <label for="pr-pago">Forma de pago prevista</label><select id="pr-pago"><option value="contado">Recursos propios (contado)</option><option value="credito_hipotecario">Crédito hipotecario</option><option value="subsidio">Subsidio</option><option value="mixto">Mixta</option><option value="otro">Otra</option></select>
  <label class="pu-eleccion" style="margin-top:14px"><input type="checkbox" id="pr-otros-chk"><span><strong>Compro junto con otra persona</strong></span></label>
  <div id="pr-otros-caja" hidden><label for="pr-otros">Nombres de las otras personas</label><input id="pr-otros" maxlength="400"></div>`;

function vistaAcordada(d) {
  if (d.rol === 'propietario') {
    return `${resumen(d)}<div class="pu-card"><div class="pu-icono" style="margin:0 0 8px">✓</div><h2>Acordaron un valor</h2><p>Valor acordado: <strong>${esc(pesos(d.valor_acordado))}</strong>. Tu asesor te contactará para los pasos siguientes: revisión de documentos del inmueble y preparación de la promesa de compraventa.</p><p class="pu-nota">${AVISO}</p></div>${historial(d)}`;
  }
  if (d.promesa_enviada && !state.editarPromesa) {
    return `${resumen(d)}<div class="pu-card"><div class="pu-icono" style="margin:0 0 8px">✓</div><h2>Recibimos tus datos</h2><p>Tu asesor los revisará y se pondrá en contacto contigo para los pasos siguientes. Recuerda que el acuerdo de valor no es vinculante hasta la firma de la promesa de compraventa.</p>
      <p><button class="pu-link" type="button" id="ng-editar">Quiero corregir mis datos</button></p></div>`;
  }
  return `${resumen(d)}<div class="pu-card"><h2>Acordaron el valor: ${esc(pesos(d.valor_acordado))}</h2>
    <p>Para preparar la promesa de compraventa necesitamos estos datos básicos. <b>Este acuerdo todavía no es vinculante</b>: el compromiso nace solo con la firma de la promesa, y antes la revisa un abogado.</p>
    <form id="ng-promesa" novalidate>${CAMPOS_PROMESA}
      <h3 class="pu-seccion">Documentos</h3>
      <p class="pu-nota" style="margin-top:0">Por tu seguridad no se suben aquí. Tu asesor te dirá cuándo enviar, por correo${d.correo_documentos ? ` a <b>${esc(d.correo_documentos)}</b>` : ''}: copia de tu documento de identidad, RUT (si lo exige la notaría), certificado de existencia y representación si compras con una empresa, y carta de aprobación si pagas con crédito.</p>
      <label class="pu-eleccion" style="margin-top:16px"><input type="checkbox" id="pr-autoriza"><span><strong>Autorizo el tratamiento de mis datos</strong><small>${esc(d.texto_autorizacion || '')}</small></span></label>
      <div class="pu-error" role="alert" id="pr-error" style="${state.error ? '' : 'display:none'}">${esc(state.error)}</div>
      <button class="pu-main" type="submit" id="pr-enviar" ${state.enviando ? 'disabled' : ''}>${state.enviando ? 'Enviando…' : 'Enviar mis datos'}</button>
    </form><p class="pu-nota" style="margin-top:14px">${AVISO}</p></div>`;
}

function vista() {
  if (state.paso === 'cargando') return '<div class="pu-confirmacion"><p>Cargando…</p></div>';
  if (state.paso === 'error') return `<div class="pu-error">${esc(state.error)}</div>`;
  const d = state.d;
  const aviso = state.exito ? `<div class="pu-card" role="status"><strong>${esc(state.exito)}</strong></div>` : '';
  const errorTop = state.error && d.estado === 'abierta' ? `<div class="pu-error" role="alert">${esc(state.error)}</div>` : '';
  if (d.estado === 'abierta') return `${aviso}${errorTop}${vistaAbierta(d)}`;
  if (d.estado === 'acordada') return `${aviso}${vistaAcordada(d)}`;
  const txt = d.estado === 'vencida' ? 'Pasaron 7 días sin respuesta y la conversación se cerró.' : 'La conversación se cerró sin acuerdo.';
  return `${aviso}${resumen(d)}<div class="pu-card"><h2>Conversación cerrada</h2><p style="margin:0">${txt} No se compartió ningún dato personal entre las partes. Si quieres retomarla, escríbele a tu asesor.</p></div>${historial(d)}`;
}

function render() {
  raiz.innerHTML = vista();
  const vi = raiz.querySelector('#ng-valor');
  vi?.addEventListener('input', () => { state.valor = soloDigitos(vi.value); vi.value = state.valor; const p = raiz.querySelector('#ng-vista'); if (p) p.textContent = state.valor ? pesos(state.valor) : ''; });
  raiz.querySelector('#ng-proponer')?.addEventListener('click', () => decidir('proponer'));
  raiz.querySelector('#ng-aceptar')?.addEventListener('click', () => { if (window.confirm(`¿Aceptar ${pesos(state.d.valor_vigente)}?`)) decidir('aceptar'); });
  raiz.querySelector('#ng-rechazar')?.addEventListener('click', () => { if (window.confirm('¿Seguro que no quieres continuar? La conversación se cerrará.')) decidir('rechazar'); });
  raiz.querySelector('#ng-editar')?.addEventListener('click', () => { state.editarPromesa = true; render(); });
  const f = raiz.querySelector('#ng-promesa');
  if (f) {
    const tipo = f.querySelector('#pr-tipo');
    const ajustar = () => {
      const j = tipo.value === 'juridica';
      f.querySelector('#pr-rep-caja').hidden = !j; f.querySelector('#pr-civil-caja').hidden = j;
      f.querySelector('#pr-nombre-et').textContent = j ? 'Razón social' : 'Nombre completo';
      if (j) f.querySelector('#pr-tdoc').value = 'NIT';
    };
    tipo.addEventListener('change', ajustar);
    f.querySelector('#pr-otros-chk').addEventListener('change', (e) => { f.querySelector('#pr-otros-caja').hidden = !e.target.checked; });
    f.addEventListener('submit', (e) => { e.preventDefault(); enviarPromesa(f); });
  }
}

async function decidir(decision) {
  state.enviando = true; state.error = ''; state.exito = ''; render();
  const r = await llamar({ accion: 'responder', decision, valor: state.valor });
  state.enviando = false;
  if (!r?.ok) { state.error = r?.error || 'No pudimos registrar tu respuesta.'; render(); return; }
  state.valor = '';
  await cargar();
  state.exito = decision === 'proponer' ? 'Enviamos tu valor. Te avisaremos por correo cuando haya respuesta.' : decision === 'aceptar' ? 'Quedó acordado el valor.' : 'Cerramos la conversación.';
  render();
}

async function enviarPromesa(f) {
  const v = (id) => f.querySelector(id).value;
  const datos = { tipo_persona: v('#pr-tipo'), nombre_completo: v('#pr-nombre'), tipo_documento: v('#pr-tdoc'), numero_documento: v('#pr-ndoc'), representante_legal: v('#pr-rep'), estado_civil: v('#pr-civil'),
    email: v('#pr-email'), celular: v('#pr-cel'), direccion: v('#pr-dir'), forma_pago: v('#pr-pago'), compra_con_otros: f.querySelector('#pr-otros-chk').checked, otros_compradores: v('#pr-otros') };
  if (!f.querySelector('#pr-autoriza').checked) { state.error = 'Para continuar debes autorizar el tratamiento de tus datos.'; render(); return; }
  state.enviando = true; state.error = ''; render();
  const r = await llamar({ accion: 'promesa', datos, autoriza: true });
  state.enviando = false;
  if (!r?.ok) { state.error = r?.error || 'No pudimos guardar tus datos.'; render(); return; }
  state.editarPromesa = false;
  await cargar();
  state.exito = 'Recibimos tus datos. Gracias.';
  render();
}

async function cargar() {
  const r = await llamar({ accion: 'ver' });
  if (!r?.ok) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; return; }
  state.d = r; state.paso = 'listo';
}

async function iniciar() {
  if (!hayConfiguracionSupabase()) { state.paso = 'error'; state.error = 'No pudimos cargar la página. Inténtalo de nuevo en unos minutos.'; render(); return; }
  state.token = tokenDesdeUrl();
  if (!state.token) { state.paso = 'error'; state.error = 'Este enlace no funciona o ya venció.'; render(); return; }
  render();
  await cargar();
  render();
}

aplicarMarcaPublica();
iniciar();
