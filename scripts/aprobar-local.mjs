// «Aprobar en local»: UN solo comando que hace todo y lo deshace solo.
//   npm run aprobar            → los correos de PRUEBAS traen los botones apuntando a este computador (http://localhost:5173)
//   npm run aprobar -- --celular → igual, pero con la IP del computador para abrirlos desde el celular (misma red WiFi)
// Qué hace: 1) enciende el secreto ENLACES_PRUEBAS_URL en Supabase, 2) arranca el servidor local (vite), 3) al cerrar (Ctrl+C o cerrar la
// ventana) APAGA el secreto solo, para que los correos de pruebas vuelvan a apuntar al sitio real. Solo afecta correos en modo de pruebas.
// Si el computador se apaga de golpe y el secreto queda encendido, basta volver a correr el comando y cerrarlo con Ctrl+C.
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REF = 'ykiuuxludyonkhywtmgu';
const PUERTO = 5173;
const celular = process.argv.includes('--celular');

function ipLocal() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address)) return i.address;
  }
  return null;
}

// Busca la CLI de Supabase: primero la instalada con npx; si no, la copia en caché de npm.
function comandoSupabase() {
  const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : '';
  if (cache && existsSync(cache)) {
    for (const d of readdirSync(cache)) {
      const js = join(cache, d, 'node_modules', 'supabase', 'dist', 'supabase.js');
      if (existsSync(js)) return [process.execPath, [js]];
    }
  }
  return [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase']];
}

const [bin, baseArgs] = comandoSupabase();
const supabase = (...args) => spawnSync(bin, [...baseArgs, ...args, `--remote=${REF}`, '--yes'], { encoding: 'utf8', shell: bin.endsWith('.cmd') });

const ip = celular ? ipLocal() : null;
if (celular && !ip) { console.error('No encontré la IP de este computador en la red. Conéctate al WiFi o usa el modo normal (sin --celular).'); process.exit(1); }
const base = `http://${ip || 'localhost'}:${PUERTO}`;

let apagado = false;
function apagar() {
  if (apagado) return;
  apagado = true;
  console.log('\nApagando el modo local (los correos de pruebas vuelven a apuntar al sitio real)…');
  const r = supabase('secrets', 'unset', 'ENLACES_PRUEBAS_URL');
  if (r.status !== 0) console.error('NO se pudo apagar solo. Corre de nuevo este comando y ciérralo con Ctrl+C, o avísale a Claude.\n', (r.stderr || r.stdout || '').slice(0, 400));
  else console.log('Listo: modo local apagado.');
}

console.log(`Encendiendo el modo local → ${base}`);
// El secreto lleva vencimiento (4 h): si se olvida apagarlo, las funciones lo ignoran solas y los botones vuelven al sitio público.
const vence = Date.now() + 4 * 3600 * 1000;
const r = supabase('secrets', 'set', `ENLACES_PRUEBAS_URL=${base}#${vence}`);
if (r.status !== 0) { console.error('No se pudo encender el modo local:\n', (r.stderr || r.stdout || '').slice(0, 600)); process.exit(1); }

const vite = spawn(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), ...(celular ? ['--host'] : [])], { stdio: 'inherit' });
console.log(`\n=== MODO LOCAL ENCENDIDO ===\nLos correos de pruebas que se envíen ahora traen botones que abren ${base}\nCuando termines, cierra esto con Ctrl+C: se apaga solo.\n`);
const salir = () => { try { vite.kill(); } catch { /* ya cerrado */ } apagar(); process.exit(0); };
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
process.on('SIGHUP', salir);
vite.on('exit', () => { apagar(); process.exit(0); });
process.on('exit', apagar);
