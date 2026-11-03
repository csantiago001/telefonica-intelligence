import { z } from 'zod';
import { now } from '../db/database.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message }));
    throw new HttpError(400, 'Datos inválidos: ' + details.map((d) => `${d.campo || 'entrada'} — ${d.mensaje}`).join('; '), details);
  }
  return r.data;
}

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(200).optional().default(''),
});

export function paginate(db, baseSql, params, { page, pageSize }, orderBy) {
  const total = db.get(`SELECT COUNT(*) AS n FROM (${baseSql})`, ...params).n;
  const items = db.all(`${baseSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function audit(db, req, action, { entity = null, entityId = null, detail = null, severity = 'info' } = {}) {
  const u = req?.user;
  db.run(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    u?.id ?? null, u?.username ?? null, action, entity, entityId == null ? null : String(entityId),
    detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
    req?.ip ?? null, severity, now()
  );
}

export function addAlert(db, { level = 'info', title, detail = null, link = null, userId = null }) {
  db.run('INSERT INTO alerts (level, title, detail, link, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', level, title, detail, link, userId, now());
}

export const jsonParse = (s, fallback = null) => {
  try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
};

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    // Mitiga inyección de fórmulas en hojas de cálculo.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')).join('\n');
  return '﻿' + head + '\n' + body + '\n';
}

export function nextCode(db, table, prefix) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db.get(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`, like);
  const n = row ? Number(row.code.split('-').pop()) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
