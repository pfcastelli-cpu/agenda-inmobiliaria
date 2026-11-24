// Pantalla «Mi disponibilidad»: cada asesor edita SU jornada, almuerzo, atención de sábado/domingo/festivos y registra sus
// vacaciones, incapacidades o días libres. Todo pasa por funciones de la base (sql/093) que solo tocan la ficha ligada al usuario
// que inició sesión y exigen el permiso «disponibilidad.editar_propia» (el administrador lo da o quita por rol).
import '../estilos/mi-disponibilidad.css';

const hhmm = (h) => String(h || '').slice(0, 5);
const fechaCorta = (iso) => {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const mensaje = (e, porDefecto) => String(e?.message || porDefecto);

export async function renderMiDisponibilidad({ el, supabase, empresaId, escape, toast }) {
  const esc = escape || ((t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  el.innerHTML = '<p class="v-muted">Cargando tu disponibilidad…</p>';
  const { data, error } = await supabase.rpc('agenda_mi_disponibilidad', { p_empresa_id: empresaId });
  if (error) {
    el.innerHTML = `<section class="md"><h2>Mi disponibilidad</h2><p class="md-error" role="alert">${esc(mensaje(error, 'No se pudo cargar tu disponibilidad.'))}</p></section>`;
    return;
  }
  pintar(data);

  function pintar(d) {
    const modoAlmuerzo = d.almuerzo_activo === true ? 'propio' : d.almuerzo_activo === false ? 'sin' : 'empresa';
    const textoEmpresa = d.empresa_almuerzo_activo ? `de ${hhmm(d.empresa_almuerzo_inicio)} a ${hhmm(d.empresa_almuerzo_fin)}` : 'sin almuerzo';
    const hoy = hoyISO();
    const vigentes = (d.ausencias || []).filter((x) => x.fecha_fin >= hoy).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    const pasadas = (d.ausencias || []).filter((x) => x.fecha_fin < hoy);
    const fila = (x) => `<li><span><strong>${esc(fechaCorta(x.fecha_inicio))}${x.fecha_fin !== x.fecha_inicio ? ' → ' + esc(fechaCorta(x.fecha_fin)) : ''}</strong>${x.motivo ? ' · ' + esc(x.motivo) : ''}</span><button type="button" class="v-btn v-quiet" data-quitar="${esc(x.id)}">Quitar</button></li>`;
    el.innerHTML = `<section class="md">
  <h2>Mi disponibilidad</h2>
  <p class="md-nota">Aquí defines cuándo trabajas. El sistema solo te ofrece citas dentro de este horario y deja de ofrecerte en los días que marques como ausencia. Lo que no aparece aquí (ciudades, zonas, prioridad, anticipación) lo define tu administrador.</p>
  <form id="md-form" class="md-card">
    <h3>Mi jornada</h3>
    <div class="md-grid">
      <label class="v-field">Entro a las<input class="v-input" type="time" name="inicio" value="${esc(hhmm(d.jornada_inicio))}" required></label>
      <label class="v-field">Termino a las<input class="v-input" type="time" name="fin" value="${esc(hhmm(d.jornada_fin))}" required></label>
    </div>
    <label class="md-check"><input type="checkbox" name="sabado" ${d.atiende_sabado ? 'checked' : ''}> Trabajo los sábados</label>
    <div class="md-grid" id="md-sabado" ${d.atiende_sabado ? '' : 'hidden'}>
      <label class="v-field">Los sábados termino a las<input class="v-input" type="time" name="fin_sabado" value="${esc(hhmm(d.jornada_fin_sabado))}"></label>
    </div>
    <label class="md-check"><input type="checkbox" name="domingo" ${d.atiende_domingo ? 'checked' : ''}> Trabajo los domingos</label>
    <label class="md-check"><input type="checkbox" name="festivos" ${d.atiende_festivos ? 'checked' : ''}> Trabajo los festivos</label>
    <h3>Almuerzo</h3>
    <label class="v-field">¿Cómo es tu almuerzo?
      <select class="v-input" name="almuerzo">
        <option value="empresa" ${modoAlmuerzo === 'empresa' ? 'selected' : ''}>El de la empresa (${esc(textoEmpresa)})</option>
        <option value="propio" ${modoAlmuerzo === 'propio' ? 'selected' : ''}>Uno propio</option>
        <option value="sin" ${modoAlmuerzo === 'sin' ? 'selected' : ''}>No tengo hora de almuerzo</option>
      </select></label>
    <div class="md-grid" id="md-almuerzo" ${modoAlmuerzo === 'propio' ? '' : 'hidden'}>
      <label class="v-field">Desde<input class="v-input" type="time" name="alm_inicio" value="${esc(hhmm(d.almuerzo_inicio) || '12:00')}"></label>
      <label class="v-field">Hasta<input class="v-input" type="time" name="alm_fin" value="${esc(hhmm(d.almuerzo_fin) || '13:00')}"></label>
    </div>
    <p class="md-error" id="md-error" role="alert" hidden></p>
    <div class="md-acciones"><button type="submit" class="v-btn v-primary">Guardar mi jornada</button></div>
  </form>

  <form id="md-aus" class="md-card">
    <h3>Vacaciones, incapacidades o días libres</h3>
    <p class="md-nota">Mientras estés ausente no te llegan citas nuevas y otro asesor de tu ciudad te reemplaza. Para un solo día, pon la misma fecha en las dos casillas.</p>
    <div class="md-grid">
      <label class="v-field">Desde<input class="v-input" type="date" name="desde" min="${hoy}" required></label>
      <label class="v-field">Hasta<input class="v-input" type="date" name="hasta" min="${hoy}" required></label>
    </div>
    <label class="v-field">Motivo (opcional)<input class="v-input" type="text" name="motivo" maxlength="120" placeholder="Vacaciones, incapacidad, trámite…"></label>
    <p class="md-error" id="md-aus-error" role="alert" hidden></p>
    <p class="md-aviso" id="md-aus-aviso" role="status" hidden></p>
    <div class="md-acciones"><button type="submit" class="v-btn v-primary">Registrar ausencia</button></div>
    <h4>Próximas ausencias</h4>
    ${vigentes.length ? `<ul class="md-lista">${vigentes.map(fila).join('')}</ul>` : '<p class="md-nota">No tienes ausencias registradas.</p>'}
    ${pasadas.length ? `<details><summary>Ausencias recientes ya terminadas (${pasadas.length})</summary><ul class="md-lista">${pasadas.map((x) => `<li><span>${esc(fechaCorta(x.fecha_inicio))}${x.fecha_fin !== x.fecha_inicio ? ' → ' + esc(fechaCorta(x.fecha_fin)) : ''}${x.motivo ? ' · ' + esc(x.motivo) : ''}</span></li>`).join('')}</ul></details>` : ''}
  </form>
</section>`;

    const f = el.querySelector('#md-form');
    f.sabado.onchange = () => { el.querySelector('#md-sabado').hidden = !f.sabado.checked; };
    f.almuerzo.onchange = () => { el.querySelector('#md-almuerzo').hidden = f.almuerzo.value !== 'propio'; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#md-error');
      err.hidden = true;
      const boton = f.querySelector('button[type=submit]');
      boton.disabled = true;
      const { error: errGuardar } = await supabase.rpc('agenda_mi_disponibilidad_guardar', {
        p_empresa_id: empresaId, p_jornada_inicio: f.inicio.value, p_jornada_fin: f.fin.value,
        p_atiende_sabado: f.sabado.checked, p_jornada_fin_sabado: f.sabado.checked ? f.fin_sabado.value || null : null,
        p_atiende_domingo: f.domingo.checked, p_atiende_festivos: f.festivos.checked,
        p_almuerzo: f.almuerzo.value, p_almuerzo_inicio: f.almuerzo.value === 'propio' ? f.alm_inicio.value || null : null,
        p_almuerzo_fin: f.almuerzo.value === 'propio' ? f.alm_fin.value || null : null,
      });
      boton.disabled = false;
      if (errGuardar) { err.textContent = mensaje(errGuardar, 'No se pudo guardar.'); err.hidden = false; return; }
      toast?.('Tu jornada quedó guardada');
    };

    const a = el.querySelector('#md-aus');
    a.onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#md-aus-error');
      const aviso = el.querySelector('#md-aus-aviso');
      err.hidden = true; aviso.hidden = true;
      const boton = a.querySelector('button[type=submit]');
      boton.disabled = true;
      const { data: r, error: errAus } = await supabase.rpc('agenda_mi_ausencia_agregar', {
        p_empresa_id: empresaId, p_inicio: a.desde.value, p_fin: a.hasta.value, p_motivo: a.motivo.value.trim() || null,
      });
      boton.disabled = false;
      if (errAus) { err.textContent = mensaje(errAus, 'No se pudo registrar la ausencia.'); err.hidden = false; return; }
      const citas = Number(r?.citas_afectadas || 0);
      await recargar();
      if (citas > 0) {
        const nuevo = el.querySelector('#md-aus-aviso');
        nuevo.textContent = `Ojo: ya tienes ${citas} cita${citas === 1 ? '' : 's'} en esas fechas. El sistema no las mueve solo: avisa a tu administrador o reubícalas desde la agenda.`;
        nuevo.hidden = false;
      }
      toast?.('Ausencia registrada');
    };
    el.querySelectorAll('[data-quitar]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const { error: errQuitar } = await supabase.rpc('agenda_mi_ausencia_eliminar', { p_empresa_id: empresaId, p_id: b.dataset.quitar });
        if (errQuitar) { b.disabled = false; toast?.('No se pudo quitar la ausencia'); return; }
        await recargar();
        toast?.('Ausencia quitada');
      };
    });
  }

  async function recargar() {
    const { data: nuevo, error: errRecarga } = await supabase.rpc('agenda_mi_disponibilidad', { p_empresa_id: empresaId });
    if (!errRecarga && nuevo) pintar(nuevo);
  }
}
