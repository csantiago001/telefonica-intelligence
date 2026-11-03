import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

export const ADMIN = { organization: 'Unidad de Prueba', fullName: 'Admin Prueba', username: 'admin', email: 'admin@example.com', password: 'ClaveSegura2026' };

export function makeApp(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-test-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dir, APP_MODE: 'private', MASTER_KEY: 'a'.repeat(64), ...extra });
  const { app, db } = createApp(config, { logger: { error: () => {} } });
  return { app, db, config, dir, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** Agente autenticado que añade el token CSRF a las solicitudes que modifican datos. */
export async function login(app, username, password) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  const csrf = r.body.csrf;
  const wrap = (m) => (url) => agent[m](url).set('X-CSRF-Token', csrf);
  return { agent, csrf, body: r.body, get: (u) => agent.get(u), post: wrap('post'), put: wrap('put'), del: wrap('delete') };
}

export async function setupAdmin(app) {
  const r = await request(app).post('/api/auth/setup').send(ADMIN);
  if (r.status !== 201) throw new Error('setup: ' + JSON.stringify(r.body));
  return login(app, ADMIN.username, ADMIN.password);
}
