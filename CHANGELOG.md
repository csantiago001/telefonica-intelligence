# Historial de cambios

## [1.2.0] — 2026-11-07

### Añadido
- **Almacenamiento en Cloudflare R2**: las evidencias e informes pueden guardarse en R2
  (STORAGE=r2), con firma S3 (AWS Signature V4) validada contra el vector oficial de AWS.
- **Despliegue permanente y gratuito**: Dockerfile con Litestream que respalda la base
  SQLite a R2 de forma continua y la restaura al arrancar; blueprint de Render (render.yaml).
- **Buscador por nombre, correo y usuario** con enlaces a redes sociales; resultados en la app.
- Enlaces de consentimiento con nombre legible (slug) y pantalla simplificada.
- Prueba automatizada del almacenamiento R2 (servidor S3 simulado): subida, descarga,
  verificación de integridad y borrado. Total: 69 pruebas de API/unidad + 17 E2E.

### Cambiado
- Los puntos de lectura/escritura de archivos de evidencia e informes pasaron a asíncronos
  para admitir almacenamiento remoto (R2) sin cambiar la base de datos (sigue en SQLite).


Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## [1.1.0] — 2026-11-03

### Añadido
- **Investigar número**: análisis + búsqueda pública automática en un paso, con creación opcional de expediente y guardado de hallazgos.
- Búsqueda web automática con API oficial (Brave Search o Google Programmable Search) usando la clave del usuario, cifrada en reposo.
- **Modo público** (`iniciar-publico.bat`, `npm run publicar`): túnel HTTPS gratuito de Cloudflare para usar la plataforma y los enlaces de consentimiento desde celulares.
- Los lanzadores recompilan la interfaz en cada inicio para aplicar actualizaciones.

## [1.0.0] — 2026-11-03

Primera versión, desarrollada desde cero.

### Añadido
- Arquitectura cliente/servidor: React + Vite, Express 5, SQLite (`node:sqlite`).
- Dashboard con indicadores, gráficos, alertas y actividad reciente.
- Análisis telefónico (libphonenumber): E.164, país, prefijo, longitud, tipo, región CO, lotes, historial, CSV/JSON.
- OSINT con 7 conectores públicos reales, protección SSRF, hallazgos con fuente y confiabilidad.
- Geolocalización con consentimiento: enlaces únicos con vencimiento, mapa Leaflet/OSM, revocación y borrado por el titular.
- Expedientes con entidades, teléfonos, observaciones, estados e historial.
- Evidencias cifradas (AES-256-GCM), SHA-256, cadena de custodia, verificación de integridad, inventario.
- Informes PDF profesionales con registro de integridad.
- Créditos internos con costos configurables.
- Usuarios, roles editables, scrypt, 2FA TOTP, bloqueo por intentos, CSRF, auditoría.
- Configuración: parámetros, fuentes, retención, copias de seguridad cifradas automáticas.
- Entorno de demostración con datos ficticios en base separada.
- Lanzadores para Windows, macOS y Linux; Dockerfile; scripts de copia, restauración y recuperación.
- 60 pruebas de API/unitarias y 17 pruebas E2E.

### Seguridad
- React Router actualizado a 7.18.5 (corrige GHSA-wrjc-x8rr-h8h6 y GHSA-337j-9hxr-rhxg).
