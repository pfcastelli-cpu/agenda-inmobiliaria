# Asuntos operativos ajenos al desarrollo de la app

No hace falta leer esto para programar. Es el índice de dónde está cada tema; el detalle largo está en
`docs/historico/CLAUDE-completo-2026-10-26.md` (buscar por la palabra clave) y no se duplica aquí.

- **Terminaciones y entregas en Sedi** (casos cargados, regla de «entrega segura», causas, adjuntos, errores del Cuadro de
  Entregas): histórico → «Pendiente / próximos pasos», puntos `00000` y `000000`.
- **Vigilante de correos** (Apps Script que lee solicitudes@, info@, etc.; hoja de resultados, resumen diario, topes de Gemini):
  `sincronizacion/LEEME-vigilante-correos.md`, `sincronizacion/vigilante-correos.gs`; histórico → «Vigilante de correos».
- **Sincronización de inmuebles y arrendatarios** (Sedi → Supabase): `sincronizacion/sincronizar-inmuebles.gs`; falta pegar
  `sincronizarArrendatarios` en Apps Script y su activador (histórico, punto `00`).
- **Respaldo semanal a Google Drive**: `sincronizacion/respaldo-drive.gs` (propiedades `RESPALDO_CARPETA_ID`, `RESPALDO_CONSERVAR`).
- **Bot de WhatsApp** (otro proyecto de Apps Script): interruptor Calendar/sistema nuevo pendiente.
- **Supabase Auth**: revisar que Site URL = `https://citas.patrimonios.co`.
- Los scripts de `sincronizacion/` se despliegan a mano en Google (copiar y pegar en el editor); no se publican desde este repo.
