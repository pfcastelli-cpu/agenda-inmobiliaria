// Integración real autorizada. Requiere el archivo privado creado por preparar-cita-qa.sql.
// No imprimir tokens ni respuestas completas. Correos siempre dirigidos al buzón de pruebas.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const archivo=process.argv[2];
if(!archivo) throw new Error('Indica el archivo privado de la cita sintética.');
const qa=JSON.parse(readFileSync(archivo,'utf8').replace(/^\uFEFF/,'')).rows[0].qa;
assert.equal(qa.es_prueba,true);assert.equal(qa.modo_pruebas,true);assert.ok(qa.nombre.startsWith('[PRUEBA]'));assert.equal(qa.numero,127);
const base=process.env.VITE_SUPABASE_URL, key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(base).hostname,'ykiuuxludyonkhywtmgu.supabase.co');assert.ok(key);
const resultados=[];
async function llamar(token,accion,extra={},esperado=200) {
  const r=await fetch(`${base}/functions/v1/portal-visita`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({token,accion,...extra}),signal:AbortSignal.timeout(90_000)});
  const d=await r.json();assert.equal(r.status,esperado,`${accion}: HTTP ${r.status}, ${d.error||''}`);
  if(esperado===200) assert.equal(d.ok,true,accion);return d;
}
const original=await llamar(qa.token_arrendatario,'obtener');
assert.equal(original.reubicacion,false);
const horas=await llamar(qa.token_arrendatario,'horarios',{fecha:qa.fecha});
const elegida=horas.horas.filter(h=>h.hora_inicio.slice(0,5)>original.cita.hora_inicio).at(-1);
assert.ok(elegida,'Debe haber una hora distinta disponible');
const hora=elegida.hora_inicio.slice(0,5);
await llamar(qa.token_arrendatario,'proponer',{fecha:qa.fecha,hora});
const pendiente=await llamar(qa.token_cliente,'obtener');
assert.equal(pendiente.reubicacion,true);assert.equal(pendiente.propuesta.hora_inicio,hora);
resultados.push('Propuesta del arrendatario y vista del cliente: PASS');
// Aceptación duplicada simultánea: misma confirmación, una sola actualización y un solo juego de avisos.
const aceptar=()=>fetch(`${base}/functions/v1/portal-visita`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({token:qa.token_cliente,accion:'responder',aceptar:true,propuesta_id:pendiente.propuesta.id}),signal:AbortSignal.timeout(90_000)});
const respuestas=await Promise.all([aceptar(),aceptar()]);
assert.deepEqual(respuestas.map(r=>r.status).sort(),[200,200]);
assert.deepEqual((await Promise.all(respuestas.map(r=>r.json()))).map(d=>d.resultado).sort(),['aceptada','ya_aceptada']);
const actual=await llamar(qa.token_cliente,'obtener');
assert.equal(actual.reubicacion,false);assert.equal(actual.propuesta,null);assert.equal(actual.cita.hora_inicio,hora);assert.equal(actual.cita.estado,'confirmada');
const arrendatario=await llamar(qa.token_arrendatario,'obtener');assert.equal(arrendatario.cita.hora_inicio,hora);
resultados.push('Aceptación de la hora conservada: PASS','Aceptación simultánea duplicada: dos respuestas coherentes y una sola confirmación, PASS','Ambas partes ven la misma cita confirmada: PASS');
const invalido=await llamar('00000000-0000-0000-0000-000000000000','obtener',{},404);assert.equal(invalido.ok,false);
await llamar(qa.token_cliente,'pausar',{},400);
resultados.push('Token inválido y acción desconocida rechazados: PASS');
const registro=await fetch(`${base}/functions/v1/registrar-fallo`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({token:qa.token_cliente,modulo:'pruebas',codigo:'JS_ERROR',operacion:'regresion_qa'}),signal:AbortSignal.timeout(20_000)});
assert.equal(registro.status,200);resultados.push('Registro de diagnóstico desde una cita pública validada: PASS');
const salida={fecha:qa.fecha,hora,resultados};
writeFileSync('respaldos/qa-resultado-2026-10-27.json',JSON.stringify(salida,null,2));
console.log(JSON.stringify(salida,null,2));
