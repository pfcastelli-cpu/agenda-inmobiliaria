import { supabase } from './cliente-supabase.js';
import { invalidarDominioPublico } from './agenda-real.js';
import '../estilos/administracion.css';
let root, acceso, config, asesores = [], ciudades = [], asesorCiudades = {}, coberturas = [], asesorCoberturas = {}, revision = 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PALETA_ASESORES=['#2563EB','#DB2777','#059669','#D97706','#7C3AED','#DC2626','#0891B2','#65A30D'];
const defaults = e => ({empresa_id:e.id,nombre_comercial:e.nombre,logo_url:'',color_principal:e.color_principal || '#1A2C45',color_accion:e.color_accion || '#00A9A5',correo_contacto:'',telefono:'',ciudades:'Bogotá, Barranquilla, Medellín',enlace_documentos:'',dominio_publico:'',plantilla_enlace_inmueble:'',formato_hora:'12h',horas_minimas_anticipacion:2,horas_minimas_anticipacion_mismo_inmueble:1,duracion_visita_minutos:60,modo_mismo_inmueble:'separado',separacion_mismo_inmueble_minutos:15,minutos_traslado_entre_inmuebles:30,radio_zona_km:7,valor_minimo_canon_seguimiento:0,valor_minimo_venta_seguimiento:0,valor_alto_canon_zona:0,valor_alto_venta_zona:0,almuerzo_activo:true,almuerzo_inicio:'12:00',almuerzo_fin:'13:00',pais:'CO',equipo_visible_roles:['administrador']});
const campo = (name,label,value='',type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function aviso(texto,error=false){const e=root?.querySelector('[role=status]');if(e){e.textContent=texto;e.classList.toggle('error',error);}}
function colorTexto(hex){const a=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722>.179?'#111111':'#ffffff';}
function marca(){
 document.documentElement.style.setProperty('--empresa-principal',config.color_principal);
 document.documentElement.style.setProperty('--empresa-texto-principal',colorTexto(config.color_principal));
 document.documentElement.style.setProperty('--empresa-accion',config.color_accion);
 document.documentElement.style.setProperty('--empresa-texto',colorTexto(config.color_accion));
 const head=document.querySelector('.pa-head > div');
 head.replaceChildren();
 if(config.logo_url){const img=document.createElement('img');img.src=config.logo_url;img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove());head.append(img);}
 const name=document.createElement('strong');name.textContent=config.nombre_comercial;head.append(name);
}
export function limpiarAdministracion(){revision++;root?.remove();root=null;acceso=null;asesores=[];ciudades=[];asesorCiudades={};config=null;document.getElementById('pa-agenda-content').hidden=false;for(const k of ['--empresa-principal','--empresa-accion','--empresa-texto','--empresa-texto-principal'])document.documentElement.style.removeProperty(k);const h=document.querySelector('.pa-head > div');h.innerHTML='<strong>PATRIMONIOS</strong><small>INMOBILIARIOS</small>';}
export async function iniciarAdministracion(a){
 limpiarAdministracion();acceso=a;const turno=revision;
 if(!a.membresia)return;
 config=defaults(a.membresia.empresa);
 const {data,error}=await supabase.from('agenda_configuracion').select('*').eq('empresa_id',config.empresa_id).maybeSingle();
 if(turno!==revision)return;
 if(data)config=data;marca();
 if(a.membresia.rol!=='administrador')return;
 root=document.createElement('section');root.className='ad';root.innerHTML=`<nav aria-label="Administración"><button data-tab="agenda" aria-pressed="true" class="ad-volver">← Volver a la agenda</button><span class="ad-nav-sep"></span><button data-tab="config" aria-pressed="false" class="ad-gear" title="Configuración" aria-label="Configuración"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg><span>Configuración</span></button></nav><p role="status" aria-live="polite"></p><div class="ad-body" hidden><nav class="ad-subnav" aria-label="Configuración"><button data-subtab="equipo" aria-pressed="true">Equipo</button><button data-subtab="ciudades" aria-pressed="false">Ciudades y festivos</button><button data-subtab="marca" aria-pressed="false">Empresa</button><button data-subtab="correo" aria-pressed="false">Correo</button></nav><div class="ad-subbody"></div></div>`;
 document.getElementById('pa-agenda-content').before(root);
 root.querySelector('nav').addEventListener('click',async e=>{const t=e.target.closest('button')?.dataset.tab;if(!t)return;root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===t)));const body=root.querySelector('.ad-body');body.hidden=t==='agenda';document.getElementById('pa-agenda-content').hidden=t!=='agenda';aviso('');if(t==='config')await abrirSubtab(root.querySelector('.ad-subnav [aria-pressed=true]')?.dataset.subtab||'equipo');});
 root.querySelector('.ad-subnav').addEventListener('click',async e=>{const st=e.target.closest('button')?.dataset.subtab;if(!st)return;await abrirSubtab(st);});
 if(error)aviso('Para activar Equipo y Configuración, aplica sql/002-equipo-configuracion.sql en Supabase. La agenda sigue disponible.',true);
}
async function cargarCiudades(){
 const {data}=await supabase.from('agenda_ciudades').select('*').eq('empresa_id',config.empresa_id).order('nombre');
 ciudades=data||[];
 return ciudades;
}
async function cargarAsesorCiudades(){
 const {data}=await supabase.from('agenda_asesores_ciudades').select('asesor_id, ciudad_id, agenda_asesores!inner(empresa_id)').eq('agenda_asesores.empresa_id',config.empresa_id);
 asesorCiudades={};
 for(const fila of (data||[])){(asesorCiudades[fila.asesor_id] ||= []).push(fila.ciudad_id);}
 return asesorCiudades;
}
async function cargarCoberturas(){
 const {data}=await supabase.from('agenda_coberturas').select('*, agenda_ciudades(nombre)').eq('empresa_id',config.empresa_id).order('nombre');
 coberturas=(data||[]).map(c=>({...c,ciudadNombre:c.agenda_ciudades?.nombre||''}));
 return coberturas;
}
async function cargarAsesorCoberturas(){
 const {data}=await supabase.from('agenda_asesores_coberturas').select('asesor_id, cobertura_id, agenda_asesores!inner(empresa_id)').eq('agenda_asesores.empresa_id',config.empresa_id);
 asesorCoberturas={};
 for(const fila of (data||[])){(asesorCoberturas[fila.asesor_id] ||= []).push(fila.cobertura_id);}
 return asesorCoberturas;
}
function nombresCiudades(asesorId){
 const ids=asesorCiudades[asesorId]||[];
 return ids.map(id=>ciudades.find(c=>c.id===id)?.nombre).filter(Boolean).join(', ')||'Sin ciudad asignada';
}
async function abrirSubtab(st){
 root.querySelectorAll('.ad-subnav [data-subtab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.subtab===st)));
 aviso('');
 if(st==='equipo')await equipo();
 if(st==='ciudades')await ciudadesTab();
 if(st==='marca')marcaForm();
 if(st==='correo')await correoForm();
}
async function equipo(){
 const container=root.querySelector('.ad-subbody');container.innerHTML='<p>Cargando equipo…</p>';const turno=revision;
 const {data,error}=await supabase.from('agenda_asesores').select('*').eq('empresa_id',config.empresa_id).order('nombre');
 await cargarCiudades();await cargarAsesorCiudades();await cargarCoberturas();await cargarAsesorCoberturas();
 if(turno!==revision || root.querySelector('[data-subtab=equipo]').getAttribute('aria-pressed')!=='true')return;
 if(error){container.textContent='No se pudo cargar el equipo. Comprueba que la migración 002 esté aplicada y tu usuario sea administrador.';return;}
 asesores=data;container.innerHTML=`<header><div><h2>Tu equipo</h2><p>${asesores.filter(a=>a.activo).length} activos · ${asesores.length} registrados</p></div><button class="ad-primary" id="ad-nuevo">＋ Nuevo asesor</button></header><p class="ad-note">Estas fichas organizan tu equipo. Las invitaciones, contraseñas y permisos de acceso aún no están habilitados; registrar una ficha no crea una cuenta.</p><label>Buscar asesor<input id="ad-buscar" type="search" placeholder="Nombre, correo o ciudad"></label><div class="ad-cards"></div><div id="ad-editor"></div>`;
 container.querySelector('#ad-nuevo').onclick=()=>editor();container.querySelector('#ad-buscar').oninput=e=>cards(e.target.value);cards();
}
function cards(busqueda=''){
 const rows=asesores.filter(a=>[a.nombre,a.correo,nombresCiudades(a.id)].join(' ').toLocaleLowerCase().includes(busqueda.toLocaleLowerCase()));
 const c=root.querySelector('.ad-cards');c.innerHTML=rows.length?rows.map(a=>`<article><div class="ad-avatar" style="background:${a.color||'#e3f8f7'}">${esc(a.nombre.slice(0,1).toUpperCase())}</div><div><h3>${esc(a.nombre)}</h3><p>${esc(a.correo)}<br>${esc(a.celular)}<br>${esc(nombresCiudades(a.id))}</p><span class="ad-pill">${a.activo?'Activo':'Inactivo'}</span> <span class="ad-pill">${esc(a.rol)} · Prioridad ${a.prioridad}</span><span class="ad-pill">${a.tipo_vinculacion==='freelance'?'Freelance':'De planta'}</span><span class="ad-pill">${a.rol==='asesor'?(a.permiso_mover_citas&&a.permiso_eliminar_citas?'Mover y cancelar':a.permiso_mover_citas?'Solo mover':a.permiso_eliminar_citas?'Solo cancelar':'Sin permiso de mover/cancelar'):'Mover y cancelar (por rol)'}</span><span class="ad-pill">${a.atiende_domingo?'Atiende domingos':'No atiende domingos'}</span><span class="ad-pill">${a.atiende_festivos?'Atiende festivos':'No atiende festivos'}</span><p class="ad-muted">Acceso pendiente</p><button data-edit="${a.id}">Editar</button> <button data-toggle="${a.id}">${a.activo?'Desactivar':'Reactivar'}</button></div></article>`).join(''):'<p>No hay asesores para mostrar. Crea el primero para comenzar.</p>';
 c.onclick=async e=>{const id=e.target.dataset.edit || e.target.dataset.toggle;if(!id)return;const a=asesores.find(x=>x.id===id);if(e.target.dataset.edit){editor(a);return;}if(!confirm(`${a.activo?'Desactivar':'Reactivar'} a ${a.nombre}? Se conservará su ficha. Esto todavía no modifica cuentas de acceso ni citas.`))return;e.target.disabled=true;const {error}=await supabase.from('agenda_asesores').update({activo:!a.activo}).eq('id',id).eq('empresa_id',config.empresa_id).select('id').single();if(error){aviso('No se pudo cambiar el estado.',true);e.target.disabled=false;}else{await equipo();aviso('Estado actualizado.');}};
}
async function cargarAusencias(asesorId){
 const {data}=await supabase.from('agenda_asesores_ausencias').select('*').eq('asesor_id',asesorId).order('fecha_inicio',{ascending:false});
 return data||[];
}
function editor(a={}){
 const el=root.querySelector('#ad-editor');
 const ciudadesHtml=ciudades.length?ciudades.map(c=>`<label class="ad-check"><input type="checkbox" name="ciudad" value="${c.id}" ${(asesorCiudades[a.id]||[]).includes(c.id)?'checked':''}> ${esc(c.nombre)}</label>`).join(''):'<p class="ad-muted">Todavía no hay ciudades creadas. Ve a la pestaña "Ciudades y festivos" para agregarlas.</p>';
 const coberturasHtml=coberturas.length?coberturas.map(c=>`<label class="ad-check"><input type="checkbox" name="cobertura" value="${c.id}" ${(asesorCoberturas[a.id]||[]).includes(c.id)?'checked':''}> ${esc(c.nombre)} · ${esc(c.ciudadNombre)}</label>`).join(''):'<p class="ad-muted">Todavía no hay coberturas creadas. Ve a la pestaña "Ciudades y festivos" para agregarlas.</p>';
 el.innerHTML=`<form class="ad-form"><h3>${a.id?'Editar asesor':'Nuevo asesor'}</h3><div class="ad-grid">${campo('nombre','Nombre',a.nombre,'text','required maxlength="120"')}${campo('correo','Correo',a.correo,'email','required')}${campo('celular','Celular con indicativo',a.celular||'+57','tel','required pattern="\\+[1-9][0-9]{7,14}" placeholder="+573001234567"')}<label>Rol<select name="rol"><option value="asesor">Asesor</option><option value="admin">Administrador</option><option value="super_admin">Super administrador</option></select></label><label>Prioridad<select name="prioridad">${[1,2,3,4,5].map(n=>`<option value="${n}">${n}${n===1?' · Mayor prioridad':''}</option>`).join('')}</select></label><label>Vinculación<select name="tipo_vinculacion"><option value="planta">De planta</option><option value="freelance">Freelance</option></select></label><label>Color en la agenda<input type="color" name="color" value="${a.color||PALETA_ASESORES[asesores.length%PALETA_ASESORES.length]}"></label>
 <fieldset><legend>Ciudades que atiende</legend>${ciudadesHtml}</fieldset>
 <fieldset><legend>Coberturas que cubre (para citas de captación)</legend>${coberturasHtml}</fieldset>
 <label class="ad-check"><input type="checkbox" name="permiso_mover_citas"> Puede mover/reprogramar sus propias citas</label>
 <label class="ad-check"><input type="checkbox" name="permiso_eliminar_citas"> Puede cancelar sus propias citas</label>
 <label class="ad-check"><input type="checkbox" name="atiende_sabado"> Atiende sábados</label>
 <label class="ad-check"><input type="checkbox" name="atiende_domingo"> Atiende domingos</label>
 <label class="ad-check"><input type="checkbox" name="atiende_festivos"> Atiende festivos</label>
 <p class="ad-note">Un asesor con rol Administrador o Súper administrador siempre puede mover y cancelar cualquier cita, sin importar estas casillas. Si este asesor está inactivo o en ausencia, otro asesor activo de la misma ciudad (de planta primero) lo reemplaza automáticamente al sugerir horarios.</p>
 <div class="ad-horarios"><h4>Horario de visitas</h4>${campo('jornada_inicio','Hora de entrada',a.jornada_inicio?.slice(0,5)||'08:30','time')}${campo('jornada_fin','Hora de salida (entre semana)',a.jornada_fin?.slice(0,5)||'17:00','time')}${campo('jornada_fin_sabado','Hora de salida (sábado)',a.jornada_fin_sabado?.slice(0,5)||'13:00','time')}</div>
 <div class="ad-horarios"><label class="ad-check"><input type="checkbox" name="almuerzo_activo_personal"> Tiene un horario de almuerzo distinto al de la empresa</label><div id="ad-almuerzo-personal" hidden>${campo('almuerzo_inicio','Almuerzo desde',a.almuerzo_inicio?.slice(0,5)||config.almuerzo_inicio?.slice(0,5)||'12:00','time')}${campo('almuerzo_fin','Almuerzo hasta',a.almuerzo_fin?.slice(0,5)||config.almuerzo_fin?.slice(0,5)||'13:00','time')}</div></div>
 <div class="ad-horarios"><label class="ad-check"><input type="checkbox" name="anticipacion_personal"> Tiene una anticipación mínima para agendar distinta a la de la empresa</label><div id="ad-anticipacion-personal" hidden>${campo('horas_minimas_anticipacion','Anticipación mínima (horas)',a.horas_minimas_anticipacion ?? config.horas_minimas_anticipacion ?? 2,'number','min="0" step="1"')}</div><p class="ad-note">Por defecto usa la anticipación de la empresa (Configuración de empresa). Si este asesor necesita más o menos tiempo de aviso, defínelo aquí.</p></div>
 </div><div class="ad-actions"><button class="ad-primary" type="submit">Guardar asesor</button><button type="button" id="ad-cancelar">Cancelar</button></div></form>${a.id?'<div id="ad-ausencias"><p>Cargando ausencias…</p></div>':''}`;
 el.querySelector('[name=rol]').value=a.rol||'asesor';el.querySelector('[name=prioridad]').value=a.prioridad||3;el.querySelector('[name=tipo_vinculacion]').value=a.tipo_vinculacion||'planta';
 el.querySelector('[name=permiso_mover_citas]').checked=a.id?!!a.permiso_mover_citas:(el.querySelector('[name=tipo_vinculacion]').value==='planta');
 el.querySelector('[name=permiso_eliminar_citas]').checked=a.id?!!a.permiso_eliminar_citas:(el.querySelector('[name=tipo_vinculacion]').value==='planta');
 el.querySelector('[name=atiende_sabado]').checked=a.id?!!a.atiende_sabado:true;
 el.querySelector('[name=atiende_domingo]').checked=!!a.atiende_domingo;
 el.querySelector('[name=atiende_festivos]').checked=!!a.atiende_festivos;
 el.querySelector('[name=almuerzo_activo_personal]').checked=a.almuerzo_activo!=null;
 el.querySelector('#ad-almuerzo-personal').hidden=a.almuerzo_activo==null;
 el.querySelector('[name=almuerzo_activo_personal]').onchange=ev=>{el.querySelector('#ad-almuerzo-personal').hidden=!ev.target.checked;};
 el.querySelector('[name=anticipacion_personal]').checked=a.horas_minimas_anticipacion!=null;
 el.querySelector('#ad-anticipacion-personal').hidden=a.horas_minimas_anticipacion==null;
 el.querySelector('[name=anticipacion_personal]').onchange=ev=>{el.querySelector('#ad-anticipacion-personal').hidden=!ev.target.checked;};
 el.querySelector('[name=tipo_vinculacion]').onchange=ev=>{if(!a.id){const marcar=ev.target.value==='planta';el.querySelector('[name=permiso_mover_citas]').checked=marcar;el.querySelector('[name=permiso_eliminar_citas]').checked=marcar;}};
 el.querySelector('#ad-cancelar').onclick=()=>el.replaceChildren();el.querySelector('[name=nombre]').focus();
 if(a.id)ausenciasSeccion(el.querySelector('#ad-ausencias'),a.id);
 el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target;const v={};v.nombre=f.nombre.value.trim();v.correo=f.correo.value.trim().toLowerCase();v.celular=f.celular.value.replace(/[\s()-]/g,'');v.rol=f.rol.value;v.prioridad=Number(f.prioridad.value);v.tipo_vinculacion=f.tipo_vinculacion.value;v.color=f.color.value;v.empresa_id=config.empresa_id;v.permiso_mover_citas=f.permiso_mover_citas.checked;v.permiso_eliminar_citas=f.permiso_eliminar_citas.checked;v.atiende_sabado=f.atiende_sabado.checked;v.atiende_domingo=f.atiende_domingo.checked;v.atiende_festivos=f.atiende_festivos.checked;v.jornada_inicio=f.jornada_inicio.value;v.jornada_fin=f.jornada_fin.value;v.jornada_fin_sabado=f.jornada_fin_sabado.value;v.almuerzo_activo=f.almuerzo_activo_personal.checked?true:null;v.almuerzo_inicio=f.almuerzo_activo_personal.checked?f.almuerzo_inicio.value:null;v.almuerzo_fin=f.almuerzo_activo_personal.checked?f.almuerzo_fin.value:null;v.horas_minimas_anticipacion=f.anticipacion_personal.checked?Number(f.horas_minimas_anticipacion.value):null;
 const ciudadIds=[...f.querySelectorAll('[name=ciudad]:checked')].map(i=>i.value);
 const coberturaIds=[...f.querySelectorAll('[name=cobertura]:checked')].map(i=>i.value);
 const b=f.querySelector('[type=submit]');b.disabled=true;
 const q=a.id?supabase.from('agenda_asesores').update(v).eq('id',a.id).eq('empresa_id',config.empresa_id):supabase.from('agenda_asesores').insert(v);
 const {data:guardado,error}=await q.select('id').single();
 if(error){b.disabled=false;aviso(error.code==='23505'?'Ya existe un asesor con ese correo en esta empresa.':'No se pudo guardar. Revisa los datos y la conexión.',true);return;}
 const asesorId=guardado.id;
 await supabase.from('agenda_asesores_ciudades').delete().eq('asesor_id',asesorId);
 if(ciudadIds.length)await supabase.from('agenda_asesores_ciudades').insert(ciudadIds.map(ciudad_id=>({asesor_id:asesorId,ciudad_id})));
 await supabase.from('agenda_asesores_coberturas').delete().eq('asesor_id',asesorId);
 if(coberturaIds.length)await supabase.from('agenda_asesores_coberturas').insert(coberturaIds.map(cobertura_id=>({asesor_id:asesorId,cobertura_id})));
 b.disabled=false;await equipo();aviso('Ficha guardada en Supabase.');};
}
async function ausenciasSeccion(el,asesorId){
 const lista=await cargarAusencias(asesorId);
 el.innerHTML=`<h4>Ausencias e incapacidades</h4><p class="ad-note">Mientras un asesor está en ausencia, el sistema lo salta al sugerir horarios y otro asesor activo de la misma ciudad lo reemplaza automáticamente.</p>${lista.length?`<ul class="ad-ausencias">${lista.map(au=>`<li>${au.fecha_inicio} → ${au.fecha_fin}${au.motivo?' · '+esc(au.motivo):''} <button data-del-ausencia="${au.id}">Eliminar</button></li>`).join('')}</ul>`:'<p class="ad-muted">Sin ausencias registradas.</p>'}<form class="ad-form" id="ad-ausencia-form"><div class="ad-grid">${campo('fecha_inicio','Desde','','date','required')}${campo('fecha_fin','Hasta','','date','required')}${campo('motivo','Motivo (opcional)','','text')}</div><button class="ad-primary" type="submit">Agregar ausencia</button></form>`;
 el.onclick=async e=>{const id=e.target.dataset.delAusencia;if(!id)return;await supabase.from('agenda_asesores_ausencias').delete().eq('id',id);await ausenciasSeccion(el,asesorId);};
 el.querySelector('#ad-ausencia-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_asesores_ausencias').insert({asesor_id:asesorId,fecha_inicio:f.fecha_inicio.value,fecha_fin:f.fecha_fin.value,motivo:f.motivo.value.trim()||null});if(error){aviso('No se pudo guardar la ausencia.',true);return;}await ausenciasSeccion(el,asesorId);};
}
const ETIQUETAS_GEO_PROBLEMA={sin_coordenadas:'Sin coordenadas (o en 0,0)',fuera_de_colombia:'Coordenadas fuera de Colombia',lejos_de_la_ciudad_configurada:'Lejos del centro de su ciudad (más de 30 km)'};

async function cargarReporteGeolocalizacion(el){
 el.innerHTML='<p class="ad-muted">Revisando coordenadas…</p>';
 const {data,error}=await supabase.rpc('agenda_reporte_geolocalizacion',{p_empresa_id:config.empresa_id});
 if(error){el.innerHTML='<p class="ad-muted">No se pudo cargar el reporte.</p>';return;}
 if(!data||!data.length){el.innerHTML='<p class="ad-muted">Sin problemas detectados: todos los inmuebles tienen coordenadas dentro de lo esperado.</p>';return;}
 const grupos={};
 for(const fila of data){(grupos[fila.problema]=grupos[fila.problema]||[]).push(fila);}
 el.innerHTML=Object.entries(grupos).map(([problema,filas])=>`<details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">${esc(ETIQUETAS_GEO_PROBLEMA[problema]||problema)} · ${filas.length}</summary>
  <ul class="ad-ciudades">${filas.map(f=>`<li>#${f.numero_inmueble} · ${esc(f.direccion||'')} · ${esc(f.ciudad||'')}${f.distancia_km_a_ciudad?` · ${Math.round(f.distancia_km_a_ciudad)} km del centro configurado`:''}</li>`).join('')}</ul>
 </details>`).join('');
}

async function ciudadesTab(){
 const el=root.querySelector('.ad-subbody');el.innerHTML='<p>Cargando…</p>';
 await cargarCiudades();await cargarCoberturas();
 const {data:festivos}=await supabase.from('agenda_festivos').select('*').eq('pais',config.pais||'CO').gte('fecha',new Date().toISOString().slice(0,10)).order('fecha').limit(40);
 el.innerHTML=`<h2>Ciudades</h2><p>Cada ciudad se guarda por separado; luego se asigna a cada asesor desde su ficha en Equipo. La latitud y longitud son el centro aproximado de la ciudad — se usan solo para detectar inmuebles con coordenadas mal cargadas desde Sedi, no afectan la agenda.</p>
 <ul class="ad-ciudades">${ciudades.length?ciudades.map(c=>`<li style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="min-width:110px">${esc(c.nombre)}</span><input type="number" step="0.0001" class="ad-input" data-coord-ciudad="${c.id}" data-campo="latitud" placeholder="Latitud" value="${c.latitud ?? ''}" style="width:120px;min-height:36px"><input type="number" step="0.0001" class="ad-input" data-coord-ciudad="${c.id}" data-campo="longitud" placeholder="Longitud" value="${c.longitud ?? ''}" style="width:120px;min-height:36px"><button type="button" data-guardar-ciudad="${c.id}">Guardar coordenadas</button><button data-del-ciudad="${c.id}">Eliminar</button></li>`).join(''):'<li class="ad-muted">Todavía no hay ciudades.</li>'}</ul>
 <form class="ad-form" id="ad-ciudad-form"><div class="ad-grid">${campo('nombre','Nueva ciudad','','text','required placeholder="Ej: Chía"')}</div><button class="ad-primary" type="submit">Agregar ciudad</button></form>
 <h2 style="margin-top:28px">Coberturas</h2><p>Subdivisiones dentro de una ciudad (por ejemplo Norte, Sur, Centro) que usa la agenda especial de captaciones para asignar el asesor más indicado, con prioridad total. Cada ciudad define las suyas — no tienen que llamarse igual en Bogotá, Barranquilla o Medellín. Luego se asigna cada asesor a sus coberturas desde su ficha en Equipo.</p>
 <ul class="ad-ciudades">${coberturas.length?coberturas.map(c=>`<li>${esc(c.nombre)} · ${esc(c.ciudadNombre)} <button data-del-cobertura="${c.id}">Eliminar</button></li>`).join(''):'<li class="ad-muted">Todavía no hay coberturas.</li>'}</ul>
 <form class="ad-form" id="ad-cobertura-form"><div class="ad-grid"><label>Ciudad<select name="ciudad_id" required><option value="">Selecciona una ciudad</option>${ciudades.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></label>${campo('nombre_cobertura','Nombre de la cobertura','','text','required placeholder="Ej: Norte"')}</div><button class="ad-primary" type="submit">Agregar cobertura</button></form>
 <h2 style="margin-top:28px">Festivos</h2><p>Colombia ya viene con el calendario de festivos 2026-2027 cargado automáticamente (Ley Emiliani incluida). Puedes agregar fechas adicionales que quieras bloquear en la agenda. Los asesores de planta no atienden festivos por defecto; los freelance pueden activarlo por asesor en su ficha.</p>
 <ul class="ad-ciudades">${(festivos||[]).slice(0,15).map(f=>`<li>${f.fecha} · ${esc(f.nombre)} <button data-del-festivo="${f.id}">Eliminar</button></li>`).join('')||'<li class="ad-muted">Sin festivos próximos.</li>'}</ul>
 <form class="ad-form" id="ad-festivo-form"><div class="ad-grid">${campo('fecha','Fecha','','date','required')}${campo('nombre_festivo','Nombre','','text','required placeholder="Ej: Cierre anual"')}</div><button class="ad-primary" type="submit">Agregar fecha</button></form>
 <h2 style="margin-top:28px">Calidad de geolocalización</h2><p>Inmuebles con coordenadas ausentes, fuera de Colombia, o lejos del centro de la ciudad que tienen asignada. Repórtalos a Sedi para que corrijan la ubicación en el origen — esta pantalla solo detecta el problema, no lo corrige.</p>
 <div id="ad-geo-report"></div>`;
 cargarReporteGeolocalizacion(el.querySelector('#ad-geo-report'));
 el.onclick=async e=>{
  const ciudadId=e.target.dataset.delCiudad;const festivoId=e.target.dataset.delFestivo;const guardarId=e.target.dataset.guardarCiudad;const coberturaId=e.target.dataset.delCobertura;
  if(ciudadId){if(!confirm('¿Eliminar esta ciudad? Los asesores que la tenían asignada dejarán de aparecer para inmuebles de esa ciudad.'))return;await supabase.from('agenda_ciudades').delete().eq('id',ciudadId);await ciudadesTab();}
  if(festivoId){await supabase.from('agenda_festivos').delete().eq('id',festivoId);await ciudadesTab();}
  if(coberturaId){if(!confirm('¿Eliminar esta cobertura? Los asesores que la tenían asignada dejarán de aparecer para captaciones de esa zona.'))return;await supabase.from('agenda_coberturas').delete().eq('id',coberturaId);await ciudadesTab();aviso('Cobertura eliminada.');}
  if(guardarId){
   const fila=e.target.closest('li');
   const lat=fila.querySelector('[data-campo=latitud]').value;const lon=fila.querySelector('[data-campo=longitud]').value;
   const {error}=await supabase.from('agenda_ciudades').update({latitud:lat===''?null:Number(lat),longitud:lon===''?null:Number(lon)}).eq('id',guardarId);
   if(error){aviso('No se pudieron guardar las coordenadas.',true);return;}
   aviso('Coordenadas de la ciudad guardadas.');
   cargarReporteGeolocalizacion(el.querySelector('#ad-geo-report'));
  }
 };
 el.querySelector('#ad-ciudad-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_ciudades').insert({empresa_id:config.empresa_id,nombre:f.nombre.value.trim()});if(error){aviso(error.code==='23505'?'Esa ciudad ya existe.':'No se pudo guardar la ciudad.',true);return;}await ciudadesTab();aviso('Ciudad agregada.');};
 el.querySelector('#ad-cobertura-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_coberturas').insert({empresa_id:config.empresa_id,ciudad_id:f.ciudad_id.value,nombre:f.nombre_cobertura.value.trim()});if(error){aviso(error.code==='23505'?'Esa cobertura ya existe en esa ciudad.':'No se pudo guardar la cobertura.',true);return;}await ciudadesTab();aviso('Cobertura agregada.');};
 el.querySelector('#ad-festivo-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_festivos').insert({pais:config.pais||'CO',fecha:f.fecha.value,nombre:f.nombre_festivo.value.trim()});if(error){aviso(error.code==='23505'?'Ya existe un festivo en esa fecha.':'No se pudo guardar el festivo.',true);return;}await ciudadesTab();aviso('Fecha agregada.');};
}
function marcaForm(){
 const el=root.querySelector('.ad-subbody');
 const enlaceEjemplo=config.dominio_publico?`https://${config.dominio_publico}/inmuebles/245`:'configura el dominio para ver un ejemplo';
 const enlaceInmuebleEjemplo=config.plantilla_enlace_inmueble&&config.plantilla_enlace_inmueble.includes('{numero}')?config.plantilla_enlace_inmueble.replace('{numero}','245'):'usa el dominio de arriba mientras no configures esta plantilla';
 el.innerHTML=`<h2>Configuración de empresa</h2><p>Personaliza la identidad y las reglas de agenda de tu empresa. Cada empresa conserva su propia configuración.</p><form class="ad-form"><div class="ad-grid">${campo('nombre_comercial','Nombre comercial',config.nombre_comercial,'text','required maxlength="120"')}${campo('logo_url','Enlace HTTPS del logo',config.logo_url,'url','pattern="https://.*" placeholder="https://…/logo.png"')}${campo('color_principal','Color principal',config.color_principal,'color')}${campo('color_accion','Color de botones',config.color_accion,'color')}${campo('correo_contacto','Correo de contacto (uso general / comercial)',config.correo_contacto,'email')}${campo('telefono','Teléfono',config.telefono,'tel')}${campo('enlace_documentos','Enlace para radicar documentos',config.enlace_documentos,'url','pattern="https://.*"')}</div>
 <h3>Página pública de agendamiento</h3>
 <div class="ad-grid">${campo('dominio_publico','Dominio de la página de agendamiento (donde el cliente reserva)',config.dominio_publico,'text','placeholder="citas.patrimonios.co"')}</div>
 <p class="ad-note">El botón "Agendar cita" usa este dominio, con este formato: <code>${enlaceEjemplo}</code>.</p>
 <div class="ad-grid">${campo('plantilla_enlace_inmueble','Enlace para VER el inmueble en tu sitio real (usa {numero} donde va el código)',config.plantilla_enlace_inmueble,'text','placeholder="https://www.patrimonios.co/inmuebles/#inmueble{numero}"')}</div>
 <p class="ad-note">El botón "Ver inmueble" (en las citas y en la lista de inmuebles) usa esta plantilla para llevar a la ficha real del inmueble en tu página, no a la agenda. Ejemplo con el inmueble 245: <code>${enlaceInmuebleEjemplo}</code>. Si la dejas vacía, se usa el dominio de arriba con el formato <code>/inmuebles/{numero}</code>.</p>
 <h3>Reglas de la agenda</h3>
 <div class="ad-grid">${campo('duracion_visita_minutos','Duración de la primera cita (minutos)',config.duracion_visita_minutos,'number','min="10" step="5" required')}${campo('minutos_traslado_entre_inmuebles','Traslado mínimo entre inmuebles distintos (minutos)',config.minutos_traslado_entre_inmuebles,'number','min="0" step="5" required')}<label>Citas seguidas para el mismo inmueble<select name="modo_mismo_inmueble"><option value="separado">Permitir, separadas cada X minutos</option><option value="simultaneo">Permitir, una tras otra sin espera</option><option value="desactivado">No permitir (usar siempre traslado completo)</option></select></label>${campo('separacion_mismo_inmueble_minutos','Separación entre citas del mismo inmueble (minutos)',config.separacion_mismo_inmueble_minutos,'number','min="5" step="5" required')}${campo('radio_zona_km','Radio de zona (km) para agrupar citas por la mañana/tarde',config.radio_zona_km,'number','min="1" step="0.5" required')}${campo('horas_minimas_anticipacion','Anticipación mínima para agendar (horas)',config.horas_minimas_anticipacion,'number','min="0" step="1" required')}${campo('horas_minimas_anticipacion_mismo_inmueble','Anticipación mínima si el asesor ya está en ese inmueble (horas)',config.horas_minimas_anticipacion_mismo_inmueble,'number','min="0" step="0.5" required')}<label>Formato de hora<select name="formato_hora"><option value="12h">12 horas (2:00 p. m.)</option><option value="24h">24 horas / militar (14:00)</option></select></label></div>
 <p class="ad-note">Cada asesor puede tener su propia anticipación mínima desde su ficha en Equipo; si no la define, se usa la de aquí. La anticipación más corta solo aplica a citas adicionales en un inmueble donde el asesor ya tiene una cita ese día — no hace falta preparar llaves de nuevo.</p>
 <p class="ad-note">Si un asesor ya tiene una cita en la mañana (o en la tarde), en esa misma mitad del día solo se ofrecen inmuebles a menos de este radio; los inmuebles más lejanos se ofrecen para la otra mitad del día, así no cruza la ciudad varias veces. La anticipación mínima evita que agenden una visita en los próximos minutos, para dar tiempo de preparar llaves. El formato de hora aplica tanto en tu agenda interna como en la página pública.</p>
 <h3>Citas de seguimiento según el valor del inmueble</h3>
 <div class="ad-grid">${campo('valor_minimo_canon_seguimiento','Canon mínimo para permitir seguimientos (arriendo, $/mes)',config.valor_minimo_canon_seguimiento,'number','min="0" step="50000"')}${campo('valor_minimo_venta_seguimiento','Precio mínimo para permitir seguimientos (venta, $)',config.valor_minimo_venta_seguimiento,'number','min="0" step="1000000"')}</div>
 <p class="ad-note">Si el canon o el precio de venta de un inmueble está por debajo de este mínimo, no se le ofrecen citas de seguimiento (solo su cita inicial): en cuanto termina + el traslado, el asesor queda libre para otros inmuebles, incluyendo los de mayor valor. Deja en 0 para no aplicar ningún límite.</p>
 <div class="ad-grid">${campo('valor_alto_canon_zona','Canon desde el cual un inmueble es de alto valor (arriendo, $/mes)',config.valor_alto_canon_zona,'number','min="0" step="50000"')}${campo('valor_alto_venta_zona','Precio desde el cual un inmueble es de alto valor (venta, $)',config.valor_alto_venta_zona,'number','min="0" step="1000000"')}</div>
 <p class="ad-note">Un inmueble de alto valor puede agendarse aunque quede fuera de la zona/mitad del día del asesor ese momento: no espera a la otra mitad del día, solo respeta el tiempo de traslado real hasta y desde ese inmueble. Deja en 0 para no aplicar ninguna excepción.</p>
 <h3>Almuerzo (horario general de la empresa)</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" name="almuerzo_activo"> La agenda respeta un horario de almuerzo</label>${campo('almuerzo_inicio','Almuerzo desde',config.almuerzo_inicio?.slice(0,5)||'12:00','time')}${campo('almuerzo_fin','Almuerzo hasta',config.almuerzo_fin?.slice(0,5)||'13:00','time')}</div>
 <p class="ad-note">Cada asesor puede tener su propio horario de almuerzo desde su ficha en Equipo; si no lo define, se usa este.</p>
 <h3>Permisos del panel interno</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" checked disabled> Administradores (siempre pueden ver la pestaña Equipo)</label><label class="ad-check"><input type="checkbox" name="equipo_ve_coordinador"> Coordinadores también pueden ver la pestaña Equipo</label><label class="ad-check"><input type="checkbox" name="equipo_ve_asesor"> Asesores también pueden ver la pestaña Equipo</label></div>
 <p class="ad-note">La pestaña "Equipo" dentro de la agenda (Agenda / Inmuebles / Equipo) muestra los datos de todos los asesores. Por defecto solo la ven los administradores; actívalo aquí si algún coordinador o asesor también debe verla. Esto no afecta el panel de Configuración, que ya es solo para administradores.</p>
 <button class="ad-primary" type="submit" style="margin-top:18px">Guardar configuración</button></form>`;
 el.querySelector('[name=modo_mismo_inmueble]').value=config.modo_mismo_inmueble||'separado';
 el.querySelector('[name=formato_hora]').value=config.formato_hora||'12h';
 el.querySelector('[name=almuerzo_activo]').checked=config.almuerzo_activo!==false;
 const rolesEquipo=Array.isArray(config.equipo_visible_roles)&&config.equipo_visible_roles.length?config.equipo_visible_roles:['administrador'];
 el.querySelector('[name=equipo_ve_coordinador]').checked=rolesEquipo.includes('coordinador');
 el.querySelector('[name=equipo_ve_asesor]').checked=rolesEquipo.includes('asesor');
 el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target;const b=f.querySelector('button');b.disabled=true;
 const equipoVisibleRoles=['administrador'];if(f.equipo_ve_coordinador.checked)equipoVisibleRoles.push('coordinador');if(f.equipo_ve_asesor.checked)equipoVisibleRoles.push('asesor');
 const v={empresa_id:config.empresa_id,nombre_comercial:f.nombre_comercial.value.trim(),logo_url:f.logo_url.value.trim(),color_principal:f.color_principal.value,color_accion:f.color_accion.value,correo_contacto:f.correo_contacto.value.trim(),telefono:f.telefono.value.trim(),enlace_documentos:f.enlace_documentos.value.trim(),dominio_publico:f.dominio_publico.value.trim()||null,plantilla_enlace_inmueble:f.plantilla_enlace_inmueble.value.trim()||null,duracion_visita_minutos:Number(f.duracion_visita_minutos.value),minutos_traslado_entre_inmuebles:Number(f.minutos_traslado_entre_inmuebles.value),modo_mismo_inmueble:f.modo_mismo_inmueble.value,separacion_mismo_inmueble_minutos:Number(f.separacion_mismo_inmueble_minutos.value),radio_zona_km:Number(f.radio_zona_km.value),valor_minimo_canon_seguimiento:Number(f.valor_minimo_canon_seguimiento.value),valor_minimo_venta_seguimiento:Number(f.valor_minimo_venta_seguimiento.value),valor_alto_canon_zona:Number(f.valor_alto_canon_zona.value),valor_alto_venta_zona:Number(f.valor_alto_venta_zona.value),horas_minimas_anticipacion:Number(f.horas_minimas_anticipacion.value),horas_minimas_anticipacion_mismo_inmueble:Number(f.horas_minimas_anticipacion_mismo_inmueble.value),formato_hora:f.formato_hora.value,almuerzo_activo:f.almuerzo_activo.checked,almuerzo_inicio:f.almuerzo_inicio.value,almuerzo_fin:f.almuerzo_fin.value,equipo_visible_roles:equipoVisibleRoles};
 const {data,error}=await supabase.from('agenda_configuracion').upsert(v).select('*').single();b.disabled=false;if(error){aviso('No se pudo guardar la configuración. Verifica permisos y conexión.',true);return;}config=data;marca();invalidarDominioPublico();marcaForm();aviso('Configuración guardada.');};
}

const PROVEEDORES_CORREO = {
 gmail: {
  etiqueta: 'Gmail / Google Workspace',
  host: 'smtp.gmail.com',
  puerto: 465,
  seguridad: 'ssl',
  pasos: [
   'Entra a la cuenta de Google de info@patrimonios.co y activa la verificación en 2 pasos en myaccount.google.com/security.',
   'Con la verificación en 2 pasos activa, ve a myaccount.google.com/apppasswords y crea una "contraseña de aplicación" (ponle de nombre, por ejemplo, "Agenda Patrimonios").',
   'Copia esa clave de 16 letras (sin espacios) y pégala abajo en "Contraseña / clave de aplicación". No es la contraseña normal de la cuenta.',
   'Si info@patrimonios.co es una cuenta de Google Workspace administrada por ti, confirma en admin.google.com que el envío SMTP esté permitido para esa cuenta.',
  ],
 },
 outlook: {
  etiqueta: 'Outlook / Hotmail / Microsoft 365',
  host: 'smtp.office365.com',
  puerto: 587,
  seguridad: 'tls',
  pasos: [
   'Si la cuenta tiene verificación en 2 pasos activa, crea una "contraseña de aplicación" en account.microsoft.com → Seguridad → Opciones de seguridad avanzadas.',
   'Si la cuenta es de un dominio con Microsoft 365 administrado por ti, verifica en el panel de administración que el envío SMTP autenticado esté habilitado para esa cuenta.',
   'Usa el correo completo (por ejemplo info@patrimonios.co) como usuario SMTP.',
   'Pega la contraseña normal o la contraseña de aplicación (según lo anterior) abajo en "Contraseña / clave de aplicación".',
  ],
 },
 otro: {
  etiqueta: 'Otro proveedor SMTP',
  host: '',
  puerto: 587,
  seguridad: 'tls',
  pasos: [
   'Busca en la documentación de tu proveedor de correo los datos de "SMTP saliente": host, puerto y tipo de seguridad (SSL o TLS).',
   'El usuario SMTP casi siempre es el correo completo, por ejemplo info@patrimonios.co.',
   'La contraseña suele ser la misma del correo, o una "contraseña de aplicación" si el proveedor exige verificación en 2 pasos.',
  ],
 },
};

async function correoForm(){
 const el=root.querySelector('.ad-subbody');
 el.innerHTML='<p class="ad-muted">Cargando…</p>';
 const {data:tienePassword}=await supabase.rpc('agenda_correo_tiene_password',{p_empresa_id:config.empresa_id});
 const turno=revision;
 if(turno!==revision)return;
 const proveedorInicial=config.correo_proveedor&&PROVEEDORES_CORREO[config.correo_proveedor]?config.correo_proveedor:'gmail';
 const modoPruebas=config.correo_modo_pruebas!==false;
 const estadoClase=modoPruebas?'ad-correo-estado-pruebas':(tienePassword?'ad-correo-estado-ok':'ad-correo-estado-pendiente');
 const estadoTexto=modoPruebas?'🧪 Modo de pruebas activo — todos los correos (cliente y propietario) llegan solo al correo de pruebas, nunca a los destinatarios reales.':(tienePassword?'✅ Correo configurado y en producción — los correos llegan a los destinatarios reales.':'⚠️ Todavía no has guardado una contraseña — los correos no se podrán enviar hasta que la configures.');
 const provCard=(key,p)=>`<button type="button" class="ad-correo-prov${key===proveedorInicial?' ad-correo-prov-activo':''}" data-prov="${key}"><span class="ad-correo-prov-punto"></span>${esc(p.etiqueta)}</button>`;
 el.innerHTML=`<h2>Correo de citas</h2>
 <p>Configura desde qué cuenta se envían los correos de confirmación de citas, tanto al cliente como al propietario. Recomendamos usar <strong>info@patrimonios.co</strong> como remitente para no crear un correo nuevo.</p>
 <div class="ad-correo-estado ${estadoClase}">${estadoTexto}</div>
 <form class="ad-form ad-correo-form">
  <h3>1. Elige tu proveedor de correo</h3>
  <div class="ad-correo-provs">${Object.entries(PROVEEDORES_CORREO).map(([k,p])=>provCard(k,p)).join('')}</div>
  <div class="ad-correo-instrucciones"><h4>Cómo obtener los datos para <span data-prov-nombre></span></h4><ol data-prov-pasos></ol></div>
  <h3 style="margin-top:26px">2. Remitente</h3>
  <div class="ad-grid">${campo('correo_remitente_nombre','Nombre que verá el destinatario',config.correo_remitente_nombre||'Patrimonios Inmobiliarios','text','required placeholder="Patrimonios Inmobiliarios"')}${campo('correo_remitente_email','Correo remitente',config.correo_remitente_email||'info@patrimonios.co','email','required placeholder="info@patrimonios.co"')}</div>
  <h3 style="margin-top:26px">3. Datos SMTP</h3>
  <div class="ad-grid">${campo('correo_smtp_host','Host SMTP',config.correo_smtp_host||'','text','required placeholder="smtp.gmail.com"')}${campo('correo_smtp_puerto','Puerto',config.correo_smtp_puerto||465,'number','required min="1"')}<label>Seguridad<select name="correo_smtp_seguridad"><option value="ssl">SSL</option><option value="tls">TLS</option><option value="ninguna">Ninguna</option></select></label>${campo('correo_smtp_usuario','Usuario SMTP',config.correo_smtp_usuario||config.correo_remitente_email||'info@patrimonios.co','text','required')}</div>
  <div class="ad-grid"><label>Contraseña / clave de aplicación${tienePassword?' · <small class="ad-muted">ya guardada, deja este campo vacío para conservarla</small>':''}<input name="correo_password" type="password" placeholder="${tienePassword?'••••••••••••••••':'Pega aquí la clave de aplicación'}" autocomplete="new-password"></label></div>
  <h3 style="margin-top:26px">4. Modo de pruebas</h3>
  <label class="ad-toggle"><input type="checkbox" name="correo_modo_pruebas"><span class="ad-toggle-track"><span class="ad-toggle-thumb"></span></span><span>Mientras ajustamos el diseño, enviar TODOS los correos (cliente y propietario) a un solo correo de pruebas</span></label>
  <div class="ad-grid" style="margin-top:14px">${campo('correo_pruebas_destino','Correo donde quieres recibir las pruebas',config.correo_pruebas_destino||'pf.castelli@patrimonios.co','email','placeholder="tu-correo@patrimonios.co"')}</div>
  <p class="ad-note">Con el modo de pruebas activo, ningún cliente ni propietario recibe correos todavía: absolutamente todo llega al correo de arriba, para que revises el contenido y el diseño antes de salir a producción. Cuando estés listo, apaga el interruptor y los correos empezarán a llegar a los destinatarios reales.</p>
  <button class="ad-primary" type="submit" style="margin-top:20px">Guardar configuración de correo</button>
 </form>`;
 el.querySelector('[name=correo_smtp_seguridad]').value=config.correo_smtp_seguridad||PROVEEDORES_CORREO[proveedorInicial].seguridad;
 el.querySelector('[name=correo_modo_pruebas]').checked=modoPruebas;
 const actualizarInstrucciones=key=>{const p=PROVEEDORES_CORREO[key];el.querySelector('[data-prov-nombre]').textContent=p.etiqueta;el.querySelector('[data-prov-pasos]').innerHTML=p.pasos.map(t=>`<li>${esc(t)}</li>`).join('');};
 actualizarInstrucciones(proveedorInicial);
 el.querySelectorAll('[data-prov]').forEach(b=>b.addEventListener('click',()=>{
  el.querySelectorAll('[data-prov]').forEach(x=>x.classList.remove('ad-correo-prov-activo'));
  b.classList.add('ad-correo-prov-activo');
  const key=b.dataset.prov;actualizarInstrucciones(key);
  const p=PROVEEDORES_CORREO[key];const f=el.querySelector('form');
  if(p.host)f.correo_smtp_host.value=p.host;
  f.correo_smtp_puerto.value=p.puerto;
  f.correo_smtp_seguridad.value=p.seguridad;
 }));
 el.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const f=e.target;const b=f.querySelector('button');b.disabled=true;
  const provKey=el.querySelector('.ad-correo-prov-activo')?.dataset.prov||proveedorInicial;
  const {error}=await supabase.rpc('agenda_guardar_credenciales_correo',{
   p_empresa_id:config.empresa_id,
   p_proveedor:provKey,
   p_remitente_nombre:f.correo_remitente_nombre.value.trim(),
   p_remitente_email:f.correo_remitente_email.value.trim(),
   p_smtp_host:f.correo_smtp_host.value.trim(),
   p_smtp_puerto:Number(f.correo_smtp_puerto.value),
   p_smtp_seguridad:f.correo_smtp_seguridad.value,
   p_smtp_usuario:f.correo_smtp_usuario.value.trim(),
   p_password:f.correo_password.value||null,
   p_modo_pruebas:f.correo_modo_pruebas.checked,
   p_pruebas_destino:f.correo_pruebas_destino.value.trim()||null,
  });
  if(error){b.disabled=false;aviso('No se pudo guardar la configuración de correo. Verifica permisos y conexión.',true);return;}
  const {data}=await supabase.from('agenda_configuracion').select('*').eq('empresa_id',config.empresa_id).maybeSingle();
  if(data)config=data;
  aviso('Configuración de correo guardada.');
  await correoForm();
 };
}
