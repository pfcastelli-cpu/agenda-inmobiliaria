# Entrega 003 — estado actualizado
Consultar LEEME-003-inmuebles-citas.md. Se agregó sql/003-inmuebles-citas.sql (sin ejecutar
todavía): tablas agenda_inmuebles (espejo de solo lectura del inventario, hoy
alimentado desde Sheets de Sedi) y agenda_citas (motor de reservas real, sin el
algoritmo de prioridad/ruteo todavía). La sincronización diaria desde Sheets aún
no está construida; falta decidir si vive en n8n o en un proyecto nuevo de Apps
Script. No se ha tocado la hoja de Sheets ni el calendario de Google. Las notas
de entregas anteriores quedan abajo como referencia histórica.

# Entrega 002 — estado actualizado
Consultar LEEME-ACTUALIZACION.md. Se agregó panel administrativo de fichas y marca. Requiere aplicar sql/002-equipo-configuracion.sql. No se crean cuentas de asesores ni se envían correos todavía. La conexión de login ya existe en aplicacion/, con Supabase; el index.html de la raíz es referencia antigua. Las notas de primera entrega de abajo son históricas.

# Agenda inmobiliaria — contexto para continuar en Cursor

## Estado real
Este paquete contiene la demostración visual existente, no una aplicación de producción.
index.html muestra el acceso simulado y permite explorar la agenda con 100 inmuebles y 10 asesores sintéticos. No envía correos ni guarda reservas en Supabase. No ingresar contraseñas reales hasta sustituir el formulario simulado por la integración auténtica.
La demostración usa fechas fijas de septiembre de 2026 y reglas simplificadas de 40 minutos por visita y 30 de traslado. No tratarlas como reglas definitivas del negocio.

## Supabase ya preparado por Felipe
- URL: https://ykiuuxludyonkhywtmgu.supabase.co
- Usuario inicial: f924d6d2-edc2-4ab9-98c2-98e77df09c73
- El script sql/001-ya-ejecutado.sql YA FUE EJECUTADO con éxito en este proyecto. Es referencia, no ejecutarlo de nuevo.
- public.agenda_empresas: id, nombre, slug, zona_horaria, color_principal, color_accion, creada_en.
- public.agenda_miembros: empresa_id, usuario_id, nombre, rol, activo, creado_en.
- Felipe pertenece a Patrimonios como administrador activo.
- RLS habilitado. Usuarios autenticados solo leen sus membresías activas y empresas correspondientes. No hay permisos de escritura para clientes. Gestión de usuarios, ciudades, inmuebles y citas aún pendiente.
- La clave publishable está en .env.example. No es una clave administrativa. Nunca solicitar ni poner contraseñas o service_role en código de navegador.

## Primera entrega que implementar
Conservar la agenda visual y preparar una aplicación local mantenible con archivos separados. Usar el SDK oficial @supabase/supabase-js para login con correo y contraseña, validación de identidad con getUser(), lectura de membresía activa y empresa bajo RLS, estados de error y cierre de sesión. No guardar contraseñas. No permitir elegir el rol para obtener acceso. Una cuenta autenticada sin membresía activa debe ver acceso no habilitado.
La recuperación de contraseña requiere flujo de cambio de contraseña, URL de retorno autorizada y correo configurado; no anunciar envíos ni éxito ficticios.
La agenda sigue siendo demostrativa hasta implementar las tablas y operaciones de reservas. Etiquetarla claramente y no mezclar reservas falsas con reales.
No modificar la base remota sin entregar previamente una migración revisable. No reejecutar 001. No hacer despliegues ni enviar correos de prueba sin instrucción del usuario.
Verificar compilación y errores de configuración. Felipe prueba sus credenciales directamente en el navegador. No pedir que las pegue en el chat.

## Producto objetivo
SaaS para distintas inmobiliarias, con identidad y datos separados por empresa. Patrimonios será el primer cliente.
Ciudades y asesores configurables sin límites fijos en código; administradores, coordinadores y asesores. Panel general, horarios recurrentes y excepciones, reservas y reprogramación sin cruces concurrentes, prioridad al captador y suplentes autorizados. Separar captador y asesor que realiza la visita. Respetar disponibilidad del inmueble, acceso a llaves y traslados.
Avisos a cliente, asesor y propietarios designados; distinguir autorización de entrada de una simple notificación. Retroalimentación estructurada, informes y recomendaciones con evidencia. Enviar link validado de El Libertador a interesados; abrir el enlace no significa radicar documentos.

## Fuentes existentes (no públicas; requieren acceso autorizado)
Inventario: https://docs.google.com/spreadsheets/d/1glxLgXqLSFEahUP6ekMknWtJZuusLZPPF2bJdcRWovM/edit
Propietarios: https://docs.google.com/spreadsheets/d/1ojA56CIz4LTzuz7hGnNK5K0Jbnbyyz3toh-URXYV0e8/edit
Relacionar Numero inmueble con Inmueble. Hay captadores vacíos; Activo no equivale a disponible. No deducir destinatarios de la columna Estado del informe de propietarios, que contiene Arrendatario/Ex arrendatario. Validar copropietarios, principal y contactos. No importar documentos, bancos o datos personales innecesarios.
API Sedi: https://drive.google.com/drive/folders/1HhlpWgrYYoIMHVf053oYTfCDhe0MjpB2
Documentación revisada: Sedi ENVÍA propiedades por POST a endpoints del integrador, autenticados por x-api-key. Registro usa NumeroInmueble; eliminación usa NumeroInmueble y EstadoInmuebleID. No hay GET de inventario documentado. Confirmar destino adicional, carga inicial, estados, orden y reintentos. Actualizaciones pueden ser eliminación + registro: conservar identidad e historial. No tocar integración web de Paxzu. No implementar envío de contactos a Sedi.

## Diseño aprobado
Conservar estructura visual y adaptación móvil. Manual: https://drive.google.com/file/d/1XzmUW9dUNcNuhll_ebvyQhtLlQIk9Di1/view
Azul #1A2C45, turquesa #00A9A5, aqua #E3F8F7, rojo puntual #D43228, nube #F4F4F4, grafito #4D4D4D; Poppins. Garantizar contraste de texto; no blanco pequeño sobre turquesa. El archivo actual es una aproximación, sin logo oficial vectorial.

## Forma de colaborar
Felipe no es desarrollador: explicar pasos concretos en español. Aplicar parches solo donde lo solicita, conservar el resto, y mantener archivos completos actualizados. No regenerar el proyecto en cada cambio. No afirmar pruebas reales que no se hicieron.

## Nota del archivo exportado
index.html es un contenedor de previsualización con iframe y CSP sin conexiones externas. Mantenerlo como referencia visual. Para la aplicación real, usar referencia-visual.html como fuente de los componentes y crear un punto de entrada normal del proyecto; no intentar autenticar dentro del contenedor de demostración. .env.example es configuración de ejemplo y todavía no está leída por la demo.
