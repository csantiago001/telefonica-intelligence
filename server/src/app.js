import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDatabase } from './db/database.js';
import { DEFAULT_ROLES } from './lib/permissions.js';
import { HttpError } from './lib/util.js';
import { sessionLoader, requireAuth, csrfProtection } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import investigationRoutes from './routes/investigation.js';
import caseRoutes, { ensureDirs } from './routes/cases.js';
import evidenceRoutes from './routes/evidence.js';
import reportRoutes from './routes/reports.js';
import { geoRoutes, publicConsentRoutes } from './routes/geo.js';
import systemRoutes from './routes/system.js';

const version = createRequire(import.meta.url)('../package.json').version;

export function seedRoles(db) {
  for (const r of DEFAULT_ROLES) {
    const existing = db.get('SELECT id, permissions FROM roles WHERE key = ?', r.key);
    if (!existing) db.run('INSERT INTO roles (key, name, description, permissions, is_system) VALUES (?, ?, ?, ?, ?)', r.key, r.name, r.description, JSON.stringify(r.permissions), r.is_system);
    else if (r.key === 'admin') db.run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(r.permissions), existing.id);
  }
}

export function createApp(config, { db: providedDb, logger = console } = {}) {
  ensureDirs(config);
  const db = providedDb || openDatabase(config.dbFile);
  seedRoles(db);
  const app = express();
  const startedAt = new Date().toISOString();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.locals.db = db;

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        'connect-src': ["'self'"],
        'font-src': ["'self'", 'data:'],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 15552000 } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
    next();
  });
  if (config.corsOrigin) {
    app.use('/api', (req, res, next) => {
      if (req.get('origin') === config.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
      }
      next();
    });
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60_000, max: config.isTest ? 100000 : 600, key: 'api' }));
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const ctx = { db, config, startedAt, version };
  app.get('/api/health', (req, res) => {
    db.get('SELECT 1 ok');
    res.json({ status: 'ok', mode: config.mode, version, time: new Date().toISOString() });
  });
  app.use('/api/public/consent', publicConsentRoutes(ctx));
  app.use('/api', sessionLoader(db), csrfProtection);
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', requireAuth);
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', investigationRoutes(ctx));
  app.use('/api/cases', caseRoutes(ctx));
  app.use('/api/evidence', evidenceRoutes(ctx));
  app.use('/api/reports', reportRoutes(ctx));
  app.use('/api/geo', geoRoutes(ctx));
  app.use('/api', systemRoutes(ctx));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Recurso no encontrado.')));

  // Frontend compilado
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.type('text').send('Frontend no compilado. Ejecute "npm run build" en la raíz del proyecto.'));
  }

  // Manejo centralizado de errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
    logger.error?.('[error]', err);
    res.status(500).json({ error: 'Error interno del servidor. Se registró el incidente.' });
  });

  return { app, db };
}
