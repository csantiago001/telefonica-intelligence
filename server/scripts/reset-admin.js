// Recuperación de emergencia: crea/rehabilita un administrador cuando nadie puede ingresar.
// Uso (con la aplicación detenida): npm run reset-admin -- <usuario>
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDatabase, now } from '../src/db/database.js';
import { hashPassword } from '../src/lib/crypto.js';
import { seedRoles } from '../src/app.js';

const username = process.argv[2];
if (!username || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) { console.error('Uso: npm run reset-admin -- <usuario>'); process.exit(1); }
const config = loadConfig();
const db = openDatabase(config.dbFile);
seedRoles(db);
const role = db.get("SELECT id FROM roles WHERE key = 'admin'");
const temp = crypto.randomBytes(9).toString('base64url') + '7a';
const existing = db.get('SELECT id FROM users WHERE username = ?', username);
if (existing) {
  db.run('UPDATE users SET password_hash = ?, role_id = ?, active = 1, must_change_password = 1, totp_enabled = 0, totp_secret_enc = NULL, recovery_codes = NULL, updated_at = ? WHERE id = ?', hashPassword(temp), role.id, now(), existing.id);
  db.run('DELETE FROM sessions WHERE user_id = ?', existing.id);
} else {
  db.run('INSERT INTO users (username, full_name, password_hash, role_id, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', username, 'Administrador de emergencia', hashPassword(temp), role.id, now(), now());
}
db.run("INSERT INTO audit_log (username, action, detail, severity, created_at) VALUES (?, 'admin.emergency_reset', 'Restablecimiento desde consola', 'critical', ?)", username, now());
db.close();
console.log(`Administrador "${username}" habilitado.\nContraseña temporal: ${temp}\nDeberá cambiarla en el primer acceso. 2FA desactivado para esta cuenta.`);
