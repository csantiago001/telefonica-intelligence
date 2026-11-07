import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import exifr from 'exifr';
import { now } from '../db/database.js';
import { encrypt, decrypt, sha256, secureDelete } from '../lib/crypto.js';
import { BUCKET } from '../lib/storage.js';
import { HttpError, parse, audit, pageSchema, paginate, jsonParse, nextCode, toCsv } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';

const ORIGINS = ['captura_pantalla', 'documento', 'fotografia', 'audio', 'video', 'registro_llamadas', 'exportacion_web', 'entregado_por_tercero', 'otro'];

async function extractMetadata(buf, mime, name) {
  const meta = { detectedType: mime || 'desconocido', extension: path.extname(name).toLowerCase() || null };
  try {
    if (/^image\//.test(mime)) {
      const ex = await exifr.parse(buf, { gps: true, tiff: true, exif: true, xmp: false, icc: false, iptc: false });
      if (ex) {
        const keep = ['Make', 'Model', 'Software', 'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'Orientation', 'LensModel', 'latitude', 'longitude', 'GPSAltitude'];
        meta.exif = Object.fromEntries(keep.filter((k) => ex[k] != null).map((k) => [k, ex[k] instanceof Date ? ex[k].toISOString() : ex[k]]));
        if (meta.exif.latitude != null) meta.containsGps = true;
      }
    } else if (mime === 'application/pdf' || buf.subarray(0, 5).toString() === '%PDF-') {
      const head = buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)).toString('latin1');
      const grab = (k) => (head.match(new RegExp(`/${k}\\s*\\(([^)]{0,200})\\)`)) || [])[1] || null;
      meta.pdf = { version: (head.match(/%PDF-(\d\.\d)/) || [])[1] || null, title: grab('Title'), author: grab('Author'), creator: grab('Creator'), producer: grab('Producer'), creationDate: grab('CreationDate'), modDate: grab('ModDate'), pages: (head.match(/\/Type\s*\/Page[^s]/g) || []).length || null };
    }
  } catch (e) {
    meta.metadataError = 'No fue posible leer metadatos: ' + e.message;
  }
  // Firma del archivo (magic bytes) para detectar extensiones engañosas.
  const sig = buf.subarray(0, 8).toString('hex');
  const sigs = { '89504e47': 'PNG', ffd8ff: 'JPEG', '25504446': 'PDF', '504b0304': 'ZIP/Office', '47494638': 'GIF', '49443303': 'MP3', '52494646': 'RIFF (WAV/WEBP/AVI)' };
  meta.signature = Object.entries(sigs).find(([k]) => sig.startsWith(k))?.[1] || null;
  return meta;
}

export default function evidenceRoutes({ db, config, storage }) {
  const r = Router();
  const tmpDir = path.join(config.dataDir, 'tmp');
  const upload = multer({
    storage: multer.diskStorage({ destination: tmpDir, filename: (_req, _f, cb) => cb(null, crypto.randomUUID() + '.upload') }),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 20 },
  });
  const custody = (evidenceId, action, detail, req) =>
    db.run('INSERT INTO evidence_custody (evidence_id, action, detail, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)', evidenceId, action, detail, req.user?.id ?? null, req.ip, now());
  const getEv = (id) => {
    const e = db.get('SELECT * FROM evidence WHERE id = ?', Number(id));
    if (!e) throw new HttpError(404, 'Evidencia no encontrada.');
    return e;
  };
  const readPlain = async (e) => {
    const enc = await storage.get(BUCKET.EVIDENCE, e.storage_name);
    if (!enc) throw new HttpError(410, 'El archivo de la evidencia no se encuentra en el almacenamiento.');
    try { return decrypt(config.masterKey, enc); } catch { throw new HttpError(500, 'No se pudo descifrar la evidencia: el archivo fue alterado o la clave maestra es distinta.'); }
  };

  r.get('/meta', (req, res) => res.json({ origins: ORIGINS, maxUploadMb: config.maxUploadMb }));

  r.get('/', requirePerm('evidence.read'), (req, res) => {
    const p = parse(pageSchema.extend({ caseId: z.coerce.number().int().optional(), origin: z.string().optional().default(''), format: z.enum(['json', 'csv']).default('json'), includeDeleted: z.enum(['0', '1']).default('0') }), req.query);
    const conds = [];
    const params = [];
    if (p.includeDeleted !== '1') conds.push('e.deleted_at IS NULL');
    if (p.q) { conds.push('(e.code LIKE ? OR e.title LIKE ? OR e.original_name LIKE ? OR e.sha256 LIKE ?)'); params.push(...Array(4).fill(`%${p.q}%`)); }
    if (p.caseId) { conds.push('e.case_id = ?'); params.push(p.caseId); }
    if (p.origin) { conds.push('e.origin = ?'); params.push(p.origin); }
    const sql = `SELECT e.id, e.code, e.case_id, c.code case_code, e.title, e.description, e.origin, e.original_name, e.mime_type, e.size_bytes, e.sha256, e.acquired_at,
                 e.created_at, e.last_verified_at, e.last_verified_ok, e.deleted_at, e.is_demo, u.full_name uploaded_by_name
                 FROM evidence e LEFT JOIN cases c ON c.id = e.case_id LEFT JOIN users u ON u.id = e.uploaded_by ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    if (p.format === 'csv') {
      const rows = db.all(sql + ' ORDER BY e.id', ...params);
      audit(db, req, 'evidence.inventory_exported', { detail: { rows: rows.length, caseId: p.caseId ?? null } });
      return res.type('text/csv').attachment('inventario-evidencias.csv').send(toCsv(rows, [
        { label: 'Código', key: 'code' }, { label: 'Expediente', key: 'case_code' }, { label: 'Título', key: 'title' }, { label: 'Origen', key: 'origin' },
        { label: 'Archivo original', key: 'original_name' }, { label: 'Tipo MIME', key: 'mime_type' }, { label: 'Tamaño (bytes)', key: 'size_bytes' },
        { label: 'SHA-256', key: 'sha256' }, { label: 'Fecha de adquisición', key: 'acquired_at' }, { label: 'Fecha de incorporación', key: 'created_at' },
        { label: 'Incorporado por', key: 'uploaded_by_name' }, { label: 'Última verificación', key: 'last_verified_at' },
        { label: 'Integridad', value: (x) => (x.last_verified_ok == null ? 'sin verificar' : x.last_verified_ok ? 'íntegra' : 'ALTERADA') }, { label: 'Eliminada', key: 'deleted_at' },
      ]));
    }
    res.json(paginate(db, sql, params, p, 'e.id DESC'));
  });

  r.post('/', requirePerm('evidence.write'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera el máximo permitido (${config.maxUploadMb} MB).` : 'Error al recibir el archivo: ' + err.message));
      handleUpload(req, res).catch((e) => {
        if (req.file) secureDelete(req.file.path);
        next(e);
      });
    });
  });

  async function handleUpload(req, res) {
    if (!req.file) throw new HttpError(400, 'Seleccione un archivo.');
    const d = parse(z.object({
      caseId: z.coerce.number().int().positive().optional().nullable(),
      title: z.string().trim().min(3, 'Título demasiado corto').max(200),
      description: z.string().trim().max(5000).optional().default(''),
      origin: z.enum(ORIGINS),
      acquiredAt: z.string().optional().default(''),
      sourceDetail: z.string().trim().max(500).optional().default(''),
    }), { ...req.body, caseId: req.body.caseId || null });
    if (d.caseId) {
      const c = db.get('SELECT status FROM cases WHERE id = ?', d.caseId);
      if (!c) throw new HttpError(400, 'El expediente no existe.');
      if (c.status === 'archivado') throw new HttpError(400, 'El expediente está archivado.');
    }
    const plain = fs.readFileSync(req.file.path);
    const hash = sha256(plain);
    const dup = db.get('SELECT code FROM evidence WHERE sha256 = ? AND deleted_at IS NULL AND (case_id IS ? OR case_id = ?)', hash, d.caseId ?? null, d.caseId ?? -1);
    if (dup) throw new HttpError(409, `Este archivo ya fue incorporado como ${dup.code} (mismo SHA-256).`);
    const originalName = path.basename(Buffer.from(req.file.originalname, 'latin1').toString('utf8')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 200) || 'archivo';
    const meta = await extractMetadata(plain, req.file.mimetype, originalName);
    if (d.sourceDetail) meta.sourceDetail = d.sourceDetail;
    const storageName = crypto.randomUUID() + '.enc';
    await storage.put(BUCKET.EVIDENCE, storageName, encrypt(config.masterKey, plain));
    secureDelete(req.file.path);
    const acquired = d.acquiredAt && !Number.isNaN(Date.parse(d.acquiredAt)) ? new Date(d.acquiredAt).toISOString() : null;
    const created = db.tx(() => {
      const code = nextCode(db, 'evidence', 'EV');
      const id = db.run(
        `INSERT INTO evidence (code, case_id, title, description, origin, original_name, mime_type, size_bytes, sha256, storage_name, metadata, acquired_at, uploaded_by, last_verified_at, last_verified_ok, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        code, d.caseId ?? null, d.title, d.description || null, d.origin, originalName, req.file.mimetype || null, plain.length, hash, storageName, JSON.stringify(meta), acquired, req.user.id, now(), config.isDemo ? 1 : 0, now()
      ).lastInsertRowid;
      custody(id, 'incorporacion', `Archivo ${originalName} (${plain.length} bytes). SHA-256 ${hash}. Origen: ${d.origin}${d.sourceDetail ? ' — ' + d.sourceDetail : ''}`, req);
      if (d.caseId) {
        db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', d.caseId, 'evidencia', `${code}: ${d.title} (SHA-256 ${hash.slice(0, 16)}…)`, req.user.id, now());
        db.run('UPDATE cases SET updated_at = ? WHERE id = ?', now(), d.caseId);
      }
      return { id, code };
    });
    audit(db, req, 'evidence.uploaded', { entity: 'evidence', entityId: created.id, detail: { code: created.code, sha256: hash, caseId: d.caseId ?? null } });
    res.status(201).json({ ...created, sha256: hash, size: plain.length, metadata: meta });
  }

  r.get('/:id', requirePerm('evidence.read'), (req, res) => {
    const e = getEv(req.params.id);
    delete e.storage_name;
    res.json({
      ...e,
      metadata: jsonParse(e.metadata, {}),
      case: e.case_id ? db.get('SELECT id, code, title FROM cases WHERE id = ?', e.case_id) : null,
      uploadedBy: db.get('SELECT full_name FROM users WHERE id = ?', e.uploaded_by)?.full_name || null,
      custody: db.all('SELECT c.*, u.full_name user_name FROM evidence_custody c LEFT JOIN users u ON u.id = c.user_id WHERE evidence_id = ? ORDER BY c.id', e.id),
    });
  });

  r.put('/:id', requirePerm('evidence.write'), (req, res) => {
    const e = getEv(req.params.id);
    if (e.deleted_at) throw new HttpError(400, 'La evidencia fue eliminada.');
    const d = parse(z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().max(5000).optional().default(''), caseId: z.coerce.number().int().positive().nullable().optional() }), req.body);
    const caseId = d.caseId === undefined ? e.case_id : d.caseId;
    if (caseId && !db.get('SELECT id FROM cases WHERE id = ?', caseId)) throw new HttpError(400, 'El expediente no existe.');
    db.run('UPDATE evidence SET title = ?, description = ?, case_id = ? WHERE id = ?', d.title, d.description || null, caseId, e.id);
    const changes = [];
    if (e.title !== d.title) changes.push(`título "${e.title}" → "${d.title}"`);
    if (e.case_id !== caseId) changes.push(`expediente ${e.case_id ?? '—'} → ${caseId ?? '—'}`);
    custody(e.id, 'modificacion_datos', changes.join('; ') || 'Descripción actualizada', req);
    if (caseId && caseId !== e.case_id) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', caseId, 'evidencia', `${e.code} asociada al expediente`, req.user.id, now());
    audit(db, req, 'evidence.updated', { entity: 'evidence', entityId: e.id, detail: changes });
    res.json({ ok: true });
  });

  r.post('/:id/verify', requirePerm('evidence.read'), async (req, res) => {
    const e = getEv(req.params.id);
    if (e.deleted_at) throw new HttpError(400, 'La evidencia fue eliminada.');
    let current = null;
    let ok = false;
    let error = null;
    try {
      current = sha256(await readPlain(e));
      ok = current === e.sha256;
    } catch (err) {
      error = err.message;
    }
    db.run('UPDATE evidence SET last_verified_at = ?, last_verified_ok = ? WHERE id = ?', now(), ok ? 1 : 0, e.id);
    custody(e.id, 'verificacion_integridad', ok ? 'Hash coincide' : `FALLÓ: ${error || `hash actual ${current}`}`, req);
    audit(db, req, 'evidence.verified', { entity: 'evidence', entityId: e.id, detail: { ok }, severity: ok ? 'info' : 'critical' });
    if (!ok) db.run('INSERT INTO alerts (level, title, detail, link, created_at) VALUES (?, ?, ?, ?, ?)', 'critical', `Integridad comprometida: ${e.code}`, error || 'El hash SHA-256 no coincide', `/evidencias/${e.id}`, now());
    res.json({ ok, expected: e.sha256, current, error, verifiedAt: now() });
  });

  r.get('/:id/download', requirePerm('evidence.download'), async (req, res) => {
    const e = getEv(req.params.id);
    if (e.deleted_at) throw new HttpError(410, 'La evidencia fue eliminada.');
    const plain = await readPlain(e);
    const hash = sha256(plain);
    if (hash !== e.sha256) {
      custody(e.id, 'descarga_bloqueada', 'El hash no coincide con el registrado', req);
      throw new HttpError(409, 'Descarga bloqueada: la integridad del archivo no coincide con el hash registrado.');
    }
    custody(e.id, 'descarga', `Descargado por ${req.user.username}`, req);
    audit(db, req, 'evidence.downloaded', { entity: 'evidence', entityId: e.id });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-SHA256', hash);
    res.attachment(e.original_name);
    res.send(plain);
  });

  r.delete('/:id', requirePerm('evidence.delete'), async (req, res) => {
    const e = getEv(req.params.id);
    if (e.deleted_at) throw new HttpError(400, 'Ya fue eliminada.');
    const d = parse(z.object({ reason: z.string().trim().min(5, 'Indique el motivo de la eliminación').max(1000) }), req.body);
    const wiped = await storage.remove(BUCKET.EVIDENCE, e.storage_name);
    db.run('UPDATE evidence SET deleted_at = ? WHERE id = ?', now(), e.id);
    custody(e.id, 'eliminacion', `Motivo: ${d.reason}. Borrado seguro: ${wiped ? 'sí' : 'archivo inexistente'}. Se conserva el registro y el hash para trazabilidad.`, req);
    if (e.case_id) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', e.case_id, 'evidencia_eliminada', `${e.code}: ${d.reason}`, req.user.id, now());
    audit(db, req, 'evidence.deleted', { entity: 'evidence', entityId: e.id, detail: { code: e.code, reason: d.reason }, severity: 'critical' });
    res.json({ ok: true });
  });

  return r;
}
