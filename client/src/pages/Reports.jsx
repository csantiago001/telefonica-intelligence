import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Download, Eye, Trash2, FileCheck2, Wand2 } from 'lucide-react';
import { api, qs, download, openBlob } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, Pagination, Empty, Loading, SearchInput, CaseSelect, Modal, DemoBadge, CopyButton } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

function ReportWizard({ initialCase, onClose, onSaved }) {
  const toast = useToast();
  const { setCredits, user } = useAuth();
  const [caseId, setCaseId] = useState(initialCase);
  const [f, setF] = useState(null);
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!caseId) { setF(null); return; }
    api.get(`/reports/defaults/${caseId}`).then((d) => {
      setCounts(d.counts);
      setF({ title: d.title, summary: d.summary, objective: d.objective, observations: '', limitations: d.limitations, conclusions: '' });
    }).catch(toast.error);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/reports', { caseId, ...f });
      toast.success(`Informe ${r.code} generado.`);
      const me = await api.get('/auth/me');
      setCredits(me.credits);
      onSaved?.(r);
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal size="lg" title="Generar informe PDF" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f} onClick={generate}>{busy ? <Spinner /> : <FileCheck2 size={15} />} Generar PDF</button></>}>
      <div className="stack">
        <CaseSelect value={caseId} onChange={setCaseId} includeEmpty label="Expediente" onlyWritable={false} />
        {!caseId && <div className="alert info">Seleccione un expediente. El informe incluirá automáticamente consultas, hallazgos, fuentes, evidencias y el registro de integridad.</div>}
        {caseId && !f && <Loading />}
        {f && <>
          <div className="alert success"><Wand2 size={16} color="var(--lime)" /><div>Se incluirán: {counts.phoneQueries} análisis telefónicos, {counts.osintQueries} consultas OSINT, {counts.findings} hallazgos, {counts.evidence} evidencias con hash, {counts.entities} entidades y {counts.geo} ubicaciones consentidas.</div></div>
          <div className="form-grid">
            <Field label="Título del informe" className="full"><input className="input" value={f.title} onChange={set('title')} /></Field>
            <Field label="Resumen ejecutivo *" className="full"><textarea className="textarea" value={f.summary} onChange={set('summary')} rows={4} /></Field>
            <Field label="Objetivo de la investigación *" className="full"><textarea className="textarea" value={f.objective} onChange={set('objective')} /></Field>
            <Field label="Observaciones" className="full" help="Además se incluyen las observaciones registradas en el expediente."><textarea className="textarea" value={f.observations} onChange={set('observations')} /></Field>
            <Field label="Limitaciones *" className="full"><textarea className="textarea" value={f.limitations} onChange={set('limitations')} rows={4} /></Field>
            <Field label="Conclusiones *" className="full"><textarea className="textarea" value={f.conclusions} onChange={set('conclusions')} rows={4} placeholder="Conclusiones fundamentadas en los hallazgos confirmados." /></Field>
          </div>
          <p className="small muted">Elaborado por: {user.fullName}. Se calculará el SHA-256 del PDF y quedará registrado.</p>
        </>}
      </div>
    </Modal>
  );
}

export default function Reports() {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', page: 1 });
  const [wizard, setWizard] = useState(sp.get('nuevo') === '1' ? { caseId: sp.get('caseId') ? Number(sp.get('caseId')) : null } : null);
  const list = useFetch('/reports' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  useEffect(() => { if (sp.get('nuevo')) setSp({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const del = async (r) => {
    if (!(await confirm({ title: `Eliminar ${r.code}`, message: 'Se eliminará el informe y su archivo PDF.', danger: true, confirmText: 'Eliminar' }))) return;
    try { await api.del(`/reports/${r.id}`); toast.success('Informe eliminado.'); list.reload(); } catch (e) { toast.error(e); }
  };
  return (
    <>
      <PageHead eyebrow="Módulo G" icon={FileText} title="Informes" sub="Informes profesionales en PDF con fuentes, evidencias y registro de integridad.">
        {can('reports.write') && <button className="btn primary" onClick={() => setWizard({ caseId: null })}><Plus size={15} /> Generar informe</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar"><SearchInput value={filters.q} onChange={(q) => setFilters({ q, page: 1 })} placeholder="Código, título o expediente…" /></div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? <Empty icon={FileText} title="Sin informes" text="Genere un informe desde un expediente." action={can('reports.write') && <button className="btn primary" onClick={() => setWizard({ caseId: null })}><Plus size={15} /> Generar informe</button>} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Código</th><th>Título</th><th className="hide-sm">Expediente</th><th className="hide-sm">Autor</th><th className="hide-sm">SHA-256</th><th className="hide-sm">Fecha</th><th></th></tr></thead>
            <tbody>{list.data?.items.map((r) => (
              <tr key={r.id}>
                <td className="mono lime nowrap">{r.code}</td>
                <td><div className="t-title">{r.title} <DemoBadge show={r.is_demo} /></div></td>
                <td className="hide-sm"><Link to={`/expedientes/${r.case_id}`} className="mono">{r.case_code}</Link></td>
                <td className="hide-sm small">{r.author}</td>
                <td className="hide-sm"><span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><span className="mono small muted">{r.sha256?.slice(0, 12)}…</span><CopyButton text={r.sha256} /></span></td>
                <td className="hide-sm small nowrap">{fmtDateTime(r.created_at)}</td>
                <td className="right nowrap">
                  <button className="btn sm icon ghost" onClick={() => openBlob(`/reports/${r.id}/pdf?inline=1`).catch(toast.error)} aria-label="Ver" title="Ver"><Eye size={14} /></button>
                  <button className="btn sm" onClick={() => download(`/reports/${r.id}/pdf`).catch(toast.error)}><Download size={13} /> PDF</button>
                  {can('cases.delete') && <button className="btn sm icon ghost" onClick={() => del(r)} aria-label="Eliminar"><Trash2 size={14} /></button>}
                </td>
              </tr>))}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {wizard && <ReportWizard initialCase={wizard.caseId} onClose={() => setWizard(null)} onSaved={list.reload} />}
    </>
  );
}
