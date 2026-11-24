// Canal de WhatsApp (API de Meta): firma del webhook, lectura de mensajes entrantes y envío de texto/plantillas.
// Secretos de las Edge Functions (nunca en la base ni en el navegador): WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN.
const GRAPH = 'https://graph.facebook.com/v21.0';

export function soloDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Valida «x-hub-signature-256» (HMAC-SHA256 del cuerpo exacto con el secreto de la app de Meta).
export async function firmaValida(cuerpo: string, cabecera: string | null, secreto: string): Promise<boolean> {
  if (!cabecera || !secreto) return false;
  const llave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(cuerpo)));
  const hex = 'sha256=' + [...firma].map((b) => b.toString(16).padStart(2, '0')).join('');
  return igualesSeguro(hex, cabecera.trim().toLowerCase());
}

export function secretoIgual(a: string | null, b: string | undefined): boolean {
  return !!a && !!b && igualesSeguro(a, b);
}

export type EntranteWA = {
  phone_number_id: string;
  wa_id: string;
  telefono: string;
  nombre: string | null;
  tipo: string; // text, audio, image, document, location, sticker, video, reaction, button, interactive, unsupported...
  texto: string;
  momento: number; // ms
  media: { id: string; mime: string; nombre: string | null } | null;
  oculto: boolean; // el cliente usa nombre de usuario de WhatsApp y Meta no entrega su teléfono (se identifica por su BSUID)
};

// Extrae los mensajes entrantes del JSON de Meta (puede traer varios). Ignora estados de entrega.
// deno-lint-ignore no-explicit-any
export function extraerEntrantes(payload: any): EntranteWA[] {
  const salida: EntranteWA[] = [];
  for (const entrada of payload?.entry || []) {
    for (const cambio of entrada?.changes || []) {
      const v = cambio?.value;
      if (!v?.messages?.length) continue;
      const pid = String(v?.metadata?.phone_number_id || '');
      for (const m of v.messages) {
        const contacto = (v.contacts || []).find((c: { wa_id?: string }) => c?.wa_id === m.from) || v.contacts?.[0];
        let texto = '';
        if (m.type === 'text') texto = m.text?.body || '';
        else if (m.type === 'button') texto = m.button?.text || '';
        else if (m.type === 'interactive') texto = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
        else if (m.type === 'location') texto = `Ubicación compartida: ${m.location?.latitude}, ${m.location?.longitude}${m.location?.name ? ` (${m.location.name})` : ''}`;
        else if (m.type === 'image' || m.type === 'document' || m.type === 'video') texto = m[m.type]?.caption || '';
        const adjunto = ['image', 'audio', 'voice', 'document', 'video', 'sticker'].includes(m.type) ? m[m.type] : null;
        const bsuid = String(m.from_user_id || m.user_id || contacto?.user_id || '').trim();
        const oculto = !soloDigitos(m.from) && !!bsuid;
        salida.push({
          phone_number_id: pid,
          wa_id: String(m.id || ''),
          oculto,
          media: adjunto?.id ? { id: String(adjunto.id), mime: String(adjunto.mime_type || ''), nombre: adjunto.filename ? String(adjunto.filename) : null } : null,
          telefono: oculto ? bsuid : soloDigitos(m.from),
          nombre: contacto?.profile?.name || null,
          tipo: String(m.type || 'text'),
          texto: String(texto).slice(0, 4000),
          momento: (Number(m.timestamp) || Math.floor(Date.now() / 1000)) * 1000,
        });
      }
    }
  }
  return salida;
}

export type ResultadoEnvio = { ok: boolean; wa_id?: string; error?: string; status?: number };

async function publicar(phoneNumberId: string, cuerpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  if (!token) return { ok: false, error: 'Falta el secreto WHATSAPP_TOKEN en las funciones.' };
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: String(j?.error?.message || `Meta respondió ${r.status}`) };
    return { ok: true, wa_id: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Teléfono → «to»; identificador de usuario (BSUID, con letras) → «recipient». Meta ignora «recipient» si va «to».
function destino(para: string): Record<string, string> {
  const d = soloDigitos(para);
  return d && d.length >= 8 && !/[A-Za-z]/.test(String(para)) ? { to: d } : { recipient: String(para).trim() };
}

export function enviarTexto(phoneNumberId: string, para: string, texto: string): Promise<ResultadoEnvio> {
  return publicar(phoneNumberId, { ...destino(para), type: 'text', text: { body: texto.slice(0, 4000), preview_url: true } });
}

export function enviarPlantilla(phoneNumberId: string, para: string, nombre: string, idioma: string, parametros: string[]): Promise<ResultadoEnvio> {
  return publicar(phoneNumberId, {
    ...destino(para),
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma || 'es' },
      components: parametros.length ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p).slice(0, 1000) })) }] : [],
    },
  });
}

export function marcarLeido(phoneNumberId: string, waId: string): Promise<ResultadoEnvio> {
  return publicar(phoneNumberId, { status: 'read', message_id: waId });
}

// Dentro de las 24 h desde el último mensaje del cliente se puede escribir libremente; fuera solo con plantilla aprobada.
export function dentroDeVentana(ultimoClienteEn: string | null | undefined): boolean {
  if (!ultimoClienteEn) return false;
  return Date.now() - new Date(ultimoClienteEn).getTime() < 24 * 3600 * 1000;
}

// Descarga un archivo (foto, nota de voz, documento) que mandó el cliente. Los enlaces de Meta caducan a los pocos minutos: se guarda de inmediato.
export async function descargarMedia(mediaId: string): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string }> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  if (!token) return { ok: false, error: 'Falta WHATSAPP_TOKEN' };
  try {
    const meta = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const mj = await meta.json().catch(() => ({}));
    if (!meta.ok || !mj?.url) return { ok: false, error: String(mj?.error?.message || `Meta respondió ${meta.status}`) };
    if (Number(mj.file_size) > 20 * 1024 * 1024) return { ok: false, error: 'Archivo de más de 20 MB' };
    const r = await fetch(mj.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, error: `No se pudo descargar (${r.status})` };
    return { ok: true, bytes: new Uint8Array(await r.arrayBuffer()), mime: String(mj.mime_type || r.headers.get('content-type') || 'application/octet-stream') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function extensionDe(mime: string, nombre?: string | null): string {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  const mapa: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
  if (mapa[m]) return mapa[m];
  const e = (nombre || '').match(/.([A-Za-z0-9]{1,5})$/);
  return e ? e[1].toLowerCase() : 'bin';
}
