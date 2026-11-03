import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, User, SlidersHorizontal, KeyRound, Server, Radar, Archive, Info, Save, ShieldCheck, Monitor, Trash2, Download, Fingerprint, Play, Database, RotateCcw } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, Badge, Loading, Tabs, Switch, Modal, Empty, CopyButton } from '../components/ui.jsx';
import { fmtDateTime, fmtBytes, timeAgo } from '../lib/format.js';

function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const countries = useFetch('/phone/countries');
  const [f, setF] = useState({ fullName: user.fullName, email: user.email || '', preferences: { pageSize: 20, defaultCountry: 'CO', compact: false, reduceMotion: false, ...user.preferences } });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.put('/auth/profile', { ...f, preferences: { ...f.preferences, pageSize: Number(f.preferences.pageSize) } }); toast.success('Perfil y preferencias guardados.'); refresh(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const p = (k, v) => setF({ ...f, preferences: { ...f.preferences, [k]: v } });
  return (
    <div className="grid g2">
      <div className="stack">
        <h3><User size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Perfil de usuario</h3>
        <Field label="Nombre completo"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Correo"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <dl className="dl" style={{ gridTemplateColumns: '120px 1fr' }}><dt>Usuario</dt><dd className="mono">@{user.username}</dd><dt>Rol</dt><dd>{user.roleName}</dd><dt>Permisos</dt><dd>{user.permissions.length}</dd></dl>
      </div>
      <div className="stack">
        <h3><SlidersHorizontal size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Preferencias</h3>
        <Field label="Registros por página"><select className="select" value={f.preferences.pageSize} onChange={(e) => p('pageSize', e.target.value)}>{[10, 20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="País predeterminado para análisis"><select className="select" value={f.preferences.defaultCountry} onChange={(e) => p('defaultCountry', e.target.value)}>{(countries.data || []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
        <Switch checked={f.preferences.compact} onChange={(v) => p('compact', v)} label="Vista compacta de tablas" />
        <Switch checked={f.preferences.reduceMotion} onChange={(v) => p('reduceMotion', v)} label="Reducir animaciones" />
      </div>
      <div className="full" style={{ gridColumn: '1 / -1' }}><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={15} />} Guardar cambios</button></div>
    </div>
  );
}

function Security() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const sessions = useFetch('/auth/sessions');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [totp, setTotp] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const changePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error('Las contraseñas no coinciden.');
    setBusy(true);
    try { await api.post('/auth/password', { current: pw.current, next: pw.next }); toast.success('Contraseña actualizada. Se cerraron sus otras sesiones.'); setPw({ current: '', next: '', confirm: '' }); refresh(); sessions.reload(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const start2fa = async () => { try { setTotp(await api.post('/auth/2fa/setup')); setCode(''); } catch (e) { toast.error(e); } };
  const enable2fa = async () => {
    try { const r = await api.post('/auth/2fa/enable', { code }); setTotp(null); setCodes(r.recoveryCodes); toast.success('Verificación en dos pasos activada.'); refresh(); } catch (e) { toast.error(e); }
  };
  const disable2fa = async () => {
    const password = await confirm({ title: 'Desactivar verificación en dos pasos', danger: true, warning: 'Su cuenta quedará protegida solo por contraseña.', message: 'Ingrese su contraseña para confirmar.', reason: true, reasonLabel: 'Contraseña actual', minReason: 1, confirmText: 'Desactivar' });
    if (!password) return;
    try { await api.post('/auth/2fa/disable', { password }); toast.success('2FA desactivado.'); refresh(); } catch (e) { toast.error(e); }
  };
  return (
    <div className="grid g2">
      <form className="stack" onSubmit={changePw}>
        <h3><KeyRound size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Cambiar contraseña</h3>
        <Field label="Contraseña actual"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></Field>
        <Field label="Nueva contraseña" help="Mínimo 10 caracteres con letras y números."><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required /></Field>
        <Field label="Confirmar nueva contraseña"><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required /></Field>
        <div><button className="btn primary" disabled={busy}>{busy && <Spinner />} Actualizar contraseña</button></div>
      </form>
      <div className="stack">
        <h3><ShieldCheck size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Verificación en dos pasos (TOTP)</h3>
        {user.totpEnabled ? <>
          <div className="alert success"><ShieldCheck size={18} color="var(--lime)" /> Activa. Se solicitará un código de su aplicación de autenticación al iniciar sesión.</div>
          <div><button className="btn danger" onClick={disable2fa}>Desactivar 2FA</button></div>
        </> : <>
          <p className="muted">Use Google Authenticator, Microsoft Authenticator, Authy u otra app compatible con TOTP.</p>
          <div><button className="btn primary" onClick={start2fa}><KeyRound size={15} /> Configurar 2FA</button></div>
        </>}
        <h3 className="mt"><Monitor size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Sesiones activas</h3>
        {sessions.loading ? <Loading /> : sessions.data?.map((s) => (
          <div key={s.id} className="row between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0 }}><div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.user_agent || 'Navegador desconocido'}</div><div className="small muted">IP {s.ip} · actividad {timeAgo(s.last_seen_at)}</div></div>
            {s.current ? <Badge cls="b-lime">Actual</Badge> : <button className="btn sm ghost" onClick={async () => { try { await api.del(`/auth/sessions/${s.id}`); toast.success('Sesión cerrada.'); sessions.reload(); } catch (e) { toast.error(e); } }}><Trash2 size={13} /> Cerrar</button>}
          </div>
        ))}
        <div><button className="btn ghost" onClick={logout}>Cerrar sesión en este dispositivo</button></div>
      </div>
      {totp && <Modal title="Configurar verificación en dos pasos" onClose={() => setTotp(null)} footer={<><button className="btn" onClick={() => setTotp(null)}>Cancelar</button><button className="btn primary" disabled={code.length !== 6} onClick={enable2fa}>Activar</button></>}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p>1. Escanee el código QR con su aplicación de autenticación.</p>
          <div className="qr"><img src={totp.qr} alt="Código QR para la aplicación de autenticación" width={200} height={200} /></div>
          <div className="small muted">¿No puede escanear? Ingrese esta clave manualmente:</div>
          <div className="row"><span className="hash">{totp.secret}</span><CopyButton text={totp.secret} /></div>
          <p>2. Ingrese el código de 6 dígitos que muestra la aplicación.</p>
          <input className="input mono" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={{ maxWidth: 200, textAlign: 'center', fontSize: 20, letterSpacing: '0.3em' }} inputMode="numeric" autoFocus />
        </div>
      </Modal>}
      {codes && <Modal title="Códigos de recuperación" onClose={() => setCodes(null)} footer={<button className="btn primary" onClick={() => setCodes(null)}>Los guardé en un lugar seguro</button>}>
        <div className="stack">
          <div className="alert warning">Guarde estos códigos. Cada uno sirve <b>una sola vez</b> si pierde acceso a su aplicación. No se volverán a mostrar.</div>
          <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <CopyButton text={codes.join('\n')} label="Copiar todos" />
        </div>
      </Modal>}
    </div>
  );
}

const PARAMS = [
  ['system.organization', 'Nombre de la organización', 'text'],
  ['system.default_country', 'País predeterminado (ISO-2)', 'text'],
  ['system.session_hours', 'Duración máxima de sesión (horas)', 'number'],
  ['system.idle_minutes', 'Cierre por inactividad (minutos)', 'number'],
  ['security.max_login_attempts', 'Intentos fallidos antes de bloquear', 'number'],
  ['security.lockout_minutes', 'Duración del bloqueo (minutos)', 'number'],
  ['security.password_min_length', 'Longitud mínima de contraseña', 'number'],
  ['security.require_2fa_admin', 'Impedir que administradores desactiven 2FA', 'bool'],
  ['geo.default_expiry_hours', 'Vigencia predeterminada de enlaces de ubicación (h)', 'number'],
  ['geo.max_expiry_hours', 'Vigencia máxima de enlaces de ubicación (h)', 'number'],
];
const RETENTION = [
  ['retention.phone_queries_days', 'Análisis telefónicos'],
  ['retention.osint_queries_days', 'Consultas OSINT'],
  ['retention.geo_days', 'Enlaces y ubicaciones (vencidos o revocados)'],
  ['retention.audit_days', 'Registro de auditoría (mín. 90)'],
  ['retention.closed_cases_days', 'Expedientes cerrados/archivados (0 = nunca)'],
];

function SystemParams({ settings, save }) {
  const [f, setF] = useState(() => Object.fromEntries(PARAMS.map(([k]) => [k, settings[k]])));
  return (
    <div className="stack">
      <div className="form-grid">
        {PARAMS.map(([k, label, type]) => (
          <Field key={k} label={label}>
            {type === 'bool' ? <Switch checked={f[k]} onChange={(v) => setF({ ...f, [k]: v })} label={f[k] ? 'Sí' : 'No'} />
              : <input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <div><button className="btn primary" onClick={() => save(f)}><Save size={15} /> Guardar parámetros</button></div>
    </div>
  );
}

function SearchApi() {
  const toast = useToast();
  const cfg = useFetch('/settings/search');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  useEffect(() => { if (cfg.data) setF({ provider: cfg.data.provider, braveKey: '', googleKey: '', googleCx: cfg.data.googleCx }); }, [cfg.data]);
  if (!f) return <Loading />;
  const save = async () => {
    setBusy(true); setTest(null);
    try { await api.put('/settings/search', f); toast.success('Buscador guardado.'); cfg.reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const probe = async () => {
    setBusy(true);
    try { setTest(await api.post('/settings/search/test')); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const d = cfg.data;
  return (
    <div className="card card-pad" style={{ background: 'var(--panel-2)' }}>
      <h3 style={{ marginBottom: 6 }}>Búsqueda automática en Internet</h3>
      <p className="small muted">Permite que "Investigar número" y la herramienta de búsqueda muestren resultados reales de la web. Use su propia clave (gratuita). Se guarda cifrada y nunca se muestra de nuevo.</p>
      <div className="form-grid mt">
        <Field label="Buscador"><select className="select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
          <option value="none">Desactivado</option><option value="brave">Brave Search API (recomendado)</option><option value="google">Google Programmable Search</option></select></Field>
        <div />
        {f.provider === 'brave' && <Field label={`Clave de Brave ${d.braveKeySet ? '(ya registrada — deje vacío para conservarla)' : ''}`} className="full" help={<>Créela gratis en <a href={d.providers.brave.signup} target="_blank" rel="noopener noreferrer">api-dashboard.search.brave.com</a> → plan "Free" → API Keys.</>}>
          <input className="input mono" type="password" value={f.braveKey} onChange={(e) => setF({ ...f, braveKey: e.target.value })} placeholder={d.braveKeySet ? '••••••••••••' : 'BSA…'} autoComplete="off" /></Field>}
        {f.provider === 'google' && <>
          <Field label={`Clave de API de Google ${d.googleKeySet ? '(ya registrada)' : ''}`} help={<a href={d.providers.google.signup} target="_blank" rel="noopener noreferrer">Instrucciones de Google</a>}><input className="input mono" type="password" value={f.googleKey} onChange={(e) => setF({ ...f, googleKey: e.target.value })} placeholder={d.googleKeySet ? '••••••••••••' : 'AIza…'} autoComplete="off" /></Field>
          <Field label="Identificador del buscador (cx)" help="Cree un buscador en programmablesearchengine.google.com con 'Buscar en toda la Web'."><input className="input mono" value={f.googleCx} onChange={(e) => setF({ ...f, googleCx: e.target.value })} /></Field>
        </>}
      </div>
      <div className="row mt">
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={15} />} Guardar buscador</button>
        {d.provider !== 'none' && <button className="btn" onClick={probe} disabled={busy}><Play size={15} /> Probar conexión</button>}
        {d.provider !== 'none' && <Badge cls="b-lime" dot>Activo: {d.providers[d.provider]?.label}</Badge>}
      </div>
      {test && <div className={`alert ${test.ok ? 'success' : 'error'} mt`}>{test.ok ? `Conexión correcta: ${test.results} resultado(s) de prueba.` : `Falló: ${test.error}`}</div>}
    </div>
  );
}

function Sources({ settings, tools, save }) {
  const [f, setF] = useState({ ...settings['osint.sources'] });
  return (
    <div className="stack">
      <SearchApi />
      <p className="muted">Active o desactive cada fuente pública. Las fuentes desactivadas no pueden consultarse. Ninguna requiere clave de API ni tiene costo.</p>
      {Object.entries(tools).map(([k, t]) => (
        <div key={k} className="row between" style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div><b>{t.label}</b><div className="small muted">{t.source}</div></div>
          <Switch checked={f[k] !== false} onChange={(v) => setF({ ...f, [k]: v })} />
        </div>
      ))}
      <div><button className="btn primary" onClick={() => save({ 'osint.sources': f })}><Save size={15} /> Guardar fuentes</button></div>
    </div>
  );
}

function RetentionBackups({ settings, save, canBackup }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(() => Object.fromEntries([...RETENTION.map(([k]) => [k, settings[k]]), ['backup.auto_daily', settings['backup.auto_daily']], ['backup.keep', settings['backup.keep']]]));
  const backups = useFetch(canBackup ? '/backups' : null);
  const preview = useFetch(canBackup ? '/retention/preview' : null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const r = await api.post('/backups'); toast.success(`Copia creada: ${r.name}`); backups.reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const verify = async (name) => { try { const r = await api.post(`/backups/${name}/verify`); r.ok ? toast.success(`Copia íntegra (${r.files} archivos).`) : toast.error(r.error); } catch (e) { toast.error(e); } };
  const purge = async () => {
    const p = preview.data || {};
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    if (!(await confirm({ title: 'Ejecutar purga ahora', danger: true, message: `Se eliminarán ${total} registro(s) que superan los plazos de conservación: ${Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', ')}.`, confirmText: 'Purgar' }))) return;
    try { await api.post('/retention/run'); toast.success('Purga ejecutada.'); preview.reload(); } catch (e) { toast.error(e); }
  };
  return (
    <div className="grid g2">
      <div className="stack">
        <h3>Políticas de conservación</h3>
        <p className="small muted">Plazo en días tras el cual los registros se eliminan automáticamente (0 = conservar indefinidamente). La purga se ejecuta cada 6 horas.</p>
        {RETENTION.map(([k, label]) => <Field key={k} label={label}><input className="input" type="number" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        <Switch checked={f['backup.auto_daily']} onChange={(v) => setF({ ...f, 'backup.auto_daily': v })} label="Copia de seguridad automática diaria" />
        <Field label="Copias automáticas a conservar"><input className="input" type="number" min={1} max={90} value={f['backup.keep']} onChange={(e) => setF({ ...f, 'backup.keep': e.target.value })} /></Field>
        <div className="row"><button className="btn primary" onClick={() => save(f)}><Save size={15} /> Guardar políticas</button>{canBackup && <button className="btn" onClick={purge}><Play size={15} /> Purgar ahora</button>}</div>
        {preview.data && <div className="small muted">Pendiente de purga: {Object.entries(preview.data).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
      </div>
      {canBackup && <div className="stack">
        <div className="row between"><h3><Database size={16} color="var(--lime)" style={{ verticalAlign: -3 }} /> Copias de seguridad</h3><button className="btn primary sm" onClick={create} disabled={busy}>{busy ? <Spinner /> : <Archive size={14} />} Crear copia ahora</button></div>
        <p className="small muted">Incluyen la base de datos, evidencias e informes, cifrados con la clave maestra (AES-256-GCM). Sin la clave MASTER_KEY no pueden restaurarse. Restauración: <span className="mono">npm run restore -- archivo.tibak --confirmar</span></p>
        {backups.loading ? <Loading /> : backups.data?.length === 0 ? <Empty icon={Archive} title="Sin copias" /> : backups.data?.map((b) => (
          <div key={b.name} className="row between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ minWidth: 0 }}><div className="mono small break">{b.name}</div><div className="small muted">{fmtDateTime(b.createdAt)} · {fmtBytes(b.size)}</div></div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm icon ghost" title="Verificar" aria-label="Verificar" onClick={() => verify(b.name)}><Fingerprint size={14} /></button>
              <button className="btn sm icon ghost" title="Descargar" aria-label="Descargar" onClick={() => download(`/backups/${b.name}/download`, b.name).catch(toast.error)}><Download size={14} /></button>
              <button className="btn sm icon ghost" title="Eliminar" aria-label="Eliminar" onClick={async () => { if (await confirm({ title: 'Eliminar copia', danger: true, message: b.name, confirmText: 'Eliminar' })) { try { await api.del(`/backups/${b.name}`); backups.reload(); toast.success('Copia eliminada.'); } catch (e) { toast.error(e); } } }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}

function SystemInfo() {
  const info = useFetch('/system/info');
  if (info.loading) return <Loading />;
  const i = info.data;
  return (
    <dl className="dl">
      <dt>Versión</dt><dd>{i.version} (esquema {i.schemaVersion})</dd>
      <dt>Modo</dt><dd>{i.mode === 'demo' ? <Badge cls="b-amber">Demostración</Badge> : <Badge cls="b-lime">Privado</Badge>}</dd>
      <dt>Node.js</dt><dd>{i.node}</dd>
      <dt>En ejecución desde</dt><dd>{fmtDateTime(i.startedAt)}</dd>
      <dt>Base de datos</dt><dd>{fmtBytes(i.dbSize)}</dd>
      <dt>Evidencias</dt><dd>{i.evidenceFiles} archivo(s) cifrado(s), {fmtBytes(i.evidenceSize)}</dd>
      <dt>Usuarios</dt><dd>{i.users}</dd>
      <dt>Límite de carga</dt><dd>{i.maxUploadMb} MB</dd>
      <dt>Cookies seguras (HTTPS)</dt><dd>{i.cookieSecure ? 'Sí' : 'No (uso local)'}</dd>
      <dt>URL pública</dt><dd>{i.publicUrl || 'No configurada (enlaces de ubicación solo locales)'}</dd>
      <dt>Última copia automática</dt><dd>{fmtDateTime(i.lastAutoBackup)}</dd>
    </dl>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'perfil';
  const admin = can('admin.settings');
  const cfg = useFetch(admin ? '/settings' : null);
  const [ver, setVer] = useState(0);
  useEffect(() => setVer((v) => v + 1), [cfg.data]);
  const save = async (values) => {
    try { await api.put('/settings', values); toast.success('Configuración guardada.'); cfg.reload(); } catch (e) { toast.error(e); }
  };
  const resetDefaults = async () => {
    if (!(await confirm({ title: 'Restablecer parámetros', message: 'Los parámetros del sistema volverán a sus valores predeterminados.', confirmText: 'Restablecer' }))) return;
    try { await api.post('/settings/reset', { keys: PARAMS.map(([k]) => k) }); toast.success('Parámetros restablecidos.'); cfg.reload(); } catch (e) { toast.error(e); }
  };
  const tabs = [
    { key: 'perfil', label: 'Perfil y preferencias', icon: User },
    { key: 'seguridad', label: 'Seguridad', icon: KeyRound },
    ...(admin ? [{ key: 'sistema', label: 'Parámetros del sistema', icon: Server }, { key: 'fuentes', label: 'Fuentes', icon: Radar }, { key: 'retencion', label: 'Retención y copias', icon: Archive }, { key: 'info', label: 'Información', icon: Info }] : []),
  ];
  return (
    <>
      <PageHead eyebrow="Módulo J" icon={SettingsIcon} title="Configuración" sub="Perfil, seguridad de la cuenta y parámetros de la plataforma.">
        {tab === 'sistema' && admin && <button className="btn" onClick={resetDefaults}><RotateCcw size={15} /> Valores predeterminados</button>}
      </PageHead>
      <div className="card">
        <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t })} />
        <div className="card-body">
          {tab === 'perfil' && <Profile />}
          {tab === 'seguridad' && <Security />}
          {admin && ['sistema', 'fuentes', 'retencion'].includes(tab) && (cfg.loading || !cfg.data ? <Loading /> : <div key={ver}>
            {tab === 'sistema' && <SystemParams settings={cfg.data.settings} save={save} />}
            {tab === 'fuentes' && <Sources settings={cfg.data.settings} tools={cfg.data.osintTools} save={save} />}
            {tab === 'retencion' && <RetentionBackups settings={cfg.data.settings} save={save} canBackup={can('admin.backups')} />}
          </div>)}
          {admin && tab === 'info' && <SystemInfo />}
        </div>
      </div>
    </>
  );
}
