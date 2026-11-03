import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, ShieldCheck, XCircle, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Logo, Loading, Spinner, GeoStatusBadge } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

const GEO_ERRORS = {
  1: 'Usted no concedió el permiso de ubicación en su navegador. No se envió ningún dato.',
  2: 'No fue posible determinar su ubicación (señal o servicios de ubicación desactivados).',
  3: 'Se agotó el tiempo para obtener la ubicación. Intente de nuevo.',
};

export default function Consent() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => api.get(`/public/consent/${token}`).then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = () => {
    setMsg(null);
    if (!window.isSecureContext) return setMsg({ type: 'error', text: 'Su navegador solo permite compartir la ubicación en conexiones seguras (HTTPS). Informe al solicitante.' });
    if (!navigator.geolocation) return setMsg({ type: 'error', text: 'Su navegador no admite geolocalización.' });
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api.post(`/public/consent/${token}/accept`, { accepted: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: Math.round(pos.timestamp) });
          setInfo(r);
          setMsg({ type: 'success', text: `Ubicación enviada (precisión aproximada ±${Math.round(pos.coords.accuracy)} m). Gracias.` });
        } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
      },
      (err) => { setBusy(false); setMsg({ type: 'error', text: GEO_ERRORS[err.code] || err.message }); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };
  const revoke = async () => {
    if (!window.confirm('¿Revocar su consentimiento y eliminar las ubicaciones que compartió?')) return;
    setBusy(true);
    try { const r = await api.post(`/public/consent/${token}/revoke`, { deleteData: true }); setInfo(r); setMsg({ type: 'success', text: `Consentimiento revocado. Se eliminaron ${r.deleted} registro(s) de ubicación.` }); } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="consent-page">
      <div className="card consent-card">
        <div className="card-body stack">
          <div className="row"><Logo /><div className="brand-text"><strong>TELEFÓNICA</strong><span>INTELLIGENCE</span></div></div>
          {error && <div className="alert error"><XCircle size={18} /> {error}</div>}
          {!info && !error && <Loading />}
          {info && <>
            {info.isDemo && <div className="demo-banner" style={{ borderRadius: 8 }}>DEMOSTRACIÓN · DATOS FICTICIOS</div>}
            <div>
              <div className="eyebrow"><ShieldCheck size={13} /> Solicitud de ubicación con consentimiento</div>
              <h1>{info.organization} solicita que comparta su ubicación</h1>
              <div className="row mt" style={{ gap: 8 }}><GeoStatusBadge value={info.status} /><span className="small muted"><Clock size={13} style={{ verticalAlign: -2 }} /> Vence: {fmtDateTime(info.expiresAt)}</span></div>
            </div>
            <div className="alert info" style={{ display: 'block' }}><b>Finalidad:</b> {info.purpose}</div>
            <div>
              <h3 className="mb" style={{ marginBottom: 8 }}>Información sobre el tratamiento de sus datos</h3>
              <div className="consent-text">{info.consentText}</div>
            </div>
            {msg && <div className={`alert ${msg.type}`}>{msg.type === 'success' ? <CheckCircle2 size={18} color="var(--lime)" /> : <XCircle size={18} color="var(--red)" />}<div>{msg.text}</div></div>}
            {(info.status === 'pendiente' || info.status === 'activo') && <>
              <label className="check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>He leído la información anterior y <b>acepto de forma libre, expresa e informada</b> compartir mi ubicación actual para la finalidad indicada.</span></label>
              <div className="row">
                <button className="btn primary" disabled={!accepted || busy} onClick={share}>{busy ? <Spinner /> : <MapPin size={16} />} {info.sharedCount ? 'Compartir de nuevo' : 'Compartir mi ubicación'}</button>
                <span className="small muted">Su navegador le pedirá permiso. Puede negarlo.</span>
              </div>
            </>}
            {info.status === 'expirado' && <div className="alert warning">Este enlace expiró. No es posible compartir la ubicación.</div>}
            {info.status === 'revocado' && <div className="alert warning">El consentimiento fue revocado el {fmtDateTime(info.revokedAt)}.</div>}
            {info.status !== 'eliminado' && (info.sharedCount > 0 || info.status === 'activo' || info.status === 'revocado') && (
              <div className="divider" />
            )}
            {info.status !== 'eliminado' && (info.sharedCount > 0 || info.status === 'activo') && (
              <div className="row between">
                <span className="small muted">Ha compartido su ubicación {info.sharedCount} vez/veces. Puede retirar su consentimiento en cualquier momento.</span>
                <button className="btn danger sm" onClick={revoke} disabled={busy}><Trash2 size={14} /> Revocar y eliminar mis datos</button>
              </div>
            )}
            <p className="small muted">Esta página no obtiene su ubicación de ninguna otra forma ni de manera continua. Si no reconoce esta solicitud, simplemente cierre la página.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
