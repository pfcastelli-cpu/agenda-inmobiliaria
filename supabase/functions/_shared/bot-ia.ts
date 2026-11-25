// Cerebro del bot de WhatsApp dentro de la plataforma: arma el prompt (bloque fijo cacheado + bloque variable), llama a Claude con la
// herramienta buscar_inmuebles, separa las etiquetas invisibles y las convierte en avisos. NO envía por WhatsApp ni guarda mensajes:
// eso lo hace whatsapp-webhook. Secreto de las funciones: ANTHROPIC_API_KEY.
import { INFO_EMPRESA, PROMPT_REGLAS } from './bot-prompt.ts';
import { enlaceInmueble } from './marca-correo.ts';
import { enviarCorreoEmpresa, esc } from './correo-empresa.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Cfg = Record<string, any>;

export type MensajeHist = { rol: 'user' | 'assistant'; texto: string };
// TEMA, PERFIL y SIN_INMUEBLE son internas (clasifican la conversación en la bandeja): no mandan correo.
export type Etiqueta = { tipo: 'INTERES' | 'CONSIGNAR' | 'CONTABILIDAD' | 'ENTREGA' | 'HUMANO' | 'TEMA' | 'PERFIL' | 'SIN_INMUEBLE'; datos: string };
export type RespuestaIA = { texto: string; etiquetas: Etiqueta[]; uso: { entrada: number; salida: number; cache_leido: number } };


function waLink(num: unknown): string {
  const d = String(num ?? '').replace(/\D/g, '');
  return d ? `https://wa.me/${d.startsWith('57') || d.length > 10 ? d : '57' + d}` : '';
}

// Bloque fijo: idéntico letra por letra entre mensajes de una misma empresa (así funciona el caché de Anthropic).
export function armarPromptFijo(cfgWA: Cfg, slug: string, dominio: string): string {
  const c = (cfgWA.contactos || {}) as Cfg;
  const urlConsignar = `${baseEnlaces(cfgWA, dominio)}/consignar?empresa=${encodeURIComponent(slug)}`;
  const compartir = cfgWA.compartir_whatsapp_asesor !== false;
  const lineas: string[] = [];
  if (compartir) {
    lineas.push('Cuando el cliente pida hablar con una persona, o la pregunta requiera criterio humano, puedes darle el WhatsApp del asesor de su ciudad:');
    // Un número por ciudad (Ajustes → Ciudades y contactos, con las ciudades de la plataforma). Si no hay, se usan los dos números antiguos.
    const porCiudad = (Array.isArray(c.por_ciudad) ? c.por_ciudad : []).filter((x: Cfg) => x && x.ciudad && waLink(x.whatsapp));
    if (porCiudad.length) {
      for (const x of porCiudad) lineas.push(`- ${String(x.ciudad).slice(0, 60)}: ${waLink(x.whatsapp)}`);
    } else {
      const bm = waLink(c.wa_bogota_medellin), ba = waLink(c.wa_barranquilla);
      if (bm) lineas.push(`- Bogotá y Medellín: ${bm}`);
      if (ba) lineas.push(`- Barranquilla: ${ba}`);
    }
    lineas.push('Además emite [HUMANO:motivo breve] para que un asesor también pueda entrar a esta conversación.');
  } else {
    lineas.push('Los asesores atienden DENTRO de esta misma conversación de WhatsApp. NO des números de WhatsApp de asesores. Cuando el cliente pida hablar con una persona,');
    lineas.push('o la pregunta requiera criterio humano, dile que un asesor le escribirá por este mismo chat en breve y emite [HUMANO:motivo breve].');
  }
  // La empresa puede editar sus reglas y su información desde Ajustes; vacío = texto original que viene con la plataforma.
  const base = String(cfgWA.prompt_reglas || '').trim() || PROMPT_REGLAS;
  const info = String(cfgWA.prompt_info || '').trim() || INFO_EMPRESA;
  const reglas = base
    .replaceAll('[[URL_CONSIGNAR]]', urlConsignar)
    .replaceAll('[[WA_CONTABILIDAD]]', waLink(c.wa_contabilidad) || 'del área de contabilidad (te lo confirma un asesor)')
    .replaceAll('[[NUM_LOCATIVAS]]', String(c.wa_locativas || '').replace(/\D/g, '') || 'del área de mantenimiento')
    .replaceAll('[[BLOQUE_ASESOR]]', lineas.join('\n'));
  const extra = String(cfgWA.reglas_adicionales || '').trim();
  return `${reglas}\n\n${info}${extra ? `\n\n═══════════════════════════════\nINDICACIONES ADICIONALES DE LA EMPRESA\n═══════════════════════════════\n${extra}` : ''}`;
}

// Base de los enlaces que da el bot: la dirección de pruebas de Ajustes si existe; si no, el dominio público de la empresa.
export function baseEnlaces(cfgWA: Cfg, dominio: string): string {
  const b = String(cfgWA?.enlaces_base || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(b) ? b : `https://${dominio}`;
}

function fechaBogota(): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
}

const HERRAMIENTAS = [{
  name: 'buscar_inmuebles',
  description: 'Busca inmuebles DISPONIBLES de la empresa. Úsala SIEMPRE antes de presentar cualquier inmueble o precio. Devuelve hasta 6 con su enlace de ficha y su enlace de reserva de visita.',
  input_schema: {
    type: 'object',
    properties: {
      codigo: { type: 'integer', description: 'Código interno (número) del inmueble, si el cliente lo da o viene en un enlace.' },
      codigo_portal: { type: 'string', description: 'Código de un portal: el número al final de un enlace de Fincaraíz (ej. 194288347), un código de Metrocuadrado (ej. 507-M7074593) o de Ciencuadras (ej. 155650-279). Los datos de NUESTRA base mandan: si el título del portal (venta/arriendo, barrio) no coincide, el portal puede estar mal rotulado; da la información de nuestra base.' },
      operacion: { type: 'string', enum: ['Arriendo', 'Venta'] },
      ciudad: { type: 'string', description: 'Ciudad, p. ej. Bogotá, Medellín, Barranquilla.' },
      tipo: { type: 'string', description: 'Tipo: apartamento, casa, local, oficina, bodega, lote...' },
      zona: { type: 'string', description: 'Barrio, localidad, conjunto o dirección parcial.' },
      habitaciones_min: { type: 'integer' },
      valor_max: { type: 'number', description: 'Valor máximo en pesos (canon si es arriendo, precio si es venta).' },
    },
  },
}];

// La búsqueda la hace la base de datos (sql/095): sin tildes, tolerante a errores de digitación y ordenada por parecido.
export async function buscarInmuebles(admin: Admin, empresaId: string, cfgEmpresa: Cfg, f: Cfg, cfgWA: Cfg = {}): Promise<unknown> {
  const { data, error } = await admin.rpc('agenda_wa_buscar_inmuebles', {
    p_empresa_id: empresaId,
    p_codigo: Number.isInteger(f.codigo) ? f.codigo : null,
    p_operacion: f.operacion === 'Arriendo' || f.operacion === 'Venta' ? f.operacion : null,
    p_ciudad: f.ciudad ? String(f.ciudad).slice(0, 60) : null,
    p_tipo: f.tipo ? String(f.tipo).slice(0, 40) : null,
    p_zona: f.zona ? String(f.zona).slice(0, 100) : null,
    p_habitaciones_min: Number.isInteger(f.habitaciones_min) ? f.habitaciones_min : null,
    p_valor_max: Number.isFinite(f.valor_max) ? f.valor_max : null,
    p_limite: 6,
    p_codigo_portal: f.codigo_portal ? String(f.codigo_portal).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || null : null,
  });
  if (error || !data) return { error: 'No se pudo consultar el catálogo en este momento.' };
  const dominio = String(cfgEmpresa.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const base = baseEnlaces(cfgWA, dominio);
  // deno-lint-ignore no-explicit-any
  const res = (data.inmuebles || []).map((r: any) => ({
    codigo: r.numero_inmueble,
    operacion: r.tipo_oferta,
    tipo: r.tipo_inmueble,
    ciudad: r.ciudad,
    zona: [r.barrio, r.localidad].filter(Boolean).join(' · '),
    direccion: r.direccion,
    habitaciones: r.habitaciones,
    banos: r.banos,
    parqueaderos: r.parqueaderos,
    valor: r.tipo_oferta === 'Venta' ? r.valor_venta : r.valor_canon,
    descripcion: r.descripcion,
    enlace_ficha: enlaceInmueble(cfgEmpresa, r.numero_inmueble),
    enlace_reserva: `${base}/inmuebles/${r.numero_inmueble}`,
  }));
  return res.length ? { total_encontrados: data.total, inmuebles: res } : { total_encontrados: 0, inmuebles: [], nota: 'No hay inmuebles disponibles con esos filtros. Ofrece ampliar la búsqueda o conectar con un asesor.' };
}

// Texto para el bloque variable del prompt con los inmuebles ya ofrecidos en la conversación (el asesor pulsó «Pasar información del inmueble N»
// o la IA los mostró): así la IA sigue la conversación sobre ellos, con datos reales y sus enlaces de ficha y de reserva de visita.
export async function contextoInmuebles(admin: Admin, empresaId: string, cfgEmpresa: Cfg, cfgWA: Cfg, numeros: number[]): Promise<string> {
  const partes: string[] = [];
  for (const n of [...new Set(numeros)].slice(-5)) {
    // deno-lint-ignore no-explicit-any
    const r: any = await buscarInmuebles(admin, empresaId, cfgEmpresa, { codigo: n }, cfgWA);
    const i = r?.inmuebles?.[0];
    if (i) partes.push(JSON.stringify(i));
  }
  return partes.length
    ? `INMUEBLES QUE YA SE LE OFRECIERON A ESTE CLIENTE EN ESTA CONVERSACIÓN (el último es el principal; continúa la conversación sobre ellos con estos datos reales y sus enlaces de ficha y de reserva de visita, sin volver a preguntar cuál es):\n${partes.join('\n')}`
    : '';
}

// Une mensajes seguidos del mismo rol y exige que el primero sea del cliente (lo pide la API).
export function normalizarHistorial(h: MensajeHist[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of h) {
    const t = m.texto.trim();
    if (!t) continue;
    const ult = out[out.length - 1];
    if (ult && ult.role === m.rol) ult.content += '\n' + t;
    else out.push({ role: m.rol, content: t });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

const RE_ETIQUETA = /\[(INTERES|CONSIGNAR|CONTABILIDAD|ENTREGA|HUMANO|TEMA|PERFIL|SIN_INMUEBLE)(?::([^\]]*))?\]/g;

export function separarEtiquetas(texto: string): { limpio: string; etiquetas: Etiqueta[] } {
  const etiquetas: Etiqueta[] = [];
  const limpio = texto.replace(RE_ETIQUETA, (_m, tipo, datos) => {
    etiquetas.push({ tipo, datos: String(datos || '').trim() });
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { limpio, etiquetas };
}

export type ParamsIA = {
  admin: Admin;
  empresaId: string;
  cfgWA: Cfg;
  cfgEmpresa: Cfg;
  slug: string;
  historial: MensajeHist[];
  cliente: { nombre: string | null; telefono: string };
  extraVariable?: string;
};

export async function responderConIA(p: ParamsIA): Promise<{ ok: true; r: RespuestaIA } | { ok: false; error: string; bloqueada?: boolean }> {
  const clave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!clave) return { ok: false, error: 'Falta el secreto ANTHROPIC_API_KEY en las funciones.' };
  const dominio = String(p.cfgEmpresa.dominio_publico || 'citas.patrimonios.co').replace(/[^a-zA-Z0-9.-]/g, '');
  const fijo = armarPromptFijo(p.cfgWA, p.slug, dominio);
  const variable = `FECHA Y HORA ACTUAL (Colombia): ${fechaBogota()}\nCLIENTE: ${p.cliente.nombre || 'sin nombre registrado'} · teléfono ${p.cliente.telefono}\n${p.extraVariable || ''}`.trim();
  const mensajes: { role: string; content: unknown }[] = normalizarHistorial(p.historial.slice(-40));
  if (!mensajes.length) return { ok: false, error: 'Sin mensajes del cliente a los que responder.' };
  const uso = { entrada: 0, salida: 0, cache_leido: 0 };
  let texto = '';
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    let resp: Response;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: p.cfgWA.modelo || 'claude-haiku-5-5',
          max_tokens: 1200,
          system: [
            { type: 'text', text: fijo, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: variable },
          ],
          tools: HERRAMIENTAS,
          messages: mensajes,
        }),
      });
    } catch (e) {
      return { ok: false, error: `No se pudo conectar con Anthropic: ${e instanceof Error ? e.message : e}` };
    }
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = String(j?.error?.message || `Anthropic respondió ${resp.status}`);
      return { ok: false, error: msg, bloqueada: resp.status === 401 || resp.status === 403 || /credit|billing|balance/i.test(msg) };
    }
    uso.entrada += j?.usage?.input_tokens || 0;
    uso.salida += j?.usage?.output_tokens || 0;
    uso.cache_leido += j?.usage?.cache_read_input_tokens || 0;
    const bloques: Cfg[] = j.content || [];
    texto = bloques.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const usos = bloques.filter((b) => b.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !usos.length) break;
    mensajes.push({ role: 'assistant', content: bloques });
    const resultados = [];
    for (const u of usos) {
      const out = u.name === 'buscar_inmuebles' ? await buscarInmuebles(p.admin, p.empresaId, p.cfgEmpresa, u.input || {}, p.cfgWA) : { error: 'Herramienta desconocida.' };
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
    }
    mensajes.push({ role: 'user', content: resultados });
  }
  const { limpio, etiquetas } = separarEtiquetas(texto);
  if (!limpio && !etiquetas.length) return { ok: false, error: 'Claude no devolvió texto.' };
  return { ok: true, r: { texto: limpio, etiquetas, uso } };
}

// Convierte las etiquetas en avisos por correo al equipo. Devuelve si la conversación debe pasar a una persona.
export async function ejecutarEtiquetas(
  admin: Admin, empresaId: string, cfgWA: Cfg, etiquetas: Etiqueta[],
  cliente: { nombre: string | null; telefono: string }, urlConversacion: string,
): Promise<{ pasarAHumano: boolean; motivo: string | null }> {
  const c = (cfgWA.contactos || {}) as Cfg;
  let pasar = false;
  let motivo: string | null = null;
  for (const e of etiquetas) {
    if (e.tipo === 'TEMA' || e.tipo === 'PERFIL') continue;
    if (e.tipo === 'SIN_INMUEBLE') { pasar = true; motivo = motivo || 'No se identificó el inmueble: lo debe ver una persona'; continue; }
    const partes = e.datos.split('|').map((x) => x.trim());
    const filas = (e.tipo === 'HUMANO' ? [['Motivo', e.datos]]
      : e.tipo === 'INTERES' ? [['Ciudad', partes[0]], ['Qué busca', partes[1]], ['Inmueble', partes[2]], ['Código', partes[3]], ['Dirección', partes[4]]]
      : e.tipo === 'CONSIGNAR' ? [['Nombre', partes[0]], ['Ciudad', partes[1]], ['Tipo', partes[2]], ['Operación', partes[3]], ['Zona', partes[4]], ['Detalles', partes.slice(5).join(' | ')]]
      : e.tipo === 'CONTABILIDAD' ? [['Nombre', partes[0]], ['Documento', partes[1]], ['Inmueble', partes[2]], ['Trámite', partes[3]], ['Detalle', partes.slice(4).join(' | ')]]
      : [['Nombre', partes[0]], ['Correo', partes[1]], ['Inmueble', partes[2]], ['Trámite', partes[3]]]).filter((f) => f[1]);
    if (e.tipo === 'HUMANO' || e.tipo === 'INTERES') { pasar = true; motivo = motivo || (e.tipo === 'HUMANO' ? e.datos : 'Cliente interesado: pasa con un asesor'); }
    const destino = e.tipo === 'CONTABILIDAD' ? c.correo_contabilidad : e.tipo === 'ENTREGA' ? (c.correo_solicitudes || c.correo_asesores) : c.correo_asesores;
    if (!destino) continue;
    const titulos: Record<string, string> = { INTERES: 'Cliente interesado desde WhatsApp', CONSIGNAR: 'Propietario por WhatsApp', CONTABILIDAD: 'Trámite de contabilidad por WhatsApp', ENTREGA: 'Entrega o devolución por WhatsApp', HUMANO: 'Un cliente pide atención de una persona' };
    const lista = filas.map((f) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6b6b;vertical-align:top">${esc(f[0])}</td><td style="padding:4px 0"><b>${esc(f[1])}</b></td></tr>`).join('');
    await enviarCorreoEmpresa(admin, empresaId, {
      destinos: String(destino).split(/[,;\s]+/).filter((x) => x.includes('@')),
      asunto: `${titulos[e.tipo]}: ${cliente.nombre || cliente.telefono}`,
      titulo: titulos[e.tipo],
      cuerpo: `<p style="margin:0 0 10px">Escribió <b>${esc(cliente.nombre || 'un cliente')}</b> (+${esc(cliente.telefono)}).</p><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">${lista}</table>`,
      boton: { texto: 'Abrir la conversación', url: urlConversacion },
      tipoLog: 'interno',
    });
  }
  return { pasarAHumano: pasar, motivo };
}

