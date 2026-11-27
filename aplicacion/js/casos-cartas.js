// Cartas de un caso de terminación: respuesta al arrendatario y aviso al propietario.
// Cada carta se propone ya redactada (BORRADOR), la persona la edita, se revisa (revisarTexto con perfil 'carta') y recién entonces se envía.
// Sin datos personales: el saludo lo resuelve quien envía; aquí solo se recibe el texto final.
//
// MODELO (corregido por el administrador, 26 nov 2026):
//   1. El PROPIETARIO autoriza primero: (a) buscar un nuevo arrendatario y (b) proponer al arrendatario actual un acuerdo de
//      terminación anticipada por mutuo acuerdo (art. 21 Ley 820 de 2003), con «traslapo»: sale el actual y entra el nuevo sin tiempo vacío.
//      El propietario NO autoriza «mostrar el inmueble»: las visitas las coordina la inmobiliaria con el arrendatario.
//   2. El ARRENDATARIO elige: acuerdo anticipado o esperar al vencimiento. Si se arrienda, se le da un tiempo prudencial
//      (por defecto 2 semanas, contadas desde que se firme el nuevo contrato) para mudarse y para entregar al nuevo inquilino.
//   3. La inmobiliaria nunca promete lo que decide el propietario (terminación, fecha, renuncia a indemnización): solo «propone, sujeto a aprobación».
// Textos revisados por tres agentes (jurídico, psicología/servicio y diseño). Pendiente: cotejo del abogado humano con el texto oficial
// de la Ley 820 de 2003 (arts. 3, 6, 16, 21, 24 y 25), el mandato y el medio de notificación pactado. Ver docs/CASOS-AUTOMATIZACION.md.
import { envoltura, cabecera, parrafos, pie, fechaLarga, esc, FUENTE, AZUL, TURQUESA, SUAVE, TEXTO, FONDO } from './casos-informes.js';

const f = (iso) => (iso ? fechaLarga(iso) : '[fecha]');
const llenar = (t, d) => String(t).replace(/\{(\w+)\}/g, (_, k) => (k.startsWith('fecha') ? f(d[k]) : (d[k] || `[${k}]`)));

/** Plantillas. Cada sección tiene un texto sugerido (editable). `opcional` = casilla que la persona puede apagar. */
export const PLANTILLAS = {
  entrega_a_tiempo: {
    boton: 'Carta: entrega a tiempo',
    ayuda: 'Para cuando el arrendatario avisó con 3 meses o más. Confirma la entrega y le ofrece, sin obligar, un acuerdo para salir antes si se arrienda.',
    destinatario: 'arrendatario',
    asunto: 'Gracias por avisarnos: así podemos ayudarle con calma · {inmueble}',
    secciones: [
      { id: 'intro', titulo: 'Recibimos su aviso', texto: 'Gracias por avisarnos el {fechaAviso} que entregará {inmueble} el {fechaEntrega}. Su aviso llegó con tiempo y nos permite organizar todo con calma.' },
      { id: 'confirmacion', titulo: 'Qué confirmamos', texto: 'Según la información que tenemos, su aviso se recibió dentro del plazo de la Ley 820 de 2003 y del contrato. La entrega se hará el {fechaEntrega}, con acta e inventario, y una persona de nuestro equipo le acompañará en el proceso. Si usted prefiere esperar hasta esa fecha y entregar entonces, todo queda en orden así.' },
      { id: 'propuesta', titulo: 'Otra opción: salir antes si se arrienda', opcional: true, texto: 'Si le sirve, hay otra opción. Con la autorización del propietario, podemos buscar un nuevo arrendatario. Si el inmueble se arrienda antes del {fechaEntrega}, podríamos acordar con usted, por escrito, una terminación anticipada: usted entregaría unas {plazoSemanas} semanas después de que se firme el nuevo contrato. Ese tiempo es para que se mude con calma y busque su nuevo lugar, y para que nosotros preparemos la entrega al nuevo inquilino. Se cerrarían los cánones, los servicios y el acta de entrega. Es una opción, no una obligación: puede aceptarla o seguir con la fecha del {fechaEntrega}.' },
      { id: 'visitas', titulo: 'Visitas al inmueble', opcional: true, texto: 'Si avanzamos con esa opción, para mostrar el inmueble usted elige los días y horarios y le avisamos con anticipación. No se hace ninguna visita sin su autorización.' },
      { id: 'aval', titulo: 'Aprobación del propietario', texto: 'Todo acuerdo de terminación anticipada necesita la aprobación del propietario y un documento firmado por las partes. Hasta entonces no hay ningún compromiso y el contrato sigue vigente. Ya estamos consultando al propietario y le contaremos su respuesta.' },
      { id: 'cierre', titulo: 'Cómo continuar', texto: 'Para seguir, basta con que responda este correo diciéndonos qué prefiere: (1) explorar el acuerdo anticipado, o (2) esperar hasta el {fechaEntrega}. Si necesita hablarlo, con gusto lo llamamos.' },
    ],
  },
  renovado_820: {
    boton: 'Carta: contrato prorrogado',
    ayuda: 'Para cuando el aviso llegó con menos de 3 meses. Explica la prórroga (Ley 820 de 2003) sin tono de sanción y ofrece, sin obligar, un acuerdo para salir antes si se arrienda.',
    destinatario: 'arrendatario',
    asunto: 'Gracias por escribirnos, queremos ayudarle · {inmueble}',
    secciones: [
      { id: 'intro', titulo: 'Recibimos su comunicación', texto: 'Gracias por escribirnos el {fechaAviso}. Entendemos que no desea continuar con {inmueble}, cuyo contrato vence el {fechaVencimiento}, y queremos ayudarle a resolverlo de la mejor manera.' },
      { id: 'confirmacion', titulo: 'Qué dice la ley', texto: 'Para que tenga claridad desde el principio: según la información que tenemos, su comunicación llegó con menos de tres (3) meses de anticipación al vencimiento, que es el preaviso previsto en la Ley 820 de 2003. Por eso el contrato se entiende prorrogado por un término igual al inicialmente pactado. Se lo contamos con claridad para que decida con información. Si desea terminarlo antes, la ley prevé una alternativa con preaviso e indemnización, que con gusto le explicamos.' },
      { id: 'propuesta', titulo: 'Otra opción: salir antes si se arrienda', texto: 'Hay una salida que puede servirle. Con la autorización del propietario, podemos buscar un nuevo arrendatario. Si el inmueble se arrienda, podríamos acordar con usted, por escrito, una terminación anticipada: usted entregaría unas {plazoSemanas} semanas después de que se firme el nuevo contrato, tiempo pensado para que se mude con calma, y para que nosotros preparemos la entrega al nuevo inquilino. Se cerrarían los cánones, los servicios y el acta. Si prefiere no hacerlo, también es válido: el contrato sigue su curso.' },
      { id: 'visitas', titulo: 'Visitas al inmueble', opcional: true, texto: 'Si avanzamos con esa opción, para mostrar el inmueble usted elige los días y horarios y le avisamos con anticipación. No se hace ninguna visita sin su autorización.' },
      { id: 'aval', titulo: 'Aprobación del propietario', texto: 'Todo acuerdo de terminación anticipada, incluida cualquier condición económica, necesita la aprobación del propietario y un documento firmado por las partes. Ya lo estamos consultando y le informaremos su respuesta. Hasta entonces no hay compromiso alguno.' },
      { id: 'cierre', titulo: 'Cómo continuar', texto: 'Respóndanos con una sola cosa: si le interesa explorar el acuerdo anticipado o prefiere seguir con el contrato según lo previsto. Con gusto lo atendemos, y puede llamarnos si lo prefiere.' },
    ],
  },
  aviso_propietario: {
    boton: 'Aviso al propietario',
    ayuda: 'Carta amable al propietario: le pide autorizar que promocionemos el inmueble desde ahora para que no quede sin ingreso. Redactada con tono cercano (mercadeo); la decisión sobre cualquier indemnización es del propietario. No incluye datos del arrendatario.',
    destinatario: 'propietario',
    asunto: 'Una idea para cuidar el ingreso de su inmueble',
    secciones: [
      { id: 'intro', titulo: 'Una noticia sobre su inmueble', texto: 'Queremos contarle algo sobre {inmueble}. Su arrendatario nos avisó que no continuará y que entregaría el inmueble cerca del vencimiento del contrato, el {fechaVencimiento}. Le escribimos con calma y a tiempo, porque hay una forma de cuidar que su inmueble siga generando ingreso.' },
      { id: 'idea', titulo: 'Lo que le proponemos', texto: 'Le pedimos su autorización para empezar a promocionar {inmueble} desde ahora. Así podemos recibir a un nuevo inquilino sin que el inmueble pase tiempo vacío ni sin ingreso. Es un paso tranquilo: usted decide y nosotros nos encargamos de moverlo con cuidado.' },
      { id: 'como', titulo: 'Cómo funcionaría', texto: 'Si aparece un nuevo arrendatario, podemos proponerle al inquilino actual, de forma amable y voluntaria, acordar con calma una salida antes del vencimiento. Tendría un plazo prudencial de unas {plazoSemanas} semanas desde que se firme el nuevo contrato, para coordinar su salida y la entrada del nuevo. Cerraríamos con orden el canon proporcional, los servicios y el acta de entrega. Todo depende de su aprobación y de un documento firmado. Si el inquilino prefiere esperar al vencimiento, se respeta.' },
      { id: 'decision', titulo: 'Su decisión', opcional: true, texto: 'Una aclaración honesta: la decisión sobre cualquier indemnización, o sobre renunciar a ella, es suya. Nosotros no ofrecemos ni renunciamos a nada en su nombre.' },
      { id: 'cierre', titulo: 'Cómo responder', texto: 'Puede elegir la opción que prefiera con los botones de abajo: autorizar que promocionemos su inmueble, pedirnos que lo llamemos para conversarlo, o dejarlo así por ahora. Cualquiera de las tres es válida. Gracias por su confianza; cuidar su patrimonio es lo que más nos importa.' },
    ],
  },
};

/** Texto de la situación según la clasificación de la terminación (clave de clasificarTerminacion). Sin promesas de «cero riesgo». */
export const SITUACION = {
  segura: 'El aviso llegó con 3 meses o más y la entrega prevista es el {fechaEntrega}, cerca del vencimiento ({fechaVencimiento}).',
  extemporanea: 'El aviso llegó con menos de 3 meses; el contrato se entiende prorrogado por el término inicial. El arrendatario conserva la salida legal con preaviso de 3 meses e indemnización de 3 cánones.',
  acuerdo: 'El aviso llegó a tiempo, pero la fecha propuesta ({fechaEntrega}) no coincide con el vencimiento ({fechaVencimiento}); se requiere un acuerdo.',
  incompleta: 'Estamos completando la información del caso y le avisaremos apenas la tengamos.',
};

export const PIE_JURIDICO = 'Esta comunicación se envía por mandato del propietario. No modifica el contrato de arrendamiento ni renuncia a derecho alguno; cualquier terminación anticipada requiere la aprobación del propietario y un acuerdo escrito firmado por las partes.';

/** Plazo prudencial por defecto (semanas, contadas desde que se firme el nuevo contrato). Se puede cambiar en cada carta. */
export const PLAZO_SEMANAS = 2;

/** Borrador listo para editar: {asunto, secciones:[{id,titulo,opcional,activa,texto}]}. */
export function borrador(clave, datos = {}) {
  const p = PLANTILLAS[clave]; if (!p) throw new Error('Plantilla desconocida');
  const d = { plazoSemanas: PLAZO_SEMANAS, ...datos };
  d.situacion = llenar(datos.situacion || SITUACION[datos.clasificacion] || SITUACION.incompleta, d);
  return { clave, destinatario: p.destinatario, asunto: llenar(p.asunto, d), secciones: p.secciones.map((s) => ({ ...s, activa: true, texto: llenar(s.texto, d) })) };
}

/** Carta con membrete de la empresa. c: salida de borrador (editada). d: {ciudad, fechaCarta, saludo, inmueble, resumen, enlaces:{acepta,rechaza,hablar}, remitente, contacto}. */
export function cartaHTML(c, d = {}, o = {}) {
  const base = o.base ?? '/';
  const activas = c.secciones.filter((s) => s.activa !== false && String(s.texto).trim());
  // Botones: el relleno va en el enlace (en Outlook de escritorio toda el área responde al toque). Los enlaces abren una página de
  // confirmación con token de un solo uso; la decisión solo se guarda al pulsar «Confirmar» allí (los antivirus no la activan).
  const u = (x) => (/^https:\/\//i.test(String(x)) || x === '#' ? esc(x) : '#');
  const btnP = (t, h) => `<table role="presentation" class="btnl" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr><td align="center" bgcolor="${TURQUESA}" style="border-radius:999px;background:${TURQUESA}"><a href="${u(h)}" target="_blank" style="display:block;padding:15px 30px;font-family:${FUENTE};font-size:16px;font-weight:600;color:#08262A;text-decoration:none">${esc(t)}</a></td></tr></table>`;
  const btnS = (t, h) => `<table role="presentation" class="btnl" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr><td align="center" bgcolor="#ffffff" style="border:2px solid ${AZUL};border-radius:999px;background:#ffffff"><a href="${u(h)}" target="_blank" style="display:block;padding:13px 28px;font-family:${FUENTE};font-size:16px;font-weight:600;color:${AZUL};text-decoration:none">${esc(t)}</a></td></tr></table>`;
  const botones = c.destinatario === 'propietario' && d.enlaces
    ? `<tr><td class="pad" style="padding:8px 36px 6px;font-family:${FUENTE}"><div style="font-size:16px;font-weight:700;color:${AZUL};margin:6px 0 4px">¿Nos autoriza a promocionar su inmueble desde ahora?</div><div style="font-size:14px;color:${SUAVE};margin:0 0 12px">Al tocar un botón se abre una página donde confirma su decisión. No se firma nada sin su aprobación.</div>${btnP('Sí, autorizo promocionarlo', d.enlaces.acepta)}${btnS('Prefiero que me llamen', d.enlaces.hablar)}${btnS('No por ahora', d.enlaces.rechaza)}</td></tr>` : '';
  const resumen = d.resumen ? `<tr><td class="pad" style="padding:6px 36px 0;font-family:${FUENTE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};border-radius:12px"><tr><td style="padding:12px 16px;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${AZUL}"><strong>Resumen.</strong> ${esc(d.resumen)}</td></tr></table></td></tr>` : '';
  // Encabezado con foto de personas (ya trae el logo dentro, como el informe): propietario → visita al inmueble; arrendatario → hogar.
  const foto = c.destinatario === 'propietario' ? 'foto-visitaprop.jpg' : 'foto-hogar.jpg';
  const cuerpo = `${cabecera(base, foto)}
<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:16px 36px 0" class="pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="right" valign="middle" style="font-family:${FUENTE};font-size:14px;color:${SUAVE}">${esc(d.ciudad || 'Bogotá D.C.')} · ${esc(f(d.fechaCarta))}</td></tr></table></td></tr>
<tr><td style="padding:10px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="4" bgcolor="${TURQUESA}" style="background:${TURQUESA};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
<tr><td class="pad" style="padding:26px 36px 6px;font-family:${FUENTE}"><p style="margin:0 0 6px;font-family:${FUENTE};font-size:14px;color:${SUAVE};letter-spacing:.04em;text-transform:uppercase">Referencia${d.inmueble ? ' · ' + esc(d.inmueble) : ''}</p>
  <h1 class="titulo" style="margin:0 0 18px;font-family:${FUENTE};font-size:22px;line-height:1.3;font-weight:700;color:${AZUL}">${esc(d.inmueble ? String(c.asunto).split(' · ' + d.inmueble)[0] : c.asunto)}</h1>
  <p style="margin:0 0 14px;font-family:${FUENTE};font-size:16px;color:${TEXTO}">${esc(d.saludo || 'Estimado(a)')},</p></td></tr>${resumen}
<tr><td class="pad" style="padding:14px 36px 0;font-family:${FUENTE}">${activas.map((s) => parrafos(s.texto)).join('')}</td></tr>
${botones}
<tr><td class="pad" style="padding:14px 36px 8px;font-family:${FUENTE};font-size:16px;line-height:1.65;color:${TEXTO}">Cordialmente,<br><strong style="color:${AZUL}">${esc(d.remitente || 'Coordinación de inmuebles')}</strong><br><span style="color:${SUAVE};font-size:15px">Patrimonios Inmobiliarios</span></td></tr>
<tr><td class="pad" style="padding:6px 36px 28px;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${SUAVE}">${esc(PIE_JURIDICO)}</td></tr>
${pie()}`;
  return envoltura({ titulo: c.asunto, previa: activas[0]?.texto.slice(0, 110) || c.asunto, cuerpo, c: d.contacto });
}
