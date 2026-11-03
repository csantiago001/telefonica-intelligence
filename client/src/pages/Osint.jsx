import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, Globe, Server, ShieldCheck, Archive, Link2, Search, Network, Play, Clock, ExternalLink, Save, History, AlertTriangle, Lightbulb, Pencil, Trash2, Plus } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, OsintStatusBadge, ReliabilityBadge, Badge, Pagination, Empty, Loading, SearchInput, CaseSelect, Modal, DemoBadge } from '../components/ui.jsx';
import { fmtDateTime, RELIABILITY } from '../lib/format.js';

const ICONS = { dns: Server, rdap: Globe, ct: ShieldCheck, wayback: Archive, link: Link2, ip: Network, search: Search };
const PLACEHOLDER = { dominio: 'ejemplo.com', url: 'https://ejemplo.com/pagina', ip: '200.1.2.3', texto: 'Nombre, número, usuario o empresa' };

export function FindingModal({ initial, onClose, onSaved, lockCase }) {
  const toast = useToast();
  const [f, setF] = useState({
    caseId: initial?.case_id ?? initial?.caseId ?? null, osintQueryId: initial?.osint_query_id ?? initial?.osintQueryId ?? null,
    title: initial?.title || '', detail: initial?.detail || '', sourceName: initial?.source_name || initial?.sourceName || '',
    sourceUrl: initial?.source_url || initial?.sourceUrl || '', reliability: initial?.reliability || 'no_verificado',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, sourceUrl: f.sourceUrl || '' };
      if (initial?.id) await api.put(`/findings/${initial.id}`, body); else await api.post('/findings', body);
      toast.success(initial?.id ? 'Hallazgo actualizado.' : 'Hallazgo registrado.');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial?.id ? 'Editar hallazgo' : 'Registrar hallazgo'} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} Guardar</button></>}>
      <div className="form-grid">
        <Field label="Título del hallazgo" className="full"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} /></Field>
        <Field label="Detalle" className="full"><textarea className="textarea" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <Field label="Fuente (obligatoria)" help="Nombre de la fuente pública consultada."><input className="input" value={f.sourceName} onChange={(e) => setF({ ...f, sourceName: e.target.value })} /></Field>
        <Field label="URL de la fuente"><input className="input" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://" /></Field>
        <Field label="Nivel de confiabilidad" className="full">
          <div className="chip-select">
            {['confirmado', 'probable', 'no_verificado'].map((k) => (
              <button type="button" key={k} className={f.reliability === k ? 'on' : ''} onClick={() => setF({ ...f, reliability: k })}>{RELIABILITY[k][0]}</button>
            ))}
          </div>
          <span className="help">{RELIABILITY[f.reliability][2]}</span>
        </Field>
        {!lockCase && <div className="full"><CaseSelect value={f.caseId} onChange={(caseId) => setF({ ...f, caseId })} /></div>}
      </div>
    </Modal>
  );
}

function Records({ records }) {
  return (
    <div className="kv-list">
      {Object.entries(records).map(([k, v]) => (
        <div className="kv-item" key={k} style={{ gridTemplateColumns: '90px 1fr' }}>
          <div className="k mono">{k}</div>
          <div className="v mono small" style={{ fontWeight: 400 }}>{v.length ? v.map((x, i) => <div key={i}>{x}</div>) : <span className="muted">Sin registros</span>}</div>
        </div>
      ))}
    </div>
  );
}

function ResultView({ tool, data }) {
  if (!data) return null;
  if (data.demo) return <div className="alert warning">{data.nota}</div>;
  if (tool === 'dns') return <>{data.message && <div className="alert info mb">{data.message}</div>}<Records records={data.records} /></>;
  if (tool === 'rdap') return data.message ? <div className="alert info">{data.message}</div> : (
    <dl className="dl">
      <dt>Dominio</dt><dd className="mono">{data.domain}</dd>
      <dt>Registrador</dt><dd>{data.registrar || '—'} {data.registrarIana && <span className="muted">(IANA {data.registrarIana})</span>}</dd>
      <dt>Registrado</dt><dd>{fmtDateTime(data.registeredAt)}</dd>
      <dt>Expira</dt><dd>{fmtDateTime(data.expiresAt)}</dd>
      <dt>Última modificación</dt><dd>{fmtDateTime(data.updatedAt)}</dd>
      <dt>Estado</dt><dd>{data.status?.map((s) => <span className="tag" key={s}>{s}</span>)}</dd>
      <dt>Servidores DNS</dt><dd className="mono small">{data.nameservers?.join(', ') || '—'}</dd>
      <dt>DNSSEC</dt><dd>{data.dnssec == null ? '—' : data.dnssec ? 'Firmado' : 'No firmado'}</dd>
      <dt>Servidor RDAP</dt><dd className="small break">{data.rdapServer}</dd>
    </dl>
  );
  if (tool === 'ct') return (
    <div className="stack">
      <dl className="dl"><dt>Certificados</dt><dd>{data.certificates}</dd><dt>Nombres únicos</dt><dd>{data.subdomainCount}</dd><dt>Primer certificado</dt><dd>{fmtDateTime(data.firstSeen)}</dd><dt>Último</dt><dd>{fmtDateTime(data.lastSeen)}</dd>
        <dt>Emisores</dt><dd>{data.issuers?.slice(0, 6).map((i) => <span className="tag" key={i.name}>{i.name} ({i.count})</span>)}</dd></dl>
      {data.subdomains?.length > 0 && <div className="code-block" style={{ maxHeight: 220 }}>{data.subdomains.join('\n')}</div>}
    </div>
  );
  if (tool === 'wayback') return (
    <dl className="dl">
      <dt>Objetivo</dt><dd className="mono">{data.target}</dd><dt>Primera captura</dt><dd>{data.firstCapture || '—'}</dd><dt>Última captura</dt><dd>{data.lastCapture || '—'}</dd>
      <dt>Meses con capturas</dt><dd>{data.monthsWithCaptures}</dd>
      <dt>Captura más cercana</dt><dd>{data.closest ? <a href={data.closest.url} target="_blank" rel="noopener noreferrer">{data.closest.timestamp} <ExternalLink size={12} /></a> : '—'}</dd>
      <dt>Capturas por año</dt><dd>{Object.entries(data.byYear || {}).map(([y, n]) => <span className="tag" key={y}>{y}: {n}</span>)}</dd>
      {data.cdxError && <><dt>Aviso</dt><dd className="muted">Índice CDX no disponible: {data.cdxError}</dd></>}
    </dl>
  );
  if (tool === 'link') return (
    <div className="stack">
      <dl className="dl">
        <dt>Estado HTTP</dt><dd><Badge cls={data.reachable ? 'b-lime' : 'b-red'}>{data.status}</Badge> en {data.durationMs} ms</dd>
        <dt>URL final</dt><dd className="small break">{data.finalUrl}</dd>
        <dt>Redirecciones</dt><dd>{data.redirects.map((r, i) => <div key={i} className="small mono">{r.status} → {r.url}</div>)}</dd>
        <dt>Tipo de contenido</dt><dd>{data.contentType || '—'}</dd><dt>Servidor</dt><dd>{data.server || '—'}{data.poweredBy && ` · ${data.poweredBy}`}</dd>
        <dt>Título</dt><dd>{data.html?.title || '—'}</dd>
        <dt>Descripción</dt><dd>{data.html?.metas?.description || data.html?.metas?.['og:description'] || '—'}</dd>
        <dt>TLS</dt><dd>{data.tls ? `${data.tls.issuer} · válido hasta ${fmtDateTime(data.tls.validTo)} · ${data.tls.protocol}` : 'No aplica'}</dd>
        <dt>Cabeceras de seguridad</dt><dd>{Object.entries(data.securityHeaders).map(([k, v]) => <span key={k} className={`badge ${v ? 'b-lime' : 'b-gray'}`} style={{ margin: '0 4px 4px 0' }}>{k}</span>)}</dd>
      </dl>
      {data.html?.metas && Object.keys(data.html.metas).length > 0 && <details><summary className="small muted" style={{ cursor: 'pointer' }}>Metadatos de la página ({Object.keys(data.html.metas).length})</summary><div className="code-block mt">{Object.entries(data.html.metas).map(([k, v]) => `${k}: ${v}`).join('\n')}</div></details>}
    </div>
  );
  if (tool === 'ip') return (
    <dl className="dl"><dt>IP</dt><dd className="mono">{data.ip}</dd><dt>Red</dt><dd>{data.name || '—'} ({data.handle})</dd><dt>País</dt><dd>{data.country || '—'}</dd><dt>Rango</dt><dd className="mono small">{data.range || '—'} {data.cidr?.join(', ')}</dd>
      <dt>Organizaciones</dt><dd>{data.organizations?.join(', ') || '—'}</dd><dt>DNS inverso</dt><dd className="mono small">{data.reverse?.join(', ') || '—'}</dd></dl>
  );
  if (tool === 'search') return (
    <div className="stack">
      {data.instantError && <div className="alert warning"><AlertTriangle size={16} color="var(--amber)" /> La consulta automática a DuckDuckGo falló: {data.instantError}. Puede usar la búsqueda asistida.</div>}
      {data.instant && (data.instant.abstract || data.instant.topics.length > 0) ? (
        <div className="stack" style={{ gap: 8 }}>
          {data.instant.abstract && <div className="alert info" style={{ display: 'block' }}><b>{data.instant.heading}</b><div>{data.instant.abstract}</div>{data.instant.abstractUrl && <a href={data.instant.abstractUrl} target="_blank" rel="noopener noreferrer" className="small">{data.instant.abstractSource} <ExternalLink size={11} /></a>}</div>}
          {data.instant.topics.map((t, i) => <div key={i} className="small"><a href={t.url} target="_blank" rel="noopener noreferrer">{t.text}</a></div>)}
        </div>
      ) : !data.instantError && <div className="muted small">La API pública no devolvió un resumen para esta consulta.</div>}
      <div>
        <h3 style={{ marginBottom: 6 }}>Búsqueda asistida</h3>
        <p className="small muted">Enlaces generados para revisar manualmente en buscadores públicos (la plataforma no los ejecuta ni extrae resultados). Registre lo relevante como hallazgo indicando su confiabilidad.</p>
        <div className="table-wrap"><table className="table"><tbody>
          {data.assisted.links.map((l, i) => <tr key={i}><td className="small muted">{l.engine}</td><td className="mono small">{l.query}</td><td className="right"><a className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Abrir</a></td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
  return <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>;
}

export function OsintResult({ r, onSaveFinding }) {
  return (
    <div className="stack">
      <div className="row between">
        <div className="row"><OsintStatusBadge value={r.status} /><b>{r.toolLabel}</b><span className="mono muted">{r.target}</span></div>
        <div className="small muted"><Clock size={12} style={{ verticalAlign: -2 }} /> {fmtDateTime(r.consultedAt || r.created_at)}{r.durationMs != null && ` · ${r.durationMs} ms`}</div>
      </div>
      <div className="small"><span className="muted">Fuente:</span> {r.source}{r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">ver en la fuente <ExternalLink size={11} /></a></>}</div>
      {r.status === 'fallido' && <div className="alert error"><AlertTriangle size={16} color="var(--red)" /><div><b>La consulta no pudo completarse.</b> {r.error}<div className="small muted">No se generaron resultados ni se descontaron créditos. Ningún dato se presenta como obtenido.</div></div></div>}
      <ResultView tool={r.tool} data={r.data} />
      {r.suggestedFindings?.length > 0 && onSaveFinding && (
        <div>
          <h3 style={{ marginBottom: 8 }}><Lightbulb size={15} color="var(--lime)" style={{ verticalAlign: -2 }} /> Hallazgos sugeridos</h3>
          <div className="stack" style={{ gap: 8 }}>
            {r.suggestedFindings.map((f, i) => (
              <div key={i} className="row between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'nowrap' }}>
                <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{f.title}</div>{f.detail && <div className="small muted" style={{ wordBreak: 'break-word' }}>{f.detail}</div>}</div>
                <button className="btn sm" onClick={() => onSaveFinding({ title: f.title.slice(0, 300), detail: f.detail || '', sourceName: r.source, sourceUrl: r.sourceUrl || '', reliability: r.defaultReliability, osintQueryId: r.id })}><Save size={13} /> Guardar</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Osint() {
  const { user, can, setCredits } = useAuth();
  const toast = useToast();
  const tools = useFetch('/osint/tools');
  const [tool, setTool] = useState('dns');
  const [target, setTarget] = useState('');
  const [caseId, setCaseId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [finding, setFinding] = useState(null);
  const [filters, setFilters] = useState({ q: '', tool: '', status: '', page: 1 });
  const [detail, setDetail] = useState(null);
  const history = useFetch('/osint/history' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  const current = tools.data?.find((t) => t.key === tool);

  const run = async (e) => {
    e.preventDefault();
    if (!target.trim()) return toast.warning('Indique el objetivo de la consulta.');
    setBusy(true); setResult(null);
    try {
      const r = await api.post('/osint/run', { tool, target, caseId });
      setResult(r);
      setCredits(r.balance);
      if (r.status === 'fallido') toast.warning('La fuente no respondió. La consulta quedó registrada como fallida.');
      else toast.success('Consulta completada.');
      history.reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const openDetail = async (id) => {
    try {
      const d = await api.get(`/osint/history/${id}`);
      setDetail({ ...d, data: d.result, sourceUrl: d.source_url, durationMs: d.duration_ms });
    } catch (e) { toast.error(e); }
  };

  return (
    <>
      <PageHead eyebrow="Módulo C" icon={Radar} title="Inteligencia de fuentes abiertas" sub="Consultas reales a registros públicos. Cada resultado conserva su fuente, fecha y nivel de confiabilidad.">
        {can('findings.write') && <button className="btn" onClick={() => setFinding({ caseId })}><Plus size={15} /> Hallazgo manual</button>}
      </PageHead>
      {can('osint.query') && (
        <form className="card" onSubmit={run}>
          <div className="card-head"><h3><Radar size={16} color="var(--lime)" /> Herramientas</h3><span className="hint">Solo fuentes públicas y gratuitas</span></div>
          <div className="card-body stack">
            {tools.loading ? <Loading /> : (
              <div className="tool-grid">
                {tools.data?.map((t) => {
                  const I = ICONS[t.key] || Radar;
                  return (
                    <button type="button" key={t.key} disabled={!t.enabled} className={`tool-card ${tool === t.key ? 'on' : ''}`} onClick={() => { setTool(t.key); setResult(null); }}>
                      <div className="tc-top"><span className="row" style={{ gap: 8 }}><I size={17} color="var(--lime)" /><b style={{ fontSize: 13 }}>{t.label}</b></span><span className="badge b-gray">{t.costValue} cr</span></div>
                      <div className="tc-desc">{t.enabled ? t.source : 'Fuente desactivada por el administrador'}</div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="form-grid">
              <Field label={`Objetivo (${current?.target || ''})`} className="full">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input mono" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={PLACEHOLDER[current?.target] || ''} maxLength={500} />
                  <button className="btn primary" disabled={busy || !current?.enabled}>{busy ? <Spinner /> : <Play size={15} />} Consultar</button>
                </div>
              </Field>
              <CaseSelect value={caseId} onChange={setCaseId} />
              <div className="small muted" style={{ alignSelf: 'end' }}>Las consultas que fallan por indisponibilidad de la fuente no consumen créditos y se registran como fallidas.</div>
            </div>
          </div>
        </form>
      )}

      {busy && <div className="card mt card-body row"><Spinner /> Consultando la fuente pública… puede tardar hasta 25 segundos.</div>}
      {result && <div className="card mt"><div className="card-head"><h3>Resultado</h3>{result.status !== 'fallido' && can('findings.write') && <button className="btn sm" onClick={() => setFinding({ caseId, sourceName: result.source, sourceUrl: result.sourceUrl || '', reliability: result.defaultReliability, osintQueryId: result.id })}><Plus size={13} /> Registrar hallazgo</button>}</div>
        <div className="card-body"><OsintResult r={result} onSaveFinding={can('findings.write') ? (f) => setFinding({ ...f, caseId }) : null} /></div></div>}

      <div className="card mt">
        <div className="card-head"><h3><History size={16} color="var(--lime)" /> Historial de consultas</h3></div>
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Buscar objetivo…" />
          <select className="select" value={filters.tool} onChange={(e) => setFilters({ ...filters, tool: e.target.value, page: 1 })}>
            <option value="">Todas las herramientas</option>{tools.data?.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
            <option value="">Todos los estados</option><option value="exito">Éxito</option><option value="sin_resultados">Sin resultados</option><option value="parcial">Parcial</option><option value="fallido">Fallido</option>
          </select>
        </div>
        {history.loading && !history.data ? <Loading /> : history.data?.items.length === 0 ? <Empty icon={Radar} title="Sin consultas" text="Ejecute una consulta para comenzar." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Herramienta</th><th>Objetivo</th><th>Estado</th><th className="hide-sm">Fuente</th><th className="hide-sm">Expediente</th></tr></thead>
            <tbody>{history.data?.items.map((h) => (
              <tr key={h.id} className="clickable" onClick={() => openDetail(h.id)}>
                <td className="small nowrap">{fmtDateTime(h.created_at)}</td>
                <td>{tools.data?.find((t) => t.key === h.tool)?.label || h.tool}</td>
                <td className="mono small break">{h.target}</td>
                <td><OsintStatusBadge value={h.status} /></td>
                <td className="hide-sm small muted">{h.source}</td>
                <td className="hide-sm nowrap">{h.case_code ? <Link to={`/expedientes/${h.case_id}`} onClick={(e) => e.stopPropagation()} className="mono">{h.case_code}</Link> : '—'}</td>
              </tr>))}
            </tbody></table></div>
        )}
        <Pagination data={history.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>

      {detail && <Modal size="lg" title="Detalle de consulta OSINT" onClose={() => setDetail(null)} footer={<button className="btn" onClick={() => setDetail(null)}>Cerrar</button>}>
        <div className="small muted mb">Usuario: {detail.username} {detail.case_code && <>· Expediente <Link to={`/expedientes/${detail.case_id}`}>{detail.case_code}</Link></>} <DemoBadge show={detail.is_demo} /></div>
        <OsintResult r={detail} onSaveFinding={can('findings.write') && !detail.is_demo ? (f) => { setFinding({ ...f, caseId: detail.case_id }); setDetail(null); } : null} />
      </Modal>}
      {finding && <FindingModal initial={finding} onClose={() => setFinding(null)} />}
    </>
  );
}

export function Findings() {
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = useState({ q: '', reliability: '', page: 1 });
  const [edit, setEdit] = useState(null);
  const list = useFetch('/findings' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  const remove = async (f) => {
    if (!(await confirm({ title: 'Eliminar hallazgo', message: `Se eliminará "${f.title}".`, danger: true, confirmText: 'Eliminar' }))) return;
    try { await api.del(`/findings/${f.id}`); toast.success('Hallazgo eliminado.'); list.reload(); } catch (e) { toast.error(e); }
  };
  return (
    <>
      <PageHead eyebrow="Módulo C" icon={Lightbulb} title="Hallazgos" sub="Resultados organizados con fuente, fecha y nivel de confiabilidad.">
        {can('findings.write') && <button className="btn primary" onClick={() => setEdit({})}><Plus size={15} /> Nuevo hallazgo</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Buscar hallazgo o fuente…" />
          <select className="select" value={filters.reliability} onChange={(e) => setFilters({ ...filters, reliability: e.target.value, page: 1 })}>
            <option value="">Toda confiabilidad</option><option value="confirmado">Confirmado</option><option value="probable">Probable</option><option value="no_verificado">No verificado</option>
          </select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? <Empty icon={Lightbulb} title="Sin hallazgos" text="Guarde hallazgos desde las consultas OSINT o regístrelos manualmente." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Hallazgo</th><th>Confiabilidad</th><th className="hide-sm">Fuente</th><th className="hide-sm">Expediente</th><th className="hide-sm">Fecha</th><th></th></tr></thead>
            <tbody>{list.data?.items.map((f) => (
              <tr key={f.id}>
                <td><div className="t-title">{f.title} <DemoBadge show={f.is_demo} /></div>{f.detail && <div className="t-sub">{f.detail.slice(0, 160)}</div>}</td>
                <td><ReliabilityBadge value={f.reliability} /></td>
                <td className="hide-sm small">{f.source_name}{f.source_url && <div><a href={f.source_url} target="_blank" rel="noopener noreferrer" className="small">enlace <ExternalLink size={10} /></a></div>}</td>
                <td className="hide-sm">{f.case_code ? <Link to={`/expedientes/${f.case_id}`} className="mono">{f.case_code}</Link> : '—'}</td>
                <td className="hide-sm small nowrap">{fmtDateTime(f.observed_at)}</td>
                <td className="right nowrap">{can('findings.write') && <><button className="btn sm icon ghost" onClick={() => setEdit(f)} aria-label="Editar"><Pencil size={14} /></button><button className="btn sm icon ghost" onClick={() => remove(f)} aria-label="Eliminar"><Trash2 size={14} /></button></>}</td>
              </tr>))}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {edit && <FindingModal initial={edit} onClose={() => setEdit(null)} onSaved={list.reload} />}
    </>
  );
}
