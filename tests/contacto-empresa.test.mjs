import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { empresaA, empresaB } from './fixtures/contacto-empresas.mjs';
import { marcaCorreo, pieContacto, pieLegal, bloqueCaptacion, encabezadoImagen } from '../supabase/functions/_shared/marca-correo.ts';
import { htmlContactoEmpresa, validarContactoEmpresa } from '../aplicacion/js/contacto-empresa.js';

test('dos empresas: los pies y la captación solo usan la configuración recibida', () => {
  const a = marcaCorreo(empresaA), b = marcaCorreo(empresaB);
  const htmlA = pieContacto(a) + pieLegal(a) + bloqueCaptacion(a);
  const htmlB = pieContacto(b) + pieLegal(b) + bloqueCaptacion(b);
  assert.match(htmlA, /empresa-a\.example/); assert.match(htmlA, /111 1111/);
  assert.doesNotMatch(htmlA, /empresa-b|222 2222|Patrimonios|patrimonios/i);
  assert.match(htmlB, /empresa-b\.example/); assert.match(htmlB, /222 2222/);
  assert.doesNotMatch(htmlB, /empresa-a|111 1111|Patrimonios|patrimonios/i);
});
test('números internacionales, varios teléfonos y extensión se convierten en enlaces', () => {
  const html = pieContacto(marcaCorreo(empresaA));
  for (const tel of ['+576011111111;ext=123', '+576011112222', '+576051113333']) assert.ok(html.includes(`href="tel:${tel}"`));
  assert.match(html, /Recepción/); assert.match(html, /ext\. 123/); assert.match(html, /Ciudad B/);
});
test('configuración vacía: no hay teléfono, web o identidad prestada', () => {
  const marca = marcaCorreo(null);
  assert.equal(pieContacto(marca), ''); assert.equal(pieLegal(marca), ''); assert.equal(bloqueCaptacion(marca), '');
});
test('compatibilidad con el teléfono general solo de la misma empresa', () => {
  assert.match(pieContacto(marcaCorreo({ telefono: '(601) 123 4567' })), /tel:6011234567/);
  assert.doesNotMatch(pieContacto(marcaCorreo(empresaA)), /6011234567/);
});
test('contenido peligroso: texto escapado y protocolos o correos inyectados omitidos', () => {
  const config = structuredClone(empresaA);
  config.correo_contacto = 'a@example.com" onclick="alert(1)';
  Object.assign(config.contacto_empresa, { sitio_web: 'javascript:alert(1)', politica_datos_url: 'https://user:pass@example.com', correo_baja: 'x@example.com\r\nBcc:a@example.com', razon_social: '<img src=x onerror=alert(1)>', direccion: 'A & B' });
  config.contacto_empresa.sedes[0].nombre = '"><script>alert(1)</script>';
  const html = pieLegal(marcaCorreo(config));
  assert.doesNotMatch(html, /<script|<img|href="javascript:|mailto:|user:pass|onclick="/);
  assert.match(html, /&lt;img/); assert.match(html, /A &amp; B/);
  assert.equal(bloqueCaptacion(marcaCorreo(config)), '');
});
test('datos malformados no se convierten en teléfonos ni provocan excepciones', () => {
  for (const datos of [null, [], 'texto', { sedes: [null, 1, { telefonos: ['123', {numero: 'javascript:1'}, {numero: '+57 601 111 1111', extension: '" onclick="'}] }] }]) {
    assert.equal(pieContacto(marcaCorreo({contacto_empresa: datos})), '');
  }
});
test('publicidad solo con identificación, política y canal de baja completos', () => {
  assert.match(bloqueCaptacion(marcaCorreo(empresaA)), /mailto:contacto@empresa-a\.example/);
  assert.equal(bloqueCaptacion(marcaCorreo(empresaB)), '');
  const c = structuredClone(empresaA); c.contacto_empresa.correo_baja = '';
  assert.match(pieLegal(marcaCorreo(c)), /mailto:contacto@empresa-a\.example\?subject=/);
});
test('otra empresa no recibe fotografías con logo de Patrimonios', () => {
  assert.doesNotMatch(encabezadoImagen(marcaCorreo(empresaA), 'Prueba', 'visita'), /patrimonios/);
  assert.doesNotMatch(encabezadoImagen(marcaCorreo({...empresaB, dominio_publico:'citas.patrimonios.co', empresa:{slug:'otra-empresa'}}), 'Prueba', 'visita'), /patrimonios/);
  assert.match(encabezadoImagen(marcaCorreo({empresa: {slug: 'patrimonios'}}), 'Prueba', 'visita'), /foto-visita\.jpg/);
});
test('editor: datos válidos se conservan y se escapan los atributos', () => {
  assert.deepEqual(validarContactoEmpresa(empresaA.contacto_empresa), empresaA.contacto_empresa);
  const c = structuredClone(empresaA); c.contacto_empresa.razon_social = '"><img src=x>';
  const html = htmlContactoEmpresa(c);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&quot;&gt;&lt;img/);
  assert.doesNotMatch(htmlContactoEmpresa({}), /data-contacto-empresa/);
});
test('editor rechaza enlaces, números, extensiones y tamaños inválidos', () => {
  for (const mutate of [
    c => {c.sitio_web='http://empresa.example';}, c => {c.correo_baja='invalido';},
    c => {c.sedes[0].telefonos[0].numero='123';}, c => {c.sedes[0].telefonos[0].extension='abc';},
    c => {c.sedes[0].nombre='';c.sedes[0].ciudad='';}, c => {c.sedes[0].telefonos=[];},
    c => {c.sedes=Array.from({length:21},()=>c.sedes[0]);},
  ]) { const c=structuredClone(empresaA.contacto_empresa); mutate(c); assert.throws(()=>validarContactoEmpresa(c)); }
});
test('los datos preparados para Patrimonios conservan sus tres números y el pie legal', () => {
  const sql=readFileSync(new URL('../sql/016-contacto-empresa.sql',import.meta.url),'utf8');
  const datos=JSON.parse(sql.match(/set contacto_empresa = '([\s\S]*?)'::jsonb/)[1]);
  validarContactoEmpresa(datos);
  const marca=marcaCorreo({nombre_comercial:'Patrimonios Inmobiliarios',correo_contacto:'info@patrimonios.co',contacto_empresa:datos});
  const html=pieLegal(marca);
  for(const n of ['+576019179987','+576053198833','+576045904545']) assert.ok(html.includes(`href="tel:${n}"`));
  assert.match(html,/900\.140\.990-1/); assert.match(html,/politica-de-tratamiento-de-datos/);
});
test('las doce funciones se pueden analizar sin ejecutar SMTP ni consultar Supabase', () => {
  for (const nombre of ['avisar-arrendatario','enviar-correo-cita','enviar-correo-propietario','enviar-encuesta-cliente','enviar-informe-propietario','enviar-solicitud-propietario','gestion-accesos','marcar-inmueble-no-disponible','notificar-cambio-cita','portal-visita','probar-correo-config','recuperar-contrasena']) {
    const source=readFileSync(new URL(`../supabase/functions/${nombre}/index.ts`,import.meta.url),'utf8');
    assert.doesNotThrow(()=>stripTypeScriptTypes(source,{mode:'strip'}));
  }
});
