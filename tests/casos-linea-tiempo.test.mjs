import test from 'node:test';
import assert from 'node:assert/strict';
import { construirEventos } from '../aplicacion/js/casos-linea-tiempo.js';

const caso = { id: 'c1', creado_en: '2026-11-01T15:00:00Z', origen: 'agenda' };
test('une todas las fuentes, ordena del más reciente al más antiguo y marca las pruebas', () => {
  const ev = construirEventos(caso, {
    seg: [{ id: 's1', texto: 'Se llamó', creado_en: '2026-11-02T15:00:00Z' }],
    arch: [{ id: 'a1', nombre: 'Acta', tipo: 'acta', drive_url: 'https://drive.google.com/x', creado_en: '2026-11-03T15:00:00Z' }],
    com: [
      { id: 'k1', plantilla: 'aviso_propietario', destinatario: 'propietario', estado: 'enviada', asunto: 'A', enviada_en: '2026-11-04T15:00:00Z', creado_en: '2026-11-04T14:00:00Z', propietario_decision: 'pendiente' },
      { id: 'k2', plantilla: 'entrega_a_tiempo', destinatario: 'arrendatario', estado: 'prueba', asunto: 'P', creado_en: '2026-11-05T15:00:00Z' },
    ],
    cola: [{ id: 'q1', accion: 'seguimiento', estado: 'error', error: 'x', creado_en: '2026-11-02T16:00:00Z' }],
  });
  const fechas = ev.map((e) => e.cuando);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
  assert.equal(ev.filter((e) => e.esPrueba).length, 1);
  assert.ok(ev.some((e) => e.tipo === 'decision'));
  assert.ok(ev.some((e) => e.tipo === 'sedi' && e.error));
});
test('no expone datos personales: el detalle de una carta solo trae el correo enmascarado', () => {
  const [e] = construirEventos(caso, { com: [{ id: 'k', plantilla: 'otra', destinatario: 'arrendatario', estado: 'enviada', asunto: 'A', correo_mascara: 'p***@ejemplo.co', enviada_en: '2026-11-04T15:00:00Z', creado_en: '2026-11-04T15:00:00Z' }] });
  assert.equal(e.detalle.Correo, 'p***@ejemplo.co');
});
