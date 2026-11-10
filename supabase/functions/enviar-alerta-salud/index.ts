// Edge Function: enviar-alerta-salud
// Le escribe al propietario de un inmueble «sin movimiento» (semáforo rojo de agenda_salud_inmuebles) para ofrecerle, con tono amable:
// estudio de mercado sin costo, revisar el precio o mejorar fotos y descripción, o bien dejarlo igual / esperar más tiempo.
// La llama la agenda (botón en Configuración > Salud de inmuebles) con la sesión de quien la oprime (JWT, permiso informes.ver).
// Reglas: máximo 10 correos por llamada; nunca repite a un inmueble en 30 días; respeta «seguir igual / esperar» del propietario
// (posponer_hasta) y sus preferencias (frecuencia «ninguna» o sin publicidad); respeta el modo de pruebas de correo.
// Con { simular: true } no envía nada: solo devuelve a quién le tocaría.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { marcaCorreo } from '../_shared/marca-correo.ts';
import { correoBase } from '../_shared/plantilla-correo.ts';
import { preferenciasDe, urlPreferencias } from '../_shared/preferencias-propietario.ts';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MAX_POR_LLAMADA = 10;
const DIAS_ENTRE_AVISOS = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function esc(v: string | null | undefined): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const primerNombre = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || '';
const minus = (s: string | null | undefined) => String(s || '').trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud inválido.' }, 400);
  }
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return json({ ok: false, error: 'Falta autenticación.' }, 401);
  const empresaId = String(body.empresa_id || '');
  if (!empresaId) return json({ ok: false, error: 'Falta la empresa.' }, 400);
  const simular = body.simular === true;
  const soloNumeros = Array.isArray(body.numeros) ? (body.numeros as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: quien, error: errorQuien } = await admin.auth.getUser(jwt);
  if (errorQuien || !quien?.user) return json({ ok: false, error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' }, 401);

  // La salud se lee con la sesión de quien llama: la propia función SQL exige el permiso informes.ver.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: salud, error: errorSalud } = await comoUsuario.rpc('agenda_salud_inmuebles', { p_empresa_id: empresaId, p_dias: 30 });
  if (errorSalud) return json({ ok: false, error: errorSalud.message || 'No tienes permiso para ver los informes.' }, 403);

  // deno-lint-ignore no-explicit-any
  let rojos = ((salud as any[]) || []).filter((f) => f.nivel === 'rojo');
  if (soloNumeros) rojos = rojos.filter((f) => soloNumeros.includes(Number(f.numero_inmueble)));
  if (!rojos.length) return json({ ok: true, enviados: 0, candidatos: [], omitidos: [], mensaje: 'No hay inmuebles sin movimiento para avisar.' });

  const numeros = rojos.map((f) => Number(f.numero_inmueble));
  const [{ data: inmuebles }, { data: propietarios }, { data: previas }] = await Promise.all([
    admin.from('agenda_inmuebles').select('numero_inmueble, barrio, ciudad, tipo_inmueble, tipo_oferta, asesor_comercializacion, token_informe_propietario').eq('empresa_id', empresaId).in('numero_inmueble', numeros),
    admin.from('agenda_propietarios').select('numero_inmueble, nombre, email, principal').eq('empresa_id', empresaId).in('numero_inmueble', numeros).order('principal', { ascending: false }),
    admin.from('agenda_alertas_salud').select('numero_inmueble, enviada_en, posponer_hasta').eq('empresa_id', empresaId).in('numero_inmueble', numeros),
  ]);
  const porInmueble = new Map((inmuebles ?? []).map((i) => [Number(i.numero_inmueble), i]));
  const duenos = new Map<number, { nombre: string; email: string }>();
  for (const p of propietarios ?? []) {
    const n = Number(p.numero_inmueble);
    if (!duenos.has(n) && /\S+@\S+\.\S+/.test(p.email || '')) duenos.set(n, { nombre: p.nombre || '', email: minus(p.email) });
  }
  const ahora = Date.now();
  const bloqueo = new Map<number, string>();
  for (const a of previas ?? []) {
    const n = Number(a.numero_inmueble);
    if (a.posponer_hasta && new Date(a.posponer_hasta).getTime() > ahora) bloqueo.set(n, 'el propietario pidió esperar');
    else if (a.enviada_en && ahora - new Date(a.enviada_en).getTime() < DIAS_ENTRE_AVISOS * 86400000 && !bloqueo.has(n)) bloqueo.set(n, `ya se le avisó hace menos de ${DIAS_ENTRE_AVISOS} días`);
  }
  const prefs = await preferenciasDe(admin, empresaId, [...duenos.values()].map((d) => d.email));

  const omitidos: { numero: number; motivo: string }[] = [];
  // deno-lint-ignore no-explicit-any
  const candidatos: any[] = [];
  for (const f of rojos) {
    const n = Number(f.numero_inmueble);
    const inm = porInmueble.get(n);
    const dueno = duenos.get(n);
    const pref = dueno ? prefs.get(dueno.email) : undefined;
    if (!inm?.token_informe_propietario) omitidos.push({ numero: n, motivo: 'no tiene página de propietario' });
    else if (!dueno) omitidos.push({ numero: n, motivo: 'no tiene correo de propietario' });
    else if (bloqueo.has(n)) omitidos.push({ numero: n, motivo: bloqueo.get(n)! });
    else if (pref && (pref.frecuencia === 'ninguna' || pref.publicidad === false)) omitidos.push({ numero: n, motivo: 'el propietario pidió no recibir avisos' });
    else candidatos.push({ f, inm, dueno, pref });
  }
  const aEnviar = candidatos.slice(0, MAX_POR_LLAMADA);
  const resumenCand = aEnviar.map((c) => ({ numero: Number(c.f.numero_inmueble), tipo: c.inm.tipo_inmueble, barrio: c.inm.barrio }));
  if (simular) return json({ ok: true, simulacion: true, candidatos: resumenCand, pendientes_para_otra_vez: Math.max(0, candidatos.length - aEnviar.length), omitidos });
  if (!aEnviar.length) return json({ ok: true, enviados: 0, candidatos: [], omitidos, mensaje: 'Ningún inmueble cumple las condiciones para avisar hoy.' });

  const { data: config } = await admin
    .from('agenda_configuracion')
    .select('nombre_comercial, correo_remitente_nombre, correo_remitente_email, correo_smtp_host, correo_smtp_puerto, correo_smtp_seguridad, correo_smtp_usuario, correo_modo_pruebas, correo_pruebas_destino, imagen_correo_url, logo_url, color_principal, color_accion, contacto_empresa, correo_contacto, telefono, dominio_publico, empresa:agenda_empresas(slug)')
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (!config?.correo_smtp_host || !config.correo_remitente_email) return json({ ok: false, error: 'El correo de la empresa no está configurado (Administración → Correo).' }, 400);
  const { data: password } = await admin.rpc('agenda_obtener_password_correo', { p_empresa_id: empresaId });
  if (!password) return json({ ok: false, error: 'Falta guardar la contraseña SMTP del correo de la empresa.' }, 400);

  const marca = marcaCorreo(config);
  const modoPruebas = config.correo_modo_pruebas !== false;
  const remitente = config.correo_remitente_nombre || config.nombre_comercial || 'Agenda de citas';
  const dominio = String(config.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const transporte = nodemailer.createTransport({
    host: config.correo_smtp_host,
    port: config.correo_smtp_puerto || 587,
    secure: config.correo_smtp_seguridad === 'ssl',
    auth: { user: config.correo_smtp_usuario || config.correo_remitente_email, pass: password as string },
  });

  let enviados = 0;
  const fallidos: { numero: number; error: string }[] = [];
  for (const c of aEnviar) {
    const n = Number(c.f.numero_inmueble);
    const inm = c.inm;
    const nombre = primerNombre(c.dueno.nombre);
    const tipo = String(inm.tipo_inmueble || 'inmueble').toLowerCase();
    const barrio = String(inm.barrio || inm.ciudad || '').trim();
    const donde = barrio ? ` en ${barrio}` : '';
    const oferta = String(inm.tipo_oferta || '').toLowerCase().includes('venta') ? 'venta' : 'arriendo';
    const dias = Number(c.f.dias_en_sistema) || 30;
    const base = `https://${dominio}/propietario/${inm.token_informe_propietario}`;
    const asesor = String(inm.asesor_comercializacion || '').trim();
    const urlPrefs = c.pref ? urlPreferencias(config, c.pref.token) : '';
    const asunto = nombre ? `${nombre}, ¿cómo vamos con tu inmueble?` : '¿Cómo vamos con tu inmueble?';

    const cuerpo =
      `<p style="margin:0 0 14px">Hola${nombre ? ' ' + esc(nombre) : ''},</p>` +
      `<p style="margin:0 0 14px">Tu ${esc(tipo)}${esc(donde)} (inmueble ${n}) lleva ${dias} días con nosotros en ${oferta}, y en los últimos 30 días aún no ha recibido visitas. Preferimos contártelo con transparencia: a veces pasa y casi siempre tiene solución.</p>` +
      `<p style="margin:0 0 14px">Las causas más comunes son el precio frente al mercado o las fotos y la descripción. Por eso preparamos tres opciones. No tienes que hacer nada urgente: eliges lo que te convenga desde tu página personal, y nada cambia sin tu autorización.</p>` +
      (oferta === 'venta' ? `<p style="margin:0 0 14px">Si es venta, también puedes considerar arrendarlo mientras se vende: genera ingresos y mantiene el inmueble cuidado.</p>` : '') +
      (asesor ? `<p style="margin:0">${esc(asesor)} está disponible para acompañarte.</p>` : '');

    const despues =
      `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#63707a">El estudio de mercado es sin costo y sin compromiso. Revisar el precio es solo una opción: tú decides si lo ajustamos, y nada cambia sin tu permiso.</p>` +
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6"><strong>¿Prefieres dejarlo como está?</strong> Está bien. Dinos si quieres que <a href="${esc(base)}?accion=seguir" style="color:${marca.principal};text-decoration:underline">sigamos igual</a> o que <a href="${esc(base)}?accion=esperar" style="color:${marca.principal};text-decoration:underline">esperemos un mes más</a>, y no te escribimos de este tema por un buen tiempo.</p>` +
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">Gracias por confiarnos tu inmueble. Si prefieres hablar, responde este correo${asesor ? ` o escríbele a ${esc(asesor)}` : ''}: lo hacemos como te quede mejor.</p>` +
      `<p style="margin:0;font-size:12px;line-height:1.5;color:#63707a">Recibes este aviso porque eres propietario de un inmueble con nosotros. Si no deseas recibir este tipo de avisos, ${urlPrefs ? `<a href="${esc(urlPrefs)}" style="color:#63707a;text-decoration:underline">avísanos aquí</a>` : 'avísanos'} o responde este correo, y atenderemos tu solicitud conforme a la Ley 1581 de 2012 sobre protección de datos personales.</p>`;

    const html = correoBase(marca, {
      titulo: `Tu ${tipo}${donde} merece más miradas`,
      tema: 'informe',
      preheader: 'Revisemos juntos cómo mejorar su visibilidad. Tú decides.',
      cuerpo,
      botones: [
        { texto: 'Pedir estudio de mercado', url: `${base}?accion=estudio`, variante: 'principal' },
        { texto: 'Revisar el precio', url: `${base}?accion=precio`, variante: 'contorno' },
        { texto: 'Mejorar fotos y descripción', url: `${base}?accion=fotos`, variante: 'contorno' },
      ],
      despues,
      modoPruebas,
      destinatarioReal: c.dueno.email,
    });

    const destino = modoPruebas ? config.correo_pruebas_destino || c.dueno.email : c.dueno.email;
    try {
      await transporte.sendMail({ from: `${remitente} <${config.correo_remitente_email}>`, to: destino, subject: asunto, html });
      await admin.from('agenda_alertas_salud').insert({ empresa_id: empresaId, numero_inmueble: n, nivel: 'rojo', visitas: Number(c.f.visitas) || 0, modo_pruebas: modoPruebas });
      await admin.from('agenda_correos_log').insert({
        empresa_id: empresaId, cita_id: null, destinatario_tipo: 'propietario', destinatario_email: destino, asunto,
        estado: 'enviado', detalle_error: 'alerta-salud:' + n, modo_pruebas: modoPruebas,
      });
      enviados++;
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      fallidos.push({ numero: n, error: detalle });
      try {
        await admin.from('agenda_correos_log').insert({
          empresa_id: empresaId, cita_id: null, destinatario_tipo: 'propietario', destinatario_email: destino, asunto,
          estado: 'fallido', detalle_error: detalle, modo_pruebas: modoPruebas,
        });
      } catch { /* sin más */ }
    }
  }
  return json({ ok: true, modo_pruebas: modoPruebas, enviados, fallidos, omitidos, pendientes_para_otra_vez: Math.max(0, candidatos.length - aEnviar.length) });
});
