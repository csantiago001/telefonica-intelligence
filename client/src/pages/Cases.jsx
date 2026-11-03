import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FolderKanban, Plus, Download, Pencil, Users, Phone, StickyNote, FileArchive, Lightbulb, Radar, MapPin, FileText, History, Trash2, RefreshCw, ArrowLeft, Save, LayoutGrid, ShieldCheck, ExternalLink,
} from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import {
  useFetch, PageHead, Field, Spinner, StatusBadge, PriorityBadge, ReliabilityBadge, OsintStatusBadge, GeoStatusBadge, Badge, Pagination, Empty, Loading, ErrorBox, SearchInput, Modal, Tabs, DemoBadge,
} from '../components/ui.jsx';
import { fmtDateTime, fmtDate, fmtBytes, CASE_STATUS, CASE_PRIORITY, CASE_CLASS, ENTITY_KIND, EVENT_LABEL, EVIDENCE_ORIGIN } from '../lib/format.js';
import { FindingModal } from './Osint.jsx';
import { EvidenceUploadModal } from './Evidence.jsx';

export function CaseFormModal({ initial, onClose, onSaved }) {
  const toast = useToast();
  const users = useFetch('/admin/users/options');
  const [f, setF] = useState({
    title: initial?.title || '', description: initial?.description || '', objective: initial?.objective || '',
    classification: initial?.classification || 'general', priority: initial?.priority || 'media', tags: (initial?.tags || []).join(', '),
    ownerId: initial?.owner_id || initial?.owner?.id || null, openedAt: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), ownerId: f.ownerId ? Number(f.ownerId) : null, openedAt: f.openedAt || undefined };
      const r = initial?.id ? await api.put(`/cases/${initial.id}`, body) : await api.post('/cases', body);
      toast.success(initial?.id ? 'Expediente actualizado.' : `Expediente ${r.code} creado.`);
      onSaved?.(r);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal size="lg" title={initial?.id ? `Editar ${initial.code}` : 'Nuevo expediente'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={15} />} Guardar</button></>}>
      <div className="form-grid">
        <Field label="Título" className="full"><input className="input" value={f.title} onChange={set('title')} maxLength={200} placeholder="Ej.: Suplantación de entidad por SMS" /></Field>
        <Field label="Clasificación"><select className="select" value={f.classification} onChange={set('classification')}>{Object.entries(CASE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Prioridad"><select className="select" value={f.priority} onChange={set('priority')}>{Object.entries(CASE_PRIORITY).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Responsable"><select className="select" value={f.ownerId || ''} onChange={set('ownerId')}><option value="">— Yo —</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        {!initial?.id ? <Field label="Fecha de apertura" help="Opcional; por defecto hoy."><input className="input" type="date" value={f.openedAt} onChange={set('openedAt')} max={new Date().toISOString().slice(0, 10)} /></Field>
          : <Field label="Etiquetas" help="Separadas por comas"><input className="input" value={f.tags} onChange={set('tags')} /></Field>}
        {!initial?.id && <Field label="Etiquetas" help="Separadas por comas" className="full"><input className="input" value={f.tags} onChange={set('tags')} placeholder="sms, dominios" /></Field>}
        <Field label="Objetivo de la investigación" className="full"><textarea className="textarea" value={f.objective} onChange={set('objective')} placeholder="Qué se busca establecer y con qué alcance." /></Field>
        <Field label="Descripción / antecedentes" className="full"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}

export default function Cases() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', status: sp.get('status') || '', classification: '', priority: '', sort: 'updated', page: 1 });
  const [creating, setCreating] = useState(sp.get('nuevo') === '1');
  const list = useFetch('/cases' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  useEffect(() => { if (sp.get('nuevo')) { sp.delete('nuevo'); setSp(sp, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  return (
    <>
      <PageHead eyebrow="Módulo E" icon={FolderKanban} title="Expedientes" sub="Gestión de investigaciones, entidades, números, observaciones e historial.">
        <button className="btn" onClick={() => download('/cases' + qs({ ...filters, format: 'csv' })).catch(toast.error)}><Download size={15} /> CSV</button>
        {can('cases.write') && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo expediente</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Código, título, número, persona o etiqueta…" />
          <select className="select" value={filters.status} onChange={setF('status')} aria-label="Estado">
            <option value="">Todos los estados</option><option value="activos">Activos</option>{Object.entries(CASE_STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" value={filters.classification} onChange={setF('classification')} aria-label="Clasificación">
            <option value="">Toda clasificación</option>{Object.entries(CASE_CLASS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" value={filters.priority} onChange={setF('priority')} aria-label="Prioridad">
            <option value="">Toda prioridad</option>{Object.entries(CASE_PRIORITY).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" value={filters.sort} onChange={setF('sort')} aria-label="Orden">
            <option value="updated">Última actividad</option><option value="opened">Fecha de apertura</option><option value="priority">Prioridad</option><option value="code">Código</option>
          </select>
        </div>
        {list.error && <div className="card-body"><ErrorBox error={list.error} onRetry={list.reload} /></div>}
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? (
          <Empty icon={FolderKanban} title="No hay expedientes" text={filters.q || filters.status ? 'Ningún expediente coincide con los filtros.' : 'Cree el primer expediente para comenzar a investigar.'}
            action={can('cases.write') && !filters.q && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Crear expediente</button>} />
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Código</th><th>Título</th><th className="hide-sm">Clasificación</th><th>Prioridad</th><th>Estado</th><th className="hide-sm">Elementos</th><th className="hide-sm">Responsable</th><th className="hide-sm">Actividad</th></tr></thead>
            <tbody>{list.data?.items.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => nav(`/expedientes/${c.id}`)}>
                <td className="mono lime nowrap">{c.code}</td>
                <td><div className="t-title">{c.title} <DemoBadge show={c.is_demo} /></div><div>{c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div></td>
                <td className="hide-sm">{CASE_CLASS[c.classification]}</td>
                <td><PriorityBadge priority={c.priority} /></td>
                <td><StatusBadge status={c.status} /></td>
                <td className="hide-sm small muted nowrap"><Phone size={12} /> {c.phone_count} · <FileArchive size={12} /> {c.evidence_count} · <Lightbulb size={12} /> {c.finding_count}</td>
                <td className="hide-sm small">{c.owner_name || '—'}</td>
                <td className="hide-sm small muted nowrap">{fmtDate(c.updated_at)}</td>
              </tr>))}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {creating && <CaseFormModal onClose={() => setCreating(false)} onSaved={(r) => nav(`/expedientes/${r.id}`)} />}
    </>
  );
}

function EntityModal({ caseId, initial, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: initial?.kind || 'persona', name: initial?.name || '', role: initial?.role || '', identifier: initial?.identifier || '', notes: initial?.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      if (initial?.id) await api.put(`/cases/${caseId}/entities/${initial.id}`, f); else await api.post(`/cases/${caseId}/entities`, f);
      toast.success('Entidad guardada.'); onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial?.id ? 'Editar entidad' : 'Registrar persona o entidad'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{busy && <Spinner />} Guardar</button></>}>
      <div className="form-grid">
        <Field label="Tipo"><select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(ENTITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Rol en la investigación"><input className="input" value={f.role} onChange={set('role')} placeholder="Víctima, testigo, entidad suplantada…" /></Field>
        <Field label="Nombre" className="full"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Identificador" className="full" help="Documento, NIT, usuario, dominio… solo si es legítimo registrarlo."><input className="input" value={f.identifier} onChange={set('identifier')} /></Field>
        <Field label="Notas" className="full"><textarea className="textarea" value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function CaseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'resumen';
  const setTab = (t) => setSp({ tab: t }, { replace: true });
  const { data: c, loading, error, reload } = useFetch(`/cases/${id}`);
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState({ number: '', label: '', entityId: '' });
  const [busy, setBusy] = useState(false);

  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const writable = can('cases.write') && c.status !== 'archivado';

  const changeStatus = async (status) => {
    const reason = await confirm({ title: `Cambiar estado a "${CASE_STATUS[status][0]}"`, message: 'El cambio quedará en el historial del expediente.', reason: true, reasonLabel: 'Motivo del cambio', minReason: 3, confirmText: 'Cambiar estado' });
    if (!reason) return;
    try { await api.post(`/cases/${c.id}/status`, { status, reason }); toast.success('Estado actualizado.'); reload(); } catch (e) { toast.error(e); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Eliminar expediente', danger: true, warning: 'Se eliminarán el expediente, sus entidades, observaciones, hallazgos e informes, y se borrarán de forma segura los archivos de evidencia.', message: 'Las consultas quedarán en el historial sin vínculo.', requireText: c.code, confirmText: 'Eliminar definitivamente' }))) return;
    try { await api.del(`/cases/${c.id}`, { confirmCode: c.code }); toast.success('Expediente eliminado.'); nav('/expedientes'); } catch (e) { toast.error(e); }
  };
  const addNote = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post(`/cases/${c.id}/notes`, { body: note }); setNote(''); toast.success('Observación registrada.'); reload(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const addPhone = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/cases/${c.id}/phones`, { ...phone, entityId: phone.entityId ? Number(phone.entityId) : null });
      setPhone({ number: '', label: '', entityId: '' });
      toast[r.valid ? 'success' : 'warning'](r.valid ? `Número ${r.e164} asociado.` : `Número ${r.e164} asociado, pero no es válido en el plan de numeración.`);
      reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const remove = async (path, msg) => {
    if (!(await confirm({ title: 'Confirmar eliminación', message: msg, danger: true, confirmText: 'Eliminar' }))) return;
    try { await api.del(path); toast.success('Eliminado.'); reload(); } catch (e) { toast.error(e); }
  };

  const tabs = [
    { key: 'resumen', label: 'Resumen', icon: LayoutGrid },
    { key: 'entidades', label: 'Personas y entidades', icon: Users, count: c.entities.length },
    { key: 'telefonos', label: 'Teléfonos', icon: Phone, count: c.phones.length },
    { key: 'observaciones', label: 'Observaciones', icon: StickyNote, count: c.notes.length },
    { key: 'evidencias', label: 'Evidencias', icon: FileArchive, count: c.evidence.length },
    { key: 'hallazgos', label: 'Hallazgos', icon: Lightbulb, count: c.findings.length },
    { key: 'consultas', label: 'Consultas', icon: Radar, count: c.phoneQueries.length + c.osintQueries.length },
    { key: 'ubicacion', label: 'Ubicación', icon: MapPin, count: c.geoLinks.length },
    { key: 'informes', label: 'Informes', icon: FileText, count: c.reports.length },
    { key: 'historial', label: 'Historial', icon: History, count: c.events.length },
  ];

  return (
    <>
      <Link to="/expedientes" className="small row" style={{ gap: 4, marginBottom: 10, display: 'inline-flex' }}><ArrowLeft size={14} /> Expedientes</Link>
      <PageHead eyebrow={c.code} icon={FolderKanban} title={<>{c.title} <DemoBadge show={c.is_demo} /></>} sub={<span className="row" style={{ gap: 8 }}><StatusBadge status={c.status} /><PriorityBadge priority={c.priority} /><Badge>{CASE_CLASS[c.classification]}</Badge><span>Abierto {fmtDate(c.opened_at)}</span></span>}>
        {can('cases.write') && (
          <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && changeStatus(e.target.value)} aria-label="Cambiar estado">
            <option value="">Cambiar estado…</option>
            {Object.entries(CASE_STATUS).filter(([k]) => k !== c.status).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {writable && <button className="btn" onClick={() => setModal({ type: 'edit' })}><Pencil size={15} /> Editar</button>}
        {can('reports.write') && <button className="btn primary" onClick={() => nav(`/informes?nuevo=1&caseId=${c.id}`)}><FileText size={15} /> Generar informe</button>}
        {can('cases.delete') && <button className="btn danger icon" onClick={del} aria-label="Eliminar expediente" title="Eliminar expediente"><Trash2 size={15} /></button>}
      </PageHead>
      {c.status === 'archivado' && <div className="alert warning mb">Expediente archivado: solo lectura. Cambie su estado para modificarlo.</div>}

      <div className="card">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="card-body">
          {tab === 'resumen' && (
            <div className="grid g2">
              <div className="stack">
                <div><h3 className="mb" style={{ marginBottom: 6 }}>Objetivo</h3><p style={{ whiteSpace: 'pre-wrap' }}>{c.objective || <span className="muted">Sin objetivo definido.</span>}</p></div>
                <div><h3 style={{ marginBottom: 6 }}>Descripción</h3><p style={{ whiteSpace: 'pre-wrap' }}>{c.description || <span className="muted">Sin descripción.</span>}</p></div>
                <div>{c.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
              </div>
              <dl className="dl">
                <dt>Código</dt><dd className="mono lime">{c.code}</dd>
                <dt>Responsable</dt><dd>{c.owner?.full_name || '—'}</dd>
                <dt>Apertura</dt><dd>{fmtDateTime(c.opened_at)}</dd>
                <dt>Cierre</dt><dd>{fmtDateTime(c.closed_at)}</dd>
                <dt>Última actividad</dt><dd>{fmtDateTime(c.updated_at)}</dd>
                <dt>Contenido</dt><dd>{c.entities.length} entidades · {c.phones.length} números · {c.evidence.length} evidencias · {c.findings.length} hallazgos · {c.reports.length} informes</dd>
              </dl>
            </div>
          )}

          {tab === 'entidades' && (
            <div className="stack">
              {writable && <div><button className="btn primary sm" onClick={() => setModal({ type: 'entity' })}><Plus size={14} /> Agregar persona o entidad</button></div>}
              {c.entities.length === 0 ? <Empty icon={Users} title="Sin entidades" text="Registre personas, organizaciones, dominios o cuentas relacionadas." /> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Tipo</th><th>Nombre</th><th>Rol</th><th className="hide-sm">Identificador</th><th className="hide-sm">Notas</th><th></th></tr></thead>
                  <tbody>{c.entities.map((e) => <tr key={e.id}><td><Badge>{ENTITY_KIND[e.kind]}</Badge></td><td className="t-title">{e.name}</td><td>{e.role || '—'}</td><td className="hide-sm mono small">{e.identifier || '—'}</td><td className="hide-sm small muted">{e.notes}</td>
                    <td className="right nowrap">{writable && <><button className="btn sm icon ghost" onClick={() => setModal({ type: 'entity', item: e })} aria-label="Editar"><Pencil size={14} /></button><button className="btn sm icon ghost" onClick={() => remove(`/cases/${c.id}/entities/${e.id}`, `Se eliminará "${e.name}".`)} aria-label="Eliminar"><Trash2 size={14} /></button></>}</td></tr>)}</tbody></table></div>
              )}
            </div>
          )}

          {tab === 'telefonos' && (
            <div className="stack">
              {writable && (
                <form className="row" onSubmit={addPhone} style={{ alignItems: 'flex-end' }}>
                  <Field label="Número" className="" ><input className="input mono" value={phone.number} onChange={(e) => setPhone({ ...phone, number: e.target.value })} placeholder="+57 300 000 0000" required /></Field>
                  <Field label="Descripción"><input className="input" value={phone.label} onChange={(e) => setPhone({ ...phone, label: e.target.value })} placeholder="Número reportado por la víctima" /></Field>
                  <Field label="Entidad"><select className="select" value={phone.entityId} onChange={(e) => setPhone({ ...phone, entityId: e.target.value })}><option value="">—</option>{c.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
                  <button className="btn primary" disabled={busy}><Plus size={15} /> Asociar</button>
                </form>
              )}
              {c.phones.length === 0 ? <Empty icon={Phone} title="Sin números asociados" /> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Número E.164</th><th>Descripción</th><th className="hide-sm">Entidad</th><th className="hide-sm">Fecha</th><th></th></tr></thead>
                  <tbody>{c.phones.map((p) => <tr key={p.id}><td className="mono lime">{p.e164}</td><td>{p.label}</td><td className="hide-sm">{p.entity_name || '—'}</td><td className="hide-sm small muted">{fmtDate(p.created_at)}</td>
                    <td className="right nowrap">{can('phone.analyze') && <Link className="btn sm ghost" to="/analisis">Analizar</Link>}{writable && <button className="btn sm icon ghost" onClick={() => remove(`/cases/${c.id}/phones/${p.id}`, `Se desasociará ${p.e164}.`)} aria-label="Desasociar"><Trash2 size={14} /></button>}</td></tr>)}</tbody></table></div>
              )}
            </div>
          )}

          {tab === 'observaciones' && (
            <div className="stack">
              {writable && <form onSubmit={addNote} className="stack" style={{ gap: 8 }}><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escriba una observación…" /><div><button className="btn primary sm" disabled={busy || note.trim().length < 2}><Plus size={14} /> Agregar observación</button></div></form>}
              {c.notes.length === 0 ? <Empty icon={StickyNote} title="Sin observaciones" /> : c.notes.map((n) => (
                <div key={n.id} className="card card-pad" style={{ background: 'var(--panel-2)' }}>
                  <div className="row between small muted"><span>{n.author} · {fmtDateTime(n.created_at)}</span>{writable && <button className="btn sm icon ghost" onClick={() => remove(`/cases/${c.id}/notes/${n.id}`, 'Se eliminará la observación.')} aria-label="Eliminar"><Trash2 size={13} /></button>}</div>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{n.body}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'evidencias' && (
            <div className="stack">
              <div className="row">
                {writable && can('evidence.write') && <button className="btn primary sm" onClick={() => setModal({ type: 'evidence' })}><Plus size={14} /> Cargar evidencia</button>}
                {c.evidence.length > 0 && <button className="btn sm" onClick={() => download('/evidence' + qs({ caseId: c.id, format: 'csv' })).catch(toast.error)}><Download size={14} /> Inventario CSV</button>}
              </div>
              {c.evidence.length === 0 ? <Empty icon={FileArchive} title="Sin evidencias" /> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Código</th><th>Título</th><th className="hide-sm">Origen</th><th className="hide-sm">Tamaño</th><th className="hide-sm">SHA-256</th><th>Integridad</th></tr></thead>
                  <tbody>{c.evidence.map((e) => <tr key={e.id} className="clickable" onClick={() => nav(`/evidencias/${e.id}`)}><td className="mono lime">{e.code}</td><td><div className="t-title">{e.title}</div><div className="t-sub">{e.original_name}</div></td><td className="hide-sm">{EVIDENCE_ORIGIN[e.origin]}</td><td className="hide-sm">{fmtBytes(e.size_bytes)}</td><td className="hide-sm mono small muted">{e.sha256.slice(0, 16)}…</td>
                    <td>{e.last_verified_ok === 0 ? <Badge cls="b-red">Alterada</Badge> : <Badge cls="b-lime"><ShieldCheck size={11} /> Íntegra</Badge>}</td></tr>)}</tbody></table></div>
              )}
            </div>
          )}

          {tab === 'hallazgos' && (
            <div className="stack">
              {can('findings.write') && writable && <div><button className="btn primary sm" onClick={() => setModal({ type: 'finding' })}><Plus size={14} /> Registrar hallazgo</button></div>}
              {c.findings.length === 0 ? <Empty icon={Lightbulb} title="Sin hallazgos" /> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Hallazgo</th><th>Confiabilidad</th><th className="hide-sm">Fuente</th><th className="hide-sm">Fecha</th><th></th></tr></thead>
                  <tbody>{c.findings.map((f) => <tr key={f.id}><td><div className="t-title">{f.title}</div>{f.detail && <div className="t-sub">{f.detail}</div>}</td><td><ReliabilityBadge value={f.reliability} /></td>
                    <td className="hide-sm small">{f.source_name}{f.source_url && <> <a href={f.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} /></a></>}</td><td className="hide-sm small nowrap">{fmtDateTime(f.observed_at)}</td>
                    <td className="right nowrap">{can('findings.write') && writable && <><button className="btn sm icon ghost" onClick={() => setModal({ type: 'finding', item: f })} aria-label="Editar"><Pencil size={14} /></button><button className="btn sm icon ghost" onClick={() => remove(`/findings/${f.id}`, `Se eliminará "${f.title}".`)} aria-label="Eliminar"><Trash2 size={14} /></button></>}</td></tr>)}</tbody></table></div>
              )}
            </div>
          )}

          {tab === 'consultas' && (
            <div className="grid g2">
              <div><h3 style={{ marginBottom: 8 }}><Phone size={15} color="var(--lime)" style={{ verticalAlign: -2 }} /> Análisis telefónicos</h3>
                {c.phoneQueries.length === 0 ? <Empty title="Sin análisis" text="Seleccione este expediente al analizar un número." action={can('phone.analyze') && <Link className="btn sm" to="/analisis">Ir a análisis</Link>} /> : (
                  <table className="table"><tbody>{c.phoneQueries.map((q) => <tr key={q.id}><td className="mono">{q.input}</td><td className="mono lime">{q.e164 || '—'}</td><td><Badge cls={q.valid ? 'b-lime' : 'b-red'}>{q.valid ? 'Válido' : 'No válido'}</Badge></td><td className="small muted nowrap">{fmtDate(q.created_at)}</td></tr>)}</tbody></table>)}
              </div>
              <div><h3 style={{ marginBottom: 8 }}><Radar size={15} color="var(--lime)" style={{ verticalAlign: -2 }} /> Consultas OSINT</h3>
                {c.osintQueries.length === 0 ? <Empty title="Sin consultas" action={can('osint.query') && <Link className="btn sm" to="/osint">Ir a OSINT</Link>} /> : (
                  <table className="table"><tbody>{c.osintQueries.map((q) => <tr key={q.id}><td className="small">{q.tool.toUpperCase()}</td><td className="mono small break">{q.target}</td><td><OsintStatusBadge value={q.status} /></td><td className="small muted nowrap">{fmtDate(q.created_at)}</td></tr>)}</tbody></table>)}
              </div>
            </div>
          )}

          {tab === 'ubicacion' && (
            <div className="stack">
              {can('geo.write') && <div><Link className="btn primary sm" to={`/geolocalizacion?nuevo=1&caseId=${c.id}`}><Plus size={14} /> Nuevo enlace con consentimiento</Link></div>}
              {c.geoLinks.length === 0 ? <Empty icon={MapPin} title="Sin enlaces de ubicación" /> : (
                <table className="table"><thead><tr><th>Destinatario</th><th>Estado</th><th className="hide-sm">Consentimiento</th><th className="hide-sm">Vence</th></tr></thead>
                  <tbody>{c.geoLinks.map((g) => <tr key={g.id} className="clickable" onClick={() => nav(`/geolocalizacion/${g.id}`)}><td>{g.recipient_label}</td><td><GeoStatusBadge value={g.revoked_at ? 'revocado' : new Date(g.expires_at) < new Date() ? 'expirado' : g.status} /></td><td className="hide-sm small">{fmtDateTime(g.consent_at)}</td><td className="hide-sm small">{fmtDateTime(g.expires_at)}</td></tr>)}</tbody></table>
              )}
            </div>
          )}

          {tab === 'informes' && (
            <div className="stack">
              {can('reports.write') && <div><button className="btn primary sm" onClick={() => nav(`/informes?nuevo=1&caseId=${c.id}`)}><Plus size={14} /> Generar informe</button></div>}
              {c.reports.length === 0 ? <Empty icon={FileText} title="Sin informes" /> : (
                <table className="table"><thead><tr><th>Código</th><th>Título</th><th className="hide-sm">SHA-256</th><th>Fecha</th><th></th></tr></thead>
                  <tbody>{c.reports.map((r) => <tr key={r.id}><td className="mono lime">{r.code}</td><td>{r.title}</td><td className="hide-sm mono small muted">{r.sha256?.slice(0, 16)}…</td><td className="small nowrap">{fmtDate(r.created_at)}</td><td className="right"><button className="btn sm" onClick={() => download(`/reports/${r.id}/pdf`).catch(toast.error)}><Download size={13} /> PDF</button></td></tr>)}</tbody></table>
              )}
            </div>
          )}

          {tab === 'historial' && (
            <div className="stack">
              <div className="row between"><span className="small muted">Registro cronológico e inalterable de las acciones sobre el expediente.</span><button className="btn sm ghost" onClick={reload}><RefreshCw size={13} /> Actualizar</button></div>
              <div className="timeline">{c.events.map((e) => (
                <div className="tl-item" key={e.id}><div className="tl-head">{fmtDateTime(e.created_at)} · <b>{EVENT_LABEL[e.type] || e.type}</b>{e.user_name ? ` · ${e.user_name}` : ''}</div><div className="tl-body">{e.detail}</div></div>
              ))}</div>
            </div>
          )}
        </div>
      </div>

      {modal?.type === 'edit' && <CaseFormModal initial={c} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'entity' && <EntityModal caseId={c.id} initial={modal.item} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'finding' && <FindingModal initial={modal.item || { caseId: c.id }} lockCase onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'evidence' && <EvidenceUploadModal caseId={c.id} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}
