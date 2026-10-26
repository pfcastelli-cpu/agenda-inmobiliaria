// Paletas de color de la agenda. Cada paleta fija el color principal y el de botones
// (los mismos dos campos que ya guarda agenda_configuracion) y, además, el fondo, el tinte
// de las zonas destacadas y un tono claro para el modo oscuro. No requiere columnas nuevas:
// la paleta activa se reconoce comparando principal + acción.
export const PALETAS = [
 {id:'negro-champana',nombre:'Negro mate y champaña',nota:'Lujo discreto y elegancia',principal:'#1B1C1E',accion:'#CDB68C',fondo:'#F6F5F2',tinte:'#EFE7D6',claro:'#D9DADC'},
 {id:'antracita-oro',nombre:'Antracita y oro suave',nota:'Respaldo y solidez',principal:'#2A2D31',accion:'#B89B5E',fondo:'#F7F6F3',tinte:'#F0E9D6',claro:'#E0E2E5'},
 {id:'petroleo-champana',nombre:'Petróleo y champaña',nota:'Seguridad serena con brillo cálido',principal:'#17414A',accion:'#CBB78F',fondo:'#F4F6F5',tinte:'#E9EFEB',claro:'#B5D8DC'},
 {id:'institucional-plata',nombre:'Azul institucional y plata',nota:'Confianza y respaldo de banca',principal:'#1C2F4A',accion:'#A9B4C2',fondo:'#F4F6F9',tinte:'#E6EBF2',claro:'#B9CCE8'},
 {id:'pino-marfil',nombre:'Verde pino y marfil',nota:'Patrimonio que perdura',principal:'#1F3B34',accion:'#D9CDB0',fondo:'#F7F6F1',tinte:'#EEEBDD',claro:'#A9CDBE'},
 {id:'bruma-agua',nombre:'Bruma y verde agua',nota:'Calma y frescura',principal:'#34454A',accion:'#8FB5AE',fondo:'#F5F7F7',tinte:'#E6EFEE',claro:'#C2DAD6'},
 {id:'acero-piedra',nombre:'Acero y piedra',nota:'Firmeza tranquila',principal:'#3B4650',accion:'#B3A99A',fondo:'#F6F6F5',tinte:'#ECEAE5',claro:'#CBD3DA'},
 {id:'noche-arena',nombre:'Noche y arena clara',nota:'Confianza con calidez',principal:'#212B3A',accion:'#D8C9AE',fondo:'#F7F6F3',tinte:'#F0EADB',claro:'#B8C4DB'},
 {id:'cuarzo-acero',nombre:'Cuarzo y azul acero',nota:'El gris del logo, sereno',principal:'#44474C',accion:'#7E9BB5',fondo:'#F6F7F8',tinte:'#E9EEF2',claro:'#D3D6DA'},
 {id:'bosque-bronce',nombre:'Bosque y bronce',nota:'Lujo natural y estable',principal:'#213A31',accion:'#B08D57',fondo:'#F5F6F1',tinte:'#EFE8D4',claro:'#B2D4C2'},
 {id:'grafito-bronce',nombre:'Grafito y bronce',nota:'El gris del logo con calidez dorada',principal:'#26282B',accion:'#A9845A',fondo:'#F7F6F4',tinte:'#F0E8DC',claro:'#E3E4E6'},
 {id:'plomo-salvia',nombre:'Plomo y salvia',nota:'Gris del logo y verde suave',principal:'#3A3D42',accion:'#8DA593',fondo:'#F6F7F6',tinte:'#E8EEEA',claro:'#D5DAD8'},
 {id:'niebla-azul',nombre:'Niebla y azul',nota:'Gris azulado, confianza serena',principal:'#3F4A58',accion:'#7C9CB8',fondo:'#F6F7F9',tinte:'#E9EEF3',claro:'#D0DCE8'},
 {id:'pizarra-cielo',nombre:'Pizarra y cielo',nota:'Transparencia y control tranquilo',principal:'#2B3A4A',accion:'#6FA3C0',fondo:'#F5F7F9',tinte:'#E8EEF3',claro:'#CBD9E5'},
 {id:'petroleo-arena',nombre:'Petróleo y arena',nota:'Calma profunda y calidez',principal:'#1F4A52',accion:'#D4B483',fondo:'#F6F5F1',tinte:'#F1EADB',claro:'#BFE0E3'},
 {id:'salvia-serena',nombre:'Salvia serena',nota:'Cuidado y tranquilidad',principal:'#2F4A45',accion:'#A9BFA0',fondo:'#F5F7F6',tinte:'#E8EFEC',claro:'#CFE0DA'},
 {id:'arena-serena',nombre:'Arena serena',nota:'Hogar, calidez y acogida',principal:'#4B4540',accion:'#B59A78',fondo:'#FAF8F5',tinte:'#F1ECE5',claro:'#E2D8CB'},
 {id:'patrimonios',nombre:'Patrimonios clásico',nota:'Azul noche y turquesa',principal:'#1A2C45',accion:'#00A9A5',fondo:'#F4F4F4',tinte:'#E3F8F7',claro:'#8EB0FF'},
 {id:'esmeralda',nombre:'Esmeralda y oro',nota:'Verde club y oro viejo',principal:'#0F3D2E',accion:'#C9A24B',fondo:'#F6F3EA',tinte:'#F3EBD2',claro:'#A8D5BD'},
 {id:'medianoche',nombre:'Medianoche y champaña',nota:'Azul tinta y champaña',principal:'#14192B',accion:'#D8B98A',fondo:'#F5F3EF',tinte:'#F1E7D7',claro:'#B7C0E0'},
 {id:'zafiro',nombre:'Zafiro y platino',nota:'Azul real y plata',principal:'#0E2A54',accion:'#B4BECC',fondo:'#F3F5F8',tinte:'#E4E9F1',claro:'#A9C2EE'},
 {id:'obsidiana',nombre:'Obsidiana y oro',nota:'Negro mate y oro',principal:'#141414',accion:'#C6A15B',fondo:'#F5F4F1',tinte:'#F0E6CF',claro:'#D8D8D8'},
 {id:'grafito',nombre:'Grafito y cobre rosado',nota:'Carbón y cobre suave',principal:'#26282D',accion:'#C98B73',fondo:'#F5F3F2',tinte:'#F2E3DC',claro:'#CBD0DA'},
 {id:'salvia',nombre:'Pizarra y salvia',nota:'Verde pizarra y salvia',principal:'#2F3E3C',accion:'#9DB08A',fondo:'#F3F4F0',tinte:'#E4EAD9',claro:'#B5CFC8'},
];
export const hex = /^#[0-9a-fA-F]{6}$/;
const mismo = (a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
export const paletaActiva = c => PALETAS.find(p=>mismo(p.principal,c?.color_principal)&&mismo(p.accion,c?.color_accion));
function luz(h){const a=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
export const colorTexto = h => luz(h)>.179?'#111111':'#ffffff';
// Paleta personalizada: de los dos colores elegidos se derivan fondo, tinte y tono claro
// conservando el matiz (fondo casi blanco con un toque cálido del color principal).
function hsl(h){const [r,g,b]=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255);const m=Math.max(r,g,b),n=Math.min(r,g,b),d=m-n,l=(m+n)/2;let t=0;if(d){t=m===r?((g-b)/d)%6:m===g?(b-r)/d+2:(r-g)/d+4;}return [(t*60+360)%360,d?d/(1-Math.abs(2*l-1)):0,l];}
function desdeHsl(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');}
export function derivarPaleta(principal,accion){
 const [hp,sp]=hsl(principal),[ha,sa]=hsl(accion);
 return {fondo:desdeHsl(hp,Math.min(sp,.35)*.45,.96),tinte:desdeHsl(ha,Math.min(Math.max(sa,.3),.85),.9),claro:desdeHsl(hp,Math.min(Math.max(sp,.35),.9),.76)};
}
export function aplicarTema(c, el=document.documentElement){
 if(!c||!hex.test(c.color_principal)||!hex.test(c.color_accion))return;
 const d=paletaActiva(c)||derivarPaleta(c.color_principal,c.color_accion);
 const v={
  '--empresa-principal':c.color_principal,'--empresa-texto-principal':colorTexto(c.color_principal),
  '--empresa-accion':c.color_accion,'--empresa-texto':colorTexto(c.color_accion),
  '--tema-fondo':d.fondo,
  '--tema-tinte':d.tinte,
  '--tema-claro':d.claro,
 };
 for(const k in v)el.style.setProperty(k,v[k]);
}
export const quitarTema=(el=document.documentElement)=>['--empresa-principal','--empresa-texto-principal','--empresa-accion','--empresa-texto','--tema-fondo','--tema-tinte','--tema-claro'].forEach(k=>el.style.removeProperty(k));
export function tarjetasPaletas(c){
 const act=paletaActiva(c)?.id;
 const d=derivarPaleta(c?.color_principal||'#1a2c45',c?.color_accion||'#00a9a5');
 const muestra=p=>`<span class="ad-paleta-muestra" style="background:${p.principal}"><i style="background:${p.accion}"></i><i style="background:${p.tinte}"></i><i style="background:${p.fondo}"></i></span>`;
 return `<fieldset class="ad-paletas"><legend>Paleta de colores</legend><div class="ad-paletas-grid">${PALETAS.map(p=>`<button type="button" class="ad-paleta" data-paleta="${p.id}" aria-pressed="${p.id===act}">${muestra(p)}<strong>${p.nombre}</strong><small>${p.nota}</small></button>`).join('')}<button type="button" class="ad-paleta ad-paleta-propia" data-paleta="propia" aria-pressed="${!act}">${muestra({principal:c?.color_principal||'#1a2c45',accion:c?.color_accion||'#00a9a5',...d})}<strong>Personalizada</strong><small>Elige tus dos colores abajo</small></button></div><p class="ad-muted">Elegir una paleta llena los dos colores de abajo. Para una propia, cambia «Color principal» y «Color de botones»: el fondo y los tonos suaves se calculan solos. Se aplica en la agenda, el acceso y los correos.</p></fieldset>`;
}
