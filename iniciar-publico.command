#!/usr/bin/env bash
# TELEFÓNICA INTELLIGENCE — Inicio con dirección pública HTTPS (macOS/Linux)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Instale Node.js 22 LTS desde https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund
npm run build
node server/scripts/init-env.js
node --disable-warning=ExperimentalWarning server/scripts/publicar.js
