// Inicia la plataforma (modo privado) y la publica con un túnel HTTPS gratuito de Cloudflare
// (https://<aleatorio>.trycloudflare.com). Los datos permanecen en este computador.
// Uso: npm run publicar   o doble clic en iniciar-publico.bat / iniciar-publico.command
import { spawn, spawnSync, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const binDir = path.join(root, 'bin');
const isWin = process.platform === 'win32';
const exeName = isWin ? 'cloudflared.exe' : 'cloudflared';

function log(msg) { console.log(`[publicar] ${msg}`); }

function findCloudflared() {
  const local = path.join(binDir, exeName);
  if (fs.existsSync(local)) return local;
  const r = spawnSync(exeName, ['--version'], { stdio: 'ignore', shell: false });
  return r.status === 0 ? exeName : null;
}

async function downloadCloudflared() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  const file = isWin ? `cloudflared-windows-${arch}.exe` : process.platform === 'darwin' ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
  fs.mkdirSync(binDir, { recursive: true });
  log(`Descargando el conector de Cloudflare (${file}) — solo la primera vez…`);
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`No se pudo descargar cloudflared (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(binDir, exeName);
  if (file.endsWith('.tgz')) {
    const tgz = path.join(binDir, file);
    fs.writeFileSync(tgz, buf);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', binDir]);
    fs.unlinkSync(tgz);
    if (r.status !== 0) throw new Error('No se pudo descomprimir cloudflared.');
  } else {
    fs.writeFileSync(dest, buf);
  }
  if (!isWin) fs.chmodSync(dest, 0o755);
  return dest;
}

function openBrowser(url) {
  const cmd = isWin ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  const config = loadConfig();
  if (config.isDemo) throw new Error('El modo público solo se usa con APP_MODE=private.');
  if (!fs.existsSync(path.join(config.clientDist, 'index.html'))) throw new Error('La interfaz no está compilada. Ejecute primero "npm run build".');
  const port = config.port;
  const cf = findCloudflared() || (await downloadCloudflared());

  log('Abriendo túnel seguro HTTPS…');
  const tunnel = spawn(cf, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const publicUrl = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Cloudflare no entregó una dirección en 60 s. Verifique su conexión a Internet o el firewall.')), 60000);
    const onData = (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(t); resolve(m[0]); }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', (code) => { clearTimeout(t); reject(new Error(`El túnel terminó (código ${code}).`)); });
  });

  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_URL: publicUrl, TRUST_PROXY: 'true', HOST: '127.0.0.1', PORT: String(port) },
  });

  const stop = () => { tunnel.kill(); server.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.on('exit', () => { tunnel.kill(); process.exit(0); });
  tunnel.on('exit', () => { console.error('\n[publicar] El túnel se cerró. La dirección pública dejó de funcionar. Vuelva a iniciar.'); });

  // Espera a que el servidor responda por el túnel antes de abrir el navegador.
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch { /* iniciando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('\n' + '='.repeat(70));
  console.log('  PLATAFORMA PUBLICADA');
  console.log(`  Dirección pública (celular, otro computador):  ${publicUrl}`);
  console.log(`  En este computador también:                    http://127.0.0.1:${port}`);
  console.log('  Los enlaces de ubicación usarán la dirección pública (HTTPS).');
  console.log('  La dirección cambia cada vez que se reinicia. Mantenga esta ventana abierta.');
  console.log('  Recomendado: active la verificación en dos pasos (Configuración › Seguridad).');
  console.log('='.repeat(70) + '\n');
  setTimeout(() => openBrowser(publicUrl), 4000);
}

main().catch((e) => { console.error('\n[publicar] ' + e.message + '\n'); process.exit(1); });
