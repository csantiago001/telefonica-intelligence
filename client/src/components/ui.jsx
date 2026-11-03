import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Inbox, Copy, Check, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { CASE_STATUS, CASE_PRIORITY, RELIABILITY, OSINT_STATUS, GEO_STATUS } from '../lib/format.js';

export function Logo({ size = 36 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#151a17" stroke="#2a312d" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#a3e635" strokeWidth="3.5" />
      <circle cx="32" cy="32" r="9" fill="none" stroke="#a3e635" strokeWidth="2.5" opacity=".55" />
      <circle cx="32" cy="32" r="3.2" fill="#a3e635" />
      <path d="M32 7v8M32 49v8M7 32h8M49 32h8" stroke="#a3e635" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({ title, children, footer, onClose, size }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not(.modal-x)')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size || ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon sm modal-x" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, help, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="row" style={{ cursor: disabled ? 'default' : 'pointer', gap: 10 }}>
      <span className="switch"><input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export const Badge = ({ cls = 'b-gray', children, dot, title }) => <span className={`badge ${cls}`} title={title}>{dot && <span className="dot" />}{children}</span>;
const fromMap = (map, k) => map[k] || [k, 'b-gray'];
export const StatusBadge = ({ status }) => { const [l, c] = fromMap(CASE_STATUS, status); return <Badge cls={c} dot>{l}</Badge>; };
export const PriorityBadge = ({ priority }) => { const [l, c] = fromMap(CASE_PRIORITY, priority); return <Badge cls={c}>{l}</Badge>; };
export const ReliabilityBadge = ({ value }) => { const [l, c, t] = fromMap(RELIABILITY, value); return <Badge cls={c} title={t}>{l}</Badge>; };
export const OsintStatusBadge = ({ value }) => { const [l, c] = fromMap(OSINT_STATUS, value); return <Badge cls={c} dot>{l}</Badge>; };
export const GeoStatusBadge = ({ value }) => { const [l, c] = fromMap(GEO_STATUS, value); return <Badge cls={c} dot>{l}</Badge>; };
export const DemoBadge = ({ show }) => (show ? <Badge cls="b-amber" title="Dato ficticio de demostración">DEMO</Badge> : null);

export function Spinner({ lg }) { return <span className={`spinner ${lg ? 'lg' : ''}`} role="progressbar" aria-label="Cargando" />; }
export function Loading({ text = 'Cargando…' }) { return <div className="loading-block"><Spinner lg /><span>{text}</span></div>; }

export function Empty({ icon: Icon = Inbox, title = 'Sin registros', text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert error"><X size={18} color="var(--red)" />
      <div style={{ flex: 1 }}>{error.message || String(error)}</div>
      {onRetry && <button className="btn sm" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Pagination({ data, onPage }) {
  if (!data || data.total === 0) return null;
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  return (
    <div className="pagination">
      <span>Mostrando {from}–{to} de {data.total}</span>
      <div className="row">
        <button className="btn sm icon" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button>
        <span>Página {data.page} de {data.pages}</span>
        <button className="btn sm icon" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)} aria-label="Página siguiente"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export function Kpi({ icon: Icon, label, value, foot, tone = '', onClick }) {
  return (
    <div className={`card kpi ${tone}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}>
      <div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon size={17} /></span></div>
      <div className="kpi-value">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, icon: Icon, title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{Icon && <Icon size={13} />}{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function CopyButton({ text, label }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  };
  return <button className={`btn sm ${label ? '' : 'icon'}`} onClick={copy} title="Copiar" aria-label="Copiar">{ok ? <Check size={14} color="var(--lime)" /> : <Copy size={14} />}{label && (ok ? 'Copiado' : label)}</button>;
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…' }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  useEffect(() => {
    const t = setTimeout(() => v !== (value || '') && onChange(v), 350);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="input-icon"><Search size={16} />
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

/** Hook de carga de datos con estado de carga/error y recarga. */
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path);
      setState({ data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: e });
    }
  }, [path, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

/** Selector de expediente (activo) reutilizable. */
export function CaseSelect({ value, onChange, includeEmpty = true, label = 'Expediente asociado', help, onlyWritable = true }) {
  const { data } = useFetch('/cases' + qs({ pageSize: 200, sort: 'updated' }));
  const items = (data?.items || []).filter((c) => !onlyWritable || c.status !== 'archivado');
  return (
    <Field label={label} help={help}>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        {includeEmpty && <option value="">— Sin expediente —</option>}
        {items.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title.slice(0, 60)}</option>)}
      </select>
    </Field>
  );
}
