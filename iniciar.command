#!/usr/bin/env bash
# TELEFÓNICA INTELLIGENCE — Inicio en Linux/macOS. Uso: ./iniciar.sh  (o ./iniciar.sh demo)
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "No se encontró Node.js. Instale la versión LTS 22 o superior desde https://nodejs.org y vuelva a ejecutar."; exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Se requiere Node.js 22.13 o superior (tiene $(node -v))."; exit 1
fi
[ -d node_modules ] || { echo "Instalando dependencias (solo la primera vez)…"; npm install --no-audit --no-fund; }
[ -f client/dist/index.html ] || { echo "Compilando la interfaz…"; npm run build; }
node server/scripts/init-env.js
MODE=${1:-private}
if [ "$MODE" = "demo" ]; then URL="http://127.0.0.1:8081"; else URL="http://127.0.0.1:$(grep -E '^PORT=' .env | cut -d= -f2 || echo 8080)"; fi
( sleep 3; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") || true ) >/dev/null 2>&1 &
if [ "$MODE" = "demo" ]; then npm run start:demo; else npm start; fi
