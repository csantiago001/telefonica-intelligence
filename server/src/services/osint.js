// Conectores OSINT reales sobre fuentes públicas. Nunca simulan resultados:
// si la fuente no responde, se lanza un error que queda registrado como consulta fallida.
import dns from 'node:dns/promises';
import net from 'node:net';
import { safeFetch, fetchJson, FetchError } from '../lib/safeHttp.js';
import { analyzePhone } from '../lib/phone.js';

export const DOMAIN_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  try { s = new URL('http://' + s).hostname; } catch { /* se valida abajo */ }
  return s;
}

export const TOOLS = {
  dns: { label: 'Registros DNS', target: 'dominio', cost: 'osint_dns', source: 'Sistema DNS público (resolutor del servidor)', reliability: 'confirmado' },
  rdap: { label: 'Registro de dominio (RDAP/WHOIS)', target: 'dominio', cost: 'osint_rdap', source: 'RDAP — registros oficiales vía rdap.org (IANA bootstrap)', reliability: 'confirmado' },
  ct: { label: 'Certificados y subdominios (Certificate Transparency)', target: 'dominio', cost: 'osint_ct', source: 'crt.sh — registros públicos de Certificate Transparency', reliability: 'confirmado' },
  wayback: { label: 'Historial web (Internet Archive)', target: 'url', cost: 'osint_wayback', source: 'Internet Archive — Wayback Machine', reliability: 'confirmado' },
  link: { label: 'Verificación de enlace y metadatos', target: 'url', cost: 'osint_link', source: 'Conexión directa al sitio', reliability: 'confirmado' },
  ip: { label: 'Dirección IP (RDAP + DNS inverso)', target: 'ip', cost: 'osint_ip', source: 'RDAP de registros regionales (LACNIC, ARIN, RIPE...) vía rdap.org', reliability: 'confirmado' },
  search: { label: 'Búsqueda de información pública', target: 'texto', cost: 'osint_search', source: 'DuckDuckGo Instant Answer API + búsqueda asistida', reliability: 'no_verificado' },
};

export function validateTarget(tool, raw) {
  const t = TOOLS[tool];
  if (!t) throw new FetchError('Herramienta desconocida', 'INPUT');
  const value = String(raw || '').trim();
  if (!value) throw new FetchError('Indique un objetivo para la consulta', 'INPUT');
  if (t.target === 'dominio') {
    const d = normalizeDomain(value);
    if (!DOMAIN_RE.test(d)) throw new FetchError('Dominio inválido. Ejemplo: ejemplo.com', 'INPUT');
    return d;
  }
  if (t.target === 'url') {
    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : 'https://' + value;
    let u;
    try { u = new URL(withScheme); } catch { throw new FetchError('URL inválida. Ejemplo: https://ejemplo.com', 'INPUT'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new FetchError('Solo se admiten URL http/https', 'INPUT');
    return u.href;
  }
  if (t.target === 'ip') {
    if (!net.isIP(value)) throw new FetchError('Dirección IP inválida', 'INPUT');
    return value;
  }
  if (value.length > 200) throw new FetchError('El texto de búsqueda es demasiado largo (máx. 200)', 'INPUT');
  return value;
}

const settle = async (p) => {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? 'sin registros' : e.code || e.message }; }
};

async function runDns(domain, { timeoutMs }) {
  const resolver = new dns.Resolver({ timeout: Math.min(timeoutMs, 5000), tries: 2 });
  const [a, aaaa, mx, ns, txt, cname, soa, caa] = await Promise.all([
    settle(resolver.resolve4(domain, { ttl: true })), settle(resolver.resolve6(domain)), settle(resolver.resolveMx(domain)),
    settle(resolver.resolveNs(domain)), settle(resolver.resolveTxt(domain)), settle(resolver.resolveCname(domain)),
    settle(resolver.resolveSoa(domain)), settle(resolver.resolveCaa(domain)),
  ]);
  const all = { a, aaaa, mx, ns, txt, cname, soa, caa };
  const hardFail = Object.values(all).every((r) => !r.ok && r.error !== 'sin registros');
  if (hardFail) throw new FetchError(`No fue posible consultar el DNS (${a.error}). Verifique la conexión a Internet del servidor.`, 'DNS');
  const records = {
    A: a.ok ? a.value.map((x) => `${x.address} (TTL ${x.ttl})`) : [],
    AAAA: aaaa.ok ? aaaa.value : [],
    MX: mx.ok ? mx.value.sort((x, y) => x.priority - y.priority).map((x) => `${x.priority} ${x.exchange}`) : [],
    NS: ns.ok ? ns.value : [],
    TXT: txt.ok ? txt.value.map((x) => x.join('')) : [],
    CNAME: cname.ok ? cname.value : [],
    SOA: soa.ok ? [`${soa.value.nsname} ${soa.value.hostmaster} serial ${soa.value.serial}`] : [],
    CAA: caa.ok ? caa.value.map((x) => JSON.stringify(x)) : [],
  };
  const spf = records.TXT.find((t) => t.startsWith('v=spf1')) || null;
  let dmarc = null;
  const dm = await settle(resolver.resolveTxt('_dmarc.' + domain));
  if (dm.ok) dmarc = dm.value.map((x) => x.join('')).find((t) => t.startsWith('v=DMARC1')) || null;
  const total = Object.values(records).reduce((n, l) => n + l.length, 0);
  if (!total) {
    // Sin registros: se comprueba que el DNS funcione con un dominio de control antes de afirmar que no existen.
    const canary = await settle(resolver.resolveNs('iana.org'));
    if (!canary.ok) throw new FetchError('El servicio DNS no está disponible desde el servidor (el dominio de control iana.org tampoco resolvió). No se puede concluir nada sobre el dominio consultado.', 'DNS');
  }
  if (!total) return { status: 'sin_resultados', data: { domain, records, spf: null, dmarc: null, message: 'El dominio no existe (NXDOMAIN) o no publica registros.' }, findings: [], sourceUrl: null };
  const findings = [];
  if (records.A.length) findings.push({ title: `Dominio resuelve a ${records.A.length} dirección(es) IPv4`, detail: records.A.join(', ') });
  if (records.MX.length) findings.push({ title: 'Servidores de correo (MX)', detail: records.MX.join(', ') });
  if (records.NS.length) findings.push({ title: 'Servidores de nombres (NS)', detail: records.NS.join(', ') });
  findings.push({ title: spf ? 'Política SPF publicada' : 'Sin política SPF', detail: spf || 'No se encontró registro v=spf1' });
  findings.push({ title: dmarc ? 'Política DMARC publicada' : 'Sin política DMARC', detail: dmarc || 'No se encontró _dmarc' });
  return { status: total ? 'exito' : 'sin_resultados', data: { domain, records, spf, dmarc }, findings, sourceUrl: null };
}

const vcardName = (ent) => {
  const v = ent?.vcardArray?.[1];
  if (!Array.isArray(v)) return null;
  const fn = v.find((x) => x[0] === 'fn');
  const org = v.find((x) => x[0] === 'org');
  return (fn && fn[3]) || (org && org[3]) || null;
};

async function runRdap(domain, opts) {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const r = await fetchJson(url, opts);
  if (r.status === 404 || !r.data) return { status: 'sin_resultados', data: { domain, message: 'El dominio no está registrado o el registro no publica RDAP.' }, findings: [], sourceUrl: url };
  const d = r.data;
  const ev = Object.fromEntries((d.events || []).map((e) => [e.eventAction, e.eventDate]));
  const registrar = (d.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const data = {
    domain: d.ldhName || domain,
    handle: d.handle || null,
    status: d.status || [],
    registeredAt: ev.registration || null,
    expiresAt: ev.expiration || null,
    updatedAt: ev['last changed'] || null,
    registrar: vcardName(registrar),
    registrarIana: registrar?.publicIds?.find((p) => p.type?.includes('IANA'))?.identifier || null,
    nameservers: (d.nameservers || []).map((n) => n.ldhName),
    dnssec: d.secureDNS ? !!d.secureDNS.delegationSigned : null,
    rdapServer: r.url,
  };
  const findings = [
    { title: `Registrador: ${data.registrar || 'no publicado'}`, detail: `IANA ID: ${data.registrarIana || '—'}` },
  ];
  if (data.registeredAt) findings.push({ title: `Dominio registrado el ${data.registeredAt.slice(0, 10)}`, detail: `Antigüedad aproximada: ${Math.floor((Date.now() - Date.parse(data.registeredAt)) / 31557600000)} años` });
  if (data.expiresAt) findings.push({ title: `Expira el ${data.expiresAt.slice(0, 10)}`, detail: null });
  return { status: 'exito', data, findings, sourceUrl: r.url };
}

async function runCt(domain, opts) {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`;
  const r = await fetchJson(url, { ...opts, timeoutMs: Math.max(opts.timeoutMs, 25000), maxBytes: 8 * 1024 * 1024 });
  const rows = Array.isArray(r.data) ? r.data : [];
  const names = new Set();
  const issuers = new Map();
  let first = null, last = null;
  for (const row of rows) {
    for (const n of String(row.name_value || '').split('\n')) if (n && !n.startsWith('*')) names.add(n.toLowerCase());
    const iss = (String(row.issuer_name || '').match(/O=([^,]+)/) || [])[1] || row.issuer_name;
    issuers.set(iss, (issuers.get(iss) || 0) + 1);
    if (!first || row.not_before < first) first = row.not_before;
    if (!last || row.not_before > last) last = row.not_before;
  }
  const subdomains = [...names].sort();
  const data = { domain, certificates: rows.length, subdomains: subdomains.slice(0, 500), subdomainCount: subdomains.length, issuers: [...issuers].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), firstSeen: first, lastSeen: last };
  const findings = rows.length
    ? [{ title: `${subdomains.length} nombres de host observados en certificados`, detail: subdomains.slice(0, 30).join(', ') + (subdomains.length > 30 ? '…' : '') }, { title: `Primer certificado registrado: ${first?.slice(0, 10)}`, detail: `Último: ${last?.slice(0, 10)}` }]
    : [];
  return { status: rows.length ? 'exito' : 'sin_resultados', data, findings, sourceUrl: `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}` };
}

async function runWayback(target, opts) {
  const u = new URL(target);
  const key = u.host + (u.pathname === '/' ? '' : u.pathname);
  const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(key)}`;
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(key)}&output=json&fl=timestamp,statuscode&collapse=timestamp:6&limit=5000`;
  const [avail, cdx] = await Promise.all([fetchJson(availUrl, opts), fetchJson(cdxUrl, { ...opts, timeoutMs: Math.max(opts.timeoutMs, 20000) }).catch((e) => ({ error: e.message }))]);
  const closest = avail.data?.archived_snapshots?.closest || null;
  const rows = Array.isArray(cdx.data) ? cdx.data.slice(1) : [];
  const ts = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const byYear = {};
  for (const [t] of rows) byYear[t.slice(0, 4)] = (byYear[t.slice(0, 4)] || 0) + 1;
  const data = {
    target: key,
    closest: closest ? { url: closest.url, timestamp: ts(closest.timestamp), status: closest.status } : null,
    firstCapture: rows[0] ? ts(rows[0][0]) : null,
    lastCapture: rows.length ? ts(rows[rows.length - 1][0]) : null,
    monthsWithCaptures: rows.length,
    byYear,
    cdxError: cdx.error || null,
  };
  const findings = closest || rows.length
    ? [{ title: `Archivado en Internet Archive desde ${data.firstCapture || data.closest?.timestamp}`, detail: `Última captura: ${data.lastCapture || data.closest?.timestamp}. Meses con capturas: ${rows.length}` }]
    : [];
  return { status: closest || rows.length ? 'exito' : 'sin_resultados', data, findings, sourceUrl: closest?.url || `https://web.archive.org/web/*/${key}` };
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export function extractHtmlMeta(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const metas = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property|http-equiv)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (name && content != null && Object.keys(metas).length < 60) metas[name.toLowerCase()] = decode(content).slice(0, 500);
  }
  const links = [...html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]);
  return { title: title ? decode(title).slice(0, 300) : null, metas, linkCount: links.length };
}

async function runLink(target, opts) {
  const r = await safeFetch(target, { timeoutMs: opts.timeoutMs, maxBytes: 2 * 1024 * 1024, allowPrivate: opts.allowPrivate, headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
  const h = r.headers;
  const ct = String(h['content-type'] || '');
  const meta = ct.includes('html') ? extractHtmlMeta(r.body.toString('utf8')) : null;
  const security = {
    'strict-transport-security': !!h['strict-transport-security'],
    'content-security-policy': !!h['content-security-policy'],
    'x-frame-options': !!h['x-frame-options'],
    'x-content-type-options': !!h['x-content-type-options'],
    'referrer-policy': !!h['referrer-policy'],
  };
  const data = {
    requestedUrl: target,
    finalUrl: r.url,
    status: r.status,
    reachable: r.status < 400,
    redirects: r.chain,
    durationMs: r.durationMs,
    contentType: ct || null,
    sizeBytes: r.body.length,
    truncated: r.truncated,
    server: h.server || null,
    poweredBy: h['x-powered-by'] || null,
    lastModified: h['last-modified'] || null,
    securityHeaders: security,
    tls: r.tls,
    html: meta,
  };
  const findings = [{ title: `Enlace ${data.reachable ? 'accesible' : 'con error'} (HTTP ${r.status})`, detail: `URL final: ${r.url}. Redirecciones: ${r.chain.length - 1}` }];
  if (meta?.title) findings.push({ title: `Título de la página: ${meta.title}`, detail: meta.metas.description || meta.metas['og:description'] || null });
  if (r.tls) findings.push({ title: `Certificado TLS emitido por ${r.tls.issuer || 'desconocido'}`, detail: `Válido hasta ${r.tls.validTo?.slice(0, 10)} para ${r.tls.subject}` });
  if (meta?.metas?.generator) findings.push({ title: `Tecnología declarada: ${meta.metas.generator}`, detail: 'Metaetiqueta generator' });
  return { status: 'exito', data, findings, sourceUrl: r.url };
}

async function runIp(ip, opts) {
  const url = `https://rdap.org/ip/${encodeURIComponent(ip)}`;
  const [rd, rev] = await Promise.all([fetchJson(url, opts), dns.reverse(ip).catch(() => [])]);
  if (!rd.data) return { status: 'sin_resultados', data: { ip, reverse: rev }, findings: [], sourceUrl: url };
  const d = rd.data;
  const org = (d.entities || []).map(vcardName).filter(Boolean);
  const data = {
    ip, reverse: rev, name: d.name || null, handle: d.handle || null, country: d.country || null, type: d.type || null,
    range: d.startAddress && d.endAddress ? `${d.startAddress} – ${d.endAddress}` : null,
    cidr: (d.cidr0_cidrs || []).map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`),
    organizations: [...new Set(org)].slice(0, 10), rdapServer: rd.url,
  };
  const findings = [{ title: `Red ${data.name || data.handle} (${data.country || 'país no publicado'})`, detail: `Rango: ${data.range || '—'}. Organizaciones: ${data.organizations.join(', ') || '—'}` }];
  if (rev.length) findings.push({ title: 'DNS inverso', detail: rev.join(', ') });
  return { status: 'exito', data, findings, sourceUrl: rd.url };
}

export function searchLinks(query) {
  const variants = new Set([query]);
  const phone = analyzePhone(query, 'CO');
  if (phone.valid) {
    const f = Object.fromEntries(phone.fields.map((x) => [x.key, x.value]));
    variants.add(f.e164);
    variants.add(f.international);
    variants.add(f.national);
    variants.add(String(f.e164).replace('+', ''));
  }
  const engines = [
    { name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(`"${q}"`)}` },
    { name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(`"${q}"`)}` },
    { name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(`"${q}"`)}` },
  ];
  return { variants: [...variants], links: [...variants].flatMap((v) => engines.map((e) => ({ engine: e.name, query: `"${v}"`, url: e.url(v) }))), isPhone: phone.valid };
}

async function runSearch(query, opts) {
  const assisted = searchLinks(query);
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
  let instant = null;
  let instantError = null;
  try {
    const r = await fetchJson(url, opts);
    const d = r.data || {};
    const topics = [];
    for (const t of d.RelatedTopics || []) {
      if (t.Text) topics.push({ text: t.Text, url: t.FirstURL });
      for (const s of t.Topics || []) if (s.Text) topics.push({ text: s.Text, url: s.FirstURL });
    }
    instant = { heading: d.Heading || null, abstract: d.AbstractText || null, abstractSource: d.AbstractSource || null, abstractUrl: d.AbstractURL || null, entity: d.Entity || null, topics: topics.slice(0, 20) };
  } catch (e) {
    instantError = e.message;
  }
  const hasInstant = instant && (instant.abstract || instant.topics.length);
  const findings = hasInstant
    ? [instant.abstract && { title: `Resumen público: ${instant.heading || query}`, detail: `${instant.abstract} (Fuente: ${instant.abstractSource})` }, ...instant.topics.slice(0, 5).map((t) => ({ title: t.text.slice(0, 140), detail: t.url }))].filter(Boolean)
    : [];
  const data = { query, instant, instantError, assisted };
  // La búsqueda asistida siempre produce enlaces; el estado refleja solo la consulta automática real.
  const status = instantError ? 'parcial' : hasInstant ? 'exito' : 'sin_resultados';
  return { status, data, findings, sourceUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` };
}

const RUNNERS = { dns: runDns, rdap: runRdap, ct: runCt, wayback: runWayback, link: runLink, ip: runIp, search: runSearch };

export async function runTool(tool, target, opts) {
  return RUNNERS[tool](target, opts);
}
