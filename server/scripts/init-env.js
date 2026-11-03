// Genera .env con secretos aleatorios si no existe. Nunca sobrescribe uno existente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  console.log('[setup] .env ya existe; no se modifica.');
} else {
  const tpl = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const out = tpl.replace(/^MASTER_KEY=.*$/m, `MASTER_KEY=${crypto.randomBytes(32).toString('hex')}`);
  fs.writeFileSync(envFile, out, { mode: 0o600 });
  console.log('[setup] Se creó .env con una clave maestra aleatoria.');
  console.log('[setup] IMPORTANTE: guarde una copia de MASTER_KEY en un lugar seguro. Sin ella no podrá descifrar evidencias ni copias de seguridad.');
}
