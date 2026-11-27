import test from 'node:test';
import assert from 'node:assert/strict';
import { clasificarTerminacion } from '../aplicacion/js/casos-inmuebles.js';

test('entrega segura: aviso con 3 meses o más y entrega en la fecha de vencimiento', () => {
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-08-01', fecha_vencimiento: '2026-12-01', fecha_entrega: '2026-12-01' }).clave, 'segura');
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-08-01', fecha_vencimiento: '2026-12-01', fecha_entrega: '2026-12-05' }).clave, 'segura');
});
test('extemporáneo: aviso con menos de 3 meses', () => {
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-12-15', fecha_vencimiento: '2027-02-28', fecha_entrega: '2027-02-28' }).clave, 'extemporanea');
  // 12/11 -> 28/02 son 3,5 meses: es segura.
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-11-12', fecha_vencimiento: '2027-02-28', fecha_entrega: '2027-02-28' }).clave, 'segura');
});
test('acuerdo: aviso a tiempo pero entrega lejos del vencimiento', () => {
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-05-01', fecha_vencimiento: '2026-12-01', fecha_entrega: '2026-12-31' }).clave, 'acuerdo');
});
test('incompleta si falta una fecha', () => {
  assert.equal(clasificarTerminacion({ fecha_aviso: '2026-05-01' }).clave, 'incompleta');
});
