import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileArchive, Upload, Download, ShieldCheck, ShieldAlert, Trash2, ArrowLeft, Pencil, Save, Fingerprint, UploadCloud, File as FileIcon, CheckCircle2 } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, Badge, Pagination, Empty, Loading, ErrorBox, SearchInput, CaseSelect, Modal, CopyButton, DemoBadge } from '../components/ui.jsx';
import { fmtDateTime, fmtBytes, EVIDENCE_ORIGIN } from '../lib/format.js';

async function sha256Browser(file) {
  if (!window.crypto?.subtle) return null;
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function EvidenceUploadModal({ caseId: initialCase, onClose, onSaved }) {
  const toast = useToast();
  const meta = useFetch('/evidence/meta');
  const [file, setFile] = useState(null);
  const [hash, setHash] = useState(null);
  const [over, setOver] = useState(false);
  const [f, setF] = useState({ title: '', description: '', origin: 'documento', acquiredAt: '', sourceDetail: '', caseId: initialCase ?? null });
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const pick = async (fl) => {
    if (!fl) return;
    const max = (meta.data?.maxUploadMb || 50) * 1024 * 1024;
    if (fl.size > max) return toast.error(`El archivo supera el máximo de ${meta.data?.maxUploadMb} MB.`);
    setFile(fl);
    setHash('calculando');
    if (!f.title) setF((x) => ({ ...x, title: fl.name.replace(/\.[^.]+$/, '').slice(0, 200) }));
    const guess = fl.type.startsWith('image/') ? 'captura_pantalla' : fl.type.startsWith('audio/') ? 'audio' : fl.type.startsWith('video/') ? 'video' : 'documento';
    setF((x) => ({ ...x, origin: x.origin === 'documento' ? guess : x.origin }));
    setHash(await sha256Browser(fl));
  };
  const submit = async () => {
    if (!file) return toast.warning('Seleccione un archivo.');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
      fd.append('file', file);
      const r = await api.upload('/evidence', fd);
      if (hash && hash !== 'calculando' && hash !== r.sha256) toast.error('¡Atención! El hash calculado por el servidor no coincide con el del navegador.');
      else toast.success(`Evidencia ${r.code} incorporada. SHA-256 verificado${hash ? ' en navegador y servidor' : ''}.`);
      onSaved?.(r);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal size="lg" title="Cargar evidencia" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !file} onClick={submit}>{busy ? <Spinner /> : <Upload size={15} />} Incorporar evidencia</button></>}>
      <div className="stack">
        <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}>
          <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files[0])} />
          {file ? (
            <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
              <FileIcon size={28} color="var(--lime)" /><b>{file.name}</b><span className="small">{fmtBytes(file.size)} · {file.type || 'tipo desconocido'}</span>
              <span className="small mono break">{hash === 'calculando' ? 'Calculando SHA-256…' : hash ? `SHA-256 (navegador): ${hash}` : 'SHA-256 se calculará en el servidor'}</span>
            </div>
          ) : (<><UploadCloud size={30} color="var(--lime)" /><div className="mt"><b>Arrastre un archivo</b> o haga clic para seleccionarlo</div><div className="small">Máximo {meta.data?.maxUploadMb || '—'} MB. Se cifra en reposo (AES-256-GCM).</div></>)}
        </div>
        <div className="form-grid">
          <Field label="Título" className="full"><input className="input" value={f.title} onChange={set('title')} maxLength={200} /></Field>
          <Field label="Origen"><select className="select" value={f.origin} onChange={set('origin')}>{Object.entries(EVIDENCE_ORIGIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Fecha de obtención" help="Cuándo se obtuvo el material (si se conoce)."><input className="input" type="datetime-local" value={f.acquiredAt} onChange={set('acquiredAt')} /></Field>
          <Field label="Detalle del origen" className="full" help="Quién la aportó, de dónde se extrajo, dispositivo, etc."><input className="input" value={f.sourceDetail} onChange={set('sourceDetail')} maxLength={500} /></Field>
          <Field label="Descripción" className="full"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
          {initialCase == null && <div className="full"><CaseSelect value={f.caseId} onChange={(caseId) => setF({ ...f, caseId })} /></div>}
        </div>
      </div>
    </Modal>
  );
}

export default function Evidence() {
  const { user, can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', origin: '', includeDeleted: '0', page: 1 });
  const [uploading, setUploading] = useState(sp.get('nuevo') === '1');
  const list = useFetch('/evidence' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  useEffect(() => { if (sp.get('nuevo')) { sp.delete('nuevo'); setSp(sp, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead eyebrow="Módulo F" icon={FileArchive} title="Evidencias" sub="Archivos cifrados en reposo, con hash SHA-256 y cadena de custodia completa.">
        <button className="btn" onClick={() => download('/evidence' + qs({ ...filters, format: 'csv' })).catch(toast.error)}><Download size={15} /> Inventario CSV</button>
        {can('evidence.write') && <button className="btn primary" onClick={() => setUploading(true)}><Upload size={15} /> Cargar evidencia</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Código, título, archivo o hash…" />
          <select className="select" value={filters.origin} onChange={(e) => setFilters({ ...filters, origin: e.target.value, page: 1 })}><option value="">Todo origen</option>{Object.entries(EVIDENCE_ORIGIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="select" value={filters.includeDeleted} onChange={(e) => setFilters({ ...filters, includeDeleted: e.target.value, page: 1 })}><option value="0">Vigentes</option><option value="1">Incluir eliminadas</option></select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? <Empty icon={FileArchive} title="Sin evidencias" text="Cargue archivos para custodiarlos con integridad verificable." action={can('evidence.write') && <button className="btn primary" onClick={() => setUploading(true)}><Upload size={15} /> Cargar evidencia</button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Código</th><th>Título</th><th className="hide-sm">Expediente</th><th className="hide-sm">Origen</th><th className="hide-sm">Tamaño</th><th className="hide-sm">SHA-256</th><th>Estado</th><th className="hide-sm">Incorporada</th></tr></thead>
            <tbody>{list.data?.items.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => nav(`/evidencias/${e.id}`)} style={e.deleted_at ? { opacity: 0.55 } : undefined}>
                <td className="mono lime nowrap">{e.code}</td>
                <td><div className="t-title">{e.title} <DemoBadge show={e.is_demo} /></div><div className="t-sub">{e.original_name}</div></td>
                <td className="hide-sm">{e.case_code ? <span className="mono">{e.case_code}</span> : '—'}</td>
                <td className="hide-sm">{EVIDENCE_ORIGIN[e.origin]}</td>
                <td className="hide-sm nowrap">{fmtBytes(e.size_bytes)}</td>
                <td className="hide-sm mono small muted">{e.sha256.slice(0, 12)}…</td>
                <td>{e.deleted_at ? <Badge cls="b-gray">Eliminada</Badge> : e.last_verified_ok === 0 ? <Badge cls="b-red">Alterada</Badge> : <Badge cls="b-lime" dot>Íntegra</Badge>}</td>
                <td className="hide-sm small nowrap">{fmtDateTime(e.created_at)}</td>
              </tr>))}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {uploading && <EvidenceUploadModal onClose={() => setUploading(false)} onSaved={(r) => nav(`/evidencias/${r.id}`)} />}
    </>
  );
}

export function EvidenceDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: e, loading, error, reload } = useFetch(`/evidence/${id}`);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  if (loading && !e) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const run = async () => {
    setVerifying(true);
    try { const r = await api.post(`/evidence/${e.id}/verify`); setVerify(r); r.ok ? toast.success('Integridad verificada: el hash coincide.') : toast.error('¡Integridad comprometida!'); reload(); } catch (err) { toast.error(err); } finally { setVerifying(false); }
  };
  const dl = async () => {
    try { const r = await download(`/evidence/${e.id}/download`, e.original_name); toast.success(`Descargado. SHA-256: ${r.sha256?.slice(0, 16)}…`); reload(); } catch (err) { toast.error(err); }
  };
  const del = async () => {
    const reason = await confirm({ title: `Eliminar ${e.code}`, danger: true, warning: 'El archivo se borrará de forma segura (sobrescritura). Se conservará el registro, el hash y la cadena de custodia para trazabilidad.', message: '', reason: true, reasonLabel: 'Motivo de la eliminación', confirmText: 'Eliminar archivo' });
    if (!reason) return;
    try { await api.del(`/evidence/${e.id}`, { reason }); toast.success('Evidencia eliminada.'); reload(); } catch (err) { toast.error(err); }
  };
  const save = async () => {
    try { await api.put(`/evidence/${e.id}`, form); toast.success('Datos actualizados.'); setEditing(false); reload(); } catch (err) { toast.error(err); }
  };
  const m = e.metadata || {};
  return (
    <>
      <Link to="/evidencias" className="small row" style={{ gap: 4, marginBottom: 10, display: 'inline-flex' }}><ArrowLeft size={14} /> Evidencias</Link>
      <PageHead eyebrow={e.code} icon={FileArchive} title={<>{e.title} <DemoBadge show={e.is_demo} /></>} sub={e.original_name}>
        {!e.deleted_at && <button className="btn" onClick={run} disabled={verifying}>{verifying ? <Spinner /> : <Fingerprint size={15} />} Verificar integridad</button>}
        {!e.deleted_at && can('evidence.download') && <button className="btn primary" onClick={dl}><Download size={15} /> Descargar</button>}
        {!e.deleted_at && can('evidence.write') && <button className="btn icon" onClick={() => { setForm({ title: e.title, description: e.description || '', caseId: e.case_id }); setEditing(true); }} aria-label="Editar"><Pencil size={15} /></button>}
        {!e.deleted_at && can('evidence.delete') && <button className="btn danger icon" onClick={del} aria-label="Eliminar"><Trash2 size={15} /></button>}
      </PageHead>
      {e.deleted_at && <div className="alert warning mb">Evidencia eliminada el {fmtDateTime(e.deleted_at)}. El archivo fue borrado; se conserva el registro para trazabilidad.</div>}
      {verify && <div className={`alert ${verify.ok ? 'success' : 'error'} mb`}>{verify.ok ? <CheckCircle2 size={18} color="var(--lime)" /> : <ShieldAlert size={18} color="var(--red)" />}<div>{verify.ok ? 'El SHA-256 recalculado coincide con el registrado.' : `Falla de integridad: ${verify.error || 'hash distinto'}`}<div className="small mono break">Esperado: {verify.expected}<br />Actual: {verify.current || '—'}</div></div></div>}
      <div className="grid g-main">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3><ShieldCheck size={16} color="var(--lime)" /> Integridad</h3>{e.last_verified_ok === 0 ? <Badge cls="b-red">Alterada</Badge> : <Badge cls="b-lime" dot>Íntegra</Badge>}</div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <div className="row between"><span className="small muted">SHA-256 registrado en la incorporación</span><CopyButton text={e.sha256} label="Copiar" /></div>
              <div className="hash">{e.sha256}</div>
              <div className="small muted">Última verificación: {fmtDateTime(e.last_verified_at)}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Cadena de custodia</h3><span className="hint">{e.custody.length} registro(s)</span></div>
            <div className="card-body"><div className="timeline">
              {e.custody.map((c) => <div className="tl-item" key={c.id}><div className="tl-head">{fmtDateTime(c.created_at)} · <b>{c.action.replace(/_/g, ' ')}</b> · {c.user_name || 'Sistema'} · IP {c.ip || '—'}</div><div className="tl-body small">{c.detail}</div></div>)}
            </div></div>
          </div>
        </div>
        <div className="stack">
          <div className="card"><div className="card-head"><h3>Datos de la evidencia</h3></div>
            <div className="card-body"><dl className="dl" style={{ gridTemplateColumns: '130px 1fr' }}>
              <dt>Expediente</dt><dd>{e.case ? <Link to={`/expedientes/${e.case.id}`} className="mono">{e.case.code}</Link> : '—'}</dd>
              <dt>Origen</dt><dd>{EVIDENCE_ORIGIN[e.origin]}</dd>
              {m.sourceDetail && <><dt>Detalle</dt><dd>{m.sourceDetail}</dd></>}
              <dt>Obtenida</dt><dd>{fmtDateTime(e.acquired_at)}</dd>
              <dt>Incorporada</dt><dd>{fmtDateTime(e.created_at)}</dd>
              <dt>Por</dt><dd>{e.uploadedBy}</dd>
              <dt>Tamaño</dt><dd>{fmtBytes(e.size_bytes)}</dd>
              <dt>Tipo MIME</dt><dd className="mono small">{e.mime_type || '—'}</dd>
              <dt>Firma</dt><dd>{m.signature || '—'}</dd>
              <dt>Descripción</dt><dd>{e.description || '—'}</dd>
            </dl></div></div>
          <div className="card"><div className="card-head"><h3>Metadatos extraídos</h3></div>
            <div className="card-body">
              {m.containsGps && <div className="alert warning mb">El archivo contiene coordenadas GPS en sus metadatos EXIF. Trátelas como dato personal.</div>}
              {m.exif || m.pdf ? <div className="code-block">{Object.entries({ ...(m.exif || {}), ...(m.pdf || {}) }).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join('\n')}</div> : <span className="muted small">No se encontraron metadatos EXIF/PDF {m.metadataError && `(${m.metadataError})`}.</span>}
            </div></div>
        </div>
      </div>
      {editing && <Modal title={`Editar ${e.code}`} onClose={() => setEditing(false)} footer={<><button className="btn" onClick={() => setEditing(false)}>Cancelar</button><button className="btn primary" onClick={save}><Save size={15} /> Guardar</button></>}>
        <div className="stack">
          <Field label="Título"><input className="input" value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} /></Field>
          <Field label="Descripción"><textarea className="textarea" value={form.description} onChange={(ev) => setForm({ ...form, description: ev.target.value })} /></Field>
          <CaseSelect value={form.caseId} onChange={(caseId) => setForm({ ...form, caseId })} />
          <p className="small muted">El archivo y su hash no pueden modificarse. Los cambios quedan en la cadena de custodia.</p>
        </div>
      </Modal>}
    </>
  );
}
