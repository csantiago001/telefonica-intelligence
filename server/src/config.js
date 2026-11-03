// Carga de configuración desde .env (sin dependencias) y valores por defecto seguros.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const fileEnv = parseEnvFile(path.join(ROOT_DIR, '.env'));
  const env = { ...fileEnv, ...process.env, ...overrides };
  const demo = env.APP_MODE === 'demo' || process.argv.includes('--demo');
  const mode = demo ? 'demo' : 'private';
  const isTest = env.NODE_ENV === 'test';

  let masterKey = env.MASTER_KEY;
  if (!masterKey || !/^[0-9a-f]{64}$/i.test(masterKey)) {
    if (mode === 'demo' || isTest) {
      // En demo/pruebas se deriva una clave efímera determinista: los datos son ficticios.
      masterKey = crypto.createHash('sha256').update('ti-demo-key-' + (env.DATA_DIR || 'demo')).digest('hex');
    } else {
      throw new Error(
        'MASTER_KEY no configurada o inválida (64 caracteres hexadecimales). Ejecute "npm run setup" o "node server/scripts/init-env.js" para generarla.'
      );
    }
  }

  const dataDir = path.resolve(ROOT_DIR, env.DATA_DIR || (demo ? 'data-demo' : 'data'));
  return {
    mode,
    isDemo: demo,
    isTest,
    port: Number(env.PORT || (demo ? 8081 : 8080)),
    host: env.HOST || '127.0.0.1',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    dataDir,
    dbFile: path.join(dataDir, 'ti.db'),
    evidenceDir: path.join(dataDir, 'evidencias'),
    backupDir: path.join(dataDir, 'backups'),
    masterKey: Buffer.from(masterKey, 'hex'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    corsOrigin: env.CORS_ORIGIN || '',
    trustProxy: env.TRUST_PROXY === 'true',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || (demo ? 1 : 50)),
    osintTimeoutMs: Number(env.OSINT_TIMEOUT_MS || 10000),
    clientDist: path.join(ROOT_DIR, 'client', 'dist'),
    allowPrivateNetworkFetch: env.ALLOW_PRIVATE_FETCH === 'true',
  };
}
