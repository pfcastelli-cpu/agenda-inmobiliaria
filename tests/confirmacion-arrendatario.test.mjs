import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlConfirmacionArrendatario, horasParaVisita } from '../aplicacion/js/confirmacion-arrendatario.js';

const ahora = new Date('2026-11-10T10:00:00');
const cita = (extra) => ({ estado: 'confirmada', fecha: '2026-11-11', hora_inicio: '09:00:00', arrendatario_confirmado_en: null, ...extra });

test('visita en menos de 24 h sin confirmar: alerta con llamada', () => {
  const html = htmlConfirmacionArrendatario(cita({}), ahora);
  assert.match(html, /v-confirma-alerta/);
  assert.match(html, /Llámalo para confirmar/);
});

test('visita en más de 24 h sin confirmar: etiqueta pendiente sin alerta', () => {
  const html = htmlConfirmacionArrendatario(cita({ fecha: '2026-11-13' }), ahora);
  assert.match(html, /Arrendatario sin confirmar/);
  assert.doesNotMatch(html, /v-confirma-alerta/);
});

test('confirmada: muestra el visto bueno', () => {
  const html = htmlConfirmacionArrendatario(cita({ arrendatario_confirmado_en: '2026-11-10T14:00:00Z' }), ahora);
  assert.match(html, /Arrendatario confirmó/);
});

test('cancelada, realizada o ya pasada: no muestra nada', () => {
  assert.equal(htmlConfirmacionArrendatario(cita({ estado: 'cancelada' }), ahora), '');
  assert.equal(htmlConfirmacionArrendatario(cita({ estado: 'completada' }), ahora), '');
  assert.equal(htmlConfirmacionArrendatario(cita({ fecha: '2026-11-09' }), ahora), '');
  assert.equal(horasParaVisita(cita({ fecha: 'x' }), ahora), null);
});
