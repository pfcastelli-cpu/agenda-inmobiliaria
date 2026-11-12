# Asambleas de copropiedades

## Etapa 1 lista para revisión

Se creó `sincronizacion/vigilante-asambleas.gs` para ejecutarse como archivo nuevo en el mismo proyecto de Apps Script que `vigilante-correos.gs`.

No modifica el vigilante existente ni repite sus funciones. Reutiliza Gmail, Gemini, los límites de cuota, los buzones, el índice existente y las utilidades de lectura.

### Modos

- Ensayo: `iniciarEnsayoAsambleas('2026/10/12')`.
  - Lee desde la fecha indicada.
  - No llama a la Edge Function.
  - Guarda los resultados en la hoja `Asambleas ensayo`.
- Histórico: `iniciarHistoricoAsambleas('2026/01/01')`.
  - Guarda la fecha junto con los cursores por buzón.
  - Reanuda cuando se alcanza el límite de Apps Script.
- Diario: `instalarDisparadorAsambleas()`.
  - Instala una revisión diaria de las últimas 48 horas.

Cada conversación produce un registro único por `buzón|id_hilo`. La hoja de ensayo guarda el contenido completo disponible de los correos: cuerpo de texto, copia HTML original, metadatos, adjuntos identificados y extracción de Gemini. Si llega otra citación en el mismo hilo, se actualiza el registro.

La hoja de ensayo contiene información potencialmente sensible y debe mantenerse privada, sin compartirla ni publicarla. Al terminar las pruebas, debe borrarse la hoja y retirar la propiedad `ASAMBLEAS_HOJA_ID` si ya no se necesita.

### Propiedades del script

Ya existentes y reutilizadas:

- `SA_EMAIL`
- `SA_PRIVATE_KEY`
- `BUZONES`
- `GEMINI_API_KEY`
- propiedades internas de modelo y cuota de Gemini

Necesarias para operación completa, todavía sin valores en el repositorio:

- `ASAMBLEAS_EMPRESA_ID`
- `ASAMBLEAS_EDGE_URL`
- `ASAMBLEAS_EDGE_SECRETO`

Opcional:

- `ASAMBLEAS_HOJA_ID`, para reutilizar una hoja existente.

Los secretos deben quedar únicamente en Propiedades del script. La URL final y la Edge Function se definirán en la Etapa 2.

### Resultado de Gemini

Extrae, sin inventar:

- citación sí/no
- ordinaria o extraordinaria
- copropiedad
- fecha y hora
- lugar o enlace
- modalidad
- fecha límite para poderes o asistencia
- inmueble mencionado
- confianza

Los plazos legales, quórum y demás reglas de la Ley 675 quedan pendientes de revisión y no se calculan en esta etapa.

### Etapa 2 pendiente

No se aplicó SQL, no se creó ni desplegó la Edge Function y no se modificó la base de datos. La función futura deberá recibir el registro mediante el header `x-asambleas-secreto`, asociar por `empresa_id` el inmueble y propietarios, y ser idempotente por hilo.

### Conectar el botón del menú después de la Etapa 3

1. Importar `renderAsambleas` en el router existente.
2. Agregar la opción de menú que apunte a esa vista.
3. Cargar `asambleas.css` junto con los estilos de la aplicación.

### Visor local de ensayo

Se agregó `aplicacion/asambleas-ensayo.html`, con su JavaScript y CSS independientes. Es una vista de solo lectura: carga una exportación JSON o CSV de la hoja `Asambleas ensayo` en la memoria del navegador, muestra métricas, filtros, agrupación por mes, detalle de la conversación y enlaces de Drive cuando existan. No usa Supabase, no guarda datos localmente y no envía correos.

La hoja de ensayo contiene el contenido completo de los correos y datos potencialmente sensibles. Debe mantenerse privada, no compartirse públicamente y borrarse al terminar el ensayo. El visor no publica ni sube esos datos.

Para abrirlo localmente:

1. Ejecutar `npm run dev` en la raíz del proyecto.
2. Abrir `http://localhost:5173/asambleas-ensayo.html`.
3. Exportar la hoja de ensayo como CSV o preparar un JSON y cargarlo en la pantalla.

### Decisiones pendientes para Drive y avisos

La recomendación de diseño es una unidad compartida privada, con una carpeta separada por empresa o proceso. En Supabase solo deben quedar metadatos, estados, identificadores y enlaces. No se debe hacer pública la carpeta que contenga correos, propietarios o adjuntos; si se requiere un enlace público, debe ser un archivo individual previamente depurado y autorizado.

El reenvío debe adjuntar el PDF de la convocatoria y los adjuntos que Gemini determine relacionados, sin enviar enlaces de Drive. La autorización del propietario y la confirmación de asistencia de la inmobiliaria deben ser estados separados. El modo `correo_modo_pruebas` debe seguir activo: durante las pruebas ningún mensaje puede llegar a propietarios reales.
