@echo off
REM TELEFONICA INTELLIGENCE - Inicio en Windows. Doble clic para abrir. Para demo: iniciar.bat demo
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instale la version LTS 22 o superior desde https://nodejs.org y vuelva a ejecutar.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
if not exist client\dist\index.html (
  echo Compilando la interfaz...
  call npm run build || (pause & exit /b 1)
)
node server\scripts\init-env.js
if /I "%1"=="demo" (
  start "" http://127.0.0.1:8081
  call npm run start:demo
) else (
  start "" http://127.0.0.1:8080
  call npm start
)
pause
