// «Enviarme una prueba» y «Reportar problema con este correo»: comunes a todas las pantallas desde donde sale un correo a un cliente o propietario.
// La prueba usa la MISMA función que el envío real con { prueba: true }: el correo llega solo a quien pulsa el botón, con el aviso de PRUEBA,
// y no cambia ningún estado (no marca nada como enviado). El reporte crea un ticket normal (agenda_ticket_crear) con el contexto del correo.

// Devuelve { ok, enviadoA, error }. `cuerpo` es lo mismo que recibe el envío real (por ejemplo { inmueble_id }).
export async function enviarPrueba({ supabase, funcion, cuerpo }) {
  try {
    const { data, error } = await supabase.functions.invoke(funcion, { body: { ...cuerpo, prueba: true } });
    if (error || !data?.ok) return { ok: false, error: data?.error || error?.message || 'No se pudo enviar la prueba.' };
    if (!data.enviado_a) return { ok: false, error: data.motivo || 'La prueba no salió. Revisa la bitácora de correos.' };
    return { ok: true, enviadoA: data.enviado_a };
  } catch (e) {
    return { ok: false, error: e?.message || 'No se pudo enviar la prueba.' };
  }
}

// Pide al usuario qué se ve mal y abre un ticket de tipo «error». `que` identifica el correo (ej. «Informe al propietario · inmueble 645»).
// Devuelve un texto listo para mostrar en un aviso, o null si el usuario canceló.
export async function reportarProblemaCorreo({ supabase, empresaId, que }) {
  const detalle = window.prompt(`¿Qué se ve mal o no funciona en este correo?\n(${que})`, '');
  if (detalle === null) return null;
  if (detalle.trim().length < 3) return 'Escribe al menos unas palabras para poder corregirlo.';
  const { data, error } = await supabase.rpc('agenda_ticket_crear', {
    p_empresa_id: empresaId,
    p_tipo: 'error',
    p_titulo: `Correo: ${que}`.slice(0, 140),
    p_descripcion: `${detalle.trim()}\n\nCorreo: ${que}\nReportado desde el botón de correo de prueba.`,
    p_pagina: 'correo de prueba',
    p_prioridad: 'normal',
  });
  if (error) return 'No se pudo crear el ticket: ' + error.message;
  return `Ticket${data?.numero ? ` #${data.numero}` : ''} creado. Lo revisamos y te avisamos.`;
}
