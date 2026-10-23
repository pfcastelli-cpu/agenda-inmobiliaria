// Paletas de color de la agenda. Cada paleta fija el color principal y el de botones
// (los mismos dos campos que ya guarda agenda_configuracion) y, además, el fondo, el tinte
// de las zonas destacadas y un tono claro para el modo oscuro. No requiere columnas nuevas:
// la paleta activa se reconoce comparando principal + acción.
export const PALETAS = [
 {id:'patrimonios',nombre:'Patrimonios',nota:'Azul noche y turquesa',principal:'#1A2C45',accion:'#00A9A5',fondo:'#F4F4F4',tinte:'#E3F8F7',claro:'#8EB0FF'},
 {id:'ladrillo',nombre:'Ladrillo y cal',nota:'Obra recién pintada',principal:'#5B2A21',accion:'#E0A458',fondo:'#F6F3F1',tinte:'#F8EBD9',claro:'#F0B9A8'},
 {id:'bosque',nombre:'Jardín interior',nota:'Verde profundo y lima',principal:'#14382F',accion:'#B7D63B',fondo:'#F2F5F1',tinte:'#E7F0D0',claro:'#9BD3B4'},
 {id:'plano',nombre:'Plano arquitectónico',nota:'Azul cianotipo y naranja de obra',principal:'#12358A',accion:'#FF7A1A',fondo:'#F3F5FA',tinte:'#FFE9D6',claro:'#9DB6FF'},
 {id:'granito',nombre:'Granito',nota:'Gris piedra y cobre',principal:'#2B2F36',accion:'#C8794A',fondo:'#F3F3F2',tinte:'#F4E4D9',claro:'#C9CFDA'},
 {id:'ciruela',nombre:'Ciruela',nota:'Vino y rosa claro',principal:'#43163F',accion:'#F2789F',fondo:'#F8F3F7',tinte:'#FBE1EA',claro:'#E3AEDD'},
 {id:'costa',nombre:'Costa',nota:'Petróleo y arena',principal:'#0B4A5A',accion:'#F2C14E',fondo:'#F2F6F6',tinte:'#FAF0D2',claro:'#8ED3E3'},
];
export const hex = /^#[0-9a-fA-F]{6}$/;
const mismo = (a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
export const paletaActiva = c => PALETAS.find(p=>mismo(p.principal,c?.color_principal)&&mismo(p.accion,c?.color_accion));
function luz(h){const a=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
export const colorTexto = h => luz(h)>.179?'#111111':'#ffffff';
// Mezcla h con blanco (t = 0..1) para sacar fondo/tinte de una paleta personalizada.
const aclarar=(h,t)=>'#'+h.slice(1).match(/../g).map(x=>Math.round(parseInt(x,16)+(255-parseInt(x,16))*t).toString(16).padStart(2,'0')).join('');
export function aplicarTema(c, el=document.documentElement){
 if(!c||!hex.test(c.color_principal)||!hex.test(c.color_accion))return;
 const p=paletaActiva(c);
 const v={
  '--empresa-principal':c.color_principal,'--empresa-texto-principal':colorTexto(c.color_principal),
  '--empresa-accion':c.color_accion,'--empresa-texto':colorTexto(c.color_accion),
  '--tema-fondo':p?p.fondo:aclarar(c.color_principal,.95),
  '--tema-tinte':p?p.tinte:aclarar(c.color_accion,.82),
  '--tema-claro':p?p.claro:aclarar(c.color_principal,.6),
 };
 for(const k in v)el.style.setProperty(k,v[k]);
}
export const quitarTema=(el=document.documentElement)=>['--empresa-principal','--empresa-texto-principal','--empresa-accion','--empresa-texto','--tema-fondo','--tema-tinte','--tema-claro'].forEach(k=>el.style.removeProperty(k));
export function tarjetasPaletas(c){
 const act=paletaActiva(c)?.id;
 return `<fieldset class="ad-paletas"><legend>Paleta de colores</legend><div class="ad-paletas-grid">${PALETAS.map(p=>`<button type="button" class="ad-paleta" data-paleta="${p.id}" aria-pressed="${p.id===act}"><span class="ad-paleta-muestra" style="background:${p.principal}"><i style="background:${p.accion}"></i><i style="background:${p.tinte}"></i><i style="background:${p.fondo}"></i></span><strong>${p.nombre}</strong><small>${p.nota}</small></button>`).join('')}</div><p class="ad-muted">Elegir una paleta llena los dos colores de abajo; puedes ajustarlos a mano y se guarda como paleta personalizada. Se aplica en la agenda, el acceso y los correos.</p></fieldset>`;
}
