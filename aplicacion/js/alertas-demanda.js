// Alertas de demanda por inmueble (lógica pura, sin red): node --test tests/alertas-demanda.test.mjs
// Contexto: con una sola radicación aceptada, muchos pedidos de cita en pocas horas significan que el canon está por debajo del precio de
// equilibrio (exceso de demanda) y que la agenda del equipo se está llenando con un solo inmueble. La señal se mide en HORAS, no en semanas.
// Los umbrales (por defecto 3 y 5 pedidos en 24 h) son ajustables en Configuración → Demanda; la alerta solo SUGIERE, nunca cambia el precio.

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

// Texto para el administrador: qué dato, qué significa y qué hacer.
export function textoAlerta(m, nivel) {
  const rango = rangoSugerido(m, nivel);
  const dato = `${m.pedidos_24h} ${m.pedidos_24h === 1 ? 'pedido' : 'pedidos'} de cita en 24 h (${m.pedidos_48h} en 48 h) de ${m.personas} ${m.personas === 1 ? 'persona' : 'personas distintas'}`;
  const cola = m.tope != null && m.activas >= m.tope ? ` La agenda ya llegó al tope: ${m.activas} de ${m.tope} citas activas.` : '';
  if (nivel === 'urgente') {
    return `${dato}.${cola} Hay mucha más demanda que inmuebles: el precio probablemente está por debajo del mercado y la agenda del equipo se está llenando con un solo inmueble. Sugerencia: considera subir ${rango ? `entre ${rango.pct} (${cop(rango.desde)} a ${cop(rango.hasta)})` : 'el precio'}, limitar las citas nuevas y agrupar a los interesados en una visita en grupo. Revisa de nuevo en 48 horas.`;
  }
  if (nivel === 'atencion') {
    return `${dato}.${cola} El ritmo es alto. Sugerencia: vigílalo; si sigue así mañana, considera subir ${rango ? `entre ${rango.pct} (${cop(rango.desde)} a ${cop(rango.hasta)})` : 'el precio'}.`;
  }
  return '';
}
