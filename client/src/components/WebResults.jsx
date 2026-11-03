import { Link } from 'react-router-dom';
import { Globe, Save, ExternalLink, AlertTriangle, Settings2, MessageCircle } from 'lucide-react';
import { Badge, Empty } from './ui.jsx';

export function WebResults({ data, onSave, caseId }) {
  if (!data) return null;
  const web = data.web;
  return (
    <div className="stack">
      {!data.webConfigured && (
        <div className="alert warning"><Settings2 size={16} color="var(--amber)" /><div>La búsqueda automática en Internet no está activada. Un administrador debe registrar una clave gratuita de buscador en <Link to="/configuracion?tab=fuentes">Configuración › Fuentes</Link>. Mientras tanto use la búsqueda asistida de abajo.</div></div>
      )}
      {data.webError && <div className="alert error"><AlertTriangle size={16} color="var(--red)" /><div>El buscador no respondió: {data.webError}</div></div>}
      {web && (
        <div>
          <div className="row between mb" style={{ marginBottom: 8 }}>
            <h3><Globe size={15} color="var(--lime)" style={{ verticalAlign: -2 }} /> {web.results.length} resultado(s) en Internet</h3>
            <span className="small muted">{web.providerLabel} · consultas: {web.queries.join(' · ')}</span>
          </div>
          {web.results.length === 0 ? <Empty icon={Globe} title="Sin publicaciones encontradas" text="El buscador no encontró páginas públicas que mencionen este número en sus distintos formatos." /> : (
            <div className="stack" style={{ gap: 8 }}>
              {web.results.map((r, i) => (
                <div key={i} className="card card-pad" style={{ background: 'var(--panel-2)', padding: 14 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="small lime">{r.site}{r.date && <span className="muted"> · {String(r.date).slice(0, 10)}</span>}</div>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--text)' }}>{r.title} <ExternalLink size={11} /></a>
                      {r.snippet && <div className="small muted" style={{ marginTop: 4 }}>{r.snippet}</div>}
                      <div className="small muted mono break" style={{ marginTop: 4 }}>{r.url}</div>
                      {r.matchedQueries.length > 1 && <Badge cls="b-blue">Coincide en {r.matchedQueries.length} formatos</Badge>}
                    </div>
                    {onSave && <button className="btn sm" onClick={() => onSave({ title: `${r.site}: ${r.title}`.slice(0, 300), detail: r.snippet, sourceName: r.site, sourceUrl: r.url, reliability: 'no_verificado', caseId })}><Save size={13} /> Hallazgo</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {data.instant?.abstract && <div className="alert info" style={{ display: 'block' }}><b>{data.instant.heading}</b><div>{data.instant.abstract}</div></div>}
      <div>
        <h3 style={{ marginBottom: 6 }}>Búsqueda asistida</h3>
        <p className="small muted">Abra estos enlaces para revisar manualmente. Registre como hallazgo lo que encuentre.</p>
        <div className="row" style={{ gap: 6 }}>
          {data.assisted?.links.map((l, i) => <a key={i} className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> {l.engine} · <span className="mono">{l.query}</span></a>)}
          {data.phone && <a className="btn sm" href={`https://wa.me/${data.phone.e164.replace('+', '')}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={12} /> Abrir en WhatsApp</a>}
        </div>
      </div>
    </div>
  );
}
