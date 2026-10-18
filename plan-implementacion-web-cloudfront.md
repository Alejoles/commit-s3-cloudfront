# Plan de implementación: web y función edge del laboratorio S3 + CloudFront

> Documento de planificación para que un agente (o tú) implemente. **No contiene código** a propósito: define qué construir, cómo debe comportarse y cómo se acepta el resultado.

## 1. Objetivo

Construir una página web estática que, al abrirse desde CloudFront, **muestre en vivo cómo se comportó la caché** con la propia petición, y una **CloudFront Function** pequeña que añada headers de seguridad. Debe verse cuidada, funcionar de verdad y servir como pieza de portafolio para un perfil DevOps / SRE.

La web se aloja en un bucket S3 privado servido por CloudFront (OAC), según el taller `taller-s3-cloudfront.md`.

## 2. Restricciones técnicas

- **Stack:** HTML, CSS y JavaScript sin frameworks y sin paso de compilación.
- **Cero dependencias externas:** sin CDNs, sin fuentes remotas, sin analíticas, sin peticiones a otros dominios. Todo se sirve desde el mismo origen. Esto es obligatorio porque la función del edge añadirá una `Content-Security-Policy` estricta.
- **Sin scripts ni estilos en línea:** el CSS y el JS van en archivos propios (la política no debe necesitar `unsafe-inline`).
- **Ligera:** el conjunto de archivos debe ser pequeño y cargar rápido.
- **Funciona en local:** abierta desde el disco (`file://`) no debe romperse; debe mostrar un estado claro de "no estás detrás de CloudFront".
- **Sin secretos ni datos de cuenta:** nada con IDs de AWS ni dominios fijos. La página lee su propia URL con JavaScript.
- Navegadores modernos (últimas versiones de Chrome, Firefox, Safari y Edge).

## 3. Estructura de archivos propuesta

```text
lab-s3-cloudfront/
├── site/
│   ├── index.html
│   ├── 404.html
│   └── assets/
│       ├── css/styles.css
│       ├── js/app.js
│       └── img/favicon.svg
├── edge/
│   ├── viewer-response.js          # función principal
│   ├── viewer-response.test.json   # evento de prueba para la consola
│   └── viewer-request-rewrite.js   # opcional
├── docs/
│   ├── architecture.md             # diagrama y explicación
│   └── evidence/                   # capturas (sin ID de cuenta)
├── README.md
└── .gitignore
```

## 4. La página: secciones y contenido

Una sola página, en español, con estas secciones en orden:

1. **Cabecera.** Título del proyecto ("S3 + CloudFront: estático, privado y en el edge"), subtítulo corto y un indicador general del estado de esta visita (ver sección 5).
2. **Panel "Esta petición".** Muestra grande el resultado de `x-cache`: **HIT**, **MISS**, **REFRESH HIT**, **ERROR** o **SIN CLOUDFRONT**. Debajo, en lenguaje claro, una frase que explique qué significa (ejemplo: "CloudFront respondió desde su caché; S3 no fue consultado").
3. **Diagrama del camino.** Un esquema SVG en línea (Usuario → Edge → Caché → S3). Según el resultado, se resalta el camino real: en un Hit el tramo hacia S3 aparece atenuado; en un Miss se ilumina completo. Con animación sutil.
4. **Tabla de headers.** Lista de headers de la respuesta, en tipografía monoespaciada, con los relevantes destacados: `x-cache`, `age`, `x-amz-cf-pop`, `x-amz-cf-id`, `via`, `server`, `content-type`, `content-encoding`, `cache-control`, `etag`, `last-modified`. Cada uno con una descripción corta al pasar el cursor o al enfocarlo.
5. **Panel de caché.** Edad del objeto y tiempo para que venza, calculado con `age` y el `max-age` de `cache-control`, como barra de progreso. Texto del tipo "Vence en 42 s; después verás un Miss o un Refresh Hit".
6. **Experimento.** Un botón "Probar 5 veces" que lanza 5 peticiones seguidas al mismo documento y las lista en una tabla: número, `x-cache`, `age`, PoP y tiempo en ms. Un resumen debajo: cuántos Hit, cuántos Miss y el promedio de cada grupo. Un mini gráfico (SVG en línea, sin librerías) de los tiempos.
7. **Checklist de seguridad.** Filas con ✔ o ✘ según estén presentes los headers que debe añadir la función del edge (ver sección 8), y un indicador de si la página se sirvió por HTTPS.
8. **Qué es esto.** Texto breve sobre el laboratorio, el enlace al repositorio y a la sección de arquitectura, y la nota de que la página lee sus propios headers.
9. **Pie.** Año, nombre del autor, enlace al repo y a tu sitio personal.

La página `404.html` mantiene el mismo estilo, con un mensaje claro, el código 404 y un enlace para volver al inicio.

## 5. Lógica y comportamiento

**Cómo obtener los headers.** JavaScript no puede leer los headers del documento que ya cargó. La solución es que la página haga una **petición adicional a su propia URL** (mismo origen) y lea los headers de esa respuesta. Al ser mismo origen, todos los headers son legibles.

Reglas para esa petición:

- Debe **saltarse la caché del navegador** para que llegue de verdad a CloudFront.
- Usar el método `HEAD` si el comportamiento lo permite; si no, `GET`.
- Medir el tiempo con la API de rendimiento del navegador.
- Sin cookies ni credenciales.

**Estados a manejar:**

| Condición | Estado mostrado | Mensaje |
| --- | --- | --- |
| `x-cache` empieza por "Hit" | HIT | Respondió la caché del edge |
| `x-cache` empieza por "Miss" | MISS | CloudFront consultó S3 |
| `x-cache` empieza por "RefreshHit" | REFRESH HIT | La copia venció y se revalidó con el origen |
| `x-cache` empieza por "Error" | ERROR | Respuesta de error |
| No existe `x-cache` | SIN CLOUDFRONT | Estás en local o fuera de CloudFront |
| La petición falla | SIN CONEXIÓN | No se pudo consultar los headers |

**Detalles de comportamiento:**

- Si falta un header, mostrar un guion y no romper nada.
- El PoP (`x-amz-cf-pop`) se muestra tal cual. Opcional: traducir el código de aeropuerto de las primeras letras a una ciudad con una tabla pequeña incluida en el JS. El agente debe verificar cada código contra la documentación de AWS antes de incluirlo y omitir los que no pueda confirmar.
- Tiempos: si la primera petición es un Miss y la siguiente un Hit, mostrar la diferencia en ms sin afirmar causalidad exacta (puede haber ruido de red).
- Actualización automática: un interruptor "Refrescar cada N segundos" apagado por defecto.
- Los resultados se anuncian en una región `aria-live` para lectores de pantalla.

## 6. Diseño visual

- **Estética:** consola de operaciones oscura ("NOC"), limpia y densa en información pero respirable.
- **Paleta:** fondo azul marino oscuro (coherente con `#232F3E`), acento naranja (`#FF9900`), texto claro. Colores de estado: verde para HIT, ámbar para MISS, azul para REFRESH HIT, rojo para ERROR, gris para SIN CLOUDFRONT. No depender solo del color: acompañarlo de texto e icono.
- **Tema claro/oscuro:** oscuro por defecto, con variante clara según `prefers-color-scheme`.
- **Tipografía:** pila de fuentes del sistema para el texto y pila monoespaciada del sistema para headers y valores. Sin fuentes remotas.
- **Diseño responsive:** correcto desde 360 px de ancho; las tablas con scroll horizontal dentro de su contenedor, sin desbordar el cuerpo.
- **Animaciones:** sutiles (el trazo del camino en el diagrama, un pulso en el badge). Respetar `prefers-reduced-motion`.
- **Accesibilidad:** contraste suficiente, foco visible, navegación completa por teclado, etiquetas semánticas y texto alternativo en el SVG.
- **Icono:** un favicon SVG sencillo, en línea con la paleta.

## 7. Caché y metadatos de los archivos

Para que el experimento funcione, documentar en el README los metadatos que se asignan al subir a S3:

| Archivo | `Cache-Control` | `Content-Type` |
| --- | --- | --- |
| `index.html`, `404.html` | `public, max-age=60` | `text/html; charset=utf-8` |
| `assets/css/*` | `public, max-age=86400` | `text/css` |
| `assets/js/*` | `public, max-age=86400` | `text/javascript` |
| `assets/img/*.svg` | `public, max-age=86400` | `image/svg+xml` |

Además, explicar en el README que el valor corto es solo para el laboratorio y qué se haría en producción (nombres con hash y TTL largo).

## 8. Especificación de la función del edge

**Tipo:** CloudFront Function, runtime `cloudfront-js-2.0`.
**Evento:** *viewer response*, asociada al comportamiento por defecto.
**Restricciones:** sin llamadas de red, sin dependencias, código mínimo y legible, con comentarios explicativos en español.

**Qué debe hacer:** tomar la respuesta que va hacia el usuario y añadir estos headers, sin modificar el cuerpo ni el código de estado:

| Header | Valor esperado (descrito) |
| --- | --- |
| `strict-transport-security` | Un año de duración, incluyendo subdominios |
| `x-content-type-options` | `nosniff` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | Desactivar cámara, micrófono y geolocalización |
| `content-security-policy` | Solo recursos del mismo origen para scripts, estilos, imágenes y conexiones; `frame-ancestors` en `'none'`; sin `unsafe-inline` |
| `x-edge-function` | Un identificador legible, por ejemplo `viewer-response/security-headers` |

**Reglas:**

- No sobrescribir un header que ya exista con un valor que el origen haya definido a propósito, salvo `x-edge-function`.
- La política de contenido debe permitir exactamente lo que la página necesita (su propio CSS, JS e imágenes) y nada externo. El agente debe comprobarlo con la consola del navegador: no puede haber violaciones.
- Entregar también `viewer-response.test.json`, un evento de ejemplo para la pestaña *Test* de la consola, y la salida esperada documentada en el README.

**Función opcional (viewer request):** si una URL termina en `/`, reescribir la ruta añadiendo `index.html`. Documentar que es necesaria para sitios con subcarpetas y que el *default root object* solo cubre la raíz.

**Nota para el README:** explicar la alternativa de las *response headers policies* administradas y por qué se eligió una función igualmente (aprendizaje del mecanismo).

## 9. README del repositorio

Debe incluir, en este orden: qué es el proyecto, diagrama de arquitectura, decisiones de diseño (OAC frente a OAI, endpoint REST frente a website, `Cache-Control` por archivo, función en el edge), cómo se despliega paso a paso con enlace al taller, cómo probar localmente, resultados medidos (tabla de Miss / Hit, pruebas de seguridad), estimación de costos, limitaciones, mejoras futuras y limpieza. Tono técnico y directo, extensión moderada, sin capturas con IDs de cuenta.

## 10. Criterios de aceptación

**Funcionales**

- [ ] Abierta desde CloudFront, la página muestra el estado correcto (HIT, MISS o REFRESH HIT) de su propia petición.
- [ ] El botón "Probar 5 veces" genera la tabla, el resumen y el gráfico.
- [ ] Tras vencer el `max-age`, se observa un Miss o Refresh Hit y la barra de edad se reinicia.
- [ ] Abierta desde `file://`, muestra "SIN CLOUDFRONT" sin errores en consola.
- [ ] Con la función asociada, el checklist de seguridad muestra todos los headers en verde.
- [ ] `404.html` se sirve con código 404 para rutas inexistentes.

**Calidad**

- [ ] Sin errores ni avisos en la consola del navegador, incluida la política de contenido.
- [ ] Ninguna petición sale a otro dominio (verificar en la pestaña *Network*).
- [ ] Sin `localStorage`, cookies ni analíticas.
- [ ] Responsive desde 360 px, sin scroll horizontal del cuerpo.
- [ ] Navegable por teclado y con contraste suficiente (objetivo: accesibilidad de Lighthouse de 90 o más).
- [ ] Respeta `prefers-reduced-motion` y `prefers-color-scheme`.

**Entrega**

- [ ] Estructura de carpetas según la sección 3.
- [ ] README completo según la sección 9.
- [ ] Sin secretos, IDs de cuenta ni dominios fijos en el repositorio.

## 11. Verificación manual sugerida

1. Abrir la página local y comprobar el estado "SIN CLOUDFRONT".
2. Subir a S3 con los metadatos de la sección 7.
3. Abrir el dominio de CloudFront y comprobar la secuencia Miss → Hit.
4. Esperar el vencimiento y comprobar el nuevo Miss o Refresh Hit.
5. Asociar la función y comprobar el checklist de seguridad en verde.
6. Revisar la pestaña *Network* para confirmar que no hay peticiones externas.
7. Probar a 360 px, con teclado y con tema claro y oscuro.

## 12. Fuera de alcance

- Frameworks, bundlers, bibliotecas de gráficos o de iconos.
- Backend, bases de datos o APIs propias.
- Dominio personalizado y WAF.
- Cualquier cambio en los pasos y entregables oficiales de la academia.

## 13. Resumen de instrucciones para el agente

Implementa la estructura de la sección 3. Escribe una web estática sin dependencias que consulte los headers de su propia URL y los presente con el diseño de la sección 6, siguiendo los estados de la sección 5. Escribe la función del edge de la sección 8 con comentarios en español y su evento de prueba. Redacta el README de la sección 9. Valida cada criterio de la sección 10 y, si algún punto de este plan es ambiguo o contradictorio con lo que observes, **pregunta antes de improvisar**.
