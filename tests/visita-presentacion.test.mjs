import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoVisita, resumenVisita } from '../aplicacion/js/visita-presentacion.js';
import { correoVisita } from '../supabase/functions/_shared/visita-correo.ts';
import { marcaCorreo } from '../supabase/functions/_shared/marca-correo.ts';

test('un horario liberado no se presenta como una visita confirmada, aunque la BD conserve confirmada', () => {
  const e=estadoVisita({cita:{estado:'confirmada',vigente:true},reubicacion:true});
  assert.equal(e.titulo,'Elige una nueva hora'); assert.equal(e.anterior,true);
  const html=resumenVisita({estado:e,numero:127,fecha:'jueves 29',hora:'9:00'});
  assert.match(html,/Horario anterior/); assert.doesNotMatch(html,/Visita confirmada/);
});
test('una propuesta del cliente conserva la hora vigente, una cancelada tiene precedencia', () => {
  assert.equal(estadoVisita({propuesta:{propuesta_por_mi:true}}).anterior,false);
  assert.equal(estadoVisita({propuesta:{propuesta_por_mi:true}}).titulo,'Propuesta enviada');
  assert.equal(estadoVisita({cita:{estado:'cancelada'},reubicacion:true}).titulo,'Visita cancelada');
  assert.equal(estadoVisita().titulo,'Visita confirmada');
});
test('el resumen escapa datos del inmueble y el correo conserva marca y destinatario de pruebas', () => {
  assert.match(resumenVisita({estado:estadoVisita(),direccion:'<script>',numero:2}),/&lt;script&gt;/);
  const html=correoVisita(marcaCorreo({nombre_comercial:'Otra empresa',color_accion:'#123456'}),{titulo:'Confirma <hora>',cuerpo:'Datos',boton:{texto:'Elegir hora',url:'https://example.test/visita/abc'},modoPruebas:true,destinatarioReal:'prueba@example.test'});
  assert.match(html,/Otra empresa/); assert.match(html,/prueba@example.test/);
  assert.match(html,/Confirma &lt;hora&gt;/); assert.match(html,/#123456/);
  assert.doesNotMatch(html,/foto-visita/); assert.equal((html.match(/Elegir hora/g)||[]).length,1);
});
