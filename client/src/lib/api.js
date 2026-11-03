// Cliente HTTP: envía cookies de sesión y el token CSRF en cada solicitud que modifica datos.
const BASE = '/api';

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)ti_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function request(method, path, body, { raw = false, signal } = {}) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'No hay conexión con el servidor. Verifique que la aplicación esté en ejecución.');
  }
  if (raw && res.ok) return res;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Error ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p, b) => request('DELETE', p, b ?? {}),
  upload: (p, formData) => request('POST', p, formData),
};

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Descarga un archivo autenticado (CSV, PDF, evidencias) respetando el nombre del servidor. */
export async function download(path, fallbackName = 'archivo') {
  const res = await request('GET', path, undefined, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { name, sha256: res.headers.get('x-content-sha256') };
}

export async function openBlob(path) {
  const res = await request('GET', path, undefined, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
