# Limitaciones identificadas

## Funcionales (por diseño legal y ético)

1. **Operador telefónico:** no se determina. Con la portabilidad numérica el prefijo no indica el operador actual, y las consultas de portabilidad/HLR son servicios de operadores o proveedores con licencia (generalmente pagos). La plataforma enlaza al regulador del país para verificación manual.
2. **Titularidad del número:** no se obtiene. No existe una fuente pública legítima.
3. **Región geográfica:** solo para rangos con fuente pública cargada (indicativos fijos 60X de Colombia). Los móviles no tienen región.
4. **Ubicación:** únicamente la que una persona comparte voluntariamente desde su navegador. No hay rastreo por número ni seguimiento continuo.
5. **Búsqueda pública:** la plataforma no extrae resultados de buscadores (lo prohíben sus condiciones de uso). Usa la API pública de DuckDuckGo (resúmenes enciclopédicos; suele no tener datos sobre números) y genera enlaces de búsqueda que el analista revisa manualmente.

## Técnicas

6. **Dependencia de fuentes externas:** RDAP, crt.sh, Internet Archive y DuckDuckGo pueden estar lentas, limitar consultas (HTTP 429) o cambiar su formato. crt.sh en particular es inestable con dominios grandes. Las fallas se registran como "fallido".
7. **Fuentes no validadas contra respuestas reales en el entorno de desarrollo** (sin Internet). Ver Informe de pruebas §5.
8. **HTTPS para geolocalización:** los navegadores exigen HTTPS. En uso local (`http://127.0.0.1`) solo funciona en el mismo equipo. Para enviar enlaces a terceros hace falta un servidor con dominio y certificado (`PUBLIC_URL`).
9. **Correo electrónico:** no se envían correos (sin servidor SMTP). La recuperación de acceso se hace con enlaces generados por el administrador y entregados por un canal seguro.
10. **Base de datos SQLite:** adecuada para un equipo o servidor pequeño con pocos usuarios concurrentes. Para muchos usuarios simultáneos conviene migrar a PostgreSQL (ver Manual técnico §10).
11. **Copias de seguridad en memoria:** la copia se arma en memoria; con muchos gigabytes de evidencias conviene respaldar la carpeta `data/` con herramientas del sistema.
12. **`node:sqlite`:** módulo de Node marcado como experimental en la versión 22 (estable en la práctica; el aviso se suprime). Se requiere Node 22.13+.
13. **Teselas de mapa:** OpenStreetMap tiene una política de uso justo; para uso intensivo conviene un proveedor propio de teselas.
14. **Docker y lanzadores de Windows/macOS:** incluidos pero no ejecutados en el entorno de pruebas.
15. **Límite de tasa en memoria:** se reinicia al reiniciar el servidor y no se comparte entre varias instancias.
16. **Entorno de demostración:** se reinicia en cada arranque; los cambios de los visitantes no persisten.
