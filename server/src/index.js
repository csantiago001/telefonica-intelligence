import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { seedDemo } from './db/seed-demo.js';
import { startScheduler } from './jobs/retention.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error('\n[configuración] ' + e.message + '\n');
  process.exit(1);
}

if (config.isDemo && process.env.DEMO_RESET_ON_START !== 'false') {
  // El entorno de demostración se restablece en cada arranque: nunca acumula datos reales.
  fs.rmSync(config.dataDir, { recursive: true, force: true });
}

const { app, db, storage } = createApp(config);
if (config.isDemo) {
  const r = await seedDemo(db, config);
  if (r) console.log(`[demo] Datos ficticios cargados: ${r.cases} expedientes, ${r.phoneQueries} análisis.`);
}
const stop = startScheduler(db, config, console, storage);

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log('');
  console.log('  ████  TELEFÓNICA INTELLIGENCE');
  console.log(`  Modo: ${config.isDemo ? 'DEMOSTRACIÓN (datos ficticios)' : 'PRIVADO'}`);
  console.log(`  Abra en su navegador: ${url}`);
  console.log(`  Datos: ${config.dataDir}`);
  console.log('  Para detener: Ctrl + C');
  console.log('');
});

const shutdown = () => {
  console.log('\nDeteniendo el servidor…');
  stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
