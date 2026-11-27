@echo off
title Casos - prueba local
cd /d "%~dp0"
if not exist node_modulesiteinite.js (
  echo No encuentro node_modules. Abra esta carpeta en una terminal y ejecute: npm install
  pause
  exit /b 1
)
echo.
echo  DEMO DE CASOS  -  NO pide usuario ni contrasena
echo  Direccion: http://localhost:5196/aplicacion/casos-demo.html
echo  (datos de ejemplo en memoria; no toca Supabase ni envia correos)
echo  Espere 5 segundos: el navegador se abre solo. Para cerrar: Ctrl+C.
echo.
start "" /min cmd /c "timeout /t 5 >/dev/null & start http://localhost:5196/aplicacion/casos-demo.html"
node node_modulesiteinite.js --host 127.0.0.1 --port 5196 --strictPort
echo.
echo El servidor se detuvo. Si arriba hay un error, copielo y pegueselo a Claude.
pause
