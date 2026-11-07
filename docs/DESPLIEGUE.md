# Publicar la plataforma en Internet (permanente, sin tu PC, gratis)

Esta guía deja la plataforma funcionando en Internet **sin depender de tu computador
ni de una IP**, usando **Cloudflare R2** (gratis) para los datos y **Render** (plan
gratuito) para ejecutarla.

## Cómo queda la arquitectura

```
   Cualquier celular / computador
              │  https://telefonica-intelligence-xxxx.onrender.com
              ▼
   ┌─────────────────────────┐        ┌──────────────────────────┐
   │  Render (plan gratuito) │        │     Cloudflare R2        │
   │  - App Node (SQLite)    │──────► │  - Base de datos (copia  │
   │  - Litestream respalda  │        │    continua, Litestream) │
   │    la base a R2         │        │  - Evidencias e informes │
   └─────────────────────────┘        └──────────────────────────┘
```

- La base de datos se **respalda en tiempo real** en R2 y se restaura al arrancar:
  aunque Render reinicie o "duerma", los datos siguen ahí.
- Las evidencias e informes se guardan **directamente en R2**.
- Resultado: permanente, accesible desde cualquier dispositivo, **sin costo**.

> Único inconveniente del plan gratuito: si nadie la usa por ~15 min, "se duerme";
> la primera visita después tarda ~30 s en despertar. Las siguientes van normales.
> Si algún día quieres que esté siempre despierta, Render tiene un plan de ~7 USD/mes.

## Parte 1 — Cloudflare R2 (una sola vez)

1. Entra a <https://dash.cloudflare.com> → **R2**. Si te pide activar R2, actívalo
   (el plan gratuito da 10 GB; puede pedir una tarjeta para verificación, no cobra).
2. **Create bucket** → nombre: `telefonica` → crear.
3. Ve a **R2 → Manage R2 API Tokens → Create API Token**:
   - Permiso: **Object Read & Write**.
   - Aplícalo al bucket `telefonica`.
   - Crear. **Copia y guarda** estos tres datos (no se vuelven a mostrar):
     - **Access Key ID**
     - **Secret Access Key**
     - El **Account ID** (aparece en la página principal de R2, a la derecha).

## Parte 2 — Render (una sola vez)

1. Entra a <https://render.com> y regístrate con tu cuenta de GitHub.
2. **New → Blueprint**. Autoriza a Render a ver el repositorio `telefonica-intelligence`.
3. Render detecta `render.yaml` y pedirá estos valores (todos marcados como secretos):

   | Campo | Qué poner |
   |---|---|
   | **MASTER_KEY** | 64 caracteres hexadecimales. Genérala (ver abajo) y **guárdala aparte**. |
   | **R2_ACCOUNT_ID** | El Account ID de Cloudflare. |
   | **R2_BUCKET** | `telefonica` |
   | **R2_ACCESS_KEY_ID** | El Access Key ID de R2. |
   | **R2_SECRET_ACCESS_KEY** | El Secret Access Key de R2. |
   | **PUBLIC_URL** | Déjalo vacío por ahora; se completa en el paso 5. |

   Para generar la MASTER_KEY: en Windows, abra PowerShell y ejecute
   `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`,
   o pídamela y se la genero.

4. **Apply**. La primera construcción tarda unos minutos.
5. Cuando termine, Render muestra la URL (por ejemplo
   `https://telefonica-intelligence-xxxx.onrender.com`). Cópiala, ve a
   **Environment** del servicio, pon esa URL en **PUBLIC_URL** y guarda (se reinicia solo).
6. Abre esa URL desde cualquier dispositivo y crea tu usuario administrador.

¡Listo! La plataforma ya vive en Internet, con tus datos guardados en Cloudflare.

## Seguridad (importante)

- Activa la **verificación en dos pasos** (Configuración → Seguridad) para todas las cuentas.
- Guarda la **MASTER_KEY** en un lugar seguro y fuera de Render/Cloudflare. Sin ella no se
  descifran las evidencias ni la base restaurada.
- Los datos personales que almacenes quedan bajo tu responsabilidad (Ley 1581 de 2012).

## Qué NO se pudo probar automáticamente (requiere tus credenciales reales)

El código de almacenamiento en R2 se probó contra un servidor simulado y la **firma S3
se validó contra el vector oficial de AWS** (es correcta). Pero la construcción de la
imagen Docker, Litestream y la conexión real a tu R2 **se validan al desplegar**, porque
necesitan tus credenciales. Si algún paso falla en Render, cópiame el registro (Logs) y
lo corrijo.

## Alternativas

- **deploy/render-privado-disco.yaml**: versión de pago (~7 USD/mes) con disco propio,
  sin R2 ni Litestream, siempre despierta. Cópielo como `render.yaml` para usarla.
- **deploy/render-demo.yaml**: versión gratuita de demostración (datos ficticios).
