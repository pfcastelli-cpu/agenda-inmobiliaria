// Buscador de Configuración: una caja que lleva a la pestaña y a la opción exacta por palabra clave.
// Las pestañas se dibujan al abrirlas, así que el índice es estático: cada entrada dice a qué pestaña
// ir y qué elemento resaltar (`ancla`: selector CSS si empieza con [ . # o texto de un título/leyenda).
// Se conecta desde administracion.js con montarBuscador(root, { abrir }).
import { abrirSubpestanaDe } from './admin-subpestanas.js';

const PESTANAS = {
 equipo: 'Equipo', ciudades: 'Ciudades y festivos', marca: 'Empresa', correo: 'Correo',
 ia: 'Inteligencia artificial', reuniones: 'Reuniones virtuales', supervision: 'Supervisión',
 radicacion: 'Radicación', demanda: 'Demanda', calendario: 'Calendario', importar: 'Importar citas', accesos: 'Accesos',
};

// [pestaña, título visible, palabras clave, ancla, subpestaña (opcional)]
const INDICE = [
 ['equipo', 'Asesores del equipo', 'asesores equipo personas lista nuevo asesor crear ficha editar activo inactivo', ''],
 ['equipo', 'Nuevo asesor', 'agregar crear asesor nuevo ficha alta', '#ad-nuevo'],
 ['equipo', 'Horario de visitas, almuerzo y ausencias de un asesor', 'horario jornada entrada salida almuerzo ausencia incapacidad vacaciones asesor ficha sabado domingo festivos atiende fin de semana', ''],
 ['equipo', 'Dar acceso a un asesor (ingreso al sistema)', 'dar acceso login ingreso usuario asesor contrasena', ''],

 ['ciudades', 'Ciudades', 'ciudades ciudad sede latitud longitud', 'Ciudades', 'ciudades'],
 ['ciudades', 'Coberturas (zonas dentro de una ciudad)', 'cobertura zonas norte sur centro captacion prioridad', 'Coberturas', 'ciudades'],
 ['ciudades', 'Festivos', 'festivos feriados dias no laborables bloquear fechas calendario colombia', 'Festivos', 'festivos'],
 ['ciudades', 'Calidad de geolocalización', 'geolocalizacion coordenadas ubicacion mapa inmuebles gps', 'Calidad de geolocalización', 'geo'],

 ['marca', 'Colores y paleta de la empresa', 'paleta colores color tema diseno apariencia estilo marca', '.ad-paletas', 'marca'],
 ['marca', 'Nombre comercial', 'nombre empresa comercial marca', '[name=nombre_comercial]', 'marca'],
 ['marca', 'Logo de la empresa', 'logo logotipo imagen marca enlace', '[name=logo_url]', 'marca'],
 ['marca', 'Imagen de encabezado de los correos', 'imagen encabezado correos banner cabecera', '[name=imagen_correo_url]', 'marca'],
 ['marca', 'Color principal', 'color principal marca barra superior', '[name=color_principal]', 'marca'],
 ['marca', 'Color de botones', 'color botones accion acento', '[name=color_accion]', 'marca'],
 ['marca', 'Correo de contacto de la empresa', 'correo contacto comercial email general', '[name=correo_contacto]', 'contacto'],
 ['marca', 'Teléfono general', 'telefono celular whatsapp llamar general', '[name=telefono]', 'contacto'],
 ['marca', 'Enlace para radicar documentos', 'radicar documentos enlace carpeta subir', '[name=enlace_documentos]', 'contacto'],
 ['marca', 'Contacto y datos legales', 'contacto datos legales nit razon social direccion representante', 'Contacto y datos legales', 'contacto'],
 ['marca', 'Sedes y teléfonos', 'sedes sede oficinas telefonos indicativo direccion', 'Sedes y teléfonos', 'contacto'],
 ['marca', 'Dominio de la página de agendamiento', 'dominio pagina publica agendamiento enlace agendar cita reserva url', '[name=dominio_publico]', 'reservas'],
 ['marca', 'Enlace para ver el inmueble en tu sitio', 'ver inmueble plantilla enlace ficha sitio web numero', '[name=plantilla_enlace_inmueble]', 'reservas'],
 ['marca', 'Reglas de la agenda', 'reglas agenda duracion cita traslado anticipacion radio zona formato hora', 'Reglas de la agenda', 'horarios'],
 ['marca', 'Duración de la primera cita', 'duracion visita minutos primera cita tiempo', '[name=duracion_visita_minutos]', 'horarios'],
 ['marca', 'Traslado entre inmuebles', 'traslado desplazamiento minutos entre inmuebles distancia', '[name=minutos_traslado_entre_inmuebles]', 'horarios'],
 ['marca', 'Varias personas en el mismo inmueble', 'mismo inmueble grupo escalonada simultanea separacion visita en grupo', '[name=modo_mismo_inmueble]', 'horarios'],
 ['marca', 'Radio de zona', 'radio zona km agrupar manana tarde cercania', '[name=radio_zona_km]', 'horarios'],
 ['marca', 'Anticipación mínima para agendar', 'anticipacion minima horas agendar llaves tiempo antes', '[name=horas_minimas_anticipacion]', 'horarios'],
 ['marca', 'Formato de hora (12 o 24 horas)', 'formato hora 12 24 militar am pm', '[name=formato_hora]', 'horarios'],
 ['marca', 'Citas de seguimiento según el valor', 'seguimiento canon minimo precio venta valor citas seguimiento', 'Citas de seguimiento según el valor del inmueble', 'horarios'],
 ['marca', 'Inmuebles de alto valor', 'alto valor canon precio excepcion zona', '[name=valor_alto_canon_zona]', 'horarios'],
 ['marca', 'Código de verificación en la reserva pública', 'verificar verificacion codigo correo reserva publica seguridad', '[name=verificar_correo_reserva]', 'reservas'],
 ['marca', 'Página pública /consignar (captación)', 'consignar captacion propietarios pagina publica agendar sola cita captar', '[name=captacion_publica_activa]', 'reservas'],
 ['marca', 'Video explicativo de /consignar', 'video youtube consignar explicativo captacion enlace', '[name=captacion_video_url]', 'reservas'],
 ['marca', 'Agendar sobre un horario ocupado', 'cruce cruzar choque ocupado horario advertencia confirmar asesores', '[name=asesores_pueden_cruzar]', 'horarios'],
 ['marca', 'Almuerzo (horario general)', 'almuerzo comida descanso horario general desde hasta', '[name=almuerzo_activo]', 'horarios'],
 ['marca', 'Encuesta automática al cliente', 'encuesta cliente opinion satisfaccion minutos despues visita automatica', '[name=encuesta_automatica]', 'encuestas'],
 ['marca', 'Aviso cuando un cliente responde la encuesta', 'aviso encuesta respondida resumen semanal gerencia correos', '[name=encuesta_aviso_admin]', 'encuestas'],
 ['marca', 'Permisos de la pestaña Equipo', 'permisos coordinador asesor ver equipo panel interno roles', '[name=equipo_ve_coordinador]', 'encuestas'],

 ['correo', 'Proveedor de correo (Gmail, Outlook, otro)', 'proveedor correo gmail outlook office smtp elegir', 'Elige tu proveedor', 'conexion'],
 ['correo', 'Remitente de los correos', 'remitente nombre correo desde info quien envia', 'Remitente', 'conexion'],
 ['correo', 'Datos SMTP (servidor de correo)', 'smtp host puerto seguridad ssl servidor usuario', 'Datos SMTP', 'conexion'],
 ['correo', 'Contraseña del correo', 'contrasena clave aplicacion password correo smtp', '[name=correo_password]', 'conexion'],
 ['correo', 'Modo de pruebas de correo', 'modo pruebas correo destino prueba produccion interruptor', '[name=correo_modo_pruebas]', 'pruebas'],
 ['correo', 'Enviar un correo de prueba', 'probar correo prueba enviar test configuracion', 'Probar la configuración', 'pruebas'],
 ['correo', 'Bitácora de envíos de correo', 'bitacora envios correo fallas errores historial no llegan', 'Bitácora de envíos', 'bitacora'],

 ['ia', 'Inteligencia artificial: proveedor, modelo y clave', 'inteligencia artificial ia proveedor modelo clave api openai claude gemini', '[name=ia_proveedor]'],
 ['ia', 'Filtrar las opiniones con IA', 'filtrar opiniones ia encuestas moderar comentarios', '[name=ia_activa]'],

 ['reuniones', 'Reuniones virtuales (videollamada)', 'reuniones virtuales videollamada video meet zoom teams proveedor credenciales', '[name=proveedor]'],

 ['supervision', 'Alertas de calificación baja', 'alerta calificacion baja estrellas encuesta aviso', '[name=alerta_baja_calificacion]'],
 ['supervision', 'Llegada a la visita (ubicación del asesor)', 'llegada visita ubicacion gps distancia metros asesor senal exigir', '[name=exigir_llegada]'],
 ['supervision', 'Tablero de citas con visita de cliente', 'tablero supervision citas revisar senales fraude falsas', 'Tablero de citas con visita de cliente'],

 ['radicacion', 'Radicación del estudio de arrendatario', 'radicacion estudio arrendatario aseguradora costo iva pasos correo automatico', '#rad-activa'],

 ['demanda', 'Umbrales de demanda por inmueble', 'demanda umbral urgente atencion pedidos 24 horas tope citas activas', '[name=demanda_umbral_info]'],
 ['demanda', 'Alertas de demanda (ahora están en Informes)', 'alertas demanda inmuebles mas pedidos dias informes subir precio canon', ''],
 ['demanda', 'Importar el histórico de demanda (.ics)', 'importar historico demanda sistema anterior ics archivo', '#dem-archivo'],

 ['calendario', 'Calendario compartido (suscribirse)', 'calendario compartido google outlook apple suscribir enlace ics token', 'Todas las agendas'],
 ['calendario', 'Calendario de cada asesor', 'calendario por asesor enlace color suscribir', 'Por asesor'],

 ['importar', 'Importar citas desde un calendario', 'importar citas calendario ics google outlook archivo migrar pasadas', '#imp-archivo'],

 ['accesos', 'Accesos al sistema (quién puede entrar)', 'accesos usuarios ingreso login quien puede entrar lista', ''],
 ['accesos', 'Crear un acceso nuevo', 'crear acceso usuario nuevo invitar rol administrador coordinador asesor', 'Crear acceso nuevo'],
 ['accesos', 'Cambiar la contraseña de un usuario', 'cambiar contrasena clave password usuario restablecer olvido reenviar invitacion', ''],
];

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SUBPESTANAS = {
 marca: 'Marca y colores', contacto: 'Contacto y sedes', horarios: 'Horarios y reglas', reservas: 'Reservas públicas', encuestas: 'Encuestas y permisos',
 conexion: 'Cuenta y servidor', pruebas: 'Modo de pruebas y envío de prueba', bitacora: 'Bitácora de envíos',
 ciudades: 'Ciudades y zonas', festivos: 'Festivos', geo: 'Calidad de ubicación',
};

const ENTRADAS = INDICE.map(([tab, titulo, claves, ancla, sub]) => ({
 tab, titulo, ancla, sub, pestana: PESTANAS[tab], donde: sub ? `${PESTANAS[tab]} › ${SUBPESTANAS[sub]}` : PESTANAS[tab],
 nTitulo: normalizar(titulo), nTodo: normalizar(`${titulo} ${claves} ${PESTANAS[tab]} ${sub ? SUBPESTANAS[sub] : ''}`),
}));

// Cómo habla la gente frente a cómo se llama el ajuste: cada palabra se amplía con sinónimos, el plural y el comienzo de la palabra
// (así «almuerso» o «correos» igual llegan a «almuerzo» y «correo»).
const SINONIMOS = {
  mail: ['correo'], email: ['correo'], gmail: ['correo'], 'e-mail': ['correo'], remitente: ['correo'],
  borrar: ['eliminar', 'quitar', 'inactivo'], eliminar: ['inactivo', 'quitar'], quitar: ['inactivo', 'eliminar'],
  clave: ['contrasena'], password: ['contrasena'], whatsapp: ['telefono', 'celular'], cel: ['celular', 'telefono'],
  sabado: ['sabados'], sabados: ['sabado'], domingo: ['domingos'], domingos: ['domingo'],
  cierre: ['jornada', 'salida'], apertura: ['jornada', 'entrada'], hora: ['horario', 'jornada'], horas: ['horario', 'jornada'],
  logo: ['marca', 'colores'], youtube: ['video'], link: ['enlace'], pruebas: ['prueba'],
};
const alternativas = (p) => [p, ...(p.length > 3 ? [p.replace(/(es|s)$/, '')] : []), ...(p.length >= 6 ? [p.slice(0, 5)] : []), ...(SINONIMOS[p] || [])].filter((x) => x.length >= 2);

export function buscarAjustes(texto, max = 8) {
 const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
 if (!palabras.length) return [];
 const res = [];
 for (const e of ENTRADAS) {
  if (!palabras.every((p) => alternativas(p).some((a) => e.nTodo.includes(a)))) continue;
  const enTitulo = palabras.filter((p) => e.nTitulo.includes(p)).length;
  res.push({ e, puntos: enTitulo * 2 + (e.nTitulo.startsWith(palabras[0]) ? 1 : 0) });
 }
 return res.sort((a, b) => b.puntos - a.puntos).slice(0, max).map((r) => r.e);
}

function buscarElemento(contenedor, ancla) {
 if (!ancla) return null;
 if (/^[[#.]/.test(ancla)) {
  const el = contenedor.querySelector(ancla);
  return el ? (el.closest('label, fieldset') || el) : null;
 }
 const n = normalizar(ancla);
 return [...contenedor.querySelectorAll('h2, h3, h4, legend')].find((h) => normalizar(h.textContent).includes(n)) || null;
}

// Abre una subpestaña por su id (las crea admin-subpestanas.js dentro de la pestaña ya dibujada).
function abrirSubpestana(cuerpo, sub) {
 cuerpo.querySelector(`.ad-sub-tab[data-sub="${sub}"]`)?.click();
}

// Espera a que la pestaña termine de dibujarse (varias cargan datos antes de pintar).
async function esperarElemento(contenedor, ancla, ms = 2500) {
 const t0 = Date.now();
 for (;;) {
  const el = buscarElemento(contenedor, ancla);
  if (el || Date.now() - t0 > ms) return el;
  await new Promise((r) => setTimeout(r, 120));
 }
}

let temporizadorResalte;
function resaltar(el) {
 document.querySelectorAll('.ad-resaltado').forEach((x) => x.classList.remove('ad-resaltado'));
 const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
 el.classList.add('ad-resaltado');
 el.scrollIntoView({ block: 'center', behavior: reducir ? 'auto' : 'smooth' });
 const foco = el.matches('input, select, textarea, button') ? el : el.querySelector('input:not([type=hidden]), select, textarea, button');
 if (foco) foco.focus({ preventScroll: true });
 clearTimeout(temporizadorResalte);
 temporizadorResalte = setTimeout(() => el.classList.remove('ad-resaltado'), 4000);
}

// En móvil y tableta las tablas pasan a tarjetas (agenda.css) y necesitan data-label en cada celda:
// se copia del encabezado para no tocar los módulos que dibujan las tablas.
function etiquetarTablas(cuerpo) {
 const pasar = () => cuerpo.querySelectorAll('table.ad-tabla, table.v-tabla-res').forEach((t) => {
  const cabeza = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  if (!cabeza.length) return;
  t.querySelectorAll('tbody tr').forEach((tr) => {
   if (tr.children.length !== cabeza.length) return;
   [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', cabeza[i]); });
  });
 });
 new MutationObserver(pasar).observe(cuerpo, { childList: true, subtree: true });
 pasar();
}

export function montarBuscador(root, { abrir }) {
 const body = root.querySelector('.ad-body');
 const cuerpo = root.querySelector('.ad-subbody');
 if (!body || !cuerpo || body.querySelector('.ad-buscar')) return;
 etiquetarTablas(cuerpo);

 const caja = document.createElement('div');
 caja.className = 'ad-buscar';
 caja.setAttribute('role', 'search');
 caja.innerHTML = `<label class="ad-buscar-etiqueta" for="ad-buscar-input">Buscar un ajuste</label>
  <div class="ad-buscar-campo">
   <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
   <input id="ad-buscar-input" type="search" role="combobox" aria-expanded="false" aria-controls="ad-buscar-lista" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Buscar un ajuste… (almuerzo, correo, festivos, video)">
  </div>
  <ul id="ad-buscar-lista" class="ad-buscar-lista" role="listbox" aria-label="Resultados de la búsqueda" hidden></ul>
  <p class="ad-buscar-estado ad-muted" role="status" aria-live="polite"></p>`;
 body.prepend(caja);

 const input = caja.querySelector('input');
 const lista = caja.querySelector('ul');
 const estado = caja.querySelector('.ad-buscar-estado');
 let resultados = [];
 let activo = -1;

 const marcarActivo = (i) => {
  activo = i;
  lista.querySelectorAll('[role=option]').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  if (i >= 0) { input.setAttribute('aria-activedescendant', `ad-buscar-op-${i}`); lista.children[i]?.scrollIntoView({ block: 'nearest' }); }
  else input.removeAttribute('aria-activedescendant');
 };
 const cerrar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); marcarActivo(-1); };
 const pintar = () => {
  const q = input.value;
  resultados = buscarAjustes(q);
  if (!q.trim()) { lista.replaceChildren(); cerrar(); estado.textContent = ''; return; }
  lista.innerHTML = resultados.length
   ? resultados.map((r, i) => `<li id="ad-buscar-op-${i}" role="option" aria-selected="false" data-i="${i}"><span class="ad-buscar-titulo">${esc(r.titulo)}</span><span class="ad-buscar-donde">${esc(r.donde)}</span></li>`).join('')
   : '<li class="ad-buscar-vacio" role="presentation">No hay un ajuste con esa palabra. Prueba con una más corta, por ejemplo «correo», «horario», «festivos» o «colores», o elige una pestaña de arriba.</li>';
  lista.hidden = false;
  input.setAttribute('aria-expanded', String(resultados.length > 0));
  estado.textContent = resultados.length ? `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}. Usa las flechas y Enter.` : 'Sin resultados.';
  marcarActivo(resultados.length ? 0 : -1);
 };
 const ir = async (r) => {
  if (!r) return;
  input.value = '';
  lista.replaceChildren();
  cerrar();
  estado.textContent = `Abriendo ${r.pestana}…`;
  await abrir(r.tab);
  if (r.sub) abrirSubpestana(cuerpo, r.sub);
  root.querySelector(`.ad-subnav [data-subtab="${r.tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const el = await esperarElemento(cuerpo, r.ancla);
  if (el) { abrirSubpestanaDe(el); resaltar(el); estado.textContent = `Listo: ${r.titulo}.`; }
  else { cuerpo.scrollIntoView({ block: 'start' }); estado.textContent = `Abrí la pestaña ${r.pestana}.`; }
 };

 input.addEventListener('input', pintar);
 input.addEventListener('focus', () => { if (input.value.trim()) pintar(); });
 input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && resultados.length) { e.preventDefault(); marcarActivo((activo + 1) % resultados.length); }
  else if (e.key === 'ArrowUp' && resultados.length) { e.preventDefault(); marcarActivo((activo - 1 + resultados.length) % resultados.length); }
  else if (e.key === 'Enter') { e.preventDefault(); ir(resultados[Math.max(activo, 0)]); }
  else if (e.key === 'Escape') { if (input.value) { input.value = ''; pintar(); } else cerrar(); }
 });
 lista.addEventListener('mousedown', (e) => e.preventDefault()); // no quitar el foco del campo antes del clic
 lista.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) ir(resultados[Number(li.dataset.i)]); });
 caja.addEventListener('focusout', (e) => { if (!caja.contains(e.relatedTarget)) cerrar(); });
}
