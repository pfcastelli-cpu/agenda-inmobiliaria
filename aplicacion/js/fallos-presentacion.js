import { escapar as esc, fechaHora } from './soporte-comun/formato.js';
export const ESTADOS_FALLO={abierto:'Abierto',en_revision:'En revisión',resuelto:'Resuelto'};
const DESCRIPCIONES={CORREO_NO_ENVIADO:'No se pudo enviar un correo',JS_ERROR:'La pantalla encontró un error',JS_PROMESA_RECHAZADA:'Una operación de la pantalla no terminó',RED_NO_DISPONIBLE:'No se pudo conectar con el servicio',HTTP_ERROR:'El servicio rechazó una operación',PORTAL_ERROR:'No se pudo completar una acción de la visita',PROPUESTA_NO_DISPONIBLE:'La hora propuesta dejó de estar disponible',PRUEBA_REGISTRO:'Comprobación del registro de fallos'};
export function tarjetaFallo(f,notas={}) {
  return `<article class="fs-fallo" aria-labelledby="fs-titulo-${esc(f.id)}">
    <div class="fs-cabecera"><div><h3 id="fs-titulo-${esc(f.id)}">${esc(DESCRIPCIONES[f.codigo]||f.codigo)}</h3>
      <p>${esc(f.modulo)}${f.operacion?` / ${esc(f.operacion)}`:''}${f.empresa_nombre?` · ${esc(f.empresa_nombre)}`:''}</p></div>
      <span class="fs-estado">${esc(ESTADOS_FALLO[f.estado]||f.estado)}${f.es_prueba?' · Prueba':''}</span></div>
    <dl class="fs-datos"><div><dt>Última vez</dt><dd>${esc(fechaHora(f.ultima_vez))}</dd></div><div><dt>Repeticiones</dt><dd>${Number(f.repeticiones)||1}</dd></div>
      <div><dt>Tipo</dt><dd>${f.nivel==='aviso'?'Aviso':'Error'}${f.http_status?` · HTTP ${Number(f.http_status)}`:''}</dd></div></dl>
    <details><summary>Seguimiento y resolución</summary><p class="fs-codigo">Código: ${esc(f.codigo)} · Primera vez: ${esc(fechaHora(f.primera_vez))}</p>
      <ol class="fs-historial">${(f.historial||[]).map(h=>`<li><time>${esc(fechaHora(h.creado_en))}</time> <b>${esc(ESTADOS_FALLO[h.estado]||h.estado)}</b><p>${esc(h.nota)}</p></li>`).join('')}</ol>
      <form data-fs-guardar="${esc(f.id)}"><label>Estado<select name="estado">${Object.entries(ESTADOS_FALLO).map(([v,t])=>`<option value="${v}" ${v===f.estado?'selected':''}>${t}</option>`).join('')}</select></label>
      <label>Qué se revisó o corrigió<textarea name="nota" maxlength="1000" rows="3" placeholder="Indica la corrección y la prueba realizada. No incluyas contraseñas ni datos de clientes.">${esc(notas[f.id]||'')}</textarea></label>
      <button type="submit">Guardar seguimiento</button></form></details></article>`;
}
