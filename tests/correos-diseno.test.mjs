import test from 'node:test';
import assert from 'node:assert/strict';
import { correoVisita, enlaceVisita } from '../supabase/functions/_shared/visita-correo.ts';
import { correoBase, botonesCorreo } from '../supabase/functions/_shared/plantilla-correo.ts';
import { marcaCorreo } from '../supabase/functions/_shared/marca-correo.ts';

const marca = marcaCorreo({ nombre_comercial: 'Patrimonios Inmobiliarios', color_principal: '#1A2C45', color_accion: '#00A9A5', empresa: { slug: 'patrimonios' } });

test('plantilla común conserva foto temática, tarjeta, título y modo de pruebas', () => {
  const html = correoBase(marca, { titulo: 'Visita confirmada', cuerpo: '<p>Contenido</p>', tema: 'visita', modoPruebas: true, destinatarioReal: 'real@example.com' });
  assert.match(html, /foto-visita\.jpg/);
  assert.match(html, /border-radius:24px/);
  assert.match(html, /#1A2C45/);
  assert.match(html, /real@example\.com/);
});

test('los enlaces de ubicación y contacto son CTAs de contorno', () => {
  const html = botonesCorreo(marca, [
    { texto: 'Abrir en Google Maps', url: 'https://maps.google.com/?q=Bogota', variante: 'mapa' },
    { texto: 'Llamar', url: 'tel:+573001112233', variante: 'llamar' },
  ]);
  assert.match(html, /border-radius:999px/);
  assert.match(html, /Abrir en Google Maps/);
  assert.match(html, /📍 Abrir en Google Maps/);
  assert.match(html, /tel:\+573001112233/);
  assert.doesNotMatch(html, /📍 📍/);
  assert.match(enlaceVisita('https://maps.google.com/?q=Bogota', 'Ver en Maps', marca), /border-radius:999px/);
  assert.doesNotMatch(botonesCorreo(marca, [{ texto: 'No', url: 'javascript:alert(1)' }]), /javascript/);
});

test('una empresa distinta no recibe fotos temáticas ni identidad de Patrimonios', () => {
  const otra = marcaCorreo({ nombre_comercial: 'Otra empresa', color_principal: '#123456', color_accion: '#654321', empresa: { slug: 'otra' } });
  const html = correoBase(otra, { titulo: 'Título <seguro>', cuerpo: '<p>Texto</p>', tema: 'visita', modoPruebas: true, destinatarioReal: 'real@example.com' });
  assert.doesNotMatch(html, /citas\.patrimonios\.co\/correo\/foto/);
  assert.match(html, /Otra empresa/);
  assert.match(html, /T&iacute;tulo|T&iacute;tulo|Título &lt;seguro&gt;/);
  assert.match(html, /real@example\.com/);
});

test('correo de visita conserva el aviso original', () => {
  const html = correoVisita(marca, { titulo: 'Tu visita', cuerpo: '<p>Datos</p>', puntualidad: true, modoPruebas: false, destinatarioReal: 'real@example.com' });
  assert.match(html, /Tu asesor no puede esperar/);
  assert.match(html, /no podrá esperarte/);
  assert.doesNotMatch(html, /Planea tu llegada/);
});
