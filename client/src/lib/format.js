const dtf = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const nf = new Intl.NumberFormat('es-CO');

export const fmtDateTime = (s) => (s ? dtf.format(new Date(s)) : '—');
export const fmtDate = (s) => (s ? df.format(new Date(s)) : '—');
export const fmtNum = (n) => (n == null ? '—' : nf.format(n));
export function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
export function timeAgo(s) {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  const fut = diff < 0;
  const a = Math.abs(diff);
  const u = a < 60 ? [Math.round(a), 'segundo'] : a < 3600 ? [Math.round(a / 60), 'minuto'] : a < 86400 ? [Math.round(a / 3600), 'hora'] : [Math.round(a / 86400), 'día'];
  const txt = `${u[0]} ${u[1]}${u[0] === 1 ? '' : 's'}`;
  return fut ? `en ${txt}` : `hace ${txt}`;
}

export const CASE_STATUS = {
  abierto: ['Abierto', 'b-lime'],
  en_curso: ['En curso', 'b-blue'],
  suspendido: ['Suspendido', 'b-amber'],
  cerrado: ['Cerrado', 'b-gray'],
  archivado: ['Archivado', 'b-violet'],
};
export const CASE_PRIORITY = { baja: ['Baja', 'b-gray'], media: ['Media', 'b-blue'], alta: ['Alta', 'b-amber'], critica: ['Crítica', 'b-red'] };
export const CASE_CLASS = {
  general: 'General', fraude: 'Fraude', extorsion: 'Extorsión', suplantacion: 'Suplantación', acoso: 'Acoso', verificacion: 'Verificación',
  ciberseguridad: 'Ciberseguridad', persona_desaparecida: 'Persona desaparecida', otro: 'Otro',
};
export const RELIABILITY = {
  confirmado: ['Confirmado', 'b-lime', 'Dato observado directamente en una fuente pública verificable'],
  probable: ['Probable', 'b-amber', 'Inferencia razonable que requiere corroboración'],
  no_verificado: ['No verificado', 'b-red', 'Información sin confirmar o de fuente no fiable'],
  no_disponible: ['No disponible', 'b-gray', 'No existe una fuente legítima para este dato'],
};
export const OSINT_STATUS = { exito: ['Éxito', 'b-lime'], sin_resultados: ['Sin resultados', 'b-gray'], parcial: ['Parcial', 'b-amber'], fallido: ['Fallido', 'b-red'] };
export const GEO_STATUS = { pendiente: ['Pendiente', 'b-amber'], activo: ['Consentido', 'b-lime'], revocado: ['Revocado', 'b-red'], expirado: ['Expirado', 'b-gray'], eliminado: ['Eliminado', 'b-gray'] };
export const EVIDENCE_ORIGIN = {
  captura_pantalla: 'Captura de pantalla', documento: 'Documento', fotografia: 'Fotografía', audio: 'Audio', video: 'Video', registro_llamadas: 'Registro de llamadas',
  exportacion_web: 'Exportación web', entregado_por_tercero: 'Entregado por tercero', otro: 'Otro',
};
export const ENTITY_KIND = { persona: 'Persona', organizacion: 'Organización', dominio: 'Dominio', cuenta: 'Cuenta', otro: 'Otro' };
export const OPERATION_LABEL = {
  phone_analysis: 'Análisis telefónico', osint_dns: 'OSINT · DNS', osint_rdap: 'OSINT · RDAP', osint_ct: 'OSINT · Certificados', osint_wayback: 'OSINT · Wayback',
  osint_link: 'OSINT · Enlace', osint_search: 'OSINT · Búsqueda', osint_ip: 'OSINT · IP', report_pdf: 'Informe PDF', geo_link: 'Enlace de ubicación',
};
export const EVENT_LABEL = {
  creado: 'Creación', estado: 'Cambio de estado', editado: 'Edición', entidad: 'Entidad', telefono: 'Teléfono', observacion: 'Observación', observacion_eliminada: 'Observación eliminada',
  evidencia: 'Evidencia', evidencia_eliminada: 'Evidencia eliminada', consulta_telefonica: 'Consulta telefónica', consulta_osint: 'Consulta OSINT', hallazgo: 'Hallazgo',
  hallazgo_eliminado: 'Hallazgo eliminado', ubicacion: 'Ubicación', informe: 'Informe',
};
