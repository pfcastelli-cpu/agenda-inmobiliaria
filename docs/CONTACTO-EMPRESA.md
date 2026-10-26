# Contacto y datos legales por empresa

## Entradas y contrato
- UI: `aplicacion/js/contacto-empresa.js`, montado en Empresa por `administracion.js`.
- Backend puro: `supabase/functions/_shared/contacto-correo.ts` normaliza y escapa; `marca-correo.ts` lo integra.
- Persistencia: fila de `agenda_configuracion` identificada por `empresa_id`, con las políticas RLS existentes (002).
- El correo público sigue en `correo_contacto`; `telefono` queda como respaldo de la misma empresa si no hay sedes.
- La nueva columna `contacto_empresa` contiene:
  - `sedes`: hasta 20 objetos `{nombre, ciudad, telefonos}`.
  - `telefonos`: entre 1 y 10 objetos `{etiqueta, numero, extension}` por sede. Número con 7–15 dígitos; extensión opcional de hasta 8.
  - `sitio_web`, `razon_social`, `nit`, `direccion`, `politica_datos_url`, `correo_baja`.
- Web y política solo HTTPS sin credenciales. Los campos vacíos se omiten. La baja usa `correo_baja` o, si está vacío, `correo_contacto` de esa fila.
- El botón comercial usa `correo_contacto`, no el correo de baja. Solo aparece cuando están completos razón social, NIT, dirección, política de datos y canal de baja, además del correo comercial. Esto no verifica consentimiento ni cumplimiento legal.
- Las fotos temáticas con el logo de Patrimonios solo se usan con su slug exacto (`empresa:agenda_empresas(slug)` en la misma consulta de configuración); otras empresas usan su imagen/logo propios.

## Migración y publicación
`sql/016-contacto-empresa.sql` está preparada, NO aplicada por Codex. Añade JSONB y validación de formato sin cambiar políticas RLS ni SMTP. Conserva los datos públicos anteriores únicamente para la fila cuyo slug exacto es `patrimonios`; aborta si no identifica una única configuración y no sobrescribe un objeto ya personalizado.

Con autorización de Felipe, el orden es: aplicar 016 y verificar los datos por empresa; desplegar las 12 funciones que importan `marca-correo.ts`; publicar el frontend. Las nuevas consultas de las funciones necesitan la columna: no desplegarlas antes de 016. La UI mantiene los campos antiguos si la columna aún no existe.

No cambiar `correo_modo_pruebas`, JWT, SMTP, políticas ni credenciales. Los identificadores ICS y las rutas operativas existentes no forman parte de este cambio.

## Validación local
- `node --test tests/contacto-empresa.test.mjs` (Node 24, sin instalar dependencias): aislamiento entre empresas, datos vacíos/malformados, escape, URLs, teléfonos/extensiones, publicidad y análisis sintáctico de las 12 funciones.
- `npm run build`; para preservar `dist/`, se puede indicar un `--outDir` temporal nuevo fuera de la app.
- Vista previa sintética: iniciar Vite desde la raíz con `node node_modules/vite/bin/vite.js . --host 127.0.0.1 --port 5175 --strictPort` y abrir `/tests/fixtures/contacto-preview.html`. Usa los módulos reales del editor/pie, sin Supabase ni SMTP; el guardado de la prueba solo dura en memoria.
- Esto no sustituye verificar guardado/lectura con sesión, aislamiento RLS en Supabase y recepción de correo en Gmail/Outlook/celular después de autorizar el despliegue.
