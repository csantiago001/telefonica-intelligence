// Limitador de tasa en memoria (ventana fija) por IP y clave.
import { HttpError } from '../lib/util.js';

export function rateLimit({ windowMs, max, key = 'global', message = 'Demasiadas solicitudes. Intente más tarde.' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const k = `${key}:${req.ip}`;
    const t = Date.now();
    let e = hits.get(k);
    if (!e || e.reset < t) {
      e = { count: 0, reset: t + windowMs };
      hits.set(k, e);
    }
    e.count++;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - e.count));
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - t) / 1000));
      return next(new HttpError(429, message));
    }
    next();
  };
}
