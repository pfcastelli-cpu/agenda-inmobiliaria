# Soporte de plataforma (consola `/soporte`)

Para resolverles problemas a TODAS las empresas sin ser miembro de ninguna. Migración: `sql/023-soporte-plataforma.sql`.

## Quién puede qué
| Quién | Qué ve / hace |
|---|---|
| **Usuario de soporte** (tabla `agenda_soporte_usuarios`) | Entra a `/soporte`. Ve los tickets de todas las empresas, los responde, los cierra y deja notas internas. Con «acceso de ayuda» vigente de una empresa, abre un diagnóstico de solo lectura. |
| **Administrador de una empresa** | En su pestaña **Soporte** da o quita el «acceso de ayuda» (1 a 168 h) y ve el registro de lo que soporte hizo en su empresa. |
| **Cualquier usuario de una empresa** | Crea tickets y ve los suyos (el administrador ve todos los de su empresa). No ve las notas internas de soporte. |

## Qué es el «acceso de ayuda»
Un permiso temporal que da el administrador. Mientras está vigente, soporte puede abrir un **diagnóstico de SOLO LECTURA**: estado de la configuración (sin contraseñas ni secretos),
conteos (asesores, inmuebles, citas), últimos 15 correos con su estado y error, fechas de la última carga de portales y tickets recientes. NO ve correos de personas, no entra como un
usuario de la empresa y no cambia datos. Cada consulta queda en `agenda_soporte_auditoria` y la empresa la ve en su pestaña Soporte. Sin acceso vigente, la base de datos rechaza el diagnóstico.

## Crear otro usuario de soporte (solo con autorización de Felipe)
1. Crear la cuenta en Supabase (Authentication → Users → Add user) con correo y contraseña. NO se hace desde la agenda: no debe quedar como miembro de ninguna empresa.
2. Registrarla como soporte (SQL en el panel de Supabase o con la CLI):
```sql
insert into public.agenda_soporte_usuarios (usuario_id, nombre)
select id, 'Nombre de la persona' from auth.users where lower(email) = 'correo@dominio.com';
```
3. Para quitarle el acceso: `update public.agenda_soporte_usuarios set activo = false where usuario_id = '<uuid>';`
La migración 023 registra como primer usuario de soporte a Felipe (pf.castelli@patrimonios.co).

## Ciclo de vida del ticket (SQL 024, pendiente de aplicar)
- **Estados:** Abierto → En revisión → Esperando al usuario (`en_espera`) → Resuelto → Cerrado (y Descartado). Si quien escribió responde, vuelve a Abierto (reapertura). Resuelto pasa solo a Cerrado a los 5 días; Esperando al usuario sin respuesta 7 días pasa a Resuelto (`agenda_ticket_mantenimiento`, se ejecuta al abrir `/soporte`). Cerrado ya no se reabre: se crea otro.
- **Conversación:** un hilo de mensajes públicos entre quien escribió, el administrador de la empresa y soporte. Las notas internas van aparte, con botón propio, y la empresa nunca las ve.
- **Prioridad y SLA:** baja / normal / alta / urgente. Meta de primera respuesta en horas corridas: urgente 2, alta 8, normal 24, baja 48 (`agenda_ticket_sla_horas`). Son metas iniciales, no un estándar; ajustarlas según lo que el equipo pueda cumplir. «Tomar» asigna el responsable.
- **Calificación:** quien escribió el ticket califica de 1 a 5 (con comentario opcional) cuando está resuelto o cerrado; puede cambiarla 28 días.
- **Historial:** `agenda_ticket_eventos` es solo-anexar (estado, prioridad, responsable, reaperturas, calificación).
- **Indicadores** (`agenda_ticket_metricas`): por atender, vencidos, sin responsable, primera respuesta y resolución (mediana y p90), % de primera respuesta a tiempo, reabiertos, calificación con N y % de respuesta. El administrador de cada empresa ve los de su empresa; soporte ve todos y por empresa.
- **Correos** (`avisar-ticket`): `creado`, `respondido` (a quien escribió, con invitación a calificar si quedó resuelto) y `respuesta_cliente` (a quien atiende el ticket).

## Seguridad (por qué es seguro)
- Las 4 tablas nuevas no tienen políticas para el navegador: nadie las lee ni escribe directo. Todo pasa por funciones `SECURITY DEFINER` que validan quién llama (`agenda_es_soporte()` o administrador de esa empresa).
- Las funciones de soporte rechazan a cualquiera que no esté en `agenda_soporte_usuarios` y activo. El diagnóstico exige además un acceso vigente de la empresa.
- Los correos de los tickets salen por `avisar-ticket` (exige sesión): avisa a los administradores de la empresa y al equipo de soporte al crear un ticket, y a quien lo escribió al responderlo.

## Dónde está en el código
`aplicacion/soporte.html` + `aplicacion/js/soporte.js` (consola), `aplicacion/js/tickets.js` (pestaña Soporte de cada empresa, incluye el bloque de acceso de ayuda), `supabase/functions/avisar-ticket/`.
