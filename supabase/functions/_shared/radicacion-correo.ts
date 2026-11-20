// Constructores de los correos de radicación (cliente y asesor). Los usan enviar-radicacion-cliente y el catálogo vista-previa-correos.
import { correoBase, botonesCorreo, filaCorreo } from './plantilla-correo.ts';
import { type MarcaCorreo } from './marca-correo.ts';

export const esc = (v: string | number | null | undefined) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const cop = (n: number | null | undefined) => (n == null ? '' : '$ ' + Math.round(Number(n)).toLocaleString('es-CO'));
export const urlSegura = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');
export const correoValido = (c: string | null | undefined) => (c && /^\S+@\S+\.\S+$/.test(c.trim()) ? c.trim() : '');

// Pasos configurables: una línea de texto = un paso.
export function pasosDe(instrucciones: string): string[] {
  return String(instrucciones || '').split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 12);
}

function filaDato(k: string, v: string, marca: MarcaCorreo) {
  return v ? `<tr><td style="padding:9px 0;border-bottom:1px solid #efefef;color:#6b6b6b;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid #efefef;color:${marca.principal};font-size:15px;font-weight:600;overflow-wrap:anywhere">${v}</td></tr>` : '';
}
function boton(url: string, texto: string, marca: MarcaCorreo, principal: boolean) {
  return `<p style="margin:10px 0;text-align:center"><a href="${esc(url)}" target="_blank" style="display:inline-block;${principal ? `background:${marca.principal};color:#ffffff` : `color:${marca.principal};border:2px solid ${marca.principal}`};text-decoration:none;font-weight:600;font-size:15px;padding:${principal ? '15px 26px' : '12px 22px'};border-radius:999px">${esc(texto)}</a></p>`;
}

// deno-lint-ignore no-explicit-any
export type Aseguradora = Record<string, any>;

// Costos desglosados: estudio y derechos de contrato por separado, dejando clarísimo que NO se paga nada hoy (solo si aprueban, antes de recibir el inmueble).
// El descuento solo aparece si la empresa lo configuró, con una fecha límite real (la del primer envío + N horas).
// deno-lint-ignore no-explicit-any
function bloqueCostos(marca: MarcaCorreo, d: Record<string, any>, a: Aseguradora, limite: string) {
  const iva = (x: boolean) => (x ? ' + IVA' : '');
  const derechos = a.costo_valor != null ? Number(a.costo_valor) : null;
  const estudio = a.estudio_valor != null ? Number(a.estudio_valor) : null;
  const pct = a.descuento_porcentaje != null ? Number(a.descuento_porcentaje) : 0;
  const conDescuento = pct > 0 && derechos != null && !!limite;
  const ahorro = conDescuento ? Math.round(derechos! * pct / 100) : 0;
  if (derechos == null && estudio == null) return '';
  const fila = (k: string, v: string, nota = '') => `<tr><td style="padding:9px 0;border-bottom:1px solid #e3e3e3;color:#4d4d4d;font-size:14px;vertical-align:top">${k}${nota ? `<div style="color:#6b6b6b;font-size:12px;margin-top:2px">${nota}</div>` : ''}</td><td style="padding:9px 0;border-bottom:1px solid #e3e3e3;color:${marca.principal};font-size:15px;font-weight:700;text-align:right;white-space:nowrap;vertical-align:top">${v}</td></tr>`;
  const filas = [
    estudio != null ? fila('Estudio con ' + esc(a.aseguradora), esc(cop(estudio)) + iva(!!a.estudio_iva)) : '',
    derechos != null ? fila(`Derechos de contrato${a.costo_porcentaje != null ? ` (${Number(a.costo_porcentaje)}% del canon)` : ''}`, conDescuento ? `<s style="color:#9a9a9a;font-weight:400;font-size:13px">${esc(cop(derechos))}</s><br>${esc(cop(derechos - ahorro))}${iva(!!a.costo_iva)}` : esc(cop(derechos)) + iva(!!a.costo_iva), 'Incluye la elaboración del contrato. Se paga una sola vez.') : '',
  ].join('');
  return `<div style="margin:24px 0 0;border:2px solid ${marca.principal};border-radius:18px;overflow:hidden">
<div style="background:${marca.principal};color:#ffffff;padding:14px 18px;font-size:16px;font-weight:700">🛡️ Hoy no pagas nada</div>
<div style="padding:16px 18px;background:#ffffff">
<p style="margin:0 0 10px;color:#4d4d4d;font-size:14px;line-height:1.6"><strong>Iniciar el estudio no tiene costo para ti.</strong> Solo pagas si te <strong>aprueban</strong>, y únicamente <strong>antes de recibir el inmueble</strong>. Si no te aprueban, no pagas nada.</p>
<table style="width:100%;border-collapse:collapse">${filas}</table>
${a.costo_nota ? `<p style="margin:10px 0 0;color:#6b6b6b;font-size:12.5px;line-height:1.5">${esc(a.costo_nota)}</p>` : ''}
</div></div>
${conDescuento ? `<div style="margin:14px 0 0;background:#fff8df;border:1px solid #f3d27a;border-radius:16px;padding:14px 18px;color:#5c4300;font-size:14px;line-height:1.6">⏳ <strong>Inicia tu estudio antes del ${esc(limite)} y te damos ${pct}% de descuento en los derechos de contrato</strong> (ahorras ${esc(cop(ahorro))}). Pasado ese momento el descuento ya no aplica.</div>` : ''}
${a.traslado_texto ? `<div style="margin:14px 0 0;background:#eef7f1;border:1px solid #bfe0cb;border-radius:16px;padding:14px 18px;color:#1f4d33;font-size:14px;line-height:1.6">✅ ${esc(a.traslado_texto)}</div>` : ''}`;
}


// Un bloque por aseguradora: enlaces, datos para copiar, pasos y costos. Con varias aseguradoras cada bloque lleva su título.
// deno-lint-ignore no-explicit-any
function bloqueAseguradora(marca: MarcaCorreo, d: Record<string, any>, a: Aseguradora, varias: boolean, paginaUrl: string, principal: boolean, limite: string) {
  const pasos = pasosDe(a.instrucciones);
  const natural = urlSegura(a.link_natural);
  const juridica = urlSegura(a.link_juridica);
  const mismoEnlace = natural && natural === juridica;
  const datos = [
    filaDato('Aseguradora', esc(a.aseguradora), marca),
    filaDato('Código de la inmobiliaria', esc(a.codigo_inmobiliaria), marca),
    filaDato('Póliza', esc(a.poliza), marca),
    filaDato('Inmobiliaria', esc(a.nombre_inmobiliaria), marca),
    filaDato('Asesor', esc(a.asesor_nombre), marca),
    filaDato('Correo del asesor', esc(a.asesor_correo), marca),
    filaDato('Dirección del inmueble', esc([d.direccion, d.barrio].filter(Boolean).join(', ')), marca),
    filaDato('Valor del canon', esc(cop(d.canon)), marca),
    filaDato('Administración', d.administracion ? esc(cop(d.administracion)) : d.administracion_incluida ? 'Incluida en el canon' : '', marca),
  ].join('');
  return `${varias ? `<h2 style="color:${marca.principal};font-size:20px;margin:28px 0 4px;border-top:2px solid #efefef;padding-top:18px">Con ${esc(a.aseguradora)}</h2>` : ''}
${bloqueCostos(marca, d, a, limite)}
${boton(natural || paginaUrl, natural ? (mismoEnlace ? 'Iniciar mi estudio' : 'Iniciar mi estudio · persona natural') : 'Ver cómo iniciar mi estudio', marca, principal)}
${juridica && !mismoEnlace ? boton(juridica, 'Soy persona jurídica (empresa)', marca, false) : ''}
${mismoEnlace ? `<p style="margin:0;text-align:center;color:#6b6b6b;font-size:12.5px">El mismo enlace sirve para persona natural y jurídica.</p>` : ''}
<h2 style="color:${marca.principal};font-size:18px;margin:22px 0 6px">Datos para copiar en el formulario</h2>
<p style="color:#6b6b6b;font-size:13px;margin:0 0 6px">La aseguradora te los va a pedir. Cópialos tal cual:</p>
<table style="width:100%;border-collapse:collapse">${datos}</table>
${pasos.length ? `<h2 style="color:${marca.principal};font-size:18px;margin:24px 0 8px">Así funciona</h2><table style="width:100%;border-collapse:collapse">${pasos.map((p, i) => `<tr><td style="vertical-align:top;padding:5px 12px 5px 0;width:30px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:${marca.principal};color:#fff;font-weight:600;font-size:13px">${i + 1}</span></td><td style="padding:5px 0;color:#4d4d4d;font-size:14px;line-height:1.55">${esc(p)}</td></tr>`).join('')}</table>` : ''}`;
}

// deno-lint-ignore no-explicit-any
export function construirHtml(marca: MarcaCorreo, d: Record<string, any>, extra: { modoPruebas: boolean; real: string; paginaUrl: string; asesorWa: string; asesorNombreCita: string; limite: string }) {
  const nombre = String(d.cliente_nombre || '').split(' ')[0];
  const lista: Aseguradora[] = d.aseguradoras || [];
  const varias = lista.length > 1;
  const nombres = lista.map((a) => a.aseguradora).join(' o ');
  return correoBase(marca, { titulo: 'Vamos por tu nuevo hogar', tema: 'hogar', modoPruebas: extra.modoPruebas, destinatarioReal: extra.real, cuerpo: `
<p style="color:#4d4d4d;font-size:15px;line-height:1.65;margin:0 0 14px;text-align:justify">Hola${nombre ? ' ' + esc(nombre) : ''}, nos alegra que quieras avanzar con el inmueble Nº ${esc(d.numero_inmueble)} (${esc(d.direccion || '')}). El siguiente paso es un <strong>estudio en línea con ${esc(nombres)}</strong>: es 100% digital y la respuesta llega el mismo día cuando la información está completa.${varias ? ' Elige la opción que prefieras.' : ''}</p>
${lista.map((a, i) => bloqueAseguradora(marca, d, a, varias, extra.paginaUrl, i === 0, extra.limite)).join('')}
${boton(extra.paginaUrl, 'Ver esta información en una página', marca, false)}
${extra.asesorWa ? `<p style="margin:6px 0 0;text-align:center"><a href="https://wa.me/${extra.asesorWa}?text=${encodeURIComponent('Hola, quiero avanzar con el inmueble Nº ' + d.numero_inmueble + ' y tengo una duda sobre el estudio.')}" target="_blank" style="color:${marca.principal};font-weight:600;font-size:14px;text-decoration:none">💬 ¿Dudas? Escríbele a ${esc(extra.asesorNombreCita || 'tu asesor')} por WhatsApp</a></p>` : ''}` });
}

// Correo al ASESOR: quién es el cliente, cómo contactarlo con un toque (llamar / WhatsApp / correo) y qué hacer ahora.
// deno-lint-ignore no-explicit-any
export function htmlAsesor(marca: MarcaCorreo, d: Record<string, any>, x: { asesorNombre: string; clienteNombre: string; clienteEmail: string | null; clienteTel: string | null; clienteWa: string; modoPruebas: boolean; real: string; limite: string }) {
  const n = esc(d.numero_inmueble);
  const aseg = esc(((d.aseguradoras || []) as Aseguradora[]).map((a) => a.aseguradora).join(' / '));
  const primer = String(x.clienteNombre || '').split(' ')[0] || 'El cliente';
  const tel = String(x.clienteTel || '').replace(/[^\d+]/g, '');
  const botones = [
    x.clienteWa ? { texto: `WhatsApp a ${primer}`, url: `https://wa.me/${x.clienteWa}?text=${encodeURIComponent(`Hola ${primer}, soy ${x.asesorNombre} de ${marca.nombre || 'la inmobiliaria'}. Vi que quieres avanzar con el inmueble Nº ${d.numero_inmueble}. ¿Te ayudo con el estudio?`)}`, variante: 'whatsapp' as const } : null,
    x.clienteWa || tel.length >= 7 ? { texto: `Llamar a ${primer}`, url: `tel:${x.clienteWa ? '+' + x.clienteWa : tel}`, variante: 'llamar' as const } : null,
    correoValido(x.clienteEmail) ? { texto: 'Escribirle por correo', url: `mailto:${correoValido(x.clienteEmail)}`, variante: 'contorno' as const } : null,
  ].filter(Boolean) as { texto: string; url: string; variante: 'whatsapp' | 'llamar' | 'contorno' }[];
  const paso = (i: number, t: string) => `<tr><td style="vertical-align:top;padding:5px 12px 5px 0;width:30px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:${marca.principal};color:#fff;font-weight:600;font-size:13px">${i}</span></td><td style="padding:5px 0;color:#4d4d4d;font-size:14px;line-height:1.55">${t}</td></tr>`;
  const cuerpo = `
<p style="color:#4d4d4d;font-size:15px;line-height:1.65;margin:0 0 14px">Hola ${esc(x.asesorNombre)}, <strong>${esc(x.clienteNombre)}</strong> quiere avanzar con el inmueble Nº ${n} y ya recibió el correo para iniciar su estudio con ${aseg}. <strong>Está pendiente de que lo complete</strong>: un mensaje tuyo hoy suele marcar la diferencia.</p>
<table style="width:100%;border-collapse:collapse;margin:6px 0 4px">
${filaCorreo(marca, 'Cliente', esc(x.clienteNombre))}
${filaCorreo(marca, 'Celular', esc(x.clienteTel || ''))}
${filaCorreo(marca, 'Correo', esc(x.clienteEmail || ''))}
${filaCorreo(marca, 'Inmueble', esc([`Nº ${d.numero_inmueble}`, d.direccion].filter(Boolean).join(' · ')))}
${filaCorreo(marca, 'Canon', d.canon ? esc(cop(d.canon)) : '')}
${x.limite ? filaCorreo(marca, 'Descuento vigente hasta', esc(x.limite)) : ''}
</table>
${x.limite ? `<p style="margin:10px 0 0;background:#fff8df;border:1px solid #f3d27a;border-radius:12px;padding:10px 14px;color:#5c4300;font-size:13.5px;line-height:1.5">⏳ Le prometimos descuento en los derechos de contrato si inicia el estudio antes de esa hora. <strong>Hay que cumplírselo.</strong></p>` : ''}
<h2 style="color:${marca.principal};font-size:17px;margin:22px 0 6px">Qué hacer ahora</h2>
<table style="width:100%;border-collapse:collapse">${paso(1, 'Escríbele o llámalo y pregúntale si ya pudo abrir el enlace del estudio.')}${paso(2, 'Resuélvele dudas sobre los documentos y los costos (hoy no paga nada; paga solo si lo aprueban).')}${paso(3, 'Cuando le salga el resultado, avísale a la administración para preparar el contrato.')}</table>`;
  return correoBase(marca, { titulo: `${primer} quiere avanzar con el inmueble Nº ${d.numero_inmueble}`, etiqueta: `Aviso al asesor · Inmueble ${d.numero_inmueble}`, motivo: 'Te lo enviamos porque el cliente eligió «quiero avanzar» y ya recibió el correo para radicar su estudio.', tema: 'hogar', modoPruebas: x.modoPruebas, destinatarioReal: x.real, cuerpo, botones });
}

