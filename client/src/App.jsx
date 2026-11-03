import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom';
import { KeyRound, Compass } from 'lucide-react';
import { AuthProvider, ToastProvider, ConfirmProvider, useAuth, useToast } from './lib/context.jsx';
import { api } from './lib/api.js';
import Layout from './components/Layout.jsx';
import { Loading, Empty, Field, Spinner, Logo } from './components/ui.jsx';
import { Login, Setup, ResetPassword } from './pages/Auth.jsx';
import Consent from './pages/Consent.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const PhoneAnalysis = lazy(() => import('./pages/PhoneAnalysis.jsx'));
const Osint = lazy(() => import('./pages/Osint.jsx'));
const Findings = lazy(() => import('./pages/Osint.jsx').then((m) => ({ default: m.Findings })));
const Cases = lazy(() => import('./pages/Cases.jsx'));
const CaseDetail = lazy(() => import('./pages/Cases.jsx').then((m) => ({ default: m.CaseDetail })));
const Evidence = lazy(() => import('./pages/Evidence.jsx'));
const EvidenceDetail = lazy(() => import('./pages/Evidence.jsx').then((m) => ({ default: m.EvidenceDetail })));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Geo = lazy(() => import('./pages/Geo.jsx'));
const GeoDetail = lazy(() => import('./pages/Geo.jsx').then((m) => ({ default: m.GeoDetail })));
const Credits = lazy(() => import('./pages/Admin.jsx').then((m) => ({ default: m.Credits })));
const UsersRoles = lazy(() => import('./pages/Admin.jsx').then((m) => ({ default: m.UsersRoles })));
const Audit = lazy(() => import('./pages/Admin.jsx').then((m) => ({ default: m.Audit })));
const Settings = lazy(() => import('./pages/Settings.jsx'));

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Empty icon={KeyRound} title="Acceso restringido" text="Su rol no tiene permiso para ver esta sección. Solicítelo al administrador." action={<Link className="btn" to="/">Volver al inicio</Link>} />;
  return children;
}

function ForcePasswordChange() {
  const { refresh, logout } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.confirm) return toast.error('Las contraseñas no coinciden.');
    setBusy(true);
    try { await api.post('/auth/password', { current: f.current, next: f.next }); toast.success('Contraseña actualizada.'); await refresh(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <div className="consent-page"><form className="card auth-card" onSubmit={submit}><div className="card-body stack">
      <div className="row"><Logo /><div className="brand-text"><strong>TELEFÓNICA</strong><span>INTELLIGENCE</span></div></div>
      <h1>Cambie su contraseña</h1><p className="muted">El administrador asignó una contraseña temporal. Defina una nueva para continuar.</p>
      <Field label="Contraseña temporal"><input className="input" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" required /></Field>
      <Field label="Nueva contraseña" help="Mínimo 10 caracteres con letras y números."><input className="input" type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" required /></Field>
      <Field label="Confirmar"><input className="input" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" required /></Field>
      <button className="btn primary block" disabled={busy}>{busy && <Spinner />} Guardar y continuar</button>
      <button type="button" className="btn ghost block" onClick={logout}>Cerrar sesión</button>
    </div></form></div>
  );
}

function Root() {
  const { loading, status, user } = useAuth();
  if (loading) return <Loading text="Iniciando Telefónica Intelligence…" />;
  if (status?.error) return <div className="consent-page"><div className="card auth-card"><div className="card-body"><Empty title="Servidor no disponible" text={status.error} action={<button className="btn" onClick={() => window.location.reload()}>Reintentar</button>} /></div></div></div>;
  return (
    <Routes>
      <Route path="/consentimiento/:token" element={<Consent />} />
      <Route path="/restablecer/:token" element={<ResetPassword />} />
      {status?.setupRequired ? <Route path="*" element={<Setup />} />
        : !user ? <Route path="*" element={<Login />} />
          : user.mustChangePassword ? <Route path="*" element={<ForcePasswordChange />} />
            : (
              <Route element={<Layout />}>
                <Route index element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
                <Route path="analisis" element={<Guard perm="phone.history"><PhoneAnalysis /></Guard>} />
                <Route path="osint" element={<Guard perm="osint.history"><Osint /></Guard>} />
                <Route path="hallazgos" element={<Guard perm="osint.history"><Findings /></Guard>} />
                <Route path="expedientes" element={<Guard perm="cases.read"><Cases /></Guard>} />
                <Route path="expedientes/:id" element={<Guard perm="cases.read"><CaseDetail /></Guard>} />
                <Route path="evidencias" element={<Guard perm="evidence.read"><Evidence /></Guard>} />
                <Route path="evidencias/:id" element={<Guard perm="evidence.read"><EvidenceDetail /></Guard>} />
                <Route path="informes" element={<Guard perm="reports.read"><Reports /></Guard>} />
                <Route path="geolocalizacion" element={<Guard perm="geo.read"><Geo /></Guard>} />
                <Route path="geolocalizacion/:id" element={<Guard perm="geo.read"><GeoDetail /></Guard>} />
                <Route path="creditos" element={<Guard perm="credits.view"><Credits /></Guard>} />
                <Route path="usuarios" element={<Guard perm="admin.users"><UsersRoles /></Guard>} />
                <Route path="auditoria" element={<Guard perm="admin.audit"><Audit /></Guard>} />
                <Route path="configuracion" element={<Settings />} />
                <Route path="configuracion/auditoria" element={<Navigate to="/auditoria" replace />} />
                <Route path="*" element={<Empty icon={Compass} title="Página no encontrada" text="La dirección no existe." action={<Link className="btn" to="/">Ir al dashboard</Link>} />} />
              </Route>
            )}
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <ConfirmProvider>
            <Suspense fallback={<Loading />}>
              <Root />
            </Suspense>
          </ConfirmProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
