import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encrypt, decrypt, sha256 } from '../src/lib/crypto.js';
import { totp, verifyTotp, base32Encode, base32Decode } from '../src/lib/totp.js';
import { analyzePhone, normalizeInput } from '../src/lib/phone.js';
import { isPrivateIp } from '../src/lib/safeHttp.js';
import { validateTarget, normalizeDomain, extractHtmlMeta, searchLinks } from '../src/services/osint.js';
import { tarPack, tarUnpack } from '../src/lib/backup.js';
import { toCsv } from '../src/lib/util.js';

test('contraseñas: scrypt con sal, verificación y rechazo', () => {
  const h = hashPassword('MiClave2026');
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, hashPassword('MiClave2026'), 'cada hash usa sal distinta');
  assert.equal(verifyPassword('MiClave2026', h), true);
  assert.equal(verifyPassword('otra', h), false);
  assert.equal(verifyPassword('x', 'basura'), false);
});

test('AES-256-GCM: cifra, descifra y detecta manipulación', () => {
  const key = Buffer.alloc(32, 7);
  const blob = encrypt(key, Buffer.from('evidencia'));
  assert.equal(decrypt(key, blob).toString(), 'evidencia');
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decrypt(key, blob));
});

test('SHA-256 conocido', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('TOTP RFC 6238 (vector T=59 s)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totp(secret, 59_000), '287082');
  assert.equal(totp(secret, 1111111109_000), '081804');
  assert.equal(verifyTotp(secret, '287082', 59_000), true);
  assert.equal(verifyTotp(secret, '000000', 59_000), false);
  assert.equal(verifyTotp(secret, 'abc', 59_000), false);
});

test('teléfono: normalización y validación por país', () => {
  assert.equal(normalizeInput('(+57) 300-123 4567'), '+573001234567');
  assert.equal(normalizeInput('0057 3001234567'), '+573001234567');
  const m = analyzePhone('300 123 4567', 'CO');
  assert.equal(m.valid, true);
  assert.equal(m.e164, '+573001234567');
  assert.equal(m.country, 'CO');
  assert.equal(m.type, 'MOBILE');
  assert.equal(m.fields.find((f) => f.key === 'calling_code').value, '+57');
  const fixed = analyzePhone('+57 601 345 6789');
  assert.equal(fixed.type, 'FIXED_LINE');
  assert.match(fixed.fields.find((f) => f.key === 'region').value, /Bogotá/);
  const es = analyzePhone('+34 612 34 56 78', 'CO');
  assert.equal(es.country, 'ES');
  const bad = analyzePhone('12', 'CO');
  assert.equal(bad.valid, false);
  assert.equal(bad.classification, 'invalido');
  const short = analyzePhone('+57 300 12', 'CO');
  assert.equal(short.valid, false);
});

test('teléfono: el operador nunca se presenta como dato confirmado', () => {
  for (const n of ['+573001234567', '+12025550143', '+34612345678']) {
    const op = analyzePhone(n).fields.find((f) => f.key === 'operator');
    assert.equal(op.status, 'no_disponible');
    assert.equal(op.value, 'No determinado');
  }
});

test('SSRF: clasificación de IP privadas y públicas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.5.4', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '200.1.2.3', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('OSINT: validación de objetivos', () => {
  assert.equal(normalizeDomain('https://Www.Ejemplo.com/ruta?x=1'), 'www.ejemplo.com');
  assert.equal(validateTarget('dns', 'ejemplo.com'), 'ejemplo.com');
  assert.throws(() => validateTarget('dns', 'no es dominio'));
  assert.throws(() => validateTarget('ip', '999.1.1.1'));
  assert.equal(validateTarget('link', 'ejemplo.com'), 'https://ejemplo.com/');
  assert.throws(() => validateTarget('link', 'file:///etc/passwd'));
  assert.throws(() => validateTarget('nope', 'x'));
});

test('OSINT: extracción de metadatos HTML y búsqueda asistida', () => {
  const m = extractHtmlMeta('<html><head><title>Hola &amp; adiós</title><meta name="description" content="Desc"><meta property="og:title" content="OG"></head><a href="/a">x</a></html>');
  assert.equal(m.title, 'Hola & adiós');
  assert.equal(m.metas.description, 'Desc');
  assert.equal(m.metas['og:title'], 'OG');
  assert.equal(m.linkCount, 1);
  const s = searchLinks('+57 300 123 4567');
  assert.equal(s.isPhone, true);
  assert.ok(s.variants.includes('+573001234567'));
  assert.ok(s.links.every((l) => l.url.startsWith('https://')));
});

test('copias: TAR empaqueta y desempaqueta', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('hola') }, { name: 'dir/b.bin', data: Buffer.alloc(1000, 3) }];
  const out = tarUnpack(tarPack(entries));
  assert.equal(out.length, 2);
  assert.equal(out[0].data.toString(), 'hola');
  assert.deepEqual(out[1].data, entries[1].data);
});

test('CSV: escapa comillas y neutraliza fórmulas', () => {
  const csv = toCsv([{ a: '=1+1', b: 'x,"y"' }], [{ label: 'A', key: 'a' }, { label: 'B', key: 'b' }]);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /"x,""y"""/);
});
