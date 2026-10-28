import '../estilos/fallos.css';
import { escapar as esc } from './soporte-comun/formato.js';
import { ESTADOS_FALLO as ESTADOS, tarjetaFallo } from './fallos-presentacion.js';

export async function montarFallos({el,supabase,empresaId=null,empresas=[],volver}) {
  const estado={filtro:'abiertos',pruebas:'todos',empresa:empresaId||'',pagina:0,notas:{},mensaje:'',error:''};
  async function pintar() {
    el.innerHTML='<p role="status">Cargando fallos del sistema…</p>';
    let datos={items:[],total:0};
    try {
      const r=await supabase.rpc('agenda_fallos_listar',{p_empresa_id:estado.empresa||null,p_estado:estado.filtro,p_pruebas:estado.pruebas==='todos'?null:estado.pruebas==='pruebas',p_pagina:estado.pagina});
      if(r.error) throw new Error(r.error.message);
      datos=r.data||datos;
    } catch { estado.error='No se pudo cargar el registro de fallos. Reintenta en unos minutos.'; }
    el.innerHTML=`<section class="fs-panel"><nav class="fs-nav" aria-label="Secciones de soporte"><button id="fs-volver">Solicitudes de ayuda</button><button aria-current="page" disabled>Fallos del sistema</button></nav>
      <header><h2>Fallos del sistema</h2><p>Errores detectados al usar la agenda, gestionar visitas o enviar correos. Las repeticiones se agrupan; si un fallo resuelto reaparece, vuelve a abrirse.</p></header>
      <div class="fs-filtros"><label>Estado<select id="fs-estado"><option value="abiertos">Por atender</option>${Object.entries(ESTADOS).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}<option value="todos">Todos</option></select></label>
        <label>Origen<select id="fs-pruebas"><option value="todos">Operación y pruebas</option><option value="operacion">Solo operación</option><option value="pruebas">Solo pruebas</option></select></label>
        ${!empresaId&&empresas.length?`<label>Empresa<select id="fs-empresa"><option value="">Todas</option>${empresas.map(e=>`<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('')}</select></label>`:''}
        <button id="fs-actualizar">Actualizar</button></div>
      ${estado.error?`<p role="alert" class="fs-error">${esc(estado.error)}</p>`:''}${estado.mensaje?`<p role="status">${esc(estado.mensaje)}</p>`:''}
      <p class="fs-conteo">${Number(datos.total)||0} fallos con estos filtros.</p>
      ${datos.items.map(f=>tarjetaFallo(f,estado.notas)).join('')||(!estado.error?'<div class="fs-vacio">No hay fallos registrados con estos filtros.</div>':'')}
      <div class="fs-paginas"><button id="fs-anterior" ${estado.pagina===0?'disabled':''}>Anterior</button><span>Página ${estado.pagina+1}</span><button id="fs-siguiente" ${(estado.pagina+1)*30>=datos.total?'disabled':''}>Siguiente</button></div>
      <p class="fs-privacidad">El registro automático guarda códigos técnicos. No guarda el contenido de los formularios ni los enlaces personales. Las notas de seguimiento las escribe el equipo.</p></section>`;
    el.querySelector('#fs-volver').onclick=volver;
    for(const [id,campo] of [['fs-estado','filtro'],['fs-pruebas','pruebas'],['fs-empresa','empresa']]) {
      const c=el.querySelector(`#${id}`);if(!c) continue;c.value=estado[campo];
      c.onchange=()=>{estado[campo]=c.value;estado.pagina=0;estado.error='';estado.mensaje='';pintar();};
    }
    el.querySelector('#fs-actualizar').onclick=()=>{estado.error='';pintar();};
    el.querySelector('#fs-anterior').onclick=()=>{estado.pagina--;pintar();};
    el.querySelector('#fs-siguiente').onclick=()=>{estado.pagina++;pintar();};
    el.querySelectorAll('form[data-fs-guardar]').forEach(form=>{
      const id=form.dataset.fsGuardar;
      form.elements.nota.oninput=()=>{form.elements.nota.setCustomValidity('');estado.notas[id]=form.elements.nota.value;};
      form.onsubmit=async e=>{
        e.preventDefault();const nota=form.elements.nota.value.trim(),nuevo=form.elements.estado.value;
        if(nuevo==='resuelto'&&nota.length<5){form.elements.nota.setCustomValidity('Explica qué se corrigió y cómo se comprobó.');form.elements.nota.reportValidity();return;}
        form.elements.nota.setCustomValidity('');form.querySelector('button').disabled=true;
        try {
          const r=await supabase.rpc('agenda_fallo_gestionar',{p_id:id,p_estado:nuevo,p_nota:nota});if(r.error) throw r.error;
          delete estado.notas[id];estado.mensaje='Seguimiento guardado.';estado.error='';
        } catch {estado.error='No se pudo guardar el seguimiento. Tu nota se conserva.';}
        pintar();
      };
    });
  }
  await pintar();
}
