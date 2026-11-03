import { Router } from 'express';
import { z } from 'zod';
import { now } from '../db/database.js';
import { randomToken, sha256, hashIp } from '../lib/crypto.js';
import { getSetting } from '../lib/settings.js';
import { ensureCredits, chargeCredits } from '../lib/credits.js';
import { HttpError, parse, audit, pageSchema, paginate, addAlert } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const CONSENT_VERSION = 'v1.0';
export function consentText(org, purpose, recipient) {
  return [
    `Responsable del tratamiento: ${org}.`,
    `Persona destinataria de la solicitud: ${recipient}.`,
    `Finalidad declarada: ${String(purpose).replace(/[.\s]+$/, "")}.`,
    'Datos que se recogerán: coordenadas (latitud y longitud), precisión estimada y la fecha y hora en que usted decida compartirlas. También se registra la fecha de su aceptación y un identificador cifrado de su conexión como prueba del consentimiento.',
    'La ubicación solo se envía si usted marca la casilla de aceptación, pulsa "Compartir mi ubicación" y su navegador le pide y usted concede el permiso. No se obtiene su ubicación de ninguna otra forma ni de manera continua.',
    'Su participación es voluntaria. Puede negarse sin consecuencia alguna en esta página.',
    'Puede revocar este consentimiento en cualquier momento desde este mismo enlace y solicitar la eliminación inmediata de los datos compartidos.',
    `Versión del texto de consentimiento: ${CONSENT_VERSION}.`,
  ].join('\n');
}

function effectiveStatus(l) {
  if (l.status === 'revocado' || l.status === 'eliminado') return l.status;
  if (Date.parse(l.expires_at) < Date.now()) return 'expirado';
  return l.status;
}

export function geoRoutes({ db, config }) {
  const r = Router();
  const getLink = (id) => {
    const l = db.get('SELECT g.*, c.code case_code, u.full_name created_by_name FROM geo_links g LEFT JOIN cases c ON c.id = g.case_id LEFT JOIN users u ON u.id = g.created_by WHERE g.id = ?', Number(id));
    if (!l) throw new HttpError(404, 'Enlace no encontrado.');
    return l;
  };
  const caseEvent = (caseId, detail, userId) => {
    if (caseId) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', caseId, 'ubicacion', detail, userId, now());
  };

  r.get('/links', requirePerm('geo.read'), (req, res) => {
    const p = parse(pageSchema.extend({ status: z.string().optional().default(''), caseId: z.coerce.number().int().optional() }), req.query);
    const conds = [];
    const params = [];
    if (p.q) { conds.push('(g.recipient_label LIKE ? OR g.purpose LIKE ? OR g.token_hint LIKE ?)'); params.push(...Array(3).fill(`%${p.q}%`)); }
    if (p.caseId) { conds.push('g.case_id = ?'); params.push(p.caseId); }
    if (p.status === 'expirado') { conds.push("g.status IN ('pendiente','activo') AND g.expires_at < ?"); params.push(now()); }
    else if (p.status) { conds.push('g.status = ?'); params.push(p.status); if (['pendiente', 'activo'].includes(p.status)) { conds.push('g.expires_at >= ?'); params.push(now()); } }
    const sql = `SELECT g.id, g.token_hint, g.case_id, c.code case_code, g.recipient_label, g.purpose, g.status, g.expires_at, g.consent_at, g.revoked_at, g.revoked_by, g.created_at, g.is_demo,
                 (SELECT COUNT(*) FROM geo_locations l WHERE l.link_id = g.id) locations
                 FROM geo_links g LEFT JOIN cases c ON c.id = g.case_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    const out = paginate(db, sql, params, p, 'g.id DESC');
    out.items = out.items.map((l) => ({ ...l, status: effectiveStatus(l) }));
    res.json(out);
  });

  r.post('/links', requirePerm('geo.write'), (req, res) => {
    const maxH = Number(getSetting(db, 'geo.max_expiry_hours')) || 168;
    const d = parse(z.object({
      caseId: z.coerce.number().int().positive().nullable().optional(),
      recipientLabel: z.string().trim().min(2, 'Indique a quién se envía').max(120),
      purpose: z.string().trim().min(10, 'Describa la finalidad (mínimo 10 caracteres)').max(500),
      expiresHours: z.coerce.number().int().min(1).max(maxH, `Máximo ${maxH} horas`),
      legalBasis: z.literal(true, { message: 'Debe confirmar que la persona será informada y que existe una finalidad legítima' }),
    }), req.body);
    if (d.caseId && !db.get('SELECT id FROM cases WHERE id = ?', d.caseId)) throw new HttpError(400, 'El expediente no existe.');
    ensureCredits(db, req.user, 'geo_link');
    const token = randomToken(24);
    const expires = new Date(Date.now() + d.expiresHours * 3600_000).toISOString();
    const id = db.run(
      'INSERT INTO geo_links (token_hash, token_hint, case_id, recipient_label, purpose, status, expires_at, created_by, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      sha256(token), token.slice(0, 6), d.caseId ?? null, d.recipientLabel, d.purpose, 'pendiente', expires, req.user.id, config.isDemo ? 1 : 0, now()
    ).lastInsertRowid;
    chargeCredits(db, req.user, 'geo_link', `geo_link:${id}`, config.isDemo);
    caseEvent(d.caseId, `Enlace de ubicación con consentimiento generado para ${d.recipientLabel} (vence ${expires.slice(0, 16).replace('T', ' ')})`, req.user.id);
    audit(db, req, 'geo.link_created', { entity: 'geo_link', entityId: id, detail: { recipient: d.recipientLabel, caseId: d.caseId ?? null, expires } });
    res.status(201).json({ id, path: `/consentimiento/${token}`, publicUrl: config.publicUrl ? `${config.publicUrl}/consentimiento/${token}` : null, expiresAt: expires });
  });

  r.get('/links/:id', requirePerm('geo.read'), (req, res) => {
    const l = getLink(req.params.id);
    delete l.token_hash;
    const locations = db.all('SELECT * FROM geo_locations WHERE link_id = ? ORDER BY id', l.id);
    audit(db, req, 'geo.link_viewed', { entity: 'geo_link', entityId: l.id });
    res.json({ ...l, status: effectiveStatus(l), locations });
  });

  r.post('/links/:id/revoke', requirePerm('geo.write'), (req, res) => {
    const l = getLink(req.params.id);
    if (['revocado', 'eliminado'].includes(l.status)) throw new HttpError(400, 'El enlace ya está revocado.');
    db.run("UPDATE geo_links SET status = 'revocado', revoked_at = ?, revoked_by = ? WHERE id = ?", now(), `analista:${req.user.username}`, l.id);
    caseEvent(l.case_id, `Enlace de ubicación para ${l.recipient_label} revocado por el analista`, req.user.id);
    audit(db, req, 'geo.link_revoked', { entity: 'geo_link', entityId: l.id });
    res.json({ ok: true });
  });

  r.delete('/links/:id/locations', requirePerm('geo.write'), (req, res) => {
    const l = getLink(req.params.id);
    const n = db.run('DELETE FROM geo_locations WHERE link_id = ?', l.id).changes;
    db.run("UPDATE geo_links SET status = CASE WHEN status = 'activo' THEN 'revocado' ELSE status END, revoked_at = COALESCE(revoked_at, ?), revoked_by = COALESCE(revoked_by, ?) WHERE id = ?", now(), `analista:${req.user.username}`, l.id);
    caseEvent(l.case_id, `Datos de ubicación eliminados (${n} registro(s)) para ${l.recipient_label}`, req.user.id);
    audit(db, req, 'geo.locations_deleted', { entity: 'geo_link', entityId: l.id, detail: { deleted: n }, severity: 'warning' });
    res.json({ ok: true, deleted: n });
  });

  r.delete('/links/:id', requirePerm('geo.write'), (req, res) => {
    const l = getLink(req.params.id);
    db.run('DELETE FROM geo_links WHERE id = ?', l.id);
    caseEvent(l.case_id, `Enlace de ubicación para ${l.recipient_label} eliminado con sus datos`, req.user.id);
    audit(db, req, 'geo.link_deleted', { entity: 'geo_link', entityId: l.id, severity: 'warning' });
    res.json({ ok: true });
  });

  return r;
}

// ---------------- Rutas públicas (persona que comparte su ubicación) ----------------
export function publicConsentRoutes({ db, config }) {
  const r = Router();
  r.use(rateLimit({ windowMs: 60_000, max: config.isTest ? 1000 : 30, key: 'consent' }));
  const load = (token) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'Enlace no válido.');
    const l = db.get('SELECT * FROM geo_links WHERE token_hash = ?', sha256(token));
    if (!l) throw new HttpError(404, 'Enlace no válido o eliminado.');
    return l;
  };
  const view = (l) => {
    const org = getSetting(db, 'system.organization');
    const status = effectiveStatus(l);
    return {
      status, organization: org, recipientLabel: l.recipient_label, purpose: l.purpose, expiresAt: l.expires_at, consentAt: l.consent_at, revokedAt: l.revoked_at,
      consentText: l.consent_text || consentText(org, l.purpose, l.recipient_label), consentVersion: CONSENT_VERSION,
      sharedCount: db.get('SELECT COUNT(*) n FROM geo_locations WHERE link_id = ?', l.id).n, isDemo: !!l.is_demo,
    };
  };

  r.get('/:token', (req, res) => res.json(view(load(req.params.token))));

  r.post('/:token/accept', (req, res) => {
    const l = load(req.params.token);
    const st = effectiveStatus(l);
    if (st === 'expirado') throw new HttpError(410, 'Este enlace expiró. No se registró ningún dato.');
    if (st === 'revocado' || st === 'eliminado') throw new HttpError(410, 'El consentimiento fue revocado. No se registró ningún dato.');
    const d = parse(z.object({
      accepted: z.literal(true, { message: 'Debe aceptar expresamente el consentimiento' }),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(1_000_000).nullable().optional(),
      capturedAt: z.number().int().positive().optional(),
    }), req.body);
    const count = db.get('SELECT COUNT(*) n FROM geo_locations WHERE link_id = ?', l.id).n;
    if (count >= 20) throw new HttpError(429, 'Se alcanzó el máximo de envíos para este enlace.');
    const org = getSetting(db, 'system.organization');
    db.tx(() => {
      if (!l.consent_at) {
        db.run("UPDATE geo_links SET status = 'activo', consent_at = ?, consent_text = ?, consent_ip_hash = ?, consent_user_agent = ? WHERE id = ?",
          now(), consentText(org, l.purpose, l.recipient_label), hashIp(req.ip, config.masterKey), String(req.get('user-agent') || '').slice(0, 300), l.id);
      }
      db.run('INSERT INTO geo_locations (link_id, latitude, longitude, accuracy_m, captured_at, received_at) VALUES (?, ?, ?, ?, ?, ?)',
        l.id, d.latitude, d.longitude, d.accuracy ?? null, d.capturedAt ? new Date(d.capturedAt).toISOString() : null, now());
    });
    if (l.case_id) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', l.case_id, 'ubicacion', `${l.recipient_label} aceptó el consentimiento y compartió su ubicación`, null, now());
    addAlert(db, { level: 'info', title: 'Ubicación compartida con consentimiento', detail: `${l.recipient_label} compartió su ubicación.`, link: `/geolocalizacion/${l.id}`, userId: l.created_by });
    audit(db, { ip: req.ip }, 'geo.consent_accepted', { entity: 'geo_link', entityId: l.id });
    res.json({ ok: true, ...view(db.get('SELECT * FROM geo_links WHERE id = ?', l.id)) });
  });

  r.post('/:token/revoke', (req, res) => {
    const l = load(req.params.token);
    const d = parse(z.object({ deleteData: z.boolean().default(true) }), req.body);
    if (l.status === 'revocado' && !d.deleteData) throw new HttpError(400, 'El consentimiento ya estaba revocado.');
    let deleted = 0;
    db.tx(() => {
      db.run("UPDATE geo_links SET status = 'revocado', revoked_at = COALESCE(revoked_at, ?), revoked_by = COALESCE(revoked_by, 'titular') WHERE id = ?", now(), l.id);
      if (d.deleteData) deleted = db.run('DELETE FROM geo_locations WHERE link_id = ?', l.id).changes;
    });
    if (l.case_id) db.run('INSERT INTO case_events (case_id, type, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)', l.case_id, 'ubicacion', `${l.recipient_label} revocó el consentimiento${d.deleteData ? ` y eliminó ${deleted} ubicación(es)` : ''}`, null, now());
    addAlert(db, { level: 'warning', title: 'Consentimiento de ubicación revocado', detail: `${l.recipient_label} revocó su consentimiento.`, link: `/geolocalizacion/${l.id}`, userId: l.created_by });
    audit(db, { ip: req.ip }, 'geo.consent_revoked_by_subject', { entity: 'geo_link', entityId: l.id, detail: { deleted } });
    res.json({ ok: true, deleted, ...view(db.get('SELECT * FROM geo_links WHERE id = ?', l.id)) });
  });

  return r;
}
