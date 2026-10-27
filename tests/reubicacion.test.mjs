// Reglas y textos de «visita pendiente de nuevo horario»: node --test tests/reubicacion.test.mjs (Node 24, importa .ts directo)
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularVencimiento, horasUltimoRecordatorio, requiereLlamada, formatearMomento, correoClienteNuevoHorario, correoClienteRecordatorio, OPCIONES_ARRENDATARIO } from '../supabase/functions/_shared/reubicacion.ts';

const H = 3_600_000;
const t = (iso) => new Date(iso).getTime();

test('plazo proporcional: la mitad del tiempo que falta, entre 24 h y 7 días', () => {
  const ahora = t('2026-10-26T15:00:00-05:00');
  const horas = (h) => (calcularVencimiento(ahora, ahora + h * H) - ahora) / H;
  assert.equal(horas(17 * 24), 168); // visita en 17 días: tope de 7 días
  assert.equal(horas(6 * 24), 72); // 6 días: la mitad
  assert.equal(horas(3 * 24), 36); // 3 días
  assert.equal(horas(50), 25); // 50 h: la mitad (25 h), antes del límite de 24 h previas a la visita
  assert.equal(horas(30), 24); // 30 h: mínimo de 24 h
  assert.equal(horas(20), 10); // mañana: plazo corto (la mitad)
});

test('el plazo nunca llega a la visita: 24 h antes si está lejos, 2 h antes si está cerca, piso de 1 h', () => {
  const ahora = t('2026-10-26T15:00:00-05:00');
  assert.equal(calcularVencimiento(ahora, ahora + 10 * H), ahora + 5 * H);
  assert.equal(calcularVencimiento(ahora, ahora + 2.5 * H), ahora + H); // piso: 1 h para leer el correo
  assert.equal(calcularVencimiento(ahora, ahora + 30 * 60_000), ahora + 30 * 60_000); // visita en 30 min: nunca después de empezar
  assert.ok(calcularVencimiento(ahora, ahora + 60 * H) <= ahora + 60 * H - 24 * H);
});

test('el último recordatorio va 24 h antes si el plazo es largo y 2 h antes si es corto', () => {
  assert.equal(horasUltimoRecordatorio(0, 72 * H), 24);
  assert.equal(horasUltimoRecordatorio(0, 10 * H), 2);
});

test('si falta menos de 24 h el asesor debe llamar', () => {
  const ahora = t('2026-10-26T15:00:00-05:00');
  assert.equal(requiereLlamada(ahora, ahora + 23 * H), true);
  assert.equal(requiereLlamada(ahora, ahora + 25 * H), false);
});

test('formatearMomento da fecha absoluta en hora de Bogotá', () => {
  assert.equal(formatearMomento(t('2026-10-29T15:00:00-05:00')), 'jueves 29 de octubre, 3:00 p. m.');
  assert.equal(formatearMomento(t('2026-10-29T00:05:00-05:00')), 'jueves 29 de octubre, 12:05 a. m.');
  assert.equal(formatearMomento(t('2026-10-29T20:00:00Z')), 'jueves 29 de octubre, 3:00 p. m.'); // 20:00 UTC = 15:00 Bogotá
});

const datos = { nombre: 'Ana <b>', lugar: 'Calle 10 # 5-20', visitaOriginal: 'jueves 29 de octubre, 3:00 p. m.', vence: 'miércoles 28 de octubre, 3:00 p. m.', enlace: 'https://x/visita/abc', asesor: { nombre: 'Luis', celular: '3001234567' } };

test('el correo al cliente dice qué hacer, hasta cuándo y qué pasa si no hace nada', () => {
  const c = correoClienteNuevoHorario(datos);
  assert.match(c.asunto, /nueva hora/);
  assert.match(c.asunto, /miércoles 28 de octubre, 3:00 p. m\./);
  assert.match(c.cuerpo, /Qué debes hacer/);
  assert.match(c.cuerpo, /Si no eliges otra hora:<\/b> la visita se cancelará/);
  assert.match(c.cuerpo, /ya quedó libre/);
  assert.match(c.cuerpo, /no vayas al inmueble a la hora original/);
  assert.equal(c.boton.texto, 'Elegir nueva hora');
  assert.equal(c.boton.url, 'https://x/visita/abc');
});

test('el correo al cliente ya no dice que la visita es opcional o que no haga nada si no le parece', () => {
  const todo = JSON.stringify(correoClienteNuevoHorario({ ...datos, sugerencia: 'viernes 30 de octubre, 10:00 a. m.' }));
  assert.doesNotMatch(todo, /dejarla como est/i);
  assert.doesNotMatch(todo, /solo cambia si t[uú] aceptas/i);
  assert.match(todo, /Te propone esta hora/);
});

test('los textos escapan HTML de los datos del cliente', () => {
  assert.ok(!correoClienteNuevoHorario(datos).cuerpo.includes('Ana <b>'));
  assert.ok(correoClienteNuevoHorario(datos).cuerpo.includes('Ana &lt;b&gt;'));
});

test('el recordatorio repite el plazo absoluto y la consecuencia', () => {
  const r = correoClienteRecordatorio(datos);
  assert.match(r.cuerpo, /Tienes hasta el miércoles 28 de octubre, 3:00 p\. m\./);
  assert.match(r.cuerpo, /se cancela automáticamente/);
});

test('las tres opciones del arrendatario existen y la consecuencia está dicha', () => {
  assert.equal(OPCIONES_ARRENDATARIO.otraHora.titulo, 'Puedo, pero a otra hora');
  assert.equal(OPCIONES_ARRENDATARIO.diaNoPuedo.titulo, 'No puedo ese día');
  assert.match(OPCIONES_ARRENDATARIO.pausa.titulo, /por un tiempo/);
  assert.match(OPCIONES_ARRENDATARIO.consecuencia, /se cancela sola/);
});
