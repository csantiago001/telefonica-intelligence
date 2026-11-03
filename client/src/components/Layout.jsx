import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Phone, Radar, FolderKanban, FileArchive, FileText, MapPin, Coins, Settings, ShieldCheck,
  Bell, Menu, LogOut, User, Search, Users, KeyRound, ScrollText, Lightbulb, CheckCheck,
} from 'lucide-react';
import { useAuth } from '../lib/context.jsx';
import { api } from '../lib/api.js';
import { Logo } from './ui.jsx';
import { fmtNum, timeAgo } from '../lib/format.js';

const NAV = [
  { section: 'Operación' },
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true },
  { to: '/analisis', label: 'Análisis telefónico', icon: Phone, perm: 'phone.history' },
  { to: '/osint', label: 'OSINT', icon: Radar, perm: 'osint.history' },
  { to: '/hallazgos', label: 'Hallazgos', icon: Lightbulb, perm: 'osint.history' },
  { to: '/geolocalizacion', label: 'Ubicación consentida', icon: MapPin, perm: 'geo.read' },
  { section: 'Investigación' },
  { to: '/expedientes', label: 'Expedientes', icon: FolderKanban, perm: 'cases.read' },
  { to: '/evidencias', label: 'Evidencias', icon: FileArchive, perm: 'evidence.read' },
  { to: '/informes', label: 'Informes', icon: FileText, perm: 'reports.read' },
  { section: 'Administración' },
  { to: '/creditos', label: 'Créditos', icon: Coins, perm: 'credits.view' },
  { to: '/usuarios', label: 'Usuarios y roles', icon: Users, perm: 'admin.users' },
  { to: '/auditoria', label: 'Auditoría', icon: ScrollText, perm: 'admin.audit' },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get('/search?q=' + encodeURIComponent(q.trim())).then(setRes).catch(() => setRes(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const go = (to) => { setOpen(false); setQ(''); nav(to); };
  const total = res ? res.cases.length + res.evidence.length + res.phones.length + res.findings.length : 0;
  return (
    <div className="global-search" ref={ref}>
      <div className="input-icon"><Search size={16} />
        <input className="input" placeholder="Buscar expedientes, números, evidencias…" value={q} onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Búsqueda global" />
      </div>
      {open && res && (
        <div className="search-results">
          {total === 0 && <div className="muted small" style={{ padding: 14 }}>Sin coincidencias para “{q}”.</div>}
          {res.cases.length > 0 && <div className="sr-group">Expedientes</div>}
          {res.cases.map((c) => <a key={'c' + c.id} href="#" onClick={(e) => { e.preventDefault(); go(`/expedientes/${c.id}`); }}><span className="mono lime">{c.code}</span> · {c.title}</a>)}
          {res.phones.length > 0 && <div className="sr-group">Números en expedientes</div>}
          {res.phones.map((p, i) => <a key={'p' + i} href="#" onClick={(e) => { e.preventDefault(); go(`/expedientes/${p.case_id}`); }}><span className="mono">{p.e164}</span> · {p.code}</a>)}
          {res.evidence.length > 0 && <div className="sr-group">Evidencias</div>}
          {res.evidence.map((e) => <a key={'e' + e.id} href="#" onClick={(ev) => { ev.preventDefault(); go(`/evidencias/${e.id}`); }}><span className="mono lime">{e.code}</span> · {e.title}</a>)}
          {res.findings.length > 0 && <div className="sr-group">Hallazgos</div>}
          {res.findings.map((f) => <a key={'f' + f.id} href="#" onClick={(e) => { e.preventDefault(); go(f.case_id ? `/expedientes/${f.case_id}?tab=hallazgos` : '/hallazgos'); }}>{f.title}</a>)}
        </div>
      )}
    </div>
  );
}

function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const nav = useNavigate();
  const load = () => api.get('/alerts').then(setItems).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const unread = items.filter((a) => !a.read_at);
  const readAll = async () => { await api.post('/alerts/read-all'); load(); };
  const openAlert = async (a) => { if (!a.read_at) await api.post(`/alerts/${a.id}/read`).catch(() => {}); setOpen(false); load(); if (a.link) nav(a.link); };
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn ghost icon" onClick={() => setOpen((o) => !o)} aria-label={`Alertas (${unread.length} sin leer)`} style={{ position: 'relative' }}>
        <Bell size={19} />{unread.length > 0 && <span className="notif-dot" />}
      </button>
      {open && (
        <div className="dropdown-menu" style={{ width: 340 }}>
          <div className="dm-head row between"><b>Alertas</b>{unread.length > 0 && <button className="btn sm ghost" onClick={readAll}><CheckCheck size={14} /> Marcar leídas</button>}</div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.length === 0 && <div className="muted small" style={{ padding: 16 }}>No hay alertas.</div>}
            {items.map((a) => (
              <button key={a.id} className="dm-item" onClick={() => openAlert(a)} style={{ alignItems: 'flex-start', opacity: a.read_at ? 0.6 : 1 }}>
                <span className={`badge ${a.level === 'critical' ? 'b-red' : a.level === 'warning' ? 'b-amber' : 'b-blue'}`} style={{ marginTop: 2 }}><span className="dot" /></span>
                <span><div style={{ fontWeight: 600 }}>{a.title}</div>{a.detail && <div className="small muted">{a.detail}</div>}<div className="small muted">{timeAgo(a.created_at)}</div></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const initials = user.fullName.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-label="Menú de usuario" style={{ padding: '0 6px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--lime-dim)', color: 'var(--lime)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>{initials}</span>
        <span className="hide-xs" style={{ textAlign: 'left', lineHeight: 1.15 }}><div style={{ fontSize: 13 }}>{user.fullName.split(' ')[0]}</div><div className="small muted">{user.roleName}</div></span>
      </button>
      {open && (
        <div className="dropdown-menu">
          <div className="dm-head"><div style={{ fontWeight: 600 }}>{user.fullName}</div><div className="small muted">@{user.username} · {user.roleName}</div></div>
          <Link className="dm-item" to="/configuracion" onClick={() => setOpen(false)}><User size={16} /> Mi perfil</Link>
          <Link className="dm-item" to="/configuracion?tab=seguridad" onClick={() => setOpen(false)}><KeyRound size={16} /> Seguridad y 2FA</Link>
          <button className="dm-item" onClick={logout} style={{ color: 'var(--red)' }}><LogOut size={16} /> Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, can, status } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const items = NAV.filter((n) => n.section || !n.perm || can(n.perm));
  const visible = items.filter((n, i) => !n.section || (items[i + 1] && !items[i + 1].section));
  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Navegación principal">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <Logo />
          <div className="brand-text"><strong>TELEFÓNICA</strong><span>INTELLIGENCE</span></div>
        </Link>
        <nav className="nav">
          {visible.map((n, i) => n.section
            ? <div className="nav-section" key={'s' + i}>{n.section}</div>
            : <NavLink key={n.to} to={n.to} end={n.end}><n.icon size={18} />{n.label}</NavLink>)}
        </nav>
        <div className="sidebar-foot">
          {can('credits.view') && <Link to="/creditos" className="credit-pill" style={{ textDecoration: 'none' }}><span className="row" style={{ gap: 8 }}><Coins size={15} color="var(--lime)" /> Créditos</span><b>{fmtNum(user.credits)}</b></Link>}
          <div className="row" style={{ gap: 6 }}><ShieldCheck size={14} color="var(--lime)" /> {status?.mode === 'demo' ? 'Entorno de demostración' : 'Entorno privado'}</div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        {status?.mode === 'demo' && <div className="demo-banner">ENTORNO DE DEMOSTRACIÓN — TODOS LOS DATOS SON FICTICIOS</div>}
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setNavOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
          <GlobalSearch />
          <div className="grow" />
          <AlertsBell />
          <UserMenu />
        </header>
        <main className="content" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
