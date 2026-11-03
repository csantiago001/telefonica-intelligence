# Informe de pruebas — Telefónica Intelligence 1.0.0

**Fecha de ejecución:** 3 de noviembre de 2026
**Entorno:** Linux x64, Node.js 22.23.4, Chromium (Playwright), contenedor con salida a Internet restringida.
Todas las pruebas listadas como superadas **se ejecutaron** en ese entorno. Las no ejecutadas se indican expresamente.

## 1. Resumen

| Suite | Herramienta | Resultado |
|---|---|---|
| Unitarias (criptografía, TOTP, teléfono, SSRF, OSINT, copias, CSV) | node:test | **11/11** |
| API e integración (todos los módulos) | node:test + supertest | **49/49** |
| Navegador real de extremo a extremo | Playwright + Chromium | **17/17** |
| Instalación limpia desde el repositorio | `git clone` + `iniciar.sh` | Superada |
| Scripts operativos (backup, reset-admin, restore) | CLI | Superados |
| Dependencias | `npm audit` | **0 vulnerabilidades** |
| Ausencia de secretos | `npm run check-secrets` | Superada |
| Compilación de imagen Docker | `docker build` | **No completada** (ver §6) |

Comandos: `npm test` y `npm run test:e2e`.

## 2. Requisitos de prueba del encargo

| Requisito | Evidencia | Estado |
|---|---|---|
| Instalación limpia | Clonado en carpeta vacía → `./iniciar.sh` instaló dependencias, compiló, creó `.env` (clave de 64 hex, permisos 600) e inició en modo privado con `setupRequired: true` | ✔ |
| Compilación | `vite build` sin errores | ✔ |
| Inicio de frontend y backend | Servidor sirve SPA y API; E2E navega todas las secciones | ✔ |
| Conexión a la base de datos | `GET /api/health` ejecuta consulta; migraciones aplicadas | ✔ |
| Inicio de sesión | Credenciales incorrectas con mensaje genérico, cookie httpOnly/SameSite, bloqueo tras 5 intentos, cierre de sesión | ✔ |
| Roles y permisos | Consultor no modifica (403 en API, controles ocultos y "Acceso restringido" en UI); analista sin acceso a administración; rol personalizado; rol admin protegido; no se puede desactivar el último admin | ✔ |
| Validación telefónica | E.164, país, prefijo, longitud, tipo, región CO, inválidos, lote ≤ 50, operador nunca "confirmado" | ✔ |
| Consultas OSINT | Validación de objetivo, SSRF bloqueado, fuente caída → "fallido" sin créditos, fuente desactivada, verificador de enlaces con servidor HTTP real (título, metadatos, redirecciones, cabeceras) | ✔ (ver §5) |
| Gestión de expedientes | Código único, entidades, teléfonos (sin duplicados), observaciones, historial, búsqueda por número/entidad, filtros, estados con motivo, archivado = solo lectura, eliminación con confirmación de código | ✔ |
| Gestión de evidencias | Carga, cifrado en disco (texto plano ausente), sin temporales, duplicados detectados, custodia, inventario CSV | ✔ |
| Cálculo SHA-256 | Vector conocido; hash de carga = hash del contenido; navegador = servidor; descarga con cabecera de hash; manipulación detectada → alerta crítica y descarga bloqueada | ✔ |
| Generación de PDF | PDF válido (`%PDF-`), hash registrado = hash descargado, 11 secciones verificadas visualmente | ✔ |
| Créditos | Descuento por operación, 402 sin saldo, sin saldo negativo, asignación manual (API y UI), costos configurables, aislamiento de movimientos por usuario | ✔ |
| Enlaces de ubicación | Requiere finalidad y confirmación; token guardado solo como hash; vencido → 410 | ✔ |
| Consentimiento y revocación | Sin casilla no se envía; permiso del navegador **denegado** → nada enviado; **concedido** → coordenadas recibidas y visibles en mapa; la persona revoca y borra sus datos; revocación por el analista | ✔ |
| Diseño responsive | Sin desbordamiento horizontal a 390, 820 y 1920 px en 5 secciones; menú lateral móvil | ✔ |
| Seguridad básica | CSP, nosniff, frame-ancestors, no-store, sin x-powered-by, CSRF, JSON malformado, recorrido de rutas en copias, contraseñas débiles rechazadas, 2FA TOTP completo (RFC 6238) con códigos de recuperación de un solo uso | ✔ |
| Ausencia de secretos | `.env`, bases de datos, evidencias y copias excluidos por `.gitignore`; `check-secrets` revisa 75+ archivos | ✔ |

## 3. Detalle de pruebas automatizadas de API (`server/test/`)

```
Instalación, salud y cabeceras: health y BD · cabeceras de seguridad · setup único · JSON mal formado
Autenticación: 401 sin sesión · error genérico · cookie httpOnly/SameSite · CSRF · bloqueo · política de
  contraseñas · 2FA completo + recuperación · enlace de restablecimiento de un solo uso · cambio de contraseña y logout
Roles: consultor solo lectura · analista sin administración · rol personalizado / admin protegido · último admin
Teléfono y créditos: análisis + descuento + historial + CSV · validación de lote · 402 sin saldo · costos
OSINT: objetivo inválido · SSRF (127.0.0.1, 169.254.169.254) · fuente caída = fallido · fuente desactivada ·
  verificador con servidor real · hallazgos con fuente/confiabilidad obligatorias
Expedientes/evidencias/informes: código único · entidades/teléfonos/observaciones · búsqueda · SHA-256 y cifrado ·
  verificación/descarga/custodia · manipulación · PDF · estados · eliminación
Geolocalización: requisitos del enlace · página pública · sin aceptación no guarda · aceptación · revocación y
  borrado por la persona · vencimiento · revocación por analista
Configuración: validación · auditoría + CSV · retención · copia cifrada/verificable/restaurable · dashboard
Demo: solo datos ficticios marcados, evidencias demo verificables, copias deshabilitadas
```

## 4. Pruebas E2E (`e2e/run.js`)

1. Inicio de sesión con contraseña incorrecta muestra error
2. Inicio de sesión como administrador demo (banner de demostración visible)
3. Análisis de `+57 601 345 6789` (E.164, región Bogotá, operador "No disponible")
4. Análisis por lote y descarga de CSV
5. Consulta OSINT RDAP registra el resultado real con aviso de fallo honesto
6. Crear expediente, entidad, número y observación
7. Cargar evidencia: SHA-256 en navegador, confirmación navegador = servidor, verificación, descarga
8. Generar y descargar informe PDF
9. Cambio de estado con motivo
10. Generar enlace de ubicación (botón deshabilitado sin confirmación legítima)
11. Destinataria niega permiso del navegador → mensaje, nada enviado
12. Destinataria concede permiso → ubicación visible para el analista en tabla y mapa; revoca y elimina → datos borrados
13. Consultor sin opciones de modificación ni administración
14. Asignación manual de créditos
15. Responsive en móvil/tableta/escritorio y menú móvil
16. Sin errores de JavaScript en consola
17. Instalación limpia en modo privado: asistente inicial, sin banner demo, sin datos

Capturas en `e2e/screenshots/` (se generan al ejecutar; no se versionan).

## 5. Limitación del entorno de prueba: fuentes OSINT externas

El contenedor de pruebas **no tiene acceso** a DNS público, rdap.org, crt.sh, archive.org, DuckDuckGo ni teselas de OpenStreetMap (bloqueo de red del entorno). Por ello:

- Se verificó que, ante la falta de conexión, cada consulta queda **"fallido"**, sin datos, sin hallazgos sugeridos y sin cobro de créditos (incluido el caso DNS, donde se usa un dominio de control para no confundir "sin red" con "dominio inexistente").
- Se verificó el camino de éxito del **verificador de enlaces** contra un servidor HTTP real local.
- **No se pudo verificar** en este entorno la interpretación de respuestas reales de RDAP, crt.sh, Wayback, DuckDuckGo y RDAP-IP. El código sigue los formatos públicos documentados de esas fuentes; se recomienda ejecutar una consulta de cada herramienta en el equipo de destino con Internet.
- El mapa muestra marcadores y controles, pero las teselas de fondo no cargaron en el entorno de prueba.

## 6. Pruebas no completadas

- **Imagen Docker:** el daemon se inició, pero `npm ci` dentro de la compilación no pudo descargar paquetes por las restricciones de red del contenedor. El `Dockerfile` no se ha validado de extremo a extremo.
- **Windows/macOS:** los lanzadores `iniciar.bat` e `iniciar.command` no se ejecutaron (el entorno es Linux). `iniciar.sh` sí.
- **Despliegue web público:** no realizado (requiere autorización y cuenta del propietario).

## 7. Errores encontrados y corregidos durante las pruebas

| Hallazgo | Corrección |
|---|---|
| DNS sin red devolvía "sin resultados" (podía interpretarse como dominio inexistente) | Verificación con dominio de control; sin DNS → "fallido" |
| React Router 6 con 2 vulnerabilidades moderadas | Actualizado a 7.18.5 (0 vulnerabilidades) |
| `npm run restore` no recibía el indicador de confirmación ni resolvía rutas relativas | Scripts invocan Node directamente; ruta según el directorio del usuario; indicador `--confirmar` |
| Botón de menú móvil visible en escritorio | Corrección de especificidad CSS |
| Fecha ISO sin formato en alertas | Formato local |
| Estados internos (`en_curso`) en el PDF; hash final aislado en una página | Etiquetas legibles; control de salto de página |
| Doble punto en texto de consentimiento | Normalización de la finalidad |
