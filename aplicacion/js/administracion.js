import { htmlContactoEmpresa, montarContactoEmpresa } from './contacto-empresa.js';
function textoSobre(hex){const m=/^#([0-9a-f]{6})$/i.exec(hex||'');if(!m)return '#1a2c45';const c=[0,2,4].map(i=>parseInt(m[1].substr(i,2),16)/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);const l=0.2126*c[0]+0.7152*c[1]+0.0722*c[2];return l>0.179?'#111111':'#ffffff';}
import { supabase } from './cliente-supabase.js';
import { iaTab as iaTabModulo, reunionesTab as reunionesTabModulo } from './admin-ia-reuniones.js';
import { supervisionTab as supervisionTabModulo } from './admin-supervision.js';
import { radicacionTab as radicacionTabModulo } from './admin-radicacion.js';
import { demandaTab as demandaTabModulo } from './admin-demanda.js';
import { montarBuscador } from './admin-buscador.js';
import { rolesTab as rolesTabModulo, listarRoles } from './admin-roles.js';
import { puede, datosPermisos } from './permisos.js';
import { solicitudesTab as solicitudesTabModulo, saludTab as saludTabModulo } from './admin-propietarios.js';
import { repartir, montarSubpestanas } from './admin-subpestanas.js';
import { invalidarDominioPublico } from './agenda-real.js';
import {
 listarAccesos,
 crearAcceso,
 cambiarPasswordDeUsuario,
 reenviarInvitacion,
 alternarActivoAcceso,
 vincularAsesorConAcceso,
 eliminarUsuario,
} from './sesion.js';
import { aplicarTema, quitarTema, tarjetasPaletas, PALETAS, paletaActiva, derivarPaleta } from './paletas.js';
import '../estilos/administracion.css';
let root, acceso, config, asesores = [], ciudades = [], asesorCiudades = {}, coberturas = [], asesorCoberturas = {}, accesosPorUsuario = {}, supervisoresPorAsesor = {}, revision = 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PALETA_ASESORES=['#2563EB','#DB2777','#059669','#D97706','#7C3AED','#DC2626','#0891B2','#65A30D'];
const ROLES_SUPERVISOR = new Set(['coordinador','administrador','admin','superadministrador','super_admin']);
const esRolSupervisor = miembro => Boolean(miembro?.es_super) || ROLES_SUPERVISOR.has(String(miembro?.rol || '').toLowerCase());
const supervisoresDisponibles = () => Object.values(accesosPorUsuario).filter(m => m.activo && esRolSupervisor(m));
function supervisorUsuarios(asesor) {
 const actuales=supervisoresPorAsesor[asesor?.id];
 if(Array.isArray(actuales))return actuales;
 const legado=asesores.find(x=>x.id===asesor?.supervisor_id);
 return legado?.usuario_id && esRolSupervisor(accesosPorUsuario[legado.usuario_id]) ? [legado.usuario_id] : [];
}
const nombresSupervisores = asesor => supervisorUsuarios(asesor).map(id=>accesosPorUsuario[id]?.nombre).filter(Boolean).join(', ');
const etiquetaRolAcceso = miembro => miembro?.es_super ? 'Superadministrador' : ({admin:'Administrador',administrador:'Administrador',super_admin:'Superadministrador',superadministrador:'Superadministrador',coordinador:'Coordinador'})[String(miembro?.rol || '').toLowerCase()] || miembro?.rol || '';
const defaults = e => ({empresa_id:e.id,nombre_comercial:e.nombre,logo_url:'',color_principal:e.color_principal || '#1A2C45',color_accion:e.color_accion || '#00A9A5',correo_contacto:'',telefono:'',ciudades:'Bogotá, Barranquilla, Medellín',enlace_documentos:'',dominio_publico:'',plantilla_enlace_inmueble:'',formato_hora:'12h',horas_minimas_anticipacion:2,horas_minimas_anticipacion_mismo_inmueble:1,duracion_visita_minutos:60,modo_mismo_inmueble:'separado',separacion_mismo_inmueble_minutos:15,minutos_traslado_entre_inmuebles:30,radio_zona_km:7,valor_minimo_canon_seguimiento:0,valor_minimo_venta_seguimiento:0,valor_alto_canon_zona:0,valor_alto_venta_zona:0,almuerzo_activo:true,almuerzo_inicio:'12:00',almuerzo_fin:'13:00',pais:'CO',equipo_visible_roles:['administrador']});
const campo = (name,label,value='',type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
let avisoTemporizador;
function aviso(texto,error=false){
 const e=root?.querySelector('[role=status]');if(e){e.textContent=texto;e.classList.toggle('error',error);}
 // Aviso flotante: el de arriba queda fuera de pantalla cuando el botón Guardar está al final de un formulario largo.
 if(!root)return;let t=root.querySelector('.ad-toast');
 if(!t){t=document.createElement('div');t.className='ad-toast';t.setAttribute('role','alert');root.append(t);}
 t.textContent=texto;t.classList.toggle('error',error);t.hidden=false;
 clearTimeout(avisoTemporizador);avisoTemporizador=setTimeout(()=>{t.hidden=true;},error?9000:5000);
}
function colorTexto(hex){const a=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722>.179?'#111111':'#ffffff';}
function marca(){
 aplicarTema(config);
 const head=document.querySelector('.pa-head > div');
 head.replaceChildren();
 if(config.logo_url){const img=document.createElement('img');img.src=config.logo_url;img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove());head.append(img);}
 const name=document.createElement('strong');name.textContent=config.nombre_comercial;head.append(name);
}
export function limpiarAdministracion(){revision++;root?.remove();root=null;acceso=null;asesores=[];ciudades=[];asesorCiudades={};config=null;document.getElementById('pa-agenda-content').hidden=false;quitarTema();const h=document.querySelector('.pa-head > div');h.innerHTML='<strong>PATRIMONIOS</strong><small>INMOBILIARIOS</small>';}
export async function iniciarAdministracion(a){
 limpiarAdministracion();acceso=a;const turno=revision;
 if(!a.membresia)return;
 config=defaults(a.membresia.empresa);
 const {data,error}=await supabase.from('agenda_configuracion').select('*').eq('empresa_id',config.empresa_id).maybeSingle();
 if(turno!==revision)return;
 if(data)config=data;marca();
 if(a.membresia.rol!=='administrador')return;
 root=document.createElement('section');root.className='ad';root.innerHTML=`<nav aria-label="Administración"><button data-tab="agenda" aria-pressed="true" class="ad-volver" hidden>← Volver a la agenda</button><span class="ad-nav-sep"></span><button data-tab="config" aria-pressed="false" class="ad-gear" title="Configuración" aria-label="Configuración"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg><span>Configuración</span></button></nav><p role="status" aria-live="polite"></p><div class="ad-body" hidden><nav class="ad-subnav" aria-label="Configuración"><span class="ad-nav-grupo">Personas</span><button data-subtab="equipo" aria-pressed="true">Equipo</button><button data-subtab="accesos" aria-pressed="false">Accesos</button><button data-subtab="roles" aria-pressed="false">Roles y permisos</button><span class="ad-nav-grupo">Empresa y correo</span><button data-subtab="marca" aria-pressed="false">Empresa</button><button data-subtab="correo" aria-pressed="false">Correo</button><button data-subtab="calendario" aria-pressed="false">Calendario</button><button data-subtab="reuniones" aria-pressed="false">Reuniones virtuales</button><button data-subtab="ia" aria-pressed="false">Inteligencia artificial</button><span class="ad-nav-grupo">Reglas y seguimiento</span><button data-subtab="ciudades" aria-pressed="false">Ciudades y festivos</button><button data-subtab="demanda" aria-pressed="false">Demanda</button><button data-subtab="radicacion" aria-pressed="false">Radicación</button><button data-subtab="supervision" aria-pressed="false">Supervisión</button><span class="ad-nav-grupo">Herramientas</span><button data-subtab="importar" aria-pressed="false">Importar citas</button></nav><div class="ad-subbody"></div></div>`;
 document.getElementById('pa-agenda-content').before(root);
 // Solo el equipo de soporte de la plataforma (superadministrador): enlace a la vista previa de todos los correos del sistema.
 supabase.rpc('agenda_es_soporte').then(({data})=>{if(data===true&&root){const a=document.createElement('a');a.href='/correos';a.target='_blank';a.rel='noopener';a.textContent='Correos del sistema ↗';a.className='ad-superadmin-link';a.style.cssText='margin-left:auto;padding:8px 12px;font-weight:600';root.querySelector('.ad-subnav')?.appendChild(a);const g=document.createElement('a');g.href='/asambleas-ensayo.html';g.target='_blank';g.rel='noopener';g.textContent='Asambleas (ensayo) ↗';g.className='ad-superadmin-link';g.style.cssText='padding:8px 12px;font-weight:600';root.querySelector('.ad-subnav')?.appendChild(g);}}).catch(()=>{});
 root.querySelector('nav').addEventListener('click',async e=>{const t=e.target.closest('button')?.dataset.tab;if(!t)return;root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===t)));const body=root.querySelector('.ad-body');body.hidden=t==='agenda';document.getElementById('pa-agenda-content').hidden=t!=='agenda';root.querySelector('.ad-volver').hidden=t==='agenda';aviso('');if(t==='config')await abrirSubtab(root.querySelector('.ad-subnav [aria-pressed=true]')?.dataset.subtab||'equipo');});
 root.querySelector('.ad-subnav').addEventListener('click',async e=>{const st=e.target.closest('button')?.dataset.subtab;if(!st)return;await abrirSubtab(st);});
 // Los permisos del rol afinan qué pestañas de Configuración se muestran (el rol base sigue mandando para los datos).
 const PERMISO_PESTANA={marca:'config.empresa',correo:'config.correo',ciudades:'config.ciudades',demanda:'config.demanda',ia:'config.ia_reuniones',reuniones:'config.ia_reuniones'};
 root.querySelectorAll('.ad-subnav [data-subtab]').forEach(b=>{const k=PERMISO_PESTANA[b.dataset.subtab];if(k&&!puede(k))b.hidden=true;if(b.dataset.subtab==='roles'&&!puede('roles.ver')&&!puede('roles.gestionar'))b.hidden=true;if(b.dataset.subtab==='solicitudes'&&!puede('pendientes.ver'))b.hidden=true;if(b.dataset.subtab==='salud'&&!puede('informes.ver'))b.hidden=true;});
 montarBuscador(root,{abrir:abrirSubtab});
 if(error)aviso('Para activar Equipo y Configuración, aplica sql/002-equipo-configuracion.sql. La agenda sigue disponible.',true);
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
// Coberturas agrupadas por ciudad (un título por ciudad); `fila` pinta cada cobertura. Con 'ul' cada grupo es una lista.
function coberturasPorCiudad(fila,tipo){
 const grupos=new Map();
 for(const c of coberturas){const n=c.ciudadNombre||'Sin ciudad';if(!grupos.has(n))grupos.set(n,[]);grupos.get(n).push(c);}
 return [...grupos.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([ciudad,lista])=>{
  const items=lista.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(fila).join('');
  return `<div class="ad-cob-grupo"><strong>${esc(ciudad)}</strong>${tipo!=='ul'?'<label class="ad-check ad-cob-todo"><input type="checkbox" data-cob-todo> <b>Todo</b></label>':''}${tipo==='ul'?`<ul class="ad-ciudades">${items}</ul>`:items}</div>`;
 }).join('');
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
// Contexto que reciben las pestañas que viven en módulos aparte (admin-ia-reuniones.js).
function ctxSubtab(){const turno=revision;return{el:root.querySelector('.ad-subbody'),empresaId:config.empresa_id,aviso,vigente:()=>turno===revision};}
async function abrirSubtab(st){
 if(root.querySelector(`.ad-subnav [data-subtab="${st}"]`)?.hidden)return;
 root.querySelectorAll('.ad-subnav [data-subtab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.subtab===st)));
 aviso('');
 if(st==='equipo')await equipo();
 if(st==='ciudades')await ciudadesTab();
 if(st==='marca')marcaForm();
 if(st==='correo')await correoForm();
 if(st==='ia')await iaTabModulo(ctxSubtab());
 if(st==='reuniones')await reunionesTabModulo(ctxSubtab());
 if(st==='supervision')await supervisionTabModulo({...ctxSubtab(),config});
 if(st==='radicacion')await radicacionTabModulo({...ctxSubtab(),config});
 if(st==='demanda')await demandaTabModulo({...ctxSubtab(),config});
 if(st==='calendario')await calendarioTab();
 if(st==='importar')await importarTab();
 if(st==='accesos')await accesosTab();
 if(st==='roles')await rolesTabModulo(ctxSubtab());
 if(st==='solicitudes')await solicitudesTabModulo(ctxSubtab());
 if(st==='salud')await saludTabModulo(ctxSubtab());
}
const WIN_TZ={'SA Pacific Standard Time':'America/Bogota','Eastern Standard Time':'America/New_York','Central Standard Time':'America/Chicago','Mountain Standard Time':'America/Denver','Pacific Standard Time':'America/Los_Angeles','Central America Standard Time':'America/Guatemala','GMT Standard Time':'Europe/London','W. Europe Standard Time':'Europe/Berlin','Romance Standard Time':'Europe/Paris','UTC':'UTC'};
function icsDesescapar(v){return v.replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');}
function icsOffsetMs(tz,ms){const p={};for(const x of new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)))p[x.type]=x.value;return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-ms;}
// Convierte un valor iCalendar (con 'Z', con TZID, o sin zona) a fecha/hora en hora de Colombia (UTC-5).
function icsABogota(valor,tzid){
 const m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(valor);if(!m)return null;
 const base=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));let instante;
 if(m[7])instante=base;
 else if(tzid){const tz=WIN_TZ[tzid]||tzid;try{instante=base-icsOffsetMs(tz,base);}catch{instante=base+5*3600000;}}
 else instante=base+5*3600000;
 const d=new Date(instante-5*3600000);const dos=n=>String(n).padStart(2,'0');
 return {fecha:`${d.getUTCFullYear()}-${dos(d.getUTCMonth()+1)}-${dos(d.getUTCDate())}`,hora:`${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`};
}
function icsParsear(texto){
 const lineas=texto.replace(/\r?\n[ \t]/g,'').split(/\r?\n/);const eventos=[];let ev=null;const omitidos={recurrentes:0,cancelados:0,todoElDia:0,invalidos:0};
 for(const l of lineas){
  if(l==='BEGIN:VEVENT'){ev={props:{},correos:[]};continue;}
  if(l==='END:VEVENT'){
   if(ev){
    const p=ev.props;
    if(p.RRULE){omitidos.recurrentes++;}
    else if((p.STATUS?.v||'').toUpperCase()==='CANCELLED'){omitidos.cancelados++;}
    else if(!p.DTSTART||!/T/.test(p.DTSTART.v)){omitidos[p.DTSTART?'todoElDia':'invalidos']++;}
    else{
     const ini=icsABogota(p.DTSTART.v,p.DTSTART.tzid);const fin=p.DTEND?icsABogota(p.DTEND.v,p.DTEND.tzid):null;
     if(!ini){omitidos.invalidos++;}
     else{
      let horaFin=fin&&fin.fecha===ini.fecha&&fin.hora>ini.hora?fin.hora:null;
      if(!horaFin){const [h,mi]=ini.hora.split(':').map(Number);const t=Math.min(h*60+mi+60,23*60+59);horaFin=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;}
      eventos.push({uid:p.UID?.v||`${ini.fecha}-${ini.hora}-${p.SUMMARY?.v||''}`,fecha:ini.fecha,horaInicio:ini.hora,horaFin,titulo:icsDesescapar(p.SUMMARY?.v||'').trim(),ubicacion:icsDesescapar(p.LOCATION?.v||'').trim(),descripcion:icsDesescapar(p.DESCRIPTION?.v||'').trim(),correos:ev.correos});
     }
    }
   }
   ev=null;continue;
  }
  if(!ev)continue;
  const i=l.indexOf(':');if(i<0)continue;const cab=l.slice(0,i);const v=l.slice(i+1);const partes=cab.split(';');const nombre=partes[0].toUpperCase();
  const tz=partes.find(x=>/^TZID=/i.test(x));const tzid=tz?tz.slice(5).replace(/^"|"$/g,''):null;
  if(nombre==='ATTENDEE'||nombre==='ORGANIZER'){const mm=/mailto:([^\s;]+)/i.exec(v);if(mm)ev.correos.push(mm[1].toLowerCase());continue;}
  if(!ev.props[nombre])ev.props[nombre]={v,tzid};
 }
 return {eventos,omitidos};
}
const TIPOS_IMPORTAR={visita_cliente:'Visita con cliente',inventario:'Inventario',inspeccion:'Inspección',otro:'Otro',captacion:'Captación'};
let importar={filas:[],omitidos:null,inmuebles:[],asesores:[]};
async function importarTab(){
 const el=root.querySelector('.ad-subbody');el.innerHTML='<p class="ad-muted">Cargando…</p>';
 const [{data:ases},{data:inm}]=await Promise.all([
  supabase.from('agenda_asesores').select('id,nombre,correo,correos_adicionales,activo').eq('empresa_id',config.empresa_id).eq('activo',true).order('nombre'),
  supabase.from('agenda_inmuebles').select('id,numero_inmueble,direccion').eq('empresa_id',config.empresa_id).range(0,4999)]);
 importar={filas:[],omitidos:null,asesores:ases||[],inmuebles:inm||[]};
 el.innerHTML=`<h2>Importar citas desde un calendario</h2>
 <p>Sirve con <strong>Google Calendar</strong>, <strong>Outlook / Microsoft 365</strong> y cualquier calendario que exporte un archivo <code>.ics</code>. Primero verás una vista previa y eliges qué importar; no se envía ningún correo a los clientes.</p>
 <p class="ad-note"><strong>Google:</strong> calendar.google.com → Configuración → Importar y exportar → Exportar (descarga un .zip: descomprímelo y usa el .ics). <strong>Outlook:</strong> Calendario → Archivo → Guardar calendario (.ics).</p>
 <p class="ad-note">Cada cita necesita un inmueble: se detecta si el título o la descripción trae su número (por ejemplo <code>Inmueble 71</code>, <code>Inmueble Nº 71</code> o <code>Visita #71</code>; un <code>#</code> dentro de una dirección no cuenta). Las que no lo traen quedan desmarcadas; solo se pueden importar como Captación. Las citas repetitivas, canceladas y de todo el día se omiten. Si vuelves a importar el mismo archivo, las citas ya importadas se saltan solas.</p>
 <div class="ad-grid"><label>Archivo .ics<input type="file" id="imp-archivo" accept=".ics,text/calendar"></label>
 <label>Asesor por defecto<select id="imp-asesor">${importar.asesores.map(a=>`<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select></label></div>
 <label class="ad-check"><input type="checkbox" id="imp-pasadas"> Incluir también citas pasadas</label>
 <label class="ad-check"><input type="checkbox" id="imp-completar"> Marcar las pasadas como realizadas (afecta los informes)</label>
 <div id="imp-resultado"></div>`;
 const leer=async()=>{const f=el.querySelector('#imp-archivo').files[0];if(!f)return;importarPreparar(await f.text(),el);};
 el.querySelector('#imp-archivo').onchange=leer;el.querySelector('#imp-pasadas').onchange=leer;
}
function importarPreparar(texto,el){
 const {eventos,omitidos}=icsParsear(texto);const hoy=new Date(Date.now()-5*3600000).toISOString().slice(0,10);
 const incluirPasadas=el.querySelector('#imp-pasadas').checked;const porNumero=new Map(importar.inmuebles.map(i=>[i.numero_inmueble,i]));
 const porCorreo=new Map();for(const a of importar.asesores)for(const c of [a.correo,...(a.correos_adicionales||'').split(';')]){const k=(c||'').trim().toLowerCase();if(k)porCorreo.set(k,a.id);}
 const porDefecto=el.querySelector('#imp-asesor').value;
 importar.omitidos=omitidos;
 importar.filas=eventos.filter(e=>incluirPasadas||e.fecha>=hoy).sort((a,b)=>(a.fecha+a.horaInicio).localeCompare(b.fecha+b.horaInicio)).slice(0,500).map(e=>{
  const texto2=e.titulo+' '+e.descripcion;const m=/inmueble\s*(?:n[°ºo.]*)?\s*(\d{1,6})\b/i.exec(texto2)||/(?:^|visita\s+)#\s*(\d{1,6})\b/i.exec(texto2);
  const inm=m?porNumero.get(Number(m[1])):null;
  const asesorId=e.correos.map(c=>porCorreo.get(c)).find(Boolean)||porDefecto;
  return {...e,inmuebleId:inm?inm.id:null,inmuebleNumero:inm?inm.numero_inmueble:null,asesorId,tipo:inm?'visita_cliente':'captacion',marcada:!!inm};
 });
 importarRender(el);
}
function importarRender(el){
 const box=el.querySelector('#imp-resultado');const f=importar.filas;const o=importar.omitidos||{};
 const resumenOmitidos=[o.recurrentes?`${o.recurrentes} repetitivas`:'',o.cancelados?`${o.cancelados} canceladas`:'',o.todoElDia?`${o.todoElDia} de todo el día`:'',o.invalidos?`${o.invalidos} ilegibles`:''].filter(Boolean).join(', ');
 if(!f.length){box.innerHTML=`<p class="ad-muted">No hay citas para importar en ese archivo${resumenOmitidos?` (omitidas: ${resumenOmitidos})`:''}.</p>`;return;}
 box.innerHTML=`<p><strong>${f.length}</strong> citas encontradas · <strong id="imp-n">${f.filter(x=>x.marcada).length}</strong> marcadas${resumenOmitidos?` · omitidas: ${resumenOmitidos}`:''}${f.length>=500?' · (se muestran las primeras 500)':''}</p>
 <div style="overflow-x:auto"><table class="ad-tabla" style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th></th><th>Fecha</th><th>Hora</th><th>Título</th><th>Inmueble</th><th>Tipo</th><th>Asesor</th></tr></thead><tbody>${f.map((x,i)=>`<tr data-i="${i}"><td><input type="checkbox" data-marca ${x.marcada?'checked':''}></td><td>${x.fecha}</td><td>${x.horaInicio}–${x.horaFin}</td><td>${esc(x.titulo||'(sin título)')}${x.ubicacion?`<br><span class="ad-muted">${esc(x.ubicacion)}</span>`:''}</td><td>${x.inmuebleNumero?'#'+x.inmuebleNumero:'<span class="ad-muted">no detectado</span>'}</td><td><select data-tipo>${Object.entries(TIPOS_IMPORTAR).filter(([k])=>x.inmuebleId?k!=='captacion':k==='captacion').map(([k,t])=>`<option value="${k}" ${x.tipo===k?'selected':''}>${t}</option>`).join('')}</select></td><td><select data-asesor>${importar.asesores.map(a=>`<option value="${a.id}" ${a.id===x.asesorId?'selected':''}>${esc(a.nombre)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
 <button class="ad-primary" id="imp-confirmar" type="button" style="margin-top:12px">Importar las marcadas</button>`;
 box.onchange=e=>{const tr=e.target.closest('tr');if(!tr)return;const x=f[Number(tr.dataset.i)];
  if(e.target.matches('[data-marca]'))x.marcada=e.target.checked;
  if(e.target.matches('[data-tipo]'))x.tipo=e.target.value;
  if(e.target.matches('[data-asesor]'))x.asesorId=e.target.value;
  box.querySelector('#imp-n').textContent=f.filter(y=>y.marcada).length;};
 box.querySelector('#imp-confirmar').onclick=()=>importarConfirmar(el);
}
async function importarConfirmar(el){
 const marcadas=importar.filas.filter(x=>x.marcada);if(!marcadas.length){aviso('No hay citas marcadas.',true);return;}
 if(!confirm(`¿Importar ${marcadas.length} citas a la agenda?`))return;
 const btn=el.querySelector('#imp-confirmar');btn.disabled=true;btn.textContent='Importando…';
 const {data:{user}}=await supabase.auth.getUser();
 const hoy=new Date(Date.now()-5*3600000).toISOString().slice(0,10);const completar=el.querySelector('#imp-completar').checked;
 // Saltar las ya importadas antes (mismo UID del calendario).
 const ya=new Set();const uids=marcadas.map(x=>'ics:'+x.uid);
 for(let i=0;i<uids.length;i+=100){const {data}=await supabase.from('agenda_citas').select('evento_calendar_id').eq('empresa_id',config.empresa_id).in('evento_calendar_id',uids.slice(i,i+100));for(const r of data||[])ya.add(r.evento_calendar_id);}
 const nuevas=marcadas.filter(x=>!ya.has('ics:'+x.uid));
 const filas=nuevas.map(x=>({empresa_id:config.empresa_id,inmueble_id:x.tipo==='captacion'?null:x.inmuebleId,asesor_id:x.asesorId,fecha:x.fecha,hora_inicio:x.horaInicio,hora_fin:x.horaFin,cliente_nombre:x.tipo==='visita_cliente'?(x.titulo||'Cliente (importado)').slice(0,120):null,cliente_telefono:'',cliente_email:'',estado:completar&&x.fecha<hoy?'completada':'confirmada',evento_calendar_id:'ics:'+x.uid,notas:x.descripcion.slice(0,1000),creado_por:user?.id||null,tipo_cita:x.tipo,titulo:x.titulo.slice(0,200),direccion_libre:x.ubicacion.slice(0,300),ciudad_libre:''}));
 let creadas=0,error=null;
 for(let i=0;i<filas.length;i+=50){const {error:err}=await supabase.from('agenda_citas').insert(filas.slice(i,i+50));if(err){error=err;break;}creadas+=Math.min(50,filas.length-i);}
 const saltadas=marcadas.length-nuevas.length;
 el.querySelector('#imp-resultado').innerHTML=`<p><strong>${creadas}</strong> citas importadas${saltadas?` · ${saltadas} ya estaban importadas y se saltaron`:''}.</p>${error?`<p class="ad-muted" role="alert">Se detuvo por un error: ${esc(error.message)}. Lo importado hasta ahí quedó guardado; puedes volver a subir el archivo y las ya importadas se saltarán.</p>`:''}`;
}
function urlCalendario(token){return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendario-ics?t=${token}`;}
const tokenNuevo=()=>crypto.randomUUID().replace(/-/g,'');
async function calendarioTab(){
 const el=root.querySelector('.ad-subbody');el.innerHTML='<p class="ad-muted">Cargando…</p>';
 const {data:cfg,error:e1}=await supabase.from('agenda_calendario_empresa').select('token').eq('empresa_id',config.empresa_id).maybeSingle();
 const {data:ases,error:e2}=await supabase.from('agenda_asesores').select('id,nombre,color,activo,calendario_token').eq('empresa_id',config.empresa_id).order('nombre');
 if(e1||e2){el.innerHTML='<p class="ad-muted">No se pudo cargar. Si es la primera vez, falta aplicar la migración sql/006.</p>';return;}
 const fila=(titulo,token,tipo,id,color)=>`<li style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${color?`<span style="width:14px;height:14px;border-radius:50%;background:${esc(color)};display:inline-block"></span>`:''}<strong style="min-width:150px">${esc(titulo)}</strong><input type="hidden" value="${esc(urlCalendario(token))}" data-url-cal><span class="ad-muted" style="flex:1;min-width:200px">Enlace privado (no se muestra; usa "Copiar enlace")</span><button type="button" data-copiar-cal>Copiar enlace</button><button type="button" data-regenerar-cal="${tipo}" data-id="${id||''}">Regenerar</button></li>`;
 el.innerHTML=`<h2>Calendario compartido</h2>
 <p>Suscribe estos enlaces en <strong>Google Calendar</strong> (Otros calendarios → Desde URL), <strong>Outlook / Microsoft 365</strong> (Agregar calendario → Suscribirse desde la web) o Apple Calendar. Las citas aparecen solas y se actualizan al mover o cancelar. Es solo lectura y no tiene costo.</p>
 <p class="ad-note">El color lo eliges tú en tu calendario al suscribirte: suscribe el enlace de <em>cada asesor</em> por separado y dale un color distinto, o suscribe el de <em>Todas las agendas</em> para verlas juntas (en ese el título lleva el nombre del asesor). Google actualiza los calendarios suscritos cada varias horas; Outlook suele ser más rápido. Quien tenga el enlace ve la agenda: si se filtra, pulsa "Regenerar" y el enlace anterior deja de funcionar.</p>
 <h3>Todas las agendas</h3><ul class="ad-ciudades">${fila('Todas las agendas',cfg?.token||'','empresa','')}</ul>
 <h3>Por asesor</h3><ul class="ad-ciudades">${(ases||[]).filter(a=>a.activo).map(a=>fila(a.nombre,a.calendario_token||'','asesor',a.id,a.color)).join('')||'<li class="ad-muted">Sin asesores activos.</li>'}</ul>`;
 el.onclick=async e=>{
  const li=e.target.closest('li');
  if(e.target.matches('[data-copiar-cal]')){try{await navigator.clipboard.writeText(li.querySelector('[data-url-cal]').value);aviso('Enlace copiado.');}catch{li.querySelector('[data-url-cal]').select();aviso('Selecciónalo y cópialo con Ctrl+C.');}return;}
  const tipo=e.target.dataset.regenerarCal;if(!tipo)return;
  if(!confirm('¿Regenerar este enlace? Los calendarios que ya estén suscritos con el enlace actual dejarán de actualizarse y habrá que suscribirlos de nuevo.'))return;
  const nuevo=tokenNuevo();
  const q=tipo==='empresa'?supabase.from('agenda_calendario_empresa').upsert({empresa_id:config.empresa_id,token:nuevo}):supabase.from('agenda_asesores').update({calendario_token:nuevo}).eq('id',e.target.dataset.id).eq('empresa_id',config.empresa_id);
  const {error}=await q;if(error){aviso('No se pudo regenerar el enlace.',true);return;}
  await calendarioTab();aviso('Enlace regenerado.');
 };
}
async function equipo(){
 const container=root.querySelector('.ad-subbody');container.innerHTML='<p>Cargando equipo…</p>';const turno=revision;
 const {data,error}=await supabase.from('agenda_asesores').select('*').eq('empresa_id',config.empresa_id).order('nombre');
 await cargarCiudades();await cargarAsesorCiudades();await cargarCoberturas();await cargarAsesorCoberturas();
 try{const r=await listarAccesos(config.empresa_id);accesosPorUsuario={};for(const m of (r.miembros||[]))accesosPorUsuario[m.usuario_id]=m;}catch{accesosPorUsuario={};}
 supervisoresPorAsesor={};
 if(data?.length){
  const r=await supabase.from('agenda_asesor_supervisores').select('asesor_id,supervisor_usuario_id').in('asesor_id',data.map(x=>x.id));
  if(!r.error)for(const fila of r.data||[])(supervisoresPorAsesor[fila.asesor_id]??=[]).push(fila.supervisor_usuario_id);
 }
 if(turno!==revision || root.querySelector('[data-subtab=equipo]').getAttribute('aria-pressed')!=='true')return;
 if(error){container.textContent='No se pudo cargar el equipo. Comprueba que la migración 002 esté aplicada y tu usuario sea administrador.';return;}
 asesores=data;container.innerHTML=`<header><div><h2>Tu equipo</h2><p>${asesores.filter(a=>a.activo).length} activos · ${asesores.length} registrados</p></div><button class="ad-primary" id="ad-nuevo">＋ Nuevo asesor</button></header><p class="ad-note">Estas fichas son solo para quienes <strong>muestran inmuebles</strong> (horarios, ciudades, permisos de citas). Un gerente, directivo o administrador que solo supervisa la agenda NO necesita ficha: créale su acceso en <strong>Accesos</strong> con rol Administrador o Coordinador. Registrar una ficha no crea una cuenta de acceso por sí sola — usa el botón "Dar acceso" en la ficha del asesor cuando quieras que pueda iniciar sesión.</p><label>Buscar asesor<input id="ad-buscar" type="search" placeholder="Nombre, correo o ciudad"></label><div class="ad-cards"></div><div id="ad-editor"></div>`;
 container.querySelector('#ad-nuevo').onclick=()=>editor();container.querySelector('#ad-buscar').oninput=e=>cards(e.target.value);cards();
}
function estadoAccesoHtml(a){
 const m=a.usuario_id?accesosPorUsuario[a.usuario_id]:null;
 if(m)return `<p class="ad-muted">Acceso: ${esc(m.rol)} · ${m.activo?'Activo':'Inactivo'}${!m.ultimo_acceso?' · nunca ha iniciado sesión':''}</p><button type="button" data-gestionar-acceso="${a.id}">Gestionar acceso</button>`;
 const yaVinculados=new Set(asesores.map(x=>x.usuario_id).filter(Boolean));
 const igual=Object.values(accesosPorUsuario).find(x=>String(x.correo||'').toLowerCase()===String(a.correo||'').toLowerCase()&&!yaVinculados.has(x.usuario_id));
 if(igual)return `<p class="ad-muted">Ya existe un acceso con este correo (${esc(igual.rol)}) que no está vinculado a esta ficha.</p><button type="button" data-vincular-acceso="${a.id}" data-usuario="${igual.usuario_id}">Vincular con ese acceso</button>`;
 return `<p class="ad-muted">Sin acceso al sistema todavía</p><button type="button" data-dar-acceso="${a.id}">＋ Dar acceso</button>`;
}
function cards(busqueda=''){
 const rows=asesores.filter(a=>[a.nombre,a.correo,nombresCiudades(a.id)].join(' ').toLocaleLowerCase().includes(busqueda.toLocaleLowerCase()));
 const c=root.querySelector('.ad-cards');c.innerHTML=rows.length?rows.map(a=>`<article><div class="ad-avatar" style="background:${a.color||'#e3f8f7'};color:${textoSobre(a.color)}">${esc(a.nombre.slice(0,1).toUpperCase())}</div><div><h3>${esc(a.nombre)}</h3><p>${esc(a.correo)}<br>${esc(a.celular)}<br>${esc(nombresCiudades(a.id))}</p><span class="ad-pill">${a.activo?'Activo':'Inactivo'}</span> <span class="ad-pill">${esc(a.rol)} · Prioridad ${a.prioridad}</span><span class="ad-pill">${a.tipo_vinculacion==='freelance'?'Freelance':'De planta'}</span><span class="ad-pill">${a.rol==='asesor'?(a.permiso_mover_citas&&a.permiso_eliminar_citas?'Mover y cancelar':a.permiso_mover_citas?'Solo mover':a.permiso_eliminar_citas?'Solo cancelar':'Sin permiso de mover/cancelar'):'Mover y cancelar (por rol)'}</span><span class="ad-pill">${a.atiende_domingo?'Atiende domingos':'No atiende domingos'}</span><span class="ad-pill">${a.atiende_festivos?'Atiende festivos':'No atiende festivos'}</span>${nombresSupervisores(a)?`<span class="ad-pill">Supervisores: ${esc(nombresSupervisores(a))}</span>`:''}${estadoAccesoHtml(a)}<button data-edit="${a.id}">Editar</button> <button data-toggle="${a.id}">${a.activo?'Desactivar':'Reactivar'}</button> <button data-eliminar="${a.id}" class="ad-peligro">Eliminar</button></div></article>`).join(''):'<p>No hay asesores para mostrar. Crea el primero para comenzar.</p>';
 c.onclick=async e=>{
  const darAccesoId=e.target.dataset.darAcceso;
  const gestionarId=e.target.dataset.gestionarAcceso;
  if(darAccesoId){const a=asesores.find(x=>x.id===darAccesoId);if(a)formularioAcceso(a);return;}
  if(e.target.dataset.vincularAcceso){
   e.target.disabled=true;
   try{await vincularAsesorConAcceso(config.empresa_id,e.target.dataset.usuario,e.target.dataset.vincularAcceso);await equipo();aviso('Listo: la ficha y el acceso quedaron vinculados.');}
   catch(err){aviso(err.message,true);e.target.disabled=false;}
   return;
  }
  if(gestionarId){root.querySelector('[data-subtab=accesos]')?.click();return;}
  const eliminarId=e.target.dataset.eliminar;
  if(eliminarId){
   const a=asesores.find(x=>x.id===eliminarId);if(!a)return;
   if(!confirm(`¿Eliminar definitivamente a ${a.nombre}? Esto no se puede deshacer. Si tiene citas reales en su historial, el sistema no lo permitirá (en ese caso usa Desactivar). Su cuenta de acceso, si tiene, no se borra.`))return;
   e.target.disabled=true;
   const {data,error}=await supabase.rpc('agenda_eliminar_asesor',{p_asesor_id:eliminarId});
   if(error){aviso(error.message||'No se pudo eliminar el asesor.',true);e.target.disabled=false;}
   else{await equipo();aviso(`${a.nombre} eliminado${data?.citas_prueba_borradas?` (y ${data.citas_prueba_borradas} cita(s) de prueba)`:''}.`);}
   return;
  }
  const id=e.target.dataset.edit || e.target.dataset.toggle;if(!id)return;const a=asesores.find(x=>x.id===id);if(e.target.dataset.edit){editor(a);return;}if(!confirm(`${a.activo?'Desactivar':'Reactivar'} a ${a.nombre}? Se conservará su ficha. Esto todavía no modifica cuentas de acceso ni citas.`))return;e.target.disabled=true;const {error}=await supabase.from('agenda_asesores').update({activo:!a.activo}).eq('id',id).eq('empresa_id',config.empresa_id).select('id').single();if(error){aviso('No se pudo cambiar el estado.',true);e.target.disabled=false;}else{await equipo();aviso('Estado actualizado.');}};
}
function formularioAcceso(a){
 const el=root.querySelector('#ad-editor');
 setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'center'}),0);
 el.innerHTML=`<form class="ad-form" id="ad-dar-acceso-form"><h3>Dar acceso a ${esc(a.nombre)}</h3>
 <div class="ad-grid">${campo('da_nombre','Nombre',a.nombre,'text','required maxlength="120"')}${campo('da_correo','Correo',a.correo,'email','required')}<label>Rol<select name="da_rol"><option value="asesor" selected>Asesor</option><option value="coordinador">Coordinador</option><option value="administrador">Administrador</option></select></label></div>
 <fieldset><legend>¿Cómo le das acceso?</legend>
  <label class="ad-check"><input type="radio" name="da_modo" value="invitar" checked> Enviarle un correo para que cree su propia contraseña</label>
  <label class="ad-check"><input type="radio" name="da_modo" value="directa"> Ponerle la contraseña yo mismo ahora</label>
 </fieldset>
 <div id="da-clave-directa" hidden><label>Contraseña (mínimo 8 caracteres)<input name="da_password" type="text" minlength="8" autocomplete="off"></label> <button type="button" id="da-generar">Generar una</button><p class="ad-note">Esta contraseña no se envía por correo: cópiala y pásasela tú mismo al asesor.</p></div>
 <div class="ad-actions"><button class="ad-primary" type="submit">Dar acceso</button><button type="button" id="da-cancelar">Cancelar</button></div>
 </form>`;
 const bloqueClave=el.querySelector('#da-clave-directa');
 el.querySelectorAll('[name=da_modo]').forEach(r=>r.addEventListener('change',()=>{bloqueClave.hidden=el.querySelector('[name=da_modo]:checked').value!=='directa';}));
 el.querySelector('#da-generar').onclick=()=>{el.querySelector('[name=da_password]').value=generarPasswordAleatoria();};
 el.querySelector('#da-cancelar').onclick=()=>el.replaceChildren();
 el.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const f=e.target;const b=f.querySelector('[type=submit]');b.disabled=true;
  const modo=f.da_modo.value;const password=modo==='directa'?f.da_password.value:undefined;
  if(modo==='directa' && (!password || password.length<8)){aviso('La contraseña debe tener al menos 8 caracteres.',true);b.disabled=false;return;}
  try{
   const r=await crearAcceso(config.empresa_id,{nombre:f.da_nombre.value.trim(),correo:f.da_correo.value.trim(),rol:f.da_rol.value,password,asesorId:a.id});
   a.usuario_id=r.usuario_id;
   el.replaceChildren();
   if(r.correo_enviado===false&&r.aviso)aviso(r.aviso,true);else aviso(modo==='directa'?'Acceso creado con la contraseña que pusiste.':'Acceso creado. Le llegará un correo de invitación.');
   await equipo();
  }catch(err){aviso(err.message,true);b.disabled=false;}
 };
}
function generarPasswordAleatoria(){
 const bytes=crypto.getRandomValues(new Uint8Array(9));
 return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g,'').slice(0,12);
}
async function cargarAusencias(asesorId){
 const {data}=await supabase.from('agenda_asesores_ausencias').select('*').eq('asesor_id',asesorId).order('fecha_inicio',{ascending:false});
 return data||[];
}
const INDICATIVOS=[['+57','Colombia'],['+1','EE. UU. / Canadá'],['+52','México'],['+34','España'],['+58','Venezuela'],['+593','Ecuador'],['+51','Perú'],['+56','Chile'],['+54','Argentina'],['+55','Brasil'],['+507','Panamá'],['+44','Reino Unido']];
function celularPartido(cel){
 const s=String(cel||'').replace(/[\s()-]/g,'');
 if(!s.startsWith('+'))return {ind:'+57',num:s.replace(/\D/g,'')};
 const ind=INDICATIVOS.map(x=>x[0]).sort((a,b)=>b.length-a.length).find(c=>s.startsWith(c));
 return ind?{ind,num:s.slice(ind.length)}:{ind:'+57',num:s.replace(/\D/g,'')};
}
function horarioEmpresaTexto(){
 return `Horario estándar: entrada ${(config.jornada_inicio||'08:30').slice(0,5)}, salida entre semana ${(config.jornada_fin||'17:00').slice(0,5)}, sábado ${(config.jornada_fin_sabado||'13:00').slice(0,5)}${config.almuerzo_activo!==false?`; almuerzo ${(config.almuerzo_inicio||'12:00').slice(0,5)}–${(config.almuerzo_fin||'13:00').slice(0,5)}`:'; sin almuerzo'}. Si no lo cambias, el asesor usa estas horas.`;
}
function editor(a={}){
 const el=root.querySelector('#ad-editor');
 setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'center'}),0);
 const ciudadesHtml=ciudades.length?ciudades.map(c=>`<label class="ad-check"><input type="checkbox" name="ciudad" value="${c.id}" ${(asesorCiudades[a.id]||[]).includes(c.id)?'checked':''}> ${esc(c.nombre)}</label>`).join(''):'<p class="ad-muted">Todavía no hay ciudades creadas. Ve a la pestaña "Ciudades y festivos" para agregarlas.</p>';
 const coberturasHtml=coberturas.length?coberturasPorCiudad(c=>`<label class="ad-check"><input type="checkbox" name="cobertura" value="${c.id}" ${(asesorCoberturas[a.id]||[]).includes(c.id)?'checked':''}> ${esc(c.nombre)}</label>`):'<p class="ad-muted">Todavía no hay coberturas creadas. Ve a la pestaña "Ciudades y festivos" para agregarlas.</p>';
 const supervisores=supervisoresDisponibles();
 const supervisoresSeleccionados=new Set(supervisorUsuarios(a));
 el.innerHTML=`<form class="ad-form"><h3>${a.id?'Editar asesor':'Nuevo asesor'}</h3><div class="ad-grid">${campo('nombre','Nombre',a.nombre,'text','required maxlength="120"')}${campo('correo','Correo',a.correo,'email','required')}<label class="ad-span">Correos adicionales (separados por ;)<input name="correos_adicionales" type="text" value="${esc(a.correos_adicionales||'')}" placeholder="otro@gmail.com; agenda@empresa.com"><small class="ad-note">Opcional. Cada correo recibe lo mismo que el correo principal del asesor: las invitaciones de calendario de sus citas y los avisos de captación y radicación. Sirve, por ejemplo, para que la agenda también quede en un Google Calendar general de la inmobiliaria o en un correo personal del asesor. No sirve para iniciar sesión.</small></label><div class="ad-celular"><span>Celular</span><div class="ad-celular-fila"><select name="celular_indicativo" aria-label="Indicativo del país">${INDICATIVOS.map(([c,n])=>`<option value="${c}" ${c===celularPartido(a.celular).ind?'selected':''}>${c} ${n}</option>`).join('')}</select><input name="celular_numero" type="tel" inputmode="numeric" required pattern="[0-9]{6,12}" maxlength="14" value="${esc(celularPartido(a.celular).num)}" placeholder="3001234567" aria-label="Número de celular sin indicativo"></div></div><label>Rol<select name="rol"><option value="asesor">Asesor</option><option value="admin">Administrador</option><option value="super_admin">Super administrador</option></select></label><label>Prioridad<select name="prioridad">${[1,2,3,4,5].map(n=>`<option value="${n}">${n}${n===1?' · Mayor prioridad':''}</option>`).join('')}</select></label><label>Vinculación<select name="tipo_vinculacion"><option value="planta">De planta</option><option value="freelance">Freelance</option></select></label><label>Color en la agenda<input type="color" name="color" value="${a.color||PALETA_ASESORES[asesores.length%PALETA_ASESORES.length]}"></label></div>
 <fieldset class="ad-supervisores"><legend>Supervisores</legend><p class="ad-note">Un supervisor recibe copia de los correos que tocan a este asesor: las solicitudes de los propietarios de sus inmuebles y las alertas de las opiniones de clientes sobre sus visitas (por ejemplo, cuando una calificación es baja). No ve ni cambia su agenda por esto. Puedes marcar varios; solo aparecen coordinadores, administradores y superadministradores con acceso activo.</p>${supervisores.length?`<div class="ad-supervisores-lista">${supervisores.map(x=>`<label class="ad-check"><input type="checkbox" name="supervisor_usuario_ids" value="${x.usuario_id}" ${supervisoresSeleccionados.has(x.usuario_id)?'checked':''}> ${esc(x.nombre)} · ${esc(etiquetaRolAcceso(x))}</label>`).join('')}</div>`:'<p class="ad-muted">Todavía no hay personas con acceso para elegir como supervisores.</p>'}</fieldset>
 <div class="ad-grid">
 <fieldset><legend>Ciudades que atiende</legend>${ciudadesHtml}</fieldset>
 <fieldset><legend>Coberturas que cubre (para citas de captación)</legend>${coberturasHtml}</fieldset>
 <label class="ad-check"><input type="checkbox" name="permiso_mover_citas"> Puede mover/reprogramar sus propias citas</label>
 <label class="ad-check"><input type="checkbox" name="permiso_eliminar_citas"> Puede cancelar sus propias citas</label>
 <label class="ad-check"><input type="checkbox" name="atiende_sabado"> Atiende sábados</label>
 <label class="ad-check"><input type="checkbox" name="atiende_domingo"> Atiende domingos</label>
 <label class="ad-check"><input type="checkbox" name="atiende_festivos"> Atiende festivos</label>
 <p class="ad-note">Un asesor con rol Administrador o Súper administrador siempre puede mover y cancelar cualquier cita, sin importar estas casillas. Si este asesor está inactivo o en ausencia, otro asesor activo de la misma ciudad (de planta primero) lo reemplaza automáticamente al sugerir horarios.</p>
 <div class="ad-horarios"><h4>Horario de visitas</h4><p class="ad-note">${horarioEmpresaTexto()}</p>${campo('jornada_inicio','Hora de entrada',a.jornada_inicio?.slice(0,5)||'08:30','time')}${campo('jornada_fin','Hora de salida (entre semana)',a.jornada_fin?.slice(0,5)||'17:00','time')}${campo('jornada_fin_sabado','Hora de salida (sábado)',a.jornada_fin_sabado?.slice(0,5)||'13:00','time')}</div>
 <div class="ad-horarios"><label class="ad-check"><input type="checkbox" name="almuerzo_activo_personal"> Tiene un horario de almuerzo distinto al de la empresa</label><div id="ad-almuerzo-personal" hidden>${campo('almuerzo_inicio','Almuerzo desde',a.almuerzo_inicio?.slice(0,5)||config.almuerzo_inicio?.slice(0,5)||'12:00','time')}${campo('almuerzo_fin','Almuerzo hasta',a.almuerzo_fin?.slice(0,5)||config.almuerzo_fin?.slice(0,5)||'13:00','time')}</div></div>
 <div class="ad-horarios"><label class="ad-check"><input type="checkbox" name="anticipacion_personal"> Tiene una anticipación mínima para agendar distinta a la de la empresa</label><div id="ad-anticipacion-personal" hidden>${campo('horas_minimas_anticipacion','Anticipación mínima (horas)',a.horas_minimas_anticipacion ?? config.horas_minimas_anticipacion ?? 2,'number','min="0" step="1"')}</div><p class="ad-note">La empresa tiene configurada una anticipación mínima de <strong>${config.horas_minimas_anticipacion ?? 2} horas</strong>. Por defecto el asesor usa esa (Configuración de empresa). Si este asesor necesita más o menos tiempo de aviso, defínelo aquí.</p></div>
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
 el.querySelectorAll('[data-cob-todo]').forEach(t=>{const g=t.closest('.ad-cob-grupo');const cbs=()=>[...g.querySelectorAll('[name=cobertura]')];const sync=()=>{t.checked=cbs().length>0&&cbs().every(x=>x.checked);};sync();t.onchange=()=>{cbs().forEach(x=>{x.checked=t.checked;});};g.addEventListener('change',ev=>{if(ev.target.name==='cobertura')sync();});});
 el.querySelector('#ad-cancelar').onclick=()=>el.replaceChildren();el.querySelector('[name=nombre]').focus();
 if(a.id)ausenciasSeccion(el.querySelector('#ad-ausencias'),a.id);
 el.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target;const v={};v.nombre=f.nombre.value.trim();v.correo=f.correo.value.trim().toLowerCase();const extras=f.correos_adicionales.value.split(/[;,\s]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);if(extras.some(x=>!/^(\S+)@(\S+)\.(\S+)$/.test(x))){aviso('Revisa los correos adicionales: hay uno con formato inválido.',true);return;}v.correos_adicionales=[...new Set(extras)].join('; ')||null;v.celular=f.celular_indicativo.value+f.celular_numero.value.replace(/\D/g,'');v.rol=f.rol.value;v.prioridad=Number(f.prioridad.value);v.tipo_vinculacion=f.tipo_vinculacion.value;v.color=f.color.value;v.empresa_id=config.empresa_id;v.permiso_mover_citas=f.permiso_mover_citas.checked;v.permiso_eliminar_citas=f.permiso_eliminar_citas.checked;v.atiende_sabado=f.atiende_sabado.checked;v.atiende_domingo=f.atiende_domingo.checked;v.atiende_festivos=f.atiende_festivos.checked;v.jornada_inicio=f.jornada_inicio.value;v.jornada_fin=f.jornada_fin.value;v.jornada_fin_sabado=f.jornada_fin_sabado.value;v.almuerzo_activo=f.almuerzo_activo_personal.checked?true:null;v.almuerzo_inicio=f.almuerzo_activo_personal.checked?f.almuerzo_inicio.value:null;v.almuerzo_fin=f.almuerzo_activo_personal.checked?f.almuerzo_fin.value:null;v.horas_minimas_anticipacion=f.anticipacion_personal.checked?Number(f.horas_minimas_anticipacion.value):null;
 const ciudadIds=[...f.querySelectorAll('[name=ciudad]:checked')].map(i=>i.value);
 const supervisorIds=[...f.querySelectorAll('[name=supervisor_usuario_ids]:checked')].map(i=>i.value);
 const coberturaIds=[...f.querySelectorAll('[name=cobertura]:checked')].map(i=>i.value);
 v.ciudades=ciudadIds.map(id=>ciudades.find(c=>c.id===id)?.nombre).filter(Boolean).join(', ')||a.ciudades||'Sin ciudad asignada'; // columna heredada con CHECK: no puede quedar vacía
 if(v.celular&&!/^\+[1-9][0-9]{7,14}$/.test(v.celular)){aviso('Revisa el celular: escribe solo el número, sin indicativo ni espacios (por ejemplo 3001234567).',true);return;}
 const b=f.querySelector('[type=submit]');b.disabled=true;
 const {error:errorTablaSupervisores}=await supabase.from('agenda_asesor_supervisores').select('asesor_id').limit(1);
 if(errorTablaSupervisores){b.disabled=false;aviso('No se guardó la ficha: primero debe aplicarse sql/060-supervisores-multiples.sql.',true);return;}
 const q=a.id?supabase.from('agenda_asesores').update(v).eq('id',a.id).eq('empresa_id',config.empresa_id):supabase.from('agenda_asesores').insert(v);
 const {data:guardado,error}=await q.select('id').single();
 if(error){b.disabled=false;aviso(error.code==='23505'?'Ya existe un asesor con ese correo en esta empresa.':'No se pudo guardar. Revisa los datos y la conexión.',true);return;}
 const asesorId=guardado.id;
 const {error:errorSupervisores}=await supabase.rpc('agenda_guardar_supervisores_asesor',{p_asesor_id:asesorId,p_supervisor_usuario_ids:supervisorIds});
 if(errorSupervisores){b.disabled=false;aviso('La ficha se guardó, pero no se pudieron actualizar los supervisores. Falta aplicar sql/060 o hay un acceso no válido.',true);return;}
 if(a._vincular){try{await vincularAsesorConAcceso(config.empresa_id,a._vincular,asesorId);}catch(err){aviso('La ficha se guardó pero no se pudo vincular con el acceso: '+err.message,true);}}
 await supabase.from('agenda_asesores_ciudades').delete().eq('asesor_id',asesorId);
 if(ciudadIds.length)await supabase.from('agenda_asesores_ciudades').insert(ciudadIds.map(ciudad_id=>({asesor_id:asesorId,ciudad_id})));
 await supabase.from('agenda_asesores_coberturas').delete().eq('asesor_id',asesorId);
 if(coberturaIds.length)await supabase.from('agenda_asesores_coberturas').insert(coberturaIds.map(cobertura_id=>({asesor_id:asesorId,cobertura_id})));
 b.disabled=false;await equipo();aviso('Ficha guardada.');};
}
async function ausenciasSeccion(el,asesorId){
 const lista=await cargarAusencias(asesorId);
 el.innerHTML=`<h4>Ausencias e incapacidades</h4><p class="ad-note">Mientras un asesor está en ausencia, el sistema lo salta al sugerir horarios y otro asesor activo de la misma ciudad lo reemplaza automáticamente.</p>${lista.length?`<ul class="ad-ausencias">${lista.map(au=>`<li>${au.fecha_inicio} → ${au.fecha_fin}${au.motivo?' · '+esc(au.motivo):''} <button data-del-ausencia="${au.id}">Eliminar</button></li>`).join('')}</ul>`:'<p class="ad-muted">Sin ausencias registradas.</p>'}<form class="ad-form" id="ad-ausencia-form"><div class="ad-grid">${campo('fecha_inicio','Desde','','date','required')}${campo('fecha_fin','Hasta','','date','required')}${campo('motivo','Motivo (opcional)','','text')}</div><button class="ad-primary" type="submit">Agregar ausencia</button></form>`;
 el.onclick=async e=>{const id=e.target.dataset.delAusencia;if(!id)return;await supabase.from('agenda_asesores_ausencias').delete().eq('id',id);await ausenciasSeccion(el,asesorId);};
 el.querySelector('#ad-ausencia-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_asesores_ausencias').insert({asesor_id:asesorId,fecha_inicio:f.fecha_inicio.value,fecha_fin:f.fecha_fin.value,motivo:f.motivo.value.trim()||null});if(error){aviso('No se pudo guardar la ausencia.',true);return;}await ausenciasSeccion(el,asesorId);};
}
const ETIQUETAS_GEO_PROBLEMA={no_coincide_con_direccion:'La ubicación no coincide con la dirección (revisar en el mapa)',sin_coordenadas:'Sin coordenadas (o en 0,0)',fuera_de_colombia:'Coordenadas fuera de Colombia',lejos_de_la_ciudad_configurada:'Lejos del centro de su ciudad (más de 30 km)'};
const MOTIVOS_NO_DISPONIBLE_ETIQUETA={arrendado:'Se arrendó',vendido:'Se vendió',papeles_radicados:'Papeles radicados por otra persona',otro:'Otro motivo'};
const ETIQUETA_DESTINATARIO={cliente:'A clientes',propietario:'A propietarios',interno:'Internos',arrendatario:'A arrendatarios'};

async function cargarReporteGeolocalizacion(el){
 el.innerHTML='<p class="ad-muted">Revisando coordenadas…</p>';
 const {data,error}=await supabase.rpc('agenda_reporte_geolocalizacion',{p_empresa_id:config.empresa_id});
 if(error){el.innerHTML='<p class="ad-muted">No se pudo cargar el reporte.</p>';return;}
 const {data:disp}=await supabase.from('agenda_inmuebles').select('id').eq('empresa_id',config.empresa_id).eq('disponible',true).range(0,4999);
 const idsDisponibles=new Set((disp||[]).map(i=>i.id));
 const {data:dudosas}=await supabase.rpc('agenda_ubicaciones_dudosas',{p_empresa_id:config.empresa_id});
 const filtrados=[...(dudosas||[]).filter(f=>idsDisponibles.has(f.inmueble_id)).map(f=>({...f,problema:'no_coincide_con_direccion'})),...(data||[]).filter(f=>idsDisponibles.has(f.inmueble_id))];
 if(!filtrados.length){el.innerHTML='<p class="ad-muted">Sin problemas detectados: todos los inmuebles disponibles tienen coordenadas dentro de lo esperado.</p>';return;}
 const grupos={};
 for(const fila of filtrados){(grupos[fila.problema]=grupos[fila.problema]||[]).push(fila);}
 el.innerHTML=Object.entries(grupos).map(([problema,filas])=>`<details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">${esc(ETIQUETAS_GEO_PROBLEMA[problema]||problema)} · ${filas.length}</summary>
  <ul class="ad-ciudades">${filas.map(f=>`<li>#${f.numero_inmueble} · ${esc(f.direccion||'')} · ${esc(f.ciudad||'')}${f.distancia_km_a_ciudad?` · ${Math.round(f.distancia_km_a_ciudad)} km del centro configurado`:''}${f.problema==='no_coincide_con_direccion'?` · a ${esc(String(f.km))} km de donde dice la dirección · <a href="https://www.google.com/maps?q=${esc(String(f.latitud))},${esc(String(f.longitud))}" target="_blank" rel="noopener">ver el punto guardado</a>`:''}</li>`).join('')}</ul>
 </details>`).join('');
}

async function ciudadesTab(){
 const el=root.querySelector('.ad-subbody');el.innerHTML='<p>Cargando…</p>';
 await cargarCiudades();await cargarCoberturas();
 const {data:festivos}=await supabase.from('agenda_festivos').select('*').eq('pais',config.pais||'CO').gte('fecha',new Date().toISOString().slice(0,10)).order('fecha').limit(40);
 el.innerHTML=`<h2>Ciudades</h2><p>Cada ciudad se guarda por separado; luego se asigna a cada asesor desde su ficha en Equipo. La latitud y longitud son el centro aproximado de la ciudad — se usan solo para detectar inmuebles con coordenadas mal cargadas desde Sedi, no afectan la agenda.</p>
 <ul class="ad-ciudades">${ciudades.length?ciudades.map(c=>`<li style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="min-width:110px">${esc(c.nombre)}</span><input type="number" step="0.0001" class="ad-input" data-coord-ciudad="${c.id}" data-campo="latitud" placeholder="Latitud" value="${c.latitud ?? ''}" style="width:120px;min-height:36px"><input type="number" step="0.0001" class="ad-input" data-coord-ciudad="${c.id}" data-campo="longitud" placeholder="Longitud" value="${c.longitud ?? ''}" style="width:120px;min-height:36px"><button type="button" data-guardar-ciudad="${c.id}">Guardar coordenadas</button><button data-del-ciudad="${c.id}">Eliminar</button></li>`).join(''):'<li class="ad-muted">Todavía no hay ciudades.</li>'}</ul>
 <form class="ad-form" id="ad-ciudad-form"><div class="ad-grid">${campo('nombre','Nueva ciudad','','text','required placeholder="Ej: Chía"')}</div><button class="ad-primary" type="submit">Agregar ciudad</button></form>
 <h2 style="margin-top:28px">Coberturas</h2><p>Zonas opcionales dentro de una ciudad (por ejemplo Norte, Sur, Centro). Las captaciones ya se agendan por ciudad con todos sus asesores; la zona solo sirve para dar prioridad a un asesor concreto cuando alguien la tenga marcada. Cada ciudad define las suyas — no tienen que llamarse igual en Bogotá, Barranquilla o Medellín. Luego se asigna cada asesor a sus coberturas desde su ficha en Equipo.</p>
 ${coberturas.length?coberturasPorCiudad(c=>`<li>${esc(c.nombre)} <button data-del-cobertura="${c.id}">Eliminar</button></li>`,'ul'):'<ul class="ad-ciudades"><li class="ad-muted">Todavía no hay coberturas.</li></ul>'}
 <p><button type="button" id="ad-cob-cardinales">Completar puntos cardinales en todas las ciudades</button> <span class="ad-muted">Agrega Norte, Sur, Oriente y Occidente donde falten; no toca las que ya existen.</span></p>
 <form class="ad-form" id="ad-cobertura-form"><div class="ad-grid"><label>Ciudad<select name="ciudad_id" required><option value="">Selecciona una ciudad</option>${ciudades.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></label>${campo('nombre_cobertura','Nombre de la cobertura','','text','required placeholder="Ej: Norte"')}</div><button class="ad-primary" type="submit">Agregar cobertura</button></form>
 <h2 style="margin-top:28px">Festivos</h2><p>Los festivos de Colombia se agregan solos cada año (Ley Emiliani incluida). Puedes agregar fechas adicionales que quieras bloquear en la agenda. Los asesores de planta no atienden festivos por defecto; los freelance pueden activarlo por asesor en su ficha.</p>
 <ul class="ad-ciudades">${(festivos||[]).slice(0,15).map(f=>`<li>${f.fecha} · ${esc(f.nombre)} <button data-del-festivo="${f.id}">Eliminar</button></li>`).join('')||'<li class="ad-muted">Sin festivos próximos.</li>'}</ul>
 <form class="ad-form" id="ad-festivo-form"><div class="ad-grid">${campo('fecha','Fecha','','date','required')}${campo('nombre_festivo','Nombre','','text','required placeholder="Ej: Cierre anual"')}</div><button class="ad-primary" type="submit">Agregar fecha</button></form>
 <h2 style="margin-top:28px">Calidad de geolocalización</h2><p>Inmuebles disponibles con coordenadas ausentes, fuera de Colombia, o lejos del centro de la ciudad que tienen asignada. Repórtalos a Sedi para que corrijan la ubicación en el origen — esta pantalla solo detecta el problema, no lo corrige.</p>
 <div id="ad-geo-report"></div>`;
 cargarReporteGeolocalizacion(el.querySelector('#ad-geo-report'));
 {const hijos=[...el.children];const rep=repartir(hijos,t=>t.startsWith('ciudades')||t.startsWith('coberturas')?'ciudades':t.startsWith('festivos')?'festivos':t.startsWith('calidad')?'geo':undefined,'ciudades');
  montarSubpestanas({id:'ciudades',etiqueta:'Secciones de ciudades y festivos',contenedor:el,antes:hijos[0],grupos:[{id:'ciudades',titulo:'Ciudades y zonas',nodos:rep.ciudades||[]},{id:'festivos',titulo:'Festivos',nodos:rep.festivos||[]},{id:'geo',titulo:'Calidad de ubicación',nodos:rep.geo||[]}]});}
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
 el.querySelector('#ad-cob-cardinales').onclick=async()=>{
  if(!ciudades.length){aviso('Primero crea las ciudades.',true);return;}
  const faltan=[];
  for(const c of ciudades){const tiene=new Set(coberturas.filter(x=>x.ciudad_id===c.id).map(x=>x.nombre.trim().toLowerCase()));for(const n of ['Norte','Sur','Oriente','Occidente'])if(!tiene.has(n.toLowerCase()))faltan.push({empresa_id:config.empresa_id,ciudad_id:c.id,nombre:n});}
  if(!faltan.length){aviso('Todas las ciudades ya tienen los cuatro puntos cardinales.');return;}
  if(!confirm(`Se agregarán ${faltan.length} coberturas (Norte, Sur, Oriente, Occidente) donde falten, en ${ciudades.length} ciudades. ¿Continuar?`))return;
  const {error}=await supabase.from('agenda_coberturas').insert(faltan);
  if(error){aviso('No se pudieron agregar las coberturas.',true);return;}
  await ciudadesTab();aviso(`Se agregaron ${faltan.length} coberturas.`);
 };
 el.querySelector('#ad-cobertura-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_coberturas').insert({empresa_id:config.empresa_id,ciudad_id:f.ciudad_id.value,nombre:f.nombre_cobertura.value.trim()});if(error){aviso(error.code==='23505'?'Esa cobertura ya existe en esa ciudad.':'No se pudo guardar la cobertura.',true);return;}await ciudadesTab();aviso('Cobertura agregada.');};
 el.querySelector('#ad-festivo-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const {error}=await supabase.from('agenda_festivos').insert({pais:config.pais||'CO',fecha:f.fecha.value,nombre:f.nombre_festivo.value.trim()});if(error){aviso(error.code==='23505'?'Ya existe un festivo en esa fecha.':'No se pudo guardar el festivo.',true);return;}await ciudadesTab();aviso('Fecha agregada.');};
}
function marcaForm(){
 const el=root.querySelector('.ad-subbody');
 const enlaceEjemplo=config.dominio_publico?`https://${config.dominio_publico}/inmuebles/245`:'configura el dominio para ver un ejemplo';
 const enlaceInmuebleEjemplo=config.plantilla_enlace_inmueble&&config.plantilla_enlace_inmueble.includes('{numero}')?config.plantilla_enlace_inmueble.replace('{numero}','245'):'usa el dominio de arriba mientras no configures esta plantilla';
 el.innerHTML=`<h2>Configuración de empresa</h2><p>Personaliza la identidad y las reglas de agenda de tu empresa. Cada empresa conserva su propia configuración.</p><form class="ad-form">${tarjetasPaletas(config)}<div class="ad-grid">${campo('nombre_comercial','Nombre comercial',config.nombre_comercial,'text','required maxlength="120"')}${campo('logo_url','Enlace HTTPS del logo',config.logo_url,'url','pattern="https://.*" placeholder="https://…/logo.png"')}${'imagen_correo_url' in config?campo('imagen_correo_url','Imagen de encabezado de los correos (HTTPS, ancho ideal 1160 px)',config.imagen_correo_url||'','url','pattern="https://.*" placeholder="https://…/encabezado-correo.jpg"'):''}${campo('color_principal','Color principal',config.color_principal,'color')}${campo('color_accion','Color de botones',config.color_accion,'color')}</div><h3>Datos de contacto generales</h3><div class="ad-grid">${campo('correo_contacto','Correo de contacto (uso general / comercial)',config.correo_contacto,'email')}${campo('telefono','Teléfono general (si no hay sedes)',config.telefono,'tel')}${campo('enlace_documentos','Enlace para radicar documentos',config.enlace_documentos,'url','pattern="https://.*"')}</div>
 ${htmlContactoEmpresa(config)}
 <h3>Página pública de agendamiento</h3>
 <div class="ad-grid">${campo('dominio_publico','Dominio de la página de agendamiento (donde el cliente reserva)',config.dominio_publico,'text','placeholder="citas.patrimonios.co"')}</div>
 <p class="ad-note">El botón "Agendar cita" usa este dominio, con este formato: <code>${enlaceEjemplo}</code>.</p>
 <div class="ad-grid">${campo('plantilla_enlace_inmueble','Enlace para VER el inmueble en tu sitio real (usa {numero} donde va el código)',config.plantilla_enlace_inmueble,'text','placeholder="https://www.patrimonios.co/inmuebles/#inmueble{numero}"')}</div>
 <p class="ad-note">El botón "Ver inmueble" (en las citas y en la lista de inmuebles) usa esta plantilla para llevar a la ficha real del inmueble en tu página, no a la agenda. Ejemplo con el inmueble 245: <code>${enlaceInmuebleEjemplo}</code>. Si la dejas vacía, se usa el dominio de arriba con el formato <code>/inmuebles/{numero}</code>.</p>
 <h3>Reglas de la agenda</h3>
 <div class="ad-grid">${campo('duracion_visita_minutos','Duración de la primera cita (minutos)',config.duracion_visita_minutos,'number','min="10" step="5" required')}${campo('minutos_traslado_entre_inmuebles','Traslado mínimo entre inmuebles distintos (minutos)',config.minutos_traslado_entre_inmuebles,'number','min="0" step="5" required')}<label>Citas seguidas para el mismo inmueble<select name="modo_mismo_inmueble"><option value="separado">Varias personas al mismo inmueble, escalonadas cada X minutos (visita en grupo escalonada)</option><option value="simultaneo">Varias personas al mismo inmueble a la misma hora (visita en grupo)</option><option value="desactivado">Una sola cita a la vez por asesor (con traslado completo)</option></select></label>${campo('separacion_mismo_inmueble_minutos','Separación entre personas del mismo inmueble (minutos, solo modo escalonado)',config.separacion_mismo_inmueble_minutos,'number','min="5" step="5" required')}${campo('radio_zona_km','Radio de zona (km) para agrupar citas por la mañana/tarde',config.radio_zona_km,'number','min="1" step="0.5" required')}${campo('horas_minimas_anticipacion','Anticipación mínima para agendar (horas)',config.horas_minimas_anticipacion,'number','min="0" step="1" required')}${campo('horas_minimas_anticipacion_mismo_inmueble','Anticipación mínima si el asesor ya está en ese inmueble (horas)',config.horas_minimas_anticipacion_mismo_inmueble,'number','min="0" step="0.5" required')}<label>Formato de hora<select name="formato_hora"><option value="12h">12 horas (2:00 p. m.)</option><option value="24h">24 horas / militar (14:00)</option></select></label></div>
 <p class="ad-note">Cada asesor puede tener su propia anticipación mínima desde su ficha en Equipo; si no la define, se usa la de aquí. La anticipación más corta solo aplica a citas adicionales en un inmueble donde el asesor ya tiene una cita ese día — no hace falta preparar llaves de nuevo.</p>
 <p class="ad-note">Si un asesor ya tiene una cita en la mañana (o en la tarde), en esa misma mitad del día solo se ofrecen inmuebles a menos de este radio; los inmuebles más lejanos se ofrecen para la otra mitad del día, así no cruza la ciudad varias veces. La anticipación mínima evita que agenden una visita en los próximos minutos, para dar tiempo de preparar llaves. El formato de hora aplica tanto en tu agenda interna como en la página pública.</p>
 <h3>Citas de seguimiento según el valor del inmueble</h3>
 <div class="ad-grid">${campo('valor_minimo_canon_seguimiento','Canon mínimo para permitir seguimientos (arriendo, $/mes)',config.valor_minimo_canon_seguimiento,'number','min="0" step="50000"')}${campo('valor_minimo_venta_seguimiento','Precio mínimo para permitir seguimientos (venta, $)',config.valor_minimo_venta_seguimiento,'number','min="0" step="1000000"')}</div>
 <p class="ad-note">Si el canon o el precio de venta de un inmueble está por debajo de este mínimo, no se le ofrecen citas de seguimiento (solo su cita inicial): en cuanto termina + el traslado, el asesor queda libre para otros inmuebles, incluyendo los de mayor valor. Deja en 0 para no aplicar ningún límite.</p>
 <div class="ad-grid">${campo('valor_alto_canon_zona','Canon desde el cual un inmueble es de alto valor (arriendo, $/mes)',config.valor_alto_canon_zona,'number','min="0" step="50000"')}${campo('valor_alto_venta_zona','Precio desde el cual un inmueble es de alto valor (venta, $)',config.valor_alto_venta_zona,'number','min="0" step="1000000"')}</div>
 <p class="ad-note">Un inmueble de alto valor puede agendarse aunque quede fuera de la zona/mitad del día del asesor ese momento: no espera a la otra mitad del día, solo respeta el tiempo de traslado real hasta y desde ese inmueble. Deja en 0 para no aplicar ninguna excepción.</p>
 <h3>Reservas públicas</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" name="verificar_correo_reserva"> Pedir el código de verificación al correo en la reserva pública</label></div>
 ${'captacion_publica_activa' in config?`<div class="ad-grid"><label class="ad-check"><input type="checkbox" name="captacion_publica_activa"> <span>Habilitar la página <code>/consignar</code> para que los propietarios agenden solos su cita de captación. Enlace para compartir: <code>https://${esc(config.dominio_publico||'tu-dominio')}/consignar</code></span></label></div>`:''}
 ${'consignar_url' in config?`<div class="ad-grid">${campo('consignar_url','Página a la que lleva el botón «Quiero consignar un inmueble» de los correos (https://…). Vacío = la página de consignar de esta agenda',config.consignar_url||'','url','placeholder="https://www.patrimonios.co/consigna-tu-inmueble"')}</div>`:''}
 ${'captacion_video_url' in config?`<div class="ad-grid">${campo('captacion_video_url','Video explicativo de /consignar (enlace de YouTube, opcional)',config.captacion_video_url||'','text')}</div>`:''}
 <p class="ad-note">Déjalo <strong>encendido</strong> en producción: evita que alguien reserve con un correo ajeno. Apágalo solo mientras haces pruebas, para no tener que teclear el código cada vez, y vuelve a encenderlo.</p>
 <h3>Agendar sobre un horario ocupado</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" name="asesores_pueden_cruzar"> Los asesores pueden agendar una cita aunque ese horario esté ocupado (se les muestra una advertencia y deben confirmar)</label></div>
 <p class="ad-note">Si lo apagas, solo los administradores pueden hacerlo. Las citas agendadas así quedan marcadas como «cruce autorizado» con quién lo confirmó.</p>
 <h3>Almuerzo (horario general de la empresa)</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" name="almuerzo_activo"> La agenda respeta un horario de almuerzo</label>${campo('almuerzo_inicio','Almuerzo desde',config.almuerzo_inicio?.slice(0,5)||'12:00','time')}${campo('almuerzo_fin','Almuerzo hasta',config.almuerzo_fin?.slice(0,5)||'13:00','time')}</div>
 <p class="ad-note">Cada asesor puede tener su propio horario de almuerzo desde su ficha en Equipo; si no lo define, se usa este.</p>
 ${'encuesta_minutos_despues' in config?`<h3>Encuesta al cliente</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" name="encuesta_automatica"> Enviar la encuesta automáticamente después de cada visita</label>${campo('encuesta_minutos_despues','Minutos después de terminar la visita',config.encuesta_minutos_despues??30,'number','min="0" max="1440" step="5"')}</div>
 <p class="ad-note">El cliente recibe el correo «¿Cómo te pareció el inmueble?» pasado este tiempo desde la hora en que terminaba la visita. Si lo desactivas, la encuesta no se envía sola. Las respuestas se ven en Bitácora → Encuestas de clientes y en el informe del propietario.</p>
 ${'encuesta_aviso_admin' in config?`<div class="ad-grid"><label>Aviso a la administración cuando un cliente responde<select name="encuesta_aviso_admin"><option value="cada">Un correo por cada encuesta contestada</option><option value="semanal">Un resumen semanal (lunes)</option><option value="ninguna">Ninguno</option></select></label>${campo('encuesta_aviso_correos','Enviar los avisos a (opcional; si lo dejas vacío van a los administradores)',config.encuesta_aviso_correos||'','text','placeholder="gerencia@empresa.com; otra@empresa.com"')}</div>
 <p class="ad-note">Además, el asesor de la visita recibe siempre un correo cuando el cliente dice que quiere avanzar, una segunda visita o que lo contacten.</p>`:''}`:''}
 <h3>Permisos del panel interno</h3>
 <div class="ad-grid"><label class="ad-check"><input type="checkbox" checked disabled> Administradores (siempre pueden ver la pestaña Equipo)</label><label class="ad-check"><input type="checkbox" name="equipo_ve_coordinador"> Coordinadores también pueden ver la pestaña Equipo</label><label class="ad-check"><input type="checkbox" name="equipo_ve_asesor"> Asesores también pueden ver la pestaña Equipo</label></div>
 <p class="ad-note">La pestaña "Equipo" dentro de la agenda (Agenda / Inmuebles / Equipo) muestra los datos de todos los asesores. Por defecto solo la ven los administradores; actívalo aquí si algún coordinador o asesor también debe verla. Esto no afecta el panel de Configuración, que ya es solo para administradores.</p>
 <button class="ad-primary" type="submit" style="margin-top:18px">Guardar configuración</button></form>`;
 el.querySelector('[name=modo_mismo_inmueble]').value=config.modo_mismo_inmueble||'separado';
 el.querySelector('[name=formato_hora]').value=config.formato_hora||'12h';
const chkVerif=el.querySelector('[name=verificar_correo_reserva]');if(chkVerif)chkVerif.checked=config.verificar_correo_reserva!==false;
 const chkCapt=el.querySelector('[name=captacion_publica_activa]');if(chkCapt)chkCapt.checked=config.captacion_publica_activa===true;
const chkCruce=el.querySelector('[name=asesores_pueden_cruzar]');if(chkCruce)chkCruce.checked=config.asesores_pueden_cruzar!==false;
 el.querySelector('[name=almuerzo_activo]').checked=config.almuerzo_activo!==false;
 const chkEncuesta=el.querySelector('[name=encuesta_automatica]');if(chkEncuesta)chkEncuesta.checked=config.encuesta_automatica!==false;
 const selAviso=el.querySelector('[name=encuesta_aviso_admin]');if(selAviso)selAviso.value=config.encuesta_aviso_admin||'cada';
 const rolesEquipo=Array.isArray(config.equipo_visible_roles)&&config.equipo_visible_roles.length?config.equipo_visible_roles:['administrador'];
 el.querySelector('[name=equipo_ve_coordinador]').checked=rolesEquipo.includes('coordinador');
 el.querySelector('[name=equipo_ve_asesor]').checked=rolesEquipo.includes('asesor');
 const formCfg=el.querySelector('form');
 const editorContacto=montarContactoEmpresa(formCfg, config);
 {const hijos=[...formCfg.children].filter(n=>!n.matches('button[type=submit]'));
  const mapa=t=>t.startsWith('datos de contacto')||t.startsWith('contacto y datos')||t.startsWith('sedes')?'contacto':t.startsWith('pagina publica')||t.startsWith('reservas publicas')?'reservas':t.startsWith('reglas de la agenda')||t.startsWith('citas de seguimiento')||t.startsWith('agendar sobre')||t.startsWith('almuerzo')?'horarios':t.startsWith('encuesta')||t.startsWith('permisos')?'encuestas':undefined;
  const rep=repartir(hijos,mapa,'marca');
  montarSubpestanas({id:'empresa',etiqueta:'Secciones de la configuración de empresa',contenedor:formCfg,antes:formCfg,botonGuardar:null,grupos:[
   {id:'marca',titulo:'Marca y colores',nodos:rep.marca||[]},{id:'contacto',titulo:'Contacto y sedes',nodos:rep.contacto||[]},{id:'horarios',titulo:'Horarios y reglas',nodos:rep.horarios||[]},{id:'reservas',titulo:'Reservas públicas',nodos:rep.reservas||[]},{id:'encuestas',titulo:'Encuestas y permisos',nodos:rep.encuestas||[]}]});}
 const vistaPrevia=()=>aplicarTema({...config,color_principal:formCfg.color_principal.value,color_accion:formCfg.color_accion.value});
 const marcarPaleta=()=>{const act=paletaActiva({color_principal:formCfg.color_principal.value,color_accion:formCfg.color_accion.value})?.id;const d=derivarPaleta(formCfg.color_principal.value,formCfg.color_accion.value);formCfg.querySelectorAll('.ad-paleta').forEach(o=>o.setAttribute('aria-pressed',String(o.dataset.paleta===(act||'propia'))));const pr=formCfg.querySelector('.ad-paleta-propia .ad-paleta-muestra');if(pr){pr.style.background=formCfg.color_principal.value;const [a,t,f]=pr.querySelectorAll('i');a.style.background=formCfg.color_accion.value;t.style.background=d.tinte;f.style.background=d.fondo;}};
 formCfg.querySelectorAll('.ad-paleta').forEach(btn=>btn.onclick=()=>{if(btn.dataset.paleta==='propia'){formCfg.color_principal.focus();return;}const p=PALETAS.find(x=>x.id===btn.dataset.paleta);formCfg.color_principal.value=p.principal.toLowerCase();formCfg.color_accion.value=p.accion.toLowerCase();marcarPaleta();vistaPrevia();});
 for(const n of ['color_principal','color_accion'])formCfg[n].addEventListener('input',()=>{marcarPaleta();vistaPrevia();});
 formCfg.onsubmit=async e=>{e.preventDefault();const f=e.target;const b=f.querySelector('[type=submit]');b.disabled=true;
 let contactoActual;try{contactoActual=editorContacto.leer();}catch(error){b.disabled=false;aviso(error.message,true);return;}
 const equipoVisibleRoles=['administrador'];if(f.equipo_ve_coordinador.checked)equipoVisibleRoles.push('coordinador');if(f.equipo_ve_asesor.checked)equipoVisibleRoles.push('asesor');
 const v={...contactoActual,...('captacion_publica_activa' in config?{captacion_publica_activa:f.captacion_publica_activa.checked}:{}),...('consignar_url' in config?{consignar_url:/^https:\/\//i.test(f.consignar_url.value.trim())?f.consignar_url.value.trim():null}:{}),...('captacion_video_url' in config?{captacion_video_url:f.captacion_video_url.value.trim()||null}:{}),...('verificar_correo_reserva' in config?{verificar_correo_reserva:f.verificar_correo_reserva.checked}:{}),...('asesores_pueden_cruzar' in config?{asesores_pueden_cruzar:f.asesores_pueden_cruzar.checked}:{}),...('encuesta_minutos_despues' in config?{encuesta_automatica:f.encuesta_automatica.checked,encuesta_minutos_despues:Math.max(0,Math.min(1440,Number(f.encuesta_minutos_despues.value)||0))}:{}),...('encuesta_aviso_admin' in config?{encuesta_aviso_admin:f.encuesta_aviso_admin.value,encuesta_aviso_correos:f.encuesta_aviso_correos.value.trim()}:{}),empresa_id:config.empresa_id,nombre_comercial:f.nombre_comercial.value.trim(),logo_url:f.logo_url.value.trim(),...('imagen_correo_url' in config?{imagen_correo_url:f.imagen_correo_url.value.trim()||null}:{}),color_principal:f.color_principal.value,color_accion:f.color_accion.value,correo_contacto:f.correo_contacto.value.trim(),telefono:f.telefono.value.trim(),enlace_documentos:f.enlace_documentos.value.trim(),dominio_publico:f.dominio_publico.value.trim()||null,plantilla_enlace_inmueble:f.plantilla_enlace_inmueble.value.trim()||null,duracion_visita_minutos:Number(f.duracion_visita_minutos.value),minutos_traslado_entre_inmuebles:Number(f.minutos_traslado_entre_inmuebles.value),modo_mismo_inmueble:f.modo_mismo_inmueble.value,separacion_mismo_inmueble_minutos:Number(f.separacion_mismo_inmueble_minutos.value),radio_zona_km:Number(f.radio_zona_km.value),valor_minimo_canon_seguimiento:Number(f.valor_minimo_canon_seguimiento.value),valor_minimo_venta_seguimiento:Number(f.valor_minimo_venta_seguimiento.value),valor_alto_canon_zona:Number(f.valor_alto_canon_zona.value),valor_alto_venta_zona:Number(f.valor_alto_venta_zona.value),horas_minimas_anticipacion:Number(f.horas_minimas_anticipacion.value),horas_minimas_anticipacion_mismo_inmueble:Number(f.horas_minimas_anticipacion_mismo_inmueble.value),formato_hora:f.formato_hora.value,almuerzo_activo:f.almuerzo_activo.checked,almuerzo_inicio:f.almuerzo_inicio.value,almuerzo_fin:f.almuerzo_fin.value,equipo_visible_roles:equipoVisibleRoles};
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

function formatearFechaCorreo(iso){
 if(!iso)return'';
 const d=new Date(iso);
 return d.toLocaleString('es-CO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}
const ETIQUETAS_ESTADO_CORREO={enviado:{texto:'✅ Enviado',clase:'ad-log-enviado'},fallido:{texto:'❌ Falló',clase:'ad-log-fallido'},omitido:{texto:'⏭️ Omitido',clase:'ad-log-omitido'}};
function bitacoraCorreoHtml(filas){
 if(!filas||!filas.length)return'<p class="ad-muted">Todavía no se ha intentado enviar ningún correo de citas.</p>';
 return `<ul class="ad-bitacora-correo">${filas.map(f=>{
  const est=ETIQUETAS_ESTADO_CORREO[f.estado]||{texto:f.estado,clase:''};
  return `<li class="${est.clase}">
   <div class="ad-bitacora-linea1"><span class="ad-bitacora-estado">${est.texto}</span><span class="ad-bitacora-fecha">${formatearFechaCorreo(f.creado_en)}</span></div>
   <div class="ad-bitacora-linea2">${esc(f.destinatario_email||'(sin destinatario)')}${f.modo_pruebas?' · <span class="ad-bitacora-pruebas">modo pruebas</span>':''}</div>
   ${f.asunto?`<div class="ad-bitacora-asunto">${esc(f.asunto)}</div>`:''}
   ${f.detalle_error?`<div class="ad-bitacora-error">${esc(f.detalle_error)}</div>`:''}
  </li>`;
 }).join('')}</ul>`;
}
async function correoForm(){
 const el=root.querySelector('.ad-subbody');
 el.innerHTML='<p class="ad-muted">Cargando…</p>';
 const {data:tienePassword}=await supabase.rpc('agenda_correo_tiene_password',{p_empresa_id:config.empresa_id});
 const {data:logCorreos}=await supabase.from('agenda_correos_log').select('*').eq('empresa_id',config.empresa_id).order('creado_en',{ascending:false}).limit(20);
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
  <div class="ad-grid"><label>Contraseña / clave de aplicación${tienePassword?' · <small class="ad-muted">ya guardada, deja este campo vacío para conservarla</small>':''}<span class="ad-correo-password-row"><input name="correo_password" type="password" placeholder="${tienePassword?'••••••••••••••••':'Pega aquí la clave de aplicación'}" autocomplete="new-password"><button type="button" class="ad-link-btn" data-reveal-password>Mostrar</button></span></label></div>
  <p class="ad-note" style="margin-top:-6px">Por seguridad, una contraseña ya guardada no se puede volver a mostrar aquí — ni siquiera un administrador puede leerla directamente desde el navegador. El botón "Mostrar" solo revela lo que estás escribiendo en este momento. Si no la recuerdas, usa "Probar configuración" abajo para confirmar que sigue funcionando, o vuelve a pegarla para reemplazarla.</p>
  <h3 style="margin-top:26px">4. Modo de pruebas</h3>
  <label class="ad-toggle"><input type="checkbox" name="correo_modo_pruebas"><span class="ad-toggle-track"><span class="ad-toggle-thumb"></span></span><span>Mientras ajustamos el diseño, enviar TODOS los correos (cliente y propietario) a un solo correo de pruebas</span></label>
  <label class="ad-toggle" style="margin-top:12px"><input type="checkbox" name="encuestas_pausadas"><span class="ad-toggle-track"><span class="ad-toggle-thumb"></span></span><span>⏸️ Pausar las encuestas automáticas al cliente <small class="ad-muted">(se aplica al instante; acuérdate de reactivarlas al salir a producción)</small></span></label>
  <div class="ad-grid" style="margin-top:14px">${campo('correo_pruebas_destino','Correo donde quieres recibir las pruebas',config.correo_pruebas_destino||'pf.castelli@patrimonios.co','email','placeholder="tu-correo@patrimonios.co"')}</div>
  <p class="ad-note">Con el modo de pruebas activo, ningún cliente ni propietario recibe correos todavía: absolutamente todo llega al correo de arriba, para que revises el contenido y el diseño antes de salir a producción. Cuando estés listo, apaga el interruptor y los correos empezarán a llegar a los destinatarios reales.</p>
  <button class="ad-primary" type="submit" style="margin-top:20px">Guardar configuración de correo</button>
 </form>
 <h3 style="margin-top:34px">5. Probar la configuración</h3>
 <p class="ad-note">Manda un correo de prueba de inmediato con los datos ya guardados, para confirmar que el host, el usuario y la contraseña son correctos sin tener que agendar una visita.</p>
 <div class="ad-probar-correo">
  <input type="email" class="ad-probar-correo-destino" placeholder="Correo de destino" value="${esc(config.correo_pruebas_destino||'')}">
  <button type="button" class="ad-secondary" data-probar-correo>Enviar correo de prueba</button>
  <button type="button" class="ad-secondary ad-peligro" data-limpiar-pruebas>Borrar datos de prueba</button>
 </div>
 <div class="ad-probar-correo-resultado" role="status"></div>
 <p class="ad-note">«Borrar datos de prueba» elimina solo las citas marcadas como PRUEBA, los asesores de simulación ([SIM]) y los accesos de prueba (sim+…@example.com). Antes de borrar te muestra cuántos son. Nunca toca citas reales, asesores reales ni tu propio acceso.</p>
 <h3 style="margin-top:34px">6. Bitácora de envíos</h3>
 <p class="ad-note">Aquí ves los últimos intentos de envío del correo de confirmación a clientes, incluidas las fallas, para poder revisar qué pasó cuando alguien reserve una visita.</p>
 ${bitacoraCorreoHtml(logCorreos)}`;
 el.querySelector('[name=correo_smtp_seguridad]').value=config.correo_smtp_seguridad||PROVEEDORES_CORREO[proveedorInicial].seguridad;
 el.querySelector('[name=correo_modo_pruebas]').checked=modoPruebas;
 {const chkPausa=el.querySelector('[name=encuestas_pausadas]');chkPausa.checked=config.encuesta_automatica===false;
  chkPausa.onchange=async()=>{chkPausa.disabled=true;
   const {error}=await supabase.from('agenda_configuracion').update({encuesta_automatica:!chkPausa.checked}).eq('empresa_id',config.empresa_id);
   chkPausa.disabled=false;
   if(error){chkPausa.checked=!chkPausa.checked;aviso('No se pudo cambiar la pausa de encuestas. Verifica permisos y conexión.',true);return;}
   config.encuesta_automatica=!chkPausa.checked;
   aviso(chkPausa.checked?'Encuestas en pausa: no se enviará ninguna.':'Encuestas reactivadas: se enviarán después de cada visita.');};}
 {const formCo=el.querySelector('form');const boton=formCo.querySelector('button[type=submit]');
  const nodos=[...[...formCo.children].filter(n=>n!==boton),...[...el.children].slice([...el.children].indexOf(formCo)+1)];
  const rep=repartir(nodos,t=>/^[123]\./.test(t)?'conexion':/^[45]\./.test(t)?'pruebas':/^6\./.test(t)?'bitacora':undefined,'conexion');
  montarSubpestanas({id:'correo',etiqueta:'Secciones del correo',contenedor:el,antes:formCo,botonGuardar:boton,grupos:[
   {id:'conexion',titulo:'Cuenta y servidor',nodos:rep.conexion||[]},{id:'pruebas',titulo:'Modo de pruebas y envío de prueba',nodos:rep.pruebas||[]},{id:'bitacora',titulo:'Bitácora de envíos',nodos:rep.bitacora||[],guardar:false}]});}
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
 el.querySelector('[data-reveal-password]').addEventListener('click',ev=>{
  const inp=el.querySelector('[name=correo_password]');
  const mostrar=inp.type==='password';
  inp.type=mostrar?'text':'password';
  ev.currentTarget.textContent=mostrar?'Ocultar':'Mostrar';
 });
 el.querySelector('[data-probar-correo]').addEventListener('click',async ev=>{
  const boton=ev.currentTarget;const destino=el.querySelector('.ad-probar-correo-destino').value.trim();
  const resultado=el.querySelector('.ad-probar-correo-resultado');
  boton.disabled=true;resultado.textContent='Enviando…';resultado.classList.remove('error');
  try{
   const {data,error}=await supabase.functions.invoke('probar-correo-config',{
    body:{empresa_id:config.empresa_id,destino},
   });
   if(error||!data?.ok){
    resultado.textContent='❌ '+(data?.error||'No se pudo enviar el correo de prueba.');
    resultado.classList.add('error');
   }else{
    resultado.textContent='✅ Correo de prueba enviado a '+data.destino+'. Revisa esa bandeja (y la de spam).';
   }
  }catch(e){
   resultado.textContent='❌ No se pudo conectar con el servicio de correo.';
   resultado.classList.add('error');
  }
  boton.disabled=false;
 });
 el.querySelector('[data-limpiar-pruebas]').addEventListener('click',async ev=>{
  const boton=ev.currentTarget;const resultado=el.querySelector('.ad-probar-correo-resultado');
  boton.disabled=true;resultado.classList.remove('error');resultado.textContent='Calculando…';
  const {data:prev,error:e1}=await supabase.rpc('agenda_limpiar_datos_prueba',{p_empresa_id:config.empresa_id,p_ejecutar:false});
  if(e1){resultado.textContent='❌ '+(e1.message||'No se pudo calcular.');resultado.classList.add('error');boton.disabled=false;return;}
  if(!prev.citas&&!prev.asesores&&!prev.usuarios){resultado.textContent='No hay datos de prueba para borrar.';boton.disabled=false;return;}
  if(!confirm(`Se borrarán definitivamente: ${prev.citas} cita(s) de prueba, ${prev.asesores} asesor(es) de prueba y ${prev.usuarios} usuario(s) de prueba. No se puede deshacer. ¿Continuar?`)){resultado.textContent='Cancelado, no se borró nada.';boton.disabled=false;return;}
  const {data,error}=await supabase.rpc('agenda_limpiar_datos_prueba',{p_empresa_id:config.empresa_id,p_ejecutar:true});
  if(error){resultado.textContent='❌ '+(error.message||'No se pudo borrar.');resultado.classList.add('error');}
  else resultado.textContent=`✅ Borrado: ${data.citas} cita(s), ${data.asesores} asesor(es) y ${data.usuarios} usuario(s) de prueba.`;
  boton.disabled=false;
 });
 el.querySelector('form').onsubmit=async e=>{
  e.preventDefault();const f=e.target;const b=f.querySelector('button[type=submit]');b.disabled=true;
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

let accesosCache = null;
let rolesAccesos = [];
let accesoClaveAbiertaId = null;

function formatearFechaAcceso(iso) {
 if (!iso) return '';
 try { return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); }
 catch { return ''; }
}

async function accesosTab() {
 const el = root.querySelector('.ad-subbody');
 el.innerHTML = '<p class="ad-muted">Cargando accesos…</p>';
 let miembros;
 try {
  const respuesta = await listarAccesos(config.empresa_id);
  accesosCache = respuesta.miembros || [];
  miembros = accesosCache;
 } catch (e) {
  el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  return;
 }
 const gestionaRoles = puede('roles.gestionar');
 rolesAccesos = [];
 if (gestionaRoles || puede('roles.ver')) { try { rolesAccesos = await listarRoles(config.empresa_id); } catch { rolesAccesos = []; } }
 const nombreRol = m => rolesAccesos.find(r => r.id === m.rol_id)?.nombre || m.rol;
 const { data: fichasAcceso } = await supabase.from('agenda_asesores').select('id,nombre,correo,usuario_id,activo').eq('empresa_id', config.empresa_id);
 const fichas = fichasAcceso || [];
 const filaAsesor = m => {
  const ficha = fichas.find(f => f.usuario_id === m.usuario_id);
  if (ficha) return `<span class="ad-pill">✓ Es asesor${ficha.activo ? '' : ' (ficha inactiva)'}</span>`;
  const igual = fichas.find(f => !f.usuario_id && String(f.correo || '').toLowerCase() === String(m.correo || '').toLowerCase());
  return `<button type="button" data-hacer-asesor="${m.usuario_id}" ${igual ? `data-ficha="${igual.id}"` : ''}>${igual ? 'Vincular con su ficha de asesor' : 'Activar también como asesor'}</button>`;
 };
 const fila = m => {
  const abierta = accesoClaveAbiertaId === m.usuario_id;
  const estado = m.ultimo_acceso
   ? `Último acceso: ${formatearFechaAcceso(m.ultimo_acceso)}`
   : 'Aún no ha iniciado sesión';
  return `<li>
   <div class="ad-acceso-info"><strong>${esc(m.nombre)}</strong><span class="ad-muted">${esc(m.correo)}</span>
    <span class="ad-pill">${esc(nombreRol(m))}</span><span class="ad-pill">${m.activo ? 'Activo' : 'Inactivo'}</span>
    <span class="ad-muted">${esc(estado)}</span> ${filaAsesor(m)}</div>
   <div class="ad-acceso-botones">
    ${gestionaRoles && rolesAccesos.length ? `<label class="ad-acceso-rol">Rol <select data-asignar-rol="${m.usuario_id}" aria-label="Rol de ${esc(m.nombre)}">${m.rol_id ? '' : '<option value="" selected disabled>Elegir rol…</option>'}${rolesAccesos.map(r => `<option value="${esc(r.id)}" ${r.id === m.rol_id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></label>` : ''}
    ${abierta
     ? `<form class="ad-acceso-clave-form" data-clave-form="${m.usuario_id}"><input type="password" name="clave" placeholder="Nueva contraseña (mín. 8)" minlength="8" required autocomplete="new-password"><button type="submit" class="ad-primary">Guardar</button><button type="button" data-cancelar-clave>Cancelar</button></form>`
     : `<button type="button" data-cambiar-pass="${m.usuario_id}">Cambiar contraseña</button>`}
    ${!m.ultimo_acceso ? `<button type="button" data-reenviar="${m.usuario_id}">Reenviar invitación</button>` : ''}
    <button type="button" data-alternar="${m.usuario_id}" data-activo-actual="${m.activo ? '1' : '0'}">${m.activo ? 'Desactivar' : 'Reactivar'}</button>
    ${datosPermisos().esSuper && m.usuario_id !== acceso?.usuario?.id ? `<button type="button" class="ad-peligro" data-eliminar="${m.usuario_id}">Eliminar usuario</button>` : ''}
   </div>
  </li>`;
 };
 el.innerHTML = `<h2>Accesos</h2>
 <p>Aquí administras quién puede iniciar sesión en la agenda. Es independiente de la ficha de cada asesor en Equipo: crear a alguien en Equipo no le da acceso por sí solo, hay que crearle también su acceso aquí. Al crear un acceso nuevo, le llega un correo para que defina su propia contraseña.</p>
 <ul class="ad-accesos">${miembros.length ? miembros.map(fila).join('') : '<p class="ad-muted">Todavía no hay accesos creados.</p>'}</ul>
 <h3 style="margin-top:26px">Crear acceso nuevo</h3>
 <form id="ad-acceso-form" class="ad-form" style="margin-top:10px">
  <div class="ad-grid">
   <label>Nombre<input name="nombre" required maxlength="120" placeholder="Nombre completo"></label>
   <label>Correo<input name="correo" type="email" required placeholder="nombre@empresa.com"></label>
   <label>Rol<select name="rol"><option value="asesor">Asesor</option><option value="coordinador">Coordinador</option><option value="administrador">Administrador</option></select></label>
  </div>
  <p id="ad-acceso-rol-nota" class="ad-note" style="margin:0"></p>
  <fieldset><legend>¿Cómo le das acceso?</legend>
   <label class="ad-check"><input type="radio" name="modo" value="invitar" checked> Enviarle un correo para que cree su propia contraseña</label>
   <label class="ad-check"><input type="radio" name="modo" value="directa"> Ponerle la contraseña yo mismo ahora</label>
  </fieldset>
  <div id="ad-acceso-clave-directa" hidden><label>Contraseña (mínimo 8 caracteres)<input name="password" type="text" minlength="8" autocomplete="off"></label> <button type="button" id="ad-acceso-generar">Generar una</button><p class="ad-note">Esta contraseña no se envía por correo: cópiala y pásasela tú mismo a la persona.</p></div>
  <button type="submit" class="ad-primary" style="align-self:end">Crear acceso</button>
 </form>
 <p class="ad-note">Si eliges invitar por correo, la persona recibe un enlace de un solo uso para elegir su propia contraseña. Si no le llega o el enlace expira, usa "Reenviar invitación". También puedes cambiarle la contraseña después con "Cambiar contraseña".</p>`;

 el.querySelectorAll('[data-hacer-asesor]').forEach(b => b.addEventListener('click', async () => {
  const usuarioId = b.dataset.hacerAsesor;
  const m = accesosCache.find(x => x.usuario_id === usuarioId);
  if (b.dataset.ficha) {
   b.disabled = true;
   try { await vincularAsesorConAcceso(config.empresa_id, usuarioId, b.dataset.ficha); await accesosTab(); aviso('Listo: ya es asesor (ficha vinculada).'); }
   catch (err) { aviso(err.message, true); b.disabled = false; }
   return;
  }
  await abrirSubtab('equipo');
  editor({ nombre: m?.nombre || '', correo: m?.correo || '', _vincular: usuarioId });
 }));
 const notaRol = () => {
  const rol = el.querySelector('#ad-acceso-form [name=rol]').value;
  el.querySelector('#ad-acceso-rol-nota').textContent = rol === 'asesor'
   ? 'Asesor: es quien muestra inmuebles. Además de este acceso necesita su ficha en Equipo (horario, ciudades); lo más fácil es crear la ficha en Equipo y usar "Dar acceso" desde ahí.'
   : 'Este rol NO necesita ficha de asesor: solo se crea el acceso. Verá y controlará la agenda de todos, pero no aparece como asesor ni se le asignan visitas.';
 };
 el.querySelector('#ad-acceso-form [name=rol]').addEventListener('change', notaRol);
 notaRol();
 el.querySelectorAll('[data-asignar-rol]').forEach(s => s.addEventListener('change', async () => {
  s.disabled = true;
  const { error } = await supabase.rpc('agenda_miembro_asignar_rol', { p_empresa_id: config.empresa_id, p_usuario_id: s.dataset.asignarRol, p_rol_id: s.value });
  if (error) { aviso(error.message || 'No se pudo asignar el rol.', true); await accesosTab(); return; }
  aviso('Rol asignado.');
  await accesosTab();
 }));
 el.querySelectorAll('[data-cambiar-pass]').forEach(b => b.addEventListener('click', () => {
  accesoClaveAbiertaId = b.dataset.cambiarPass;
  accesosTab();
 }));
 el.querySelectorAll('[data-cancelar-clave]').forEach(b => b.addEventListener('click', () => {
  accesoClaveAbiertaId = null;
  accesosTab();
 }));
 el.querySelectorAll('[data-clave-form]').forEach(f => f.addEventListener('submit', async e => {
  e.preventDefault();
  const usuarioId = f.dataset.claveForm;
  const boton = f.querySelector('button[type=submit]');
  boton.disabled = true;
  try {
   await cambiarPasswordDeUsuario(config.empresa_id, usuarioId, f.clave.value);
   accesoClaveAbiertaId = null;
   aviso('Contraseña actualizada.');
   await accesosTab();
  } catch (err) {
   aviso(err.message, true);
   boton.disabled = false;
  }
 }));
 el.querySelectorAll('[data-reenviar]').forEach(b => b.addEventListener('click', async () => {
  b.disabled = true;
  try {
   await reenviarInvitacion(config.empresa_id, b.dataset.reenviar);
   aviso('Invitación reenviada.');
  } catch (err) {
   aviso(err.message, true);
  } finally {
   b.disabled = false;
  }
 }));
 el.querySelectorAll('[data-alternar]').forEach(b => b.addEventListener('click', async () => {
  const activoActual = b.dataset.activoActual === '1';
  b.disabled = true;
  try {
   await alternarActivoAcceso(config.empresa_id, b.dataset.alternar, !activoActual);
   aviso(activoActual ? 'Acceso desactivado.' : 'Acceso reactivado.');
   await accesosTab();
  } catch (err) {
   aviso(err.message, true);
   b.disabled = false;
  }
 }));
 el.querySelectorAll('[data-eliminar]').forEach(b => b.addEventListener('click', async () => {
  const m = accesosCache.find(x => x.usuario_id === b.dataset.eliminar);
  const quien = `${m?.nombre || 'este usuario'} (${m?.correo || ''})`;
  const ok = window.confirm(
   `¿Eliminar a ${quien}?\n\n` +
   'SE PIERDE: su acceso para iniciar sesión (su usuario y contraseña) y su rol. Esto no se puede deshacer.\n\n' +
   'SE CONSERVA: su ficha de asesor (en Equipo) y todas sus citas históricas. La ficha solo queda sin acceso.\n\n' +
   'Si solo quieres que no entre por un tiempo, usa "Desactivar".');
  if (!ok) return;
  b.disabled = true;
  try {
   await eliminarUsuario(config.empresa_id, b.dataset.eliminar);
   aviso('Usuario eliminado. Su ficha de asesor y sus citas se conservan.');
   await accesosTab();
  } catch (err) {
   aviso(err.message, true);
   b.disabled = false;
  }
 }));
 el.querySelectorAll('[name=modo]').forEach(r => r.addEventListener('change', () => {
  el.querySelector('#ad-acceso-clave-directa').hidden = el.querySelector('[name=modo]:checked').value !== 'directa';
 }));
 el.querySelector('#ad-acceso-generar')?.addEventListener('click', () => {
  el.querySelector('#ad-acceso-form [name=password]').value = generarPasswordAleatoria();
 });
 el.querySelector('#ad-acceso-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const boton = f.querySelector('button[type=submit]');
  const modo = f.modo.value;
  // Contraseña opcional: si eligen «yo mismo» pero la dejan vacía, se envía la invitación por correo.
  const password = modo === 'directa' && f.password.value.trim() ? f.password.value : undefined;
  if (modo === 'directa' && password && password.length < 8) {
   aviso('La contraseña debe tener al menos 8 caracteres.', true);
   return;
  }
  boton.disabled = true;
  try {
   const r = await crearAcceso(config.empresa_id, { nombre: f.nombre.value.trim(), correo: f.correo.value.trim(), rol: f.rol.value, password });
   if (r.correo_enviado === false && r.aviso) aviso(r.aviso, true);
   else aviso(password ? 'Acceso creado con la contraseña que pusiste.' : 'Acceso creado. Le llegará un correo de invitación.');
   f.reset();
   await accesosTab();
  } catch (err) {
   aviso(err.message, true);
   boton.disabled = false;
  }
 });
}

