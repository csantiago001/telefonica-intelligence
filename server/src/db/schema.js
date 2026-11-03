// Esquema versionado. Cada migración se aplica una sola vez (tabla schema_migrations).
export const MIGRATIONS = [
  {
    version: 1,
    name: 'esquema inicial',
    sql: `
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  credits INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  preferences TEXT NOT NULL DEFAULT '{}',
  last_login_at TEXT,
  password_changed_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  pending_2fa INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(username, created_at);

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);

CREATE TABLE cases (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  classification TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'abierto',
  tags TEXT NOT NULL DEFAULT '[]',
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cases_status ON cases(status);

CREATE TABLE case_entities (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  identifier TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE case_phones (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  e164 TEXT NOT NULL,
  label TEXT,
  entity_id INTEGER REFERENCES case_entities(id) ON DELETE SET NULL,
  phone_query_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(case_id, e164)
);

CREATE TABLE case_notes (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE case_events (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_case_events ON case_events(case_id, created_at);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  metadata TEXT,
  acquired_at TEXT,
  uploaded_by INTEGER,
  last_verified_at TEXT,
  last_verified_ok INTEGER,
  deleted_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_case ON evidence(case_id);

CREATE TABLE evidence_custody (
  id INTEGER PRIMARY KEY,
  evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  user_id INTEGER,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE phone_queries (
  id INTEGER PRIMARY KEY,
  input TEXT NOT NULL,
  default_country TEXT,
  e164 TEXT,
  valid INTEGER NOT NULL,
  country TEXT,
  result TEXT NOT NULL,
  case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  user_id INTEGER,
  credits_used INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_phone_queries_date ON phone_queries(created_at);

CREATE TABLE osint_queries (
  id INTEGER PRIMARY KEY,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  result TEXT,
  error TEXT,
  duration_ms INTEGER,
  case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  user_id INTEGER,
  credits_used INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_osint_queries_date ON osint_queries(created_at);

CREATE TABLE findings (
  id INTEGER PRIMARY KEY,
  case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  osint_query_id INTEGER REFERENCES osint_queries(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  detail TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT,
  reliability TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_by INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE geo_links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  recipient_label TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  expires_at TEXT NOT NULL,
  consent_at TEXT,
  consent_text TEXT,
  consent_ip_hash TEXT,
  consent_user_agent TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_by INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE geo_locations (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES geo_links(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  captured_at TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT,
  file_name TEXT,
  created_by INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE credit_transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  operation TEXT,
  reference TEXT,
  note TEXT,
  performed_by INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_credit_tx_user ON credit_transactions(user_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_date ON audit_log(created_at);
CREATE INDEX idx_audit_action ON audit_log(action);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  link TEXT,
  user_id INTEGER,
  read_at TEXT,
  created_at TEXT NOT NULL
);
`,
  },
];
