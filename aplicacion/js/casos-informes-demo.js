// Vista de prueba de los informes y la encuesta de un caso de mantenimiento. Sin red, sin datos personales.
import { informeHTML, encuestaCorreoHTML, encuestaWebHTML, revisarTexto, esc } from './casos-informes.js';

const FOTOS = [
  { id: 'a1', grupo: 'antes', url: '/demo/antes-1.svg', pie: 'Humedad en el techo del baño' },
  { id: 'a2', grupo: 'antes', url: '/demo/antes-2.svg', pie: 'Mancha en la pared' },
  { id: 'd1', grupo: 'despues', url: '/demo/despues-1.svg', pie: 'Techo reparado y pintado' },
  { id: 'd2', grupo: 'despues', url: '/demo/despues-2.svg', pie: 'Pared lista' },
];
const DOCS = [{ id: 'x1', nombre: 'Informe técnico (PDF)', url: '#' }, { id: 'x2', nombre: 'Acta de cierre (PDF)', url: '#' }];
const $ = (id) => document.getElementById(id);
$('t-intro').value = 'Le compartimos el resultado de la reparación realizada en el inmueble: lo que encontramos, lo que se hizo y las fotos del antes y el después.';
$('t-hallazgo').value = 'En la visita técnica observamos indicios de una filtración de agua. El origen más probable es una fuga en la zona del baño del piso superior, que había manchado el techo y parte de la pared.';
$('t-trabajo').value = 'Se corrigió la fuga, se retiró el material afectado, se resanó y se pintó. La zona quedó seca, limpia y lista para usar.';
$('t-reco').value = 'Le sugerimos revisar en unos días que la zona siga seca. Si nota una nueva mancha, avísenos y la revisaremos.';
$('fotos').innerHTML = FOTOS.map((f) => `<label class="foto"><input type="checkbox" data-foto="${f.id}" checked><img src="${f.url}" alt=""><span><strong>${f.grupo === 'antes' ? 'Antes' : 'Después'}</strong><br>${esc(f.pie)}</span></label>`).join('');
$('docs').innerHTML = DOCS.map((x) => `<label class="doc"><input type="checkbox" data-doc-adj="${x.id}"> ${esc(x.nombre)}</label>`).join('');

let doc = 'informe'; let ancho = 390; let scroll = 0;
const movil = () => matchMedia('(max-width:900px)').matches;
const marcadas = () => new Set([...document.querySelectorAll('[data-foto]:checked')].map((i) => i.dataset.foto));
const adjuntos = () => new Set([...document.querySelectorAll('[data-doc-adj]:checked')].map((i) => i.dataset.docAdj));
const datos = () => { const sel = marcadas(); const ad = adjuntos(); return { copropiedad: 'Edificio de ejemplo', unidad: 'Apto 402', caso: '97', fechaVisita: '2026-11-10', fechaCierre: '2026-11-24', saludo: 'Estimado(a)', introduccion: $('t-intro').value, hallazgo: $('t-hallazgo').value, trabajo: $('t-trabajo').value, recomendacion: $('t-reco').value,
  antes: FOTOS.filter((f) => f.grupo === 'antes' && sel.has(f.id)), despues: FOTOS.filter((f) => f.grupo === 'despues' && sel.has(f.id)),
  documentos: DOCS.filter((x) => ad.has(x.id)), enlace: '#', remitente: 'Coordinación de inmuebles', contacto: { razon: 'Patrimonios Inmobiliarios S.A.S.', correo: 'solicitudes@ejemplo.co' } }; };
const destinoTexto = () => ($('dest').value === 'otra' ? $('dest-otra').value.trim() : $('dest').selectedOptions[0]?.textContent.replace('— Elegir destinatario —', '').trim());

const NOMBRES = { ortografia: 'Ortografía', redaccion: 'Redacción', juridico: 'Jurídico', datos: 'Datos personales', tono: 'Tono' };
let probActuales = [];
function estado() {
  const textos = ['t-intro', 't-hallazgo', 't-trabajo', 't-reco'].map((i) => $(i).value).join('\n\n') + '\n\n' + $('asunto').value;
  probActuales = revisarTexto(textos);
  const bloqueos = probActuales.filter((p) => p.bloquea); const avisos = probActuales.filter((p) => !p.bloquea);
  $('rev').innerHTML = (probActuales.length ? probActuales.map((p) => `<div class="item ${p.bloquea ? 'mal' : 'avi'}"><strong>${NOMBRES[p.tipo]}${p.bloquea ? ' (debe corregirse)' : ' (aviso)'}:</strong> ${esc(p.mensaje)}${p.fragmento ? ` <em>(«${esc(p.fragmento)}»)</em>` : ''}</div>`).join('') : '<div class="item ok">La revisión básica no encontró alertas. No reemplaza la revisión de una persona.</div>')
    + '<div class="item avi">Revisión básica en el equipo. Antes de cada envío real, la revisión completa (ortografía, jurídica y de tono) se hará con IA.</div>';
  $('l-otra').style.display = $('dest').value === 'otra' ? 'grid' : 'none';
  $('forzar-fila').style.display = avisos.length && !bloqueos.length ? 'flex' : 'none';
  let razon = '';
  if (!$('dest').value) razon = 'Falta elegir a quién se envía el informe.';
  else if ($('dest').value === 'otra' && !$('dest-otra').value.trim()) razon = 'Falta indicar a quién se envía (otra persona).';
  else if (!marcadas().size) razon = 'Marque al menos una foto.';
  else if (!$('asunto').value.trim()) razon = 'Falta el asunto del correo.';
  else if (bloqueos.length) razon = 'Corrija lo marcado «debe corregirse» en la revisión de los textos.';
  else if (avisos.length && !$('forzar').checked) razon = 'Hay avisos en los textos: corríjalos o marque «enviar de todos modos».';
  $('porque').textContent = razon;
  for (const id of ['enviar', 'enviar2']) $(id).disabled = !!razon;
}
function pintar() {
  const o = { base: '/' };
  const html = doc === 'informe' ? informeHTML(datos(), o) : doc === 'encuesta' ? encuestaCorreoHTML({ saludo: 'Estimado(a)', copropiedad: 'Edificio de ejemplo', unidad: 'Apto 402', enlace: '#', contacto: { correo: 'solicitudes@ejemplo.co' } }, o) : encuestaWebHTML({ copropiedad: 'Edificio de ejemplo', unidad: 'Apto 402', inicial: 5, contacto: { correo: 'solicitudes@ejemplo.co' } }, o);
  const f = $('vista'); try { scroll = f.contentWindow?.scrollY || scroll; } catch { /* sin acceso */ }
  f.onload = () => { try { f.contentWindow.scrollTo(0, scroll); } catch { /* sin acceso */ } };
  f.srcdoc = html; estado(); escalar();
  $('pie-vista').textContent = doc === 'informe' ? 'Este informe va a la persona que se elija arriba (propietario, arrendatario u otra). No menciona quién paga ni quién hizo el arreglo.' : 'La encuesta va normalmente a quien pidió el arreglo. No trae costos ni datos de otras personas.';
}
function escalar() {
  const esc2 = $('escena'); const disp = esc2.clientWidth - 32; const w = movil() ? Math.max(320, disp) : ancho; const s = Math.min(1, disp / w);
  const alto = Math.max(560, Math.round(innerHeight * (movil() ? 0.72 : 0.78)));
  const f = $('vista'); f.style.width = w + 'px'; f.style.height = Math.round(alto / s) + 'px'; f.style.transform = `scale(${s})`;
  $('marco').style.width = Math.round(w * s) + 'px'; $('marco').style.height = alto + 'px';
}
let t; const lento = () => { clearTimeout(t); t = setTimeout(pintar, 250); };
document.querySelectorAll('textarea,#asunto,[data-foto],[data-doc-adj]').forEach((e) => e.addEventListener('input', lento));
['dest', 'dest-otra', 'forzar'].forEach((i) => $(i).addEventListener('input', estado));
document.querySelectorAll('[data-doc]').forEach((b) => { b.onclick = () => { doc = b.dataset.doc; scroll = 0; document.querySelectorAll('[data-doc]').forEach((x) => x.setAttribute('aria-pressed', x === b)); pintar(); }; });
document.querySelectorAll('[data-ancho]').forEach((b) => { b.onclick = () => { ancho = +b.dataset.ancho; document.querySelectorAll('[data-ancho]').forEach((x) => x.setAttribute('aria-pressed', x === b)); escalar(); }; });
document.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => { document.body.dataset.vista = b.dataset.ver; document.querySelectorAll('[data-ver]').forEach((x) => x.setAttribute('aria-selected', x === b)); setTimeout(escalar, 0); window.scrollTo(0, 0); }; });
addEventListener('resize', escalar);
const aviso = (m) => { $('msg').style.display = 'block'; $('msg').textContent = m; $('msg').scrollIntoView({ block: 'nearest' }); };
const probar = () => aviso('Prueba: en producción, el mismo correo llegaría a la cuenta de quien trabaja, para ver cómo se ve. Aquí no se envió nada.');
const enviar = () => aviso(`Se enviará a: ${destinoTexto()}. Asunto: «${$('asunto').value}». En producción pasaría primero por la revisión con IA y quedaría registrado quién lo aprobó. Aquí no se envió nada.`);
$('prueba').onclick = probar; $('prueba2').onclick = probar; $('enviar').onclick = enviar; $('enviar2').onclick = enviar;
pintar();
