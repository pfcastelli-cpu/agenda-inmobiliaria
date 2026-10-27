// Pruebas de la lógica pura del soporte (sin red ni DOM): node --test tests/soporte.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { duracionMin, escapar, estrellas, hace, limpiarError, minutosParaSla } from '../aplicacion/js/soporte-comun/formato.js';
import { construirLinea, textoEvento } from '../aplicacion/js/soporte-comun/linea-tiempo.js';
import { sePuedeCalificar, SLA_HORAS } from '../aplicacion/js/soporte-comun/constantes.js';

const ticket = { id: 't1', usuario_nombre: 'Ana', descripcion: 'No carga', creado_en: '2026-10-26T10:00:00Z', estado: 'abierto' };
const detalle = {
  mensajes: [{ autor: 'Soporte', tipo: 'soporte', texto: 'Lo revisamos', creado_en: '2026-10-26T11:00:00Z' }],
  notas: [{ autor: 'Felipe', texto: 'nota secreta', creado_en: '2026-10-26T11:30:00Z' }],
  eventos: [
    { actor: 'Felipe', tipo: 'estado', detalle: { de: 'abierto', a: 'en_espera' }, creado_en: '2026-10-26T11:00:01Z' },
    { actor: 'Felipe', tipo: 'nota_interna', detalle: {}, creado_en: '2026-10-26T11:30:01Z' },
  ],
};

test('la línea de tiempo no incluye notas internas salvo que se pidan', () => {
  assert.ok(!JSON.stringify(construirLinea(ticket, detalle)).includes('secreta'));
  assert.ok(JSON.stringify(construirLinea(ticket, detalle, { conNotas: true })).includes('secreta'));
});

test('la línea de tiempo empieza por la descripción, va en orden y oculta el evento de nota', () => {
  const linea = construirLinea(ticket, detalle, { conNotas: true });
  assert.equal(linea[0].texto, 'No carga');
  assert.deepEqual(linea.map((i) => i.clase), ['mensaje', 'mensaje', 'evento', 'nota']);
  assert.ok(linea.every((i, k) => k === 0 || new Date(linea[k - 1].cuando) <= new Date(i.cuando)));
});

test('textoEvento habla distinto al usuario y al equipo', () => {
  const e = detalle.eventos[0];
  assert.equal(textoEvento(e, 'usuario'), 'pasó a «Esperando tu respuesta»');
  assert.equal(textoEvento(e, 'equipo'), 'Felipe: «Abierto» → «Esperando al usuario»');
  assert.equal(textoEvento({ tipo: 'nota_interna', detalle: {} }), '');
});

test('formato: errores, escape, estrellas y duraciones', () => {
  assert.equal(limpiarError('P0001: Este ticket ya está cerrado'), 'Este ticket ya está cerrado');
  assert.equal(limpiarError(''), 'No se pudo completar la acción.');
  assert.equal(escapar('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
  assert.equal(estrellas(3), '★★★☆☆');
  assert.equal(duracionMin(null), '—');
  assert.equal(duracionMin(45), '45 min');
  assert.equal(duracionMin(90), '1.5 h');
  assert.equal(duracionMin(60 * 72), '3 días');
});

test('hace() usa minutos, horas y días', () => {
  const ahora = new Date('2026-10-26T12:00:00Z').getTime();
  assert.equal(hace('2026-10-26T11:59:30Z', ahora), 'ahora');
  assert.equal(hace('2026-10-26T11:15:00Z', ahora), 'hace 45 min');
  assert.equal(hace('2026-10-26T09:00:00Z', ahora), 'hace 3 h');
  assert.equal(hace('2026-10-25T09:00:00Z', ahora), 'hace 1 día');
});

test('SLA: minutos restantes, vencido, y nada si ya hubo respuesta', () => {
  const ahora = new Date('2026-10-26T12:00:00Z').getTime();
  const t = { estado: 'abierto', vence_primera_en: '2026-10-26T13:00:00Z', primera_respuesta_en: null };
  assert.equal(minutosParaSla(t, ahora), 60);
  assert.equal(minutosParaSla({ ...t, vence_primera_en: '2026-10-26T11:00:00Z' }, ahora), -60);
  assert.equal(minutosParaSla({ ...t, primera_respuesta_en: '2026-10-26T12:30:00Z' }, ahora), null);
  assert.equal(minutosParaSla({ ...t, estado: 'en_espera' }, ahora), null);
});

test('se puede calificar desde la primera respuesta o al resolver, no antes', () => {
  assert.equal(sePuedeCalificar({ estado: 'abierto', primera_respuesta_en: null }), false);
  assert.equal(sePuedeCalificar({ estado: 'en_espera', primera_respuesta_en: '2026-10-26T11:00:00Z' }), true);
  assert.equal(sePuedeCalificar({ estado: 'resuelto', primera_respuesta_en: null }), true);
  assert.equal(SLA_HORAS.normal, 24);
});
