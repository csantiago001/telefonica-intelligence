@echo off
REM TELEFONICA INTELLIGENCE - Inicio con direccion publica HTTPS (celulares y otros computadores).
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instale la version LTS 22 o superior desde https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
echo Compilando la interfaz...
call npm run build || (pause & exit /b 1)
node server\scripts\init-env.js
node --disable-warning=ExperimentalWarning server\scripts\publicar.js
pause
