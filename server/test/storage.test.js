import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createStorage } from '../src/lib/storage.js';
import { sha256 } from '../src/lib/crypto.js';
import { setupAdmin } from './helpers.js';

// Servidor S3/R2 simulado en memoria (recibe peticiones firmadas; valida que la firma existe).
function fakeR2() {
  const objects = new Map();
  const srv = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.replace(/^\//, ''));
    // Debe venir firmado por nuestro cliente.
    if (!req.headers.authorization || !req.headers.authorization.startsWith('AWS4-HMAC-SHA256')) { res.writeHead(403); return res.end('sin firma'); }
    if (!req.headers['x-amz-content-sha256'] || !req.headers['x-amz-date']) { res.writeHead(400); return res.end('faltan cabeceras'); }
    if (req.method === 'PUT') {
      const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => { objects.set(key, Buffer.concat(ch)); res.writeHead(200); res.end(); });
    } else if (req.method === 'GET') {
      const o = objects.get(key); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200); res.end(o);
    } else if (req.method === 'HEAD') {
      res.writeHead(objects.has(key) ? 200 : 404); res.end();
    } else if (req.method === 'DELETE') {
      objects.delete(key); res.writeHead(204); res.end();
    } else { res.writeHead(405); res.end(); }
  });
  return { srv, objects };
}

describe('Almacenamiento R2 (evidencias en la nube)', () => {
  let ctx, admin, r2, port, dir;
  const binaryParser = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
  before(async () => {
    r2 = fakeR2();
    await new Promise((r) => r2.srv.listen(0, '127.0.0.1', r));
    port = r2.srv.address().port;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-r2-'));
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, APP_MODE: 'private', MASTER_KEY: 'a'.repeat(64),
      STORAGE: 'r2', R2_ENDPOINT: `127.0.0.1:${port}`, R2_BUCKET: 'ti', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'secret', R2_REGION: 'auto', R2_ACCOUNT_ID: 'acc' });
    // El cliente R2 usa https; redirigimos a http para la prueba usando un endpoint http.
    config.r2.useHttp = true;
    ctx = createApp(config, { logger: { error() {} } });
    admin = await setupAdmin(ctx.app);
  });
  after(() => { r2.srv.close(); try { ctx.db.close(); } catch { /* ya cerrado */ } fs.rmSync(dir, { recursive: true, force: true }); });

  test('la evidencia se guarda en R2, no en disco local', async () => {
    const content = Buffer.from('Evidencia en la nube ' + Date.now());
    const r = await admin.post('/api/evidence').field('title', 'Prueba R2').field('origin', 'documento').attach('file', content, 'nube.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.sha256, sha256(content));
    // No quedó en el disco local
    assert.equal(fs.existsSync(path.join(dir, 'evidencias')) && fs.readdirSync(path.join(dir, 'evidencias')).length > 0, false);
    // Sí está en el R2 simulado (cifrada)
    assert.equal(r2.objects.size >= 1, true);
    const stored = [...r2.objects.values()][0];
    assert.equal(stored.includes(content), false, 'en R2 se guarda cifrada, no en claro');
  });
  test('descarga y verificación de integridad desde R2', async () => {
    const content = Buffer.from('Contenido verificable R2');
    const up = await admin.post('/api/evidence').field('title', 'Verificar R2').field('origin', 'otro').attach('file', content, 'v.txt');
    const v = await admin.post(`/api/evidence/${up.body.id}/verify`);
    assert.equal(v.body.ok, true);
    const dl = await admin.get(`/api/evidence/${up.body.id}/download`).buffer(true).parse(binaryParser);
    assert.equal(dl.status, 200);
    assert.equal(sha256(dl.body), sha256(content));
  });
  test('eliminación borra el objeto en R2', async () => {
    const content = Buffer.from('Para borrar en R2');
    const up = await admin.post('/api/evidence').field('title', 'Borrar R2').field('origin', 'otro').attach('file', content, 'b.txt');
    const before = r2.objects.size;
    const del = await admin.del(`/api/evidence/${up.body.id}`).send({ reason: 'Prueba de borrado en la nube' });
    assert.equal(del.status, 200);
    assert.equal(r2.objects.size, before - 1);
  });
});
