import { Router } from 'express';
import { z } from 'zod';
import { now } from '../db/database.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { HttpError, parse, audit, pageSchema, paginate, jsonParse, toCsv } from '../lib/util.js';
import { requirePerm, can } from '../middleware/auth.js';
import { adjustCredits } from '../lib/credits.js';
import { passwordPolicy } from './auth.js';

export default function adminRoutes({ db, config }) {
  const r = Router();

  // ---------- Usuarios ----------
  const userSelect = `SELECT u.id, u.username, u.full_name, u.email, u.active, u.credits, u.totp_enabled, u.last_login_at,
      u.created_at, u.is_demo, u.must_change_password, r.key role_key, r.name role_name, u.role_id FROM users u JOIN roles r ON r.id = u.role_id`;

  r.get('/users', requirePerm('admin.users'), (req, res) => {
    const p = parse(pageSchema, req.query);
    const where = p.q ? ' WHERE u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?' : '';
    const params = p.q ? Array(3).fill(`%${p.q}%`) : [];
    res.json(paginate(db, userSelect + where, params, p, 'u.created_at DESC'));
  });

  // Lista mínima para selectores (responsable de expediente, etc.)
  r.get('/users/options', (req, res) => {
    res.json(db.all('SELECT id, full_name, username FROM users WHERE active = 1 ORDER BY full_name'));
  });

  const userBody = z.object({
    username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo'),
    fullName: z.string().trim().min(3).max(120),
    email: z.string().trim().email('Correo inválido').max(160).optional().or(z.literal('')),
    roleId: z.coerce.number().int().positive(),
    active: z.boolean().default(true),
  });

  r.post('/users', requirePerm('admin.users'), (req, res) => {
    const data = parse(userBody.extend({ password: passwordPolicy(db), mustChangePassword: z.boolean().default(true) }), req.body);
    if (!db.get('SELECT id FROM roles WHERE id = ?', data.roleId)) throw new HttpError(400, 'Rol inexistente.');
    if (db.get('SELECT id FROM users WHERE username = ?', data.username)) throw new HttpError(409, 'El nombre de usuario ya existe.');
    const id = db.tx(() => {
      const id = db.run(
        `INSERT INTO users (username, full_name, email, password_hash, role_id, active, must_change_password, password_changed_at, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.username, data.fullName, data.email || null, hashPassword(data.password), data.roleId, data.active ? 1 : 0,
        data.mustChangePassword ? 1 : 0, now(), config.isDemo ? 1 : 0, now(), now()
      ).lastInsertRowid;
      const initial = Number(getSetting(db, 'credits.default_new_user')) || 0;
      if (initial > 0) adjustCredits(db, { userId: id, amount: initial, note: 'Saldo inicial', performedBy: req.user.id, isDemo: config.isDemo });
      return id;
    });
    audit(db, req, 'user.created', { entity: 'user', entityId: id, detail: { username: data.username, roleId: data.roleId } });
    res.status(201).json(db.get(userSelect + ' WHERE u.id = ?', id));
  });

  r.put('/users/:id', requirePerm('admin.users'), (req, res) => {
    const id = Number(req.params.id);
    const data = parse(userBody.omit({ username: true }), req.body);
    const target = db.get('SELECT u.*, r.key role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
    if (!target) throw new HttpError(404, 'Usuario no encontrado.');
    if (id === req.user.id && (!data.active || data.roleId !== target.role_id)) throw new HttpError(400, 'No puede desactivarse ni cambiar su propio rol.');
    const newRole = db.get('SELECT key FROM roles WHERE id = ?', data.roleId);
    if (!newRole) throw new HttpError(400, 'Rol inexistente.');
    if (target.role_key === 'admin' && (newRole.key !== 'admin' || !data.active)) {
      const admins = db.get("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'admin' AND u.active = 1").n;
      if (admins <= 1) throw new HttpError(400, 'Debe existir al menos un administrador activo.');
    }
    db.run('UPDATE users SET full_name = ?, email = ?, role_id = ?, active = ?, updated_at = ? WHERE id = ?', data.fullName, data.email || null, data.roleId, data.active ? 1 : 0, now(), id);
    if (!data.active) db.run('DELETE FROM sessions WHERE user_id = ?', id);
    audit(db, req, 'user.updated', { entity: 'user', entityId: id, detail: data });
    res.json(db.get(userSelect + ' WHERE u.id = ?', id));
  });

  r.post('/users/:id/reset-link', requirePerm('admin.users'), (req, res) => {
    const id = Number(req.params.id);
    const u = db.get('SELECT id, username FROM users WHERE id = ?', id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado.');
    const token = randomToken(32);
    const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
    db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now(), id);
    db.run('INSERT INTO password_resets (user_id, token_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', id, sha256(token), req.user.id, expires, now());
    audit(db, req, 'user.reset_link_issued', { entity: 'user', entityId: id, severity: 'warning' });
    res.json({ path: `/restablecer/${token}`, expiresAt: expires });
  });

  r.post('/users/:id/disable-2fa', requirePerm('admin.users'), (req, res) => {
    const id = Number(req.params.id);
    db.run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, recovery_codes = NULL WHERE id = ?', id);
    db.run('DELETE FROM sessions WHERE user_id = ?', id);
    audit(db, req, 'user.2fa_reset', { entity: 'user', entityId: id, severity: 'warning' });
    res.json({ ok: true });
  });

  r.post('/users/:id/logout-all', requirePerm('admin.users'), (req, res) => {
    const id = Number(req.params.id);
    const n = db.run('DELETE FROM sessions WHERE user_id = ?', id).changes;
    audit(db, req, 'user.sessions_revoked', { entity: 'user', entityId: id, detail: { sessions: n } });
    res.json({ ok: true, revoked: n });
  });

  // ---------- Roles ----------
  r.get('/roles', requirePerm('admin.roles'), (req, res) => {
    const roles = db.all('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) users FROM roles r ORDER BY r.id');
    res.json({ roles: roles.map((x) => ({ ...x, permissions: jsonParse(x.permissions, []) })), catalog: PERMISSIONS });
  });
  r.get('/roles/options', requirePerm('admin.users'), (req, res) => res.json(db.all('SELECT id, key, name FROM roles ORDER BY id')));

  const roleBody = z.object({
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().max(300).optional().default(''),
    permissions: z.array(z.string()).refine((a) => a.every((p) => p in PERMISSIONS), 'Permiso desconocido'),
  });

  r.post('/roles', requirePerm('admin.roles'), (req, res) => {
    const data = parse(roleBody, req.body);
    const key = data.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + randomToken(3).toLowerCase();
    const id = db.run('INSERT INTO roles (key, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 0)', key, data.name, data.description, JSON.stringify(data.permissions)).lastInsertRowid;
    audit(db, req, 'role.created', { entity: 'role', entityId: id, detail: data });
    res.status(201).json({ id });
  });

  r.put('/roles/:id', requirePerm('admin.roles'), (req, res) => {
    const id = Number(req.params.id);
    const data = parse(roleBody, req.body);
    const role = db.get('SELECT * FROM roles WHERE id = ?', id);
    if (!role) throw new HttpError(404, 'Rol no encontrado.');
    if (role.key === 'admin') throw new HttpError(400, 'El rol Administrador no puede modificarse para evitar pérdida de acceso.');
    db.run('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?', data.name, data.description, JSON.stringify(data.permissions), id);
    audit(db, req, 'role.updated', { entity: 'role', entityId: id, detail: data, severity: 'warning' });
    res.json({ ok: true });
  });

  r.delete('/roles/:id', requirePerm('admin.roles'), (req, res) => {
    const id = Number(req.params.id);
    const role = db.get('SELECT * FROM roles WHERE id = ?', id);
    if (!role) throw new HttpError(404, 'Rol no encontrado.');
    if (role.is_system) throw new HttpError(400, 'Los roles del sistema no pueden eliminarse.');
    if (db.get('SELECT COUNT(*) n FROM users WHERE role_id = ?', id).n) throw new HttpError(400, 'Hay usuarios con este rol. Reasígnelos primero.');
    db.run('DELETE FROM roles WHERE id = ?', id);
    audit(db, req, 'role.deleted', { entity: 'role', entityId: id, severity: 'warning' });
    res.json({ ok: true });
  });

  // ---------- Créditos ----------
  r.get('/credits/summary', requirePerm('credits.view'), (req, res) => {
    const mine = db.get('SELECT credits FROM users WHERE id = ?', req.user.id).credits;
    const consumed30 = db.get("SELECT COALESCE(-SUM(amount),0) n FROM credit_transactions WHERE user_id = ? AND kind = 'consumo' AND created_at > ?", req.user.id, new Date(Date.now() - 30 * 864e5).toISOString()).n;
    const byOp = db.all("SELECT operation, COUNT(*) count, -SUM(amount) total FROM credit_transactions WHERE user_id = ? AND kind = 'consumo' GROUP BY operation ORDER BY total DESC", req.user.id);
    const out = { balance: mine, consumed30, byOperation: byOp, costs: getSetting(db, 'credits.costs'), enforce: getSetting(db, 'credits.enforce'), defaultNewUser: getSetting(db, 'credits.default_new_user') };
    if (can(req, 'admin.credits')) {
      out.users = db.all('SELECT id, username, full_name, credits, active FROM users ORDER BY full_name');
      out.totalBalance = db.get('SELECT COALESCE(SUM(credits),0) n FROM users').n;
      out.totalConsumed = db.get("SELECT COALESCE(-SUM(amount),0) n FROM credit_transactions WHERE kind = 'consumo'").n;
    }
    res.json(out);
  });

  r.get('/credits/transactions', requirePerm('credits.view'), (req, res) => {
    const p = parse(pageSchema.extend({ userId: z.coerce.number().int().optional(), format: z.enum(['json', 'csv']).default('json') }), req.query);
    const all = can(req, 'admin.credits');
    const conds = [];
    const params = [];
    if (!all) { conds.push('t.user_id = ?'); params.push(req.user.id); }
    else if (p.userId) { conds.push('t.user_id = ?'); params.push(p.userId); }
    if (p.q) { conds.push('(t.operation LIKE ? OR t.note LIKE ? OR t.reference LIKE ? OR u.username LIKE ?)'); params.push(...Array(4).fill(`%${p.q}%`)); }
    const sql = `SELECT t.*, u.username, pb.username performed_by_name FROM credit_transactions t JOIN users u ON u.id = t.user_id
                 LEFT JOIN users pb ON pb.id = t.performed_by ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}`;
    if (p.format === 'csv') {
      const rows = db.all(sql + ' ORDER BY t.id DESC', ...params);
      res.type('text/csv').attachment('movimientos-creditos.csv').send(toCsv(rows, [
        { label: 'Fecha', key: 'created_at' }, { label: 'Usuario', key: 'username' }, { label: 'Tipo', key: 'kind' },
        { label: 'Operación', key: 'operation' }, { label: 'Cantidad', key: 'amount' }, { label: 'Saldo', key: 'balance_after' },
        { label: 'Referencia', key: 'reference' }, { label: 'Nota', key: 'note' }, { label: 'Realizado por', key: 'performed_by_name' },
      ]));
      return;
    }
    res.json(paginate(db, sql, params, p, 't.id DESC'));
  });

  r.post('/credits/adjust', requirePerm('admin.credits'), (req, res) => {
    const data = parse(z.object({ userId: z.coerce.number().int().positive(), amount: z.coerce.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000, 'Cantidad inválida'), note: z.string().trim().min(3, 'Indique el motivo').max(300) }), req.body);
    const balance = adjustCredits(db, { ...data, performedBy: req.user.id, isDemo: config.isDemo });
    audit(db, req, 'credits.adjusted', { entity: 'user', entityId: data.userId, detail: data });
    res.json({ ok: true, balance });
  });

  r.put('/credits/costs', requirePerm('admin.credits'), (req, res) => {
    const data = parse(z.object({ costs: z.record(z.string(), z.coerce.number().int().min(0).max(1000)), enforce: z.boolean(), defaultNewUser: z.coerce.number().int().min(0).max(100000) }), req.body);
    const current = getSetting(db, 'credits.costs');
    const merged = { ...current };
    for (const k of Object.keys(current)) if (k in data.costs) merged[k] = data.costs[k];
    setSetting(db, 'credits.costs', merged, req.user.id);
    setSetting(db, 'credits.enforce', data.enforce, req.user.id);
    setSetting(db, 'credits.default_new_user', data.defaultNewUser, req.user.id);
    audit(db, req, 'credits.costs_updated', { detail: data });
    res.json({ ok: true });
  });

  return r;
}
