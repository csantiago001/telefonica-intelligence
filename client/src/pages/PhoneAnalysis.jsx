import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, ScanSearch, Download, History, AlertTriangle, ExternalLink, ListPlus, Info, FileJson, CheckCircle2, XCircle, CircleHelp } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useToast } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, ReliabilityBadge, Badge, Pagination, Empty, Loading, SearchInput, CaseSelect, Modal, CopyButton, DemoBadge } from '../components/ui.jsx';
import { fmtDateTime, RELIABILITY } from '../lib/format.js';

function downloadJson(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function PhoneResult({ r, compact }) {
  const cls = r.classification === 'valido' ? '' : r.classification === 'posible' ? 'mid' : 'bad';
  const Icon = r.classification === 'valido' ? CheckCircle2 : r.classification === 'posible' ? CircleHelp : XCircle;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className={`result-hero ${cls}`}>
        <Icon size={38} color={cls === '' ? 'var(--lime)' : cls === 'mid' ? 'var(--amber)' : 'var(--red)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="big">{r.e164 || r.cleaned || r.input}</div>
          <div className="muted">{r.summary}</div>
        </div>
        {!compact && <div className="row">
          {r.e164 && <CopyButton text={r.e164} label="E.164" />}
          <button className="btn sm" onClick={() => downloadJson(r, `analisis-${(r.e164 || 'numero').replace('+', '')}.json`)}><FileJson size={14} /> JSON</button>
        </div>}
      </div>
      {r.warnings?.length > 0 && r.warnings.map((w, i) => <div key={i} className="alert warning"><AlertTriangle size={16} color="var(--amber)" /> {w}</div>)}
      <div className="kv-list">
        {r.fields.map((f) => (
          <div className="kv-item" key={f.key}>
            <div className="k">{f.label}</div>
            <div className="v">{f.value}<div className="small muted" style={{ fontWeight: 400 }}>Fuente: {f.source}</div></div>
            <div><ReliabilityBadge value={f.status} /></div>
            {f.note && <div className="note"><Info size={12} style={{ verticalAlign: -2 }} /> {f.note}</div>}
          </div>
        ))}
      </div>
      {r.verification && (
        <div className="alert info" style={{ display: 'block' }}>
          <b>Verificación del operador:</b> el operador actual solo puede confirmarse en fuentes oficiales.{' '}
          {r.verification.regulator && <>Regulador: <a href={r.verification.regulator.url} target="_blank" rel="noopener noreferrer">{r.verification.regulator.name} <ExternalLink size={12} /></a>. </>}
          <a href={r.verification.ituNumberingPlans} target="_blank" rel="noopener noreferrer">Planes nacionales de numeración (UIT) <ExternalLink size={12} /></a>
        </div>
      )}
      {!compact && <div className="small muted">Metadatos: {r.source?.name} v{r.source?.version}. No se consultan bases privadas de operadores ni se obtiene titularidad o ubicación del número.</div>}
    </div>
  );
}

export default function PhoneAnalysis() {
  const { user, can, setCredits } = useAuth();
  const toast = useToast();
  const countries = useFetch('/phone/countries');
  const [mode, setMode] = useState('single');
  const [input, setInput] = useState('');
  const [batch, setBatch] = useState('');
  const [country, setCountry] = useState(user.preferences?.defaultCountry || 'CO');
  const [caseId, setCaseId] = useState(null);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [filters, setFilters] = useState({ q: '', valid: '', page: 1 });
  const [detail, setDetail] = useState(null);
  const history = useFetch(can('phone.history') ? '/phone/history' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }) : null);

  const run = async (e) => {
    e.preventDefault();
    const numbers = mode === 'single' ? [input.trim()] : batch.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!numbers.length || !numbers[0]) return toast.warning('Ingrese al menos un número.');
    setBusy(true);
    try {
      const r = await api.post('/phone/analyze', { numbers, defaultCountry: country, caseId, attachToCase: !!caseId && attach });
      setResults(r.results);
      setCredits(r.balance);
      toast.success(`${r.results.length} número(s) analizado(s).`);
      history.reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const openDetail = async (id) => {
    try { setDetail(await api.get(`/phone/history/${id}`)); } catch (e) { toast.error(e); }
  };

  return (
    <>
      <PageHead eyebrow="Módulo B" icon={Phone} title="Análisis telefónico" sub="Normalización, validación y clasificación basadas en planes de numeración públicos (UIT-T E.164)." />
      {can('phone.analyze') && (
        <div className="grid g-main">
          <form className="card" onSubmit={run}>
            <div className="card-head">
              <h3><ScanSearch size={16} color="var(--lime)" /> Nueva consulta</h3>
              <div className="chip-select">
                <button type="button" className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}><Phone size={13} /> Individual</button>
                <button type="button" className={mode === 'batch' ? 'on' : ''} onClick={() => setMode('batch')}><ListPlus size={13} /> Por lote</button>
              </div>
            </div>
            <div className="card-body stack">
              {mode === 'single' ? (
                <Field label="Número telefónico" help="Acepta formatos con espacios, guiones, paréntesis, prefijo + o 00.">
                  <div className="input-icon"><Phone size={16} /><input className="input mono" style={{ fontSize: 16, height: 44 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="+57 300 123 4567" autoFocus maxLength={40} /></div>
                </Field>
              ) : (
                <Field label="Números (uno por línea, máximo 50)" help={`${batch.split(/[\n,;]+/).filter((s) => s.trim()).length} número(s) detectado(s). Cada número consume créditos.`}>
                  <textarea className="textarea mono" rows={6} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder={'+57 300 123 4567\n6013456789\n+34 612 345 678'} />
                </Field>
              )}
              <div className="form-grid">
                <Field label="País predeterminado" help="Se usa cuando el número no incluye prefijo internacional.">
                  <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {(countries.data || [{ code: 'CO', name: 'Colombia', callingCode: '+57' }]).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.callingCode})</option>)}
                  </select>
                </Field>
                <CaseSelect value={caseId} onChange={setCaseId} help="La consulta quedará en el historial del expediente." />
              </div>
              {caseId && <label className="check"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Asociar los números válidos al expediente</label>}
              <div className="row between">
                <span className="small muted">Las consultas quedan registradas en el historial y la auditoría.</span>
                <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : <ScanSearch size={16} />} Analizar</button>
              </div>
            </div>
          </form>
          <div className="card">
            <div className="card-head"><h3><Info size={16} color="var(--lime)" /> Niveles de confirmación</h3></div>
            <div className="card-body stack" style={{ gap: 12 }}>
              {Object.entries(RELIABILITY).map(([k, [, , desc]]) => <div key={k} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><ReliabilityBadge value={k} /><span className="small muted">{desc}</span></div>)}
              <div className="divider" style={{ margin: '4px 0' }} />
              <p className="small muted">La plataforma <b>no</b> identifica titulares, no localiza teléfonos y no consulta bases privadas de operadores. El operador no se deduce del prefijo por la portabilidad numérica.</p>
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="card mt">
          <div className="card-head"><h3>Resultados ({results.length})</h3>
            <button className="btn sm" onClick={() => downloadJson(results, 'resultados-analisis.json')}><Download size={14} /> Exportar JSON</button>
          </div>
          <div className="card-body stack">
            {results.length === 1 ? <PhoneResult r={results[0]} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Entrada</th><th>E.164</th><th>País</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setDetail({ id: r.id, result: r, input: r.input, created_at: new Date().toISOString() })}>
                        <td className="mono">{r.input}</td><td className="mono lime">{r.e164 || '—'}</td><td>{r.countryName || '—'}</td>
                        <td>{r.fields.find((f) => f.key === 'type')?.value || '—'}</td>
                        <td><Badge cls={r.classification === 'valido' ? 'b-lime' : r.classification === 'posible' ? 'b-amber' : 'b-red'} dot>{r.classification === 'valido' ? 'Válido' : r.classification === 'posible' ? 'Posible' : 'Inválido'}</Badge></td>
                        <td className="right"><button className="btn sm">Ver detalle</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {can('phone.history') && (
        <div className="card mt">
          <div className="card-head"><h3><History size={16} color="var(--lime)" /> Historial de análisis</h3>
            <button className="btn sm" onClick={() => download('/phone/history' + qs({ ...filters, format: 'csv' }), 'historial.csv').catch(toast.error)}><Download size={14} /> Exportar CSV</button>
          </div>
          <div className="toolbar">
            <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Buscar número…" />
            <select className="select" value={filters.valid} onChange={(e) => setFilters({ ...filters, valid: e.target.value, page: 1 })}>
              <option value="">Todos</option><option value="1">Válidos</option><option value="0">No válidos</option>
            </select>
          </div>
          {history.loading && !history.data ? <Loading /> : history.data?.items.length === 0 ? <Empty icon={Phone} title="Sin consultas" text="Los análisis realizados aparecerán aquí." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Entrada</th><th>E.164</th><th className="hide-sm">País</th><th className="hide-sm">Resultado</th><th className="hide-sm">Expediente</th><th className="hide-sm">Usuario</th></tr></thead>
                <tbody>
                  {history.data?.items.map((h) => (
                    <tr key={h.id} className="clickable" onClick={() => openDetail(h.id)}>
                      <td className="nowrap small">{fmtDateTime(h.created_at)}</td>
                      <td className="mono">{h.input}</td>
                      <td className="mono lime">{h.e164 || '—'}</td>
                      <td className="hide-sm">{h.countryName || '—'}</td>
                      <td className="hide-sm"><Badge cls={h.valid ? 'b-lime' : 'b-red'} dot>{h.valid ? 'Válido' : 'No válido'}</Badge></td>
                      <td className="hide-sm nowrap">{h.case_code ? <Link to={`/expedientes/${h.case_id}`} onClick={(e) => e.stopPropagation()} className="mono">{h.case_code}</Link> : '—'}</td>
                      <td className="hide-sm small muted">{h.username}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination data={history.data} onPage={(page) => setFilters({ ...filters, page })} />
        </div>
      )}

      {detail && (
        <Modal size="lg" title={`Análisis de ${detail.input}`} onClose={() => setDetail(null)} footer={<button className="btn" onClick={() => setDetail(null)}>Cerrar</button>}>
          <div className="small muted mb">Consultado: {fmtDateTime(detail.created_at)}{detail.username ? ` por ${detail.username}` : ''} {detail.case_code && <>· Expediente <Link to={`/expedientes/${detail.case_id}`}>{detail.case_code}</Link></>} <DemoBadge show={detail.is_demo} /></div>
          <PhoneResult r={detail.result} />
        </Modal>
      )}
    </>
  );
}
