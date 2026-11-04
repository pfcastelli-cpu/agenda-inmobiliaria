// Catálogo de todos los diseños de correo (datos de ejemplo, helpers reales). Salida: tmp/catalogo-correos.html (luego PDF).
import { writeFileSync, readFileSync } from 'node:fs';

// Incrusta las fotos como datos: el PDF queda autónomo y muestra también las fotos aún no publicadas.
function conFotosLocales(h) {
  return h.replace(/https:\/\/citas\.patrimonios\.co\/correo\/(foto-[a-z]+\.jpg)/g, (_, f) => 'data:image/jpeg;base64,' + readFileSync(new URL('../aplicacion/public/correo/' + f, import.meta.url)).toString('base64'));
}
import { correoBase, filaCorreo } from '../supabase/functions/_shared/plantilla-correo.ts';
import { correoVisita, enlaceVisita } from '../supabase/functions/_shared/visita-correo.ts';
import { marcaCorreo } from '../supabase/functions/_shared/marca-correo.ts';

const marca = marcaCorreo({ nombre_comercial: 'Patrimonios Inmobiliarios', color_principal: '#1A2C45', color_accion: '#00A9A5', logo_url: 'https://citas.patrimonios.co/logo-patrimonios.png', empresa: { slug: 'patrimonios' } });
const T = (f) => '<table role="presentation" style="width:100%;border-collapse:collapse">' + f.map(([k, v]) => filaCorreo(marca, k, v)).join('') + '</table>';
const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
const B = (texto, variante = 'principal') => ({ texto, url: 'https://example.com', variante });
const visitaDatos = T([['Inmueble', '697 (ejemplo)'], ['Fecha', 'jueves, 5 de noviembre'], ['Hora', '10:00 a. m.'], ['Dirección', 'Calle de ejemplo 123, Bogotá']]);
const extras = ['Abrir en Google Maps', 'Abrir en Waze', 'Llamar al asesor', 'Escribir por WhatsApp'].map((t, i) => enlaceVisita(i === 2 ? 'tel:+573001112233' : 'https://example.com', t, marca)).join('');
const paso = (n, t) => `<tr><td style="padding:6px 0;width:34px;font-size:20px;vertical-align:top">${n}</td><td style="padding:6px 0">${t}</td></tr>`;

const lista = [
  ['Confirmación de visita (cliente)', 'Foto: visita', 'Cuando alguien agenda una visita a un inmueble: el cliente recibe sus datos, mapa, Waze, llamada y WhatsApp, y un botón para ver, cambiar o cancelar. Incluye aviso de puntualidad si el asesor tiene otra cita después.', 'enviar-correo-cita',
    correoVisita(marca, { titulo: 'Tu visita está confirmada', cuerpo: p('Hola Ana. Estos son los datos de tu visita.') + visitaDatos, despues: extras, boton: { texto: 'Ver, cambiar o cancelar mi visita', url: 'https://example.com' } })],
  ['Cambio o cancelación de visita', 'Foto: cambio', 'Cuando se cambia la hora, se reubica o se cancela una visita (por el cliente, el asesor o porque el inmueble ya no está disponible). Mismo estilo que la confirmación para que se reconozca.', 'notificar-cambio-cita · marcar-inmueble-no-disponible',
    correoVisita(marca, { titulo: 'Cambió la hora de tu visita', tema: 'cambio', cuerpo: p('Hola Ana. Tu visita se movió a una nueva hora.') + visitaDatos, boton: { texto: 'Ver mi visita', url: 'https://example.com' } })],
  ['Aviso al arrendatario', 'Foto: arrendatario', 'Cuando el inmueble está ocupado y se avisa al inquilino de la visita; trae el botón «Confirmo que estaré» y un recordatorio 24 h antes.', 'avisar-arrendatario · recordar-arrendatario',
    correoVisita(marca, { titulo: 'Te visitarán en tu inmueble', tema: 'arrendatario', despues: ['🕐 No puedo a esa hora: sugerir otra', '🗓️ No puedo ese día: sugerir otro día', '⏸️ No puedo recibir visitas por un tiempo'].map((t) => enlaceVisita('https://example.com', t, marca)).join(''), cuerpo: p('Hola. Un asesor mostrará el inmueble que habitas en esta fecha.') + visitaDatos, boton: { texto: 'Confirmo que estaré', url: 'https://example.com' } })],
  ['Consignación: confirmación al propietario', 'Foto: llaves', 'Cuando un propietario agenda su cita en /consignar. Pasos «Así seguimos juntos» y botón al script para enviar la información del inmueble.', 'avisar-captacion',
    correoBase(marca, { titulo: '¡Gracias por confiar en nosotros! 🔑', tema: 'llaves', cuerpo: p('Hola Ana, ¡qué alegría que nos confíes tu inmueble! Tu cita quedó agendada y <b>tu asesor</b> irá a conocerlo y tomar las fotos.') + T([['📅 Cuándo', 'jueves 5 de nov., 13:00'], ['📍 Dónde', 'Calle de ejemplo 123'], ['🙋 Tu asesor', 'Asesor de prueba']]) + '<p style="margin:22px 0 8px;font-weight:700;color:#1A2C45">Así seguimos juntos</p><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">' + paso('1️⃣', '<b>Cuéntanos de tu inmueble</b> con el botón.') + paso('2️⃣', '<b>Visita y fotos</b> en la fecha acordada.') + paso('3️⃣', '<b>Publicamos</b> tu inmueble.') + '</table>', botones: [B('📎 Enviar la información de mi inmueble'), B('Escribir a mi asesor', 'whatsapp'), B('Llamar al asesor', 'llamar')] })],
  ['Consignación: aviso al asesor', 'Foto: sala de lujo', 'Al asesor asignado cuando un propietario agenda por la página pública: datos del propietario, mapa, WhatsApp y llamada.', 'avisar-captacion',
    correoBase(marca, { titulo: 'Tienes una nueva captación 🔑', tema: 'lujo', cuerpo: p('Hola, un propietario agendó por la página pública. La cita ya está en tu agenda.') + T([['Cuándo', 'viernes 6 de nov., 08:00'], ['Propietario', 'Ana Propietaria'], ['Dirección', 'Calle de ejemplo 123, Barranquilla']]), botones: [B('Ver la dirección en Google Maps', 'mapa'), B('Escribir al propietario', 'whatsapp'), B('Llamar al propietario', 'llamar')] })],
  ['Visita en el inmueble del propietario', 'Foto: personas de visita', 'Al propietario cuando se agenda o cambia una visita a su inmueble (según la frecuencia que él eligió).', 'enviar-correo-propietario',
    correoBase(marca, { titulo: 'Se agendó una visita en tu inmueble', tema: 'visitaprop', cuerpo: p('Hola, un posible cliente verá tu inmueble.') + visitaDatos, botones: [B('📊 Ver el informe en vivo')] })],
  ['Solicitud del propietario (precio, fotos, asesoría)', 'Foto: sala', 'Al asesor cuando el propietario pide algo desde su enlace. En cambio de precio muestra si es venta, arriendo o ambos, el valor nuevo y, si es solo venta, sugiere ofrecer arriendo y el estudio de mercado sin costo.', 'enviar-solicitud-propietario',
    correoBase(marca, { titulo: 'Solicitud de cambio de precio', tema: 'sala', cuerpo: p('El propietario del inmueble Nº 697 escribió desde el informe en vivo:') + T([['Inmueble', 'Nº 697'], ['Quiere ajustar', '🏷️ Venta'], ['Nuevo precio de venta', '$850.000.000'], ['Estudio de mercado para arrendar', '✅ Lo pidió: sin costo']]) + '<div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:#eef8f7;border:1px solid #bfe3e0;font-size:14px"><b>💡 Para tu llamada:</b> es solo venta. Sugiérele también <b>arrendar</b> y ofrécele el <b>estudio de mercado sin costo</b>.</div>', botones: [B('✉️ Responder al propietario')] })],
  ['Informe del inmueble', 'Foto: propietarios', 'Informe periódico al propietario con visitas, opiniones y enlace al informe en vivo. Si el inmueble es solo de venta, sugiere también arrendar con estudio de mercado sin costo.', 'enviar-informe-propietario',
    correoBase(marca, { titulo: 'Informe de tu inmueble Nº 697', tema: 'informe', cuerpo: p('Hola Ana, te compartimos cómo va tu inmueble.') + T([['Visitas', '4'], ['Opiniones', '3 positivas']]) + '<div style="margin-top:20px;padding:16px 18px;border-radius:16px;background:#eef8f7;border:1px solid #bfe3e0;font-size:14px;line-height:1.6"><b>💡 ¿Y si también lo arriendas?</b><br>Mientras se vende, un arriendo puede generarte ingresos. Hacemos un <b>estudio de mercado sin costo</b> para decirte a cuánto arrendarlo.</div>', botones: [B('📊 Ver el informe en vivo'), B('🔑 Quiero el estudio de mercado sin costo', 'contorno')] })],
  ['Resumen semanal de propietarios', 'Foto: conjunto', 'Resumen de todos los inmuebles de un propietario, semanal o mensual, con enlace a sus preferencias.', 'enviar-resumen-propietarios',
    correoBase(marca, { titulo: 'Resumen de tus inmuebles', tema: 'conjunto', cuerpo: p('Esto pasó esta semana:') + T([['Inmueble 697', '2 visitas'], ['Inmueble 702', '1 visita']]), botones: [B('Administrar preferencias', 'contorno')] })],
  ['Radicación del cliente', 'Foto: hogar', 'Al cliente que radica una solicitud: confirma que se recibió y qué sigue.', 'enviar-radicacion-cliente',
    correoBase(marca, { titulo: 'Vamos por tu nuevo hogar', tema: 'hogar', cuerpo: p('Hola Ana, recibimos tu solicitud y ya estamos trabajando en ella.') })],
  ['Código de verificación', 'Foto: hogar', 'Al reservar una cita en la página pública: código de 6 dígitos para confirmar el correo.', 'enviar-codigo-verificacion',
    correoBase(marca, { titulo: 'Confirma que este correo es tuyo', tema: 'hogar', cuerpo: p('Usa este código para terminar de reservar:') + '<p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#1A2C45;margin:10px 0">123456</p>' })],
  ['Crear o restablecer contraseña', 'Foto: acceso', 'Cuando se da acceso a un nuevo miembro del equipo o alguien olvida su contraseña. Enlace de un solo uso.', 'gestion-accesos · recuperar-contrasena',
    correoBase(marca, { titulo: 'Crea tu contraseña', tema: 'acceso', cuerpo: p('Te dieron acceso a la agenda de citas. Pulsa el botón para elegir tu contraseña.'), botones: [B('🔑 Crear mi contraseña')] })],
  ['Soporte y tickets', 'Foto: soporte', 'Cuando alguien abre, responde o cierra un ticket de soporte; también el correo de prueba de configuración.', 'avisar-ticket · probar-correo-config',
    correoBase(marca, { titulo: 'Respondimos tu solicitud', tema: 'soporte', cuerpo: p('Hola, el equipo de soporte respondió tu ticket.'), botones: [B('Ver el ticket', 'contorno')] })],
  ['Alerta de demanda', 'Foto: demanda', 'Al propietario o asesor cuando un inmueble tiene mucha demanda: sugerencia de revisar el precio.', 'avisar-demanda',
    correoBase(marca, { titulo: 'Mucha demanda en un inmueble', tema: 'demanda', cuerpo: p('Esto es una sugerencia para revisar el precio a tiempo; el sistema no cambia nada solo.') + T([['Inmueble 697', '8 visitas en 7 días']]) })],
  ['Encuesta respondida', 'Foto: opinión', 'Al asesor cuando un cliente contesta la encuesta de la visita.', 'avisar-encuesta-respondida',
    correoBase(marca, { titulo: 'Un cliente respondió la encuesta', tema: 'opinion', cuerpo: p('A Ana le gustó mucho el inmueble 697.'), botones: [B('Ver la respuesta', 'contorno')] })],
  ['Encuesta al cliente (diseño propio)', 'Foto: opinión', 'Al cliente tras la visita: cuatro botones con caritas para opinar. Aún no usa la plantilla común (aquí se muestra aproximada).', 'enviar-encuesta-cliente',
    correoBase(marca, { titulo: '¿Cómo te pareció el inmueble? 🏡', tema: 'opinion', cuerpo: p('Toca la opción que mejor describa lo que sentiste.'), botones: [B('😍 Me gustó mucho', 'contorno'), B('🙂 Me gustó', 'contorno'), B('😐 No estoy seguro', 'contorno'), B('🙁 No me gustó', 'contorno')] })],
];
const e = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Catálogo de correos</title><style>
@page{size:A4;margin:10mm}body{margin:0;font:14px Arial,sans-serif;color:#1A2C45;background:#fff}
.p{page-break-after:always;display:grid;grid-template-columns:62mm 1fr;gap:8mm;align-items:start;padding:2mm}
.n{font-size:11px;color:#63707a}.n h2{font-size:16px;margin:4px 0 8px;color:#1A2C45}.t{display:inline-block;background:#e6f6f5;color:#007c79;border-radius:99px;padding:3px 9px;font-weight:700;font-size:11px}
iframe{width:100%;height:255mm;border:1px solid #dde3e7;border-radius:10px}code{font-size:10px;background:#f1f4f6;padding:2px 4px;border-radius:4px}
.i{page-break-after:always;padding:10mm}.i td{padding:5px 8px;border-bottom:1px solid #e7ebee;font-size:12px}</style></head><body>
<div class="i"><h1>Catálogo de correos · Patrimonios</h1><p>${lista.length} diseños. Datos de ejemplo; fotos y botones como en producción.</p><table style="width:100%;border-collapse:collapse">${lista.map(([a, b, , c], i) => `<tr><td>${i + 1}</td><td><b>${a}</b></td><td>${b}</td><td><code>${c}</code></td></tr>`).join('')}</table></div>
${lista.map(([a, b, c, f, h], i) => `<div class="p"><div class="n"><span class="t">${i + 1} · ${b}</span><h2>${a}</h2><p><b>Cuándo se usa:</b> ${c}</p><p>Función: <code>${f}</code></p></div><iframe srcdoc="${e(h)}"></iframe></div>`).join('')}
</body></html>`;
writeFileSync(new URL('../tmp/catalogo-correos.html', import.meta.url), conFotosLocales(html));
