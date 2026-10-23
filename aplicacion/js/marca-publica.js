// Marca de la empresa en las páginas públicas (reservar, opinión, informe del propietario, visita
// del arrendatario): logo grande en el encabezado + la paleta de la empresa. Se pide a la función
// pública agenda_marca_publica por el dominio desde el que se abrió la página. Si la función no
// existe o no devuelve nada, la página queda como estaba (nunca bloquea nada).
import { supabase } from './cliente-supabase.js';
import { aplicarTema } from './paletas.js';

const CLAVE = 'marca_publica_' + window.location.hostname;

function pintar(m) {
  if (!m || typeof m !== 'object') return;
  aplicarTema({ color_principal: m.color_principal, color_accion: m.color_accion });
  const cab = document.querySelector('.pu-head > div');
  if (!cab) return;
  const nombre = document.createElement('strong');
  nombre.textContent = m.nombre_comercial || '';
  if (m.logo_url && /^https:\/\//i.test(m.logo_url)) {
    const img = document.createElement('img');
    img.className = 'pu-logo';
    img.alt = m.nombre_comercial || '';
    img.referrerPolicy = 'no-referrer';
    img.src = m.logo_url;
    img.addEventListener('error', () => { if (nombre.textContent) cab.replaceChildren(nombre); });
    cab.replaceChildren(img);
  } else if (nombre.textContent) {
    cab.replaceChildren(nombre);
  }
}

export async function aplicarMarcaPublica() {
  try {
    const guardada = sessionStorage.getItem(CLAVE);
    if (guardada) pintar(JSON.parse(guardada));
  } catch { /* sin almacenamiento: se pide igual */ }
  try {
    const { data, error } = await supabase.rpc('agenda_marca_publica', { p_host: window.location.hostname });
    if (error || !data) return;
    pintar(data);
    try { sessionStorage.setItem(CLAVE, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
  } catch { /* la página funciona sin marca */ }
}
