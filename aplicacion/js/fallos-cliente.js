// Solo metadatos técnicos. No se copian mensajes, formularios, cabeceras ni URLs con credenciales.
let cliente = null;
const recientes = new Map(), pendientes = [];
const fetchOriginal = globalThis.fetch?.bind(globalThis);
export function contextoPublico(pathname = '') {
  const visita = pathname.match(/^\/(visita|arrendatario)\/([0-9a-f-]{36})(?:\/|$)/i);
  if (visita) return {modulo:visita[1],token:visita[2]};
  const inmueble = pathname.match(/^\/inmuebles\/(\d+)\/?$/);
  if (inmueble) return {modulo:'reserva',inmueble:Number(inmueble[1])};
  return {modulo:pathname==='/soporte'?'soporte':'agenda'};
}
export function operacionDeUrl(valor) {
  try {
    const u=new URL(valor,'https://local.invalid');
    const m=u.pathname.match(/^\/(?:rest\/v1\/rpc|functions\/v1)\/([a-z0-9_-]+)$/);
    if(m && m[1]!=='registrar-fallo') return m[1];
  } catch { /* no enviar la URL */ }
  return null;
}
function enviar(evento) {
  if(cliente) Promise.resolve(cliente.functions.invoke('registrar-fallo',{body:evento})).catch(()=>{});
}
export function reportarFalloCliente(codigo,operacion='',httpStatus=null) {
  if(typeof window==='undefined') return;
  const contexto=contextoPublico(window.location.pathname);
  if(contexto.inmueble) contexto.host=window.location.hostname;
  const evento={...contexto,codigo,operacion,http_status:httpStatus};
  const firma=JSON.stringify([contexto.modulo,codigo,operacion,httpStatus]);
  if(Date.now()-(recientes.get(firma)||0)<60_000) return;
  recientes.set(firma,Date.now());
  if(recientes.size>100) recientes.delete(recientes.keys().next().value);
  if(window.navigator.onLine===false) { if(pendientes.length<10) pendientes.push(evento);return; }
  enviar(evento);
}
export async function fetchVigilado(input,init) {
  const operacion=operacionDeUrl(typeof input==='string'?input:input?.url);
  try {
    const r=await fetchOriginal(input,init);
    // Los rechazos del portal se registran en el servidor con su contexto de empresa y prueba.
    if(operacion && operacion!=='portal-visita' && (r.status>=500||r.status===429)) reportarFalloCliente('HTTP_ERROR',operacion,r.status);
    return r;
  } catch(e) { if(operacion) reportarFalloCliente('RED_NO_DISPONIBLE',operacion);throw e; }
}
export function iniciarRegistroFallos(supabase) {
  cliente=supabase;
  if(!cliente||typeof window==='undefined') return;
  window.addEventListener('error',e=>{
    if(e.filename && !e.filename.startsWith(window.location.origin)) return;
    reportarFalloCliente('JS_ERROR');
  });
  window.addEventListener('unhandledrejection',()=>reportarFalloCliente('JS_PROMESA_RECHAZADA'));
  window.addEventListener('online',()=>pendientes.splice(0).forEach(enviar));
}
