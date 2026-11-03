import test from 'node:test';
import assert from 'node:assert/strict';
import { agruparHorarios, seleccionarHorario } from '../aplicacion/js/captacion-horarios.js';

const fila = (fecha, h, id, nombre, tipo, prioridad) => ({ fecha, hora_inicio: h, hora_fin: h, asesor_id: id, asesor_nombre: nombre, tipo_vinculacion: tipo, prioridad });

test('mezcla asesores por hora y asigna al de mayor prioridad', () => {
  const s = agruparHorarios([
    fila('2026-11-04', '09:00:00', 'b', 'Beto', 'planta', 3),
    fila('2026-11-04', '09:00:00', 'a', 'Ana', 'freelance', 1),
    fila('2026-11-04', '10:00:00', 'b', 'Beto', 'planta', 3),
  ]);
  assert.equal(s.length, 2);
  assert.equal(s[0].opciones[0].asesorNombre, 'Ana');
  assert.equal(seleccionarHorario(s[0]).asesorId, 'a');
  assert.equal(s[1].opciones.length, 1);
});

test('con igual prioridad, de planta antes que freelance; si el primero está ocupado ofrece al otro', () => {
  const s = agruparHorarios([
    fila('2026-11-04', '09:00:00', 'f', 'Zoe', 'freelance', 3),
    fila('2026-11-04', '09:00:00', 'p', 'Pablo', 'planta', 3),
    fila('2026-11-04', '11:00:00', 'f', 'Zoe', 'freelance', 3),
  ]);
  assert.equal(s[0].opciones[0].asesorId, 'p');
  assert.equal(seleccionarHorario(s[0], 'f').asesorNombre, 'Zoe');
  assert.equal(s[1].opciones[0].asesorId, 'f');
});
