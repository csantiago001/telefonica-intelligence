import { now } from '../db/database.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { getSetting } from '../lib/settings.js';
import { HttpError, jsonParse } from '../lib/util.js';

export const SESSION_COOKIE = 'ti_session';
export const CSRF_COOKIE = 'ti_csrf';

export function cookieOpts(config, httpOnly = true) {
  return { httpOnly, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
}

export function createSession(db, config, res, user, req, pending2fa = false) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const hours = Number(getSetting(db, 'system.session_hours')) || 8;
  const created = now();
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  db.run(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, pending_2fa, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token), user.id, csrf, req.ip, String(req.get('user-agent') || '').slice(0, 300), pending2fa ? 1 : 0, created, created, expires
  );
  res.cookie(SESSION_COOKIE, token, { ...cookieOpts(config), maxAge: hours * 3600_000 });
  res.cookie(CSRF_COOKIE, csrf, { ...cookieOpts(config, false), maxAge: hours * 3600_000 });
  return { csrf };
}

export function destroySession(db, config, req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, cookieOpts(config));
  res.clearCookie(CSRF_COOKIE, cookieOpts(config, false));
}

/** Carga la sesión (si existe) y adjunta req.user, req.session, req.permissions. */
export function sessionLoader(db) {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (!s) return next();
    const idle = Number(getSetting(db, 'system.idle_minutes')) || 60;
    const nowMs = Date.now();
    if (Date.parse(s.expires_at) < nowMs || Date.parse(s.last_seen_at) + idle * 60_000 < nowMs) {
      db.run('DELETE FROM sessions WHERE id = ?', s.id);
      req.sessionExpired = true;
      return next();
    }
    const user = db.get(
      `SELECT u.id, u.username, u.full_name, u.email, u.active, u.credits, u.totp_enabled, u.must_change_password,
              u.preferences, u.is_demo, r.key AS role_key, r.name AS role_name, r.permissions
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      s.user_id
    );
    if (!user || !user.active) {
      db.run('DELETE FROM sessions WHERE id = ?', s.id);
      return next();
    }
    // Actualiza actividad como máximo cada 30 s para reducir escrituras.
    if (nowMs - Date.parse(s.last_seen_at) > 30_000) db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now(), s.id);
    req.session = s;
    req.permissions = new Set(jsonParse(user.permissions, []));
    delete user.permissions;
    user.preferences = jsonParse(user.preferences, {});
    req.user = user;
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, req.sessionExpired ? 'La sesión expiró. Inicie sesión nuevamente.' : 'Autenticación requerida.'));
  if (req.session.pending_2fa) return next(new HttpError(401, 'Verificación de dos factores pendiente.'));
  next();
}

export const can = (req, perm) => !!req.permissions?.has(perm);

export const requirePerm = (...perms) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Autenticación requerida.'));
  const missing = perms.filter((p) => !can(req, p));
  if (missing.length) return next(new HttpError(403, `Permiso denegado. Se requiere: ${missing.join(', ')}.`));
  next();
};

/** CSRF de doble envío: la cabecera debe coincidir con el token de la sesión. */
export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.session) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.session.csrf_token) return next(new HttpError(403, 'Token CSRF inválido. Recargue la página.'));
  next();
}
