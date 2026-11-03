# Historial de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

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
