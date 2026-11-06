// Pantalla «Estudios» (administrador/coordinador): lista de estudios de mercado pedidos por propietarios o por el equipo.
// Flujo: pedido (pendiente) → el asesor sube el PDF (listo) → «Enviar al propietario» (enviado, función enviar-estudio-mercado).
// Tabla agenda_estudios_mercado y bucket privado «estudios-mercado» (sql/053). Mismo estilo visual que Pendientes (clases v-*).
const ui = { filtro: 'abiertos', mensaje: '', error: '' };
const ETIQUETA = { pendiente: 'Pendiente', listo: 'Listo para enviar', enviado: 'Enviado', descartado: 'Descartado' };
const ORIGEN = { propietario: 'Lo pidió el propietario', informe: 'Desde el informe', manual: 'Creado por el equipo' };

export async function renderEstudios(ctx) {
  const { el, supabase, empresaId, escape, icon, refreshIcons } = ctx;
  el.innerHTML = '<p class="v-muted">Cargando estudios…</p>';
  let q = supabase.from('agenda_estudios_mercado').select('*').eq('empresa_id', empresaId).order('creado_en', { ascending: false }).limit(200);
  if (ui.filtro === 'abiertos') q = q.in('estado', ['pendiente', 'listo']);
  else if (ui.filtro !== 'todos') q = q.eq('estado', ui.filtro);
  const { data, error } = await q;
  const filas = data || [];
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const tarjeta = (f) => `<article class="v-card" style="padding:16px;margin-top:12px" data-id="${f.id}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><strong>${f.numero_inmueble ? `Inmueble Nº ${escape(f.numero_inmueble)}` : 'Inmueble sin número'}</strong>
        <div class="v-muted" style="font-size:13px">${escape(ORIGEN[f.origen] || '')} · ${escape(fecha(f.creado_en))}</div></div>
      <span style="align-self:flex-start;padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:600;background:var(--tema-suave,#eef2f6);color:var(--tema-principal,#1A2C45)">${escape(ETIQUETA[f.estado] || f.estado)}</span>
    </div>
    ${f.nota ? `<p style="margin:10px 0 0;font-size:13.5px;white-space:pre-line">${escape(f.nota)}</p>` : ''}
    <div class="v-filters" style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label class="v-field">Propietario<input class="v-input" data-campo="propietario_nombre" value="${escape(f.propietario_nombre || '')}" placeholder="Nombre"></label>
      <label class="v-field">Correo del propietario<input class="v-input" type="email" data-campo="propietario_email" value="${escape(f.propietario_email || '')}" placeholder="correo@ejemplo.com"></label>
      ${f.estado === 'enviado' ? '' : `<button type="button" class="v-btn v-quiet" data-accion="guardar">${icon('save')}Guardar datos</button>`}
    </div>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      ${f.archivo_nombre ? `<button type="button" class="v-btn v-quiet" data-accion="ver">${icon('file-text')}${escape(f.archivo_nombre)}</button>` : '<span class="v-muted" style="font-size:13px">Aún sin PDF</span>'}
      ${f.estado === 'enviado' ? `<span class="v-muted" style="font-size:13px">Enviado el ${escape(fecha(f.enviado_en))}</span>` : `
        <label class="v-btn v-quiet" style="cursor:pointer">${icon('upload')}${f.archivo_path ? 'Cambiar PDF' : 'Cargar PDF'}<input type="file" accept="application/pdf" hidden data-accion="subir"></label>
        <button type="button" class="v-btn v-primary" data-accion="enviar" ${f.archivo_path ? '' : 'disabled'}>${icon('send')}Enviar al propietario</button>
        <button type="button" class="v-btn v-quiet" data-accion="descartar">${icon('x')}Descartar</button>`}
    </div></article>`;
  el.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Propietarios</div><h2>Estudios de mercado</h2></div>
      <button type="button" class="v-btn v-primary" data-accion="nuevo">${icon('plus')}Nuevo estudio</button></div>
    <p class="v-note">Cuando un propietario pide el estudio sin costo aparece aquí. Carga el PDF (generado en tu proyecto de estudios de mercado), revísalo y pulsa «Enviar al propietario». Con el modo de pruebas activo el correo llega solo al correo de pruebas.</p>
    <div class="v-filters" style="margin-top:14px"><label class="v-field">Mostrar<select id="est-filtro" class="v-input">
      ${[['abiertos', 'Por hacer'], ['enviado', 'Enviados'], ['descartado', 'Descartados'], ['todos', 'Todos']].map(([v, t]) => `<option value="${v}" ${ui.filtro === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(error.message)}</div>` : ''}
    ${ui.error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(ui.error)}</div>` : ''}
    ${ui.mensaje ? `<p class="v-note" role="status" style="margin-top:12px">${escape(ui.mensaje)}</p>` : ''}
    ${filas.length ? filas.map(tarjeta).join('') : `<div class="v-empty" style="margin-top:16px">${icon('file-text')}<h3>Sin estudios</h3><p style="margin-top:8px">No hay estudios con este filtro.</p></div>`}`;
  refreshIcons?.();
  const recargar = (mensaje = '', err = '') => { ui.mensaje = mensaje; ui.error = err; return renderEstudios(ctx); };
  el.querySelector('#est-filtro').onchange = (e) => { ui.filtro = e.target.value; ui.mensaje = ui.error = ''; renderEstudios(ctx); };
  el.querySelector('[data-accion=nuevo]').onclick = async () => {
    const numero = Number(window.prompt('Número del inmueble (opcional):', '')) || null;
    const { error: e } = await supabase.from('agenda_estudios_mercado').insert({ empresa_id: empresaId, numero_inmueble: numero, origen: 'manual' });
    recargar(e ? '' : 'Estudio creado. Completa el correo del propietario y carga el PDF.', e ? e.message : '');
  };
  el.querySelectorAll('article[data-id]').forEach((card) => {
    const id = card.dataset.id; const f = filas.find((x) => x.id === id);
    const campo = (n) => card.querySelector(`[data-campo=${n}]`).value.trim() || null;
    const on = (a, fn) => { const n = card.querySelector(`[data-accion=${a}]`); if (n) n[a === 'subir' ? 'onchange' : 'onclick'] = fn; };
    on('guardar', async () => {
      const { error: e } = await supabase.from('agenda_estudios_mercado').update({ propietario_nombre: campo('propietario_nombre'), propietario_email: campo('propietario_email') }).eq('id', id);
      recargar(e ? '' : 'Datos guardados.', e ? e.message : '');
    });
    on('ver', async () => {
      const { data: s, error: e } = await supabase.storage.from('estudios-mercado').createSignedUrl(f.archivo_path, 120);
      if (e || !s?.signedUrl) return recargar('', e?.message || 'No se pudo abrir el PDF.');
      window.open(s.signedUrl, '_blank', 'noopener');
    });
    on('subir', async (ev) => {
      const archivo = ev.target.files?.[0]; if (!archivo) return;
      if (archivo.type !== 'application/pdf' || archivo.size > 15 * 1024 * 1024) return recargar('', 'El archivo debe ser un PDF de máximo 15 MB.');
      const ruta = `${empresaId}/${id}.pdf`;
      const { error: e1 } = await supabase.storage.from('estudios-mercado').upload(ruta, archivo, { upsert: true, contentType: 'application/pdf' });
      if (e1) return recargar('', e1.message);
      const { error: e2 } = await supabase.from('agenda_estudios_mercado').update({ archivo_path: ruta, archivo_nombre: archivo.name, estado: 'listo', subido_en: new Date().toISOString() }).eq('id', id);
      recargar(e2 ? '' : 'PDF cargado. Revísalo y pulsa «Enviar al propietario».', e2 ? e2.message : '');
    });
    on('enviar', async () => {
      if (!campo('propietario_email')) return recargar('', 'Escribe el correo del propietario y pulsa «Guardar datos» antes de enviar.');
      await supabase.from('agenda_estudios_mercado').update({ propietario_nombre: campo('propietario_nombre'), propietario_email: campo('propietario_email') }).eq('id', id);
      if (!window.confirm('¿Enviar el estudio al propietario?')) return;
      const { data: r, error: e } = await supabase.functions.invoke('enviar-estudio-mercado', { body: { estudio_id: id } });
      if (e || !r?.ok) return recargar('', r?.error || e?.message || 'No se pudo enviar.');
      recargar(r.modo_pruebas ? `Enviado (modo de pruebas: llegó a ${r.enviado_a}).` : 'Estudio enviado al propietario.');
    });
    on('descartar', async () => {
      if (!window.confirm('¿Descartar este estudio?')) return;
      const { error: e } = await supabase.from('agenda_estudios_mercado').update({ estado: 'descartado' }).eq('id', id);
      recargar(e ? '' : 'Estudio descartado.', e ? e.message : '');
    });
  });
}
