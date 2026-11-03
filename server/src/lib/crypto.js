import crypto from 'node:crypto';
import fs from 'node:fs';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Hash ficticio para igualar el tiempo de respuesta cuando el usuario no existe.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// AES-256-GCM: formato [iv 12][tag 16][datos]
export function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decrypt(key, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export const encryptString = (key, s) => encrypt(key, Buffer.from(s, 'utf8')).toString('base64');
export const decryptString = (key, b64) => decrypt(key, Buffer.from(b64, 'base64')).toString('utf8');

// Eliminación segura: sobrescribe con datos aleatorios antes de borrar.
export function secureDelete(file) {
  try {
    const { size } = fs.statSync(file);
    const fd = fs.openSync(file, 'r+');
    const chunk = 1024 * 1024;
    for (let off = 0; off < size; off += chunk) {
      fs.writeSync(fd, crypto.randomBytes(Math.min(chunk, size - off)), 0, Math.min(chunk, size - off), off);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.unlinkSync(file);
    return true;
  } catch {
    try { fs.unlinkSync(file); } catch { /* ya no existe */ }
    return false;
  }
}

export function hashIp(ip, key) {
  return crypto.createHmac('sha256', key).update(String(ip || '')).digest('hex').slice(0, 32);
}
