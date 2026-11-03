import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Lock, User, ShieldCheck, Phone, Radar, FolderKanban, FileArchive, KeyRound, Building2, Mail, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../lib/context.jsx';
import { Logo, Field, Spinner, Loading } from '../components/ui.jsx';

function Hero() {
  return (
    <div className="auth-hero">
      <div className="auth-grid-bg" />
      <div className="radar"><div className="sweep" /></div>
      <div className="row" style={{ gap: 12, position: 'relative' }}>
        <Logo size={42} />
        <div className="brand-text"><strong style={{ fontSize: 15 }}>TELEFÓNICA</strong><span>INTELLIGENCE</span></div>
      </div>
      <div style={{ position: 'relative' }}>
        <h1>Investigación telefónica con <em>fuentes legítimas</em> y trazabilidad completa.</h1>
        <p className="mt">Analice números con planes de numeración oficiales, consulte fuentes abiertas, gestione expedientes y evidencias con integridad SHA-256 y genere informes profesionales.</p>
        <div className="feature-list">
          <div><Phone size={17} /> Normalización y validación E.164 por país</div>
          <div><Radar size={17} /> OSINT sobre registros públicos con fuente y fecha</div>
          <div><FolderKanban size={17} /> Expedientes, hallazgos y cadena de custodia</div>
          <div><FileArchive size={17} /> Evidencias cifradas e informes en PDF</div>
        </div>
      </div>
      <div className="small muted" style={{ position: 'relative' }}>Uso privado y autorizado. Sin rastreo clandestino, sin interceptación, sin acceso a bases privadas.</div>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete = 'current-password', placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-icon" style={{ position: 'relative' }}>
      <Lock size={16} />
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} required style={{ paddingRight: 40 }} />
      <button type="button" className="btn ghost icon sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} style={{ position: 'absolute', right: 4, top: 4 }}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
    </div>
  );
}

export function Login() {
  const { status, refresh } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [code, setCode] = useState('');
  const [step, setStep] = useState(status?.pending2fa ? '2fa' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post('/auth/login', form);
      if (r.pending2fa) setStep('2fa');
      else await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api.post('/auth/2fa/verify', { code: code.trim() }); await refresh(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <Hero />
      <div className="auth-panel">
        <div className="card auth-card">
          <div className="card-body">
            {status?.mode === 'demo' && <div className="demo-banner" style={{ borderRadius: 8, marginBottom: 16 }}>DEMOSTRACIÓN · DATOS FICTICIOS</div>}
            {step === 'login' ? (
              <form onSubmit={submit} className="stack">
                <div><div className="eyebrow"><ShieldCheck size={13} /> Acceso seguro</div><h1>Iniciar sesión</h1><p className="muted">{status?.organization}</p></div>
                {status?.expired && <div className="alert warning">Su sesión expiró. Ingrese nuevamente.</div>}
                <Field label="Usuario"><div className="input-icon"><User size={16} /><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" required autoFocus /></div></Field>
                <Field label="Contraseña"><PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} /></Field>
                {error && <div className="alert error">{error}</div>}
                <button className="btn primary block" disabled={busy}>{busy ? <Spinner /> : <Lock size={16} />} Ingresar</button>
                <p className="small muted" style={{ textAlign: 'center' }}>¿Olvidó su contraseña? Solicite al administrador un enlace de restablecimiento.</p>
                {status?.demoAccounts && (
                  <div className="alert info" style={{ display: 'block' }}>
                    <b>Cuentas de demostración</b>
                    {status.demoAccounts.map((a) => (
                      <button type="button" key={a.username} className="btn sm block mt" style={{ justifyContent: 'space-between' }} onClick={() => setForm({ username: a.username, password: a.password })}>
                        <span>{a.role}</span><span className="mono muted">{a.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={verify} className="stack">
                <div><div className="eyebrow"><KeyRound size={13} /> Verificación en dos pasos</div><h1>Código de seguridad</h1><p className="muted">Ingrese el código de 6 dígitos de su aplicación de autenticación o un código de recuperación.</p></div>
                <Field label="Código"><input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" placeholder="123456" autoFocus required style={{ fontSize: 20, letterSpacing: '0.3em', textAlign: 'center', height: 48 }} /></Field>
                {error && <div className="alert error">{error}</div>}
                <button className="btn primary block" disabled={busy}>{busy ? <Spinner /> : <ShieldCheck size={16} />} Verificar</button>
                <button type="button" className="btn ghost block" onClick={async () => { await api.post('/auth/logout').catch(() => {}); setStep('login'); setCode(''); }}>Volver</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Setup() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ organization: '', fullName: '', username: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Las contraseñas no coinciden.');
    setBusy(true); setError('');
    try {
      const { confirm, ...body } = f; // eslint-disable-line no-unused-vars
      await api.post('/auth/setup', body);
      await api.post('/auth/login', { username: f.username, password: f.password });
      toast.success('Plataforma configurada. Bienvenido.');
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <Hero />
      <div className="auth-panel">
        <div className="card auth-card" style={{ maxWidth: 480 }}>
          <form className="card-body stack" onSubmit={submit}>
            <div><div className="eyebrow">Primer arranque</div><h1>Configuración inicial</h1><p className="muted">Cree la cuenta de administrador. No existen contraseñas predeterminadas.</p></div>
            <Field label="Nombre de la organización o unidad"><div className="input-icon"><Building2 size={16} /><input className="input" value={f.organization} onChange={set('organization')} required minLength={2} /></div></Field>
            <Field label="Nombre completo"><input className="input" value={f.fullName} onChange={set('fullName')} required minLength={3} /></Field>
            <div className="form-grid">
              <Field label="Usuario"><input className="input" value={f.username} onChange={set('username')} required pattern="[a-zA-Z0-9._\-]{3,40}" title="3 a 40 caracteres: letras, números, punto, guion" autoComplete="username" /></Field>
              <Field label="Correo (opcional)"><div className="input-icon"><Mail size={16} /><input className="input" type="email" value={f.email} onChange={set('email')} /></div></Field>
            </div>
            <Field label="Contraseña" help="Mínimo 10 caracteres, con letras y números."><PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" /></Field>
            <Field label="Confirmar contraseña"><PasswordInput value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" /></Field>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary block" disabled={busy}>{busy && <Spinner />} Crear administrador</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function ResetPassword() {
  const { token } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/auth/reset/${token}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setError('Las contraseñas no coinciden.');
    setBusy(true); setError('');
    try { await api.post(`/auth/reset/${token}`, { password: pw }); toast.success('Contraseña actualizada. Inicie sesión.'); nav('/'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="consent-page">
      <div className="card auth-card">
        <form className="card-body stack" onSubmit={submit}>
          <div className="row"><Logo /><div className="brand-text"><strong>TELEFÓNICA</strong><span>INTELLIGENCE</span></div></div>
          <h1>Restablecer contraseña</h1>
          {!info && !error && <Loading />}
          {info && <p className="muted">Usuario: <b className="lime">{info.username}</b></p>}
          {info && <>
            <Field label="Nueva contraseña" help="Mínimo 10 caracteres, con letras y números."><PasswordInput value={pw} onChange={setPw} autoComplete="new-password" /></Field>
            <Field label="Confirmar"><PasswordInput value={pw2} onChange={setPw2} autoComplete="new-password" /></Field>
          </>}
          {error && <div className="alert error">{error}</div>}
          {info && <button className="btn primary block" disabled={busy}>{busy && <Spinner />} Guardar contraseña</button>}
          <Link to="/" className="small">Volver al inicio de sesión</Link>
        </form>
      </div>
    </div>
  );
}
