import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Coins, Plus, Minus, Download, Save, Users, ShieldCheck, KeyRound, UserPlus, Pencil, Trash2, Link2, LogOut, ScrollText, ShieldOff, Settings2 } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, Badge, Pagination, Empty, Loading, SearchInput, Modal, Tabs, Kpi, Switch, CopyButton, DemoBadge } from '../components/ui.jsx';
import { fmtDateTime, fmtNum, OPERATION_LABEL } from '../lib/format.js';

const tip = { contentStyle: { background: '#1b201d', border: '1px solid #343c37', borderRadius: 10, fontSize: 12 }, itemStyle: { color: '#b9c2bc' }, labelStyle: { color: '#e7ece8' } };

// ======================= CRÉDITOS =======================
export function Credits() {
  const { user, can, refresh } = useAuth();
  const toast = useToast();
  const sum = useFetch('/admin/credits/summary');
  const [filters, setFilters] = useState({ q: '', userId: '', page: 1 });
  const tx = useFetch('/admin/credits/transactions' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  const [adjust, setAdjust] = useState(null);
  const [costs, setCosts] = useState(null);
  const [busy, setBusy] = useState(false);
  const admin = can('admin.credits');
  useEffect(() => { if (sum.data) setCosts({ costs: { ...sum.data.costs }, enforce: sum.data.enforce, defaultNewUser: sum.data.defaultNewUser ?? 100 }); }, [sum.data]);
  const doAdjust = async () => {
    setBusy(true);
    try {
      await api.post('/admin/credits/adjust', { userId: adjust.userId, amount: Number(adjust.amount) * (adjust.sign === '-' ? -1 : 1), note: adjust.note });
      toast.success('Créditos actualizados.'); setAdjust(null); sum.reload(); tx.reload(); refresh();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const saveCosts = async () => {
    setBusy(true);
    try { await api.put('/admin/credits/costs', costs); toast.success('Configuración de costos guardada.'); sum.reload(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  if (sum.loading && !sum.data) return <Loading />;
  const s = sum.data;
  return (
    <>
      <PageHead eyebrow="Módulo H" icon={Coins} title="Créditos internos" sub="Control de consumo por operación. Sistema interno: no se procesan pagos reales.">
        <button className="btn" onClick={() => download('/admin/credits/transactions' + qs({ ...filters, format: 'csv' })).catch(toast.error)}><Download size={15} /> CSV</button>
        {admin && <button className="btn primary" onClick={() => setAdjust({ userId: s.users?.[0]?.id, amount: 100, sign: '+', note: '' })}><Plus size={15} /> Asignar créditos</button>}
      </PageHead>
      <div className="grid g4">
        <Kpi icon={Coins} label="Mi saldo" value={fmtNum(s.balance)} foot={s.enforce ? 'Control de saldo activo' : 'Control de saldo desactivado'} />
        <Kpi icon={Minus} label="Consumidos (30 días)" value={fmtNum(s.consumed30)} tone="amber" />
        {admin && <Kpi icon={Users} label="Saldo total asignado" value={fmtNum(s.totalBalance)} tone="blue" />}
        {admin && <Kpi icon={ScrollText} label="Consumo histórico total" value={fmtNum(s.totalConsumed)} tone="red" />}
      </div>
      <div className="grid g2 mt">
        <div className="card"><div className="card-head"><h3>Mi consumo por operación</h3></div>
          <div className="card-body chart-box">{s.byOperation.length === 0 ? <Empty title="Sin consumo" /> : (
            <ResponsiveContainer width="100%" height="100%"><BarChart data={s.byOperation.map((x) => ({ ...x, label: OPERATION_LABEL[x.operation] || x.operation }))} margin={{ left: -16 }}>
              <CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip {...tip} cursor={{ fill: 'rgba(163,230,53,0.05)' }} />
              <Bar dataKey="total" name="Créditos" fill="#a3e635" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>)}</div></div>
        <div className="card"><div className="card-head"><h3><Settings2 size={16} color="var(--lime)" /> Costo por operación</h3>{admin && <button className="btn sm primary" onClick={saveCosts} disabled={busy}><Save size={13} /> Guardar</button>}</div>
          <div className="card-body">
            {costs && <div className="stack" style={{ gap: 10 }}>
              <div className="form-grid">{Object.entries(costs.costs).map(([k, v]) => (
                <Field key={k} label={OPERATION_LABEL[k] || k}><input className="input" type="number" min={0} max={1000} value={v} disabled={!admin} onChange={(e) => setCosts({ ...costs, costs: { ...costs.costs, [k]: e.target.value } })} /></Field>))}</div>
              {admin && <>
                <Switch checked={costs.enforce} onChange={(enforce) => setCosts({ ...costs, enforce })} label="Bloquear operaciones sin saldo suficiente" />
                <Field label="Saldo inicial para usuarios nuevos"><input className="input" type="number" min={0} value={costs.defaultNewUser} onChange={(e) => setCosts({ ...costs, defaultNewUser: e.target.value })} /></Field>
              </>}
            </div>}
          </div></div>
      </div>
      {admin && s.users && (
        <div className="card mt"><div className="card-head"><h3><Users size={16} color="var(--lime)" /> Saldos por usuario</h3></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Usuario</th><th className="right">Saldo</th><th></th></tr></thead>
            <tbody>{s.users.map((u) => <tr key={u.id}><td><div className="t-title">{u.full_name}</div><div className="t-sub">@{u.username}{!u.active && ' · inactivo'}</div></td><td className="right mono lime">{fmtNum(u.credits)}</td>
              <td className="right nowrap"><button className="btn sm" onClick={() => setAdjust({ userId: u.id, amount: 100, sign: '+', note: '' })}><Plus size={13} /> Asignar</button> <button className="btn sm ghost" onClick={() => setAdjust({ userId: u.id, amount: 10, sign: '-', note: '' })}><Minus size={13} /> Descontar</button> <button className="btn sm ghost" onClick={() => setFilters({ ...filters, userId: u.id, page: 1 })}>Movimientos</button></td></tr>)}</tbody></table></div></div>
      )}
      <div className="card mt">
        <div className="card-head"><h3>Historial de movimientos</h3>{filters.userId && <button className="btn sm ghost" onClick={() => setFilters({ ...filters, userId: '', page: 1 })}>Quitar filtro de usuario</button>}</div>
        <div className="toolbar"><SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Operación, nota o referencia…" /></div>
        {tx.loading && !tx.data ? <Loading /> : tx.data?.items.length === 0 ? <Empty icon={Coins} title="Sin movimientos" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th>{admin && <th>Usuario</th>}<th>Tipo</th><th className="hide-sm">Operación / nota</th><th className="right">Cantidad</th><th className="right hide-sm">Saldo</th></tr></thead>
            <tbody>{tx.data?.items.map((t) => <tr key={t.id}><td className="small nowrap">{fmtDateTime(t.created_at)}</td>{admin && <td className="small">{t.username}</td>}
              <td><Badge cls={t.kind === 'consumo' ? 'b-gray' : t.amount > 0 ? 'b-lime' : 'b-amber'}>{t.kind}</Badge> <DemoBadge show={t.is_demo} /></td>
              <td className="hide-sm small">{OPERATION_LABEL[t.operation] || t.note || '—'}{t.reference && <span className="muted mono"> · {t.reference}</span>}{t.performed_by_name && t.kind !== 'consumo' && <span className="muted"> · por {t.performed_by_name}</span>}</td>
              <td className={`right mono ${t.amount > 0 ? 'lime' : 'danger-text'}`}>{t.amount > 0 ? '+' : ''}{t.amount}</td><td className="right mono hide-sm">{fmtNum(t.balance_after)}</td></tr>)}</tbody></table></div>
        )}
        <Pagination data={tx.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {adjust && <Modal title="Asignación manual de créditos" onClose={() => setAdjust(null)} footer={<><button className="btn" onClick={() => setAdjust(null)}>Cancelar</button><button className="btn primary" disabled={busy || adjust.note.trim().length < 3 || !(Number(adjust.amount) > 0)} onClick={doAdjust}>{busy && <Spinner />} Aplicar</button></>}>
        <div className="stack">
          <Field label="Usuario"><select className="select" value={adjust.userId} onChange={(e) => setAdjust({ ...adjust, userId: Number(e.target.value) })}>{s.users.map((u) => <option key={u.id} value={u.id}>{u.full_name} (saldo {u.credits})</option>)}</select></Field>
          <div className="form-grid">
            <Field label="Operación"><select className="select" value={adjust.sign} onChange={(e) => setAdjust({ ...adjust, sign: e.target.value })}><option value="+">Asignar (+)</option><option value="-">Descontar (−)</option></select></Field>
            <Field label="Cantidad"><input className="input" type="number" min={1} value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} /></Field>
          </div>
          <Field label="Motivo (obligatorio)"><input className="input" value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} placeholder="Asignación mensual, corrección…" /></Field>
        </div>
      </Modal>}
    </>
  );
}

// ======================= USUARIOS Y ROLES =======================
function UserModal({ initial, roles, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ username: initial?.username || '', fullName: initial?.full_name || '', email: initial?.email || '', roleId: initial?.role_id || roles.find((r) => r.key === 'analista')?.id || roles[0]?.id, active: initial ? !!initial.active : true, password: '', mustChangePassword: true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (initial) await api.put(`/admin/users/${initial.id}`, { fullName: f.fullName, email: f.email, roleId: Number(f.roleId), active: f.active });
      else await api.post('/admin/users', { ...f, roleId: Number(f.roleId) });
      toast.success(initial ? 'Usuario actualizado.' : 'Usuario creado.'); onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={initial ? `Editar @${initial.username}` : 'Nuevo usuario'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{busy && <Spinner />} Guardar</button></>}>
      <div className="form-grid">
        <Field label="Nombre completo" className="full"><input className="input" value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label="Usuario"><input className="input" value={f.username} onChange={set('username')} disabled={!!initial} autoComplete="off" /></Field>
        <Field label="Correo"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Rol"><select className="select" value={f.roleId} onChange={set('roleId')}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Estado"><Switch checked={f.active} onChange={(active) => setF({ ...f, active })} label={f.active ? 'Activo' : 'Inactivo'} /></Field>
        {!initial && <>
          <Field label="Contraseña temporal" className="full" help="Mínimo 10 caracteres con letras y números. Entréguela por un canal seguro."><input className="input" type="text" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <label className="check full"><input type="checkbox" checked={f.mustChangePassword} onChange={(e) => setF({ ...f, mustChangePassword: e.target.checked })} /> Exigir cambio de contraseña en el primer acceso</label>
        </>}
      </div>
    </Modal>
  );
}

function RoleModal({ initial, catalog, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name || '', description: initial?.description || '', permissions: initial?.permissions || ['dashboard.view'] });
  const toggle = (p) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] });
  const save = async () => {
    try {
      if (initial?.id) await api.put(`/admin/roles/${initial.id}`, f); else await api.post('/admin/roles', f);
      toast.success('Rol guardado.'); onSaved(); onClose();
    } catch (e) { toast.error(e); }
  };
  const groups = {};
  Object.entries(catalog).forEach(([k, v]) => { const g = k.split('.')[0]; (groups[g] ||= []).push([k, v]); });
  return (
    <Modal size="lg" title={initial?.id ? `Editar rol: ${initial.name}` : 'Nuevo rol'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}><Save size={15} /> Guardar</button></>}>
      <div className="stack">
        <div className="form-grid"><Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Descripción"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        <div className="row between"><b>Permisos ({f.permissions.length})</b><div className="row"><button className="btn sm ghost" onClick={() => setF({ ...f, permissions: Object.keys(catalog) })}>Todos</button><button className="btn sm ghost" onClick={() => setF({ ...f, permissions: [] })}>Ninguno</button></div></div>
        {Object.entries(groups).map(([g, perms]) => (
          <div key={g}><div className="nav-section" style={{ padding: '4px 0' }}>{g}</div>
            <div className="perm-grid">{perms.map(([k, v]) => <label className="check" key={k}><input type="checkbox" checked={f.permissions.includes(k)} onChange={() => toggle(k)} /><span>{v} <span className="mono small muted">{k}</span></span></label>)}</div></div>
        ))}
      </div>
    </Modal>
  );
}

export function UsersRoles() {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'usuarios';
  const [filters, setFilters] = useState({ q: '', page: 1 });
  const users = useFetch('/admin/users' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  const roleOpts = useFetch('/admin/roles/options');
  const roles = useFetch(can('admin.roles') ? '/admin/roles' : null);
  const [modal, setModal] = useState(null);
  const [resetLink, setResetLink] = useState(null);
  const action = async (fn, opts, ok) => {
    if (opts && !(await confirm(opts))) return;
    try { const r = await fn(); if (ok) toast.success(ok); users.reload(); return r; } catch (e) { toast.error(e); }
  };
  return (
    <>
      <PageHead eyebrow="Módulo I" icon={Users} title="Usuarios y roles" sub="Cuentas, control de acceso basado en roles y recuperación segura de acceso.">
        {tab === 'usuarios' && <button className="btn primary" onClick={() => setModal({ type: 'user' })}><UserPlus size={15} /> Nuevo usuario</button>}
        {tab === 'roles' && can('admin.roles') && <button className="btn primary" onClick={() => setModal({ type: 'role' })}><Plus size={15} /> Nuevo rol</button>}
      </PageHead>
      <div className="card">
        <Tabs tabs={[{ key: 'usuarios', label: 'Usuarios', icon: Users }, ...(can('admin.roles') ? [{ key: 'roles', label: 'Roles y permisos', icon: ShieldCheck }] : [])]} value={tab} onChange={(t) => setSp({ tab: t })} />
        {tab === 'usuarios' && <>
          <div className="toolbar"><SearchInput value={filters.q} onChange={(q) => setFilters({ q, page: 1 })} placeholder="Nombre, usuario o correo…" /></div>
          {users.loading && !users.data ? <Loading /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th className="hide-sm">2FA</th><th className="hide-sm">Último acceso</th><th></th></tr></thead>
              <tbody>{users.data?.items.map((u) => (
                <tr key={u.id}>
                  <td><div className="t-title">{u.full_name} <DemoBadge show={u.is_demo} /></div><div className="t-sub">@{u.username}{u.email && ` · ${u.email}`}</div></td>
                  <td><Badge cls={u.role_key === 'admin' ? 'b-lime' : 'b-blue'}>{u.role_name}</Badge></td>
                  <td><Badge cls={u.active ? 'b-lime' : 'b-gray'} dot>{u.active ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td className="hide-sm">{u.totp_enabled ? <Badge cls="b-lime"><KeyRound size={11} /> Sí</Badge> : <span className="muted small">No</span>}</td>
                  <td className="hide-sm small">{fmtDateTime(u.last_login_at)}</td>
                  <td className="right nowrap">
                    <button className="btn sm icon ghost" title="Editar" aria-label="Editar" onClick={() => setModal({ type: 'user', item: u })}><Pencil size={14} /></button>
                    <button className="btn sm icon ghost" title="Enlace de restablecimiento" aria-label="Enlace de restablecimiento" onClick={async () => { const r = await action(() => api.post(`/admin/users/${u.id}/reset-link`), { title: 'Generar enlace de restablecimiento', message: `Se generará un enlace de un solo uso (24 h) para que @${u.username} defina una nueva contraseña.`, confirmText: 'Generar' }); if (r) setResetLink({ ...r, username: u.username }); }}><Link2 size={14} /></button>
                    {u.totp_enabled ? <button className="btn sm icon ghost" title="Restablecer 2FA" aria-label="Restablecer 2FA" onClick={() => action(() => api.post(`/admin/users/${u.id}/disable-2fa`), { title: 'Desactivar 2FA', danger: true, message: `Se desactivará la verificación en dos pasos de @${u.username}.`, confirmText: 'Desactivar' }, '2FA restablecido.')}><ShieldOff size={14} /></button> : null}
                    {u.id !== user.id && <button className="btn sm icon ghost" title="Cerrar sus sesiones" aria-label="Cerrar sesiones" onClick={() => action(() => api.post(`/admin/users/${u.id}/logout-all`), { title: 'Cerrar sesiones', message: `Se cerrarán todas las sesiones de @${u.username}.`, confirmText: 'Cerrar sesiones' }, 'Sesiones cerradas.')}><LogOut size={14} /></button>}
                  </td>
                </tr>))}</tbody></table></div>
          )}
          <Pagination data={users.data} onPage={(page) => setFilters({ ...filters, page })} />
        </>}
        {tab === 'roles' && (roles.loading ? <Loading /> : (
          <div className="card-body grid g3">
            {roles.data?.roles.map((r) => (
              <div key={r.id} className="card card-pad" style={{ background: 'var(--panel-2)' }}>
                <div className="row between"><h3>{r.name}</h3>{r.is_system ? <Badge>Sistema</Badge> : <Badge cls="b-violet">Personalizado</Badge>}</div>
                <p className="small muted mt">{r.description}</p>
                <div className="small"><b className="lime">{r.permissions.length}</b> permisos · {r.users} usuario(s)</div>
                <div className="row mt">
                  {r.key !== 'admin' && <button className="btn sm" onClick={() => setModal({ type: 'role', item: r })}><Pencil size={13} /> Editar permisos</button>}
                  {!r.is_system && <button className="btn sm ghost" onClick={async () => { if (await confirm({ title: 'Eliminar rol', danger: true, message: `Se eliminará el rol ${r.name}.`, confirmText: 'Eliminar' })) { try { await api.del(`/admin/roles/${r.id}`); toast.success('Rol eliminado.'); roles.reload(); roleOpts.reload(); } catch (e) { toast.error(e); } } }}><Trash2 size={13} /> Eliminar</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {modal?.type === 'user' && roleOpts.data && <UserModal initial={modal.item} roles={roleOpts.data} onClose={() => setModal(null)} onSaved={users.reload} />}
      {modal?.type === 'role' && roles.data && <RoleModal initial={modal.item} catalog={roles.data.catalog} onClose={() => setModal(null)} onSaved={() => { roles.reload(); roleOpts.reload(); }} />}
      {resetLink && <Modal title="Enlace de restablecimiento" onClose={() => setResetLink(null)} footer={<button className="btn primary" onClick={() => setResetLink(null)}>Listo</button>}>
        <div className="stack">
          <p>Entregue este enlace a <b>@{resetLink.username}</b> por un canal seguro. Es de un solo uso y vence el {fmtDateTime(resetLink.expiresAt)}.</p>
          <div className="hash">{window.location.origin}{resetLink.path}</div>
          <CopyButton text={`${window.location.origin}${resetLink.path}`} label="Copiar enlace" />
        </div>
      </Modal>}
    </>
  );
}

// ======================= AUDITORÍA =======================
export function Audit() {
  const { user } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', severity: '', from: '', to: '', page: 1 });
  const list = useFetch('/audit' + qs({ ...filters, pageSize: user.preferences?.pageSize || 50 }));
  const [detail, setDetail] = useState(null);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  return (
    <>
      <PageHead eyebrow="Módulo I · J" icon={ScrollText} title="Auditoría y registro de eventos" sub="Registro inalterable de operaciones: quién, qué, cuándo y desde dónde.">
        <button className="btn" onClick={() => download('/audit' + qs({ ...filters, format: 'csv' })).catch(toast.error)}><Download size={15} /> Exportar CSV</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Acción, usuario, IP o detalle…" />
          <select className="select" value={filters.severity} onChange={set('severity')}><option value="">Toda severidad</option><option value="info">Información</option><option value="warning">Advertencia</option><option value="critical">Crítica</option></select>
          <input className="input" type="date" value={filters.from} onChange={set('from')} style={{ width: 'auto' }} aria-label="Desde" />
          <input className="input" type="date" value={filters.to} onChange={set('to')} style={{ width: 'auto' }} aria-label="Hasta" />
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? <Empty icon={ScrollText} title="Sin eventos" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th className="hide-sm">Entidad</th><th className="hide-sm">IP</th><th>Severidad</th></tr></thead>
            <tbody>{list.data?.items.map((a) => <tr key={a.id} className="clickable" onClick={() => setDetail(a)}>
              <td className="small nowrap">{fmtDateTime(a.created_at)}</td><td className="small">{a.username || <span className="muted">sistema/anónimo</span>}</td><td className="mono small">{a.action}</td>
              <td className="hide-sm small muted">{a.entity ? `${a.entity} #${a.entity_id}` : '—'}</td><td className="hide-sm mono small muted">{a.ip || '—'}</td>
              <td><Badge cls={a.severity === 'critical' ? 'b-red' : a.severity === 'warning' ? 'b-amber' : 'b-gray'}>{a.severity}</Badge></td></tr>)}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {detail && <Modal title={`Evento #${detail.id}`} onClose={() => setDetail(null)} footer={<button className="btn" onClick={() => setDetail(null)}>Cerrar</button>}>
        <dl className="dl"><dt>Fecha</dt><dd>{fmtDateTime(detail.created_at)}</dd><dt>Usuario</dt><dd>{detail.username || '—'}</dd><dt>Acción</dt><dd className="mono">{detail.action}</dd><dt>Entidad</dt><dd>{detail.entity ? `${detail.entity} #${detail.entity_id}` : '—'}</dd><dt>IP</dt><dd className="mono">{detail.ip || '—'}</dd><dt>Severidad</dt><dd>{detail.severity}</dd></dl>
        {detail.detail && <pre className="code-block mt">{(() => { try { return JSON.stringify(JSON.parse(detail.detail), null, 2); } catch { return detail.detail; } })()}</pre>}
      </Modal>}
    </>
  );
}
