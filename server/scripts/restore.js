// Restaura una copia .tibak. Uso: npm run restore -- ruta/al/archivo.tibak [--confirmar]
// Detenga la aplicación antes de restaurar. Los datos actuales se mueven a data/antes-de-restaurar-<fecha>.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { readBackup } from '../src/lib/backup.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) { console.error('Uso: npm run restore -- <archivo.tibak> [--confirmar]'); process.exit(1); }
const config = loadConfig();
const { manifest, entries } = readBackup(path.resolve(process.env.INIT_CWD || process.cwd(), file), config.masterKey);
console.log(`Copia del ${manifest.createdAt} (${manifest.files.length} archivos, modo ${manifest.mode}). Integridad verificada.`);
if (!process.argv.includes('--confirmar')) { console.log('Agregue --confirmar para restaurar (la aplicación debe estar detenida).'); process.exit(0); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const keep = path.join(config.dataDir, `antes-de-restaurar-${stamp}`);
fs.mkdirSync(keep, { recursive: true });
for (const name of ['ti.db', 'ti.db-wal', 'ti.db-shm', 'evidencias', 'informes']) {
  const p = path.join(config.dataDir, name);
  if (fs.existsSync(p)) fs.renameSync(p, path.join(keep, name));
}
for (const e of entries) {
  const dest = path.join(config.dataDir, e.name);
  if (!dest.startsWith(config.dataDir + path.sep)) throw new Error('Ruta inválida en la copia: ' + e.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, e.data, { mode: 0o600 });
}
console.log(`Restauración completada. Datos anteriores conservados en: ${keep}`);
