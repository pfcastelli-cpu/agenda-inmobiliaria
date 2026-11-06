// Edge Function: recordar-arrendatario
// La llama una tarea programada (pg_cron, cada hora; ver el bloque final de sql/048) con el encabezado `x-cron-secreto`
// (el mismo secreto de las encuestas: CRON_ENCUESTAS_SECRETO). verify_jwt = false: la credencial es el secreto.
// Busca visitas a inmuebles arrendados que empiezan dentro de las próximas 24 horas (y faltan 2 horas o más), cuyo
// arrendatario fue avisado hace 3 horas o más y NO ha pulsado «Confirmo que estaré», y le manda UN recordatorio.
// El correo, el modo de pruebas (correo_modo_pruebas), la bitácora (agenda_correos_log) y la marca anti-duplicado
// (agenda_citas.arrendatario_recordado_en) los resuelve avisar-arrendatario con { recordatorio: true }.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRETO = Deno.env.get('CRON_ENCUESTAS_SECRETO') || '';
const MAX_POR_CORRIDA = 30;
const HORAS_ANTES = 24; // se recuerda cuando faltan menos de estas horas
const HORAS_MINIMAS = 2; // si faltan menos, ya no sirve de nada recordar
const HORAS_DESDE_AVISO = 3; // no se recuerda a quien acaba de recibir el aviso

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

// Hora de Bogotá como «reloj de pared» (la base guarda fecha y hora locales sin zona).
function ahoraBogota() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' });
  return { fecha: s.slice(0, 10), pared: Date.parse(s.replace(' ', 'T') + 'Z') };
}
function mas(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
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

  const { data: citas, error } = await admin
    .from('agenda_citas')
    .select('id, fecha, hora_inicio, arrendatario_avisado_en, inmueble_id')
    .eq('tipo_cita', 'visita_cliente')
    .eq('estado', 'confirmada')
    .eq('es_prueba', false)
    .is('reubicacion_pendiente_desde', null)
    .is('arrendatario_confirmado_en', null)
    .is('arrendatario_recordado_en', null)
    .not('arrendatario_avisado_en', 'is', null)
    .not('inmueble_id', 'is', null)
    .gte('fecha', ahora.fecha)
    .lte('fecha', mas(ahora.fecha, 1))
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });
  if (error) return json({ ok: false, error: 'No se pudieron leer las visitas.' }, 500);

  const candidatas = (citas || []).filter((c) => {
    const faltaMs = Date.parse(`${c.fecha}T${c.hora_inicio.slice(0, 5)}:00Z`) - ahora.pared;
    const desdeAvisoMs = Date.now() - new Date(c.arrendatario_avisado_en).getTime();
    return faltaMs <= HORAS_ANTES * 3600_000 && faltaMs >= HORAS_MINIMAS * 3600_000 && desdeAvisoMs >= HORAS_DESDE_AVISO * 3600_000;
  });
  if (!candidatas.length) return json({ ok: true, enviados: 0, omitidos: 0 });

  // Las que ya tuvieron recordatorio (enviado u omitido por no haber correo) o fallaron 3 veces no se reintentan.
  const ids = candidatas.map((c) => c.id);
  const { data: logs } = await admin
    .from('agenda_correos_log')
    .select('cita_id, estado')
    .eq('destinatario_tipo', 'arrendatario')
    .like('asunto', 'Recordatorio:%')
    .in('cita_id', ids);
  const cerradas = new Set<string>();
  const fallos = new Map<string, number>();
  for (const l of logs || []) {
    if (l.estado === 'fallido') fallos.set(l.cita_id, (fallos.get(l.cita_id) || 0) + 1);
    else cerradas.add(l.cita_id);
  }
  const porEnviar = candidatas.filter((c) => !cerradas.has(c.id) && (fallos.get(c.id) || 0) < 3).slice(0, MAX_POR_CORRIDA);

  let enviados = 0;
  let omitidos = 0;
  for (const c of porEnviar) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/avisar-arrendatario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
        body: JSON.stringify({ cita_id: c.id, recordatorio: true }),
        signal: AbortSignal.timeout(20000),
      });
      const cuerpo = await r.json().catch(() => ({}));
      if (cuerpo?.enviado) enviados++;
      else omitidos++;
    } catch (e) {
      console.error('recordar-arrendatario', c.id, e instanceof Error ? e.message : e);
      omitidos++;
    }
  }
  return json({ ok: true, enviados, omitidos });
});
