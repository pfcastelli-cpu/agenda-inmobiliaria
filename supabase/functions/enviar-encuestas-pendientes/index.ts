// Edge Function: enviar-encuestas-pendientes
// La llama una tarea programada (pg_cron, cada 10 minutos; ver sql/018) con el encabezado `x-cron-secreto`.
// Manda la encuesta al cliente de las visitas cuya hora de fin + `encuesta_minutos_despues` (Configuración de cada
// empresa) ya pasó. Solo mira las visitas de hoy y de ayer, y cada visita recibe su encuesta una sola vez
// (enviar-encuesta-cliente no repite si ya hay un envío registrado). verify_jwt = false: la credencial es el secreto.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';
const MAX_POR_CORRIDA = 40; // tope por corrida (el cron corre cada 10 minutos); si hay más, salen en las corridas siguientes
const EN_PARALELO = 4; // correos enviados a la vez (cada uno tarda unos 2-4 s)

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

// Fecha y hora actuales de Bogotá como «reloj de pared» (la base guarda fecha y hora locales sin zona).
function ahoraBogota() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }); // 2026-10-26 15:04:09
  return { fecha: s.slice(0, 10), hora: s.slice(11, 16), pared: Date.parse(s.replace(' ', 'T') + 'Z') };
}
function ayerDe(fecha: string) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const dado = req.headers.get('x-cron-secreto') || '';
  if (!CRON_SECRETO || dado.length !== CRON_SECRETO.length || dado !== CRON_SECRETO) {
    return json({ ok: false, error: 'No autorizado.' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const ahora = ahoraBogota();

  const { data: configs, error: errConfig } = await admin
    .from('agenda_configuracion')
    .select('empresa_id, encuesta_automatica, encuesta_minutos_despues')
    .eq('encuesta_automatica', true);
  if (errConfig) return json({ ok: false, error: 'No se pudo leer la configuración.' }, 500);

  const enviadas: string[] = [];
  const omitidas: string[] = [];
  let restantes = MAX_POR_CORRIDA;

  for (const cfg of configs || []) {
    if (restantes <= 0) break;
    const minutos = Number(cfg.encuesta_minutos_despues ?? 30);
    const { data: citas } = await admin
      .from('agenda_citas')
      .select('id, fecha, hora_fin')
      .eq('empresa_id', cfg.empresa_id)
      .eq('tipo_cita', 'visita_cliente')
      .in('estado', ['confirmada', 'completada'])
      .not('cliente_email', 'is', null)
      .gte('fecha', ayerDe(ahora.fecha))
      .lte('fecha', ahora.fecha)
      .order('fecha', { ascending: true })
      .order('hora_fin', { ascending: true });
    const vencidas = (citas || []).filter((c) => {
      const fin = Date.parse(`${c.fecha}T${c.hora_fin.slice(0, 5)}:00Z`);
      return fin + minutos * 60_000 <= ahora.pared;
    });
    if (!vencidas.length) continue;

    // Las que ya recibieron su encuesta (marca `enviada_en`) no se vuelven a procesar; las que fallaron 3 veces tampoco (se ven en la bitácora de correos).
    const ids = vencidas.map((c) => c.id);
    const { data: marcadas } = await admin.from('agenda_encuestas_cliente').select('cita_id').in('cita_id', ids).not('enviada_en', 'is', null);
    const hechas = new Set<string>((marcadas || []).map((e) => e.cita_id));
    const { data: intentos } = await admin.from('agenda_correos_log').select('cita_id').eq('destinatario_tipo', 'encuesta_cliente').neq('estado', 'enviado').in('cita_id', ids);
    const fallos = new Map<string, number>();
    for (const l of intentos || []) fallos.set(l.cita_id, (fallos.get(l.cita_id) || 0) + 1);

    const porEnviar = vencidas.filter((c) => !hechas.has(c.id) && (fallos.get(c.id) || 0) < 3).slice(0, Math.max(0, restantes));
    restantes -= porEnviar.length;
    for (let i = 0; i < porEnviar.length; i += EN_PARALELO) {
      await Promise.all(porEnviar.slice(i, i + EN_PARALELO).map(async (c) => {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/enviar-encuesta-cliente`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
            body: JSON.stringify({ cita_id: c.id }),
            signal: AbortSignal.timeout(20000),
          });
          const cuerpo = await r.json().catch(() => ({}));
          (cuerpo?.enviado ? enviadas : omitidas).push(c.id);
        } catch (e) {
          console.error('enviar-encuestas-pendientes', c.id, e instanceof Error ? e.message : e);
          omitidas.push(c.id);
        }
      }));
    }
  }

  // De paso: avisos de encuestas ya contestadas cuyo correo no salió (respaldo de la llamada inmediata de la página).
  let avisos = 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/avisar-encuesta-respondida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secreto': CRON_SECRETO, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
      body: JSON.stringify({ tarea: 'barrido' }),
      signal: AbortSignal.timeout(25000),
    });
    avisos = (await r.json().catch(() => ({})))?.enviados ?? 0;
  } catch (e) {
    console.error('enviar-encuestas-pendientes barrido', e instanceof Error ? e.message : e);
  }
  return json({ ok: true, enviadas: enviadas.length, omitidas: omitidas.length, avisos });
});
