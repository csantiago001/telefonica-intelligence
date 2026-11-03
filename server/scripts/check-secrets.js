// Verifica que no haya secretos ni datos reales en los archivos versionados por git.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const bad = [];
const forbiddenNames = [/^\.env$/, /\.db$/, /\.db-(wal|shm)$/, /\.tibak$/, /\.enc$/, /^data\//, /^data-demo\//, /\.pem$/, /\.key$/];
const patterns = [
  [/MASTER_KEY=[0-9a-f]{64}/i, 'MASTER_KEY real'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'clave privada'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'token de GitHub'],
  [/AKIA[0-9A-Z]{16}/, 'clave AWS'],
  [/sk-[A-Za-z0-9]{32,}/, 'clave de API'],
];
for (const f of files) {
  if (forbiddenNames.some((r) => r.test(f))) { bad.push(`${f}: archivo que no debe versionarse`); continue; }
  if (!fs.existsSync(f) || fs.statSync(f).size > 2_000_000 || f.includes('node_modules')) continue;
  const txt = fs.readFileSync(f, 'utf8');
  for (const [r, label] of patterns) if (r.test(txt)) bad.push(`${f}: posible ${label}`);
}
if (bad.length) { console.error('Se encontraron problemas:\n' + bad.join('\n')); process.exit(1); }
console.log(`OK: ${files.length} archivos revisados, sin secretos ni datos reales.`);
