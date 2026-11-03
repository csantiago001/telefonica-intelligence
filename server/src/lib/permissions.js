// Catálogo de permisos y roles predeterminados (RBAC).
export const PERMISSIONS = {
  'dashboard.view': 'Ver dashboard',
  'phone.analyze': 'Analizar números telefónicos',
  'phone.history': 'Ver historial de análisis',
  'osint.query': 'Ejecutar consultas OSINT',
  'osint.history': 'Ver historial OSINT y hallazgos',
  'findings.write': 'Registrar y editar hallazgos',
  'cases.read': 'Consultar expedientes',
  'cases.write': 'Crear y editar expedientes',
  'cases.delete': 'Eliminar expedientes',
  'evidence.read': 'Consultar evidencias',
  'evidence.download': 'Descargar evidencias',
  'evidence.write': 'Cargar evidencias',
  'evidence.delete': 'Eliminar evidencias',
  'reports.read': 'Consultar informes',
  'reports.write': 'Generar informes',
  'geo.read': 'Ver ubicaciones consentidas',
  'geo.write': 'Crear y revocar enlaces de ubicación',
  'credits.view': 'Ver créditos propios',
  'admin.credits': 'Administrar créditos y costos',
  'admin.users': 'Administrar usuarios',
  'admin.roles': 'Administrar roles y permisos',
  'admin.settings': 'Configurar parámetros del sistema y fuentes',
  'admin.audit': 'Consultar registro de auditoría',
  'admin.backups': 'Gestionar copias de seguridad y retención',
};

const ALL = Object.keys(PERMISSIONS);

export const DEFAULT_ROLES = [
  { key: 'admin', name: 'Administrador', description: 'Control total de la plataforma', permissions: ALL, is_system: 1 },
  {
    key: 'analista',
    name: 'Analista',
    description: 'Realiza investigaciones, consultas y gestiona expedientes',
    permissions: ALL.filter((p) => !p.startsWith('admin.') && p !== 'cases.delete'),
    is_system: 1,
  },
  {
    key: 'consultor',
    name: 'Consultor (solo lectura)',
    description: 'Consulta expedientes, evidencias e informes sin modificarlos',
    permissions: ['dashboard.view', 'phone.history', 'osint.history', 'cases.read', 'evidence.read', 'reports.read', 'geo.read', 'credits.view'],
    is_system: 1,
  },
];
