// Cliente HTTP con protección SSRF: valida la IP en el momento de la conexión (evita DNS rebinding),
// limita redirecciones, tiempo y tamaño de respuesta.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const ip4ToInt = (ip) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = ip4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => (n & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) === (ip4ToInt(base) & ((~0 << (32 - bits)) >>> 0)));
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(l) || l.startsWith('64:ff9b:') || l.startsWith('2001:db8');
  }
  return true;
}

export class FetchError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function safeLookup(allowPrivate) {
  return (hostname, options, cb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(new FetchError(`No se pudo resolver el dominio ${hostname} (${err.code || err.message})`, 'DNS'));
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
      const bad = list.find((a) => isPrivateIp(a.address));
      if (bad && !allowPrivate) return cb(new FetchError(`Destino bloqueado: ${hostname} resuelve a una dirección interna (${bad.address}).`, 'SSRF'));
      if (options.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Realiza una solicitud GET/HEAD segura.
 * @returns {Promise<{status, headers, body: Buffer, url, chain, tls, durationMs, truncated}>}
 */
export async function safeFetch(url, { method = 'GET', timeoutMs = 10000, maxBytes = 2 * 1024 * 1024, maxRedirects = 5, headers = {}, allowPrivate = false } = {}) {
  const started = Date.now();
  const chain = [];
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    let u;
    try { u = new URL(current); } catch { throw new FetchError('URL inválida', 'URL'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new FetchError('Solo se permiten URL http y https', 'URL');
    if (u.username || u.password) throw new FetchError('No se permiten credenciales en la URL', 'URL');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate) {
      throw new FetchError('Destino bloqueado: dirección IP interna.', 'SSRF');
    }
    const res = await requestOnce(u, { method, timeoutMs: Math.max(1000, timeoutMs - (Date.now() - started)), maxBytes, headers, allowPrivate });
    chain.push({ url: u.href, status: res.status, location: res.headers.location || null });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      current = new URL(res.headers.location, u).href;
      continue;
    }
    return { ...res, url: u.href, chain, durationMs: Date.now() - started };
  }
  throw new FetchError(`Demasiadas redirecciones (más de ${maxRedirects})`, 'REDIRECT');
}

function requestOnce(u, { method, timeoutMs, maxBytes, headers, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method,
        lookup: safeLookup(allowPrivate),
        headers: { 'User-Agent': 'TelefonicaIntelligence/1.0 (+investigacion-fuentes-abiertas)', Accept: '*/*', ...headers },
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        let tls = null;
        if (res.socket && typeof res.socket.getPeerCertificate === 'function') {
          const c = res.socket.getPeerCertificate();
          if (c && Object.keys(c).length) {
            tls = {
              subject: c.subject?.CN || null,
              issuer: c.issuer?.O || c.issuer?.CN || null,
              validFrom: c.valid_from ? new Date(c.valid_from).toISOString() : null,
              validTo: c.valid_to ? new Date(c.valid_to).toISOString() : null,
              altNames: (c.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean).slice(0, 50),
              protocol: res.socket.getProtocol?.() || null,
              authorized: res.socket.authorized,
            };
          }
        }
        const chunks = [];
        let size = 0;
        let truncated = false;
        res.on('data', (d) => {
          if (size + d.length > maxBytes) {
            truncated = true;
            chunks.push(d.subarray(0, maxBytes - size));
            size = maxBytes;
            res.destroy();
            return;
          }
          size += d.length;
          chunks.push(d);
        });
        const done = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), tls, truncated });
        res.on('end', done);
        res.on('close', done);
        res.on('error', (e) => (truncated ? done() : reject(new FetchError(e.message, 'NET'))));
      }
    );
    req.on('timeout', () => req.destroy(new FetchError(`Tiempo de espera agotado (${Math.round(timeoutMs / 1000)} s)`, 'TIMEOUT')));
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError(describeNetError(e), e.code || 'NET')));
    req.end();
  });
}

function describeNetError(e) {
  const map = {
    ECONNREFUSED: 'Conexión rechazada por el servidor',
    ENOTFOUND: 'El dominio no existe o no se pudo resolver',
    EAI_AGAIN: 'Fallo temporal de resolución DNS (¿sin conexión a Internet?)',
    ECONNRESET: 'La conexión fue interrumpida',
    ETIMEDOUT: 'Tiempo de conexión agotado',
    CERT_HAS_EXPIRED: 'El certificado TLS del sitio expiró',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'El sitio usa un certificado autofirmado',
    ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado TLS no corresponde al dominio',
  };
  return map[e.code] || e.message || 'Error de red';
}

export async function fetchJson(url, opts = {}) {
  const r = await safeFetch(url, { ...opts, headers: { Accept: 'application/json, application/rdap+json', ...(opts.headers || {}) } });
  if (r.status === 404) return { status: 404, data: null, url: r.url };
  if (r.status === 429) throw new FetchError('La fuente limitó las consultas (HTTP 429). Intente más tarde.', 'RATE');
  if (r.status >= 400) throw new FetchError(`La fuente respondió con HTTP ${r.status}`, 'HTTP');
  try {
    return { status: r.status, data: JSON.parse(r.body.toString('utf8')), url: r.url };
  } catch {
    throw new FetchError('La fuente devolvió una respuesta no válida (no JSON)', 'PARSE');
  }
}
