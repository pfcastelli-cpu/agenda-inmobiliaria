# Puesta en marcha para Patrimonios Inmobiliarios

Lista para pasar de pruebas a clientes reales. Estado revisado el 28-oct-2026 contra la base de producción (solo lectura).
Orden sugerido: A (datos y equipo) → B (configuración) → C (prueba general) → D (salida). Marca cada casilla con la fecha.
Fase 2 (fuera de esta salida): pruebas con Outlook y celulares físicos, importación del `.ics` adjunto en calendarios, reuniones virtuales con Meet/Teams/Zoom, IA multiproveedor.

## Lo que ya funciona (verificado)
- Reserva pública con candado por día y regla en la base contra doble reserva; aviso claro cuando otro se queda con el horario (probado en navegador simulando el choque).
- Visitas a inmuebles arrendados: plazo proporcional, horario liberado al instante, aceptación atómica de la hora propuesta; prueba real del 28-oct con la cita sintética (todo PASS).
- Encuesta, informe del propietario con filtro de IA (falla cerrado), preferencias del propietario, alertas de calificación baja, radicación del estudio, alertas de demanda, supervisión, registro de fallos del sistema.
- 8 tareas programadas activas: `demanda-avisar`, `encuestas-pendientes`, `encuestas-resumen-semanal`, `opiniones-filtrar`, `portales-reevaluar`, `propietarios-resumen`, `reubicaciones-procesar`, `tickets-mantenimiento`.

## A. Datos y equipo (lo que hoy se ve en la base)
- [ ] **Limpiar las citas de prueba.** Hay 51 marcadas como prueba y 20 «reales» entre las que se ven nombres de prueba (por ejemplo «Pepe», «Prueba», «pwedro»). Revisarlas, marcarlas `es_prueba` y **cancelarlas, no borrarlas** (`docs/LIMPIAR-PRUEBAS.md`). Hacerlo justo antes de salir.
- [ ] **Asesores:** hay 3 activos (Laura Salcedo, Luis Jiménez, Luisa Restrepo). **Laura y Luisa no tienen acceso de login** (Configuración → Accesos → «Dar acceso»). Los tres nombres deben ser el **nombre completo como lo conoce la aseguradora** (ej. «Luis Jiménez Fino»): el formulario de radicación copia ese nombre.
- [ ] **Supervisor de cada asesor** (Equipo → ficha → Supervisor): hoy ninguno tiene. Sin supervisor, las alertas de calificación baja y de demanda van a los administradores (hoy Gino y tú).
- [ ] **Administradores:** decidir quién recibe los avisos de encuesta (hoy «cada encuesta» a todos los administradores). Opción: Empresa → correos de aviso de encuesta, o pasar a resumen semanal.
- [ ] **Propietarios sin correo:** 85 sin correo registrado → no recibirán avisos ni resúmenes. Completarlos en el origen (Sedi) y sincronizar.
- [ ] Revisar que los 81 inmuebles disponibles tengan horario de visita, ubicación y, si están arrendados, el horario/«sin aviso al arrendatario» que corresponda.

## B. Configuración (Configuración → …)
- [ ] **Empresa → Reservas públicas → verificación del correo: ENCENDIDA.** Hoy está **apagada** (interruptor de pruebas, SQL 036). Encenderla antes de recibir clientes reales.
- [ ] **Radicación:** completar, por ciudad, póliza/código, enlaces y costos (el SQL 033 sembró Bogotá = 1478 / 15 % + IVA y Barranquilla = 14221 / 20 % + IVA; Medellín usa la predeterminada). Marcar «Enviar automáticamente» solo cuando esté revisado.
- [ ] **Inteligencia artificial:** sin clave, **ningún comentario de encuesta llega al propietario** (es lo seguro, pero el informe saldrá sin comentarios). Pegar una clave de Anthropic, OpenAI o Google y pulsar «Probar la clave».
- [ ] **Demanda:** fijar el tope de citas activas por inmueble (sugerido 6–8) y revisar los umbrales 3 / 5; importar el `.ics` del calendario anterior para calibrar.
- [ ] **Supervisión:** definir si se activa «Llegué a la visita» (ubicación solo en ese instante). **Antes de activarlo:** aviso escrito al equipo y revisión de la política de datos con tu abogado (Ley 1581 de 2012).
- [ ] **Encuesta:** confirmar «minutos después de la visita» y el aviso a la administración.
- [ ] **Contacto legal** de la empresa completo (razón social, NIT, dirección, política de datos, correo de baja): sin eso no sale el bloque de captación a propietarios.

## C. Prueba general (con el modo de pruebas todavía ACTIVO)
- [ ] Reservar una visita como cliente (con la verificación encendida), recibir el correo, moverla y cancelarla.
- [ ] Inmueble arrendado: enviar el aviso al arrendatario, probar «No puedo a esta hora» y que el cliente elija otra hora (el vencimiento ya queda en horario hábil, 8 a. m.–8 p. m.).
- [ ] Marcar una visita realizada → encuesta → respuesta «quiero avanzar» → correo de radicación + aviso al asesor.
- [ ] Informe del propietario y página de preferencias desde un correo real de prueba.
- [ ] Panel **Soporte → Fallos del sistema**: debe estar vacío o solo con lo esperado tras las pruebas.
- [ ] Probar desde un celular (Android y iPhone) la reserva pública y el portal del arrendatario.

## D. Salida
- [ ] Hacer un respaldo (`respaldos/`) y confirmar que Netlify tiene créditos para publicar.
- [ ] **Apagar el modo de pruebas del correo SOLO con tu orden** (Configuración → Correo). Desde ese momento los correos llegan a clientes, propietarios y arrendatarios reales.
- [ ] Primer día: revisar Bitácora, «Fallos del sistema» y la bandeja del correo de la empresa cada pocas horas; tener a mano el plan de volver al sistema anterior si algo grave falla.
- [ ] Primera semana: mirar Configuración → Demanda y Supervisión; ajustar umbrales con datos reales.

## Pendientes conocidos (no bloquean la salida)
- Outlook y celulares físicos (fase 2). El adjunto de calendario (`.ics`) no se ha probado importándolo.
- Prana 127 no tiene correo de arrendatario registrado: la confirmación final a ese rol no se ha podido probar de punta a punta.
- La lista de espera de un inmueble lleno se guarda, pero aún no hay pantalla del equipo para verla.
- Reuniones virtuales (Meet/Teams/Zoom) y filtro de IA con varios proveedores: escritos, no probados con credenciales reales.
