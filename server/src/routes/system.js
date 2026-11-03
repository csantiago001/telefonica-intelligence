import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { now } from '../db/database.js';
import { getAllSettings, setSetting, DEFAULT_SETTINGS } from '../lib/settings.js';
import { HttpError, parse, audit, pageSchema, paginate, toCsv } from '../lib/util.js';
import { requirePerm, can } from '../middleware/auth.js';
import { runRetention } from '../jobs/retention.js';
import { createBackup, listBackups, readBackup } from '../lib/backup.js';
import { TOOLS } from '../services/osint.js';

const dirSize = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).reduce((n, f) => n + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).size : 0), 0) : 0);

export default function systemRoutes({ db, config, startedAt, version }) {
  const r = Router();

  // ---------------- Dashboard ----------------
  r.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const one = (sql, ...p) => db.get(sql, ...p).n;
    const kpis = {
      activeCases: one("SELECT COUNT(*) n FROM cases WHERE status IN ('abierto','en_curso','suspendido')"),
      closedCases: one("SELECT COUNT(*) n FROM cases WHERE status IN ('cerrado','archivado')"),
      totalCases: one('SELECT COUNT(*) n FROM cases'),
      criticalCases: one("SELECT COUNT(*) n FROM cases WHERE priority IN ('alta','critica') AND status IN ('abierto','en_curso')"),
      phoneQueries30: one('SELECT COUNT(*) n FROM phone_queries WHERE created_at > ?', d30),
      osintQueries30: one('SELECT COUNT(*) n FROM osint_queries WHERE created_at > ?', d30),
      queriesTotal: one('SELECT COUNT(*) n FROM phone_queries') + one('SELECT COUNT(*) n FROM osint_queries'),
      queries7: one('SELECT COUNT(*) n FROM phone_queries WHERE created_at > ?', d7) + one('SELECT COUNT(*) n FROM osint_queries WHERE created_at > ?', d7),
      evidence: one('SELECT COUNT(*) n FROM evidence WHERE deleted_at IS NULL'),
      findings: one('SELECT COUNT(*) n FROM findings'),
      activeGeoLinks: one("SELECT COUNT(*) n FROM geo_links WHERE status IN ('pendiente','activo') AND expires_at > ?", now()),
      reports: one('SELECT COUNT(*) n FROM reports'),
      credits: db.get('SELECT credits FROM users WHERE id = ?', req.user.id).credits,
      osintFailRate: (() => { const t = one('SELECT COUNT(*) n FROM osint_queries WHERE created_at > ?', d30); return t ? Math.round((one("SELECT COUNT(*) n FROM osint_queries WHERE status = 'fallido' AND created_at > ?", d30) / t) * 100) : 0; })(),
    };
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const byDay = (table) => Object.fromEntries(db.all(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM ${table} WHERE created_at > ? GROUP BY d`, d30).map((x) => [x.d, x.n]));
    const ph = byDay('phone_queries');
    const os = byDay('osint_queries');
    const ev = byDay('case_events');
    const activity = days.map((d) => ({ date: d, telefonicas: ph[d] || 0, osint: os[d] || 0, eventos: ev[d] || 0 }));
    const casesByStatus = db.all('SELECT status name, COUNT(*) value FROM cases GROUP BY status');
    const casesByClass = db.all('SELECT classification name, COUNT(*) value FROM cases GROUP BY classification ORDER BY value DESC');
    const findingsByRel = db.all('SELECT reliability name, COUNT(*) value FROM findings GROUP BY reliability');
    const osintByTool = db.all('SELECT tool, status, COUNT(*) n FROM osint_queries WHERE created_at > ? GROUP BY tool, status', d30);
    const toolAgg = {};
    for (const x of osintByTool) {
      toolAgg[x.tool] ||= { name: TOOLS[x.tool]?.label.split(' (')[0] || x.tool, exito: 0, sin_resultados: 0, fallido: 0, parcial: 0 };
      toolAgg[x.tool][x.status] = (toolAgg[x.tool][x.status] || 0) + x.n;
    }
    const recent = db.all(`SELECT e.id, e.type, e.detail, e.created_at, c.code, c.id case_id, u.full_name user_name FROM case_events e JOIN cases c ON c.id = e.case_id LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 12`);
    const recentCases = db.all("SELECT id, code, title, status, priority, updated_at FROM cases WHERE status IN ('abierto','en_curso','suspendido') ORDER BY updated_at DESC LIMIT 6");
    const alerts = db.all('SELECT * FROM alerts WHERE read_at IS NULL AND (user_id IS NULL OR user_id = ?) ORDER BY id DESC LIMIT 8', req.user.id);
    // Alertas calculadas (no persistidas)
    const computed = [];
    const expiring = db.all("SELECT id, recipient_label, expires_at FROM geo_links WHERE status IN ('pendiente','activo') AND expires_at BETWEEN ? AND ?", now(), new Date(Date.now() + 6 * 3600_000).toISOString());
    for (const g of expiring) computed.push({ level: 'info', title: `Enlace de ubicación por vencer: ${g.recipient_label}`, detail: `Vence ${new Date(g.expires_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`, link: `/geolocalizacion/${g.id}` });
    const unverified = one('SELECT COUNT(*) n FROM evidence WHERE deleted_at IS NULL AND (last_verified_at IS NULL OR last_verified_at < ?)', d30);
    if (unverified) computed.push({ level: 'info', title: `${unverified} evidencia(s) sin verificar integridad en 30 días`, detail: 'Ejecute la verificación SHA-256 desde Evidencias.', link: '/evidencias' });
    if (kpis.credits < 20) computed.push({ level: 'warning', title: 'Saldo de créditos bajo', detail: `Saldo actual: ${kpis.credits}`, link: '/creditos' });
    const stale = one("SELECT COUNT(*) n FROM cases WHERE status IN ('abierto','en_curso') AND updated_at < ?", d30);
    if (stale) computed.push({ level: 'warning', title: `${stale} expediente(s) activo(s) sin movimiento en 30 días`, detail: 'Revise su estado o ciérrelos.', link: '/expedientes?status=activos' });
    res.json({ kpis, activity, casesByStatus, casesByClass, findingsByRel, osintByTool: Object.values(toolAgg), recent, recentCases, alerts, computedAlerts: computed });
  });

  r.get('/alerts', (req, res) => {
    res.json(db.all('SELECT * FROM alerts WHERE (user_id IS NULL OR user_id = ?) ORDER BY id DESC LIMIT 50', req.user.id));
  });
  r.post('/alerts/read-all', (req, res) => {
    db.run('UPDATE alerts SET read_at = ? WHERE read_at IS NULL AND (user_id IS NULL OR user_id = ?)', now(), req.user.id);
    res.json({ ok: true });
  });
  r.post('/alerts/:id/read', (req, res) => {
    db.run('UPDATE alerts SET read_at = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?)', now(), Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // Búsqueda global
  r.get('/search', (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const like = `%${q}%`;
    const out = { cases: [], evidence: [], phones: [], findings: [] };
    if (can(req, 'cases.read')) {
      out.cases = db.all('SELECT id, code, title, status FROM cases WHERE code LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT 6', like, like);
      out.phones = db.all('SELECT p.e164, c.id case_id, c.code FROM case_phones p JOIN cases c ON c.id = p.case_id WHERE p.e164 LIKE ? LIMIT 6', `%${q.replace(/[^\d+]/g, '') || q}%`);
    }
    if (can(req, 'evidence.read')) out.evidence = db.all('SELECT id, code, title FROM evidence WHERE deleted_at IS NULL AND (code LIKE ? OR title LIKE ? OR sha256 LIKE ?) LIMIT 6', like, like, like);
    if (can(req, 'osint.history')) out.findings = db.all('SELECT id, title, case_id FROM findings WHERE title LIKE ? LIMIT 6', like);
    res.json(out);
  });

  // ---------------- Configuración ----------------
  r.get('/settings', requirePerm('admin.settings'), (req, res) => {
    const s = getAllSettings(db);
    delete s['backup.last_auto'];
    res.json({ settings: s, osintTools: Object.fromEntries(Object.entries(TOOLS).map(([k, t]) => [k, { label: t.label, source: t.source }])) });
  });

  const settingSchemas = {
    'system.organization': z.string().trim().min(2).max(120),
    'system.session_hours': z.coerce.number().int().min(1).max(72),
    'system.idle_minutes': z.coerce.number().int().min(5).max(720),
    'system.default_country': z.string().length(2).toUpperCase(),
    'security.max_login_attempts': z.coerce.number().int().min(3).max(20),
    'security.lockout_minutes': z.coerce.number().int().min(1).max(1440),
    'security.password_min_length': z.coerce.number().int().min(8).max(64),
    'security.require_2fa_admin': z.boolean(),
    'geo.default_expiry_hours': z.coerce.number().int().min(1).max(720),
    'geo.max_expiry_hours': z.coerce.number().int().min(1).max(720),
    'osint.sources': z.record(z.string(), z.boolean()),
    'retention.phone_queries_days': z.coerce.number().int().min(0).max(3650),
    'retention.osint_queries_days': z.coerce.number().int().min(0).max(3650),
    'retention.geo_days': z.coerce.number().int().min(0).max(3650),
    'retention.audit_days': z.coerce.number().int().min(0).max(3650),
    'retention.closed_cases_days': z.coerce.number().int().min(0).max(3650),
    'backup.auto_daily': z.boolean(),
    'backup.keep': z.coerce.number().int().min(1).max(90),
  };

  r.put('/settings', requirePerm('admin.settings'), (req, res) => {
    const body = parse(z.record(z.string(), z.any()), req.body);
    const changed = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(k in settingSchemas)) throw new HttpError(400, `Parámetro no configurable: ${k}`);
      const val = parse(settingSchemas[k], v);
      if (k === 'osint.sources') for (const key of Object.keys(val)) if (!(key in TOOLS)) throw new HttpError(400, `Fuente desconocida: ${key}`);
      changed[k] = val;
    }
    if ((changed['retention.audit_days'] ?? 1) > 0 && changed['retention.audit_days'] < 90) throw new HttpError(400, 'La auditoría debe conservarse al menos 90 días (o 0 = indefinidamente).');
    db.tx(() => Object.entries(changed).forEach(([k, v]) => setSetting(db, k, v, req.user.id)));
    audit(db, req, 'settings.updated', { detail: changed, severity: 'warning' });
    res.json({ ok: true });
  });

  r.post('/settings/reset', requirePerm('admin.settings'), (req, res) => {
    const { keys } = parse(z.object({ keys: z.array(z.string()).min(1) }), req.body);
    for (const k of keys) if (k in DEFAULT_SETTINGS && k in settingSchemas) db.run('DELETE FROM settings WHERE key = ?', k);
    audit(db, req, 'settings.reset', { detail: keys, severity: 'warning' });
    res.json({ ok: true });
  });

  r.get('/system/info', requirePerm('admin.settings'), (req, res) => {
    const dbSize = fs.existsSync(config.dbFile) ? fs.statSync(config.dbFile).size + (fs.existsSync(config.dbFile + '-wal') ? fs.statSync(config.dbFile + '-wal').size : 0) : 0;
    res.json({
      version, mode: config.mode, node: process.version, startedAt, uptimeSec: Math.round(process.uptime()),
      dbSize, evidenceSize: dirSize(config.evidenceDir), evidenceFiles: fs.existsSync(config.evidenceDir) ? fs.readdirSync(config.evidenceDir).length : 0,
      users: db.get('SELECT COUNT(*) n FROM users').n, schemaVersion: db.get('SELECT MAX(version) v FROM schema_migrations').v,
      cookieSecure: config.cookieSecure, publicUrl: config.publicUrl || null, maxUploadMb: config.maxUploadMb,
      lastAutoBackup: (() => { const x = db.get("SELECT value FROM settings WHERE key = 'backup.last_auto'"); return x ? JSON.parse(x.value) : null; })(),
    });
  });

  // ---------------- Retención ----------------
  r.get('/retention/preview', requirePerm('admin.backups'), (req, res) => res.json(runRetention(db, config, { dryRun: true })));
  r.post('/retention/run', requirePerm('admin.backups'), (req, res) => {
    const plan = runRetention(db, config);
    audit(db, req, 'retention.manual_run', { detail: plan, severity: 'warning' });
    res.json({ ok: true, deleted: plan });
  });

  // ---------------- Copias de seguridad ----------------
  r.get('/backups', requirePerm('admin.backups'), (req, res) => res.json(listBackups(config)));
  r.post('/backups', requirePerm('admin.backups'), (req, res) => {
    if (config.isDemo) throw new HttpError(400, 'Las copias de seguridad están deshabilitadas en el entorno de demostración.');
    const b = createBackup(db, config, 'manual');
    audit(db, req, 'backup.created', { detail: { name: b.name, sha256: b.sha256 } });
    res.status(201).json({ name: b.name, size: b.size, sha256: b.sha256, files: b.files });
  });
  const backupFile = (name) => {
    if (!/^respaldo-[\w-]+\.tibak$/.test(name)) throw new HttpError(400, 'Nombre de copia inválido.');
    const file = path.join(config.backupDir, name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Copia no encontrada.');
    return file;
  };
  r.get('/backups/:name/download', requirePerm('admin.backups'), (req, res) => {
    const file = backupFile(req.params.name);
    audit(db, req, 'backup.downloaded', { detail: { name: req.params.name }, severity: 'warning' });
    res.download(file, req.params.name);
  });
  r.post('/backups/:name/verify', requirePerm('admin.backups'), (req, res) => {
    const file = backupFile(req.params.name);
    try {
      const { manifest } = readBackup(file, config.masterKey);
      audit(db, req, 'backup.verified', { detail: { name: req.params.name, ok: true } });
      res.json({ ok: true, createdAt: manifest.createdAt, files: manifest.files.length });
    } catch (e) {
      audit(db, req, 'backup.verified', { detail: { name: req.params.name, ok: false, error: e.message }, severity: 'critical' });
      res.json({ ok: false, error: e.message });
    }
  });
  r.delete('/backups/:name', requirePerm('admin.backups'), (req, res) => {
    const file = backupFile(req.params.name);
    fs.unlinkSync(file);
    audit(db, req, 'backup.deleted', { detail: { name: req.params.name }, severity: 'warning' });
    res.json({ ok: true });
  });

  // ---------------- Auditoría ----------------
  r.get('/audit', requirePerm('admin.audit'), (req, res) => {
    const p = parse(pageSchema.extend({ severity: z.string().optional().default(''), action: z.string().max(60).optional().default(''), userId: z.coerce.number().int().optional(), from: z.string().optional().default(''), to: z.string().optional().default(''), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('(a.action LIKE ? OR a.detail LIKE ? OR a.username LIKE ? OR a.ip LIKE ?)'); params.push(...Array(4).fill(`%${p.q}%`)); }
    if (p.severity) { conds.push('a.severity = ?'); params.push(p.severity); }
    if (p.action) { conds.push('a.action LIKE ?'); params.push(`${p.action}%`); }
    if (p.userId) { conds.push('a.user_id = ?'); params.push(p.userId); }
    if (p.from) { conds.push('a.created_at >= ?'); params.push(p.from); }
    if (p.to) { conds.push('a.created_at <= ?'); params.push(p.to + 'T23:59:59.999Z'); }
    const sql = `SELECT a.* FROM audit_log a ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    if (p.format === 'csv') {
      const rows = db.all(sql + ' ORDER BY a.id DESC', ...params);
      audit(db, req, 'audit.exported', { detail: { rows: rows.length }, severity: 'warning' });
      return res.type('text/csv').attachment('registro-auditoria.csv').send(toCsv(rows, [
        { label: 'ID', key: 'id' }, { label: 'Fecha', key: 'created_at' }, { label: 'Usuario', key: 'username' }, { label: 'Acción', key: 'action' },
        { label: 'Entidad', key: 'entity' }, { label: 'ID entidad', key: 'entity_id' }, { label: 'Detalle', key: 'detail' }, { label: 'IP', key: 'ip' }, { label: 'Severidad', key: 'severity' },
      ]));
    }
    res.json(paginate(db, sql, params, p, 'a.id DESC'));
  });

  return r;
}
