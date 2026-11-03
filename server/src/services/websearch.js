// Búsqueda web automática mediante APIs oficiales (Brave Search o Google Programmable Search).
// Requiere una clave propia del usuario. Nunca se simulan resultados.
import { fetchJson, FetchError } from '../lib/safeHttp.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { encryptString, decryptString } from '../lib/crypto.js';

export const PROVIDERS = {
  brave: { label: 'Brave Search API', signup: 'https://api-dashboard.search.brave.com/register' },
  google: { label: 'Google Programmable Search (Custom Search JSON API)', signup: 'https://developers.google.com/custom-search/v1/overview' },
};

/** Configuración descifrada para uso interno (nunca se envía al navegador). */
export function getSearchConfig(db, masterKey) {
  const provider = getSetting(db, 'search.provider') || 'none';
  const dec = (k) => {
    const v = getSetting(db, k);
    if (!v) return '';
    try { return decryptString(masterKey, v); } catch { return ''; }
  };
  if (provider === 'brave') {
    const key = dec('search.brave_key_enc');
    return key ? { provider, key } : null;
  }
  if (provider === 'google') {
    const key = dec('search.google_key_enc');
    const cx = getSetting(db, 'search.google_cx') || '';
    return key && cx ? { provider, key, cx } : null;
  }
  return null;
}

export function publicSearchConfig(db) {
  return {
    provider: getSetting(db, 'search.provider') || 'none',
    braveKeySet: !!getSetting(db, 'search.brave_key_enc'),
    googleKeySet: !!getSetting(db, 'search.google_key_enc'),
    googleCx: getSetting(db, 'search.google_cx') || '',
    providers: PROVIDERS,
  };
}

export function saveSearchConfig(db, masterKey, { provider, braveKey, googleKey, googleCx }, userId) {
  setSetting(db, 'search.provider', provider, userId);
  if (braveKey) setSetting(db, 'search.brave_key_enc', encryptString(masterKey, braveKey.trim()), userId);
  if (googleKey) setSetting(db, 'search.google_key_enc', encryptString(masterKey, googleKey.trim()), userId);
  if (googleCx !== undefined) setSetting(db, 'search.google_cx', googleCx.trim(), userId);
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function searchOnce(cfg, query, opts) {
  if (cfg.provider === 'brave') {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20&safesearch=off&text_decorations=false`;
    let r;
    try {
      r = await fetchJson(url, { ...opts, headers: { 'X-Subscription-Token': cfg.key } });
    } catch (e) {
      if (/HTTP 401|HTTP 403|HTTP 422/.test(e.message)) throw new FetchError('Brave rechazó la clave de API. Verifíquela en Configuración › Fuentes.', 'AUTH');
      throw e;
    }
    return (r.data?.web?.results || []).map((x) => ({
      title: x.title, url: x.url, snippet: x.description || '', site: x.meta_url?.hostname?.replace(/^www\./, '') || host(x.url), date: x.page_age || x.age || null,
    }));
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(cfg.key)}&cx=${encodeURIComponent(cfg.cx)}&q=${encodeURIComponent(query)}&num=10`;
  let r;
  try {
    r = await fetchJson(url, opts);
  } catch (e) {
    if (/HTTP 400|HTTP 403/.test(e.message)) throw new FetchError('Google rechazó la clave o el identificador del buscador (cx). Verifíquelos en Configuración › Fuentes.', 'AUTH');
    throw e;
  }
  return (r.data?.items || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet || '', site: x.displayLink?.replace(/^www\./, '') || host(x.link), date: null }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ejecuta varias consultas (variantes del número) y combina resultados sin duplicados. */
export async function searchWeb(cfg, queries, opts) {
  const seen = new Map();
  const errors = [];
  let ok = 0;
  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && cfg.provider === 'brave') await sleep(1100); // plan gratuito: 1 consulta/segundo
    try {
      const items = await searchOnce(cfg, queries[i], opts);
      ok++;
      for (const it of items) {
        const k = it.url.replace(/[#?].*$/, '').replace(/\/$/, '');
        if (seen.has(k)) seen.get(k).matchedQueries.push(queries[i]);
        else seen.set(k, { ...it, matchedQueries: [queries[i]] });
      }
    } catch (e) {
      if (e.code === 'AUTH') throw e;
      errors.push(`${queries[i]}: ${e.message}`);
    }
  }
  if (!ok) throw new FetchError(`El buscador no respondió: ${errors[0] || 'sin detalle'}`, 'NET');
  const results = [...seen.values()].sort((a, b) => b.matchedQueries.length - a.matchedQueries.length);
  return { provider: cfg.provider, providerLabel: PROVIDERS[cfg.provider].label, queries, results, errors };
}

/** Variantes de búsqueda para un número analizado. */
export function phoneQueryVariants(analysis) {
  if (!analysis?.e164) return [];
  const f = Object.fromEntries(analysis.fields.map((x) => [x.key, x.value]));
  const digits = analysis.e164.replace('+', '');
  const national = String(f.national || '').replace(/\D/g, '');
  const out = [`"${f.international}"`, `"${national}"`, `"${digits}"`];
  return [...new Set(out)].filter((q) => q.replace(/\D/g, '').length >= 6);
}

// Sitios de redes y directorios públicos frecuentes (solo para enlaces de revisión manual).
export const SOCIAL_SITES = [
  { name: 'Facebook', host: 'facebook.com' }, { name: 'Instagram', host: 'instagram.com' }, { name: 'X (Twitter)', host: 'twitter.com' },
  { name: 'LinkedIn', host: 'linkedin.com' }, { name: 'TikTok', host: 'tiktok.com' }, { name: 'YouTube', host: 'youtube.com' },
  { name: 'Telegram', host: 't.me' }, { name: 'GitHub', host: 'github.com' },
];

/** Detecta el tipo de objetivo y genera variantes de búsqueda y enlaces asistidos. */
export function subjectVariants(type, value) {
  const v = String(value || '').trim();
  const q = (s) => `"${s.replace(/"/g, '')}"`;
  let queries = [];
  let kind = type;
  if (type === 'auto') {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) kind = 'correo';
    else if (/^@?[a-zA-Z0-9._]{3,30}$/.test(v) && !v.includes(' ')) kind = 'usuario';
    else kind = 'nombre';
  }
  if (kind === 'correo') {
    const local = v.split('@')[0];
    queries = [q(v), q(local)];
  } else if (kind === 'usuario') {
    const u = v.replace(/^@/, '');
    queries = [q(u), q('@' + u)];
  } else {
    // nombre o texto libre
    queries = [q(v)];
    if (kind === 'nombre') queries.push(...SOCIAL_SITES.slice(0, 4).map((s) => `${q(v)} site:${s.host}`));
  }
  queries = [...new Set(queries)].filter(Boolean).slice(0, 6);
  return { kind, queries };
}

export function assistedLinks(value, kind) {
  const v = String(value || '').replace(/"/g, '').trim();
  const enc = encodeURIComponent(`"${v}"`);
  const engines = [
    { engine: 'Google', url: `https://www.google.com/search?q=${enc}` },
    { engine: 'Bing', url: `https://www.bing.com/search?q=${enc}` },
    { engine: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${enc}` },
  ];
  const social = (kind === 'usuario' || kind === 'nombre' || kind === 'correo')
    ? SOCIAL_SITES.map((s) => ({ engine: s.name, url: `https://www.google.com/search?q=${encodeURIComponent(`"${v}" site:${s.host}`)}` }))
    : [];
  return { links: engines, social };
}
