import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScanSearch, Phone, Globe, MapPin, FolderPlus, CheckCheck, User, Mail, AtSign } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useToast } from '../lib/context.jsx';
import { PageHead, Spinner, CaseSelect, OsintStatusBadge, Empty } from '../components/ui.jsx';
import { PhoneResult } from './PhoneAnalysis.jsx';
import { FindingModal } from './Osint.jsx';
import { fmtDateTime } from '../lib/format.js';
import { WebResults } from '../components/WebResults.jsx';

const TYPES = [
  { key: 'numero', label: 'Número', icon: Phone, placeholder: '+57 300 123 4567', hint: 'Teléfono: analiza el número y busca dónde aparece publicado.' },
  { key: 'nombre', label: 'Nombre', icon: User, placeholder: 'Nombre y apellido', hint: 'Busca a la persona en páginas públicas y redes sociales.' },
  { key: 'correo', label: 'Correo', icon: Mail, placeholder: 'persona@correo.com', hint: 'Busca el correo en la web pública.' },
  { key: 'usuario', label: 'Usuario / alias', icon: AtSign, placeholder: '@usuario', hint: 'Busca el nombre de usuario en redes y sitios públicos.' },
];

export default function Investigate() {
  const { user, can, setCredits } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [type, setType] = useState('numero');
  const [value, setValue] = useState('');
  const [caseId, setCaseId] = useState(null);
  const [createCase, setCreateCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [finding, setFinding] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const current = TYPES.find((t) => t.key === type);

  const run = async (e) => {
    e.preventDefault();
    if (!value.trim()) return toast.warning(`Escriba un ${current.label.toLowerCase()}.`);
    setBusy(true); setRes(null);
    const doCreate = !caseId && createCase && can('cases.write');
    try {
      const r = type === 'numero'
        ? await api.post('/investigate/phone', { number: value, caseId, createCase: doCreate, defaultCountry: user.preferences?.defaultCountry })
        : await api.post('/investigate/subject', { type, value, caseId, createCase: doCreate });
      setRes({ ...r, type });
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
      <PageHead eyebrow="Investigación integral" icon={ScanSearch} title="Investigar" sub="Busca en fuentes públicas por número, nombre, correo o usuario. Los resultados se muestran aquí y se guardan con su fuente y fecha." />
      <form className="card" onSubmit={run}>
        <div className="card-body stack">
          <div className="chip-select">
            {TYPES.map((t) => <button type="button" key={t.key} className={type === t.key ? 'on' : ''} onClick={() => { setType(t.key); setRes(null); }}><t.icon size={14} /> {t.label}</button>)}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <div className="input-icon" style={{ flex: 1 }}><current.icon size={18} />
              <input className={`input ${type === 'numero' ? 'mono' : ''}`} style={{ height: 52, fontSize: 18 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder={current.placeholder} autoFocus maxLength={160} aria-label={current.label} />
            </div>
            <button className="btn primary" style={{ height: 52, padding: '0 22px', fontSize: 15 }} disabled={busy}>{busy ? <Spinner /> : <ScanSearch size={18} />} Investigar</button>
          </div>
          <div className="small muted">{current.hint}</div>
          <div className="form-grid">
            <CaseSelect value={caseId} onChange={setCaseId} label="Guardar en expediente existente (opcional)" />
            {!caseId && can('cases.write') && <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={createCase} onChange={(e) => setCreateCase(e.target.checked)} /> Crear automáticamente un expediente</label>}
          </div>
        </div>
      </form>
      {busy && <div className="card mt card-body row"><Spinner /> Buscando en fuentes públicas… (5–15 s)</div>}

      {res && (
        <>
          <div className="row mt" style={{ gap: 8 }}>
            {res.caseId && <Link className="btn" to={`/expedientes/${res.caseId}`}><FolderPlus size={15} /> Abrir expediente {res.caseCode}</Link>}
            {can('geo.write') && <button className="btn" onClick={() => nav(`/geolocalizacion?nuevo=1${res.caseId ? `&caseId=${res.caseId}` : ''}`)}><MapPin size={15} /> Solicitar ubicación con consentimiento</button>}
          </div>
          <div className={`grid ${res.type === 'numero' ? 'g2' : ''} mt`} style={{ alignItems: 'start' }}>
            {res.type === 'numero' && res.analysis && (
              <div className="card"><div className="card-head"><h3><Phone size={16} color="var(--lime)" /> Datos del número</h3></div>
                <div className="card-body"><PhoneResult r={res.analysis} compact /></div></div>
            )}
            <div className="card">
              <div className="card-head"><h3><Globe size={16} color="var(--lime)" /> Información pública encontrada</h3>
                <div className="row" style={{ gap: 6 }}>{res.search && <OsintStatusBadge value={res.search.status} />}
                  {res.caseId && res.search?.data?.web?.results?.length > 0 && can('findings.write') && <button className="btn sm" onClick={saveAll} disabled={savingAll}>{savingAll ? <Spinner /> : <CheckCheck size={13} />} Guardar todos</button>}</div>
              </div>
              <div className="card-body">
                {!res.search ? <Empty icon={Globe} title="Búsqueda no realizada" text="El objetivo no pudo procesarse; corrija el formato." /> : <>
                  <div className="small muted mb">Fuente: {res.search.source} · {fmtDateTime(res.search.consultedAt)} · {res.search.durationMs} ms</div>
                  <WebResults data={res.search.data} caseId={res.caseId} onSave={can('findings.write') ? (f) => setFinding({ ...f, osintQueryId: res.search.id }) : null} />
                </>}
              </div>
            </div>
          </div>
          <div className="alert info mt"><MapPin size={16} color="var(--blue)" /><div>La búsqueda solo muestra lo que está <b>publicado en Internet</b>. La ubicación física de una persona solo se obtiene si ella la comparte con el enlace de consentimiento.</div></div>
        </>
      )}
      {finding && <FindingModal initial={finding} onClose={() => setFinding(null)} />}
    </>
  );
}
