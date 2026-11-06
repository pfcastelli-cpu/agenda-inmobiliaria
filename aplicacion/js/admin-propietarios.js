// Configuración > «Solicitudes de propietarios» (check-list) y «Salud de inmuebles» (semáforo de movimiento).
// Las solicitudes llegan desde la página pública del propietario. Al marcarlas como hechas, la base las cierra por una función
// que valida el permiso (agenda_solicitud_marcar_hecha) y la Edge Function avisar-solicitud-hecha le escribe al propietario.
// La salud de inmuebles solo muestra cifras (visitas, personas distintas, interesados): nunca datos de clientes.
import { supabase } from './cliente-supabase.js';
import { puede } from './permisos.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIPOS = { cambio_precio: 'Cambio de precio', cambio_fotos: 'Cambio de fotos', asesoria: 'Asesoría' };
const dinero = (n) => (n == null ? '' : '$ ' + Number(n).toLocaleString('es-CO'));
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
let filtroSolicitudes = 'pendiente';

async function avisarPropietario(solicitudId, reenviar = false) {
  const { data, error } = await supabase.functions.invoke('avisar-solicitud-hecha', { body: { solicitud_id: solicitudId, reenviar } });
  if (error) throw new Error('No se pudo enviar el aviso al propietario. Inténtalo de nuevo.');
  if (!data?.ok) throw new Error(data?.error || 'No se pudo avisar al propietario.');
  return data;
}

export async function solicitudesTab({ el, empresaId, aviso, vigente }) {
  el.innerHTML = '<p class="ad-muted">Cargando solicitudes…</p>';
  const { data: filas, error } = await supabase
    .from('agenda_solicitudes_propietario')
    .select('id, inmueble_id, tipo, valor_propuesto, detalle, propietario_nombre, propietario_email, estado, origen, creado_en, hecha_en, nota_cierre, propietario_avisado_en')
    .eq('empresa_id', empresaId)
    .order('creado_en', { ascending: false })
    .limit(300);
  if (!vigente()) return;
  if (error) { el.innerHTML = `<p class="error">${esc(error.message || 'No se pudieron leer las solicitudes.')}</p>`; return; }
  const solicitudes = filas || [];
  const ids = [...new Set(solicitudes.map((s) => s.inmueble_id).filter(Boolean))];
  const inmuebles = {};
  if (ids.length) {
    const { data: inm } = await supabase.from('agenda_inmuebles').select('id, numero_inmueble, direccion, ciudad').eq('empresa_id', empresaId).in('id', ids);
    for (const i of inm || []) inmuebles[i.id] = i;
  }
  if (!vigente()) return;

  const gestiona = puede('pendientes.gestionar');
  const cuenta = { pendiente: 0, hecha: 0 };
  for (const s of solicitudes) if (cuenta[s.estado] !== undefined) cuenta[s.estado]++;
  const visibles = solicitudes.filter((s) => (filtroSolicitudes === 'todas' ? true : s.estado === filtroSolicitudes));

  const fila = (s) => {
    const i = inmuebles[s.inmueble_id];
    const donde = i ? `Inmueble ${esc(i.numero_inmueble)} · ${esc(i.direccion)}${i.ciudad ? ', ' + esc(i.ciudad) : ''}` : 'Inmueble no encontrado';
    const hecha = s.estado === 'hecha';
    return `<li class="ad-solicitud" data-id="${esc(s.id)}">
      <div class="ad-acceso-info">
        <strong>${esc(TIPOS[s.tipo] || s.tipo)}</strong> <span class="ad-pill">${hecha ? '✓ Hecha' : s.estado === 'descartada' ? 'Descartada' : 'Pendiente'}</span>
        <span class="ad-muted">${donde}</span>
        <span class="ad-muted">${esc(s.propietario_nombre || 'Propietario')}${s.propietario_email ? ' · ' + esc(s.propietario_email) : ''} · ${esc(fecha(s.creado_en))}</span>
        ${s.valor_propuesto != null ? `<span>Valor propuesto: <strong>${esc(dinero(s.valor_propuesto))}</strong></span>` : ''}
        ${s.detalle ? `<span>${esc(s.detalle)}</span>` : ''}
        ${hecha ? `<span class="ad-muted">Hecha el ${esc(fecha(s.hecha_en))}${s.nota_cierre ? ' · ' + esc(s.nota_cierre) : ''} · ${s.propietario_avisado_en ? 'propietario avisado el ' + esc(fecha(s.propietario_avisado_en)) : 'propietario SIN avisar'}</span>` : ''}
      </div>
      <div class="ad-acceso-botones">
        ${!hecha && s.estado === 'pendiente' && gestiona ? `<input type="text" data-nota maxlength="500" placeholder="Nota para el propietario (opcional)" aria-label="Nota para el propietario"><button type="button" class="ad-primary" data-hecha="${esc(s.id)}">✓ Marcar como hecha y avisar</button>` : ''}
        ${hecha && !s.propietario_avisado_en && gestiona && s.propietario_email ? `<button type="button" data-reavisar="${esc(s.id)}">Avisar al propietario</button>` : ''}
      </div>
    </li>`;
  };

  el.innerHTML = `<h2>Solicitudes de propietarios</h2>
    <p>Lo que los propietarios piden desde su página (cambio de precio, de fotos o asesoría). Cuando marcas una como hecha, el propietario recibe un correo avisándole. En modo de pruebas el correo llega al buzón de pruebas, no al propietario real.</p>
    <div class="ad-filtros" role="group" aria-label="Filtrar solicitudes">
      <button type="button" data-filtro="pendiente" aria-pressed="${filtroSolicitudes === 'pendiente'}">Pendientes (${cuenta.pendiente})</button>
      <button type="button" data-filtro="hecha" aria-pressed="${filtroSolicitudes === 'hecha'}">Hechas (${cuenta.hecha})</button>
      <button type="button" data-filtro="todas" aria-pressed="${filtroSolicitudes === 'todas'}">Todas</button>
    </div>
    <ul class="ad-accesos">${visibles.length ? visibles.map(fila).join('') : '<p class="ad-muted">No hay solicitudes en esta lista.</p>'}</ul>`;

  el.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtroSolicitudes = b.dataset.filtro; solicitudesTab({ el, empresaId, aviso, vigente }); }));
  el.querySelectorAll('[data-hecha]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('li');
    const nota = li.querySelector('[data-nota]')?.value || '';
    b.disabled = true;
    const { error: errorRpc } = await supabase.rpc('agenda_solicitud_marcar_hecha', { p_solicitud_id: b.dataset.hecha, p_nota: nota });
    if (errorRpc) { aviso(errorRpc.message || 'No se pudo marcar la solicitud.', true); b.disabled = false; return; }
    try {
      await avisarPropietario(b.dataset.hecha);
      aviso('Listo: solicitud hecha y propietario avisado.');
    } catch (e) {
      aviso('Quedó marcada como hecha, pero ' + e.message[0].toLowerCase() + e.message.slice(1) + ' Puedes reintentar con «Avisar al propietario».', true);
    }
    await solicitudesTab({ el, empresaId, aviso, vigente });
  }));
  el.querySelectorAll('[data-reavisar]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await avisarPropietario(b.dataset.reavisar, true); aviso('Propietario avisado.'); }
    catch (e) { aviso(e.message, true); }
    await solicitudesTab({ el, empresaId, aviso, vigente });
  }));
}

const NIVEL = { rojo: ['🔴', 'Sin movimiento'], amarillo: ['🟡', 'Poco movimiento'], verde: ['🟢', 'Con movimiento'] };
let filtroSalud = 'rojo';

export async function saludTab({ el, empresaId, aviso, vigente }) {
  el.innerHTML = '<p class="ad-muted">Calculando la salud de los inmuebles…</p>';
  const { data, error } = await supabase.rpc('agenda_salud_inmuebles', { p_empresa_id: empresaId, p_dias: 30 });
  if (!vigente()) return;
  if (error) { el.innerHTML = `<p class="error">${esc(error.message || 'No se pudo calcular la salud de los inmuebles.')}</p>`; return; }
  const filas = Array.isArray(data) ? data : [];
  const cuenta = { rojo: 0, amarillo: 0, verde: 0 };
  for (const f of filas) cuenta[f.nivel]++;
  const visibles = filas.filter((f) => filtroSalud === 'todos' || f.nivel === filtroSalud);
  const precio = (f) => (f.tipo_oferta === 'Venta' ? dinero(f.valor_venta) : dinero(f.valor_canon));
  el.innerHTML = `<h2>Salud de inmuebles</h2>
    <p>Movimiento de los inmuebles disponibles en los últimos 30 días: visitas (agenda nueva y citas de Calendar) e interesados del bot de WhatsApp. Son solo cifras, sin datos de clientes. «Días en el sistema» cuenta desde que el inmueble se cargó, no desde su publicación real.</p>
    <div class="ad-filtros" role="group" aria-label="Filtrar por semáforo">
      <button type="button" data-nivel="rojo" aria-pressed="${filtroSalud === 'rojo'}">🔴 Sin movimiento (${cuenta.rojo})</button>
      <button type="button" data-nivel="amarillo" aria-pressed="${filtroSalud === 'amarillo'}">🟡 Poco (${cuenta.amarillo})</button>
      <button type="button" data-nivel="verde" aria-pressed="${filtroSalud === 'verde'}">🟢 Con movimiento (${cuenta.verde})</button>
      <button type="button" data-nivel="todos" aria-pressed="${filtroSalud === 'todos'}">Todos</button>
    </div>
    <div style="overflow-x:auto"><table class="ad-tabla">
      <thead><tr><th>Inmueble</th><th>Ciudad</th><th>Oferta</th><th>Precio</th><th>Días en el sistema</th><th>Visitas 30 d</th><th>Personas</th><th>Interesados bot</th><th>Última visita</th><th>Estado</th></tr></thead>
      <tbody>${visibles.length ? visibles.map((f) => `<tr>
        <td><strong>${esc(f.numero_inmueble)}</strong> ${esc(f.tipo_inmueble || '')}</td><td>${esc(f.ciudad)}</td><td>${esc(f.tipo_oferta)}</td><td>${esc(precio(f))}</td>
        <td>${esc(f.dias_en_sistema)}</td><td>${esc(f.visitas)}</td><td>${esc(f.personas_visitas)}</td><td>${esc(f.personas_interes)}</td>
        <td>${esc(f.ultima_visita ? fecha(f.ultima_visita) : '—')}</td><td>${NIVEL[f.nivel]?.[0] || ''} ${esc(NIVEL[f.nivel]?.[1] || f.nivel)}</td></tr>`).join('') : '<tr><td colspan="10" class="ad-muted">No hay inmuebles en esta lista.</td></tr>'}</tbody>
    </table></div>`;
  el.querySelectorAll('[data-nivel]').forEach((b) => b.addEventListener('click', () => { filtroSalud = b.dataset.nivel; saludTab({ el, empresaId, aviso, vigente }); }));
}
