import { Router } from 'express';
import { z } from 'zod';
import { now } from '../db/database.js';
import { analyzePhone, countryList } from '../lib/phone.js';
import { getSetting } from '../lib/settings.js';
import { ensureCredits, chargeCredits } from '../lib/credits.js';
import { HttpError, parse, audit, pageSchema, paginate, jsonParse, toCsv } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { TOOLS, validateTarget, runTool } from '../services/osint.js';

const RELIABILITY = ['confirmado', 'probable', 'no_verificado'];

export default function investigationRoutes({ db, config }) {
  const r = Router();
  const caseExists = (id) => {
    if (id == null) return null;
    const c = db.get('SELECT id, status FROM cases WHERE id = ?', id);
    if (!c) throw new HttpError(400, 'El expediente indicado no existe.');
    if (c.status === 'archivado') throw new HttpError(400, 'El expediente está archivado y no admite nuevas consultas.');
    return id;
  };
  const caseEvent = (caseId, type, detail, userId) => {
    if (caseId) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', caseId, type, detail, userId, now());
  };

  // ---------------- Análisis telefónico ----------------
  r.get('/phone/countries', (req, res) => res.json(countryList()));

  r.post('/phone/analyze', requirePerm('phone.analyze'), (req, res) => {
    const data = parse(
      z.object({
        numbers: z.array(z.string().trim().min(1).max(40)).min(1, 'Ingrese al menos un número').max(50, 'Máximo 50 números por lote'),
        defaultCountry: z.string().length(2).toUpperCase().optional(),
        caseId: z.coerce.number().int().positive().nullable().optional(),
        attachToCase: z.boolean().default(false),
      }),
      req.body
    );
    const caseId = caseExists(data.caseId ?? null);
    const country = data.defaultCountry || req.user.preferences?.defaultCountry || getSetting(db, 'system.default_country');
    const unique = [...new Set(data.numbers)];
    // Verifica saldo para el lote completo antes de ejecutar.
    const unit = ensureCredits(db, req.user, 'phone_analysis');
    if (getSetting(db, 'credits.enforce') && unit * unique.length > db.get('SELECT credits FROM users WHERE id = ?', req.user.id).credits) {
      throw new HttpError(402, `Créditos insuficientes para analizar ${unique.length} números (costo ${unit * unique.length}).`);
    }
    const results = unique.map((input) => {
      const a = analyzePhone(input, country);
      const id = db.run(
        'INSERT INTO phone_queries (input, default_country, e164, valid, country, result, case_id, user_id, credits_used, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        input, country, a.e164 || null, a.valid ? 1 : 0, a.country || null, JSON.stringify(a), caseId, req.user.id, 0, config.isDemo ? 1 : 0, now()
      ).lastInsertRowid;
      const cost = chargeCredits(db, req.user, 'phone_analysis', `phone_query:${id}`, config.isDemo);
      db.run('UPDATE phone_queries SET credits_used = ? WHERE id = ?', cost, id);
      if (caseId && data.attachToCase && a.e164) {
        db.run('INSERT OR IGNORE INTO case_phones (case_id, e164, label, phone_query_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', caseId, a.e164, a.summary.slice(0, 120), id, req.user.id, now());
      }
      caseEvent(caseId, 'consulta_telefonica', `${input} → ${a.summary}`, req.user.id);
      return { id, ...a, creditsUsed: cost };
    });
    audit(db, req, 'phone.analyzed', { entity: 'phone_query', detail: { count: results.length, caseId } });
    res.json({ results, balance: db.get('SELECT credits FROM users WHERE id = ?', req.user.id).credits });
  });

  r.get('/phone/history', requirePerm('phone.history'), (req, res) => {
    const p = parse(pageSchema.extend({ valid: z.enum(['', '1', '0']).optional().default(''), country: z.string().max(2).optional().default(''), caseId: z.coerce.number().int().optional(), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('(q.input LIKE ? OR q.e164 LIKE ?)'); params.push(`%${p.q}%`, `%${p.q}%`); }
    if (p.valid) { conds.push('q.valid = ?'); params.push(Number(p.valid)); }
    if (p.country) { conds.push('q.country = ?'); params.push(p.country.toUpperCase()); }
    if (p.caseId) { conds.push('q.case_id = ?'); params.push(p.caseId); }
    const sql = `SELECT q.id, q.input, q.e164, q.valid, q.country, q.default_country, q.case_id, c.code case_code, q.credits_used, q.created_at, q.result, u.username
                 FROM phone_queries q LEFT JOIN users u ON u.id = q.user_id LEFT JOIN cases c ON c.id = q.case_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    const mapRow = (row) => {
      const a = jsonParse(row.result, {});
      delete row.result;
      return { ...row, type: a.type || null, summary: a.summary, classification: a.classification, countryName: a.countryName };
    };
    if (p.format === 'csv') {
      const rows = db.all(sql + ' ORDER BY q.id DESC', ...params).map(mapRow);
      audit(db, req, 'phone.history_exported', { detail: { rows: rows.length } });
      return res.type('text/csv').attachment('historial-analisis-telefonico.csv').send(toCsv(rows, [
        { label: 'ID', key: 'id' }, { label: 'Fecha', key: 'created_at' }, { label: 'Entrada', key: 'input' }, { label: 'E.164', key: 'e164' },
        { label: 'Clasificación', key: 'classification' }, { label: 'País', key: 'countryName' }, { label: 'Tipo', key: 'type' },
        { label: 'Resumen', key: 'summary' }, { label: 'Expediente', key: 'case_code' }, { label: 'Usuario', key: 'username' },
      ]));
    }
    const out = paginate(db, sql, params, p, 'q.id DESC');
    out.items = out.items.map(mapRow);
    res.json(out);
  });

  r.get('/phone/history/:id', requirePerm('phone.history'), (req, res) => {
    const row = db.get('SELECT q.*, u.username, c.code case_code FROM phone_queries q LEFT JOIN users u ON u.id = q.user_id LEFT JOIN cases c ON c.id = q.case_id WHERE q.id = ?', Number(req.params.id));
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    res.json({ ...row, result: jsonParse(row.result, {}) });
  });

  // ---------------- OSINT ----------------
  r.get('/osint/tools', (req, res) => {
    const enabled = getSetting(db, 'osint.sources') || {};
    const costs = getSetting(db, 'credits.costs') || {};
    res.json(Object.entries(TOOLS).map(([key, t]) => ({ key, ...t, enabled: enabled[key] !== false, costValue: costs[t.cost] ?? 0 })));
  });

  r.post('/osint/run', requirePerm('osint.query'), async (req, res) => {
    const data = parse(z.object({ tool: z.enum(Object.keys(TOOLS)), target: z.string().trim().min(1).max(500), caseId: z.coerce.number().int().positive().nullable().optional() }), req.body);
    const tool = TOOLS[data.tool];
    if ((getSetting(db, 'osint.sources') || {})[data.tool] === false) throw new HttpError(400, `La fuente "${tool.label}" está desactivada en Configuración › Fuentes.`);
    const caseId = caseExists(data.caseId ?? null);
    let target;
    try { target = validateTarget(data.tool, data.target); } catch (e) { throw new HttpError(400, e.message); }
    ensureCredits(db, req.user, tool.cost);
    const started = Date.now();
    let out;
    let error = null;
    try {
      out = await runTool(data.tool, target, { timeoutMs: config.osintTimeoutMs, allowPrivate: config.allowPrivateNetworkFetch });
    } catch (e) {
      error = e.message || 'Error desconocido';
      out = { status: 'fallido', data: null, findings: [], sourceUrl: null };
    }
    const duration = Date.now() - started;
    const id = db.run(
      'INSERT INTO osint_queries (tool, target, status, source, source_url, result, error, duration_ms, case_id, user_id, credits_used, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      data.tool, target, out.status, tool.source, out.sourceUrl, out.data ? JSON.stringify(out.data) : null, error, duration, caseId, req.user.id, config.isDemo ? 1 : 0, now()
    ).lastInsertRowid;
    // Solo se cobran las consultas que efectivamente llegaron a la fuente.
    let cost = 0;
    if (out.status !== 'fallido') {
      cost = chargeCredits(db, req.user, tool.cost, `osint_query:${id}`, config.isDemo);
      db.run('UPDATE osint_queries SET credits_used = ? WHERE id = ?', cost, id);
    }
    caseEvent(caseId, 'consulta_osint', `${tool.label}: ${target} → ${out.status}`, req.user.id);
    audit(db, req, 'osint.query', { entity: 'osint_query', entityId: id, detail: { tool: data.tool, target, status: out.status }, severity: out.status === 'fallido' ? 'warning' : 'info' });
    res.json({
      id, tool: data.tool, toolLabel: tool.label, target, status: out.status, source: tool.source, sourceUrl: out.sourceUrl,
      defaultReliability: tool.reliability, data: out.data, suggestedFindings: out.findings, error, durationMs: duration,
      creditsUsed: cost, consultedAt: now(), balance: db.get('SELECT credits FROM users WHERE id = ?', req.user.id).credits,
    });
  });

  r.get('/osint/history', requirePerm('osint.history'), (req, res) => {
    const p = parse(pageSchema.extend({ tool: z.string().max(20).optional().default(''), status: z.string().max(20).optional().default(''), caseId: z.coerce.number().int().optional() }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('o.target LIKE ?'); params.push(`%${p.q}%`); }
    if (p.tool) { conds.push('o.tool = ?'); params.push(p.tool); }
    if (p.status) { conds.push('o.status = ?'); params.push(p.status); }
    if (p.caseId) { conds.push('o.case_id = ?'); params.push(p.caseId); }
    const sql = `SELECT o.id, o.tool, o.target, o.status, o.source, o.source_url, o.error, o.duration_ms, o.case_id, c.code case_code, o.credits_used, o.created_at, u.username
                 FROM osint_queries o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN cases c ON c.id = o.case_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    res.json(paginate(db, sql, params, p, 'o.id DESC'));
  });

  r.get('/osint/history/:id', requirePerm('osint.history'), (req, res) => {
    const row = db.get('SELECT o.*, u.username, c.code case_code FROM osint_queries o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN cases c ON c.id = o.case_id WHERE o.id = ?', Number(req.params.id));
    if (!row) throw new HttpError(404, 'Consulta no encontrada.');
    res.json({ ...row, result: jsonParse(row.result, null), toolLabel: TOOLS[row.tool]?.label });
  });

  // ---------------- Hallazgos ----------------
  const findingBody = z.object({
    caseId: z.coerce.number().int().positive().nullable().optional(),
    osintQueryId: z.coerce.number().int().positive().nullable().optional(),
    title: z.string().trim().min(3).max(300),
    detail: z.string().trim().max(5000).optional().default(''),
    sourceName: z.string().trim().min(2, 'Indique la fuente').max(200),
    sourceUrl: z.string().trim().url('URL de fuente inválida').max(1000).optional().or(z.literal('')),
    reliability: z.enum(RELIABILITY),
    observedAt: z.string().datetime({ offset: true }).optional(),
  });

  r.get('/findings', requirePerm('osint.history'), (req, res) => {
    const p = parse(pageSchema.extend({ reliability: z.string().optional().default(''), caseId: z.coerce.number().int().optional() }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('(f.title LIKE ? OR f.detail LIKE ? OR f.source_name LIKE ?)'); params.push(...Array(3).fill(`%${p.q}%`)); }
    if (p.reliability) { conds.push('f.reliability = ?'); params.push(p.reliability); }
    if (p.caseId) { conds.push('f.case_id = ?'); params.push(p.caseId); }
    const sql = `SELECT f.*, c.code case_code, u.username FROM findings f LEFT JOIN cases c ON c.id = f.case_id LEFT JOIN users u ON u.id = f.created_by ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    res.json(paginate(db, sql, params, p, 'f.observed_at DESC'));
  });

  r.post('/findings', requirePerm('findings.write'), (req, res) => {
    const d = parse(findingBody, req.body);
    const caseId = caseExists(d.caseId ?? null);
    const id = db.run(
      'INSERT INTO findings (case_id, osint_query_id, title, detail, source_name, source_url, reliability, observed_at, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      caseId, d.osintQueryId ?? null, d.title, d.detail || null, d.sourceName, d.sourceUrl || null, d.reliability, d.observedAt || now(), req.user.id, config.isDemo ? 1 : 0, now()
    ).lastInsertRowid;
    caseEvent(caseId, 'hallazgo', `${d.title} [${d.reliability}]`, req.user.id);
    audit(db, req, 'finding.created', { entity: 'finding', entityId: id, detail: { caseId, reliability: d.reliability } });
    res.status(201).json({ id });
  });

  r.put('/findings/:id', requirePerm('findings.write'), (req, res) => {
    const id = Number(req.params.id);
    const d = parse(findingBody, req.body);
    const f = db.get('SELECT * FROM findings WHERE id = ?', id);
    if (!f) throw new HttpError(404, 'Hallazgo no encontrado.');
    const caseId = d.caseId === undefined ? f.case_id : caseExists(d.caseId);
    db.run('UPDATE findings SET case_id = ?, title = ?, detail = ?, source_name = ?, source_url = ?, reliability = ? WHERE id = ?', caseId, d.title, d.detail || null, d.sourceName, d.sourceUrl || null, d.reliability, id);
    if (f.reliability !== d.reliability) caseEvent(caseId, 'hallazgo', `Confiabilidad de "${d.title}": ${f.reliability} → ${d.reliability}`, req.user.id);
    audit(db, req, 'finding.updated', { entity: 'finding', entityId: id, detail: { from: f.reliability, to: d.reliability } });
    res.json({ ok: true });
  });

  r.delete('/findings/:id', requirePerm('findings.write'), (req, res) => {
    const id = Number(req.params.id);
    const f = db.get('SELECT * FROM findings WHERE id = ?', id);
    if (!f) throw new HttpError(404, 'Hallazgo no encontrado.');
    db.run('DELETE FROM findings WHERE id = ?', id);
    caseEvent(f.case_id, 'hallazgo_eliminado', f.title, req.user.id);
    audit(db, req, 'finding.deleted', { entity: 'finding', entityId: id, detail: { title: f.title }, severity: 'warning' });
    res.json({ ok: true });
  });

  return r;
}
