// Lector del calendario del sistema anterior: node --test tests/ics-historico.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerDatosCliente, parsearIcsHistorico, icsABogota } from '../aplicacion/js/ics-historico.js';

test('saca nombre, correo, celular e inmueble de una descripción con etiquetas', () => {
  const d = extraerDatosCliente('Visita inmueble 697', 'Nombre: Ana María Pérez\nCorreo: Ana.Perez@Gmail.com\nCelular: 300 123 4567\nInmueble: 697');
  assert.deepEqual(d, { nombre: 'Ana María Pérez', correo: 'ana.perez@gmail.com', telefono: '3001234567', inmueble: 697 });
});

test('también entiende texto suelto y el prefijo +57', () => {
  const d = extraerDatosCliente('Cita', 'Juan Gómez\njuan@correo.co\n+57 315 555 1234\nCódigo 245');
  assert.equal(d.nombre, 'Juan Gómez');
  assert.equal(d.telefono, '3155551234');
  assert.equal(d.inmueble, 245);
});

test('lo que no encuentra queda vacío', () => {
  const d = extraerDatosCliente('Reunión', '');
  assert.deepEqual(d, { nombre: '', correo: '', telefono: '', inmueble: null });
});

test('convierte horas a Colombia y toma CREATED como momento en que se pidió la cita', () => {
  assert.deepEqual(icsABogota('20261027T150000Z'), { fecha: '2026-10-27', hora: '10:00', iso: '2026-10-27T15:00:00.000Z' });
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261030T150000Z', 'CREATED:20261027T140000Z', 'SUMMARY:Visita 697', 'DESCRIPTION:Nombre: Luis\\nCelular: 3001112233\\nInmueble: 697', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2', 'DTSTART;VALUE=DATE:20261030', 'SUMMARY:Festivo', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a3', 'DTSTART:20261031T150000Z', 'STATUS:CANCELLED', 'SUMMARY:Visita 697', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const { eventos, omitidos } = parsearIcsHistorico(ics);
  assert.equal(eventos.length, 2);
  assert.equal(omitidos.todoElDia, 1);
  assert.equal(eventos[0].pedidaEn, '2026-10-27T14:00:00.000Z');
  assert.equal(eventos[0].inmueble, 697);
  assert.equal(eventos[0].telefono, '3001112233');
  assert.equal(eventos[1].cancelada, true);
});
