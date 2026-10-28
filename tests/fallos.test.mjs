import test from 'node:test';
import assert from 'node:assert/strict';
import { contextoPublico, operacionDeUrl, iniciarRegistroFallos, reportarFalloCliente } from '../aplicacion/js/fallos-cliente.js';
import { tarjetaFallo } from '../aplicacion/js/fallos-presentacion.js';

test('el diagnóstico reduce la URL a una operación y excluye su propia entrada',()=>{
  assert.equal(operacionDeUrl('https://example.test/functions/v1/portal-visita?token=secreto'),'portal-visita');
  assert.equal(operacionDeUrl('https://example.test/functions/v1/registrar-fallo'),null);
  assert.equal(operacionDeUrl('https://example.test/auth/v1/token'),null);
  assert.equal(operacionDeUrl('https://example.test/rest/v1/agenda_citas?cliente_email=privado'),null);
  assert.deepEqual(contextoPublico('/inmuebles/127'),{modulo:'reserva',inmueble:127});
});
test('el cliente registra metadatos y agrupa ráfagas sin capturar datos del error',async()=>{
  const anterior=globalThis.window, recibidos=[], eventos={};
  globalThis.window={location:{pathname:'/inmuebles/127',hostname:'example.test',origin:'https://example.test'},navigator:{onLine:true},addEventListener:(nombre,cb)=>{eventos[nombre]=cb;}};
  try {
    iniciarRegistroFallos({functions:{invoke:async(_,x)=>recibidos.push(x.body)}});
    eventos.error({filename:'https://example.test/assets/app.js',message:'contraseña privada',error:{token:'no copiar'}});
    reportarFalloCliente('JS_ERROR');
    assert.equal(recibidos.length,1);
    assert.deepEqual(recibidos[0],{modulo:'reserva',inmueble:127,host:'example.test',codigo:'JS_ERROR',operacion:'',http_status:null});
    eventos.error({filename:'chrome-extension://extension/script.js',message:'extensión ajena'});
    assert.equal(recibidos.length,1);
  } finally {globalThis.window=anterior;}
});
test('el registro muestra pruebas y seguimiento escapando notas y datos de empresa',()=>{
  const html=tarjetaFallo({id:'f1',codigo:'PORTAL_ERROR',modulo:'portal-visita',empresa_nombre:'<script>empresa</script>',estado:'resuelto',es_prueba:true,repeticiones:3,nivel:'error',ultima_vez:'2026-10-27T23:00:00Z',primera_vez:'2026-10-27T22:00:00Z',historial:[{estado:'resuelto',nota:'<img src=x onerror=alert(1)>',creado_en:'2026-10-27T23:00:00Z'}]},{f1:'</textarea><script>malo</script>'});
  assert.match(html,/Resuelto · Prueba/);assert.match(html,/Repeticiones/);
  assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;img/);assert.match(html,/&lt;\/textarea&gt;/);
});
