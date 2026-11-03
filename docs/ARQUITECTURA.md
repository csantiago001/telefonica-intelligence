# Arquitectura — TELEFÓNICA INTELLIGENCE

Documento de decisiones técnicas (FASE 1). Se redactó antes de implementar y se
actualizó al cerrar el proyecto.

## 1. Visión general

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  SPA React (Vite)  ──  /api/*  (JSON, cookies httpOnly + CSRF)     │
│  Página pública /consentimiento/:token (sin sesión)                │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP(S)
┌──────────────────────────────▼─────────────────────────────────────┐
│  API REST Node.js 22 + Express 5                                   │
│  ├─ middleware: helmet (CSP), sesión, CSRF, RBAC, rate-limit,      │
│  │              validación zod, auditoría, manejo de errores       │
│  ├─ módulos: auth · usuarios · roles · dashboard · teléfono ·      │
│  │           OSINT · expedientes · evidencias · informes ·         │
│  │           créditos · geolocalización · configuración · backups │
│  ├─ conectores OSINT reales (DNS, RDAP, CT/crt.sh, Wayback,        │
│  │   verificador de enlaces con protección SSRF, DuckDuckGo IA)    │
│  └─ tareas: retención/purga diaria, expiración de enlaces          │
└──────────────┬──────────────────────────────┬──────────────────────┘
               │                              │
     ┌─────────▼─────────┐        ┌───────────▼───────────┐
     │ SQLite (node:sqlite)│      │ data/evidencias/*.enc  │
     │ data/ti.db (WAL)    │      │ AES-256-GCM en reposo  │
     └─────────────────────┘      └────────────────────────┘
```

Frontend y backend son **paquetes separados** (`client/`, `server/`) que se
comunican solo por la API REST. En producción local el backend sirve el
frontend compilado desde el mismo puerto (un solo proceso, fácil de usar);
ambos pueden separarse en servidores distintos cambiando `CORS_ORIGIN`.

## 2. Decisiones y justificación

| Área | Elección | Por qué | Alternativas descartadas |
|---|---|---|---|
| Runtime | Node.js 22 LTS (≥ 22.13) | LTS hasta 2027, mismo lenguaje en front y back | Python/Django (dos ecosistemas) |
| Backend | Express 5 | Estable, mínimo, gran ecosistema de seguridad | NestJS (sobrecarga para app privada) |
| Base de datos | SQLite vía `node:sqlite` integrado | Cero dependencias nativas (instala igual en Windows/macOS/Linux sin compiladores), archivo único fácil de respaldar, transacciones ACID, WAL | PostgreSQL (requiere servidor; ruta de migración documentada), better-sqlite3 (binario nativo) |
| Frontend | React 18 + Vite + React Router | SPA rápida, build estático | Next.js (SSR innecesario) |
| Gráficos | Recharts | Declarativo, responsive | Chart.js |
| Mapas | Leaflet + teselas OpenStreetMap | Gratuito, sin clave de API | Google Maps (pago/clave) |
| PDF | PDFKit (servidor) | PDF real generado en backend, incluye hashes | Impresión del navegador |
| Teléfonos | libphonenumber-js (metadatos de Google/UIT) | Fuente pública y verificable de planes de numeración | Bases de operadores (ilegales/pagas) |
| Contraseñas | `crypto.scrypt` (N=2^15, r=8, p=1) + sal de 16 bytes | Algoritmo de derivación resistente a GPU, nativo | bcrypt/argon2 (binarios nativos) |
| 2FA | TOTP RFC 6238 implementado con `crypto` + QR (`qrcode`) | Compatible con Google Authenticator, Authy, etc. | SMS (costoso e inseguro) |
| Sesiones | Token aleatorio 256 bits en cookie httpOnly/SameSite=Strict; se guarda **solo su hash** en BD | Revocables, sin JWT de larga vida | JWT en localStorage (XSS) |
| CSRF | Doble envío: cookie `ti_csrf` + cabecera `X-CSRF-Token` | Defensa en profundidad además de SameSite | — |
| Validación | zod en cada endpoint | Esquemas declarativos | Validación manual |
| Cifrado | AES-256-GCM para evidencias, secretos TOTP y copias | Autenticado (detecta manipulación) | AES-CBC |
| Pruebas | `node:test` + supertest (API), Playwright (E2E y responsive) | Nativos/preinstalados | Jest |

## 3. Modelo de datos (resumen)

- `users`, `roles` (permisos JSON editables), `sessions`, `login_attempts`, `password_resets`
- `cases` (expedientes), `case_entities`, `case_phones`, `case_notes`, `case_status_history`
- `evidence`, `evidence_custody` (cadena de custodia)
- `phone_queries` (historial de análisis)
- `osint_queries`, `findings` (hallazgos con fuente, fecha y confiabilidad)
- `geo_links`, `geo_locations` (consentimiento, coordenadas, revocación)
- `reports` (informes generados con hash SHA-256 del PDF)
- `credit_accounts` (en `users.credits`), `credit_transactions`, `settings` (clave/valor JSON)
- `audit_log` (inmutable desde la aplicación)

Todas las tablas de negocio tienen `is_demo` para separar datos ficticios.
Además, el modo demo usa **otra base de datos** (`DATA_DIR` distinto).

## 4. Seguridad por capas

1. **Transporte**: HTTPS recomendado en servidor (proxy inverso). Cookies `Secure` cuando `COOKIE_SECURE=true`.
2. **Cabeceras**: helmet con CSP estricta (sin `unsafe-inline` para scripts), `frame-ancestors 'none'`, HSTS en producción.
3. **Autenticación**: scrypt, bloqueo tras N intentos fallidos por usuario+IP, 2FA TOTP opcional, códigos de recuperación hasheados.
4. **Autorización**: RBAC con permisos granulares (`cases.write`, `evidence.read`, `admin.users`...). Se verifica en el servidor en cada ruta.
5. **Entradas**: zod, límites de tamaño, nombres de archivo saneados, consultas SQL siempre parametrizadas.
6. **SSRF**: el verificador de enlaces resuelve DNS y bloquea IP privadas, loopback, link-local y metadatos de nube; limita redirecciones, tiempo y tamaño.
7. **Datos en reposo**: evidencias y secretos cifrados con clave maestra `MASTER_KEY` (fuera del repositorio).
8. **Auditoría**: toda operación relevante queda en `audit_log` con usuario, IP, fecha y detalle.
9. **Retención**: purga automática configurable; eliminación segura (sobrescritura del archivo cifrado antes de borrar).

## 5. Límites éticos y legales implementados por diseño

- No existe ninguna función que obtenga ubicación a partir de un número.
- La ubicación solo se recibe si la persona abre el enlace, lee el consentimiento, lo acepta y su navegador concede el permiso. Puede revocarlo y borrar sus datos desde el mismo enlace.
- El operador **no** se infiere del prefijo (la portabilidad numérica lo hace no verificable). Se indica "no determinado" y se enlaza a la fuente oficial del regulador.
- Los conectores OSINT solo consultan registros públicos (DNS, RDAP, Certificate Transparency, Internet Archive). Si una fuente falla, el resultado se registra como **fallido**, nunca como éxito simulado.

## 6. Entornos

| | Privado | Demostración |
|---|---|---|
| `APP_MODE` | `private` | `demo` |
| Datos | Reales, `./data` | Ficticios generados, base separada |
| Primer arranque | Asistente para crear el administrador | Usuarios demo con contraseñas públicas |
| Banner | — | "ENTORNO DE DEMOSTRACIÓN — DATOS FICTICIOS" |
| Carga de evidencias | Sí | Limitada (1 MB) y purgada |

## 7. Escalado futuro

- Sustituir SQLite por PostgreSQL: la capa `db/` usa SQL estándar y un único módulo de acceso.
- Separar frontend en un CDN y backend en servidor privado (CORS configurable).
- Contenedor Docker incluido (`Dockerfile`).
