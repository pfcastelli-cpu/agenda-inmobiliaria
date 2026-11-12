// Pestaña «Propuestas de compra» (dentro de «Por atender»): negociaciones del valor de compra de inmuebles en venta (sql/082, función portal-negociacion).
// Muestra, por inmueble, quién propuso qué valor, de quién es el turno y, cuando se acuerda el valor, los datos que dejó el comprador para la promesa.
// Los datos llegan por la función agenda_negociaciones_listar (administración/coordinación, el asesor de la visita y sus supervisores).
const ui = { filtro: 'abiertas', abierto: null };
const ESTADO = { abierta: 'En conversación', acordada: 'Valor acordado', sin_acuerdo: 'Sin acuerdo', vencida: 'Vencida' };
const PAGO = { contado: 'Recursos propios', credito_hipotecario: 'Crédito hipotecario', subsidio: 'Subsidio', mixto: 'Mixta', otro: 'Otra' };
const CIVIL = { soltero: 'Soltero(a)', casado: 'Casado(a)', union_libre: 'Unión marital de hecho', divorciado: 'Divorciado(a)', viudo: 'Viudo(a)' };
const ROT = { propuesta: 'Propuesta del comprador', contrapropuesta: 'Contrapropuesta del propietario', acepta: 'Aceptó', rechaza: 'No continuó' };
const pesos = (n) => (n == null ? '—' : `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`);

export async function contarPropuestasPendientes(supabase, empresaId) {
  const { data } = await supabase.rpc('agenda_negociaciones_listar', { p_empresa_id: empresaId });
  return (data || []).filter((n) => n.estado === 'abierta' || (n.estado === 'acordada' && !n.promesa)).length;
}

export async function renderPropuestasCompra(ctx) {
  const { el, supabase, empresaId, escape, icon, refreshIcons } = ctx;
  el.innerHTML = '<p class="v-muted">Cargando propuestas…</p>';
  const { data, error } = await supabase.rpc('agenda_negociaciones_listar', { p_empresa_id: empresaId });
  const todas = data || [];
  const filas = todas.filter((n) => (ui.filtro === 'abiertas' ? ['abierta', 'acordada'].includes(n.estado) : ui.filtro === 'cerradas' ? ['sin_acuerdo', 'vencida'].includes(n.estado) : true));
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const chip = (estado) => `<span style="align-self:flex-start;padding:3px 10px;border-radius:999px;font-size:12.5px;font-weight:600;background:var(--tema-suave,#eef2f6);color:var(--tema-principal,#1A2C45)">${escape(ESTADO[estado] || estado)}</span>`;
  const quien = (n) => (n.estado !== 'abierta' ? '' : n.turno === 'propietario' ? 'Esperando al propietario' : 'Esperando al comprador');
  const dato = (k, v) => (v ? `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--tema-borde,#e7ebee)"><span class="v-muted" style="width:170px;flex:none;font-size:13px">${escape(k)}</span><span style="font-size:14px;overflow-wrap:anywhere">${escape(v)}</span></div>` : '');
  const tarjeta = (n) => {
    const p = n.promesa;
    return `<article class="v-card" style="padding:16px;margin-top:12px" data-id="${escape(n.id)}">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><strong>Inmueble Nº ${escape(n.numero_inmueble || '')}</strong><div class="v-muted" style="font-size:13px">${escape(n.direccion || '')}</div>
          <div class="v-muted" style="font-size:13px">Comprador: ${escape(n.cliente_nombre || '—')} · Asesor: ${escape(n.asesor || '—')} · Desde ${escape(fecha(n.creado_en))}</div></div>
        ${chip(n.estado)}
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:12px">
        <div><div class="v-muted" style="font-size:12.5px">Valor publicado</div><strong>${escape(pesos(n.valor_publicado))}</strong></div>
        <div><div class="v-muted" style="font-size:12.5px">${n.estado === 'acordada' ? 'Valor acordado' : 'Último valor'}</div><strong style="font-size:18px">${escape(pesos(n.estado === 'acordada' ? n.valor_acordado : n.valor_vigente))}</strong></div>
        ${quien(n) ? `<div style="align-self:flex-end" class="v-muted">${escape(quien(n))}${n.vence_en ? ` · vence ${escape(fecha(n.vence_en))}` : ''}</div>` : ''}
      </div>
      ${n.estado === 'acordada' ? `<p class="${p ? 'v-muted' : 'v-error'}" style="margin:10px 0 0;font-size:13.5px">${p ? 'El comprador ya dejó los datos para la promesa.' : 'Falta que el comprador deje los datos para la promesa.'}</p>` : ''}
      <div style="margin-top:10px"><button type="button" class="v-btn v-quiet" data-ver="${escape(n.id)}">${ui.abierto === n.id ? 'Ocultar detalle' : 'Ver historial y datos'}</button></div>
      ${ui.abierto === n.id ? `<div style="margin-top:12px">
        <strong style="font-size:13px">Historial de valores</strong>
        ${(n.movimientos || []).map((m) => dato(`${ROT[m.accion] || m.accion} · ${fecha(m.en)}`, m.valor ? pesos(m.valor) : '—')).join('') || '<p class="v-muted" style="font-size:13px">Aún no hay valores propuestos.</p>'}
        ${p ? `<strong style="font-size:13px;display:block;margin-top:14px">Datos para la promesa (confidenciales)</strong>
          ${dato('Tipo de persona', p.tipo_persona === 'juridica' ? 'Empresa' : 'Persona natural')}${dato('Nombre o razón social', p.nombre_completo)}${dato('Documento', `${p.tipo_documento} ${p.numero_documento}`)}
          ${dato('Representante legal', p.representante_legal)}${dato('Estado civil', CIVIL[p.estado_civil])}${dato('Correo', p.email)}${dato('Celular', p.celular)}${dato('Dirección', p.direccion)}
          ${dato('Forma de pago', PAGO[p.forma_pago])}${dato('Compra con otros', p.compra_con_otros ? (p.otros_compradores || 'Sí') : '')}${dato('Autorización de datos', `Aceptada el ${fecha(p.autorizado_en)}`)}
          <p class="v-note" style="margin-top:10px">Antes de enviar el borrador de la promesa: confirma por escrito con el propietario, revisa el certificado de tradición y libertad, verifica quién firma y pide que un abogado revise el borrador. Los documentos del comprador deben llegar al correo de la empresa, no a este sistema.</p>` : ''}
      </div>` : ''}
    </article>`;
  };
  el.innerHTML = `<div class="v-top"><div><div class="v-eyebrow">Ventas</div><h2>Propuestas de compra</h2></div></div>
    <p class="v-note">Cuando un cliente dice «Quiero avanzar» en un inmueble en venta, propone un valor y el propietario acepta o propone otro, por correo. Solo se intercambian cifras. Tú recibes un aviso de cada movimiento. Nada es vinculante hasta la firma de la promesa de compraventa.</p>
    <div class="v-filters" style="margin-top:14px"><label class="v-field">Mostrar<select id="pc-filtro" class="v-input">${[['abiertas', 'En curso'], ['cerradas', 'Cerradas'], ['todas', 'Todas']].map(([v, t]) => `<option value="${v}" ${ui.filtro === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    ${error ? `<div class="v-error" role="alert" style="margin-top:12px">${escape(error.message)}</div>` : ''}
    ${filas.length ? filas.map(tarjeta).join('') : `<div class="v-empty" style="margin-top:16px">${icon('handshake')}<h3>Sin propuestas</h3><p style="margin-top:8px">No hay propuestas con este filtro.</p></div>`}`;
  refreshIcons?.();
  el.querySelector('#pc-filtro').onchange = (e) => { ui.filtro = e.target.value; renderPropuestasCompra(ctx); };
  el.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => { ui.abierto = ui.abierto === b.dataset.ver ? null : b.dataset.ver; renderPropuestasCompra(ctx); }; });
}
