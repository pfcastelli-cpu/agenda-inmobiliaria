// Pantalla «Registro»: quién creó, eliminó o cambió asesores, accesos, roles, ciudades y configuración (sql/066).
// Solo la ve quien tenga el permiso «auditoria.ver». Nunca muestra contraseñas ni claves.
import { mejorarTablas } from './tablas-ordenables.js';

const ENTIDADES = {
  agenda_asesores: 'Asesores', agenda_miembros: 'Accesos', agenda_roles: 'Roles', agenda_rol_permisos: 'Permisos de roles',
  agenda_configuracion: 'Configuración', agenda_ciudades: 'Ciudades', agenda_coberturas: 'Coberturas',
};
const ui = { entidad: 'todas', dias: 30 };

export async function renderAuditoria({ el, supabase, empresaId, escape }) {
  el.innerHTML = '<p class="v-muted">Cargando el registro…</p>';
  const desde = new Date(Date.now() - ui.dias * 86400000).toISOString();
  let q = supabase.from('agenda_auditoria').select('id, creado_en, usuario_correo, accion, entidad, descripcion, detalle').eq('empresa_id', empresaId).gte('creado_en', desde).order('creado_en', { ascending: false }).limit(500);
  if (ui.entidad !== 'todas') q = q.eq('entidad', ui.entidad);
  const { data, error } = await q;
  const filas = data || [];
  const cuando = (iso) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
  const resumen = (f) => {
    const d = f.detalle || {};
    if (f.accion === 'cambió') {
      const c = d.cambios ? Object.entries(d.cambios).map(([k, v]) => `${k}: ${v.antes ?? '—'} → ${v.despues ?? '—'}`) : [];
      const otros = (d.campos || []).filter((k) => !(d.cambios && k in d.cambios));
      return [...c, otros.length ? `También: ${otros.join(', ')}` : ''].filter(Boolean).join(' · ');
    }
    return '';
  };
  el.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Control</div><h2>Registro de cambios</h2></div></div>
    <p class="v-note">Quién hizo qué en el sistema: asesores creados, eliminados o desactivados, accesos, roles y permisos, y cambios de configuración. No guarda contraseñas ni claves. Quién puede ver esta pantalla se define en Configuración → Roles (permiso «Ver el registro de cambios del sistema»).</p>
    <div class="v-filters" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <label class="v-field">Qué<select id="aud-entidad" class="v-input"><option value="todas">Todo</option>${Object.entries(ENTIDADES).map(([k, t]) => `<option value="${k}" ${ui.entidad === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="v-field">Periodo<select id="aud-dias" class="v-input">${[7, 30, 90, 365].map((d) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>Últimos ${d} días</option>`).join('')}</select></label>
    </div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">No se pudo leer el registro. Puede que falte aplicar el SQL 066 o que no tengas permiso.</div>` : ''}
    <div style="overflow-x:auto;margin-top:12px"><table class="v-tabla-res" style="width:100%;border-collapse:collapse;min-width:640px">
      <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Sobre</th><th>Detalle</th></tr></thead>
      <tbody>${filas.length ? filas.map((f) => `<tr><td>${escape(cuando(f.creado_en))}</td><td>${escape(f.usuario_correo || 'Sistema')}</td><td>${escape(f.accion)}</td><td>${escape(ENTIDADES[f.entidad] || f.entidad)}: ${escape(f.descripcion || '')}</td><td>${escape(resumen(f))}</td></tr>`).join('') : '<tr><td colspan="5">Sin movimientos en este periodo.</td></tr>'}</tbody>
    </table></div>`;
  el.querySelector('#aud-entidad').onchange = (e) => { ui.entidad = e.target.value; renderAuditoria({ el, supabase, empresaId, escape }); };
  el.querySelector('#aud-dias').onchange = (e) => { ui.dias = Number(e.target.value); renderAuditoria({ el, supabase, empresaId, escape }); };
  mejorarTablas(el);
}
