// Pruebas E2E con Playwright (navegador Chromium real).
// Uso: npm run test:e2e   (requiere "npm run build" previo)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright no está instalado. Ejecute: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'e2e', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
let failed = 0;

async function startServer(mode, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ti-e2e-${mode}-`));
  const env = { ...process.env, APP_MODE: mode, PORT: String(port), DATA_DIR: dir, MASTER_KEY: 'b'.repeat(64), HOST: '127.0.0.1' };
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(root, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return { proc, dir, url: `http://127.0.0.1:${port}` }; } catch { /* esperando */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor no inició:\n' + log);
}

async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✔ ${name}`); } catch (e) { failed++; results.push({ name, ok: false, error: e.message }); console.log(`  ✖ ${name}\n    ${e.message.split('\n')[0]}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const browser = await chromium.launch();
  // ===================== DEMO =====================
  const demo = await startServer('demo', 18081);
  console.log('Entorno de demostración:', demo.url);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_TUNNEL|ERR_NAME|ERR_INTERNET|net::ERR/.test(m.text())) consoleErrors.push(m.text()); });

  await step('Inicio de sesión (credenciales incorrectas muestran error)', async () => {
    await page.goto(demo.url);
    await page.fill('input[autocomplete=username]', 'admin.demo');
    await page.fill('input[type=password]', 'incorrecta');
    await page.click('button:has-text("Ingresar")');
    await page.waitForSelector('.alert.error', { timeout: 5000 });
    consoleErrors.length = 0; // el 401 de este intento es intencional
  });
  await step('Inicio de sesión como administrador demo', async () => {
    await page.fill('input[type=password]', 'Demo2026admin');
    await page.click('button:has-text("Ingresar")');
    await page.waitForSelector('text=Centro de operaciones', { timeout: 8000 });
    expect(await page.isVisible('.demo-banner'), 'falta banner de demostración');
    await page.waitForSelector('.recharts-surface');
    await page.screenshot({ path: path.join(shots, 'dashboard.png'), fullPage: true });
  });
  await step('Análisis telefónico de un número', async () => {
    await page.click('nav >> text=Análisis telefónico');
    await page.fill('input[placeholder="+57 300 123 4567"]', '+57 601 345 6789');
    await page.click('button:has-text("Analizar")');
    await page.waitForSelector('.result-hero', { timeout: 8000 });
    const txt = await page.textContent('.result-hero');
    expect(txt.includes('+576013456789'), 'E.164 incorrecto: ' + txt);
    expect(await page.isVisible('text=Bogotá D.C. y Cundinamarca (indicativo 601)'), 'región no mostrada');
    expect(await page.isVisible('.kv-item:has-text("Operador") >> text=No disponible'), 'operador debe ser "No disponible"');
    await page.screenshot({ path: path.join(shots, 'analisis.png'), fullPage: true });
  });
  await step('Análisis por lote y exportación CSV del historial', async () => {
    await page.click('button:has-text("Por lote")');
    await page.fill('textarea', '+34 612 345 678\n12345\n3001234567');
    await page.click('button:has-text("Analizar")');
    await page.waitForSelector('text=Resultados (3)');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Exportar CSV")')]);
    expect(dl.suggestedFilename().endsWith('.csv'), 'no se descargó CSV');
  });
  await step('Consulta OSINT registra el resultado real (fallido si no hay red, éxito si hay)', async () => {
    await page.click('nav >> text=OSINT');
    await page.click('.tool-card:has-text("Registro de dominio")');
    await page.fill('input[placeholder="ejemplo.com"]', 'example.com');
    await page.click('button:has-text("Consultar")');
    await page.waitForSelector('.card:has-text("Resultado") .badge', { timeout: 40000 });
    const badge = await page.textContent('.card:has-text("Resultado") .badge');
    expect(/Éxito|Fallido|Sin resultados|Parcial/.test(badge), 'estado inesperado ' + badge);
    if (/Fallido/.test(badge)) expect(await page.isVisible('text=Ningún dato se presenta como obtenido'), 'falta aviso de fallo honesto');
    await page.screenshot({ path: path.join(shots, 'osint.png'), fullPage: true });
  });
  await step('Crear expediente, agregar entidad, número y observación', async () => {
    await page.click('nav >> text=Expedientes');
    await page.click('button:has-text("Nuevo expediente")');
    await page.fill('.modal input >> nth=0', 'Expediente creado por prueba E2E');
    await page.selectOption('.modal select >> nth=0', 'fraude');
    await page.fill('.modal textarea >> nth=0', 'Verificar el flujo completo.');
    await page.click('.modal button:has-text("Guardar")');
    await page.waitForSelector('h1:has-text("Expediente creado por prueba E2E")', { timeout: 8000 });
    await page.click('button[role=tab]:has-text("Personas y entidades")');
    await page.click('button:has-text("Agregar persona o entidad")');
    await page.fill('.modal .field:has-text("Nombre") input', 'Persona E2E (ficticia)');
    await page.click('.modal button:has-text("Guardar")');
    await page.waitForSelector('td:has-text("Persona E2E (ficticia)")');
    await page.click('button[role=tab]:has-text("Teléfonos")');
    await page.fill('input[placeholder="+57 300 000 0000"]', '3101234567');
    await page.click('button:has-text("Asociar")');
    await page.waitForSelector('td:has-text("+573101234567")');
    await page.click('button[role=tab]:has-text("Observaciones")');
    await page.fill('textarea[placeholder="Escriba una observación…"]', 'Observación E2E');
    await page.click('button:has-text("Agregar observación")');
    await page.waitForSelector('p:has-text("Observación E2E")');
  });
  await step('Cargar evidencia con SHA-256 y verificar integridad', async () => {
    await page.click('button[role=tab]:has-text("Evidencias")');
    await page.click('button:has-text("Cargar evidencia")');
    const file = path.join(os.tmpdir(), 'evidencia-e2e.txt');
    fs.writeFileSync(file, 'Contenido de evidencia E2E ' + Date.now());
    await page.setInputFiles('.modal input[type=file]', file);
    await page.waitForSelector('.modal >> text=/SHA-256 \\(navegador\\): [0-9a-f]{64}/');
    await page.click('.modal button:has-text("Incorporar evidencia")');
    await page.waitForSelector('text=/verificado en navegador y servidor/', { timeout: 8000 });
    await page.click('td:has-text("evidencia-e2e")');
    await page.waitForSelector('text=Cadena de custodia');
    await page.click('button:has-text("Verificar integridad")');
    await page.waitForSelector('text=El SHA-256 recalculado coincide');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Descargar")')]);
    expect(dl.suggestedFilename() === 'evidencia-e2e.txt', 'nombre de descarga');
    await page.screenshot({ path: path.join(shots, 'evidencia.png'), fullPage: true });
  });
  let caseUrl;
  await step('Generar informe PDF del expediente', async () => {
    await page.click('a:has-text("TI-")');
    caseUrl = page.url();
    await page.click('button:has-text("Generar informe")');
    await page.waitForSelector('.modal textarea');
    await page.fill('.modal .field:has-text("Conclusiones") textarea', 'Conclusión de la prueba E2E basada en hallazgos.');
    await page.click('.modal button:has-text("Generar PDF")');
    await page.waitForSelector('td:has-text("INF-")', { timeout: 15000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('tr:has-text("Expediente creado por prueba E2E") button:has-text("PDF")')]);
    const p = await dl.path();
    expect(fs.readFileSync(p).subarray(0, 5).toString() === '%PDF-', 'PDF inválido');
  });
  await step('Cambio de estado con motivo obligatorio', async () => {
    await page.goto(caseUrl);
    await page.selectOption('select[aria-label="Cambiar estado"]', 'cerrado');
    await page.fill('.modal textarea', 'Investigación concluida');
    await page.click('.modal button:has-text("Cambiar estado")');
    await page.waitForSelector('.page-head .badge:has-text("Cerrado")');
  });
  let consentUrl;
  await step('Generar enlace de ubicación con consentimiento', async () => {
    await page.goto(demo.url + '/geolocalizacion');
    await page.click('button:has-text("Nuevo enlace")');
    await page.fill('.modal .field:has-text("Destinatario") input', 'Persona E2E');
    await page.fill('.modal textarea', 'Confirmar que la persona se encuentra a salvo.');
    expect(await page.isDisabled('.modal button:has-text("Generar enlace")'), 'debe exigir confirmación legítima');
    await page.check('.modal input[type=checkbox]');
    await page.click('.modal button:has-text("Generar enlace")');
    await page.waitForSelector('.modal .hash');
    consentUrl = (await page.textContent('.modal .hash')).trim();
    expect(consentUrl.includes('/consentimiento/'), 'URL inválida');
    await page.click('.modal button:has-text("Listo")');
  });
  await step('Persona destinataria: rechaza permiso → no se envía nada', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await c2.newPage();
    await p2.goto(consentUrl);
    await p2.waitForSelector('text=comparte tu ubicación');
    expect(await p2.isDisabled('button:has-text("Aceptar y compartir")'), 'sin aceptar el botón debe estar deshabilitado');
    await p2.check('input[type=checkbox]');
    await p2.click('button:has-text("Aceptar y compartir")');
    await p2.waitForSelector('text=/no concedió el permiso|No fue posible determinar/', { timeout: 15000 });
    await c2.close();
  });
  await step('Persona destinataria: acepta y concede permiso → ubicación recibida', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 4.6534, longitude: -74.0836, accuracy: 30 } });
    const p2 = await c2.newPage();
    await p2.goto(consentUrl);
    await p2.check('input[type=checkbox]');
    await p2.click('button:has-text("Aceptar y compartir")');
    await p2.waitForSelector('text=Ubicación enviada', { timeout: 15000 });
    await p2.screenshot({ path: path.join(shots, 'consentimiento-movil.png'), fullPage: true });
    expect(await noHorizontalOverflow(p2), 'desbordamiento horizontal en móvil');
    // Analista ve la ubicación
    await page.goto(demo.url + '/geolocalizacion');
    await page.click('td:has-text("Persona E2E")');
    await page.waitForSelector('td:has-text("4.653400, -74.083600")');
    await page.waitForSelector('.leaflet-container');
    // La persona revoca y elimina
    p2.on('dialog', (d) => d.accept());
    await p2.click('button:has-text("Revocar y eliminar mis datos")');
    await p2.waitForSelector('text=/Se eliminaron 1 registro/');
    await page.reload();
    await page.waitForSelector('text=Sin ubicaciones');
    await c2.close();
  });
  await step('Roles: el consultor no ve opciones de modificación ni administración', async () => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p3 = await c3.newPage();
    await p3.goto(demo.url);
    await p3.fill('input[autocomplete=username]', 'consultor.demo');
    await p3.fill('input[type=password]', 'Demo2026consultor');
    await p3.click('button:has-text("Ingresar")');
    await p3.waitForSelector('text=Centro de operaciones');
    expect(!(await p3.isVisible('nav >> text=Usuarios y roles')), 'consultor ve administración');
    expect(!(await p3.isVisible('button:has-text("Nuevo expediente")')), 'consultor puede crear expedientes');
    await p3.goto(demo.url + '/usuarios');
    await p3.waitForSelector('text=Acceso restringido');
    await c3.close();
  });
  await step('Créditos: asignación manual', async () => {
    await page.goto(demo.url + '/creditos');
    await page.click('button:has-text("Asignar créditos")');
    await page.fill('.modal .field:has-text("Motivo") input', 'Asignación E2E');
    await page.click('.modal button:has-text("Aplicar")');
    await page.waitForSelector('text=Créditos actualizados');
  });
  await step('Diseño responsive sin desbordamiento (móvil, tableta, escritorio)', async () => {
    for (const [w, h, name] of [[390, 844, 'movil'], [820, 1180, 'tableta'], [1920, 1080, 'escritorio']]) {
      await page.setViewportSize({ width: w, height: h });
      for (const u of ['/', '/expedientes', '/analisis', '/evidencias', '/configuracion']) {
        await page.goto(demo.url + u);
        await page.waitForTimeout(700);
        expect(await noHorizontalOverflow(page), `desbordamiento en ${u} a ${w}px`);
      }
      await page.goto(demo.url + '/');
      await page.waitForSelector('.recharts-surface');
      await page.screenshot({ path: path.join(shots, `responsive-${name}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('button[aria-label="Abrir menú"]');
    await page.waitForSelector('.shell.nav-open');
    await page.click('nav >> text=Informes');
    await page.waitForSelector('h1:has-text("Informes")');
  });
  await step('Sin errores de JavaScript en consola', async () => expect(consoleErrors.length === 0, consoleErrors.join(' | ')));
  await browser.contexts().forEach((c) => c.close());
  demo.proc.kill();
  fs.rmSync(demo.dir, { recursive: true, force: true });

  // ===================== PRIVADO: primer arranque =====================
  const priv = await startServer('private', 18082);
  console.log('Entorno privado (instalación limpia):', priv.url);
  const pp = await (await browser.newContext()).newPage();
  await step('Instalación limpia: asistente de configuración inicial', async () => {
    await pp.goto(priv.url);
    await pp.waitForSelector('text=Configuración inicial');
    expect(!(await pp.isVisible('.demo-banner')), 'el entorno privado no debe mostrar banner demo');
    const inputs = pp.locator('form input');
    await inputs.nth(0).fill('Unidad Privada de Prueba');
    await inputs.nth(1).fill('Administradora Principal');
    await inputs.nth(2).fill('jefa');
    await inputs.nth(4).fill('ClavePrivada2026');
    await inputs.nth(5).fill('ClavePrivada2026');
    await pp.click('button:has-text("Crear administrador")');
    await pp.waitForSelector('text=Centro de operaciones', { timeout: 10000 });
    await pp.goto(priv.url + '/expedientes');
    await pp.waitForSelector('text=No hay expedientes');
  });
  priv.proc.kill();
  fs.rmSync(priv.dir, { recursive: true, force: true });
  await browser.close();

  fs.writeFileSync(path.join(shots, 'resultados.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed}/${results.length} pruebas E2E superadas.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
