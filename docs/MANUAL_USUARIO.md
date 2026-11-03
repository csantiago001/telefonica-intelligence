# Manual de usuario — Telefónica Intelligence

## 1. Acceso

1. Abra la aplicación (doble clic en `iniciar.bat` / `iniciar.command` / `iniciar.sh`). El navegador mostrará la pantalla de inicio de sesión.
2. **Primer uso:** aparece el asistente *Configuración inicial*. Escriba el nombre de su organización, su nombre, un usuario y una contraseña (mínimo 10 caracteres con letras y números). Esa cuenta será la de **administrador**.
3. **Ingreso normal:** usuario y contraseña. Si activó la verificación en dos pasos, se pedirá además el código de 6 dígitos de su aplicación de autenticación (o un código de recuperación).
4. Tras **5 intentos fallidos** la cuenta se bloquea 15 minutos (valores configurables).
5. **¿Olvidó la contraseña?** Pida al administrador un *enlace de restablecimiento* (Usuarios y roles → icono de enlace). Es de un solo uso y vence en 24 horas.
6. La sesión se cierra sola tras 60 minutos de inactividad o 8 horas en total.

## 2. Navegación

- **Panel lateral** (en el móvil, botón ☰): módulos disponibles según su rol.
- **Buscador superior:** encuentra expedientes, números asociados, evidencias (incluso por hash) y hallazgos.
- **Campana:** alertas (ubicaciones recibidas, consentimientos revocados, bloqueos de cuentas, integridad comprometida).
- **Menú de usuario:** perfil, seguridad y cierre de sesión.
- **Saldo de créditos:** en la parte inferior del panel lateral.

## 3. Dashboard

Muestra expedientes activos y cerrados, consultas realizadas, créditos, evidencias, enlaces vigentes, gráficos de actividad (30 días), expedientes por estado y clasificación, confiabilidad de hallazgos, alertas, actividad reciente y accesos rápidos. Las tarjetas con enlace llevan al listado filtrado.

## 4. Análisis telefónico

1. Escriba el número en cualquier formato (`+57 300 123 4567`, `3001234567`, `0057…`, con guiones o paréntesis).
2. Elija el **país predeterminado** (se usa si el número no trae prefijo internacional).
3. Opcional: asocie la consulta a un **expediente** y marque "Asociar los números válidos al expediente".
4. Pulse **Analizar**.

**Por lote:** pestaña *Por lote*, un número por línea (máximo 50).

Cada dato muestra su **fuente** y su **nivel**:

| Nivel | Significado |
|---|---|
| Confirmado | Derivado directamente del plan de numeración público |
| Probable | Inferencia razonable (p. ej. el tipo de línea, que puede cambiar con la portabilidad) |
| No verificado | Sin confirmación |
| No disponible | No existe una fuente legítima para ese dato |

El **operador** siempre aparece como *No determinado*: con la portabilidad numérica no puede deducirse del prefijo. Se ofrece el enlace al regulador del país para verificarlo. La **región** solo se muestra cuando hay una fuente pública (por ejemplo, indicativos fijos 60X de Colombia).

**Exportar:** botón *JSON* en el resultado; *Exportar CSV* en el historial. Haga clic en una fila del historial para ver el detalle.

## 5. OSINT (fuentes abiertas)

1. Elija una herramienta:
   - **Registros DNS** (dominio): A, AAAA, MX, NS, TXT, SOA, CAA, SPF y DMARC.
   - **Registro de dominio (RDAP/WHOIS)**: registrador, fechas de alta/expiración, estado, DNSSEC.
   - **Certificados y subdominios**: nombres de host observados en certificados públicos.
   - **Historial web**: capturas en Internet Archive.
   - **Verificación de enlace**: estado HTTP, redirecciones, certificado TLS, título, metadatos y cabeceras de seguridad.
   - **Dirección IP**: red, país, organización y DNS inverso.
   - **Búsqueda pública**: resumen de DuckDuckGo y enlaces de búsqueda asistida (usted los abre y revisa).
2. Escriba el objetivo, opcionalmente asócielo a un expediente, y pulse **Consultar**.
3. El resultado indica **fuente, fecha y hora, duración** y estado: *Éxito*, *Sin resultados*, *Parcial* o *Fallido*.
4. Si la fuente no responde, la consulta queda como **Fallida**: no se muestra ningún dato como obtenido y **no se cobran créditos**.
5. Use **Guardar** en los *Hallazgos sugeridos* o **Registrar hallazgo** para documentar lo relevante, eligiendo la confiabilidad.

## 6. Hallazgos

Listado de todos los hallazgos con filtro por confiabilidad. Cada hallazgo exige **fuente**; la URL es opcional. Puede editarse (el cambio de confiabilidad queda en el historial del expediente) o eliminarse.

## 7. Ubicación con consentimiento

> La plataforma **no** localiza teléfonos. Solo recibe la ubicación que una persona decide compartir.

1. **Nuevo enlace:** indique destinatario, finalidad (la verá la persona), vigencia y expediente. Confirme la casilla de finalidad legítima.
2. Copie el enlace y envíelo por un canal de confianza. **Solo se muestra una vez.**
3. La persona abre el enlace, lee el texto de consentimiento, marca la casilla de aceptación y pulsa *Compartir mi ubicación*. Su navegador le pedirá permiso; puede negarlo.
4. Usted recibe una alerta. En el detalle del enlace verá el **mapa**, las coordenadas, la precisión, la fecha y el **registro de autorización** (fecha, navegador, huella de IP y texto aceptado).
5. **Revocar:** usted puede revocar el enlace o eliminar los datos. La persona también puede *Revocar y eliminar mis datos* desde el mismo enlace.

**Importante:** los navegadores solo permiten compartir ubicación en conexiones **HTTPS**. Para enviar enlaces a personas fuera de su equipo, el administrador debe publicar la aplicación con HTTPS y configurar `PUBLIC_URL` (ver Manual técnico).

## 8. Expedientes

- **Nuevo expediente:** título, clasificación, prioridad, responsable, objetivo, descripción y etiquetas. Se asigna un código `TI-AAAA-NNNN`.
- **Pestañas del expediente:** Resumen, Personas y entidades, Teléfonos, Observaciones, Evidencias, Hallazgos, Consultas, Ubicación, Informes e **Historial** (registro cronológico de todas las acciones).
- **Cambiar estado:** Abierto, En curso, Suspendido, Cerrado, Archivado. Se pide un motivo. Un expediente *archivado* queda en solo lectura.
- **Buscar y filtrar:** por texto (código, título, número asociado, persona, etiqueta), estado, clasificación, prioridad y orden. Exportación CSV.
- **Eliminar** (solo administradores): debe escribir el código exacto. Los archivos de evidencia se borran de forma segura.

## 9. Evidencias

1. **Cargar evidencia:** arrastre el archivo o selecciónelo. El navegador calcula el SHA-256 y el servidor lo vuelve a calcular; si no coinciden se le avisa.
2. Indique título, origen, fecha de obtención, detalle del origen (quién la aportó, de dónde) y expediente.
3. El archivo se guarda **cifrado**. La ficha muestra hash, metadatos extraídos (EXIF de imágenes, propiedades de PDF, firma del archivo) y la **cadena de custodia** (incorporación, verificaciones, descargas, modificaciones, eliminación con usuario, IP y fecha).
4. **Verificar integridad:** recalcula el SHA-256. Si no coincide, se genera una alerta crítica y se bloquea la descarga.
5. **Descargar:** solo usuarios autorizados; queda registrado.
6. **Eliminar:** exige un motivo; el archivo se sobrescribe y borra, y se conserva el registro y el hash.
7. **Inventario:** botón *Inventario CSV* (general o por expediente).

## 10. Informes

1. **Generar informe** (desde Informes o desde un expediente).
2. El asistente propone título, resumen y limitaciones a partir de los datos. Complete objetivo, observaciones y **conclusiones**.
3. Se genera un PDF con: identidad de la plataforma, número de informe y expediente, fecha, resumen ejecutivo, objetivo, entidades y números, consultas realizadas, resultados con confiabilidad, ubicaciones consentidas, fuentes consultadas, evidencias, observaciones, limitaciones, conclusiones y **registro de integridad** (SHA-256 de cada evidencia).
4. Se registra el SHA-256 del propio PDF. Use el icono de ojo para verlo o *PDF* para descargarlo.

## 11. Créditos

Cada operación consume créditos (análisis, consultas OSINT, informes, enlaces). Verá su saldo, consumo por operación e historial. Los administradores pueden **asignar o descontar** créditos (con motivo), ver saldos de todos y **configurar costos**. No se procesan pagos.

## 12. Usuarios y roles (administradores)

- **Usuarios:** crear (con contraseña temporal y cambio obligatorio), editar, activar/desactivar, cambiar rol, generar enlace de restablecimiento, desactivar 2FA, cerrar sesiones.
- **Roles:** Administrador, Analista y Consultor (solo lectura) predefinidos. Puede crear roles personalizados marcando permisos.

## 13. Configuración

- **Perfil y preferencias:** nombre, correo, registros por página, país predeterminado, vista compacta, reducir animaciones.
- **Seguridad:** cambiar contraseña, activar **2FA** (escanee el QR y guarde los 8 códigos de recuperación), ver y cerrar sesiones abiertas.
- **Parámetros del sistema** (admin): organización, duración de sesión, inactividad, intentos y bloqueo, longitud de contraseña, vigencia de enlaces.
- **Fuentes** (admin): activar/desactivar cada fuente OSINT.
- **Retención y copias** (admin): plazos de conservación por tipo de dato, purga manual, copias automáticas diarias, crear/verificar/descargar/eliminar copias.
- **Información:** versión, tamaño de datos, última copia.

## 14. Auditoría

Registro de todas las operaciones (quién, qué, cuándo, desde qué IP, severidad) con filtros por texto, severidad y fechas, detalle y exportación CSV.
