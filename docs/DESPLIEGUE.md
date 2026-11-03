# Publicar la plataforma en Internet (acceso desde cualquier dispositivo)

Telefónica Intelligence tiene servidor, base de datos y archivos cifrados. Por eso,
a diferencia de una página estática, necesita un alojamiento que **ejecute Node.js**
y **guarde datos de forma permanente**. Estas son las opciones.

## Resumen de opciones

| Opción | Acceso desde cualquier dispositivo | Datos permanentes | Costo | Para qué sirve |
|---|---|---|---|---|
| **A. Local con túnel** (`iniciar-publico.bat`) | Sí, mientras su PC esté encendida | Sí (en su PC) | Gratis | Uso real sin servidor; la dirección cambia al reiniciar |
| **B. Demo en Render** | Sí, siempre | **No** (se borran al reiniciar) | Gratis | Mostrar la plataforma con datos ficticios |
| **C. Privado en Render** | Sí, siempre | Sí (disco persistente) | De pago (~7 USD/mes) | Uso real permanente, como un sitio web normal |
| **D. Servidor propio (VPS)** | Sí, siempre | Sí | De pago (~4–6 USD/mes) | Máximo control; requiere conocimientos técnicos |

> Igual que "toxicofit" vive en un servidor y no en su computador, para no depender de
> su PC necesita la opción **C** o **D**. La diferencia de precio con una página normal
> es que aquí se guardan datos (base de datos y evidencias), y eso requiere un plan con
> disco permanente.

## Opción C — Privado en Render (recomendada para uso real)

Paso a paso (lo hace usted con su cuenta; yo no puedo contratar servicios):

1. Cree una cuenta en <https://render.com> (puede entrar con GitHub).
2. En el proyecto, copie `deploy/render-privado.yaml` a la raíz con el nombre
   `render.yaml` (reemplaza al de demostración). Si no sabe hacerlo, dígame y se lo dejo listo.
3. En Render: **New → Blueprint** y elija el repositorio `telefonica-intelligence`.
4. Render le pedirá **MASTER_KEY**: pegue la misma de su `.env` local (o genere una
   nueva de 64 caracteres hexadecimales y **guárdela**; sin ella no se descifran los datos).
5. Aplique. La primera compilación tarda unos minutos.
6. Render le dará una URL `https://telefonica-intelligence-xxxx.onrender.com`.
   Cópiela y póngala en la variable `PUBLIC_URL` del servicio (para que los enlaces
   de ubicación usen esa dirección).
7. Abra la URL desde cualquier dispositivo y cree su usuario administrador.

Costo: el plan `starter` con disco de 1 GB. Consulte el precio vigente en Render antes
de aplicar. El plan gratuito **no** sirve para datos reales porque los borra en cada reinicio.

## Opción D — Servidor propio (VPS)

Para quien quiere control total y menor costo mensual. Resumen (detalle en el Manual técnico §5):

1. Contrate un VPS pequeño (p. ej. Hetzner CX22 o DigitalOcean, con Ubuntu).
2. Instale Node.js 22, clone el repositorio, cree el `.env` y ejecute `npm run setup`.
3. Ponga un proxy inverso con HTTPS (Caddy da certificado automático) apuntando a un
   dominio suyo, y configure la app como servicio (systemd) para que arranque sola.
4. Resultado: una dirección fija `https://su-dominio.com`, siempre disponible.

Puedo dejarle los comandos exactos cuando elija el proveedor.

## Protección de datos (importante en C y D)

Al poner la plataforma en Internet, usted se vuelve responsable de los datos personales
que almacene. Recomendaciones mínimas:

- Active la **verificación en dos pasos** para todas las cuentas.
- Guarde la **MASTER_KEY** en un lugar seguro y fuera del servidor.
- Haga **copias de seguridad** periódicas (se descargan desde Configuración) y guárdelas aparte.
- Use solo fuentes públicas y el consentimiento informado, como exige la plataforma.
