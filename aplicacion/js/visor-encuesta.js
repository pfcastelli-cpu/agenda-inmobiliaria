// Visor de una encuesta: lo abre el botón «Ver la encuesta» de los correos de aviso (enlace /?encuesta=<id>).
// Pide el detalle a la base (agenda_encuesta_detalle, sql/031), que solo lo entrega a administradores, coordinadores o al asesor de esa visita.
// Si la persona aún no ha iniciado sesión, el enlace conserva el ?encuesta=… y al entrar se abre solo.
import { supabase } from './cliente-supabase.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMPRESION = { me_gusto_mucho: '😍 Le gustó mucho', me_gusto: '🙂 Le gustó', no_seguro: '😐 No estaba seguro', no_me_gusto: '🙁 No le gustó' };
const INTENCION = { avanzar: '✅ Quiere avanzar', segunda_visita: '🏡 Quiere una segunda visita', resolver_dudas: '📲 Quiere resolver dudas', ver_otras: '🔎 Quiere ver otras opciones', no_interesa: '❌ No le interesa' };
const MOTIVO = { precio: 'Precio alto', ubicacion: 'Ubicación', estado: 'Estado del inmueble', tamano: 'Tamaño o distribución', ruido: 'Ruido o sector' };
const REVISION = { pendiente: 'por revisar con IA', publicable: 'publicado al propietario', sin_contenido: 'sin nada del inmueble (no se publica)', error: 'no se pudo revisar (no se publica)' };

function idDesdeUrl() {
  const id = new URLSearchParams(window.location.search).get('encuesta');
  return id && /^[0-9a-f-]{32,40}$/i.test(id) ? id : null;
}
function limpiarUrl() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('encuesta');
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch { /* sin historial no pasa nada */ }
}
const fila = (k, v) => (v ? `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>` : '');
const estrellas = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

// Abre el visor si la URL trae ?encuesta=<id>. Seguro de llamar siempre; no hace nada si no hay parámetro.
export async function abrirVisorEncuestaDesdeUrl() {
  const id = idDesdeUrl();
  if (!id) return;
  limpiarUrl();
  const capa = document.createElement('div');
  capa.setAttribute('role', 'dialog');
  capa.setAttribute('aria-modal', 'true');
  capa.setAttribute('aria-label', 'Encuesta del cliente');
  capa.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
  capa.innerHTML = '<div style="background:var(--v-surface,#fff);color:var(--v-text,#111827);max-width:560px;width:100%;max-height:90vh;overflow:auto;border-radius:18px;padding:22px 22px 18px"><p>Cargando la encuesta…</p></div>';
  document.body.append(capa);
  const cerrar = () => capa.remove();
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });

  const { data, error } = await supabase.rpc('agenda_encuesta_detalle', { p_id: id });
  const caja = capa.firstElementChild;
  if (error || !data || data.error) {
    caja.innerHTML = `<h3 style="margin:0 0 8px">No pudimos abrir la encuesta</h3><p>${esc(data?.error === 'sin_permiso' ? 'Tu usuario no tiene permiso para verla.' : 'No existe o no tienes acceso.')}</p><button type="button" class="v-btn" data-cerrar>Cerrar</button>`;
    caja.querySelector('[data-cerrar]').onclick = cerrar;
    return;
  }
  const d = data;
  const respondida = !!d.respondido_en;
  caja.innerHTML = `<h3 style="margin:0 0 4px">Encuesta de ${esc(d.cliente_nombre || 'un cliente')}</h3>
    <p style="margin:0 0 12px;color:#6b7280">Inmueble Nº ${esc(d.numero_inmueble)}${d.direccion ? ` · ${esc(d.direccion)}` : ''} · visita del ${esc(d.fecha)}${d.hora_inicio ? ' ' + esc(String(d.hora_inicio).slice(0, 5)) : ''}</p>
    ${respondida ? '' : '<p class="v-note">El cliente todavía no ha respondido esta encuesta.</p>'}
    <table style="border-collapse:collapse;font-size:14px">
      ${fila('Asesor', esc(d.asesor_nombre))}
      ${fila('Impresión', esc(IMPRESION[d.impresion]))}
      ${fila('Siguiente paso', esc(INTENCION[d.intencion]))}
      ${fila('Motivo', esc(MOTIVO[d.motivo]))}
      ${fila('Atención del asesor', respondida ? `<span style="color:#E6A817;letter-spacing:1px">${estrellas(d.calificacion)}</span>` : '')}
      ${fila('Teléfono', esc(d.cliente_telefono))}
      ${fila('Correo', esc(d.cliente_email))}
    </table>
    ${d.comentario ? `<p style="margin:14px 0 4px;color:#6b7280;font-size:13px">Comentario del cliente</p><p style="margin:0;padding:12px 14px;background:rgba(127,127,127,.12);border-radius:10px">«${esc(d.comentario)}»</p>` : ''}
    ${d.comentario && d.comentario_revision ? `<p style="margin:8px 0 0;font-size:12.5px;color:#6b7280">Para el propietario: ${esc(REVISION[d.comentario_revision] || d.comentario_revision)}${d.comentario_inmueble ? ` — «${esc(d.comentario_inmueble)}»` : ''}</p>` : ''}
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="v-btn v-primary" data-cerrar>Cerrar</button></div>`;
  caja.querySelector('[data-cerrar]').onclick = cerrar;
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc_); } });
}
