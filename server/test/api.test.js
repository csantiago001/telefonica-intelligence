import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import request from 'supertest';
import { makeApp, setupAdmin, login, ADMIN } from './helpers.js';
import { totp } from '../src/lib/totp.js';
import { decryptString, sha256 } from '../src/lib/crypto.js';
import { readBackup } from '../src/lib/backup.js';
import { seedDemo } from '../src/db/seed-demo.js';

let ctx, admin;
before(async () => { ctx = makeApp(); admin = await setupAdmin(ctx.app); });
after(() => ctx.cleanup());

const binaryParser = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('Instalación, salud y cabeceras de seguridad', () => {
  test('health y conexión a la base de datos', async () => {
    const r = await request(ctx.app).get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });
  test('cabeceras de seguridad (CSP, nosniff, frame-ancestors, sin x-powered-by)', async () => {
    const r = await request(ctx.app).get('/api/health');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  test('la configuración inicial solo se permite una vez', async () => {
    const r = await request(ctx.app).post('/api/auth/setup').send({ ...ADMIN, username: 'otro' });
    assert.equal(r.status, 409);
    const s = await request(ctx.app).get('/api/auth/status');
    assert.equal(s.body.setupRequired, false);
  });
  test('JSON mal formado devuelve 400', async () => {
    const r = await request(ctx.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{malo');
    assert.equal(r.status, 400);
  });
});

describe('Autenticación y sesiones', () => {
  test('rechaza endpoints protegidos sin sesión', async () => {
    for (const u of ['/api/dashboard', '/api/cases', '/api/evidence', '/api/admin/users']) assert.equal((await request(ctx.app).get(u)).status, 401, u);
  });
  test('rechaza credenciales incorrectas con mensaje genérico', async () => {
    const r = await request(ctx.app).post('/api/auth/login').send({ username: 'admin', password: 'mala' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Usuario o contraseña incorrectos.');
    const r2 = await request(ctx.app).post('/api/auth/login').send({ username: 'noexiste', password: 'mala' });
    assert.equal(r2.body.error, r.body.error);
  });
  test('la cookie de sesión es httpOnly y SameSite=Strict', async () => {
    const r = await request(ctx.app).post('/api/auth/login').send({ username: ADMIN.username, password: ADMIN.password });
    const c = r.headers['set-cookie'].find((x) => x.startsWith('ti_session='));
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
  });
  test('protección CSRF: sin token se rechaza la modificación', async () => {
    const r = await admin.agent.post('/api/cases').send({ title: 'x', classification: 'general', priority: 'media' });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /CSRF/);
  });
  test('bloqueo tras intentos fallidos', async () => {
    await admin.post('/api/admin/users').send({ username: 'victima', fullName: 'Usuario Bloqueo', roleId: 2, password: 'ClaveSegura2026', mustChangePassword: false });
    for (let i = 0; i < 5; i++) await request(ctx.app).post('/api/auth/login').send({ username: 'victima', password: 'incorrecta' + i });
    const r = await request(ctx.app).post('/api/auth/login').send({ username: 'victima', password: 'ClaveSegura2026' });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /bloqueada/);
  });
  test('política de contraseñas', async () => {
    const r = await admin.post('/api/admin/users').send({ username: 'debil', fullName: 'Débil', roleId: 2, password: 'corta' });
    assert.equal(r.status, 400);
    const r2 = await admin.post('/api/admin/users').send({ username: 'debil', fullName: 'Débil', roleId: 2, password: 'soloLetrasLargas' });
    assert.equal(r2.status, 400);
  });
  test('2FA TOTP completo: configuración, activación, inicio de sesión y código de recuperación', async () => {
    await admin.post('/api/admin/users').send({ username: 'dosfa', fullName: 'Usuario 2FA', roleId: 2, password: 'ClaveSegura2026', mustChangePassword: false });
    const u = await login(ctx.app, 'dosfa', 'ClaveSegura2026');
    const s = await u.post('/api/auth/2fa/setup');
    assert.equal(s.status, 200);
    assert.match(s.body.qr, /^data:image\/png;base64,/);
    const stored = ctx.db.get("SELECT totp_secret_enc FROM users WHERE username = 'dosfa'").totp_secret_enc;
    assert.notEqual(stored, s.body.secret, 'el secreto se guarda cifrado');
    assert.equal(decryptString(ctx.config.masterKey, stored), s.body.secret);
    assert.equal((await u.post('/api/auth/2fa/enable').send({ code: '000000' })).status, 400);
    const en = await u.post('/api/auth/2fa/enable').send({ code: totp(s.body.secret) });
    assert.equal(en.status, 200);
    assert.equal(en.body.recoveryCodes.length, 8);
    // Nuevo inicio de sesión exige el segundo factor
    const a2 = request.agent(ctx.app);
    const l = await a2.post('/api/auth/login').send({ username: 'dosfa', password: 'ClaveSegura2026' });
    assert.equal(l.body.pending2fa, true);
    assert.equal((await a2.get('/api/dashboard')).status, 401);
    assert.equal((await a2.post('/api/auth/2fa/verify').set('X-CSRF-Token', l.body.csrf).send({ code: '123456' })).status, 401);
    const v = await a2.post('/api/auth/2fa/verify').set('X-CSRF-Token', l.body.csrf).send({ code: totp(s.body.secret) });
    assert.equal(v.status, 200);
    assert.equal((await a2.get('/api/dashboard')).status, 200);
    // Código de recuperación de un solo uso
    const a3 = request.agent(ctx.app);
    const l3 = await a3.post('/api/auth/login').send({ username: 'dosfa', password: 'ClaveSegura2026' });
    assert.equal((await a3.post('/api/auth/2fa/verify').set('X-CSRF-Token', l3.body.csrf).send({ code: en.body.recoveryCodes[0] })).status, 200);
    const a4 = request.agent(ctx.app);
    const l4 = await a4.post('/api/auth/login').send({ username: 'dosfa', password: 'ClaveSegura2026' });
    assert.equal((await a4.post('/api/auth/2fa/verify').set('X-CSRF-Token', l4.body.csrf).send({ code: en.body.recoveryCodes[0] })).status, 401);
  });
  test('recuperación de acceso con enlace de un solo uso', async () => {
    await admin.post('/api/admin/users').send({ username: 'olvido', fullName: 'Olvidadizo', roleId: 2, password: 'ClaveSegura2026', mustChangePassword: false });
    const uid = ctx.db.get("SELECT id FROM users WHERE username = 'olvido'").id;
    const link = await admin.post(`/api/admin/users/${uid}/reset-link`);
    const token = link.body.path.split('/').pop();
    assert.equal((await request(ctx.app).get(`/api/auth/reset/${token}`)).body.username, 'olvido');
    assert.equal((await request(ctx.app).post(`/api/auth/reset/${token}`).send({ password: 'NuevaClave2026' })).status, 200);
    assert.equal((await request(ctx.app).post(`/api/auth/reset/${token}`).send({ password: 'OtraClave2026' })).status, 404, 'no reutilizable');
    await login(ctx.app, 'olvido', 'NuevaClave2026');
  });
  test('cambio de contraseña y cierre de sesión', async () => {
    await admin.post('/api/admin/users').send({ username: 'cambia', fullName: 'Cambia Clave', roleId: 2, password: 'ClaveSegura2026', mustChangePassword: true });
    const u = await login(ctx.app, 'cambia', 'ClaveSegura2026');
    assert.equal(u.body.user.mustChangePassword, true);
    assert.equal((await u.post('/api/auth/password').send({ current: 'mala', next: 'NuevaClave2026' })).status, 400);
    assert.equal((await u.post('/api/auth/password').send({ current: 'ClaveSegura2026', next: 'NuevaClave2026' })).status, 200);
    assert.equal((await u.get('/api/auth/me')).body.mustChangePassword, false);
    assert.equal((await u.post('/api/auth/logout')).status, 200);
    assert.equal((await u.get('/api/auth/me')).status, 401);
  });
});

describe('Roles y permisos', () => {
  let viewer, analyst;
  before(async () => {
    const roles = (await admin.get('/api/admin/roles/options')).body;
    const rid = (k) => roles.find((r) => r.key === k).id;
    await admin.post('/api/admin/users').send({ username: 'lector', fullName: 'Solo Lectura', roleId: rid('consultor'), password: 'ClaveSegura2026', mustChangePassword: false });
    await admin.post('/api/admin/users').send({ username: 'analista', fullName: 'Analista Uno', roleId: rid('analista'), password: 'ClaveSegura2026', mustChangePassword: false });
    viewer = await login(ctx.app, 'lector', 'ClaveSegura2026');
    analyst = await login(ctx.app, 'analista', 'ClaveSegura2026');
  });
  test('el consultor puede leer pero no modificar', async () => {
    assert.equal((await viewer.get('/api/cases')).status, 200);
    assert.equal((await viewer.post('/api/cases').send({ title: 'Prueba', classification: 'general', priority: 'media' })).status, 403);
    assert.equal((await viewer.post('/api/phone/analyze').send({ numbers: ['3001234567'] })).status, 403);
    assert.equal((await viewer.post('/api/osint/run').send({ tool: 'dns', target: 'example.com' })).status, 403);
    assert.equal((await viewer.post('/api/geo/links').send({})).status, 403);
  });
  test('el analista no accede a administración', async () => {
    assert.equal((await analyst.get('/api/admin/users')).status, 403);
    assert.equal((await analyst.get('/api/settings')).status, 403);
    assert.equal((await analyst.get('/api/audit')).status, 403);
    assert.equal((await analyst.post('/api/admin/credits/adjust').send({ userId: 1, amount: 99, note: 'autoasignación' })).status, 403);
    assert.equal((await analyst.post('/api/cases').send({ title: 'Del analista', classification: 'fraude', priority: 'alta' })).status, 201);
  });
  test('rol personalizado y protección del rol administrador', async () => {
    const r = await admin.post('/api/admin/roles').send({ name: 'Auditor externo', description: 'Solo auditoría', permissions: ['admin.audit'] });
    assert.equal(r.status, 201);
    assert.equal((await admin.post('/api/admin/roles').send({ name: 'Malo', permissions: ['inventado'] })).status, 400);
    const adminRole = (await admin.get('/api/admin/roles')).body.roles.find((x) => x.key === 'admin');
    assert.equal((await admin.put(`/api/admin/roles/${adminRole.id}`).send({ name: 'X', permissions: [] })).status, 400);
    assert.equal((await admin.del(`/api/admin/roles/${r.body.id}`)).status, 200);
  });
  test('no se puede desactivar al último administrador ni a uno mismo', async () => {
    const me = (await admin.get('/api/auth/me')).body;
    const roles = (await admin.get('/api/admin/roles/options')).body;
    const r = await admin.put(`/api/admin/users/${me.id}`).send({ fullName: me.fullName, roleId: roles.find((x) => x.key === 'admin').id, active: false });
    assert.equal(r.status, 400);
  });
});

describe('Análisis telefónico y créditos', () => {
  test('analiza, descuenta créditos y registra historial', async () => {
    const before = (await admin.get('/api/auth/me')).body.credits;
    const r = await admin.post('/api/phone/analyze').send({ numbers: ['300 123 4567', '+34 612 345 678', '12'], defaultCountry: 'CO' });
    assert.equal(r.status, 200);
    assert.equal(r.body.results.length, 3);
    assert.equal(r.body.results[0].e164, '+573001234567');
    assert.equal(r.body.results[2].valid, false);
    assert.equal(r.body.balance, before - 3);
    const h = await admin.get('/api/phone/history?q=573001234567');
    assert.ok(h.body.total >= 1);
    const csv = await admin.get('/api/phone/history?format=csv');
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /E\.164/);
  });
  test('valida entradas del lote', async () => {
    assert.equal((await admin.post('/api/phone/analyze').send({ numbers: [] })).status, 400);
    assert.equal((await admin.post('/api/phone/analyze').send({ numbers: Array(51).fill('3001234567') })).status, 400);
  });
  test('créditos insuficientes bloquean la operación (402)', async () => {
    await admin.post('/api/admin/users').send({ username: 'pobre', fullName: 'Sin Saldo', roleId: 2, password: 'ClaveSegura2026', mustChangePassword: false });
    const uid = ctx.db.get("SELECT id FROM users WHERE username = 'pobre'").id;
    const bal = ctx.db.get('SELECT credits FROM users WHERE id = ?', uid).credits;
    assert.equal((await admin.post('/api/admin/credits/adjust').send({ userId: uid, amount: -bal, note: 'Dejar en cero' })).status, 200);
    const u = await login(ctx.app, 'pobre', 'ClaveSegura2026');
    const r = await u.post('/api/phone/analyze').send({ numbers: ['3001234567'] });
    assert.equal(r.status, 402);
    assert.equal((await admin.post('/api/admin/credits/adjust').send({ userId: uid, amount: -1, note: 'Negativo' })).status, 400);
    await admin.post('/api/admin/credits/adjust').send({ userId: uid, amount: 5, note: 'Recarga de prueba' });
    assert.equal((await u.post('/api/phone/analyze').send({ numbers: ['3001234567'] })).status, 200);
    const tx = await u.get('/api/admin/credits/transactions');
    assert.ok(tx.body.items.some((t) => t.kind === 'consumo' && t.amount === -1));
    assert.ok(tx.body.items.every((t) => t.username === 'pobre'), 'un usuario solo ve sus movimientos');
  });
  test('configuración de costos', async () => {
    const r = await admin.put('/api/admin/credits/costs').send({ costs: { phone_analysis: 2 }, enforce: true, defaultNewUser: 50 });
    assert.equal(r.status, 200);
    const s = await admin.get('/api/admin/credits/summary');
    assert.equal(s.body.costs.phone_analysis, 2);
    await admin.put('/api/admin/credits/costs').send({ costs: { phone_analysis: 1 }, enforce: true, defaultNewUser: 100 });
  });
});

describe('OSINT (fuentes reales, sin simulación)', () => {
  test('objetivo inválido se rechaza antes de consultar', async () => {
    assert.equal((await admin.post('/api/osint/run').send({ tool: 'dns', target: 'no válido' })).status, 400);
    assert.equal((await admin.post('/api/osint/run').send({ tool: 'inexistente', target: 'x' })).status, 400);
  });
  test('protección SSRF: no consulta direcciones internas', async () => {
    const r = await admin.post('/api/osint/run').send({ tool: 'link', target: 'http://127.0.0.1:1/admin' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'fallido');
    assert.match(r.body.error, /bloqueado|interna/i);
    assert.equal(r.body.creditsUsed, 0, 'consultas fallidas no consumen créditos');
    const r2 = await admin.post('/api/osint/run').send({ tool: 'link', target: 'http://169.254.169.254/latest/meta-data' });
    assert.equal(r2.body.status, 'fallido');
  });
  test('si la fuente no responde, el resultado es "fallido" y nunca "éxito"', async () => {
    // En entornos sin Internet la consulta debe fallar honestamente; con Internet debe traer datos reales.
    const r = await admin.post('/api/osint/run').send({ tool: 'rdap', target: 'example.com' });
    assert.equal(r.status, 200);
    if (r.body.status === 'fallido') {
      assert.ok(r.body.error);
      assert.equal(r.body.data, null);
      assert.equal(r.body.suggestedFindings.length, 0);
    } else {
      assert.ok(r.body.data.domain);
    }
    const h = await admin.get(`/api/osint/history/${r.body.id}`);
    assert.equal(h.body.status, r.body.status);
  });
  test('fuente desactivada por configuración', async () => {
    await admin.put('/api/settings').send({ 'osint.sources': { dns: true, rdap: true, ct: false, wayback: true, link: true, search: true, ip: true } });
    assert.equal((await admin.post('/api/osint/run').send({ tool: 'ct', target: 'example.com' })).status, 400);
    await admin.put('/api/settings').send({ 'osint.sources': { dns: true, rdap: true, ct: true, wayback: true, link: true, search: true, ip: true } });
  });
  test('verificador de enlaces obtiene metadatos reales de un servidor (red local permitida solo en prueba)', async () => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/redir') { res.writeHead(301, { Location: '/pagina' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', Server: 'PruebaSrv' });
      res.end('<html><head><title>Página de prueba</title><meta name="description" content="Descripción pública"><meta name="generator" content="Hugo 0.1"></head><body><a href="/x">x</a></body></html>');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const local = makeApp({ ALLOW_PRIVATE_FETCH: 'true' });
    try {
      const a = await setupAdmin(local.app);
      const r = await a.post('/api/osint/run').send({ tool: 'link', target: `http://127.0.0.1:${srv.address().port}/redir` });
      assert.equal(r.body.status, 'exito');
      assert.equal(r.body.data.html.title, 'Página de prueba');
      assert.equal(r.body.data.redirects.length, 2);
      assert.equal(r.body.data.server, 'PruebaSrv');
      assert.equal(r.body.data.securityHeaders['x-frame-options'], true);
      assert.ok(r.body.suggestedFindings.some((f) => /Hugo/.test(f.title)));
      assert.ok(r.body.creditsUsed > 0);
    } finally { srv.close(); local.cleanup(); }
  });
  test('hallazgos: fuente y confiabilidad obligatorias', async () => {
    assert.equal((await admin.post('/api/findings').send({ title: 'Sin fuente', reliability: 'confirmado' })).status, 400);
    assert.equal((await admin.post('/api/findings').send({ title: 'Mal nivel', sourceName: 'X', reliability: 'seguro' })).status, 400);
    const r = await admin.post('/api/findings').send({ title: 'Hallazgo válido', sourceName: 'Registro público', sourceUrl: 'https://example.com', reliability: 'probable' });
    assert.equal(r.status, 201);
    assert.equal((await admin.put(`/api/findings/${r.body.id}`).send({ title: 'Hallazgo válido', sourceName: 'Registro público', reliability: 'confirmado' })).status, 200);
    const l = await admin.get('/api/findings?reliability=confirmado');
    assert.ok(l.body.items.some((f) => f.id === r.body.id));
    assert.equal((await admin.del(`/api/findings/${r.body.id}`)).status, 200);
  });
});

describe('Expedientes, evidencias e informes', () => {
  let caseId, caseCode, evId;
  test('crear expediente con código único', async () => {
    const r = await admin.post('/api/cases').send({ title: 'Caso de prueba', classification: 'fraude', priority: 'alta', objective: 'Objetivo de prueba', tags: ['sms'] });
    assert.equal(r.status, 201);
    assert.match(r.body.code, /^TI-\d{4}-\d{4}$/);
    caseId = r.body.id; caseCode = r.body.code;
    const r2 = await admin.post('/api/cases').send({ title: 'Otro caso', classification: 'general', priority: 'baja' });
    assert.notEqual(r2.body.code, caseCode);
  });
  test('entidades, teléfonos y observaciones', async () => {
    const e = await admin.post(`/api/cases/${caseId}/entities`).send({ kind: 'persona', name: 'Persona Ficticia', role: 'Víctima' });
    assert.equal(e.status, 201);
    const p = await admin.post(`/api/cases/${caseId}/phones`).send({ number: '+57 300 123 4567', entityId: e.body.id });
    assert.equal(p.body.e164, '+573001234567');
    assert.equal((await admin.post(`/api/cases/${caseId}/phones`).send({ number: '3001234567' })).status, 409, 'sin duplicados');
    assert.equal((await admin.post(`/api/cases/${caseId}/notes`).send({ body: 'Observación de prueba' })).status, 201);
    await admin.post('/api/phone/analyze').send({ numbers: ['6013456789'], caseId, attachToCase: true });
    const c = (await admin.get(`/api/cases/${caseId}`)).body;
    assert.equal(c.entities.length, 1);
    assert.equal(c.phones.length, 2);
    assert.equal(c.notes.length, 1);
    assert.equal(c.phoneQueries.length, 1);
    assert.ok(c.events.length >= 5, 'historial registra cada acción');
  });
  test('búsqueda y filtros', async () => {
    assert.ok((await admin.get('/api/cases?q=573001234567')).body.items.some((c) => c.id === caseId), 'busca por número');
    assert.ok((await admin.get('/api/cases?q=Ficticia')).body.items.some((c) => c.id === caseId), 'busca por entidad');
    assert.ok((await admin.get('/api/cases?status=activos&priority=alta')).body.items.some((c) => c.id === caseId));
    assert.equal((await admin.get('/api/cases?status=cerrado')).body.items.some((c) => c.id === caseId), false);
    const g = await admin.get('/api/search?q=' + caseCode);
    assert.equal(g.body.cases[0].id, caseId);
  });
  test('evidencia: SHA-256 correcto y cifrada en disco', async () => {
    const content = Buffer.from('Contenido de evidencia de prueba — ' + Date.now());
    const r = await admin.post('/api/evidence').field('caseId', String(caseId)).field('title', 'Captura de prueba').field('origin', 'documento').field('sourceDetail', 'Aportada por la víctima').attach('file', content, 'captura.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.sha256, sha256(content));
    evId = r.body.id;
    const row = ctx.db.get('SELECT storage_name FROM evidence WHERE id = ?', evId);
    const disk = fs.readFileSync(path.join(ctx.config.evidenceDir, row.storage_name));
    assert.equal(disk.includes(content), false, 'el archivo en disco no contiene el texto plano');
    const dup = await admin.post('/api/evidence').field('caseId', String(caseId)).field('title', 'Duplicada').field('origin', 'documento').attach('file', content, 'copia.txt');
    assert.equal(dup.status, 409);
    const tmp = fs.readdirSync(path.join(ctx.config.dataDir, 'tmp'));
    assert.equal(tmp.length, 0, 'no quedan temporales en claro');
  });
  test('evidencia: verificación, descarga con hash y cadena de custodia', async () => {
    const v = await admin.post(`/api/evidence/${evId}/verify`);
    assert.equal(v.body.ok, true);
    const d = await admin.get(`/api/evidence/${evId}/download`).buffer(true).parse(binaryParser);
    assert.equal(d.status, 200);
    assert.equal(sha256(d.body), d.headers['x-content-sha256']);
    const e = (await admin.get(`/api/evidence/${evId}`)).body;
    assert.deepEqual(e.custody.map((c) => c.action), ['incorporacion', 'verificacion_integridad', 'descarga']);
    assert.equal(e.storage_name, undefined, 'no expone la ruta interna');
    const inv = await admin.get(`/api/evidence?caseId=${caseId}&format=csv`);
    assert.match(inv.text, /SHA-256/);
  });
  test('evidencia: detecta manipulación del archivo y bloquea la descarga', async () => {
    const content = Buffer.from('Evidencia para manipular');
    const r = await admin.post('/api/evidence').field('title', 'Manipulable').field('origin', 'otro').attach('file', content, 'm.txt');
    const row = ctx.db.get('SELECT storage_name FROM evidence WHERE id = ?', r.body.id);
    const f = path.join(ctx.config.evidenceDir, row.storage_name);
    const buf = fs.readFileSync(f); buf[buf.length - 2] ^= 0xff; fs.writeFileSync(f, buf);
    const v = await admin.post(`/api/evidence/${r.body.id}/verify`);
    assert.equal(v.body.ok, false);
    assert.equal((await admin.get(`/api/evidence/${r.body.id}/download`)).status, 500);
    assert.ok(ctx.db.get("SELECT COUNT(*) n FROM alerts WHERE title LIKE 'Integridad comprometida%'").n >= 1);
    // Eliminación segura con motivo
    assert.equal((await admin.del(`/api/evidence/${r.body.id}`).send({ reason: 'x' })).status, 400);
    assert.equal((await admin.del(`/api/evidence/${r.body.id}`).send({ reason: 'Archivo alterado, se elimina' })).status, 200);
    assert.equal(fs.existsSync(f), false);
    const e = (await admin.get(`/api/evidence/${r.body.id}`)).body;
    assert.ok(e.deleted_at);
    assert.equal(e.sha256, sha256(content), 'el registro y el hash se conservan');
  });
  test('informe PDF con todas las secciones e integridad', async () => {
    const def = await admin.get(`/api/reports/defaults/${caseId}`);
    assert.equal(def.body.counts.evidence, 1);
    const r = await admin.post('/api/reports').send({ caseId, title: 'Informe de prueba', summary: def.body.summary, objective: 'Objetivo de prueba', limitations: def.body.limitations, conclusions: 'Conclusión de la prueba automatizada.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pdf = await admin.get(`/api/reports/${r.body.id}/pdf`).buffer(true).parse(binaryParser);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256(pdf.body), r.body.sha256);
    assert.ok(pdf.body.length > 5000);
    assert.equal((await admin.post('/api/reports').send({ caseId, title: 'Incompleto', summary: 'corto' })).status, 400);
  });
  test('cambio de estado con motivo; archivado bloquea edición', async () => {
    assert.equal((await admin.post(`/api/cases/${caseId}/status`).send({ status: 'archivado' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${caseId}/status`).send({ status: 'archivado', reason: 'Fin de la investigación' })).status, 200);
    const c = (await admin.get(`/api/cases/${caseId}`)).body;
    assert.ok(c.closed_at);
    assert.equal((await admin.post(`/api/cases/${caseId}/notes`).send({ body: 'No debería' })).status, 400);
    assert.equal((await admin.post(`/api/cases/${caseId}/status`).send({ status: 'en_curso', reason: 'Reapertura' })).status, 200);
  });
  test('eliminar expediente exige el código y borra archivos', async () => {
    assert.equal((await admin.del(`/api/cases/${caseId}`).send({ confirmCode: 'TI-0000' })).status, 400);
    const files = ctx.db.all('SELECT storage_name FROM evidence WHERE case_id = ? AND deleted_at IS NULL', caseId);
    assert.equal((await admin.del(`/api/cases/${caseId}`).send({ confirmCode: caseCode })).status, 200);
    for (const f of files) assert.equal(fs.existsSync(path.join(ctx.config.evidenceDir, f.storage_name)), false);
    assert.equal((await admin.get(`/api/cases/${caseId}`)).status, 404);
  });
});

describe('Geolocalización con consentimiento', () => {
  let link, token;
  test('crear enlace exige finalidad y confirmación legítima', async () => {
    assert.equal((await admin.post('/api/geo/links').send({ recipientLabel: 'Ana', purpose: 'corta', expiresHours: 24, legalBasis: true })).status, 400);
    assert.equal((await admin.post('/api/geo/links').send({ recipientLabel: 'Ana', purpose: 'Confirmar que está a salvo', expiresHours: 24, legalBasis: false })).status, 400);
    const r = await admin.post('/api/geo/links').send({ recipientLabel: 'Ana (prueba)', purpose: 'Confirmar que está a salvo', expiresHours: 24, legalBasis: true });
    assert.equal(r.status, 201);
    link = r.body; token = r.body.path.split('/').pop();
    const stored = ctx.db.get('SELECT token_hash FROM geo_links WHERE id = ?', link.id).token_hash;
    assert.equal(stored, sha256(token), 'solo se guarda el hash del token');
  });
  test('página pública muestra consentimiento sin datos internos', async () => {
    const r = await request(ctx.app).get(`/api/public/consent/${token}`);
    assert.equal(r.body.status, 'pendiente');
    assert.match(r.body.consentText, /revocar/i);
    assert.equal(r.body.token_hash, undefined);
    assert.equal((await request(ctx.app).get('/api/public/consent/tokeninventado1234567890')).status, 404);
  });
  test('sin aceptación expresa no se guarda ubicación', async () => {
    const r = await request(ctx.app).post(`/api/public/consent/${token}/accept`).send({ latitude: 4.6, longitude: -74.08 });
    assert.equal(r.status, 400);
    const bad = await request(ctx.app).post(`/api/public/consent/${token}/accept`).send({ accepted: true, latitude: 200, longitude: 0 });
    assert.equal(bad.status, 400);
    assert.equal(ctx.db.get('SELECT COUNT(*) n FROM geo_locations WHERE link_id = ?', link.id).n, 0);
  });
  test('aceptación registra consentimiento y coordenadas', async () => {
    const r = await request(ctx.app).post(`/api/public/consent/${token}/accept`).send({ accepted: true, latitude: 4.60971, longitude: -74.08175, accuracy: 25, capturedAt: Date.now() });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'activo');
    const d = (await admin.get(`/api/geo/links/${link.id}`)).body;
    assert.equal(d.locations.length, 1);
    assert.ok(d.consent_at);
    assert.match(d.consent_text, /Finalidad declarada: Confirmar que está a salvo/);
    assert.equal(d.consent_ip_hash.length, 32, 'IP almacenada como huella, no en claro');
  });
  test('la persona revoca y elimina sus datos; ya no puede enviarse ubicación', async () => {
    const r = await request(ctx.app).post(`/api/public/consent/${token}/revoke`).send({ deleteData: true });
    assert.equal(r.body.deleted, 1);
    assert.equal(r.body.status, 'revocado');
    assert.equal(ctx.db.get('SELECT COUNT(*) n FROM geo_locations WHERE link_id = ?', link.id).n, 0);
    assert.equal((await request(ctx.app).post(`/api/public/consent/${token}/accept`).send({ accepted: true, latitude: 1, longitude: 1 })).status, 410);
  });
  test('enlace vencido no acepta datos', async () => {
    const r = await admin.post('/api/geo/links').send({ recipientLabel: 'Vencido', purpose: 'Prueba de vencimiento', expiresHours: 1, legalBasis: true });
    ctx.db.run('UPDATE geo_links SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), r.body.id);
    const t = r.body.path.split('/').pop();
    assert.equal((await request(ctx.app).get(`/api/public/consent/${t}`)).body.status, 'expirado');
    assert.equal((await request(ctx.app).post(`/api/public/consent/${t}/accept`).send({ accepted: true, latitude: 1, longitude: 1 })).status, 410);
  });
  test('revocación por el analista', async () => {
    const r = await admin.post('/api/geo/links').send({ recipientLabel: 'Revocar', purpose: 'Prueba de revocación', expiresHours: 2, legalBasis: true });
    assert.equal((await admin.post(`/api/geo/links/${r.body.id}/revoke`)).status, 200);
    const t = r.body.path.split('/').pop();
    assert.equal((await request(ctx.app).post(`/api/public/consent/${t}/accept`).send({ accepted: true, latitude: 1, longitude: 1 })).status, 410);
  });
});

describe('Configuración, auditoría, retención y copias', () => {
  test('parámetros validados', async () => {
    assert.equal((await admin.put('/api/settings').send({ 'system.session_hours': 999 })).status, 400);
    assert.equal((await admin.put('/api/settings').send({ 'parametro.inventado': 1 })).status, 400);
    assert.equal((await admin.put('/api/settings').send({ 'retention.audit_days': 10 })).status, 400);
    assert.equal((await admin.put('/api/settings').send({ 'system.organization': 'Unidad Renombrada', 'retention.geo_days': 15 })).status, 200);
    const s = await admin.get('/api/settings');
    assert.equal(s.body.settings['system.organization'], 'Unidad Renombrada');
    assert.equal(s.body.settings['retention.geo_days'], 15);
  });
  test('auditoría registra operaciones y exporta CSV', async () => {
    const a = await admin.get('/api/audit?action=case.');
    assert.ok(a.body.items.some((x) => x.action === 'case.created'));
    assert.ok((await admin.get('/api/audit?q=login_failed')).body.total >= 1);
    const csv = await admin.get('/api/audit?format=csv');
    assert.match(csv.text, /Acción/);
  });
  test('retención: vista previa y purga', async () => {
    ctx.db.run("INSERT INTO phone_queries (input, valid, result, created_at) VALUES ('viejo', 0, '{}', '2000-01-01T00:00:00Z')");
    const p = await admin.get('/api/retention/preview');
    assert.ok(p.body.phone_queries >= 1);
    await admin.post('/api/retention/run');
    assert.equal(ctx.db.get("SELECT COUNT(*) n FROM phone_queries WHERE input = 'viejo'").n, 0);
  });
  test('copia de seguridad cifrada, verificable y restaurable', async () => {
    const b = await admin.post('/api/backups');
    assert.equal(b.status, 201);
    const file = path.join(ctx.config.backupDir, b.body.name);
    const raw = fs.readFileSync(file);
    assert.equal(raw.subarray(0, 6).toString(), 'TIBAK1');
    assert.equal(raw.includes(Buffer.from('SQLite format')), false, 'la base no queda en claro');
    assert.equal((await admin.post(`/api/backups/${b.body.name}/verify`)).body.ok, true);
    const { manifest, entries } = readBackup(file, ctx.config.masterKey);
    assert.ok(entries.find((e) => e.name === 'ti.db').data.subarray(0, 15).toString().startsWith('SQLite format'));
    assert.ok(manifest.files.length >= 2);
    assert.throws(() => readBackup(file, Buffer.alloc(32, 1)), /descifrar/);
    assert.equal((await admin.get('/api/backups/..%2F..%2Fetc%2Fpasswd/download')).status, 400, 'impide recorrido de rutas');
  });
  test('dashboard con indicadores', async () => {
    const d = await admin.get('/api/dashboard');
    assert.equal(d.status, 200);
    assert.equal(d.body.activity.length, 30);
    assert.ok(d.body.kpis.queriesTotal > 0);
  });
});

describe('Entorno de demostración', () => {
  test('carga solo datos ficticios marcados', async () => {
    const demo = makeApp({ APP_MODE: 'demo' });
    try {
      const r = await seedDemo(demo.db, demo.config);
      assert.ok(r.cases >= 5);
      assert.equal(demo.db.get('SELECT COUNT(*) n FROM cases WHERE is_demo = 0').n, 0);
      assert.equal(demo.db.get('SELECT COUNT(*) n FROM users WHERE is_demo = 0').n, 0);
      const s = await request(demo.app).get('/api/auth/status');
      assert.equal(s.body.mode, 'demo');
      assert.equal(s.body.setupRequired, false);
      const a = await login(demo.app, 'analista.demo', 'Demo2026analista');
      const ev = (await a.get('/api/evidence')).body.items[0];
      assert.equal((await a.post(`/api/evidence/${ev.id}/verify`)).body.ok, true, 'evidencias demo verificables');
      assert.equal((await a.post('/api/backups')).status, 403);
    } finally { demo.cleanup(); }
  });
});
