// Edge Function: avisar-fuera-cobertura (exige sesión: verify_jwt activo).
// El asesor revisa una captación y ve que el inmueble queda fuera de la zona de cobertura: esta función
//   1) cancela la cita de captación (libera el horario) dejando el motivo «Fuera de zona de cobertura»,
//   2) le escribe al propietario un correo amable explicando que no se puede atender y agradeciendo,
//   3) si el propietario escribió por WhatsApp (dentro de las 24 h), también se lo dice por ahí y queda en la bandeja.
// Respeta el modo de pruebas de correo (todo va a `correo_pruebas_destino`). Solo puede llamarla el asesor de esa captación
// o un administrador/coordinador de la empresa.
//   { cita_id, nota? }  →  { ok, cancelada, correo, whatsapp }
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { enviarCorreoEmpresa, esc } from '../_shared/correo-empresa.ts';
import { dentroDeVentana, enviarTexto, soloDigitos } from '../_shared/whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Cuerpo inválido.' }, 400); }
  const citaId = String(body.cita_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(citaId)) return json({ ok: false, error: 'Falta la cita.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  const usuario = u?.user;
  if (!usuario) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  const { data: cita } = await admin.from('agenda_citas').select('id, empresa_id, asesor_id, fecha, hora_inicio, estado, tipo_cita, cliente_nombre, cliente_email, cliente_telefono, direccion_libre, ciudad_libre').eq('id', citaId).maybeSingle();
  if (!cita) return json({ ok: false, error: 'Cita no encontrada.' }, 404);
  if (cita.tipo_cita !== 'captacion') return json({ ok: false, error: 'Solo aplica a citas de captación.' }, 400);
  if (cita.estado === 'cancelada') return json({ ok: false, error: 'Esta cita ya está cancelada.' }, 409);

  const { data: miembro } = await admin.from('agenda_miembros').select('rol').eq('empresa_id', cita.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
  if (!miembro) return json({ ok: false, error: 'No perteneces a esta empresa.' }, 403);
  const { data: yo } = await admin.from('agenda_asesores').select('id').eq('empresa_id', cita.empresa_id).eq('usuario_id', usuario.id).eq('activo', true).maybeSingle();
  const esSuya = !!yo && yo.id === cita.asesor_id;
  if (!esSuya && miembro.rol !== 'administrador' && miembro.rol !== 'coordinador') return json({ ok: false, error: 'Solo el asesor de esta captación o un coordinador puede marcarla fuera de cobertura.' }, 403);

  const nota = String(body.nota || '').trim().slice(0, 300);
  const motivo = `Fuera de zona de cobertura${nota ? `: ${nota}` : ''}`;
  const { error: errCancel } = await admin.from('agenda_citas').update({ estado: 'cancelada', motivo_cancelacion: motivo, cancelado_por: usuario.id, actualizado_en: new Date().toISOString() }).eq('id', cita.id).neq('estado', 'cancelada');
  if (errCancel) return json({ ok: false, error: 'No se pudo cancelar la cita.' }, 500);

  const { data: config } = await admin.from('agenda_configuracion').select('nombre_comercial, dominio_publico, empresa:agenda_empresas(slug)').eq('empresa_id', cita.empresa_id).maybeSingle();
  const empresaNombre = config?.nombre_comercial || 'nuestro equipo';
  const nombre = String(cita.cliente_nombre || '').trim();
  const saludo = nombre ? `Hola ${nombre.split(/\s+/)[0]}` : 'Hola';
  const donde = [cita.direccion_libre, cita.ciudad_libre].filter(Boolean).join(', ');

  // 2) Correo al propietario
  let correo = false;
  if (/\S+@\S+\.\S+/.test(cita.cliente_email || '')) {
    const r = await enviarCorreoEmpresa(admin, cita.empresa_id, {
      destinos: [cita.cliente_email],
      asunto: 'Sobre la visita a tu inmueble',
      titulo: 'No podremos atender tu inmueble',
      tipoLog: 'cliente',
      tema: 'cambio',
      cuerpo: `<p style="margin:0 0 12px">${esc(saludo)}, gracias por pensar en ${esc(empresaNombre)} para tu inmueble${donde ? ` en <b>${esc(donde)}</b>` : ''}.</p>
<p style="margin:0 0 12px">Revisamos la ubicación y, por ahora, <b>queda fuera de la zona donde podemos prestar el servicio</b>. Por eso cancelamos la visita que tenías para el <b>${esc(fechaLarga(cita.fecha))}</b>. Sentimos mucho el inconveniente.</p>
<p style="margin:0">Si más adelante tienes otro inmueble en las ciudades donde trabajamos, con gusto lo atendemos.</p>`,
    });
    correo = r.enviado;
  }

  // 3) WhatsApp, si el propietario nos escribió por ahí hace menos de 24 h
  let whatsapp = false;
  try {
    const tel = soloDigitos(cita.cliente_telefono);
    if (tel) {
      const { data: cfgWA } = await admin.from('agenda_whatsapp_config').select('phone_number_id, modo').eq('empresa_id', cita.empresa_id).maybeSingle();
      const { data: conv } = await admin.from('agenda_wa_conversaciones').select('id, ultimo_cliente_en').eq('empresa_id', cita.empresa_id).eq('telefono', tel.length === 10 ? `57${tel}` : tel).maybeSingle();
      if (cfgWA?.phone_number_id && cfgWA.modo !== 'anterior' && conv && dentroDeVentana(conv.ultimo_cliente_en)) {
        const t = `${saludo} 👋 Revisamos la ubicación de tu inmueble y, por ahora, queda fuera de la zona donde podemos prestar el servicio, así que cancelamos la visita del ${fechaLarga(cita.fecha)}. Gracias por pensar en ${empresaNombre}; si tienes otro inmueble en las ciudades donde trabajamos, con gusto lo atendemos.`;
        const r = await enviarTexto(cfgWA.phone_number_id, tel.length === 10 ? `57${tel}` : tel, t);
        await admin.from('agenda_wa_mensajes').insert({ conversacion_id: conv.id, empresa_id: cita.empresa_id, wa_id: r.wa_id || null, direccion: 'salida', origen: 'sistema', tipo: 'text', texto: t, estado_envio: r.ok ? 'enviado' : 'fallido', error: r.ok ? null : r.error || null });
        await admin.from('agenda_wa_conversaciones').update({ ultimo_texto: t.slice(0, 200), ultimo_en: new Date().toISOString() }).eq('id', conv.id);
        whatsapp = r.ok;
      }
    }
  } catch { /* el aviso por WhatsApp es un extra: la cancelación y el correo ya quedaron */ }

  return json({ ok: true, cancelada: true, correo, whatsapp });
});
