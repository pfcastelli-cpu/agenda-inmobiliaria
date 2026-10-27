// Edge Function: crear-videollamada
// Crea (o cancela) la reunión virtual de una cita en Google Meet, Microsoft Teams o Zoom, según
// agenda_configuracion.videollamada_proveedor ('manual' | 'google_meet' | 'microsoft_teams' | 'zoom').
// Se despliega CON JWT (es decir, SIN --no-verify-jwt); además la función valida a mano que quien llama
// sea miembro activo de la empresa (como filtrar-opiniones). El correo al cliente lo envía otra función:
// aquí NUNCA se agregan asistentes al evento.
//
// Cuerpos admitidos (POST):
//   { cita_id }                    → crea la videollamada y guarda enlace_virtual, proveedor_virtual, virtual_evento_id.
//   { probar:true, empresa_id }    → botón «Probar» de Configuración (solo administrador): crea una reunión de prueba y la cancela.
//   { cancelar:true, cita_id }     → borra el evento en el proveedor (mejor esfuerzo) y limpia enlace_virtual/virtual_evento_id.
//
// Credenciales: JSON guardado en Vault, que llega por agenda_obtener_credenciales_videollamada (solo service_role).
// Nunca se devuelven al navegador ni se escriben en logs. Campos por proveedor:
//   google_meet     → { client_email, private_key, usuario_organizador }
//                     Cuenta de servicio con delegación en todo el dominio y el alcance
//                     https://www.googleapis.com/auth/calendar.events; usuario_organizador es el correo que será dueño de los eventos.
//   microsoft_teams → { tenant_id, client_id, client_secret, usuario_organizador }
//                     App registrada en Entra ID con permiso de aplicación Calendars.ReadWrite (con consentimiento del administrador);
//                     usuario_organizador es el UPN (correo) o el id del usuario dueño de los eventos.
//   zoom            → { account_id, client_id, client_secret }
//                     App «Server-to-Server OAuth» con los permisos meeting:write:meeting y meeting:delete:meeting (o los equivalentes admin).
// Para añadir otro proveedor (Webex, Jitsi, etc.) basta con agregar una entrada al mapa PROVEEDORES.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TIMEOUT_MS = 15000;
const ZONA_COLOMBIA = 'America/Bogota'; // UTC-5 todo el año, sin horario de verano
const ZONA_WINDOWS = 'SA Pacific Standard Time'; // la misma zona, nombre de Windows (Microsoft Graph)
const DURACION_POR_DEFECTO_MIN = 30;
const MAX_TITULO = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

// Error con mensaje seguro para mostrar a la persona (en español, sin secretos).
class ErrorUsuario extends Error {
  status: number;
  constructor(mensaje: string, status = 400) {
    super(mensaje);
    this.status = status;
  }
}

type Admin = ReturnType<typeof createClient>;
type Credenciales = Record<string, string>;

interface DatosReunion {
  titulo: string;
  fecha: string; // YYYY-MM-DD (hora de Colombia)
  inicio: string; // HH:mm:ss (hora de Colombia)
  fin: string; // HH:mm:ss, mismo día
  duracionMin: number;
}

interface Proveedor {
  crear(datos: DatosReunion): Promise<{ enlace: string; eventoId: string }>;
  cancelar(eventoId: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------
function recortar(texto: string, max = 200): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, max);
}

interface Respuesta {
  status: number;
  ok: boolean;
  texto: string;
  json: any;
}

async function pedir(url: string, init: RequestInit = {}): Promise<Respuesta> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ErrorUsuario(timeout ? 'El proveedor de videollamadas tardó demasiado en responder.' : 'No se pudo conectar con el proveedor de videollamadas.', 502);
  }
  const texto = await r.text();
  let datos: any = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  return { status: r.status, ok: r.ok, texto, json: datos };
}

// Arma un error legible a partir de una respuesta fallida (sin volcar la respuesta cruda completa).
function errorProveedor(nombre: string, paso: string, r: Respuesta): ErrorUsuario {
  const detalle = recortar(
    String(r.json?.error_description ?? r.json?.error?.message ?? r.json?.message ?? (typeof r.json?.error === 'string' ? r.json.error : '') ?? '') || r.texto,
  );
  const sugerencia =
    r.status === 401 || r.status === 403 || /invalid_client|unauthorized_client|invalid_grant|invalid_request|AADSTS/i.test(detalle)
      ? ' Revisa las credenciales y los permisos de la aplicación.'
      : '';
  return new ErrorUsuario(`${nombre} rechazó la solicitud (${paso}, código ${r.status}): ${detalle || 'sin detalle'}.${sugerencia}`, 502);
}

function exigirCampos(nombre: string, cred: Credenciales, campos: string[]) {
  const faltan = campos.filter((c) => typeof cred[c] !== 'string' || !cred[c].trim());
  if (faltan.length) throw new ErrorUsuario(`Faltan datos en las credenciales de ${nombre}: ${faltan.join(', ')}.`);
}

function base64url(datos: Uint8Array | string): string {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Firma un JWT RS256 con una llave privada PEM (PKCS#8) usando crypto.subtle.
async function firmarJwtRS256(claims: Record<string, unknown>, llavePem: string): Promise<string> {
  // Algunas veces la llave llega con "\n" literales (dos caracteres) en vez de saltos de línea.
  const pem = llavePem.replace(/\\n/g, '\n');
  const cuerpoPem = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  let llave: CryptoKey;
  try {
    const der = Uint8Array.from(atob(cuerpoPem), (c) => c.charCodeAt(0));
    llave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new ErrorUsuario('La llave privada (private_key) de Google no tiene un formato válido. Pega el JSON de la cuenta de servicio completo.');
  }
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const carga = base64url(JSON.stringify(claims));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(`${cabecera}.${carga}`));
  return `${cabecera}.${carga}.${base64url(new Uint8Array(firma))}`;
}

// ---------------------------------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------------------------------
function proveedorGoogleMeet(cred: Credenciales): Proveedor {
  exigirCampos('Google Meet', cred, ['client_email', 'private_key', 'usuario_organizador']);

  async function token(): Promise<string> {
    const ahora = Math.floor(Date.now() / 1000);
    const jwt = await firmarJwtRS256(
      {
        iss: cred.client_email.trim(),
        sub: cred.usuario_organizador.trim(),
        scope: 'https://www.googleapis.com/auth/calendar.events',
        aud: 'https://oauth2.googleapis.com/token',
        iat: ahora,
        exp: ahora + 3300,
      },
      cred.private_key,
    );
    const r = await pedir('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    const t = r.json?.access_token;
    if (!r.ok || typeof t !== 'string') {
      const extra = /unauthorized_client/i.test(r.texto)
        ? ' Falta autorizar la delegación en todo el dominio para ese client_id con el alcance calendar.events.'
        : '';
      throw new ErrorUsuario(`${errorProveedor('Google', 'obtener token', r).message}${extra}`, 502);
    }
    return t;
  }

  return {
    async crear(d) {
      const t = await token();
      const r = await pedir('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: d.titulo,
          start: { dateTime: `${d.fecha}T${d.inicio}`, timeZone: ZONA_COLOMBIA },
          end: { dateTime: `${d.fecha}T${d.fin}`, timeZone: ZONA_COLOMBIA },
          conferenceData: {
            createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
          },
        }),
      });
      if (!r.ok) throw errorProveedor('Google Calendar', 'crear evento', r);
      const eventoId = String(r.json?.id ?? '');
      const enlace: string =
        r.json?.hangoutLink ??
        (r.json?.conferenceData?.entryPoints ?? []).find((p: any) => p?.entryPointType === 'video')?.uri ??
        '';
      if (!eventoId) throw new ErrorUsuario('Google no devolvió el identificador del evento.', 502);
      if (!enlace) {
        // El evento se creó pero Meet no entregó enlace: se limpia para no dejar eventos huérfanos.
        await this.cancelar(eventoId).catch(() => {});
        throw new ErrorUsuario('Google creó el evento pero no generó el enlace de Meet. Revisa que la cuenta organizadora tenga Meet habilitado.', 502);
      }
      return { enlace, eventoId };
    },
    async cancelar(eventoId) {
      const t = await token();
      const r = await pedir(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventoId)}?sendUpdates=none`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!r.ok && r.status !== 404 && r.status !== 410) throw errorProveedor('Google Calendar', 'cancelar evento', r);
    },
  };
}

function proveedorTeams(cred: Credenciales): Proveedor {
  exigirCampos('Microsoft Teams', cred, ['tenant_id', 'client_id', 'client_secret', 'usuario_organizador']);
  const usuario = encodeURIComponent(cred.usuario_organizador.trim());

  async function token(): Promise<string> {
    const r = await pedir(`https://login.microsoftonline.com/${encodeURIComponent(cred.tenant_id.trim())}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cred.client_id.trim(),
        client_secret: cred.client_secret,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    });
    const t = r.json?.access_token;
    if (!r.ok || typeof t !== 'string') throw errorProveedor('Microsoft', 'obtener token', r);
    return t;
  }

  return {
    async crear(d) {
      const t = await token();
      const r = await pedir(`https://graph.microsoft.com/v1.0/users/${usuario}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: d.titulo,
          start: { dateTime: `${d.fecha}T${d.inicio}`, timeZone: ZONA_WINDOWS },
          end: { dateTime: `${d.fecha}T${d.fin}`, timeZone: ZONA_WINDOWS },
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        }),
      });
      if (!r.ok) {
        const extra = r.status === 403 ? ' La aplicación necesita el permiso de aplicación Calendars.ReadWrite con consentimiento del administrador.' : '';
        throw new ErrorUsuario(`${errorProveedor('Microsoft Graph', 'crear evento', r).message}${extra}`, 502);
      }
      const eventoId = String(r.json?.id ?? '');
      const enlace = String(r.json?.onlineMeeting?.joinUrl ?? '');
      if (!eventoId) throw new ErrorUsuario('Microsoft no devolvió el identificador del evento.', 502);
      if (!enlace) {
        await this.cancelar(eventoId).catch(() => {});
        throw new ErrorUsuario('Microsoft creó el evento pero no generó el enlace de Teams. Revisa que el organizador tenga licencia de Teams.', 502);
      }
      return { enlace, eventoId };
    },
    async cancelar(eventoId) {
      const t = await token();
      const r = await pedir(`https://graph.microsoft.com/v1.0/users/${usuario}/events/${encodeURIComponent(eventoId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!r.ok && r.status !== 404) throw errorProveedor('Microsoft Graph', 'cancelar evento', r);
    },
  };
}

function proveedorZoom(cred: Credenciales): Proveedor {
  exigirCampos('Zoom', cred, ['account_id', 'client_id', 'client_secret']);

  async function token(): Promise<string> {
    const basico = btoa(`${cred.client_id.trim()}:${cred.client_secret}`);
    const r = await pedir(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cred.account_id.trim())}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basico}` },
    });
    const t = r.json?.access_token;
    if (!r.ok || typeof t !== 'string') throw errorProveedor('Zoom', 'obtener token', r);
    return t;
  }

  return {
    async crear(d) {
      const t = await token();
      const r = await pedir('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: d.titulo,
          type: 2,
          start_time: `${d.fecha}T${d.inicio}`,
          timezone: ZONA_COLOMBIA,
          duration: d.duracionMin,
          settings: { join_before_host: true },
        }),
      });
      if (!r.ok) throw errorProveedor('Zoom', 'crear reunión', r);
      const eventoId = r.json?.id != null ? String(r.json.id) : '';
      const enlace = String(r.json?.join_url ?? '');
      if (!eventoId || !enlace) throw new ErrorUsuario('Zoom no devolvió el enlace o el identificador de la reunión.', 502);
      return { enlace, eventoId };
    },
    async cancelar(eventoId) {
      const t = await token();
      const r = await pedir(`https://api.zoom.us/v2/meetings/${encodeURIComponent(eventoId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!r.ok && r.status !== 404) throw errorProveedor('Zoom', 'cancelar reunión', r);
    },
  };
}

// Mapa de proveedores: para agregar otro, añadir una entrada que reciba las credenciales y devuelva un Proveedor.
const PROVEEDORES: Record<string, (cred: Credenciales) => Proveedor> = {
  google_meet: proveedorGoogleMeet,
  microsoft_teams: proveedorTeams,
  zoom: proveedorZoom,
};

// ---------------------------------------------------------------------------------------------------
// Datos de la cita y fechas
// ---------------------------------------------------------------------------------------------------
function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map((x) => parseInt(x, 10));
  return h * 60 + (m || 0);
}
function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00`;
}
function normalizarHora(hora: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(hora ?? ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}` : null;
}

function datosDeCita(cita: any): DatosReunion {
  const fecha = String(cita.fecha ?? '').slice(0, 10);
  const inicio = normalizarHora(cita.hora_inicio);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !inicio) throw new ErrorUsuario('La cita no tiene fecha u hora de inicio válidas.');
  let minInicio = aMinutos(inicio);
  let minFin = cita.hora_fin ? aMinutos(normalizarHora(cita.hora_fin) ?? inicio) : minInicio + DURACION_POR_DEFECTO_MIN;
  if (minFin <= minInicio) minFin = minInicio + DURACION_POR_DEFECTO_MIN;
  if (minFin > 24 * 60 - 1) minFin = 24 * 60 - 1; // se mantiene dentro del mismo día
  if (minInicio >= minFin) minInicio = minFin - 1;
  const base = String(cita.titulo ?? '').trim() || `Reunión con ${String(cita.cliente_nombre ?? '').trim() || 'cliente'}`;
  return { titulo: base.slice(0, MAX_TITULO), fecha, inicio: aHora(minInicio), fin: aHora(minFin), duracionMin: minFin - minInicio };
}

// Mañana a las 10:00 (hora de Colombia, UTC-5 fijo).
function datosDePrueba(): DatosReunion {
  const manana = new Date(Date.now() - 5 * 3600 * 1000 + 24 * 3600 * 1000);
  return { titulo: '[PRUEBA] Reunión de prueba', fecha: manana.toISOString().slice(0, 10), inicio: '10:00:00', fin: '10:15:00', duracionMin: 15 };
}

async function cargarProveedor(admin: Admin, empresaId: string, nombre: string): Promise<Proveedor> {
  const fabrica = PROVEEDORES[nombre];
  if (!fabrica) throw new ErrorUsuario(`El proveedor «${recortar(nombre, 40)}» no está soportado.`);
  const { data, error } = await admin.rpc('agenda_obtener_credenciales_videollamada', { p_empresa_id: empresaId });
  if (error || !data) throw new ErrorUsuario('Todavía no hay credenciales de videollamada guardadas para esta empresa.');
  let cred: unknown = data;
  if (typeof data === 'string') {
    try {
      cred = JSON.parse(data);
    } catch {
      throw new ErrorUsuario('Las credenciales guardadas no son un JSON válido. Vuelve a guardarlas en Configuración.');
    }
  }
  if (!cred || typeof cred !== 'object' || Array.isArray(cred)) throw new ErrorUsuario('Las credenciales guardadas no tienen el formato esperado.');
  return fabrica(cred as Credenciales);
}

// ---------------------------------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body: { cita_id?: string; empresa_id?: string; probar?: boolean; cancelar?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo de la solicitud no válido.' }, 400);
  }

  try {
    // ---- Quién llama ----------------------------------------------------------------------------
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: usuario } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!usuario?.user) return json({ ok: false, error: 'Sesión no válida.' }, 401);
    const usuarioId = usuario.user.id;

    async function rolEnEmpresa(empresaId: string): Promise<string | null> {
      const { data: miembro } = await admin
        .from('agenda_miembros')
        .select('rol')
        .eq('empresa_id', empresaId)
        .eq('usuario_id', usuarioId)
        .eq('activo', true)
        .maybeSingle();
      return miembro ? String(miembro.rol ?? '') : null;
    }

    // ---- Probar (solo administrador) ------------------------------------------------------------
    if (body.probar === true) {
      const empresaId = String(body.empresa_id ?? '');
      if (!UUID_RE.test(empresaId)) return json({ ok: false, error: 'Falta la empresa.' }, 400);
      if ((await rolEnEmpresa(empresaId)) !== 'administrador') {
        return json({ ok: false, error: 'Solo un administrador puede probar la videollamada.' }, 403);
      }
      const { data: conf } = await admin.from('agenda_configuracion').select('videollamada_proveedor').eq('empresa_id', empresaId).maybeSingle();
      const nombre = String(conf?.videollamada_proveedor ?? '');
      if (!nombre || nombre === 'manual') return json({ ok: false, error: 'La empresa usa enlace manual: no hay nada que probar.' }, 400);
      const proveedor = await cargarProveedor(admin, empresaId, nombre);
      const r = await proveedor.crear(datosDePrueba());
      await proveedor.cancelar(r.eventoId).catch((e) => console.error('crear-videollamada: no se pudo borrar la prueba:', e instanceof Error ? recortar(e.message) : 'error'));
      return json({ ok: true, proveedor: nombre, enlace_ejemplo: r.enlace });
    }

    // ---- Crear / cancelar sobre una cita --------------------------------------------------------
    const citaId = String(body.cita_id ?? '');
    if (!UUID_RE.test(citaId)) return json({ ok: false, error: 'Falta la cita o su identificador no es válido.' }, 400);

    const { data: cita } = await admin
      .from('agenda_citas')
      .select('id, empresa_id, fecha, hora_inicio, hora_fin, titulo, tipo_cita, cliente_nombre, cliente_email, asesor_id, enlace_virtual, proveedor_virtual, virtual_evento_id')
      .eq('id', citaId)
      .maybeSingle();
    // Misma respuesta si no existe o si no es de tu empresa: no se revela qué citas existen.
    if (!cita || !(await rolEnEmpresa(cita.empresa_id))) return json({ ok: false, error: 'No tienes acceso a esa cita.' }, 403);

    if (body.cancelar === true) {
      if (!cita.virtual_evento_id) return json({ ok: true, cancelada: false, mensaje: 'La cita no tiene una videollamada creada por la agenda.' });
      let cancelado = true;
      try {
        const nombre = cita.proveedor_virtual
          ? String(cita.proveedor_virtual)
          : String((await admin.from('agenda_configuracion').select('videollamada_proveedor').eq('empresa_id', cita.empresa_id).maybeSingle()).data?.videollamada_proveedor ?? '');
        const proveedor = await cargarProveedor(admin, cita.empresa_id, nombre);
        await proveedor.cancelar(String(cita.virtual_evento_id));
      } catch (e) {
        // Mejor esfuerzo: si el proveedor falla igual se limpia la cita; solo queda registro en logs.
        cancelado = false;
        console.error('crear-videollamada: cancelación en el proveedor falló:', e instanceof Error ? recortar(e.message) : 'error');
      }
      const { error } = await admin
        .from('agenda_citas')
        .update({ enlace_virtual: null, proveedor_virtual: null, virtual_evento_id: null })
        .eq('id', cita.id);
      if (error) console.error('crear-videollamada: no se pudo limpiar la cita:', recortar(error.message));
      return json({ ok: true, cancelada: true, evento_borrado_en_proveedor: cancelado });
    }

    // Crear
    if (cita.enlace_virtual && String(cita.enlace_virtual).trim()) {
      return json({ ok: true, enlace: cita.enlace_virtual, ya_existia: true });
    }
    const { data: conf } = await admin.from('agenda_configuracion').select('videollamada_proveedor').eq('empresa_id', cita.empresa_id).maybeSingle();
    const nombre = String(conf?.videollamada_proveedor ?? '');
    if (!nombre || nombre === 'manual') return json({ ok: false, error: 'La empresa usa enlace manual: pégalo en la cita.' }, 400);

    const proveedor = await cargarProveedor(admin, cita.empresa_id, nombre);
    const r = await proveedor.crear(datosDeCita(cita));
    const { error: errorGuardar } = await admin
      .from('agenda_citas')
      .update({ enlace_virtual: r.enlace, proveedor_virtual: nombre, virtual_evento_id: r.eventoId })
      .eq('id', cita.id);
    if (errorGuardar) {
      // No dejar reuniones huérfanas en el proveedor si no se pudo guardar el enlace.
      await proveedor.cancelar(r.eventoId).catch(() => {});
      console.error('crear-videollamada: no se pudo guardar el enlace:', recortar(errorGuardar.message));
      return json({ ok: false, error: 'La reunión se creó pero no se pudo guardar el enlace en la cita. Inténtalo de nuevo.' }, 500);
    }
    return json({ ok: true, enlace: r.enlace, proveedor: nombre });
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ ok: false, error: e.message }, e.status);
    console.error('crear-videollamada:', e instanceof Error ? recortar(e.message) : 'error desconocido');
    return json({ ok: false, error: 'Error inesperado al crear la videollamada.' }, 500);
  }
});
