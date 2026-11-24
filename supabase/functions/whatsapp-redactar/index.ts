// Edge Function: whatsapp-redactar (exige sesión: verify_jwt activo).
//   { accion: 'revisar', conversacion_id, texto }  → la IA revisa el mensaje que un asesor va a enviar: corrige errores, sugiere una mejor
//        redacción pensando en lo que espera el cliente y avisa de riesgos (normas de la empresa, Habeas Data, arrendamientos, promesas
//        imposibles). Requiere el permiso «whatsapp.responder». NO envía nada.
//   { accion: 'prompt_base', empresa_id }          → devuelve el texto ORIGINAL de reglas e información de la empresa para poder
//        editarlo en Ajustes. Requiere «whatsapp.configurar».
// Secreto de las funciones: ANTHROPIC_API_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { armarPromptFijo } from '../_shared/bot-ia.ts';
import { INFO_EMPRESA, PROMPT_REGLAS } from '../_shared/bot-prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const INSTRUCCIONES_REVISOR = `
═══════════════════════════════
AHORA TU TAREA ES OTRA: ERES EL REVISOR DE MENSAJES DE LOS ASESORES
═══════════════════════════════
Todo lo anterior son las REGLAS y la información de la empresa: úsalas como referencia de lo que se puede y no se puede decir. Ya no
estás atendiendo al cliente: un asesor humano va a enviar un mensaje por WhatsApp y tú lo revisas ANTES de que salga.

Haz esto, en este orden:
1. Corrige ortografía, tildes, puntuación y errores de digitación sin cambiar lo que el asesor quiere decir.
2. Mejora la redacción para que el cliente lo entienda y responda: español colombiano natural, cálido y profesional; frases cortas; lo más
   importante primero; UN solo siguiente paso claro al final (una pregunta o una acción). Sin jerga, sin relleno, sin mayúsculas sostenidas.
3. Piensa en lo que el cliente espera y siente en ese momento de la conversación (duda, ansiedad por el dinero, urgencia, desconfianza,
   emoción por el inmueble) y ajusta el tono: empatía breve y sincera, claridad, transparencia, reconocer su tiempo. Usa principios
   honestos de comunicación (claridad, confianza, reciprocidad, facilitar la decisión). PROHIBIDO manipular: nada de falsa escasez, falsa
   urgencia, presión, culpa ni promesas para cerrar más rápido.
4. Respeta SIEMPRE las normas de la empresa. No cedas en nada que las reglas prohíban o que la ley no permita, aunque el asesor lo haya
   escrito o el cliente lo pida. Revisa en especial:
   - Promesas imposibles o no autorizadas: aprobación de estudios de crédito o de arrendamiento, descuentos, canon o precio no confirmado,
     fechas de entrega o de pago garantizadas, rentabilidades, resultados de ventas, exclusividades.
   - Protección de datos (Ley 1581 de 2012 y Decreto 1377 de 2013): no revelar datos personales de propietarios, arrendatarios u otros
     clientes (teléfono, correo, cédula, dirección exacta, contratos, mora); no pedir datos sensibles ni documentos por el chat si las
     reglas indican otro canal; no pedir contraseñas, claves ni códigos.
   - Arrendamiento de vivienda urbana (Ley 820 de 2003) y normas de propiedad horizontal, publicidad engañosa y protección al
     consumidor: no inducir al error, no pedir cobros o depósitos que la ley no permita, no amenazar ni presionar.
   - Pagos: nunca pedir transferencias a cuentas personales ni por canales distintos a los de la empresa.
   - Asesoría jurídica, tributaria o financiera personalizada: no darla; se remite al canal correspondiente según las reglas.
   - Discriminación, comentarios personales o promesas sobre mascotas, niños, nacionalidad, etc.: no.
   - Hechos que no consten en la conversación o en la información de la empresa: no inventarlos.
5. Si el mensaje ya está bien, dilo: no lo cambies por cambiar (veredicto «ok» y devuelve el texto tal cual, con a lo sumo correcciones menores).

Veredictos:
- «ok»: está bien o solo necesitaba correcciones mínimas.
- «mejorar»: hay una mejor redacción; entrégala completa en texto_sugerido.
- «no_enviar»: el mensaje contiene algo que NO se puede decir (ilegal, contra las normas o riesgoso). En texto_sugerido entrega una versión segura que
  conserve la intención legítima; en alertas explica el problema en lenguaje simple.

Reglas de salida: llama SIEMPRE a la herramienta «revision». texto_sugerido va listo para enviar por WhatsApp (sin comillas ni explicaciones,
sin saludos si la conversación ya está en curso, máximo ~900 caracteres). «cambios» son 1 a 4 frases cortas y concretas que explican qué
mejoraste y por qué, para que el asesor aprenda. «alertas» solo si hay riesgo real. «lo_que_espera_el_cliente» es una frase breve.`;

const HERRAMIENTA = [{
  name: 'revision',
  description: 'Entrega la revisión del mensaje del asesor.',
  input_schema: {
    type: 'object',
    properties: {
      veredicto: { type: 'string', enum: ['ok', 'mejorar', 'no_enviar'] },
      texto_sugerido: { type: 'string' },
      cambios: { type: 'array', items: { type: 'string' } },
      alertas: { type: 'array', items: { type: 'string' } },
      lo_que_espera_el_cliente: { type: 'string' },
    },
    required: ['veredicto', 'texto_sugerido', 'cambios', 'alertas'],
  },
}];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo inválido.' }, 400); }

  const auth = req.headers.get('Authorization') || '';
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!u?.user) return json({ ok: false, error: 'Sesión no válida.' }, 401);
  const yo = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { autoRefreshToken: false, persistSession: false } });

  if (body.accion === 'prompt_base') {
    const empresaId = String(body.empresa_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return json({ ok: false, error: 'Falta la empresa.' }, 400);
    const { data: puede } = await yo.rpc('agenda_tiene_permiso', { p_empresa_id: empresaId, p_permiso: 'whatsapp.configurar' });
    if (puede !== true) return json({ ok: false, error: 'No tienes permiso para ver las reglas del bot.' }, 403);
    return json({ ok: true, reglas: PROMPT_REGLAS, info: INFO_EMPRESA });
  }

  if (body.accion !== 'revisar') return json({ ok: false, error: 'Acción no válida.' }, 400);
  const convId = String(body.conversacion_id || '');
  const texto = String(body.texto || '').trim().slice(0, 4000);
  if (!/^[0-9a-f-]{36}$/i.test(convId) || !texto) return json({ ok: false, error: 'Falta la conversación o el mensaje.' }, 400);

  const { data: conv } = await admin.from('agenda_wa_conversaciones').select('id, empresa_id, nombre, telefono').eq('id', convId).maybeSingle();
  if (!conv) return json({ ok: false, error: 'Conversación no encontrada.' }, 404);
  const { data: puede } = await yo.rpc('agenda_tiene_permiso', { p_empresa_id: conv.empresa_id, p_permiso: 'whatsapp.responder' });
  if (puede !== true) return json({ ok: false, error: 'No tienes permiso para escribir en WhatsApp.' }, 403);

  const clave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!clave) return json({ ok: false, error: 'Falta el secreto ANTHROPIC_API_KEY.' }, 503);

  const { data: cfgWA } = await admin.from('agenda_whatsapp_config').select('*').eq('empresa_id', conv.empresa_id).maybeSingle();
  if (!cfgWA) return json({ ok: false, error: 'Falta configurar WhatsApp.' }, 400);
  const { data: cfgEmp } = await admin.from('agenda_configuracion').select('dominio_publico, empresa:agenda_empresas(slug)').eq('empresa_id', conv.empresa_id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const rel: any = cfgEmp?.empresa;
  const slug: string = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug) || '';
  const dominio = String(cfgEmp?.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');

  const { data: filas } = await admin.from('agenda_wa_mensajes').select('direccion, origen, texto, tipo').eq('conversacion_id', conv.id).neq('tipo', 'evento').order('creado_en', { ascending: false }).limit(14);
  const hilo = (filas || []).reverse().filter((m: { texto: string | null }) => m.texto)
    .map((m: { direccion: string; origen: string; texto: string }) => `${m.direccion === 'entrada' ? 'CLIENTE' : m.origen === 'ia' ? 'ASISTENTE IA' : m.origen === 'asesor' ? 'ASESOR' : 'EMPRESA'}: ${m.texto}`).join('\n');

  const fijo = armarPromptFijo(cfgWA, slug, dominio) + '\n' + INSTRUCCIONES_REVISOR;
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfgWA.modelo || 'claude-haiku-5-5',
        max_tokens: 1500,
        system: [{ type: 'text', text: fijo, cache_control: { type: 'ephemeral' } }],
        tools: HERRAMIENTA,
        tool_choice: { type: 'tool', name: 'revision' },
        messages: [{ role: 'user', content: `CONVERSACIÓN RECIENTE (cliente: ${conv.nombre || 'sin nombre'}):\n${hilo || '(sin mensajes previos)'}\n\n────────\nMENSAJE QUE EL ASESOR QUIERE ENVIAR:\n${texto}` }],
      }),
    });
  } catch (e) {
    return json({ ok: false, error: `No se pudo conectar con la IA: ${e instanceof Error ? e.message : e}` }, 502);
  }
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) return json({ ok: false, error: String(j?.error?.message || `La IA respondió ${resp.status}`) }, 502);
  // deno-lint-ignore no-explicit-any
  const uso = (j.content || []).find((b: any) => b.type === 'tool_use');
  const r = uso?.input;
  if (!r || typeof r.texto_sugerido !== 'string') return json({ ok: false, error: 'La IA no devolvió una revisión.' }, 502);
  const lista = (x: unknown) => (Array.isArray(x) ? x.map((t) => String(t).slice(0, 300)).slice(0, 6) : []);
  return json({
    ok: true,
    veredicto: ['ok', 'mejorar', 'no_enviar'].includes(r.veredicto) ? r.veredicto : 'mejorar',
    texto_sugerido: r.texto_sugerido.slice(0, 4000),
    cambios: lista(r.cambios),
    alertas: lista(r.alertas),
    lo_que_espera_el_cliente: String(r.lo_que_espera_el_cliente || '').slice(0, 300),
  });
});
