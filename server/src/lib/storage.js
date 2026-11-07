// Almacenamiento de archivos cifrados (evidencias, informes) con dos backends:
//  - local: sistema de archivos (comportamiento por defecto, uso local).
//  - r2: Cloudflare R2 (API compatible con S3), para despliegue permanente en la nube.
// La selección se hace por configuración. Los archivos ya van cifrados (AES-256-GCM);
// aquí solo se guardan/leen los bytes.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { secureDelete } from './crypto.js';

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
// Codificación de cada segmento de la ruta según S3 (RFC 3986, sin codificar "/").
const encodeSegment = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encodeKey = (key) => key.split('/').map(encodeSegment).join('/');

/** Firma AWS Signature V4 para una petición a un servicio compatible con S3. */
export function signV4({ method, host, canonicalUri, query = {}, payloadHash, headers = {}, accessKey, secretKey, region, service = 's3', now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const allHeaders = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...headers };
  const signedKeys = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = signedKeys.map((k) => {
    const realKey = Object.keys(allHeaders).find((x) => x.toLowerCase() === k);
    return `${k}:${String(allHeaders[realKey]).trim()}\n`;
  }).join('');
  const signedHeaders = signedKeys.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encodeSegment(k)}=${encodeSegment(query[k])}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, signature, signedHeaders };
}

function r2Request(cfg, method, key, body) {
  return new Promise((resolve, reject) => {
    const payloadHash = sha256hex(body || Buffer.alloc(0));
    const canonicalUri = `/${encodeKey(cfg.bucket)}/${encodeKey(key)}`;
    const extraHeaders = body ? { 'content-length': String(body.length), 'content-type': 'application/octet-stream' } : {};
    const { authorization, amzDate } = signV4({
      method, host: cfg.host, canonicalUri, payloadHash, headers: extraHeaders,
      accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, service: 's3',
    });
    const agent = cfg.useHttp ? http : https;
    const [hostname, portStr] = cfg.host.split(':');
    const req = agent.request({
      method, host: hostname, port: portStr ? Number(portStr) : undefined, path: canonicalUri, timeout: 30000,
      headers: { Host: cfg.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization, ...extraHeaders },
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body: data });
        else if (res.statusCode === 404) resolve({ status: 404, body: data });
        else reject(new Error(`R2 ${method} ${key}: HTTP ${res.statusCode} ${data.toString('utf8').slice(0, 300)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`R2 ${method} ${key}: tiempo de espera agotado`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Crea el almacenamiento según la configuración (local o R2). */
export function createStorage(config) {
  if (config.storage === 'r2') {
    const cfg = config.r2;
    return {
      kind: 'r2',
      async put(bucket, name, buf) { await r2Request(cfg, 'PUT', `${bucket}/${name}`, buf); },
      async get(bucket, name) {
        const r = await r2Request(cfg, 'GET', `${bucket}/${name}`);
        if (r.status === 404) return null;
        return r.body;
      },
      async exists(bucket, name) {
        const r = await r2Request(cfg, 'HEAD', `${bucket}/${name}`);
        return r.status !== 404;
      },
      async remove(bucket, name) { await r2Request(cfg, 'DELETE', `${bucket}/${name}`); return true; },
    };
  }
  // Backend local (por defecto)
  const dir = (bucket) => path.join(config.dataDir, bucket);
  return {
    kind: 'local',
    async put(bucket, name, buf) { fs.mkdirSync(dir(bucket), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(dir(bucket), name), buf, { mode: 0o600 }); },
    async get(bucket, name) { const f = path.join(dir(bucket), name); return fs.existsSync(f) ? fs.readFileSync(f) : null; },
    async exists(bucket, name) { return fs.existsSync(path.join(dir(bucket), name)); },
    async remove(bucket, name) { return secureDelete(path.join(dir(bucket), name)); },
  };
}

export const BUCKET = { EVIDENCE: 'evidencias', REPORTS: 'informes' };
