# Actualización: equipo y marca por empresa

1. En Supabase abre SQL Editor y ejecuta el contenido completo de sql/002-equipo-configuracion.sql UNA sola vez. No vuelvas a ejecutar 001. Esta migración agrega tablas; no cambia las contraseñas ni borra datos existentes.
2. Espera que Drive sincronice los archivos nuevos y modificados con la carpeta de Cursor. Si no están sincronizadas, descarga este paquete y copia su contenido sobre la carpeta correcta, conservando tu .env.
3. En la terminal donde corre la vista previa presiona Ctrl+C. Ejecuta:

```powershell
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173
```

4. Abre http://127.0.0.1:4173 e inicia sesión como administrador. Verás Equipo y Configuración de empresa.
5. Crea una ficha de asesor, recarga, edítala y desactívala. Configura el nombre comercial, un enlace HTTPS directo a una imagen de logo y colores; guarda y recarga para verificar persistencia.

## Qué funciona después de aplicar 002
Fichas de asesores con nombre, correo, celular internacional, ciudades, prioridad, rol previsto, activación y desactivación. Búsqueda. Configuración de marca por empresa. Permisos de base de datos: solo un administrador activo de la empresa puede gestionar estas fichas y configuración. No hay eliminación definitiva. Sin límites fijos de asesores en el modelo; para grandes volúmenes la consulta necesitará paginación.

## Límites de esta entrega
Las fichas NO crean cuentas Auth, ni invitan por correo, ni conceden permisos de acceso: el rol es previsto y se muestra Acceso pendiente. Desactivar la ficha tampoco revoca una cuenta creada por separado. El siguiente módulo debe vincular las fichas a cuentas y gestionar invitaciones desde un servidor, nunca con claves administrativas en el navegador.
La agenda y sus 100 inmuebles/10 asesores siguen siendo una demostración independiente. No se han conectado estas fichas al motor de reservas. Los correos de citas, calendarios, disponibilidad real y cobro de suscripciones no están habilitados. Correo de contacto y enlace de documentos son configuración, no automatizaciones.
La marca se aplica al encabezado y panel administrativo después de identificar la empresa. El acceso previo sigue con Patrimonios hasta incorporar URL/subdominio por empresa. La agenda de demostración conserva su diseño. El logo se configura por URL HTTPS, no carga de archivos.

## Verificación
Compilación Vite satisfactoria. Migración ejecutada contra PostgreSQL local de prueba (PGlite): administrador puede crear y desactivar fichas; empresa ajena, asesor, administrador inactivo y anónimo tienen las restricciones esperadas. Sin pruebas con credenciales reales ni modificación de la base Supabase remota. Sin pruebas visuales en navegador.

## Respaldo
El ZIP respaldo-agenda-antes-panel.zip contiene los archivos originales descargados de Drive, sin .env, node_modules ni dist. Restaurar los archivos originales revierte la interfaz; las tablas nuevas permanecen y no afectan el acceso anterior.
