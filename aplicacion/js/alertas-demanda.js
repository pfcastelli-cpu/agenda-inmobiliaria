// Alertas de demanda por inmueble (lógica pura, sin red): node --test tests/alertas-demanda.test.mjs
// Contexto: con una sola radicación aceptada, muchos pedidos de cita en pocas horas significan que el canon está por debajo del precio de
// equilibrio (exceso de demanda). La señal se mide en HORAS, no en semanas.
// Los umbrales (por defecto 3 y 5 pedidos en 24 h) son ajustables en Configuración → Demanda; la alerta solo SUGIERE, nunca cambia el precio.
// La demanda alta NO cierra la agenda: se atiende a todos los clientes y la señal es «considera subir el canon».
// El tope de citas con lista de espera es una opción apagada por defecto (sql/046).

const cop = (n) => '$ ' + Math.round(Number(n)).toLocaleString('es-CO');
const redondear = (n) => Math.round(n / 10000) * 10000;

// m = una fila de agenda_demanda_resumen.inmuebles; u = { info, urgente }.
export function nivelDemanda(m, u) {
  const info = Number(u?.info ?? 3);
  const urgente = Number(u?.urgente ?? 5);
  const p24 = Number(m.pedidos_24h || 0);
  const p48 = Number(m.pedidos_48h || 0);
  const llena = m.tope != null && Number(m.activas || 0) >= Number(m.tope);
  if (p24 >= urgente || p48 >= urgente * 2 || llena) return 'urgente';
  if (p24 >= info || p48 >= info * 2) return 'atencion';
  return 'normal';
}

// Rango sugerido de ajuste: 8–10 % si es urgente, 3–5 % si es de atención. Solo sugerencia, redondeado a $10.000.
export function rangoSugerido(m, nivel) {
  const base = Number(m.valor_canon || m.valor_venta || 0);
  if (!base || nivel === 'normal') return null;
  const [a, b] = nivel === 'urgente' ? [0.08, 0.1] : [0.03, 0.05];
  return { desde: redondear(base * (1 + a)), hasta: redondear(base * (1 + b)), pct: nivel === 'urgente' ? '8–10 %' : '3–5 %', base };
}

// Mediana de una lista de números (null si está vacía).
export function mediana(nums) {
  const a = nums.map(Number).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Compara los pedidos de un inmueble con la mediana de los de su misma ciudad (si hay al menos 3 con pedidos) o de todos.
// Solo cuenta inmuebles con pedidos en el periodo: la mediana real sería más baja, así que la comparación es conservadora.
export function comparativo(m, todos) {
  const mismaCiudad = todos.filter((x) => m.ciudad && x.ciudad === m.ciudad);
  const grupo = mismaCiudad.length >= 3 ? mismaCiudad : todos;
  if (grupo.length < 3) return null;
  const med = mediana(grupo.map((x) => x.pedidos));
  return { mediana: med, ambito: grupo === mismaCiudad ? m.ciudad : 'todos los inmuebles', n: grupo.length, veces: med > 0 ? Number(m.pedidos) / med : null };
}

function textoComp(comp) {
  if (!comp || comp.veces == null) return '';
  const veces = comp.veces >= 1.5 ? `${comp.veces.toFixed(1).replace('.', ',')} veces` : 'cerca de';
  return ` Comparación: tiene ${veces} la mediana de pedidos (${String(comp.mediana).replace('.', ',')}) de ${comp.ambito}.`;
}

// Texto para el administrador: qué dato, qué significa y qué hacer. comp = resultado de comparativo() (opcional).
export function textoAlerta(m, nivel, comp) {
  const rango = rangoSugerido(m, nivel);
  const dato = `${m.pedidos_24h} ${m.pedidos_24h === 1 ? 'pedido' : 'pedidos'} de cita en 24 h (${m.pedidos_48h} en 48 h) de ${m.personas} ${m.personas === 1 ? 'persona' : 'personas distintas'}`;
  const cola = m.tope != null && m.activas >= m.tope ? ` Ya hay ${m.activas} citas activas (tu referencia es ${m.tope}).` : '';
  const sugerido = rango ? `entre ${rango.pct} (${cop(rango.desde)} a ${cop(rango.hasta)})` : 'el precio';
  if (nivel === 'urgente') {
    return `${dato}.${cola} Demanda alta: hay mucha más gente interesada que inmuebles, así que el precio probablemente está por debajo del mercado. Considera subir ${sugerido}. Mientras tanto se sigue atendiendo a todos; si la agenda del asesor no alcanza, puedes agrupar a los interesados en una visita en grupo. Revisa de nuevo en 48 horas.${textoComp(comp)}`;
  }
  if (nivel === 'atencion') {
    return `${dato}.${cola} El ritmo es alto. Vigílalo: si sigue así mañana, considera subir ${sugerido}.${textoComp(comp)}`;
  }
  return '';
}
