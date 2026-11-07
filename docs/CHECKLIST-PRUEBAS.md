# Checklist de pruebas antes de salir a producción

Sirve para probar sin entorno separado. Complementa `docs/LIMPIAR-PRUEBAS.md` (cómo marcar y limpiar el rastro).

## Reglas de seguridad antes de empezar
1. `correo_modo_pruebas` ACTIVO: todo correo llega a `correo_pruebas_destino` (el de Felipe), nunca a un cliente. Verificarlo en Administración > Correo.
2. Toda cita de prueba: `es_prueba = true` y nombre que empiece por `[PRUEBA] `. Se cancelan, no se borran.
3. Usuarios de prueba: solo con el botón temporal de Accesos y eliminarlos al terminar. No usar contraseñas reales.
4. No pulsar acciones masivas (resumen a propietarios, encuestas pendientes) sin confirmar antes que el modo de pruebas sigue activo.
5. Anotar cada fallo con: pantalla, qué se pulsó, qué se esperaba y qué pasó.

## A. Despliegue (después de cada cambio)
- [ ] `npm run build` termina sin errores.
- [ ] Funciones cambiadas desplegadas y versión nueva en `supabase functions list` (las públicas con `--no-verify-jwt`, ver CLAUDE.md).
- [ ] Si cambiaron imágenes de correos: primero push a `main`, después desplegar funciones.

## B. Correos (uno por uno; revisar en Gmail y en el celular)
Para cada correo: llega a la cuenta de pruebas, el cuerpo NO está en blanco, el título y los botones se leen (contraste), los botones abren el link correcto, el aviso «MODO DE PRUEBAS» aparece, el pie legal está completo.

| Correo | Función | Cómo dispararlo |
|---|---|---|
| Confirmación de cita | `enviar-correo-cita` | Reservar una cita de prueba en `/reservar` |
| Código de verificación | `enviar-codigo-verificacion` | Reservar y pedir el código |
| Cambio o cancelación de cita | `notificar-cambio-cita` | Cambiar y cancelar la cita de prueba |
| Recordatorio al arrendatario | `recordar-arrendatario` / `avisar-arrendatario` | Cita con arrendatario de prueba |
| Informe en vivo al propietario | `enviar-informe-propietario` | Inmueble de prueba > enviar informe |
| Aviso al propietario | `enviar-correo-propietario` | Acción de propietario sobre cita de prueba |
| Solicitud del propietario | `enviar-solicitud-propietario`, `avisar-solicitud-hecha` | Pedir cambio de precio/fotos desde `/propietario/` |
| Resumen a propietarios | `enviar-resumen-propietarios` | Solo con modo de pruebas activo |
| Encuesta al cliente | `enviar-encuesta-cliente`, `enviar-encuestas-pendientes` | Cita de prueba pasada |
| Encuesta respondida | `avisar-encuesta-respondida` | Responder `/opinion/` |
| Radicación | `enviar-radicacion-cliente` | Botón «Enviar información para radicar» |
| Estudio de mercado | `enviar-estudio-mercado` | Pestaña Estudios |
| Alerta de salud del inmueble | `enviar-alerta-salud` | Administración > Salud de inmuebles |
| Accesos / invitación | `gestion-accesos` | Crear usuario de prueba con correo de pruebas |
| Contraseña olvidada | `recuperar-contrasena` | «Olvidé mi contraseña» |
| Ticket / demanda / captación / fallo | `avisar-ticket`, `avisar-demanda`, `avisar-captacion`, `registrar-fallo` | Crear un ticket, una demanda y una captación de prueba |
| Prueba de configuración | `probar-correo-config` | Administración > Correo > probar |

## C. Pantallas internas (sesión de administrador)
Recorrer cada pestaña y pulsar cada botón sobre datos de prueba.
- [ ] Agenda: día, semana, mes, filtro por asesor, nueva cita, cancelar, «Llegué a la visita», «Enviar información para radicar».
- [ ] Inmuebles, Equipo, Informes, Bitácora, Pendientes, Estudios, Soporte: abren, filtran y guardan.
- [ ] Administración (16 secciones): Equipo, Ciudades y festivos, Empresa, Correo, IA, Reuniones virtuales, Supervisión, Radicación, Demanda, Calendario, Importar citas, Accesos, Roles y permisos, Solicitudes de propietarios, Salud de inmuebles.
- [ ] Un rol no administrador (usuario de prueba) solo ve y hace lo que su rol permite.

## D. Páginas públicas con token (cada parte solo ve lo suyo)
- [ ] `/reservar`: horarios, choque de citas, verificación, confirmación.
- [ ] `/visita/`, `/arrendatario/`, `/propietario/`, `/opinion/`, `/preferencias`: abren con su token, un token ajeno no muestra datos.
- [ ] `calendario-ics`: el calendario se abre en Google/Apple.

## E. Aspecto
- [ ] Contraste: el texto se lee (mínimo 4,5:1), en especial rojos de error y botones.
- [ ] Modo claro y oscuro.
- [ ] Móvil (375 px) y escritorio: sin texto cortado ni botones fuera de pantalla.
- [ ] Colores de la empresa vía variables `--empresa-*` / `marcaCorreo()`, no fijos.

## F. Cierre
- [ ] Citas de prueba canceladas, usuarios de prueba eliminados.
- [ ] Modo de pruebas de correo sigue como estaba (apagarlo solo con orden de Felipe).
- [ ] `docs/ESTADO-ACTUAL.md` actualizado con lo que falló y lo pendiente.
