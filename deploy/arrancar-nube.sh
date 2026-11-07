#!/usr/bin/env bash
# Arranque en la nube: restaura la base desde R2 (si existe) y luego lanza la app
# con Litestream respaldando en tiempo real.
set -e

if [ -z "$R2_ACCOUNT_ID" ] && [ -z "$R2_ENDPOINT" ]; then
  echo "[arranque] Falta configurar R2 (R2_ACCOUNT_ID o R2_ENDPOINT)."; exit 1
fi
export R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

echo "[arranque] Restaurando la base de datos desde Cloudflare R2 (si existe copia previa)…"
litestream restore -if-replica-exists -config /etc/litestream.yml /data/ti.db || true

echo "[arranque] Iniciando la aplicación con respaldo continuo a R2…"
exec litestream replicate -config /etc/litestream.yml -exec "node --disable-warning=ExperimentalWarning server/src/index.js"
