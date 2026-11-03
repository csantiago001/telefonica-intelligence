import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { now } from '../db/database.js';
import { HttpError, parse, audit, pageSchema, paginate, jsonParse, nextCode, toCsv } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { secureDelete } from '../lib/crypto.js';
import { analyzePhone } from '../lib/phone.js';
import { getSetting } from '../lib/settings.js';

export const CASE_STATUS = ['abierto', 'en_curso', 'suspendido', 'cerrado', 'archivado'];
export const CASE_CLASS = ['general', 'fraude', 'extorsion', 'suplantacion', 'acoso', 'verificacion', 'ciberseguridad', 'persona_desaparecida', 'otro'];
export const CASE_PRIORITY = ['baja', 'media', 'alta', 'critica'];
const ENTITY_KIND = ['persona', 'organizacion', 'dominio', 'cuenta', 'otro'];

export default function caseRoutes({ db, config }) {
  const r = Router();
  const event = (caseId, type, detail, userId) =>
    db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', caseId, type, detail, userId, now());
  const touch = (id) => db.run('UPDATE cases SET updated_at = ? WHERE id = ?', now(), id);
  const getCase = (id) => {
    const c = db.get('SELECT * FROM cases WHERE id = ?', Number(id));
    if (!c) throw new HttpError(404, 'Expediente no encontrado.');
    return c;
  };
  const writable = (c) => {
    if (c.status === 'archivado') throw new HttpError(400, 'El expediente está archivado. Reábralo para modificarlo.');
  };

  r.get('/meta', (req, res) => res.json({ status: CASE_STATUS, classification: CASE_CLASS, priority: CASE_PRIORITY, entityKinds: ENTITY_KIND }));

  r.get('/', requirePerm('cases.read'), (req, res) => {
    const p = parse(pageSchema.extend({
      status: z.string().optional().default(''), classification: z.string().optional().default(''), priority: z.string().optional().default(''),
      ownerId: z.coerce.number().int().optional(), sort: z.enum(['updated', 'opened', 'code', 'priority']).default('updated'), format: z.enum(['json', 'csv']).default('json'),
    }), req.query);
    const conds = [];
    const params = [];
    if (p.q) {
      conds.push(`(c.code LIKE ? OR c.title LIKE ? OR c.description LIKE ? OR c.tags LIKE ? OR EXISTS (SELECT 1 FROM case_phones cp WHERE cp.case_id = c.id AND cp.e164 LIKE ?) OR EXISTS (SELECT 1 FROM case_entities ce WHERE ce.case_id = c.id AND ce.name LIKE ?))`);
      params.push(...Array(6).fill(`%${p.q}%`));
    }
    if (p.status === 'activos') conds.push("c.status IN ('abierto','en_curso','suspendido')");
    else if (p.status) { conds.push('c.status = ?'); params.push(p.status); }
    if (p.classification) { conds.push('c.classification = ?'); params.push(p.classification); }
    if (p.priority) { conds.push('c.priority = ?'); params.push(p.priority); }
    if (p.ownerId) { conds.push('c.owner_id = ?'); params.push(p.ownerId); }
    const sql = `SELECT c.id, c.code, c.title, c.classification, c.priority, c.status, c.tags, c.opened_at, c.closed_at, c.updated_at, c.is_demo,
        u.full_name owner_name,
        (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id AND e.deleted_at IS NULL) evidence_count,
        (SELECT COUNT(*) FROM case_phones p WHERE p.case_id = c.id) phone_count,
        (SELECT COUNT(*) FROM findings f WHERE f.case_id = c.id) finding_count
      FROM cases c LEFT JOIN users u ON u.id = c.owner_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    const order = { updated: 'c.updated_at DESC', opened: 'c.opened_at DESC', code: 'c.code DESC', priority: "CASE c.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, c.updated_at DESC" }[p.sort];
    if (p.format === 'csv') {
      const rows = db.all(`${sql} ORDER BY ${order}`, ...params);
      return res.type('text/csv').attachment('expedientes.csv').send(toCsv(rows, [
        { label: 'Código', key: 'code' }, { label: 'Título', key: 'title' }, { label: 'Clasificación', key: 'classification' }, { label: 'Prioridad', key: 'priority' },
        { label: 'Estado', key: 'status' }, { label: 'Responsable', key: 'owner_name' }, { label: 'Apertura', key: 'opened_at' }, { label: 'Cierre', key: 'closed_at' },
        { label: 'Evidencias', key: 'evidence_count' }, { label: 'Teléfonos', key: 'phone_count' }, { label: 'Hallazgos', key: 'finding_count' },
      ]));
    }
    const out = paginate(db, sql, params, p, order);
    out.items = out.items.map((c) => ({ ...c, tags: jsonParse(c.tags, []) }));
    res.json(out);
  });

  const caseBody = z.object({
    title: z.string().trim().min(3, 'El título debe tener al menos 3 caracteres').max(200),
    description: z.string().trim().max(10000).optional().default(''),
    objective: z.string().trim().max(5000).optional().default(''),
    classification: z.enum(CASE_CLASS),
    priority: z.enum(CASE_PRIORITY),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    ownerId: z.coerce.number().int().positive().nullable().optional(),
    openedAt: z.string().date().optional(),
  });

  r.post('/', requirePerm('cases.write'), (req, res) => {
    const d = parse(caseBody, req.body);
    if (d.ownerId && !db.get('SELECT id FROM users WHERE id = ? AND active = 1', d.ownerId)) throw new HttpError(400, 'Responsable inválido.');
    const created = db.tx(() => {
      const code = nextCode(db, 'cases', 'TI');
      const opened = d.openedAt ? new Date(d.openedAt + 'T12:00:00Z').toISOString() : now();
      const id = db.run(
        'INSERT INTO cases (code, title, description, objective, classification, priority, status, tags, opened_at, owner_id, created_by, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        code, d.title, d.description || null, d.objective || null, d.classification, d.priority, 'abierto', JSON.stringify(d.tags), opened, d.ownerId ?? req.user.id, req.user.id, config.isDemo ? 1 : 0, now(), now()
      ).lastInsertRowid;
      event(id, 'creado', `Expediente ${code} creado`, req.user.id);
      return { id, code };
    });
    audit(db, req, 'case.created', { entity: 'case', entityId: created.id, detail: { code: created.code } });
    res.status(201).json(created);
  });

  r.get('/:id', requirePerm('cases.read'), (req, res) => {
    const c = getCase(req.params.id);
    const id = c.id;
    const out = {
      ...c,
      tags: jsonParse(c.tags, []),
      owner: c.owner_id ? db.get('SELECT id, full_name, username FROM users WHERE id = ?', c.owner_id) : null,
      entities: db.all('SELECT * FROM case_entities WHERE case_id = ? ORDER BY id', id),
      phones: db.all('SELECT p.*, e.name entity_name FROM case_phones p LEFT JOIN case_entities e ON e.id = p.entity_id WHERE p.case_id = ? ORDER BY p.id', id),
      notes: db.all('SELECT n.*, u.full_name author FROM case_notes n LEFT JOIN users u ON u.id = n.author_id WHERE case_id = ? ORDER BY n.id DESC', id),
      events: db.all('SELECT e.*, u.full_name user_name FROM case_events e LEFT JOIN users u ON u.id = e.user_id WHERE case_id = ? ORDER BY e.id DESC LIMIT 300', id),
      evidence: db.all('SELECT id, code, title, origin, original_name, mime_type, size_bytes, sha256, created_at, last_verified_at, last_verified_ok FROM evidence WHERE case_id = ? AND deleted_at IS NULL ORDER BY id', id),
      findings: db.all('SELECT f.*, u.username FROM findings f LEFT JOIN users u ON u.id = f.created_by WHERE case_id = ? ORDER BY observed_at DESC', id),
      phoneQueries: db.all('SELECT id, input, e164, valid, country, created_at FROM phone_queries WHERE case_id = ? ORDER BY id DESC LIMIT 200', id),
      osintQueries: db.all('SELECT id, tool, target, status, source, created_at FROM osint_queries WHERE case_id = ? ORDER BY id DESC LIMIT 200', id),
      geoLinks: db.all('SELECT id, recipient_label, status, expires_at, consent_at, revoked_at, created_at FROM geo_links WHERE case_id = ? ORDER BY id DESC', id),
      reports: db.all('SELECT id, code, title, sha256, created_at FROM reports WHERE case_id = ? ORDER BY id DESC', id),
    };
    audit(db, req, 'case.viewed', { entity: 'case', entityId: id });
    res.json(out);
  });

  r.put('/:id', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const d = parse(caseBody, req.body);
    db.run('UPDATE cases SET title = ?, description = ?, objective = ?, classification = ?, priority = ?, tags = ?, owner_id = ?, updated_at = ? WHERE id = ?',
      d.title, d.description || null, d.objective || null, d.classification, d.priority, JSON.stringify(d.tags), d.ownerId ?? c.owner_id, now(), c.id);
    const changes = ['title', 'classification', 'priority'].filter((k) => c[k] !== d[k]).map((k) => `${k}: ${c[k]} → ${d[k]}`);
    event(c.id, 'editado', changes.length ? changes.join('; ') : 'Datos generales actualizados', req.user.id);
    audit(db, req, 'case.updated', { entity: 'case', entityId: c.id, detail: changes });
    res.json({ ok: true });
  });

  r.post('/:id/status', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    const d = parse(z.object({ status: z.enum(CASE_STATUS), reason: z.string().trim().min(3, 'Indique el motivo del cambio').max(1000) }), req.body);
    if (c.status === d.status) throw new HttpError(400, 'El expediente ya tiene ese estado.');
    const closing = ['cerrado', 'archivado'].includes(d.status);
    db.run('UPDATE cases SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?', d.status, closing ? c.closed_at || now() : null, now(), c.id);
    event(c.id, 'estado', `${c.status} → ${d.status}. Motivo: ${d.reason}`, req.user.id);
    audit(db, req, 'case.status_changed', { entity: 'case', entityId: c.id, detail: { from: c.status, to: d.status, reason: d.reason } });
    res.json({ ok: true });
  });

  r.delete('/:id', requirePerm('cases.delete'), (req, res) => {
    const c = getCase(req.params.id);
    const d = parse(z.object({ confirmCode: z.string() }), req.body);
    if (d.confirmCode !== c.code) throw new HttpError(400, `Para confirmar escriba el código exacto del expediente (${c.code}).`);
    const files = db.all('SELECT storage_name FROM evidence WHERE case_id = ? AND deleted_at IS NULL', c.id);
    db.tx(() => {
      db.run('UPDATE evidence SET deleted_at = ? WHERE case_id = ? AND deleted_at IS NULL', now(), c.id);
      db.run('DELETE FROM cases WHERE id = ?', c.id);
    });
    for (const f of files) secureDelete(path.join(config.evidenceDir, f.storage_name));
    audit(db, req, 'case.deleted', { entity: 'case', entityId: c.id, detail: { code: c.code, evidenceFilesDeleted: files.length }, severity: 'critical' });
    res.json({ ok: true });
  });

  // ----- Entidades relacionadas -----
  const entityBody = z.object({
    kind: z.enum(ENTITY_KIND), name: z.string().trim().min(2).max(200), role: z.string().trim().max(100).optional().default(''),
    identifier: z.string().trim().max(200).optional().default(''), notes: z.string().trim().max(3000).optional().default(''),
  });
  r.post('/:id/entities', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const d = parse(entityBody, req.body);
    const id = db.run('INSERT INTO case_entities (case_id, kind, name, role, identifier, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', c.id, d.kind, d.name, d.role || null, d.identifier || null, d.notes || null, req.user.id, now()).lastInsertRowid;
    event(c.id, 'entidad', `Agregada ${d.kind}: ${d.name}`, req.user.id);
    touch(c.id);
    audit(db, req, 'case.entity_added', { entity: 'case', entityId: c.id, detail: { entityId: id } });
    res.status(201).json({ id });
  });
  r.put('/:id/entities/:eid', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const d = parse(entityBody, req.body);
    const r2 = db.run('UPDATE case_entities SET kind = ?, name = ?, role = ?, identifier = ?, notes = ? WHERE id = ? AND case_id = ?', d.kind, d.name, d.role || null, d.identifier || null, d.notes || null, Number(req.params.eid), c.id);
    if (!r2.changes) throw new HttpError(404, 'Entidad no encontrada.');
    event(c.id, 'entidad', `Editada: ${d.name}`, req.user.id);
    touch(c.id);
    res.json({ ok: true });
  });
  r.delete('/:id/entities/:eid', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const e = db.get('SELECT * FROM case_entities WHERE id = ? AND case_id = ?', Number(req.params.eid), c.id);
    if (!e) throw new HttpError(404, 'Entidad no encontrada.');
    db.run('DELETE FROM case_entities WHERE id = ?', e.id);
    event(c.id, 'entidad', `Eliminada: ${e.name}`, req.user.id);
    touch(c.id);
    audit(db, req, 'case.entity_removed', { entity: 'case', entityId: c.id, detail: { name: e.name } });
    res.json({ ok: true });
  });

  // ----- Teléfonos asociados -----
  r.post('/:id/phones', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const d = parse(z.object({ number: z.string().trim().min(3).max(40), label: z.string().trim().max(120).optional().default(''), entityId: z.coerce.number().int().positive().nullable().optional() }), req.body);
    const a = analyzePhone(d.number, getSetting(db, 'system.default_country'));
    if (!a.e164) throw new HttpError(400, 'El número no pudo normalizarse. Incluya el prefijo internacional (ej. +57).');
    if (d.entityId && !db.get('SELECT id FROM case_entities WHERE id = ? AND case_id = ?', d.entityId, c.id)) throw new HttpError(400, 'La entidad no pertenece al expediente.');
    if (db.get('SELECT id FROM case_phones WHERE case_id = ? AND e164 = ?', c.id, a.e164)) throw new HttpError(409, `El número ${a.e164} ya está asociado al expediente.`);
    const id = db.run('INSERT INTO case_phones (case_id, e164, label, entity_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', c.id, a.e164, d.label || a.summary.slice(0, 120), d.entityId ?? null, req.user.id, now()).lastInsertRowid;
    event(c.id, 'telefono', `Asociado ${a.e164}${a.valid ? '' : ' (no válido en el plan de numeración)'}`, req.user.id);
    touch(c.id);
    audit(db, req, 'case.phone_added', { entity: 'case', entityId: c.id, detail: { e164: a.e164 } });
    res.status(201).json({ id, e164: a.e164, valid: a.valid });
  });
  r.delete('/:id/phones/:pid', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const p = db.get('SELECT * FROM case_phones WHERE id = ? AND case_id = ?', Number(req.params.pid), c.id);
    if (!p) throw new HttpError(404, 'Número no encontrado.');
    db.run('DELETE FROM case_phones WHERE id = ?', p.id);
    event(c.id, 'telefono', `Desasociado ${p.e164}`, req.user.id);
    touch(c.id);
    res.json({ ok: true });
  });

  // ----- Observaciones -----
  r.post('/:id/notes', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const d = parse(z.object({ body: z.string().trim().min(2, 'La observación está vacía').max(10000) }), req.body);
    const id = db.run('INSERT INTO case_notes (case_id, body, author_id, created_at) VALUES (?, ?, ?, ?)', c.id, d.body, req.user.id, now()).lastInsertRowid;
    event(c.id, 'observacion', d.body.slice(0, 140), req.user.id);
    touch(c.id);
    res.status(201).json({ id });
  });
  r.delete('/:id/notes/:nid', requirePerm('cases.write'), (req, res) => {
    const c = getCase(req.params.id);
    writable(c);
    const n = db.get('SELECT * FROM case_notes WHERE id = ? AND case_id = ?', Number(req.params.nid), c.id);
    if (!n) throw new HttpError(404, 'Observación no encontrada.');
    if (n.author_id !== req.user.id && !req.permissions.has('cases.delete')) throw new HttpError(403, 'Solo el autor o un administrador puede eliminar la observación.');
    db.run('DELETE FROM case_notes WHERE id = ?', n.id);
    event(c.id, 'observacion_eliminada', n.body.slice(0, 140), req.user.id);
    audit(db, req, 'case.note_deleted', { entity: 'case', entityId: c.id, severity: 'warning' });
    res.json({ ok: true });
  });

  return r;
}

export function ensureDirs(config) {
  for (const d of [config.dataDir, config.evidenceDir, config.backupDir, path.join(config.dataDir, 'tmp')]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}
