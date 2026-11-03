import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createBackup } from '../src/lib/backup.js';

const config = loadConfig();
const db = openDatabase(config.dbFile);
const b = createBackup(db, config, 'cli');
db.close();
console.log(`Copia creada: ${b.file}\nTamaño: ${b.size} bytes\nSHA-256: ${b.sha256}\nArchivos incluidos: ${b.files}`);
