# Integraciones: cómo se conecta otro proyecto a la agenda

Para que un proyecto aparte (p. ej. el de **estudios de mercado**, o uno nuevo) hable con este sin mezclar código.
Regla: el otro proyecto nunca toca la base de datos directamente ni usa la `service_role`; solo entrega o pide datos por las puertas de abajo.

## Qué lee el proyecto nuevo (póngale esto en su `CLAUDE.md`)

> Para conectarte con la agenda de Patrimonios lee `<ruta>/agenda-inmobiliaria/docs/INTEGRACIONES.md`. No edites ese repositorio desde aquí.

Si prefiere no depender de la ruta, copie este archivo a la carpeta del proyecto nuevo.

## Puerta 1 · Estudio de mercado (ya construida)

1. El propietario pide el estudio (casilla en `/propietario/` o botón del informe) → queda una fila en `agenda_estudios_mercado` con `estado = pendiente`. También se crea a mano desde la pantalla **Estudios** de la agenda.
2. Alguien del equipo genera el PDF en el proyecto de estudios de mercado con los datos del inmueble (número, dirección, barrio, ciudad, tipo, valor, canon) que ve en la agenda.
3. Sube el PDF en **Estudios → Cargar PDF** (`estado = listo`), lo revisa y pulsa **Enviar al propietario** (función `enviar-estudio-mercado`; respeta el modo de pruebas).

Más adelante, si el proyecto de estudios se vuelve automático, solo cambia el paso 2: en vez de subir a mano, llamaría a la función `subir-estudio-mercado` (por crear) con una clave propia. El resto no se toca.

## Puertas para proyectos nuevos (reglas)

- **Entrada de datos:** una Edge Function nueva por integración, con su propia clave guardada como secreto de Supabase (nunca en el repo), que valide a quien llama y escriba solo en su tabla.
- **Datos que comparten:** tablas nuevas en `public` con `empresa_id`, RLS y los grants de `CLAUDE.md`.
- **Pantalla:** un módulo `aplicacion/js/<nombre>.js` y un botón en el menú. Debe usar las clases `v-*` y las variables `--empresa-*` / `--tema-*` para verse igual al resto; si el proyecto nuevo trae su propia pantalla, se abre dentro de esta app (módulo) o por enlace con el inmueble ya elegido.
- **Correos:** siempre con `correoBase` de `supabase/functions/_shared/plantilla-correo.ts` y respetando `correo_modo_pruebas`.
- **Documentar:** cada integración se agrega aquí con: qué entra, qué sale, quién la llama y cómo se prueba.
