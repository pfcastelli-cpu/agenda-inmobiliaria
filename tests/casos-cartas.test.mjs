import test from 'node:test';
import assert from 'node:assert/strict';
import { borrador, cartaHTML, PLANTILLAS, SITUACION } from '../aplicacion/js/casos-cartas.js';
import { revisarTexto, informeHTML } from '../aplicacion/js/casos-informes.js';

const datos = { inmueble: 'Edificio de ejemplo · Apto 1', fechaAviso: '2026-10-17', fechaEntrega: '2027-02-15', fechaVencimiento: '2027-02-15', clasificacion: 'segura' };
const texto = (b) => [b.asunto, ...b.secciones.map((s) => s.texto)].join('\n\n');

test('las tres cartas se llenan con las fechas y el inmueble, sin huecos', () => {
  for (const k of Object.keys(PLANTILLAS)) {
    const b = borrador(k, datos);
    assert.ok(!/\[[^\]]+\]/.test(texto(b)), `hueco sin llenar en ${k}`);
    assert.ok(!/\{\w+\}/.test(texto(b)), `variable sin reemplazar en ${k}`);
  }
});

test('faltan datos: quedan huecos visibles entre corchetes (para bloquear el envío)', () => {
  const b = borrador('renovado_820', { inmueble: 'X', fechaAviso: '2026-10-17' });
  assert.match(texto(b), /\[fecha\]/);
});

test('las cartas sugeridas pasan su propia revisión (perfil carta), sin bloqueos', () => {
  for (const k of Object.keys(PLANTILLAS)) {
    const bloqueos = revisarTexto(texto(borrador(k, datos)), 'carta').filter((p) => p.bloquea);
    assert.deepEqual(bloqueos, [], `la plantilla ${k} se bloquea a sí misma: ${JSON.stringify(bloqueos)}`);
  }
});

test('el perfil carta sigue bloqueando datos personales', () => {
  assert.ok(revisarTexto('Llámelo al 3101234567', 'carta').some((p) => p.bloquea));
  assert.ok(revisarTexto('Escríbale a nombre@correo.com', 'carta').some((p) => p.bloquea));
  assert.ok(revisarTexto('cédula 1020304050', 'carta').some((p) => p.bloquea));
  assert.ok(!revisarTexto('Podemos hablar por teléfono', 'carta').some((p) => p.bloquea));
});

test('el informe de mantenimiento sí bloquea nombrar propietario o arrendatario', () => {
  assert.ok(revisarTexto('El propietario pagó el arreglo').some((p) => p.bloquea));
});

test('la situación del propietario cubre las cuatro clasificaciones y no promete cero riesgo', () => {
  for (const c of ['segura', 'extemporanea', 'acuerdo', 'incompleta']) assert.ok(SITUACION[c]);
  assert.ok(!/ning[uú]n riesgo/i.test(Object.values(SITUACION).join(' ')));
});

test('la carta no promete un año de prórroga ni usa lenguaje hostil', () => {
  const t = texto(borrador('renovado_820', datos));
  assert.ok(!/un a[ñn]o|perentori|unilateral/i.test(t));
  assert.match(t, /término igual al inicialmente pactado/);
});

test('cartaHTML: botones de decisión solo en el aviso al propietario, y enlaces seguros', () => {
  const prop = cartaHTML(borrador('aviso_propietario', datos), { enlaces: { acepta: 'https://x.co/a', hablar: 'javascript:alert(1)', rechaza: '#' }, inmueble: datos.inmueble }, { base: 'https://x.co/' });
  assert.match(prop, /Sí, autorizo/);
  assert.ok(!/javascript:/i.test(prop));
  const arr = cartaHTML(borrador('entrega_a_tiempo', datos), { inmueble: datos.inmueble }, { base: 'https://x.co/' });
  assert.ok(!/Sí, autorizo/.test(arr));
  assert.match(arr, /no modifica el contrato/i);
});

test('modelo: el propietario autoriza el acuerdo (no las visitas) y el plazo prudencial es de 2 semanas editable', () => {
  const p = texto(borrador('aviso_propietario', datos));
  assert.match(p, /terminación anticipada/);
  assert.match(p, /2 semanas/);
  assert.ok(!/autoriz\w+ (mostrar|las visitas)/i.test(p));
  assert.match(texto(borrador('entrega_a_tiempo', { ...datos, plazoSemanas: '3' })), /3 semanas/);
  for (const k of ['entrega_a_tiempo', 'renovado_820']) {
    const t = texto(borrador(k, datos));
    assert.match(t, /aprobación del propietario/);
    assert.match(t, /ningún compromiso|compromiso alguno/);
  }
});

test('el informe de reparación no nombra quién paga ni quién hizo el arreglo', () => {
  const h = informeHTML({ copropiedad: 'E', unidad: 'A1', caso: '1', introduccion: 'Intro.', hallazgo: 'x', trabajo: 'y', antes: [], despues: [] }, { base: '/' });
  assert.ok(!/paga|pag[oó]|proveedor|contratista/i.test(h.replace(/<style[\s\S]*?<\/style>/g, '')));
});
