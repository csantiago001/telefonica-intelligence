import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Mapa con teselas de OpenStreetMap. Usa marcadores vectoriales (sin imágenes externas). */
export default function MapView({ points }) {
  const el = useRef(null);
  const map = useRef(null);
  useEffect(() => {
    if (!el.current) return undefined;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([4.6, -74.08], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; colaboradores de OpenStreetMap' }).addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const layer = L.layerGroup().addTo(m);
    const bounds = [];
    points.forEach((p, i) => {
      const ll = [p.latitude, p.longitude];
      bounds.push(ll);
      if (p.accuracy_m) L.circle(ll, { radius: p.accuracy_m, color: '#a3e635', weight: 1, fillOpacity: 0.08 }).addTo(layer);
      L.circleMarker(ll, { radius: i === points.length - 1 ? 8 : 6, color: '#10140c', weight: 2, fillColor: '#a3e635', fillOpacity: 1 })
        .bindPopup(`<b>Ubicación ${i + 1}</b><br/>${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}<br/>${p.accuracy_m ? `Precisión ±${Math.round(p.accuracy_m)} m<br/>` : ''}${new Date(p.received_at).toLocaleString('es-CO')}`)
        .addTo(layer);
    });
    if (bounds.length === 1) m.setView(bounds[0], 15);
    else if (bounds.length > 1) m.fitBounds(bounds, { padding: [40, 40] });
    return () => layer.remove();
  }, [points]);
  return <div ref={el} className="map" role="region" aria-label="Mapa de ubicaciones autorizadas" />;
}
