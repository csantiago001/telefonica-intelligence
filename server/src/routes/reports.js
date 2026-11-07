import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { now } from '../db/database.js';
import { buildReportPdf } from '../lib/pdf.js';
import { BUCKET } from '../lib/storage.js';
import { encrypt, decrypt, sha256 } from '../lib/crypto.js';
import { getSetting } from '../lib/settings.js';
import { ensureCredits, chargeCredits } from '../lib/credits.js';
import { HttpError, parse, audit, pageSchema, paginate, jsonParse, nextCode } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { TOOLS } from '../services/osint.js';
import { LIBPHONE_SOURCE } from '../lib/phone.js';

export const DEFAULT_LIMITATIONS =
  'La información procede exclusivamente de fuentes públicas y de datos aportados con consentimiento. Los metadatos de numeración telefónica identifican país, tipo de línea y validez del rango, pero no la titularidad ni el operador actual debido a la portabilidad numérica. Los registros DNS, RDAP y de certificados reflejan el estado de la fuente en la fecha de consulta y pueden cambiar. Los resultados marcados como "No verificado" requieren corroboración independiente antes de utilizarse como fundamento de decisiones.';

export default function reportRoutes({ db, config, storage }) {
  const r = Router();

  function collect(caseId) {
    const c = db.get('SELECT * FROM cases WHERE id = ?', caseId);
    if (!c) throw new HttpError(404, 'Expediente no encontrado.');
    const phoneQueries = db.all('SELECT id, input, result, created_at FROM phone_queries WHERE case_id = ? ORDER BY id', caseId).map((q) => ({ ...q, summary: jsonParse(q.result, {}).summary, result: undefined }));
    const osintQueries = db.all('SELECT id, tool, target, status, source, source_url, created_at FROM osint_queries WHERE case_id = ? ORDER BY id', caseId).map((q) => ({ ...q, toolLabel: TOOLS[q.tool]?.label || q.tool }));
    const findings = db.all('SELECT title, detail, source_name, source_url, reliability, observed_at FROM findings WHERE case_id = ? ORDER BY observed_at', caseId);
    const evidence = db.all('SELECT code, title, original_name, origin, size_bytes, sha256, created_at, last_verified_at, last_verified_ok FROM evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY id', caseId);
    const geo = db.all(`SELECT g.recipient_label recipient, g.consent_at, l.latitude, l.longitude, l.accuracy_m, l.received_at FROM geo_links g JOIN geo_locations l ON l.link_id = g.id WHERE g.case_id = ? ORDER BY l.id`, caseId);
    const srcMap = new Map();
    const addSrc = (name, url) => { const k = name; const e = srcMap.get(k) || { name, url: url || '—', count: 0 }; e.count++; srcMap.set(k, e); };
    phoneQueries.forEach(() => addSrc(LIBPHONE_SOURCE.name, LIBPHONE_SOURCE.url));
    osintQueries.forEach((q) => addSrc(q.source, q.source_url));
    findings.forEach((f) => addSrc(f.source_name, f.source_url));
    if (geo.length) addSrc('Ubicación compartida por la persona con consentimiento expreso (API de geolocalización del navegador)', null);
    return {
      case: c,
      entities: db.all('SELECT kind, name, role, identifier FROM case_entities WHERE case_id = ? ORDER BY id', caseId),
      phones: db.all('SELECT p.e164, p.label, e.name entity_name FROM case_phones p LEFT JOIN case_entities e ON e.id = p.entity_id WHERE p.case_id = ? ORDER BY p.id', caseId),
      notes: db.all('SELECT n.body, n.created_at, u.full_name author FROM case_notes n LEFT JOIN users u ON u.id = n.author_id WHERE case_id = ? ORDER BY n.id', caseId),
      phoneQueries, osintQueries, findings, evidence, geo, sources: [...srcMap.values()],
    };
  }

  r.get('/defaults/:caseId', requirePerm('reports.write'), (req, res) => {
    const d = collect(Number(req.params.caseId));
    const rel = d.findings.reduce((a, f) => ((a[f.reliability] = (a[f.reliability] || 0) + 1), a), {});
    res.json({
      title: `Informe de investigación — ${d.case.title}`,
      objective: d.case.objective || '',
      summary: `El expediente ${d.case.code} (${d.case.classification}) registra ${d.phoneQueries.length} análisis telefónicos, ${d.osintQueries.length} consultas a fuentes abiertas, ${d.findings.length} hallazgos (${rel.confirmado || 0} confirmados, ${rel.probable || 0} probables, ${rel.no_verificado || 0} no verificados) y ${d.evidence.length} evidencias con integridad registrada.`,
      limitations: DEFAULT_LIMITATIONS,
      counts: { phoneQueries: d.phoneQueries.length, osintQueries: d.osintQueries.length, findings: d.findings.length, evidence: d.evidence.length, geo: d.geo.length, entities: d.entities.length },
    });
  });

  r.get('/', requirePerm('reports.read'), (req, res) => {
    const p = parse(pageSchema.extend({ caseId: z.coerce.number().int().optional() }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('(r.code LIKE ? OR r.title LIKE ? OR c.code LIKE ?)'); params.push(...Array(3).fill(`%${p.q}%`)); }
    if (p.caseId) { conds.push('r.case_id = ?'); params.push(p.caseId); }
    const sql = `SELECT r.id, r.code, r.title, r.case_id, c.code case_code, c.title case_title, r.sha256, r.created_at, u.full_name author, r.is_demo
                 FROM reports r JOIN cases c ON c.id = r.case_id LEFT JOIN users u ON u.id = r.created_by ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    res.json(paginate(db, sql, params, p, 'r.id DESC'));
  });

  r.post('/', requirePerm('reports.write'), async (req, res) => {
    const d = parse(z.object({
      caseId: z.coerce.number().int().positive(),
      title: z.string().trim().min(5).max(200),
      summary: z.string().trim().min(10, 'El resumen ejecutivo es obligatorio').max(10000),
      objective: z.string().trim().min(5, 'El objetivo es obligatorio').max(5000),
      observations: z.string().trim().max(10000).optional().default(''),
      limitations: z.string().trim().min(5).max(10000),
      conclusions: z.string().trim().min(10, 'Las conclusiones son obligatorias').max(10000),
    }), req.body);
    ensureCredits(db, req.user, 'report_pdf');
    const data = collect(d.caseId);
    const reportCode = nextCode(db, 'reports', 'INF');
    const content = { ...d, observations: d.observations || 'Sin observaciones adicionales.' };
    const payload = {
      ...data, ...content, reportCode, generatedAt: now(), author: req.user.full_name, organization: getSetting(db, 'system.organization'), isDemo: config.isDemo,
    };
    payload.contentHash = sha256(JSON.stringify({ content, case: data.case.code, findings: data.findings, evidence: data.evidence.map((e) => e.sha256), queries: [data.phoneQueries.length, data.osintQueries.length] }));
    const pdf = await buildReportPdf(payload);
    const hash = sha256(pdf);
    const fileName = `${reportCode}.pdf.enc`;
    await storage.put(BUCKET.REPORTS, fileName, encrypt(config.masterKey, pdf));
    const id = db.run('INSERT INTO reports (code, case_id, title, content, sha256, file_name, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      reportCode, d.caseId, d.title, JSON.stringify(content), hash, fileName, req.user.id, config.isDemo ? 1 : 0, now()).lastInsertRowid;
    chargeCredits(db, req.user, 'report_pdf', `report:${id}`, config.isDemo);
    db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', d.caseId, 'informe', `${reportCode} generado (SHA-256 ${hash.slice(0, 16)}…)`, req.user.id, now());
    audit(db, req, 'report.generated', { entity: 'report', entityId: id, detail: { code: reportCode, caseId: d.caseId, sha256: hash } });
    res.status(201).json({ id, code: reportCode, sha256: hash, size: pdf.length });
  });

  r.get('/:id/pdf', requirePerm('reports.read'), async (req, res) => {
    const rep = db.get('SELECT * FROM reports WHERE id = ?', Number(req.params.id));
    if (!rep) throw new HttpError(404, 'Informe no encontrado.');
    const enc = await storage.get(BUCKET.REPORTS, rep.file_name);
    if (!enc) throw new HttpError(410, 'El archivo del informe no está disponible.');
    const pdf = decrypt(config.masterKey, enc);
    const ok = sha256(pdf) === rep.sha256;
    if (!ok) throw new HttpError(409, 'El archivo del informe no coincide con su hash registrado.');
    audit(db, req, 'report.downloaded', { entity: 'report', entityId: rep.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-SHA256', rep.sha256);
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${rep.code}.pdf"`);
    res.send(pdf);
  });

  r.delete('/:id', requirePerm('reports.write', 'cases.delete'), async (req, res) => {
    const rep = db.get('SELECT * FROM reports WHERE id = ?', Number(req.params.id));
    if (!rep) throw new HttpError(404, 'Informe no encontrado.');
    db.run('DELETE FROM reports WHERE id = ?', rep.id);
    try { await storage.remove(BUCKET.REPORTS, rep.file_name); } catch { /* ignorado */ }
    db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', rep.case_id, 'informe', `${rep.code} eliminado`, req.user.id, now());
    audit(db, req, 'report.deleted', { entity: 'report', entityId: rep.id, detail: { code: rep.code }, severity: 'warning' });
    res.json({ ok: true });
  });

  return r;
}
