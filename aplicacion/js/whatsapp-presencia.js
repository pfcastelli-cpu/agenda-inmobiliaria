// Presencia y alerta global de WhatsApp: mientras la plataforma está abierta (en cualquier pantalla)
//  1) avisa al servidor que esta persona está conectada (latido cada 30 s): el bot, si hay alguien conectado, atiende dentro de la plataforma;
//     si no hay nadie, le da al cliente el WhatsApp directo del asesor;
//  2) si un cliente necesita a una persona, muestra un aviso grande y suena, aunque esté en otra pantalla.
// En la pantalla de WhatsApp el aviso lo da la propia bandeja (whatsapp-bandeja.js); aquí no se duplica.
const LATIDO_MS = 30000;
const REVISION_MS = 15000;
let temporizadores = [];
let audio = null;

function sonidoActivo() { try { return localStorage.getItem('wa_sonido') !== 'no'; } catch { return true; } }

function sonar() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    audio = audio || new A(); if (audio.state === 'suspended') audio.resume();
    [[880, 0], [1175, 0.2], [880, 0.4], [1175, 0.6]].forEach(([fr, t]) => {
      const o = audio.createOscillator(); const g = audio.createGain(); o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18);
      o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.19);
    });
  } catch { /* el navegador bloquea el audio hasta que la persona toque la página */ }
}

function aviso() {
  let el = document.getElementById('wa-alerta-global');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wa-alerta-global';
    el.className = 'wa-global';
    el.setAttribute('role', 'alert');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

export function detenerPresenciaWhatsapp() {
  temporizadores.forEach(clearInterval); temporizadores = [];
  aviso().hidden = true;
}

export function iniciarPresenciaWhatsapp({ supabase, empresaId, vistaActual, irAWhatsapp }) {
  detenerPresenciaWhatsapp();
  if (!supabase || !empresaId) return;
  const tituloOriginal = document.title;
  let conocidas = new Set();
  let primera = true;
  let ultimoSonido = 0;

  const latido = () => { supabase.rpc('agenda_wa_latido', { p_empresa_id: empresaId }).then(() => {}, () => {}); };
  latido();
  temporizadores.push(setInterval(latido, LATIDO_MS));
  window.addEventListener('pagehide', () => { try { supabase.rpc('agenda_wa_salir', { p_empresa_id: empresaId }); } catch { /* sin conexión */ } });

  async function revisar() {
    const { data, error } = await supabase.from('agenda_wa_conversaciones').select('id, nombre, telefono, motivo_pausa')
      .eq('empresa_id', empresaId).eq('requiere_atencion', true).neq('estado', 'cerrada').limit(50);
    const el = aviso();
    if (error || !data) return;
    const enWA = vistaActual() === 'whatsapp';
    const nuevas = data.filter((c) => !conocidas.has(c.id));
    conocidas = new Set(data.map((c) => c.id));
    if (!data.length || enWA) { el.hidden = true; document.title = tituloOriginal; primera = false; return; }
    const repite = Date.now() - ultimoSonido > 5 * 60000;
    if ((nuevas.length && !primera || repite) && sonidoActivo()) { sonar(); ultimoSonido = Date.now(); }
    else if (primera && sonidoActivo()) { sonar(); ultimoSonido = Date.now(); }
    primera = false;
    const quien = (data[0].nombre || data[0].telefono || 'Un cliente').toString().slice(0, 40);
    el.innerHTML = '';
    const txt = document.createElement('div'); txt.className = 'wa-global-txt';
    const b = document.createElement('b'); b.textContent = data.length === 1 ? 'Un cliente de WhatsApp te necesita' : `${data.length} clientes de WhatsApp te necesitan`;
    const s = document.createElement('small'); s.textContent = data.length === 1 ? `${quien}${data[0].motivo_pausa ? ' · ' + data[0].motivo_pausa : ''}` : `${quien} y ${data.length - 1} más esperando`;
    txt.append(b, s);
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Atender';
    btn.addEventListener('click', () => { el.hidden = true; irAWhatsapp(); });
    el.append(txt, btn);
    el.hidden = false;
    document.title = `(${data.length}) 🔔 ${tituloOriginal}`;
  }
  revisar();
  temporizadores.push(setInterval(revisar, REVISION_MS));
}
