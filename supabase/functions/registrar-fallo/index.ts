import { createClient } from 'jsr:@supabase/supabase-js@2';
import { registrarFallo } from '../_shared/fallos.ts';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info' };
const respuesta = (status: number) => new Response(JSON.stringify({ok:status===200}), {status,headers:{...cors,'Content-Type':'application/json'}});
const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if (req.method!=='POST') return respuesta(405);
  if (Number(req.headers.get('content-length')||0)>2048) return respuesta(413);
  let b: Record<string,any>;
  try { const text=await req.text(); if(text.length>2048) return respuesta(413); b=JSON.parse(text); } catch { return respuesta(400); }
  if (!['JS_ERROR','JS_PROMESA_RECHAZADA','RED_NO_DISPONIBLE','HTTP_ERROR'].includes(b.codigo)
      || !/^[a-z0-9_-]{1,60}$/.test(b.modulo||'') || !/^[a-z0-9_-]{0,80}$/.test(b.operacion||'')
      || (b.http_status!=null && (!Number.isInteger(b.http_status)||b.http_status<400||b.http_status>599))) return respuesta(400);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let empresaId: string | null=null; let prueba=false;
  // El servidor deriva la empresa. Nunca confía en empresa_id enviado por el navegador.
  if (/^[0-9a-f-]{36}$/i.test(b.token||'')) {
    const {data:c}=await admin.from('agenda_citas').select('empresa_id,es_prueba')
      .or(`token_cliente.eq.${b.token},token_arrendatario.eq.${b.token}`).maybeSingle();
    empresaId=c?.empresa_id; prueba=c?.es_prueba===true;
    if(!empresaId) {
      const {data:i}=await admin.from('agenda_inmuebles').select('empresa_id').eq('token_arrendatario',b.token).maybeSingle();
      empresaId=i?.empresa_id;
    }
  } else if (Number.isInteger(b.inmueble) && b.inmueble>0 && /^[a-z0-9.-]{1,253}$/.test(b.host||'')) {
    const {data:empresa}=await admin.rpc('agenda_resolver_empresa_publica',{p_empresa_slug:null,p_host:b.host});
    if(empresa) {
      const {data:i}=await admin.from('agenda_inmuebles').select('empresa_id').eq('empresa_id',empresa).eq('numero_inmueble',b.inmueble).maybeSingle();
      empresaId=i?.empresa_id;
    }
  } else {
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    const {data:u}=await admin.auth.getUser(jwt);
    if(u?.user) {
      const {data:m}=await admin.from('agenda_miembros').select('empresa_id').eq('usuario_id',u.user.id).eq('activo',true).limit(1).maybeSingle();
      empresaId=m?.empresa_id;
    }
  }
  if(!empresaId) return respuesta(403);
  await registrarFallo(admin,{empresaId,modulo:b.modulo,codigo:b.codigo,operacion:b.operacion,
    httpStatus:b.http_status,esPrueba:prueba,nivel:b.http_status && b.http_status<500 ? 'aviso':'error'});
  return respuesta(200);
});
