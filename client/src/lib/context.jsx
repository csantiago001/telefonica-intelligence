import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { api, setUnauthorizedHandler } from './api.js';
import { Modal } from '../components/ui.jsx';

// ---------------- Sesión ----------------
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, status: null, user: null });
  const refresh = useCallback(async () => {
    try {
      const s = await api.get('/auth/status');
      setState({ loading: false, status: s, user: s.user });
      return s;
    } catch (e) {
      setState({ loading: false, status: { error: e.message }, user: null });
      return null;
    }
  }, []);
  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setState((s) => ({ ...s, user: null, status: { ...(s.status || {}), authenticated: false, expired: true } })));
  }, [refresh]);
  useEffect(() => {
    document.body.classList.toggle('compact', !!state.user?.preferences?.compact);
    document.body.classList.toggle('reduce-motion', !!state.user?.preferences?.reduceMotion);
  }, [state.user]);
  const value = useMemo(() => ({
    ...state,
    refresh,
    can: (p) => !!state.user?.permissions?.includes(p),
    setCredits: (credits) => setState((s) => (s.user ? { ...s, user: { ...s.user, credits } } : s)),
    logout: async () => {
      try { await api.post('/auth/logout'); } catch { /* sesión ya cerrada */ }
      await refresh();
    },
  }), [state, refresh]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// ---------------- Notificaciones ----------------
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);
const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const remove = (id) => setItems((l) => l.filter((t) => t.id !== id));
  const push = useCallback((type, message, ms = 4500) => {
    const id = ++idRef.current;
    setItems((l) => [...l.slice(-4), { id, type, message }]);
    if (ms) setTimeout(() => remove(id), ms);
  }, []);
  const api2 = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', typeof m === 'string' ? m : m?.message || 'Error inesperado', 7000),
    info: (m) => push('info', m),
    warning: (m) => push('warning', m, 6000),
  }), [push]);
  return (
    <ToastCtx.Provider value={api2}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const I = ICONS[t.type];
          return (
            <div key={t.id} className={`toast ${t.type}`}>
              <I size={18} color={t.type === 'success' ? 'var(--lime)' : t.type === 'error' ? 'var(--red)' : t.type === 'warning' ? 'var(--amber)' : 'var(--blue)'} />
              <span>{t.message}</span>
              <button onClick={() => remove(t.id)} aria-label="Cerrar"><X size={15} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------- Confirmaciones ----------------
const ConfirmCtx = createContext(null);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const [input, setInput] = useState('');
  const confirm = useCallback((opts) => new Promise((resolve) => { setInput(''); setDlg({ ...opts, resolve }); }), []);
  const close = (v) => { dlg?.resolve(v); setDlg(null); };
  const needsText = dlg?.requireText;
  const needsReason = dlg?.reason;
  const ok = !needsText ? (!needsReason || input.trim().length >= (dlg.minReason || 5)) : input === dlg.requireText;
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {dlg && (
        <Modal title={dlg.title || '¿Confirmar acción?'} onClose={() => close(false)}
          footer={<>
            <button className="btn" onClick={() => close(false)}>Cancelar</button>
            <button className={`btn ${dlg.danger ? 'danger' : 'primary'}`} disabled={!ok} onClick={() => close(needsReason ? input.trim() : true)} autoFocus={!needsText && !needsReason}>
              {dlg.confirmText || 'Confirmar'}
            </button>
          </>}>
          <div className="stack" style={{ gap: 12 }}>
            {dlg.danger && <div className="alert error"><AlertTriangle size={18} color="var(--red)" /><div>{dlg.warning || 'Esta acción no se puede deshacer.'}</div></div>}
            <div style={{ color: 'var(--text-2)' }}>{dlg.message}</div>
            {needsText && (
              <div className="field">
                <label>Para confirmar escriba <b className="mono lime">{dlg.requireText}</b></label>
                <input className="input" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
              </div>
            )}
            {needsReason && (
              <div className="field">
                <label>{dlg.reasonLabel || 'Motivo'}</label>
                <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} autoFocus placeholder="Describa el motivo (queda registrado en la auditoría)" />
                <span className="help">Mínimo {dlg.minReason || 5} caracteres.</span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
