// Alertas de demanda: node --test tests/alertas-demanda.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nivelDemanda, rangoSugerido, textoAlerta } from '../aplicacion/js/alertas-demanda.js';

const u = { info: 3, urgente: 5 };
const fila = (o) => ({ pedidos_24h: 0, pedidos_48h: 0, personas: 0, activas: 0, tope: null, valor_canon: 1670000, ...o });

test('niveles: normal, atención y urgente según pedidos en 24 y 48 horas', () => {
  assert.equal(nivelDemanda(fila({ pedidos_24h: 2, pedidos_48h: 4 }), u), 'normal');
  assert.equal(nivelDemanda(fila({ pedidos_24h: 3 }), u), 'atencion');
  assert.equal(nivelDemanda(fila({ pedidos_48h: 6 }), u), 'atencion');
  assert.equal(nivelDemanda(fila({ pedidos_24h: 19, pedidos_48h: 19 }), u), 'urgente');
  assert.equal(nivelDemanda(fila({ pedidos_48h: 10 }), u), 'urgente');
});

test('llegar al tope de citas activas es urgente aunque el ritmo sea bajo', () => {
  assert.equal(nivelDemanda(fila({ pedidos_24h: 1, activas: 8, tope: 8 }), u), 'urgente');
  assert.equal(nivelDemanda(fila({ pedidos_24h: 1, activas: 7, tope: 8 }), u), 'normal');
});

test('rango sugerido: 8–10 % si es urgente (redondeado a $10.000), 3–5 % si es de atención', () => {
  const r = rangoSugerido(fila({}), 'urgente');
  assert.deepEqual([r.desde, r.hasta, r.pct], [1800000, 1840000, '8–10 %']);
  const a = rangoSugerido(fila({}), 'atencion');
  assert.deepEqual([a.desde, a.hasta], [1720000, 1750000]);
  assert.equal(rangoSugerido(fila({}), 'normal'), null);
});

test('el texto de la alerta dice el dato, qué hacer y que solo es una sugerencia revisable', () => {
  const t = textoAlerta(fila({ pedidos_24h: 19, pedidos_48h: 19, personas: 18 }), 'urgente');
  assert.match(t, /19 pedidos de cita en 24 h/);
  assert.match(t, /18 personas distintas/);
  assert.match(t, /8–10 %/);
  assert.match(t, /visita en grupo/);
  assert.match(t, /48 horas/);
});
