import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { now } from '../db/database.js';
import { hashPassword, verifyPassword, DUMMY_HASH, randomToken, sha256, encryptString, decryptString } from '../lib/crypto.js';
import { generateSecret, verifyTotp, otpauthUrl } from '../lib/totp.js';
import { getSetting } from '../lib/settings.js';
import { HttpError, parse, audit, addAlert, jsonParse } from '../lib/util.js';
import { createSession, destroySession, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { adjustCredits } from '../lib/credits.js';

export function passwordPolicy(db) {
  const min = Number(getSetting(db, 'security.password_min_length')) || 10;
  return z
    .string()
    .min(min, `La contraseña debe tener al menos ${min} caracteres`)
    .max(200)
    .refine((p) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(p) && /\d/.test(p), 'La contraseña debe combinar letras y números');
}

export function publicUser(u, permissions) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    role: u.role_key,
    roleName: u.role_name,
    credits: u.credits,
    totpEnabled: !!u.totp_enabled,
    mustChangePassword: !!u.must_change_password,
    preferences: u.preferences || {},
    isDemo: !!u.is_demo,
    permissions: [...(permissions || [])],
  };
}

export default function authRoutes({ db, config }) {
  const r = Router();
  const authLimiter = rateLimit({ windowMs: 60_000, max: config.isTest ? 1000 : 20, key: 'auth', message: 'Demasiados intentos. Espere un minuto.' });

  r.get('/status', (req, res) => {
    const users = db.get('SELECT COUNT(*) n FROM users').n;
    const org = getSetting(db, 'system.organization');
    res.json({
      mode: config.mode,
      setupRequired: users === 0 && !config.isDemo,
      organization: org,
      authenticated: !!req.user && !req.session?.pending_2fa,
      pending2fa: !!req.session?.pending_2fa,
      user: req.user && !req.session.pending_2fa ? publicUser(req.user, req.permissions) : null,
      csrf: req.session?.csrf_token || null,
      demoAccounts: config.isDemo
        ? [
            { username: 'admin.demo', password: 'Demo2026admin', role: 'Administrador' },
            { username: 'analista.demo', password: 'Demo2026analista', role: 'Analista' },
            { username: 'consultor.demo', password: 'Demo2026consultor', role: 'Consultor' },
          ]
        : undefined,
    });
  });

  r.post('/setup', authLimiter, (req, res) => {
    if (config.isDemo) throw new HttpError(400, 'El entorno de demostración no admite configuración inicial.');
    const data = parse(
      z.object({
        organization: z.string().trim().min(2).max(120),
        fullName: z.string().trim().min(3).max(120),
        username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo'),
        email: z.string().trim().email('Correo inválido').max(160).optional().or(z.literal('')),
        password: passwordPolicy(db),
      }),
      req.body
    );
    const user = db.tx(() => {
      if (db.get('SELECT COUNT(*) n FROM users').n > 0) throw new HttpError(409, 'La plataforma ya fue configurada.');
      const role = db.get("SELECT id FROM roles WHERE key = 'admin'");
      const id = db.run(
        'INSERT INTO users (username, full_name, email, password_hash, role_id, credits, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
        data.username, data.fullName, data.email || null, hashPassword(data.password), role.id, now(), now(), now()
      ).lastInsertRowid;
      db.run('INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', 'system.organization', JSON.stringify(data.organization), now(), id);
      adjustCredits(db, { userId: id, amount: 1000, note: 'Saldo inicial del administrador', performedBy: id });
      return { id, username: data.username };
    });
    audit(db, { user, ip: req.ip }, 'setup.completed', { entity: 'user', entityId: user.id, severity: 'warning' });
    res.status(201).json({ ok: true });
  });

  r.post('/login', authLimiter, (req, res) => {
    const { username, password } = parse(z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }), req.body);
    const maxAttempts = Number(getSetting(db, 'security.max_login_attempts')) || 5;
    const lockMin = Number(getSetting(db, 'security.lockout_minutes')) || 15;
    const since = new Date(Date.now() - lockMin * 60_000).toISOString();
    const lastOk = db.get('SELECT MAX(created_at) t FROM login_attempts WHERE username = ? AND success = 1', username).t || '';
    const failures = db.get(
      'SELECT COUNT(*) n FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ? AND created_at > ?',
      username, since, lastOk
    ).n;
    if (failures >= maxAttempts) {
      audit(db, { ip: req.ip }, 'auth.login_blocked', { detail: { username }, severity: 'warning' });
      throw new HttpError(429, `Cuenta bloqueada temporalmente por ${maxAttempts} intentos fallidos. Intente de nuevo en ${lockMin} minutos.`);
    }
    const user = db.get(
      `SELECT u.*, r.key role_key, r.name role_name, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
      username
    );
    const ok = verifyPassword(password, user?.password_hash || DUMMY_HASH) && !!user;
    db.run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, ?, ?)', username, req.ip, ok && user.active ? 1 : 0, now());
    if (!ok || !user.active) {
      audit(db, { ip: req.ip }, 'auth.login_failed', { detail: { username }, severity: 'warning' });
      if (failures + 1 >= maxAttempts) {
        addAlert(db, { level: 'warning', title: 'Cuenta bloqueada por intentos fallidos', detail: `Usuario: ${username}. IP: ${req.ip}`, link: '/configuracion/auditoria' });
      }
      throw new HttpError(401, user && !user.active && ok ? 'La cuenta está desactivada.' : 'Usuario o contraseña incorrectos.');
    }
    const pending = !!user.totp_enabled;
    const { csrf } = createSession(db, config, res, user, req, pending);
    if (!pending) {
      db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
      audit(db, { user, ip: req.ip }, 'auth.login', { entity: 'user', entityId: user.id });
    }
    const perms = jsonParse(user.permissions, []);
    user.preferences = jsonParse(user.preferences, {});
    res.json({ ok: true, pending2fa: pending, csrf, user: pending ? null : publicUser(user, perms) });
  });

  r.post('/2fa/verify', authLimiter, (req, res) => {
    if (!req.session || !req.session.pending_2fa) throw new HttpError(400, 'No hay una verificación de dos factores pendiente.');
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    let ok = false;
    let usedRecovery = false;
    if (/^\d{6}$/.test(code)) {
      ok = verifyTotp(decryptString(config.masterKey, u.totp_secret_enc), code);
    } else {
      const codes = jsonParse(u.recovery_codes, []);
      const h = sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (codes.includes(h)) {
        ok = true;
        usedRecovery = true;
        db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(codes.filter((c) => c !== h)), u.id);
      }
    }
    db.run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, ?, ?)', u.username, req.ip, ok ? 1 : 0, now());
    if (!ok) {
      audit(db, req, 'auth.2fa_failed', { severity: 'warning' });
      throw new HttpError(401, 'Código de verificación incorrecto.');
    }
    db.run('UPDATE sessions SET pending_2fa = 0 WHERE id = ?', req.session.id);
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), u.id);
    audit(db, req, usedRecovery ? 'auth.login_recovery_code' : 'auth.login', { entity: 'user', entityId: u.id, severity: usedRecovery ? 'warning' : 'info' });
    res.json({ ok: true, user: publicUser(req.user, req.permissions) });
  });

  r.post('/logout', (req, res) => {
    if (req.user) audit(db, req, 'auth.logout');
    destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  // Restablecimiento con enlace emitido por un administrador (de un solo uso).
  r.get('/reset/:token', authLimiter, (req, res) => {
    const pr = db.get('SELECT p.*, u.username FROM password_resets p JOIN users u ON u.id = p.user_id WHERE token_hash = ?', sha256(req.params.token));
    if (!pr || pr.used_at || Date.parse(pr.expires_at) < Date.now()) throw new HttpError(404, 'El enlace de restablecimiento no es válido o expiró.');
    res.json({ username: pr.username, expiresAt: pr.expires_at });
  });

  r.post('/reset/:token', authLimiter, (req, res) => {
    const { password } = parse(z.object({ password: passwordPolicy(db) }), req.body);
    const pr = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(req.params.token));
    if (!pr || pr.used_at || Date.parse(pr.expires_at) < Date.now()) throw new HttpError(404, 'El enlace de restablecimiento no es válido o expiró.');
    db.tx(() => {
      db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', now(), pr.id);
      db.run('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?', hashPassword(password), now(), now(), pr.user_id);
      db.run('DELETE FROM sessions WHERE user_id = ?', pr.user_id);
    });
    audit(db, { user: { id: pr.user_id }, ip: req.ip }, 'auth.password_reset', { entity: 'user', entityId: pr.user_id, severity: 'warning' });
    res.json({ ok: true });
  });

  // ---- A partir de aquí requiere sesión completa ----
  r.use(requireAuth);

  r.get('/me', (req, res) => res.json(publicUser(req.user, req.permissions)));

  r.post('/password', authLimiter, (req, res) => {
    const data = parse(z.object({ current: z.string().min(1).max(200), next: passwordPolicy(db) }), req.body);
    const u = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(data.current, u.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
    if (data.current === data.next) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual.');
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?', hashPassword(data.next), now(), now(), req.user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', req.user.id, req.session.id);
    audit(db, req, 'auth.password_changed', { entity: 'user', entityId: req.user.id });
    res.json({ ok: true });
  });

  r.put('/profile', (req, res) => {
    const data = parse(
      z.object({
        fullName: z.string().trim().min(3).max(120),
        email: z.string().trim().email('Correo inválido').max(160).optional().or(z.literal('')),
        preferences: z
          .object({
            pageSize: z.coerce.number().int().refine((n) => [10, 20, 50, 100].includes(n)).optional(),
            defaultCountry: z.string().length(2).toUpperCase().optional(),
            compact: z.boolean().optional(),
            reduceMotion: z.boolean().optional(),
          })
          .optional(),
      }),
      req.body
    );
    const prefs = { ...req.user.preferences, ...(data.preferences || {}) };
    db.run('UPDATE users SET full_name = ?, email = ?, preferences = ?, updated_at = ? WHERE id = ?', data.fullName, data.email || null, JSON.stringify(prefs), now(), req.user.id);
    audit(db, req, 'user.profile_updated', { entity: 'user', entityId: req.user.id });
    res.json({ ok: true });
  });

  r.post('/2fa/setup', (req, res, next) => {
    if (req.user.totp_enabled) throw new HttpError(400, 'La autenticación de dos factores ya está activa.');
    const secret = generateSecret();
    db.run('UPDATE users SET totp_secret_enc = ? WHERE id = ?', encryptString(config.masterKey, secret), req.user.id);
    const url = otpauthUrl(secret, req.user.username);
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0f1210', light: '#ffffff' } })
      .then((qr) => res.json({ secret, otpauthUrl: url, qr }))
      .catch(next);
  });

  r.post('/2fa/enable', (req, res) => {
    const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos') }), req.body);
    const u = db.get('SELECT totp_secret_enc, totp_enabled FROM users WHERE id = ?', req.user.id);
    if (u.totp_enabled) throw new HttpError(400, 'Ya está activa.');
    if (!u.totp_secret_enc) throw new HttpError(400, 'Primero inicie la configuración.');
    if (!verifyTotp(decryptString(config.masterKey, u.totp_secret_enc), code)) throw new HttpError(400, 'Código incorrecto. Verifique la hora de su dispositivo.');
    const codes = Array.from({ length: 8 }, () => randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 8));
    db.run('UPDATE users SET totp_enabled = 1, recovery_codes = ? WHERE id = ?', JSON.stringify(codes.map((c) => sha256(c))), req.user.id);
    audit(db, req, 'auth.2fa_enabled', { entity: 'user', entityId: req.user.id });
    res.json({ ok: true, recoveryCodes: codes.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`) });
  });

  r.post('/2fa/disable', (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const u = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(password, u.password_hash)) throw new HttpError(400, 'Contraseña incorrecta.');
    if (req.user.role_key === 'admin' && getSetting(db, 'security.require_2fa_admin')) throw new HttpError(400, 'La política exige 2FA para administradores.');
    db.run('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, recovery_codes = NULL WHERE id = ?', req.user.id);
    audit(db, req, 'auth.2fa_disabled', { entity: 'user', entityId: req.user.id, severity: 'warning' });
    res.json({ ok: true });
  });

  r.get('/sessions', (req, res) => {
    const rows = db.all('SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND pending_2fa = 0 ORDER BY last_seen_at DESC', req.user.id);
    res.json(rows.map((s) => ({ ...s, current: s.id === req.session.id })));
  });

  r.delete('/sessions/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.id) throw new HttpError(400, 'Use "Cerrar sesión" para la sesión actual.');
    const r2 = db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', id, req.user.id);
    if (!r2.changes) throw new HttpError(404, 'Sesión no encontrada.');
    audit(db, req, 'auth.session_revoked', { entityId: id });
    res.json({ ok: true });
  });

  return r;
}
