# Casos de inmuebles (terminaciones, mantenimientos, PQRs y asambleas)

Rama `casos-inmuebles` (copia aparte `../agenda-inmobiliaria-casos`, para no cruzarse con el trabajo del bot de WhatsApp).
Estado: escrito y compilado; **SQL sin aplicar, sin commit, sin desplegar**.

## Qué hay
- `sql/120-casos-inmuebles.sql`: tablas `agenda_casos`, `agenda_casos_seguimientos`, `agenda_casos_archivos` (enlaces de Drive), `agenda_sedi_cola`, `agenda_casos_reportes`. RLS: solo administrador y coordinador. No se borra: se cierra o se descarta. Triggers: cada alta, cambio de estado, seguimiento o acta deja una tarea en la cola de Sedi; una terminación no se cierra sin acta y fecha real.
- `aplicacion/js/casos-inmuebles.js`: menú **Casos** con pestañas Terminaciones, Mantenimientos, PQRs, Asambleas y «Sincronizar con Sedi». Cualquier usuario autorizado puede crear casos, agregar seguimientos y enlaces de Drive. Clasifica la terminación (segura/extemporánea/acuerdo) y calcula el plazo de 15 días hábiles de un derecho de petición.
- `.claude/skills/sincronizar-sedi-chrome/SKILL.md`: procedimiento para pasar la cola a Sedi con el Chrome de Felipe.
- `tests/casos-inmuebles.test.mjs`: `node --test tests/casos-inmuebles.test.mjs` (4 pruebas pasan).

## Datos personales (Ley 1581)
La tabla guarda contrato, copropiedad, unidad y rol. Nombres, cédulas, celulares y correos se quedan en Sedi; el reporte los resuelve al enviar.

## Fotos en Drive (propuesta, Fase 2)
Unidad compartida «3. Reparaciones Locativas» (id 0AEY7_eQfAfhHUk9PVA). Hoy las fotos están sueltas (nombres «WhatsApp Image…») dentro de `RECIBOS SERVICIOS / 2026 / <inmueble o propietario>` (HALL 46, PARQUE, TURINGIA, LUCERO, TOLEDO…).
Convención nueva, sin mover nada de lo viejo:
`3. Reparaciones locativas / CASOS / <Copropiedad> / <Unidad> / <TIPO>-<número de caso> /` con subcarpetas `1-Antes`, `2-Durante`, `3-Después`, `4-Documentos` (actas, cotizaciones, cartas).
- Cada caso guarda el enlace de su carpeta en `agenda_casos.drive_carpeta_url`.
- Nombre de foto: `AAAA-MM-DD_antes_cocina.jpg` (el reporte usa la palabra del medio para agrupar).
- Lectura: cuenta de servicio con permiso solo de lectura sobre esa unidad; la agenda lista y muestra miniaturas. Subir fotos: botón «Abrir carpeta» (Drive) o vía Chrome de Felipe.

## Falta
1. Fase 2: leer Drive con cuenta de servicio (permiso `drive.readonly` en solo lectura) para listar y mostrar las fotos de la carpeta del caso.
2. Fase 3: Edge Function `enviar-reporte-caso` + plantilla de correo/portal móvil con el logo y la marca (`marcaCorreo()`), con dos botones: enviar al propietario/arrendatario y «enviarme una prueba».
3. Importar los casos que ya están en Sedi (hoy se cargan a mano).
4. Aplicar el SQL con permiso de Felipe y renumerar si choca con otra migración.
