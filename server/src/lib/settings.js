import { now } from '../db/database.js';

export const DEFAULT_SETTINGS = {
  'system.organization': 'Unidad de Investigación',
  'system.session_hours': 8,
  'system.idle_minutes': 60,
  'system.default_country': 'CO',
  'security.max_login_attempts': 5,
  'security.lockout_minutes': 15,
  'security.password_min_length': 10,
  'security.require_2fa_admin': false,
  'geo.default_expiry_hours': 24,
  'geo.max_expiry_hours': 168,
  'credits.costs': { phone_analysis: 1, osint_dns: 1, osint_rdap: 2, osint_ct: 2, osint_wayback: 1, osint_link: 1, osint_search: 1, osint_ip: 2, report_pdf: 3, geo_link: 2 },
  'credits.default_new_user': 100,
  'credits.enforce': true,
  'osint.sources': { dns: true, rdap: true, ct: true, wayback: true, link: true, search: true, ip: true },
  'retention.phone_queries_days': 365,
  'retention.osint_queries_days': 365,
  'retention.geo_days': 30,
  'retention.audit_days': 730,
  'retention.closed_cases_days': 0,
  'backup.auto_daily': true,
  'backup.keep': 7,
  'search.provider': 'none',
};

export function getSetting(db, key) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export function getAllSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.all('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignora valores corruptos */ }
  }
  return out;
}

export function setSetting(db, key, value, userId = null) {
  db.run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key, JSON.stringify(value), now(), userId
  );
}
