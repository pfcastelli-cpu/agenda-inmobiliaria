// Correos del proceso de COMPRA de un inmueble en venta (sql/082): propuesta de valor, respuesta del propietario, acuerdo y datos para la promesa.
// Los usan portal-negociacion (envío real) y vista-previa-correos (muestras), para que nunca se desfasen.
// Reglas: solo se habla de VALOR (sin textos libres de las partes), nada es vinculante hasta la firma de la promesa de compraventa,
// el propietario no ve la identidad del comprador ni al revés. Textos revisados con orientación jurídica (validar con el abogado de la empresa).
import { correoBase, type BotonCorreo } from './plantilla-correo.ts';
import type { MarcaCorreo } from './marca-correo.ts';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const P = 'margin:0 0 12px;text-align:justify';
export const pesos = (n: number | null | undefined) => (n == null ? '—' : `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`);

export type TipoCorreoNegociacion =
  | 'comprador_inicio' | 'propietario_propuesta' | 'comprador_contrapropuesta' | 'comprador_acuerdo' | 'propietario_acuerdo'
  | 'comprador_cierre' | 'propietario_cierre' | 'interno_movimiento' | 'interno_promesa';

export interface ContextoNegociacion {
  marca: MarcaCorreo;
  numero: string;
  direccion?: string;
  valorPublicado: number;
  valor?: number | null;        // propuesta / contrapropuesta / valor acordado
  url?: string;                 // página del comprador o del propietario (con su token)
  urlAgenda?: string;           // panel interno
  correoDocumentos?: string;    // correo de la empresa al que se envían los documentos
  evento?: string;              // para el aviso interno: texto corto de lo ocurrido
  historial?: { de: string; accion: string; valor: number | null }[];
  vigenciaDias?: number;
  asesor?: { nombre: string; celular?: string | null };  // contacto del asesor de la visita
  telEmpresa?: string;          // respaldo si el asesor no tiene celular
  urlGuia?: string;             // página «¿Cómo es comprar con nosotros?»
  modoPruebas?: boolean;
  destinatarioReal?: string;
}

const AVISO_NO_VINCULANTE = 'Esta propuesta es una manifestación de interés <b>no vinculante</b>: no constituye oferta de compra, promesa ni compraventa. Solo se acuerda un valor cuando ambas partes lo aceptan, y el compromiso nace únicamente con la firma de la promesa de compraventa. Patrimonios actúa como intermediario, no garantiza la aceptación ni la disponibilidad del inmueble y no recibe dinero por este medio.';

const inmuebleTxt = (c: ContextoNegociacion) => `Inmueble Nº ${esc(c.numero)}${c.direccion ? ` · ${esc(c.direccion)}` : ''}`;

function cajaValor(c: ContextoNegociacion, rotulo: string, valor: number | null | undefined, detalle?: string) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:2px solid ${c.marca.principal};border-radius:16px;margin:4px 0 16px"><tr><td style="padding:16px 18px;text-align:center">
    <div style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#63707a;font-weight:700">${esc(rotulo)}</div>
    <div style="margin-top:6px;font-size:32px;line-height:1.1;font-weight:700;color:${c.marca.principal}">${esc(pesos(valor))}</div>
    ${detalle ? `<div style="margin-top:8px;font-size:13px;color:#63707a">${esc(detalle)}</div>` : ''}</td></tr></table>`;
}

// Historial en orden cronológico y SIEMPRE empezando por el valor publicado: «estaba en esto → ofrecieron esto → respondieron esto…».
function historialTxt(c: ContextoNegociacion) {
  const rot: Record<string, string> = { propuesta: 'El comprador ofreció', contrapropuesta: 'El propietario propuso', acepta: 'Se aceptó el valor', rechaza: 'Una de las partes no continuó' };
  const h = [{ de: '', accion: 'publicado', valor: c.valorPublicado as number | null }, ...(c.historial || [])];
  rot.publicado = 'El inmueble estaba publicado en';
  return `<p style="margin:14px 0 6px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#63707a;font-weight:700">Cómo va la conversación</p><table role="presentation" width="100%" style="border-collapse:collapse">${h.map((m) => `<tr><td style="padding:7px 0;border-bottom:1px solid #e7ebee;font-size:13px;color:#63707a">${esc(rot[m.accion] || m.accion)}</td><td style="padding:7px 0;border-bottom:1px solid #e7ebee;font-size:14px;font-weight:700;text-align:right;color:${c.marca.principal}">${m.valor ? esc(pesos(m.valor)) : '—'}</td></tr>`).join('')}</table>`;
}

const boton = (texto: string, url?: string, variante: BotonCorreo['variante'] = 'principal'): BotonCorreo[] => (url ? [{ texto, url, variante }] : []);


function digitosWa(t?: string | null) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

// Contacto del asesor + aviso contra fraudes + enlace a la guía del proceso. Solo para comprador y propietario.
function bloqueContacto(c: ContextoNegociacion) {
  const wa = digitosWa(c.asesor?.celular) || digitosWa(c.telEmpresa);
  const quien = c.asesor?.nombre ? esc(c.asesor.nombre) : 'tu asesor';
  const msg = encodeURIComponent(`Hola, escribo por el inmueble Nº ${c.numero}.`);
  const link = wa ? ` <a href="https://wa.me/${wa}?text=${msg}" style="color:#0b7d74;font-weight:700">Escríbele por WhatsApp</a>.` : '';
  const guia = c.urlGuia ? ` <a href="${esc(c.urlGuia)}" style="color:#0b7d74;font-weight:700">Conoce cómo es el proceso de compra</a>.` : '';
  return `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.6;color:#33414b"><b>¿Prefieres hablarlo?</b> Si tienes dudas, ${quien} te acompaña en todo el proceso.${link}${guia}</p>`
    + `<p style="margin:0 0 10px;font-size:12.5px;line-height:1.55;color:#63707a"><b>Importante:</b> nunca consignes arras ni dinero por WhatsApp o por este correo. Los pagos se hacen solo en la notaría o a la cuenta verificada de la empresa.</p>`;
}

export function correoNegociacion(tipo: TipoCorreoNegociacion, c: ContextoNegociacion): { asunto: string; html: string } {
  const vig = c.vigenciaDias ?? 21;
  const base = { modoPruebas: c.modoPruebas, destinatarioReal: c.destinatarioReal };
  let asunto = '', etiqueta = '', motivo = '', titulo = '', cuerpo = '', botones: BotonCorreo[] = [], despues = '';
  let tema: 'llaves' | 'cambio' | 'informe' | 'visitaprop' = 'llaves';

  if (tipo === 'comprador_inicio') {
    asunto = `Haz tu propuesta por el inmueble ${c.numero}`; etiqueta = `Propuesta de compra · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque en la encuesta de tu visita dijiste que quieres avanzar con este inmueble.';
    titulo = 'Cuéntanos qué valor te interesa';
    cuerpo = `<p style="${P}">Gracias por visitar el inmueble. Si quieres dar el siguiente paso, <b>propón el valor</b> que te interesa. Nosotros se lo hacemos llegar al propietario y te avisamos su respuesta por este mismo medio.</p>${cajaValor(c, 'Valor publicado', c.valorPublicado)}<p style="${P}">Solo escribes un valor; no hace falta redactar nada más. Tu propuesta sigue abierta ${vig} días desde que la envíes; después queda en pausa y puedes retomarla.</p>`;
    botones = boton('Hacer mi propuesta', c.url); despues = `<p style="margin:0;font-size:12.5px;line-height:1.55;color:#63707a">${AVISO_NO_VINCULANTE}</p>`;
  } else if (tipo === 'propietario_propuesta') {
    asunto = `Recibiste una propuesta por tu inmueble ${c.numero}`; etiqueta = `Aviso al propietario · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque una persona que visitó tu inmueble propuso un valor de compra.'; tema = 'visitaprop';
    titulo = 'Una persona quiere comprar tu inmueble';
    cuerpo = `<p style="${P}">Una persona que visitó tu inmueble propone el siguiente valor. Puedes <b>aceptarlo</b> o <b>proponer otro valor</b>; tómate el tiempo que necesites para decidir.</p>${cajaValor(c, 'Valor propuesto', c.valor, `Valor publicado: ${pesos(c.valorPublicado)}`)}${historialTxt(c)}<p style="${P};margin-top:14px">Por seguridad, aquí solo se habla de valores: no se comparten datos personales de las partes hasta que se acuerde el valor. La propuesta sigue abierta ${vig} días; si pasa ese tiempo queda en pausa y se puede retomar cuando quieras.</p>`;
    botones = boton('Responder la propuesta', c.url); despues = `<p style="margin:0;font-size:12.5px;line-height:1.55;color:#63707a">${AVISO_NO_VINCULANTE}</p>`;
  } else if (tipo === 'comprador_contrapropuesta') {
    asunto = `El propietario propuso otro valor · Inmueble ${c.numero}`; etiqueta = `Propuesta de compra · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque el propietario respondió a tu propuesta.'; tema = 'cambio';
    titulo = 'El propietario propuso otro valor';
    cuerpo = `<p style="${P}">El propietario respondió a tu propuesta con un nuevo valor. Puedes <b>aceptarlo</b>, <b>proponer otro valor</b> o dar por terminada la conversación.</p>${cajaValor(c, 'Valor propuesto por el propietario', c.valor, `Valor publicado: ${pesos(c.valorPublicado)}`)}${historialTxt(c)}`;
    botones = boton('Ver y responder', c.url); despues = `<p style="margin:0;font-size:12.5px;line-height:1.55;color:#63707a">${AVISO_NO_VINCULANTE}</p>`;
  } else if (tipo === 'comprador_acuerdo') {
    asunto = `Acordaron un valor · Inmueble ${c.numero}`; etiqueta = `Propuesta de compra · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque el propietario y tú coincidieron en el valor.';
    titulo = 'Acordaron el valor';
    cuerpo = `<p style="${P}">Ambas partes aceptaron el mismo valor. El siguiente paso es dejarnos los <b>datos básicos para preparar la promesa de compraventa</b>.</p>${cajaValor(c, 'Valor acordado', c.valor)}
      <p style="${P}"><b>Importante:</b> este acuerdo de valor <b>todavía no es vinculante</b>. El compromiso solo nace con la firma de la promesa de compraventa. Antes, un abogado revisa el borrador y se verifican los documentos del inmueble.</p>
      <p style="margin:0 0 6px;font-weight:700;color:${c.marca.principal}">Documentos que te pediremos más adelante</p>
      <ul style="margin:0 0 12px;padding-left:20px;font-size:14px;line-height:1.6"><li>Copia de tu documento de identidad</li><li>RUT, si lo exige la notaría</li><li>Si compras con una empresa: certificado de existencia y representación (con menos de 30 días)</li><li>Si pagas con crédito: carta de aprobación de la entidad</li></ul>
      <p style="${P}">Por tu seguridad, <b>no los subas a ninguna página</b>: envíalos por correo${c.correoDocumentos ? ` a <b>${esc(c.correoDocumentos)}</b>` : ' al correo de la empresa'}, cuando tu asesor te lo indique.</p>`;
    botones = boton('Completar datos para la promesa', c.url); despues = `<p style="margin:0;font-size:12.5px;line-height:1.55;color:#63707a">${AVISO_NO_VINCULANTE}</p>`;
  } else if (tipo === 'propietario_acuerdo') {
    asunto = `Acordaron un valor por tu inmueble ${c.numero}`; etiqueta = `Aviso al propietario · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque se acordó un valor de compra.'; tema = 'informe';
    titulo = 'Acordaron un valor';
    cuerpo = `<p style="${P}">Quedó acordado el siguiente valor entre tú y la persona interesada.</p>${cajaValor(c, 'Valor acordado', c.valor)}${historialTxt(c)}<p style="${P};margin-top:14px">Tu asesor te contactará para los pasos siguientes: revisión de documentos del inmueble y preparación de la promesa de compraventa. Este acuerdo de valor <b>no es vinculante</b> hasta que firmes la promesa.</p>`;
    despues = `<p style="margin:0;font-size:12.5px;line-height:1.55;color:#63707a">${AVISO_NO_VINCULANTE}</p>`;
  } else if (tipo === 'comprador_cierre' || tipo === 'propietario_cierre') {
    const comp = tipo === 'comprador_cierre';
    asunto = `La conversación terminó sin acuerdo · Inmueble ${c.numero}`; etiqueta = `${comp ? 'Propuesta de compra' : 'Aviso al propietario'} · ${inmuebleTxt(c)}`;
    motivo = 'Te escribimos porque la conversación por este inmueble se cerró.'; tema = 'cambio';
    titulo = 'La conversación se cerró sin acuerdo';
    cuerpo = `<p style="${P}">${comp ? 'No se llegó a un acuerdo de valor por este inmueble' : 'La conversación por el valor de tu inmueble se cerró sin acuerdo'}. ${c.evento ? esc(c.evento) + ' ' : ''}No se compartió ningún dato personal entre las partes.</p>${historialTxt(c)}<p style="${P};margin-top:14px">${comp ? 'Si quieres ver otros inmuebles, tu asesor puede ayudarte.' : 'Tu inmueble sigue disponible. Tu asesor te contactará si hay novedades.'}</p>`;
  } else if (tipo === 'interno_movimiento') {
    asunto = `Propuesta de compra · Inmueble ${c.numero} · ${c.evento || 'novedad'}`; etiqueta = `Aviso interno · ${inmuebleTxt(c)}`;
    motivo = 'Te llegó este aviso porque eres el asesor o supervisor de esta visita.'; tema = 'informe';
    titulo = 'Novedad en una propuesta de compra';
    cuerpo = `<p style="${P}">${esc(c.evento || 'Hubo un movimiento en la negociación.')}</p>${cajaValor(c, 'Último valor', c.valor, `Valor publicado: ${pesos(c.valorPublicado)}`)}${historialTxt(c)}`;
    botones = boton('Abrir propuestas de compra', c.urlAgenda, 'contorno');
  } else {
    asunto = `Datos para la promesa recibidos · Inmueble ${c.numero}`; etiqueta = `Aviso interno · ${inmuebleTxt(c)}`;
    motivo = 'Te llegó este aviso porque eres el asesor o supervisor de esta visita.'; tema = 'informe';
    titulo = 'El comprador dejó sus datos para la promesa';
    cuerpo = `<p style="${P}">El valor acordado es <b>${esc(pesos(c.valor))}</b>. El comprador completó el formulario con los datos para preparar la promesa de compraventa. Por privacidad, los datos no van en este correo: revísalos en la agenda.</p><p style="${P}">Antes de enviar el borrador: confirma por escrito con el propietario, revisa el certificado de tradición y libertad, verifica quién firma (cónyuge, representante legal) y pide que un abogado revise el borrador. Los documentos del comprador deben llegar al correo de la empresa.</p>`;
    botones = boton('Abrir propuestas de compra', c.urlAgenda, 'contorno');
  }
  if (!tipo.startsWith('interno_')) despues = bloqueContacto(c) + despues;
  const html = correoBase(c.marca, { titulo, cuerpo, tema, etiqueta, motivo, botones, despues: despues || undefined, ...base });
  return { asunto, html };
}
