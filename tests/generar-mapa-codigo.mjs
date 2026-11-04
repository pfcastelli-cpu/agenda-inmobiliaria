// Genera docs/MAPA-MODULOS.md: índice compacto de funciones (nombre y línea) de los módulos grandes,
// para que un asistente lea solo el rango que necesita en vez del archivo completo (ahorra tokens).
// Uso: node tests/generar-mapa-codigo.mjs   (volver a correrlo cuando cambie mucho un módulo)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';

const UMBRAL = 20000; // bytes: solo módulos grandes
const carpetas = ['aplicacion/js', 'supabase/functions'];
const archivos = [];
for (const c of carpetas) {
  for (const e of readdirSync(c, { withFileTypes: true })) {
    if (c.endsWith('functions')) {
      if (e.isDirectory() && e.name !== '_shared') archivos.push(`${c}/${e.name}/index.ts`);
    } else if (e.isFile() && e.name.endsWith('.js')) archivos.push(`${c}/${e.name}`);
  }
}
const re = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/;
let md = '# Mapa de módulos grandes\n\nÍndice generado (`node tests/generar-mapa-codigo.mjs`). Cada entrada es `Lnúmero nombre`. Úsalo así: busca aquí la función, y abre solo ese rango con Read (offset/limit) en vez de todo el archivo. Si las líneas no cuadran, regenera.\n';
for (const f of archivos.sort()) {
  let st; try { st = statSync(f); } catch { continue; }
  if (st.size < UMBRAL) continue;
  const lineas = readFileSync(f, 'utf8').split('\n');
  const items = [];
  lineas.forEach((l, i) => { const m = l.match(re); if (m) items.push(`L${i + 1} ${m[1] || m[2]}`); });
  md += `\n## ${f} (${lineas.length} líneas, ${Math.round(st.size / 1024)} KB)\n${items.join(' · ')}\n`;
}
writeFileSync(new URL('../docs/MAPA-MODULOS.md', import.meta.url), md);
console.log('ok', md.length, 'caracteres');
