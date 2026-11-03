import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScanSearch, Phone, Globe, MapPin, FolderPlus, CheckCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../lib/context.jsx';
import { PageHead, Spinner, CaseSelect, OsintStatusBadge, Empty } from '../components/ui.jsx';
import { PhoneResult } from './PhoneAnalysis.jsx';
import { FindingModal } from './Osint.jsx';
import { fmtDateTime } from '../lib/format.js';
import { WebResults } from '../components/WebResults.jsx';

export default function Investigate() {
  const { user, can, setCredits } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [number, setNumber] = useState('');
  const [caseId, setCaseId] = useState(null);
  const [createCase, setCreateCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [finding, setFinding] = useState(null);
  const [savingAll, setSavingAll] = useState(false);

  const run = async (e) => {
    e.preventDefault();
    if (!number.trim()) return toast.warning('Escriba un número telefónico.');
    setBusy(true); setRes(null);
    try {
      const r = await api.post('/investigate/phone', { number, caseId, createCase: !caseId && createCase && can('cases.write'), defaultCountry: user.preferences?.defaultCountry });
      setRes(r);
      setCredits(r.balance);
      if (r.caseCode && !caseId) toast.success(`Expediente ${r.caseCode} creado con los resultados.`);
      else toast.success('Investigación completada.');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const saveAll = async () => {
    const items = res.search?.data?.web?.results || [];
    if (!items.length) return;
    setSavingAll(true);
    try {
      for (const r of items) await api.post('/findings', { caseId: res.caseId, osintQueryId: res.search.id, title: `${r.site}: ${r.title}`.slice(0, 300), detail: r.snippet || '', sourceName: r.site, sourceUrl: r.url, reliability: 'no_verificado' });
      toast.success(`${items.length} hallazgo(s) guardados en ${res.caseCode}.`);
    } catch (e) { toast.error(e); } finally { setSavingAll(false); }
  };

  return (
    <>
      <PageHead eyebrow="Investigación integral" icon={ScanSearch} title="Investigar número" sub="Analiza el número y busca automáticamente en Internet dónde aparece publicado. Todo queda registrado con fuente y fecha." />
      <form className="card" onSubmit={run}>
        <div className="card-body stack">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <div className="input-icon" style={{ flex: 1 }}><Phone size={18} />
              <input className="input mono" style={{ height: 52, fontSize: 19 }} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+57 300 123 4567" autoFocus maxLength={40} aria-label="Número telefónico" />
            </div>
            <button className="btn primary" style={{ height: 52, padding: '0 22px', fontSize: 15 }} disabled={busy}>{busy ? <Spinner /> : <ScanSearch size={18} />} Investigar</button>
          </div>
          <div className="form-grid">
            <CaseSelect value={caseId} onChange={setCaseId} label="Guardar en expediente existente (opcional)" />
            {!caseId && can('cases.write') && <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={createCase} onChange={(e) => setCreateCase(e.target.checked)} /> Crear automáticamente un expediente para este número</label>}
          </div>
        </div>
      </form>
      {busy && <div className="card mt card-body row"><Spinner /> Analizando el número y buscando en Internet en sus distintos formatos… (5–15 s)</div>}

      {res && (
        <>
          <div className="row mt" style={{ gap: 8 }}>
            {res.caseId && <Link className="btn" to={`/expedientes/${res.caseId}`}><FolderPlus size={15} /> Abrir expediente {res.caseCode}</Link>}
            {can('geo.write') && res.analysis.e164 && <button className="btn" onClick={() => nav(`/geolocalizacion?nuevo=1${res.caseId ? `&caseId=${res.caseId}` : ''}`)}><MapPin size={15} /> Solicitar ubicación con consentimiento</button>}
          </div>
          <div className="grid g2 mt" style={{ alignItems: 'start' }}>
            <div className="card"><div className="card-head"><h3><Phone size={16} color="var(--lime)" /> Datos del número</h3></div>
              <div className="card-body"><PhoneResult r={res.analysis} compact /></div></div>
            <div className="card">
              <div className="card-head"><h3><Globe size={16} color="var(--lime)" /> Información pública</h3>
                <div className="row" style={{ gap: 6 }}>{res.search && <OsintStatusBadge value={res.search.status} />}
                  {res.caseId && res.search?.data?.web?.results?.length > 0 && can('findings.write') && <button className="btn sm" onClick={saveAll} disabled={savingAll}>{savingAll ? <Spinner /> : <CheckCheck size={13} />} Guardar todos</button>}</div>
              </div>
              <div className="card-body">
                {!res.search ? <Empty icon={Globe} title="Búsqueda no realizada" text={res.analysis.e164 ? 'La fuente de búsqueda está desactivada.' : 'El número no pudo normalizarse; corrija el formato e incluya el prefijo de país.'} /> : <>
                  <div className="small muted mb">Fuente: {res.search.source} · {fmtDateTime(res.search.consultedAt)} · {res.search.durationMs} ms</div>
                  <WebResults data={res.search.data} caseId={res.caseId} onSave={can('findings.write') ? (f) => setFinding({ ...f, osintQueryId: res.search.id }) : null} />
                </>}
              </div>
            </div>
          </div>
          <div className="alert info mt"><MapPin size={16} color="var(--blue)" /><div>La ubicación física de un teléfono solo la tiene el operador y solo se entrega a autoridades con orden judicial. Para conocer la ubicación de una persona, use <b>Solicitar ubicación con consentimiento</b>: ella decide si la comparte.</div></div>
        </>
      )}
      {finding && <FindingModal initial={finding} onClose={() => setFinding(null)} />}
    </>
  );
}
