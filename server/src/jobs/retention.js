import fs from 'node:fs';
import path from 'node:path';
import { getSetting } from '../lib/settings.js';
import { secureDelete } from '../lib/crypto.js';
import { createBackup, pruneBackups } from '../lib/backup.js';
import { now } from '../db/database.js';

const cutoff = (days) => new Date(Date.now() - days * 864e5).toISOString();

/** Calcula (dryRun) o ejecuta la purga según las políticas de conservación. */
export function runRetention(db, config, { dryRun = false } = {}) {
  const pq = Number(getSetting(db, 'retention.phone_queries_days')) || 0;
  const oq = Number(getSetting(db, 'retention.osint_queries_days')) || 0;
  const geo = Number(getSetting(db, 'retention.geo_days')) || 0;
  const au = Number(getSetting(db, 'retention.audit_days')) || 0;
  const cc = Number(getSetting(db, 'retention.closed_cases_days')) || 0;
  const plan = {
    phone_queries: pq ? db.get('SELECT COUNT(*) n FROM phone_queries WHERE created_at < ?', cutoff(pq)).n : 0,
    osint_queries: oq ? db.get('SELECT COUNT(*) n FROM osint_queries WHERE created_at < ?', cutoff(oq)).n : 0,
    geo_links: geo ? db.get("SELECT COUNT(*) n FROM geo_links WHERE (expires_at < ? OR status IN ('revocado','eliminado')) AND created_at < ?", now(), cutoff(geo)).n : 0,
    audit_log: au ? db.get('SELECT COUNT(*) n FROM audit_log WHERE created_at < ?', cutoff(au)).n : 0,
    closed_cases: cc ? db.get("SELECT COUNT(*) n FROM cases WHERE status IN ('cerrado','archivado') AND closed_at < ?", cutoff(cc)).n : 0,
  };
  if (dryRun) return plan;
  db.tx(() => {
    if (pq) db.run('DELETE FROM phone_queries WHERE created_at < ?', cutoff(pq));
    if (oq) db.run('DELETE FROM osint_queries WHERE created_at < ?', cutoff(oq));
    if (geo) db.run("DELETE FROM geo_links WHERE (expires_at < ? OR status IN ('revocado','eliminado')) AND created_at < ?", now(), cutoff(geo));
    if (au) db.run('DELETE FROM audit_log WHERE created_at < ?', cutoff(au));
    if (cc) {
      const ids = db.all("SELECT id FROM cases WHERE status IN ('cerrado','archivado') AND closed_at < ?", cutoff(cc)).map((r) => r.id);
      for (const id of ids) {
        for (const e of db.all('SELECT storage_name FROM evidence WHERE case_id = ? AND deleted_at IS NULL', id)) secureDelete(path.join(config.evidenceDir, e.storage_name));
        db.run('UPDATE evidence SET deleted_at = ? WHERE case_id = ? AND deleted_at IS NULL', now(), id);
        db.run('DELETE FROM cases WHERE id = ?', id);
      }
    }
    // Mantenimiento: sesiones vencidas, intentos de acceso antiguos, enlaces de restablecimiento.
    db.run('DELETE FROM sessions WHERE expires_at < ?', now());
    db.run('DELETE FROM login_attempts WHERE created_at < ?', cutoff(30));
    db.run('DELETE FROM password_resets WHERE expires_at < ?', cutoff(7));
    db.run('DELETE FROM alerts WHERE read_at IS NOT NULL AND read_at < ?', cutoff(90));
  });
  // Archivos temporales huérfanos de cargas interrumpidas.
  const tmp = path.join(config.dataDir, 'tmp');
  if (fs.existsSync(tmp)) for (const f of fs.readdirSync(tmp)) {
    const full = path.join(tmp, f);
    if (Date.now() - fs.statSync(full).mtimeMs > 3600_000) secureDelete(full);
  }
  db.run("INSERT INTO audit_log (action, detail, severity, created_at) VALUES ('retention.executed', ?, 'info', ?)", JSON.stringify(plan), now());
  return plan;
}

export function startScheduler(db, config, log = console) {
  const tick = () => {
    try {
      runRetention(db, config);
      if (!config.isDemo && getSetting(db, 'backup.auto_daily')) {
        const last = db.get("SELECT value FROM settings WHERE key = 'backup.last_auto'");
        const lastTs = last ? JSON.parse(last.value) : null;
        if (!lastTs || Date.now() - Date.parse(lastTs) > 23 * 3600_000) {
          const b = createBackup(db, config, 'auto');
          db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('backup.last_auto', ?, ?)", JSON.stringify(now()), now());
          pruneBackups(config, Number(getSetting(db, 'backup.keep')) || 7);
          log.info?.(`[respaldo] Copia automática creada: ${b.name}`);
        }
      }
    } catch (e) {
      log.error?.('[tareas] Error en tarea programada:', e.message);
    }
  };
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, 6 * 3600_000);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
