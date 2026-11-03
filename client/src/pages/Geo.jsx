import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapPin, Plus, Link2, Ban, Trash2, ArrowLeft, ShieldCheck, Clock, ExternalLink, AlertTriangle, Eraser } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, useToast, useConfirm } from '../lib/context.jsx';
import { useFetch, PageHead, Field, Spinner, GeoStatusBadge, Pagination, Empty, Loading, ErrorBox, SearchInput, CaseSelect, Modal, CopyButton, DemoBadge } from '../components/ui.jsx';
import { fmtDateTime, timeAgo } from '../lib/format.js';

const MapView = lazy(() => import('../components/MapView.jsx'));

function CreateLinkModal({ initialCase, onClose, onCreated }) {
  const toast = useToast();
  const { setCredits } = useAuth();
  const [f, setF] = useState({ caseId: initialCase ?? null, recipientLabel: '', purpose: '', expiresHours: 24, slug: '', legalBasis: false });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/geo/links', { ...f, expiresHours: Number(f.expiresHours) });
      setCreated({ ...r, url: r.publicUrl || `${window.location.origin}${r.path}` });
      const me = await api.get('/auth/me');
      setCredits(me.credits);
      onCreated?.();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  if (created) {
    const insecure = created.url.startsWith('http://') && !/\/\/(localhost|127\.0\.0\.1)/.test(created.url);
    return (
      <Modal title="Enlace generado" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Listo</button>}>
        <div className="stack">
          <div className="alert success"><ShieldCheck size={18} color="var(--lime)" /><div>Envíe este enlace a <b>{f.recipientLabel}</b> por un canal de confianza. Solo se mostrará esta vez: la plataforma guarda únicamente su huella.</div></div>
          <div className="hash" style={{ fontSize: 13 }}>{created.url}</div>
          <div className="row"><CopyButton text={created.url} label="Copiar enlace" /><a className="btn sm" href={created.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver como destinatario</a></div>
          <div className="small muted">Vence: {fmtDateTime(created.expiresAt)}</div>
          {insecure && <div className="alert warning"><AlertTriangle size={16} color="var(--amber)" /><div>Los navegadores solo permiten compartir ubicación en <b>HTTPS</b>. Para enviar enlaces fuera de este equipo configure <span className="mono">PUBLIC_URL</span> con un dominio HTTPS (ver manual técnico).</div></div>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Nuevo enlace de ubicación con consentimiento" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.legalBasis} onClick={submit}>{busy ? <Spinner /> : <Link2 size={15} />} Generar enlace</button></>}>
      <div className="stack">
        <div className="alert info" style={{ display: 'block' }}>La persona verá la finalidad y el texto de consentimiento. Solo si acepta y su navegador concede el permiso se recibirá su ubicación. Podrá revocarlo y borrar sus datos en cualquier momento.</div>
        <Field label="Destinatario" help="Cómo identificará a la persona en la plataforma."><input className="input" value={f.recipientLabel} onChange={(e) => setF({ ...f, recipientLabel: e.target.value })} maxLength={120} /></Field>
        <Field label="Finalidad (visible para la persona)"><textarea className="textarea" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} maxLength={500} placeholder="Ej.: Confirmar que se encuentra a salvo, a solicitud de su familia." /></Field>
        <div className="form-grid">
          <Field label="Vigencia"><select className="select" value={f.expiresHours} onChange={(e) => setF({ ...f, expiresHours: e.target.value })}>{[1, 6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hora(s)` : `${h / 24} día(s)`}</option>)}</select></Field>
          <CaseSelect value={f.caseId} onChange={(caseId) => setF({ ...f, caseId })} />
        </div>
        <Field label="Nombre del enlace (opcional)" help="Personaliza la parte final del enlace, por ejemplo ana-maria. Se añade un sufijo aleatorio por seguridad."><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} maxLength={40} placeholder="ana-maria" /></Field>
        <label className="check"><input type="checkbox" checked={f.legalBasis} onChange={(e) => setF({ ...f, legalBasis: e.target.checked })} /><span>Confirmo que existe una finalidad legítima, que la persona será informada y que <b>no</b> usaré este enlace de forma engañosa ni para obtener la ubicación sin su conocimiento.</span></label>
      </div>
    </Modal>
  );
}

export default function Geo() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', status: '', page: 1 });
  const [creating, setCreating] = useState(sp.get('nuevo') === '1' ? { caseId: sp.get('caseId') ? Number(sp.get('caseId')) : null } : null);
  const list = useFetch('/geo/links' + qs({ ...filters, pageSize: user.preferences?.pageSize || 20 }));
  useEffect(() => { if (sp.get('nuevo')) setSp({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead eyebrow="Módulo D" icon={MapPin} title="Ubicación con consentimiento" sub="Enlaces únicos y temporales. La ubicación solo se recibe si la persona la comparte voluntariamente.">
        {can('geo.write') && <button className="btn primary" onClick={() => setCreating({ caseId: null })}><Plus size={15} /> Nuevo enlace</button>}
      </PageHead>
      <div className="alert info mb"><ShieldCheck size={18} color="var(--blue)" /><div>Esta plataforma <b>no</b> rastrea teléfonos, no obtiene ubicaciones a partir de un número y no evade permisos del navegador.</div></div>
      <div className="card">
        <div className="toolbar">
          <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q, page: 1 })} placeholder="Destinatario o finalidad…" />
          <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
            <option value="">Todos</option><option value="pendiente">Pendientes</option><option value="activo">Consentidos</option><option value="revocado">Revocados</option><option value="expirado">Expirados</option>
          </select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length === 0 ? <Empty icon={MapPin} title="Sin enlaces" text="Genere un enlace para solicitar una ubicación con consentimiento." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Destinatario</th><th>Estado</th><th className="hide-sm">Expediente</th><th className="hide-sm">Ubicaciones</th><th className="hide-sm">Consentimiento</th><th>Vence</th></tr></thead>
            <tbody>{list.data?.items.map((g) => (
              <tr key={g.id} className="clickable" onClick={() => nav(`/geolocalizacion/${g.id}`)}>
                <td><div className="t-title">{g.recipient_label} <DemoBadge show={g.is_demo} /></div><div className="t-sub">{g.purpose.slice(0, 90)}</div></td>
                <td><GeoStatusBadge value={g.status} /></td>
                <td className="hide-sm">{g.case_code ? <span className="mono">{g.case_code}</span> : '—'}</td>
                <td className="hide-sm">{g.locations}</td>
                <td className="hide-sm small">{fmtDateTime(g.consent_at)}</td>
                <td className="small nowrap">{timeAgo(g.expires_at)}</td>
              </tr>))}</tbody></table></div>
        )}
        <Pagination data={list.data} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {creating && <CreateLinkModal initialCase={creating.caseId} onClose={() => setCreating(null)} onCreated={list.reload} />}
    </>
  );
}

export function GeoDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { data: g, loading, error, reload } = useFetch(`/geo/links/${id}`);
  if (loading && !g) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const act = async (fn, opts, ok) => {
    if (!(await confirm(opts))) return;
    try { await fn(); toast.success(ok); reload(); } catch (e) { toast.error(e); }
  };
  return (
    <>
      <Link to="/geolocalizacion" className="small row" style={{ gap: 4, marginBottom: 10, display: 'inline-flex' }}><ArrowLeft size={14} /> Ubicación consentida</Link>
      <PageHead eyebrow={`Enlace ···${g.token_hint}`} icon={MapPin} title={<>{g.recipient_label} <DemoBadge show={g.is_demo} /></>} sub={<span className="row" style={{ gap: 8 }}><GeoStatusBadge value={g.status} /><span><Clock size={12} /> Vence {fmtDateTime(g.expires_at)}</span></span>}>
        {can('geo.write') && ['pendiente', 'activo'].includes(g.status) && <button className="btn" onClick={() => act(() => api.post(`/geo/links/${g.id}/revoke`), { title: 'Revocar enlace', message: 'El enlace dejará de aceptar ubicaciones. Los datos recibidos se conservan hasta que los elimine.', confirmText: 'Revocar' }, 'Enlace revocado.')}><Ban size={15} /> Revocar</button>}
        {can('geo.write') && g.locations.length > 0 && <button className="btn danger" onClick={() => act(() => api.del(`/geo/links/${g.id}/locations`), { title: 'Eliminar ubicaciones', danger: true, message: `Se eliminarán ${g.locations.length} registro(s) de ubicación.`, confirmText: 'Eliminar datos' }, 'Datos de ubicación eliminados.')}><Eraser size={15} /> Eliminar datos</button>}
        {can('geo.write') && <button className="btn danger icon" aria-label="Eliminar enlace" onClick={async () => { if (await confirm({ title: 'Eliminar enlace', danger: true, message: 'Se eliminará el enlace, el registro de consentimiento y las ubicaciones.', confirmText: 'Eliminar' })) { try { await api.del(`/geo/links/${g.id}`); toast.success('Enlace eliminado.'); nav('/geolocalizacion'); } catch (e) { toast.error(e); } } }}><Trash2 size={15} /></button>}
      </PageHead>
      <div className="grid g-main">
        <div className="card">
          <div className="card-head"><h3><MapPin size={16} color="var(--lime)" /> Ubicaciones autorizadas</h3><span className="hint">{g.locations.length}</span></div>
          <div className="card-body stack">
            {g.locations.length === 0 ? <Empty icon={MapPin} title="Sin ubicaciones" text={g.status === 'pendiente' ? 'La persona aún no ha aceptado el consentimiento.' : 'No hay datos de ubicación almacenados.'} /> : <>
              <Suspense fallback={<Loading />}><MapView points={g.locations} /></Suspense>
              <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Coordenadas</th><th>Precisión</th><th>Recibida</th><th></th></tr></thead>
                <tbody>{g.locations.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td className="mono">{l.latitude.toFixed(6)}, {l.longitude.toFixed(6)}</td><td>{l.accuracy_m ? `±${Math.round(l.accuracy_m)} m` : '—'}</td><td className="small">{fmtDateTime(l.received_at)}</td>
                  <td className="right"><a className="btn sm" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=17/${l.latitude}/${l.longitude}`}><ExternalLink size={12} /> OSM</a></td></tr>)}</tbody></table></div>
            </>}
          </div>
        </div>
        <div className="stack">
          <div className="card"><div className="card-head"><h3><ShieldCheck size={16} color="var(--lime)" /> Registro de autorización</h3></div>
            <div className="card-body"><dl className="dl" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>Finalidad</dt><dd>{g.purpose}</dd>
              <dt>Expediente</dt><dd>{g.case_code ? <Link to={`/expedientes/${g.case_id}`} className="mono">{g.case_code}</Link> : '—'}</dd>
              <dt>Creado</dt><dd>{fmtDateTime(g.created_at)} por {g.created_by_name}</dd>
              <dt>Consentimiento</dt><dd>{g.consent_at ? fmtDateTime(g.consent_at) : 'No otorgado'}</dd>
              <dt>Navegador</dt><dd className="small">{g.consent_user_agent || '—'}</dd>
              <dt>Huella IP</dt><dd className="mono small">{g.consent_ip_hash || '—'}</dd>
              <dt>Revocación</dt><dd>{g.revoked_at ? `${fmtDateTime(g.revoked_at)} (${g.revoked_by})` : '—'}</dd>
            </dl></div></div>
          {g.consent_text && <div className="card"><div className="card-head"><h3>Texto aceptado</h3></div><div className="card-body"><div className="consent-text">{g.consent_text}</div></div></div>}
        </div>
      </div>
    </>
  );
}
