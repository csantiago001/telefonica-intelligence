import { now } from '../db/database.js';
import { getSetting } from './settings.js';
import { HttpError } from './util.js';

export function costOf(db, operation) {
  const costs = getSetting(db, 'credits.costs') || {};
  return Number(costs[operation] ?? 0);
}

/** Comprueba saldo antes de ejecutar una operación (no descuenta). */
export function ensureCredits(db, user, operation) {
  const cost = costOf(db, operation);
  if (!getSetting(db, 'credits.enforce') || cost <= 0) return cost;
  const { credits } = db.get('SELECT credits FROM users WHERE id = ?', user.id);
  if (credits < cost) throw new HttpError(402, `Créditos insuficientes: la operación cuesta ${cost} y su saldo es ${credits}. Solicite una asignación al administrador.`);
  return cost;
}

/** Descuenta créditos de forma atómica y registra el movimiento. */
export function chargeCredits(db, user, operation, reference, isDemo = 0) {
  const cost = costOf(db, operation);
  if (cost <= 0) return 0;
  const enforce = getSetting(db, 'credits.enforce');
  return db.tx(() => {
    const r = enforce
      ? db.run('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?', cost, user.id, cost)
      : db.run('UPDATE users SET credits = credits - ? WHERE id = ?', cost, user.id);
    if (r.changes === 0) throw new HttpError(402, 'Créditos insuficientes para completar la operación.');
    const { credits } = db.get('SELECT credits FROM users WHERE id = ?', user.id);
    db.run(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, kind, operation, reference, performed_by, is_demo, created_at)
       VALUES (?, ?, ?, 'consumo', ?, ?, ?, ?, ?)`,
      user.id, -cost, credits, operation, reference ?? null, user.id, isDemo ? 1 : 0, now()
    );
    return cost;
  });
}

export function adjustCredits(db, { userId, amount, note, performedBy, kind = amount >= 0 ? 'asignacion' : 'ajuste', isDemo = 0 }) {
  return db.tx(() => {
    const u = db.get('SELECT credits FROM users WHERE id = ?', userId);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    if (u.credits + amount < 0) throw new HttpError(400, 'El ajuste dejaría el saldo en negativo.');
    db.run('UPDATE users SET credits = credits + ? WHERE id = ?', amount, userId);
    const balance = u.credits + amount;
    db.run(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, kind, operation, note, performed_by, is_demo, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      userId, amount, balance, kind, note ?? null, performedBy ?? null, isDemo ? 1 : 0, now()
    );
    return balance;
  });
}
