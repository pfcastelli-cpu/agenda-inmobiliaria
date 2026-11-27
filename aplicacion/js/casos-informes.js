// Plantillas de los correos e informes de un caso de mantenimiento locativo.
//  - informeHTML: informe al destinatario que decide la persona. NO nombra quién paga ni quién hizo el arreglo.
//  - encuestaCorreoHTML / encuestaWebHTML: encuesta de satisfacción (normalmente a quien pidió el arreglo). Sin costos ni datos de otras personas.
//  - revisarTexto: revisión básica local. Bloquean solo «datos» y «juridico»; el resto son avisos. La revisión completa irá con IA.
// Correo: tablas, estilos en línea y un bloque @media; botones y números con el fondo en la celda (compatible con Outlook de escritorio).
// Sin datos personales: el saludo lo resuelve quien envía; aquí solo se recibe el texto final. Las revisiones de diseño, correo y jurídica
// de esta plantilla quedaron registradas en docs/CASOS-AUTOMATIZACION.md.

const AZUL = '#1A2C45'; const TURQUESA = '#00A9A5'; const FONDO = '#F2F5F9'; const TEXTO = '#27323F'; const SUAVE = '#4F5B6C';
const VERDE = '#0B7A75'; const AMBAR = '#8F5500';
const FUENTE = "Poppins,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Solo enlaces https (o «#» en las pruebas): evita javascript: y data: */
const urlOk = (u) => (/^https:\/\//i.test(String(u ?? '')) || /^\/(?!\/)/.test(String(u ?? '')) || u === '#' ? esc(u) : '#');
const conParam = (u, k, v) => `${urlOk(u)}${String(u).includes('?') ? '&amp;' : '?'}${k}=${v}`;
const tinte = (hex, a = 0.12) => { const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return '#' + n.map((x) => Math.round(255 - (255 - x) * a).toString(16).padStart(2, '0')).join(''); };
const parrafos = (t) => esc(String(t ?? '').replace(/\r\n?/g, '\n')).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">${p.replace(/\n/g, '<br>')}</p>`).join('');
const fechaLarga = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
/** Insignia: tabla pequeña con fondo sólido (Outlook no entiende colores con transparencia). */
const insignia = (texto, color) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table"><tr><td bgcolor="${tinte(color)}" style="background:${tinte(color)};border-radius:999px;padding:5px 13px;font-family:${FUENTE};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color}">${esc(texto)}</td></tr></table>`;

const CSS = `
  :root{color-scheme:light only;supported-color-schemes:light only}
  body{margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%;text-size-adjust:100%}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  a{color:${AZUL}}
  @media only screen and (max-width:640px){
    .contenedor{width:100%!important;border-radius:0!important}
    .pad{padding-left:20px!important;padding-right:20px!important}
    .col{display:block!important;width:100%!important;padding:0 0 14px 0!important}
    .titulo{font-size:24px!important;line-height:1.25!important}
    .boton,.boton td{width:100%!important}.boton td{padding:17px 20px!important}
    .btnl,.btnl td{width:100%!important}
    .estrella{width:44px!important;height:44px!important}
    .ficha td{display:block!important;width:100%!important;padding:4px 0!important}
  }`;

const DATOS_LEGALES = (c = {}) => `${esc(c.razon || 'Patrimonios Inmobiliarios S.A.S.')}${c.nit ? ` (NIT ${esc(c.nit)})` : ''}`;

function envoltura({ titulo, previa, cuerpo, c }) {
  return `<!doctype html><html lang="es" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><title>${esc(titulo)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${CSS}</style></head>
<body bgcolor="${FONDO}" style="margin:0;padding:0;background:${FONDO};font-family:${FUENTE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;visibility:hidden;font-size:1px;color:${FONDO}">${esc(previa)}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="contenedor" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(26,44,69,.10)">
${cuerpo}
</table>
<p style="max-width:560px;margin:16px auto 0;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${SUAVE};text-align:center">${DATOS_LEGALES(c)}. Este mensaje es informativo y solo para su destinatario. Si lo recibió por error, avísenos y elimínelo.<br>Tratamos sus datos personales como responsables, según nuestra ${c?.politica ? `<a href="${urlOk(c.politica)}" style="color:${SUAVE}">Política de Tratamiento de Datos</a>` : 'Política de Tratamiento de Datos'}, para gestionar la administración del inmueble. Puede conocer, actualizar, rectificar o suprimir sus datos, o revocar su autorización, escribiendo a ${c?.correo ? `<a href="mailto:${esc(c.correo)}" style="color:${SUAVE}">${esc(c.correo)}</a>` : 'la dirección de contacto de la empresa'}.</p>
</td></tr></table></body></html>`;
}

// Las fotos con personas ya traen el logo incorporado: con foto no se repite el logo arriba (misma regla de marca-correo.ts).
export { envoltura, insignia, parrafos, boton, pie, cabecera, fechaLarga, FUENTE, AZUL, TURQUESA, FONDO, TEXTO, SUAVE, VERDE, AMBAR };
const cabecera =(base, foto) => foto
  ? `<tr><td bgcolor="${AZUL}" style="padding:0;line-height:0;background:${AZUL}"><img src="${base}correo/${foto}" alt="Patrimonios Inmobiliarios" width="600" style="width:100%;max-width:600px;height:auto;display:block;color:#ffffff;font-family:${FUENTE};font-size:16px"></td></tr>`
  : `<tr><td align="center" bgcolor="#ffffff" style="background:#ffffff;padding:28px 24px 22px"><img src="${base}logo-patrimonios.png" alt="Patrimonios Inmobiliarios" width="131" height="46" style="height:46px;width:auto;max-width:240px;display:block"></td></tr>`;

const pie = () => `
<tr><td class="pad" bgcolor="${AZUL}" style="padding:26px 36px 32px;background:${AZUL};font-family:${FUENTE}">
  <div style="font-family:${FUENTE};font-size:16px;font-weight:600;color:#ffffff;margin:0">Tranquilidad que hace crecer su patrimonio.</div>
</td></tr>`;

const boton = (texto, url) => `<table role="presentation" class="boton" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td align="center" bgcolor="${TURQUESA}" style="border-radius:999px;background:${TURQUESA};padding:15px 30px"><a href="${urlOk(url)}" target="_blank" style="display:block;font-family:${FUENTE};font-size:16px;font-weight:600;color:#08262A;text-decoration:none">${esc(texto)}</a></td></tr></table>`;

function bloqueFotos(titulo, fotos, color) {
  if (!fotos?.length) return '';
  const celdas = fotos.map((f, i) => `<td class="col" width="50%" valign="top" style="padding:0 6px 14px 0"><img src="${urlOk(f.url)}" alt="${esc(titulo)}, foto ${i + 1}" width="258" style="width:100%;height:auto;display:block;border-radius:12px;border:1px solid #E3E8F0">${f.pie ? `<div style="font-family:${FUENTE};font-size:13px;color:${SUAVE};margin-top:6px">${esc(f.pie)}</div>` : ''}</td>`);
  const filas = []; for (let i = 0; i < celdas.length; i += 2) filas.push(`<tr>${celdas[i]}${celdas[i + 1] || '<td class="col" width="50%"></td>'}</tr>`);
  return `<tr><td class="pad" style="padding:8px 36px 0;font-family:${FUENTE}"><div style="margin:12px 0">${insignia(titulo, color)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas.join('')}</table></td></tr>`;
}

/** Informe de reparación. d: {copropiedad, unidad, caso, fechaVisita, fechaCierre, introduccion, hallazgo, trabajo, recomendacion, antes[], despues[], documentos[], saludo, enlace, remitente, contacto}. */
export function informeHTML(d, o = {}) {
  const base = o.base ?? '/';
  const ficha = [['Inmueble', [d.copropiedad, d.unidad].filter(Boolean).join(' · ')], ['Caso', d.caso ? `N.º ${d.caso}` : ''], ['Visita técnica', fechaLarga(d.fechaVisita)], ['Fecha de cierre', fechaLarga(d.fechaCierre)]]
    .filter(([, v]) => v).map(([k, v]) => `<tr class="ficha"><td width="38%" style="padding:7px 0;font-family:${FUENTE};font-size:14px;color:${SUAVE};border-bottom:1px solid #E7ECF3">${k}</td><td style="padding:7px 0;font-family:${FUENTE};font-size:15px;font-weight:600;color:${AZUL};border-bottom:1px solid #E7ECF3">${esc(v)}</td></tr>`).join('');
  const docs = d.documentos?.length ? `<tr><td class="pad" style="padding:10px 36px 0;font-family:${FUENTE}"><div style="font-family:${FUENTE};font-size:15px;font-weight:600;color:${AZUL};margin:10px 0 8px">Documentos</div>${d.documentos.map((x) => `<div style="margin:0 0 8px"><a href="${urlOk(x.url)}" target="_blank" style="display:block;padding:12px 14px;border:1px solid #D9E1EC;border-radius:12px;font-family:${FUENTE};font-size:15px;color:${AZUL};text-decoration:none">${esc(x.nombre)}</a></div>`).join('')}</td></tr>` : '';
  const cuerpo = `${cabecera(base, 'foto-informe.jpg')}
<tr><td class="pad" style="padding:30px 36px 6px;font-family:${FUENTE}">
  ${insignia('Reparación terminada', VERDE)}
  <h1 class="titulo" style="margin:14px 0 6px;font-family:${FUENTE};font-size:28px;line-height:1.2;font-weight:700;color:${AZUL}">Informe de reparación</h1>
  <p style="margin:0 0 18px;font-family:${FUENTE};font-size:16px;color:${SUAVE}">${esc(d.saludo || 'Estimado(a)')},</p>
  <p style="margin:0 0 6px;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">${esc(d.introduccion || 'Le compartimos el resultado de la reparación realizada en el inmueble: lo que encontramos, lo que se hizo y las fotos del antes y el después.')}</p>
</td></tr>
<tr><td class="pad" style="padding:14px 36px 6px;font-family:${FUENTE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};border-radius:14px"><tr><td style="padding:10px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${ficha}</table></td></tr></table></td></tr>
${bloqueFotos('Antes', d.antes, AMBAR)}${bloqueFotos('Después', d.despues, VERDE)}
${d.hallazgo ? `<tr><td class="pad" style="padding:20px 36px 0;font-family:${FUENTE}"><h2 style="margin:0 0 8px;font-family:${FUENTE};font-size:18px;color:${AZUL}">Qué encontramos</h2>${parrafos(d.hallazgo)}</td></tr>` : ''}
${d.trabajo ? `<tr><td class="pad" style="padding:8px 36px 0;font-family:${FUENTE}"><h2 style="margin:0 0 8px;font-family:${FUENTE};font-size:18px;color:${AZUL}">Qué se hizo</h2>${parrafos(d.trabajo)}</td></tr>` : ''}
${d.recomendacion ? `<tr><td class="pad" style="padding:8px 36px 0;font-family:${FUENTE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF6E5" style="background:#FFF6E5;border-left:4px solid #E08A00;border-radius:10px"><tr><td style="padding:14px 18px"><div style="font-family:${FUENTE};font-size:15px;font-weight:700;color:#7A4B00;margin:0 0 4px">Recomendación</div>${parrafos(d.recomendacion).replace(/margin:0 0 12px/g, 'margin:0')}</td></tr></table></td></tr>` : ''}
${docs}
${d.enlace ? `<tr><td class="pad" style="padding:22px 36px 6px;font-family:${FUENTE}">${boton('Ver el informe completo', d.enlace)}</td></tr>` : ''}
<tr><td class="pad" style="padding:20px 36px 30px;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">Si tiene alguna duda, responda este correo y con gusto la revisamos.<br><br>Cordialmente,<br><strong style="color:${AZUL}">${esc(d.remitente || 'Coordinación de inmuebles')}</strong><br><span style="color:${SUAVE};font-size:15px">Patrimonios Inmobiliarios</span></td></tr>
${pie()}`;
  return envoltura({ titulo: 'Informe de reparación', previa: 'La reparación del inmueble quedó terminada: vea el antes y el después.', cuerpo, c: d.contacto });
}

const ESTRELLAS = (enlace) => [1, 2, 3, 4, 5].map((n) => `<td align="center" style="padding:0 3px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="estrella" width="48" height="48" align="center" valign="middle" bgcolor="${FONDO}" style="width:48px;height:48px;background:${FONDO};border:2px solid ${TURQUESA};border-radius:50%"><a href="${conParam(enlace, 'r', n)}" target="_blank" aria-label="Calificar ${n} de 5" style="display:block;font-family:${FUENTE};font-size:20px;font-weight:700;line-height:44px;color:${AZUL};text-decoration:none;text-align:center">${n}</a></td></tr></table></td>`).join('');

/** Correo con encuesta de satisfacción. d: {saludo, copropiedad, unidad, enlace, remitente, contacto}. */
export function encuestaCorreoHTML(d, o = {}) {
  const base = o.base ?? '/';
  const cuerpo = `${cabecera(base, 'foto-arrendatario.jpg')}
<tr><td class="pad" style="padding:30px 36px 8px;font-family:${FUENTE}">
  <h1 class="titulo" style="margin:0 0 8px;font-family:${FUENTE};font-size:28px;line-height:1.2;font-weight:700;color:${AZUL}">¿Cómo le fue con la reparación?</h1>
  <p style="margin:0 0 14px;font-family:${FUENTE};font-size:16px;color:${SUAVE}">${esc(d.saludo || 'Estimado(a)')},</p>
  <p style="margin:0;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">Terminamos el arreglo en ${esc([d.copropiedad, d.unidad].filter(Boolean).join(' · ') || 'el inmueble')}. Su opinión nos ayuda a mejorar el servicio, y responder toma menos de un minuto. La encuesta es voluntaria.</p>
</td></tr>
<tr><td class="pad" align="center" style="padding:22px 36px 4px;font-family:${FUENTE}">
  <div style="font-family:${FUENTE};font-size:16px;font-weight:600;color:${AZUL};margin:0 0 12px">¿Quedó bien el arreglo? Toque un número.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${ESTRELLAS(d.enlace)}</tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr><td align="left" style="font-family:${FUENTE};font-size:13px;color:${SUAVE}">1 = nada bien</td><td align="right" style="font-family:${FUENTE};font-size:13px;color:${SUAVE}">5 = excelente</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:18px 36px 6px;font-family:${FUENTE}">${boton('Responder la encuesta', d.enlace)}</td></tr>
<tr><td class="pad" style="padding:14px 36px 30px;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">Si algo no quedó bien, cuéntenos en la encuesta y lo tendremos en cuenta.<br><br>Gracias por su tiempo,<br><strong style="color:${AZUL}">${esc(d.remitente || 'Coordinación de inmuebles')}</strong><br><span style="color:${SUAVE};font-size:15px">Patrimonios Inmobiliarios</span></td></tr>
${pie()}`;
  return envoltura({ titulo: 'Encuesta de satisfacción', previa: 'Cuéntenos cómo le fue con la reparación (menos de 1 minuto).', cuerpo, c: d.contacto });
}

const PREGUNTAS = [['arreglo', '¿Quedó bien el arreglo?'], ['puntualidad', '¿Cómo califica la puntualidad de quien hizo el trabajo?'], ['trato', '¿Cómo califica su trato?'], ['orden', '¿Dejaron la zona limpia y ordenada?']];

/** Página web de la encuesta (abre desde el correo). Celular primero. Abrir el enlace solo precarga; nada se guarda hasta pulsar «Enviar». */
export function encuestaWebHTML(d = {}, o = {}) {
  const base = o.base ?? '/';
  const ini = Number.isInteger(+d.inicial) && +d.inicial >= 1 && +d.inicial <= 5 ? +d.inicial : '';
  const r = (nombre, inicial) => [1, 2, 3, 4, 5].map((n) => `<label class="op"><input type="radio" name="${nombre}" value="${n}" ${String(inicial) === String(n) ? 'checked' : ''} required><span>${n}</span></label>`).join('');
  const c = d.contacto || {};
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Encuesta de satisfacción</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;background:${FONDO};font-family:${FUENTE};color:${TEXTO};font-size:16px}
.hoja{max-width:640px;margin:0 auto;background:#fff;min-height:100vh}@media(min-width:700px){.hoja{margin:24px auto;min-height:0;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(26,44,69,.10)}}
.foto{display:block;width:100%;height:auto;background:${AZUL};color:#fff}
main{padding:24px 22px 36px}h1{font-size:26px;line-height:1.2;color:${AZUL};margin:0 0 8px}p.s{color:${SUAVE};margin:0 0 22px;line-height:1.6}
fieldset{border:0;margin:0 0 22px;padding:0}legend{font-weight:600;color:${AZUL};font-size:17px;line-height:1.4;margin-bottom:10px;padding:0}
.fila{display:flex;gap:8px}.op{flex:1;position:relative}.op input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer}
.op span{display:flex;align-items:center;justify-content:center;min-height:54px;border:2px solid #7C8CA3;border-radius:14px;font-size:20px;font-weight:700;color:${AZUL};background:#fff}
.op input:checked+span{background:${TURQUESA};border-color:${AZUL};box-shadow:inset 0 0 0 2px ${AZUL};color:#08262A}.op input:focus-visible+span{outline:3px solid ${AZUL};outline-offset:2px}
@media(forced-colors:active){.op input:checked+span{outline:3px solid;forced-color-adjust:none}}
.esc{display:flex;justify-content:space-between;font-size:13px;color:${SUAVE};margin-top:6px}
textarea{width:100%;min-height:110px;border:2px solid #7C8CA3;border-radius:14px;padding:14px;font:inherit;resize:vertical}
#cuenta{font-size:13px;color:${SUAVE};text-align:right}
button{width:100%;min-height:56px;border:0;border-radius:999px;background:${TURQUESA};color:#08262A;font:inherit;font-size:17px;font-weight:700;cursor:pointer}
button:focus-visible{outline:3px solid ${AZUL};outline-offset:2px}
#gracias{display:none;text-align:center;padding:40px 8px}#gracias h2{color:${AZUL};font-size:26px;outline:none}.n{font-size:13px;color:${SUAVE};margin-top:18px;line-height:1.6}</style></head>
<body><div class="hoja"><img class="foto" src="${base}correo/foto-arrendatario.jpg" alt="Patrimonios Inmobiliarios" width="640">
<main><form id="f"><h1>Cuéntenos cómo le fue</h1><p class="s">${esc([d.copropiedad, d.unidad].filter(Boolean).join(' · ') || 'Su reparación')}. Son 4 preguntas y un comentario opcional; toma menos de un minuto. 1 es «nada bien» y 5 es «excelente».</p>
${PREGUNTAS.map(([k, t]) => `<fieldset><legend>${t}</legend><div class="fila">${r(k, k === 'arreglo' ? ini : '')}</div><div class="esc"><span>1 = nada bien</span><span>5 = excelente</span></div></fieldset>`).join('')}
<fieldset><legend><label for="com">¿Quiere contarnos algo más? (opcional)</label></legend><textarea id="com" name="comentario" maxlength="300" placeholder="Si algo no quedó bien o podemos mejorar, cuéntenos. No escriba datos personales."></textarea><div id="cuenta" aria-hidden="true">0 / 300</div></fieldset>
<button type="submit">Enviar mi opinión</button>
<p class="n">Esta encuesta es voluntaria. ${DATOS_LEGALES(c)} usará sus respuestas para evaluar la calidad del servicio y de quienes lo prestan, y para mejorarlo. No escriba datos personales suyos ni de otras personas en el comentario. Puede ejercer sus derechos y revocar su autorización escribiendo a ${c.correo ? esc(c.correo) : 'la dirección de contacto de la empresa'}.${c.politica ? ` <a href="${urlOk(c.politica)}">Política de Tratamiento de Datos</a>.` : ''}</p></form>
<div id="gracias"><h2 tabindex="-1" id="gt">¡Gracias por su opinión!</h2><p class="s">La recibimos. Si algo no quedó bien, la coordinación podrá comunicarse con usted.</p></div></main></div>
<script>var f=document.getElementById('f'),com=document.getElementById('com');com.addEventListener('input',function(){document.getElementById('cuenta').textContent=com.value.length+' / 300'});f.addEventListener('submit',function(e){e.preventDefault();f.style.display='none';var g=document.getElementById('gracias');g.style.display='block';var t=document.getElementById('gt');t.focus();window.scrollTo(0,0)})</script></body></html>`;
}

/* ---------------------------- Revisión básica local ---------------------------- */
const ERRORES = { tambien: 'también', porfavor: 'por favor', deacuerdo: 'de acuerdo', haiga: 'haya', aver: 'a ver (o haber)', mantenimento: 'mantenimiento', tecnico: 'técnico', electrico: 'eléctrico', area: 'área', ultimo: 'último', numero: 'número', ahi: 'ahí', aqui: 'aquí', asi: 'así', ademas: 'además', despues: 'después', bano: 'baño', dano: 'daño', pequeno: 'pequeño', filtracion: 'filtración', reparacion: 'reparación', instalacion: 'instalación', demas: 'demás' };
const L = '(?<![\\p{L}\\d])'; const R = '(?![\\p{L}\\d])';
const rx = (src, fl = 'iu') => new RegExp(L + '(?:' + src + ')' + R, fl);
const PROMESAS = rx('garantizamos|garant[ií]a|aseguramos que nunca|nunca (?:volver[aá]|se repetir[aá])|no volver[aá]|siempre|de inmediato|resuelto|100\\s?%|sin ning[uú]n costo|totalmente gratis');
const CULPA = rx('es culpa|fue culpa|nuestra culpa|por culpa|culpable|negligencia|mal uso|defecto de construcci[oó]n|el vecino|le corresponde|a cargo de|debe pagar');
const TUTEO = rx('t[uú]|puedes|tienes|mira|sabes|quieres');
/** @returns {{tipo:'ortografia'|'redaccion'|'juridico'|'datos'|'tono', bloquea:boolean, mensaje:string, fragmento?:string}[]} Bloquean solo «datos» y «juridico». */
export function revisarTexto(texto, perfil = 'informe') {
  const t = String(texto || ''); const out = []; const vistos = new Set();
  const add = (tipo, mensaje, fragmento) => { const k = tipo + mensaje + (fragmento || ''); if (vistos.has(k)) return; vistos.add(k); out.push({ tipo, bloquea: tipo === 'datos' || tipo === 'juridico', mensaje, fragmento }); };
  if (/ {2,}/.test(t)) add('redaccion', 'Hay espacios dobles.');
  if (/\s[,.;:]/.test(t)) add('redaccion', 'Hay un espacio antes de una coma o punto.');
  const pegado = t.match(/[a-záéíóúñ][,;:?!][a-záéíóúñ¿¡]/u); if (pegado) add('redaccion', 'Falta un espacio después de un signo de puntuación.', pegado[0]);
  const min = t.match(/(?:^|[.!?]\s+)(?!(?:apto|ap|int|torre|no|n\.º)\.?\s)([a-záéíóúñ]\p{L}*)/u); if (min && !/^(?:apto|ap|int|etc)$/i.test(min[1])) add('redaccion', 'Una frase empieza con minúscula.', min[1]);
  if ((t.match(/¿/g) || []).length !== (t.match(/\?/g) || []).length) add('redaccion', 'Falta abrir o cerrar un signo de interrogación.');
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) add('redaccion', 'Falta abrir o cerrar un paréntesis.');
  const rep = t.match(/(?<![\p{L}\d])(\p{L}{3,})\s+\1(?![\p{L}\d])/iu); if (rep) add('redaccion', 'Hay una palabra repetida.', rep[0]);
  (t.toLowerCase().match(/\p{L}+/gu) || []).forEach((w) => { if (ERRORES[w]) add('ortografia', `«${w}» se escribe «${ERRORES[w]}».`, w); });
  const cion = t.match(/(?<![\p{L}\d])[a-záéíóúñ]{3,}[cs]ion(?![\p{L}\d])/iu); if (cion) add('ortografia', 'Las palabras terminadas en -ción o -sión llevan tilde.', cion[0]);
  if (PROMESAS.test(t)) add('juridico', 'Evite garantías o promesas absolutas: pueden comprometer a la empresa.', t.match(PROMESAS)[0]);
  if (CULPA.test(t)) add('juridico', 'El informe no debe señalar culpables ni decir quién debe pagar: solo describir lo observado («indicios», «origen más probable»).', t.match(CULPA)[0]);
  // En el informe no se nombra a propietario/arrendatario; en las cartas de terminación sí es normal (perfil 'carta').
  if (perfil !== 'carta' && /(?<![\p{L}\d])(?:propietari[oa]s?|arrendatari[oa]s?|inquilin[oa]s?)(?![\p{L}\d])/iu.test(t)) add('juridico', 'No nombre al propietario ni al arrendatario dentro del texto: quien lo recibe lo decide la persona que envía.', t.match(/propietari[oa]s?|arrendatari[oa]s?|inquilin[oa]s?/i)[0]);
  const sinMiles = t.replace(/\d{1,3}(?:\.\d{3}){1,2}(?!\d)/g, (m) => (m.replace(/\./g, '').length >= 8 ? m : ''));
  if (/(?<!\d)\d{6,10}(?!\d)/.test(sinMiles) || /\b\d{1,3}(?:\.\d{3}){2,}\b/.test(t)) add('datos', 'Parece haber una cédula o un número personal. No se incluyen datos personales.');
  // En cartas es normal escribir «hablar por teléfono»: solo bloquea si la palabra viene con un número.
  if ((perfil === 'carta' ? /\b(?:c[eé]dula|c\.c\.|nit|tel[eé]fono|celular)\b[\s.:#nº°o]{0,6}\d/i : /\b(?:c[eé]dula|c\.c\.|nit|tel[eé]fono|celular)\b/i).test(t)) add('datos', 'No escriba cédulas, NIT ni teléfonos de las personas.');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) add('datos', 'Hay un correo electrónico. No se incluyen datos de contacto de las personas.');
  if (/(?<!\d)3\d{9}(?!\d)/.test(t.replace(/\+57|[\s()-]/g, ''))) add('datos', 'Parece haber un número de celular. No se incluyen datos de contacto de las personas.');
  if (/(?<![\p{L}\d])(?:sr\.?|sra\.?|don|doña|señor|señora)\s+\p{Lu}/u.test(t)) add('datos', 'Parece haber el nombre de una persona. No se incluyen nombres en el informe.');
  const gritos = t.match(/(?<![\p{L}\d])\p{Lu}{5,}(?![\p{L}\d])/u); if (gritos || /!!/.test(t)) add('tono', 'Evite las mayúsculas sostenidas o la doble exclamación: suenan como un regaño.', gritos?.[0]);
  if (TUTEO.test(t)) add('tono', 'Use «usted» en todo el texto (se detectó tuteo).', t.match(TUTEO)[0]);
  return out;
}
