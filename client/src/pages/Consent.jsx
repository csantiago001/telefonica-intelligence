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
            <div style={{ textAlign: 'center' }}>
              <div className="eyebrow" style={{ justifyContent: 'center' }}><ShieldCheck size={13} /> Solicitud de ubicación</div>
              <h1 style={{ fontSize: 22 }}>Para continuar, comparte tu ubicación</h1>
              <p className="muted mt" style={{ marginTop: 8 }}><b>{info.organization}</b> la solicita para: {info.purpose}</p>
            </div>
            {msg && <div className={`alert ${msg.type}`}>{msg.type === 'success' ? <CheckCircle2 size={18} color="var(--lime)" /> : <XCircle size={18} color="var(--red)" />}<div>{msg.text}</div></div>}
            {(info.status === 'pendiente' || info.status === 'activo') && <>
              <label className="check" style={{ justifyContent: 'center' }}><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>Acepto compartir mi ubicación de forma libre e informada.</span></label>
              <button className="btn primary block" style={{ height: 48, fontSize: 16 }} disabled={!accepted || busy} onClick={share}>{busy ? <Spinner /> : <MapPin size={18} />} {info.sharedCount ? 'Compartir de nuevo' : 'Aceptar y compartir'}</button>
              <details className="small muted" style={{ textAlign: 'center' }}>
                <summary style={{ cursor: 'pointer' }}>Ver detalle del tratamiento de datos</summary>
                <div className="consent-text mt" style={{ textAlign: 'left' }}>{info.consentText}</div>
                <div className="row mt" style={{ gap: 8, justifyContent: 'center' }}><GeoStatusBadge value={info.status} /><span><Clock size={12} style={{ verticalAlign: -2 }} /> Vence: {fmtDateTime(info.expiresAt)}</span></div>
              </details>
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
