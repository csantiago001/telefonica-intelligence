// Copias de seguridad cifradas (.tibak): TAR mínimo + AES-256-GCM. Sin dependencias externas.
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt, sha256 } from './crypto.js';

function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  h.write(name.slice(0, 99), 0, 'utf8');
  h.write('0000600\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

export function tarPack(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    parts.push(tarHeader(name, data.length, Date.now()), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function tarUnpack(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    off += 512;
    out.push({ name, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Crea una copia de seguridad cifrada y devuelve { file, size, sha256 }. */
export function createBackup(db, config, label = 'manual') {
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpDb = path.join(config.backupDir, `.snapshot-${stamp}.db`);
  db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  const entries = [{ name: 'ti.db', data: fs.readFileSync(tmpDb) }];
  fs.unlinkSync(tmpDb);
  for (const sub of ['evidencias', 'informes']) {
    const dir = path.join(config.dataDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isFile()) entries.push({ name: `${sub}/${f}`, data: fs.readFileSync(full) });
    }
  }
  const manifest = { app: 'telefonica-intelligence', format: 1, createdAt: new Date().toISOString(), mode: config.mode, label, files: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) })) };
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  const blob = encrypt(config.masterKey, tarPack(entries));
  const name = `respaldo-${stamp}-${label}.tibak`;
  const file = path.join(config.backupDir, name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from('TIBAK1'), blob]), { mode: 0o600 });
  return { name, file, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)), files: manifest.files.length };
}

export function readBackup(file, key) {
  const raw = fs.readFileSync(file);
  if (raw.subarray(0, 6).toString() !== 'TIBAK1') throw new Error('El archivo no es una copia de seguridad de Telefónica Intelligence.');
  let tar;
  try { tar = decrypt(key, raw.subarray(6)); } catch { throw new Error('No se pudo descifrar: la clave maestra (MASTER_KEY) no corresponde a esta copia o el archivo está dañado.'); }
  const entries = tarUnpack(tar);
  const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json').data.toString());
  for (const f of manifest.files) {
    const e = entries.find((x) => x.name === f.name);
    if (!e || sha256(e.data) !== f.sha256) throw new Error(`Integridad fallida en ${f.name}`);
  }
  return { manifest, entries: entries.filter((e) => e.name !== 'manifest.json') };
}

export function listBackups(config) {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.tibak')).map((f) => {
    const st = fs.statSync(path.join(config.backupDir, f));
    return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pruneBackups(config, keep) {
  const list = listBackups(config).filter((b) => b.name.includes('-auto'));
  for (const b of list.slice(keep)) fs.unlinkSync(path.join(config.backupDir, b.name));
}
