# Manual técnico — Telefónica Intelligence

## 1. Requisitos

- Node.js **22.13+** (usa el módulo integrado `node:sqlite`; no requiere compiladores).
- 200 MB de disco para la aplicación + espacio para evidencias.
- Navegador moderno (Chrome, Edge, Firefox, Safari).

## 2. Estructura

```
telefonica-intelligence/
├── client/                 Frontend React + Vite
│   └── src/
│       ├── components/     Layout, UI, mapa
│       ├── lib/            Cliente API (CSRF), contextos, formatos
│       ├── pages/          Un archivo por módulo
│       └── styles/app.css  Sistema de diseño
├── server/                 Backend Express 5
│   ├── src/
│   │   ├── app.js          Composición: seguridad, rutas, estáticos, errores
│   │   ├── config.js       Lectura de .env
│   │   ├── db/             Esquema versionado, acceso, datos demo
│   │   ├── lib/            Criptografía, TOTP, teléfono, PDF, copias, HTTP seguro
│   │   ├── middleware/     Sesión, RBAC, CSRF, límites de tasa
│   │   ├── routes/         Un router por módulo
│   │   ├── services/       Conectores OSINT
│   │   └── jobs/           Retención y copias automáticas
│   ├── scripts/            init-env, backup, restore, reset-admin, check-secrets
│   └── test/               Pruebas unitarias y de API
├── e2e/run.js              Pruebas de navegador (Playwright)
├── docs/                   Documentación
├── iniciar.(bat|sh|command) Lanzadores
└── Dockerfile, render.yaml
```

## 3. Variables de entorno (`.env`)

| Variable | Predeterminado | Descripción |
|---|---|---|
| `APP_MODE` | `private` | `private` o `demo` |
| `MASTER_KEY` | — (obligatoria en privado) | 64 hex. Cifra evidencias, informes, secretos 2FA y copias |
| `HOST` | `127.0.0.1` | `0.0.0.0` para exponer en la red |
| `PORT` | `8080` (demo `8081`) | Puerto HTTP |
| `DATA_DIR` | `data` (demo `data-demo`) | Carpeta de datos |
| `PUBLIC_URL` | — | URL HTTPS pública para los enlaces de consentimiento |
| `COOKIE_SECURE` | `false` | `true` detrás de HTTPS (cookies Secure + HSTS) |
| `TRUST_PROXY` | `false` | `true` si hay proxy inverso (IP real del cliente) |
| `CORS_ORIGIN` | — | Origen permitido si el frontend se sirve aparte |
| `MAX_UPLOAD_MB` | `50` (demo `1`) | Tamaño máximo de evidencias |
| `OSINT_TIMEOUT_MS` | `10000` | Tiempo de espera de fuentes |
| `DEMO_RESET_ON_START` | `true` | En demo, borrar y recrear datos al iniciar |

`npm run setup` o los lanzadores crean `.env` a partir de `.env.example` con una clave aleatoria y permisos `600`.

## 4. Datos y seguridad

- `data/ti.db`: SQLite en modo WAL, `secure_delete=ON`, claves foráneas.
- `data/evidencias/*.enc`, `data/informes/*.pdf.enc`: AES-256-GCM (IV aleatorio, etiqueta de autenticación).
- Contraseñas: scrypt (N=32768, r=8, p=1, sal 16 bytes). Tokens de sesión, CSRF, restablecimiento y enlaces de ubicación: aleatorios; en la base solo se guarda su SHA-256.
- IP de quien acepta un consentimiento: HMAC-SHA256 con la clave maestra (huella, no IP en claro).
- Cabeceras: CSP estricta (`script-src 'self'`), `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS con `COOKIE_SECURE`.
- Límites de tasa: 600 solicitudes/min por IP en la API, 20/min en autenticación, 30/min en la página pública de consentimiento.
- SSRF: el verificador de enlaces valida la IP al conectar (resiste *DNS rebinding*), bloquea rangos privados, loopback, link-local, CGNAT y metadatos de nube, limita redirecciones (5), tiempo y tamaño (2 MB).

## 5. Despliegue en servidor privado (HTTPS)

Ejemplo con **Caddy** (certificados automáticos):

```
ti.midominio.org {
    reverse_proxy 127.0.0.1:8080
}
```

`.env`:

```
HOST=127.0.0.1
PUBLIC_URL=https://ti.midominio.org
COOKIE_SECURE=true
TRUST_PROXY=true
```

Servicio systemd (`/etc/systemd/system/ti.service`):

```
[Unit]
Description=Telefonica Intelligence
After=network.target
[Service]
WorkingDirectory=/opt/telefonica-intelligence
ExecStart=/usr/bin/npm start
Restart=on-failure
User=ti
[Install]
WantedBy=multi-user.target
```

Docker:

```bash
docker build -t telefonica-intelligence .
docker run -d -p 8080:8080 -v ti-data:/app/data --env-file .env telefonica-intelligence
```

## 6. Entorno de demostración web

`render.yaml` describe un servicio Docker con `APP_MODE=demo` (datos ficticios, base efímera, cargas de 1 MB, sin copias de seguridad). Requiere una cuenta del propietario en el proveedor. **No use GitHub Pages**: no ejecuta el backend Node.js.

## 7. Copias de seguridad y restauración

- Automáticas diarias (configurable) en `data/backups/`, se conservan las últimas N.
- Manuales: desde *Configuración → Retención y copias* o `npm run backup`.
- Formato `.tibak`: TAR (base de datos + evidencias + informes + manifiesto con SHA-256 de cada archivo) cifrado con AES-256-GCM.
- Restaurar (aplicación detenida): `npm run restore -- ruta/archivo.tibak` (verifica) y luego con `--confirmar`. Los datos previos se mueven a `data/antes-de-restaurar-<fecha>/`.
- **Copie periódicamente `data/backups/` y la `MASTER_KEY` a otro medio.**

## 8. Recuperación de acceso

- Usuario normal: el administrador genera un enlace de restablecimiento.
- Sin administradores disponibles: con la aplicación detenida, `npm run reset-admin -- usuario` crea o rehabilita la cuenta con una contraseña temporal y 2FA desactivado (queda en auditoría como evento crítico).

## 9. API

REST bajo `/api`, JSON. Autenticación por cookie `ti_session`; las solicitudes que modifican datos requieren la cabecera `X-CSRF-Token` con el valor de la cookie `ti_csrf`. Principales rutas: `/auth/*`, `/dashboard`, `/phone/*`, `/osint/*`, `/findings`, `/cases`, `/evidence`, `/reports`, `/geo/links`, `/public/consent/:token`, `/admin/users|roles|credits`, `/settings`, `/audit`, `/backups`, `/retention/*`, `/health`.

## 10. Migrar a PostgreSQL (futuro)

Todo el acceso a datos pasa por `server/src/db/database.js` (métodos `get`, `all`, `run`, `tx`) con SQL estándar y parámetros posicionales. Para migrar: implementar el mismo envoltorio sobre `pg`, adaptar `schema.js` (tipos `SERIAL`, `TIMESTAMPTZ`) y las pocas funciones específicas de SQLite (`strftime`, `VACUUM INTO` en copias).

## 11. Desarrollo y pruebas

```bash
npm run dev          # backend con --watch + Vite con proxy /api
npm test             # 60 pruebas (unitarias + API) con node:test y supertest
npm run build
npm i -D playwright && npx playwright install chromium
npm run test:e2e     # 17 flujos en navegador real
npm run check-secrets
```
