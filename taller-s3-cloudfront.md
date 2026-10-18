# Taller AWS: sitio estático con S3 + CloudFront (versión mejorada)

> **Cómo leer este documento:** el enunciado original aparece sin marca y no se modifica. Todo lo que añadí lleva **(extra)**. Los entregables oficiales de la academia no cambian; la evidencia adicional va en un anexo.

## Qué vas a construir

En este laboratorio vas a desplegar una página web estática en Amazon Web Services utilizando almacenamiento en Amazon S3 y distribución de contenido mediante Amazon CloudFront.

El objetivo es construir una arquitectura sencilla para servir contenido web estático a través de una CDN.

La arquitectura resultante será:

**Usuario → CloudFront → S3**

No es necesario utilizar un dominio personalizado; se utilizará la URL generada por CloudFront.

### Arquitectura ampliada (extra)

```text
Usuario
  │  HTTPS
  ▼
Edge location de CloudFront
  ├─ [Función viewer request]   (opcional, corre en cada petición)
  ├─ Caché  ── Hit ──────────────────────────┐
  │     └─ Miss                              │
  │         ▼                                │
  │   S3 privado (acceso solo vía OAC)       │
  │         │ respuesta + guardado en caché  │
  └─ [Función viewer response]  ◄────────────┘
  ▼
Usuario (recibe x-cache, age y los headers añadidos en el edge)
```

### Qué suma cada paso (extra)

| Paso | Enunciado original | (extra) Qué se suma |
| --- | --- | --- |
| 1. Página web | `index.html` mínima o una a elección | Una página de proyecto que muestra en vivo `x-cache`, `age` y el PoP |
| 2. Bucket S3 | Bucket seguro y con nombre único | Versionado, cifrado, sin hosting estático y por qué |
| 3. Subir archivos | Subir los archivos de la web | `Cache-Control` por tipo de archivo y prueba de que S3 no es accesible directo |
| 4. CloudFront | Distribución con S3 como origen | OAC, política del bucket, HTTPS, compresión, página de error |
| 5. Acceder | Abrir el Domain Name | Redirección HTTP→HTTPS y revisión de headers en DevTools |
| 6. Caché | (no existía) | Experimento Miss / Hit / Age e invalidaciones |
| 7. Edge | (no existía) | Una CloudFront Function que añade headers de seguridad |
| 8. SRE | (no existía) | Pruebas de seguridad, rollback con versionado y un SLI sencillo |
| 9. Costos | (no existía) | Estimación de costos con tus propios números |
| 10. Limpieza | (no existía) | Orden de eliminación sin costos ocultos |

### Antes de empezar (extra)

- Una región de trabajo para S3 (la que use tu laboratorio). CloudFront es global y no depende de esa región.
- Un repositorio público en GitHub para el proyecto (ver la sección *Para el CV y GitHub*).
- Terminal con `curl` y un navegador con DevTools (pestaña *Network*).
- Si tu rol de laboratorio bloquea algo (CloudFront Functions, métricas, logs), no es un fallo tuyo: anótalo en el anexo como limitación del entorno y sigue con lo demás.
- La página del proyecto y la función del edge están planificadas en un archivo aparte: `plan-implementacion-web-cloudfront.md`.

---

## PASO 1 – Crear la página web

En tu ordenador crea un archivo llamado:

`index.html`

Con el siguiente contenido (o sube una página web estática de tu elección, totalmente libre):

```html
<!DOCTYPE html>
<html>
<head>
<title>Laboratorio S3 + CloudFront</title>
</head>
<body>
<h1>Mi web estática en AWS</h1>
<p>Laboratorio funcionando correctamente.</p>
</body>
</html>
```

**(extra) Usa la página del proyecto.** El enunciado permite subir una página libre. La del proyecto muestra en la propia web si tu petición fue `Hit` o `Miss` de CloudFront, el PoP que respondió, la edad del objeto en caché y los headers de seguridad. Está especificada en `plan-implementacion-web-cloudfront.md`.

**(extra) Estrategia de depuración.** Si algo falla, sube primero la página mínima original. Si esa carga, la arquitectura (bucket, OAC, distribución) está bien y el problema está en la página nueva. Si no carga, el problema está en la infraestructura.

**(extra) Estructura de archivos esperada en el bucket:**

```text
index.html
404.html
assets/css/styles.css
assets/js/app.js
assets/img/favicon.svg
```

---

## PASO 2 – Crear un bucket S3

1. Accede al servicio S3 en la consola de AWS.
2. Crea un bucket nuevo.
3. El nombre del bucket debe ser único.
4. Mantén la configuración segura que has aprendido.

**(extra) Configuración recomendada:**

| Opción | Valor | Por qué |
| --- | --- | --- |
| Nombre | minúsculas, único globalmente (ejemplo: `lab-s3-cf-tuusuario-2026`) | Los nombres de bucket son únicos entre todas las cuentas |
| Object Ownership | ACLs deshabilitadas (*Bucket owner enforced*) | El acceso se controla solo con políticas |
| Block Public Access | **Las 4 casillas activadas** | El bucket nunca debe ser público; solo CloudFront lo lee |
| Cifrado por defecto | SSE-S3 | Cifrado en reposo sin costo extra |
| Bucket Versioning | Habilitado | Permite revertir un despliegue malo (Paso 8) |
| Static website hosting | **No lo actives** | Ese endpoint exige acceso público y no soporta OAC |
| Tags | `Project = lab-s3-cloudfront` | Identificar recursos al limpiar y al estimar costos |

---

## PASO 3 – Subir la página web

1. Accede al bucket creado.
2. Sube los archivos necesarios para tu página web.

**(extra) Metadatos de caché.** Al subir, en *Properties → Metadata* agrega `Cache-Control` según el tipo de archivo. Estos valores son para el laboratorio:

| Archivo | `Cache-Control` | Motivo |
| --- | --- | --- |
| `index.html` | `public, max-age=60` | Se vuelve a pedir al origen cada minuto, así puedes ver un `Miss` sin invalidar |
| `assets/*` | `public, max-age=86400` | Estáticos que cambian poco |

En producción se usan nombres con hash (por ejemplo `app.3f9a1c.js`) y TTL de un año, y solo el HTML tiene TTL corto.

**(extra) Comprueba el `Content-Type`.** Revisa en *Properties* que el `.css` sea `text/css`, el `.js` `text/javascript` y el `.svg` `image/svg+xml`. Si salen como `binary/octet-stream`, el navegador no los interpreta bien.

**(extra) Prueba que S3 no responde directo.** Abre la *Object URL* de `index.html`. Debe mostrar `AccessDenied`. Es lo correcto: el contenido solo debe llegar por CloudFront. Guarda la captura para el anexo.

---

## PASO 4 – Crear una distribución CloudFront

1. Accede al servicio CloudFront.
2. Crea una nueva distribución.
3. Configura S3 como origen tal como has aprendido.

**(extra) Configuración recomendada:**

| Campo | Valor |
| --- | --- |
| Origin domain | Tu bucket, elegido de la lista (endpoint REST `...s3.<región>.amazonaws.com`), **no** el endpoint de website |
| Origin access | **Origin access control (OAC)**: crea uno nuevo con *Sign requests* |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed HTTP methods | GET, HEAD |
| Cache policy | `CachingOptimized` (administrada) |
| Compress objects automatically | Yes |
| Default root object (en *Settings*) | `index.html` |
| Price class | Según tu estimación de costos (Paso 9) |
| WAF | Sin habilitar (tiene costo adicional) |
| Description | `lab-s3-cloudfront` |

**(extra) Política del bucket.** Con OAC, el bucket debe permitir la lectura solo al servicio CloudFront y solo para tu distribución. Según la versión de la consola, la política se actualiza sola o aparece un aviso con *Copy policy*. En ambos casos verifica en *S3 → Permissions → Bucket policy* que hay un permiso para el servicio `cloudfront.amazonaws.com` con una condición que referencia el ARN de tu distribución. Captura esa política para el anexo, tapando el ID de tu cuenta.

**(extra) Página de error personalizada.** Con OAC y sin permiso de listado, S3 devuelve `403` cuando un archivo no existe, y no `404`. En *Error pages* crea una respuesta personalizada para `403` y `404` que sirva `/404.html` con código `404`.

La distribución tarda unos minutos en pasar de *Deploying* a una fecha en *Last modified*. Espera a que termine antes de probar.

---

## PASO 5 – Acceder a la página

1. Copia el Domain Name de la distribución de CloudFront.
2. Abre esa URL en tu navegador.

Si todo está configurado correctamente, deberías ver la página web que subiste al bucket S3.

**(extra) Verifica con DevTools.** Abre *Network*, recarga la página y revisa los *Response Headers* del documento. Deben aparecer `x-cache`, `x-amz-cf-pop` y `via`. Prueba también `http://` en lugar de `https://`: debe redirigir a HTTPS.

---

## PASO 6 – Verificar la caché: Miss, Hit y Age (extra)

CloudFront añade en cada respuesta un header `x-cache` que te dice qué ocurrió con tu petición:

| Valor de `x-cache` | Significado |
| --- | --- |
| `Hit from cloudfront` | Lo sirvió la caché del edge, sin ir a S3 |
| `Miss from cloudfront` | No estaba en caché; CloudFront fue a S3 por él |
| `RefreshHit from cloudfront` | Estaba vencido y CloudFront lo revalidó con el origen |
| `Error from cloudfront` | La respuesta fue un error |

Otros headers útiles: `age` (segundos que lleva el objeto en caché), `x-amz-cf-pop` (la ubicación del edge que respondió) y `x-amz-cf-id` (identificador de la petición, útil para soporte).

**Experimento:**

1. Pide la URL desde la terminal varias veces seguidas, mostrando solo estos headers:

```bash
curl -sI https://TU-DISTRIBUCION.cloudfront.net/ | grep -iE 'x-cache|^age|x-amz-cf-pop'
```

2. Anota los resultados. No siempre ves el `Hit` en la segunda petición: puede tardar dos o tres intentos, porque diferentes cachés dentro de un mismo edge pueden atender tus peticiones.

| # | `x-cache` | `age` | `x-amz-cf-pop` | Tiempo |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

3. Espera más de 60 s (el `max-age` de tu HTML) y repite: verás un `Miss` o un `RefreshHit` y `age` volverá a empezar.
4. **Sin invalidar:** edita el `index.html` en S3 y súbelo. Verás que durante hasta 60 s CloudFront sigue sirviendo la versión anterior. Es lo que demuestra por qué existe el TTL.
5. **Invalidando:** en CloudFront → *Invalidations* crea una para `/index.html` (o `/*`) y repite la petición. Debe aparecer un `Miss` y el contenido nuevo.

Ojo: con la política `CachingOptimized`, los query strings **no** forman parte de la clave de caché. Pedir `/?x=1` no fuerza un `Miss`: devuelve el mismo objeto cacheado.

Cada mes hay una cuota gratuita de rutas de invalidación; verifica el valor vigente en la página de precios y no abuses de `/*`.

📸 **Anexo:** la tabla completa con tus números y una captura de DevTools o de la página del proyecto mostrando un `Hit` y un `Miss`.

---

## PASO 7 – Función en el edge: CloudFront Functions (extra)

Una **CloudFront Function** es un pequeño código JavaScript que corre en el edge, muy cerca del usuario, antes o después de la caché. Aquí vas a usar una para añadir headers de seguridad a todas las respuestas.

**Comparación con Lambda@Edge (para estudiar):**

| | CloudFront Functions | Lambda@Edge |
| --- | --- | --- |
| Eventos | Solo *viewer request* y *viewer response* | Viewer y origin (request y response) |
| Lenguaje | JavaScript (runtime propio) | Node.js, Python |
| Acceso a red o archivos | No | Sí |
| Duración | Muy corta (submilisegundo) | Mayor |
| Costo | Más barato | Más caro |
| Cuándo usarla | Reescrituras, redirecciones, headers | Lógica más pesada, llamadas externas |

**Cuándo corre cada evento (importante):** las funciones *viewer* corren en **cada** petición y respuesta, incluso en un `Hit`. Los eventos *origin* de Lambda@Edge corren solo cuando hay un `Miss`.

**Qué hace la función de este taller:** al responder al usuario añade los headers de seguridad definidos en el plan (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy`, entre otros) y un header propio, por ejemplo `x-edge-function`, para que la página del proyecto pueda mostrar que la función se ejecutó. La especificación (sin código) está en `plan-implementacion-web-cloudfront.md`; el código lo implementas tú en la carpeta `edge/` de tu repositorio.

**Pasos en la consola:**

1. CloudFront → *Functions* → *Create function*. Elige el runtime `cloudfront-js-2.0`.
2. Pega el código de la carpeta `edge/` de tu repositorio.
3. En la pestaña *Test*, usa un evento de tipo *viewer response* y comprueba que la salida trae los headers esperados.
4. Pulsa *Publish*. La función pasa de la etapa *Development* a *Live*.
5. En tu distribución → *Behaviors* → edita el comportamiento por defecto → *Function associations* → *Viewer response* → tu función.
6. Espera a que termine el *Deploying* y verifica:

```bash
curl -sI https://TU-DISTRIBUCION.cloudfront.net/ | grep -iE 'strict-transport|x-content-type|x-edge-function'
```

**Nota de criterio:** para añadir solo headers de seguridad, CloudFront también ofrece *response headers policies* administradas que no requieren código. Aquí usas una función para aprender el mecanismo; en un proyecto real elegirías la opción más simple que resuelva el problema.

**Opcional (extra):** una segunda función de tipo *viewer request* que reescriba `/carpeta/` a `/carpeta/index.html`. El *default root object* solo funciona en la raíz del sitio, así que esta reescritura es necesaria si tu web tiene subcarpetas.

📸 **Anexo:** la pestaña *Test* de la función, la asociación en el *Behavior* y la salida de `curl` con los headers.

---

## PASO 8 – Pruebas de seguridad y resiliencia (extra)

Completa esta lista y guarda la evidencia:

| Prueba | Cómo | Resultado esperado |
| --- | --- | --- |
| S3 no es público | Abrir la Object URL de S3 | `AccessDenied` |
| HTTP redirige a HTTPS | Abrir `http://` del dominio de CloudFront | Redirección 301 a `https://` |
| Ruta inexistente | Abrir `/no-existe` | Tu página `404.html` con código 404 |
| Método no permitido | Enviar un `POST` con `curl -X POST` | `403` de CloudFront |
| Compresión | `curl -sI -H "Accept-Encoding: br" URL/assets/css/styles.css` | `content-encoding: br` si el archivo supera 1 000 bytes |
| Headers del edge | `curl -sI URL` | Presentes los headers de la función |

La compresión de CloudFront solo se aplica a archivos de más de 1 000 bytes. La página mínima original es más pequeña, así que no saldrá comprimida.

**Rollback con versionado de S3:**

1. Sube una versión deliberadamente rota de `index.html`.
2. Crea una invalidación y comprueba que la web se ve rota.
3. En S3, activa *Show versions*, elige la versión buena y restáurala (descarga y vuelve a subir, o elimina la versión mala).
4. Invalida de nuevo y comprueba que la web se recupera.
5. Anota cuánto tardó cada fase. Ese es tu tiempo de recuperación.

**Mini SRE: un SLI para tu sitio.** Define un indicador de disponibilidad como `1 − (respuestas 5xx / total de respuestas)` y un objetivo de ejemplo, como 99,9 %. CloudFront publica en CloudWatch (región `us-east-1`) las métricas de peticiones y las tasas de error 4xx y 5xx. Revisa que tu rol permita verlas; la tasa de aciertos de caché (*cache hit rate*) está entre las métricas adicionales, que pueden tener costo y requieren activarlas.

---

## PASO 9 – Estimación de costos (extra)

No incluyo cifras porque los precios y los niveles gratuitos cambian, y AWS ha modificado recientemente cómo se cobra CloudFront. **Busca los valores vigentes tú mismo** en las páginas oficiales de precios de S3 y CloudFront y rellena esta tabla:

| Concepto | Qué se cobra | Dónde buscarlo | Tu dato |
| --- | --- | --- | --- |
| Almacenamiento S3 | GB por mes | Página de precios de S3 | |
| Peticiones a S3 | Por cada 1 000 GET/PUT (CloudFront solo va a S3 en un `Miss`) | Página de precios de S3 | |
| Transferencia S3 → CloudFront | Revisa si se cobra | Página de precios de S3 | |
| Transferencia CloudFront → Internet | GB, según región y *price class* | Página de precios de CloudFront | |
| Peticiones HTTP/HTTPS a CloudFront | Por cada 10 000 o por millón | Página de precios de CloudFront | |
| Invalidaciones | Rutas por encima de la cuota gratuita | Página de precios de CloudFront | |
| CloudFront Functions | Por millón de invocaciones | Página de precios de CloudFront | |
| Nivel gratuito | Qué incluye y si aplica a tu cuenta | Páginas de precios y *Free Tier* | |

**Método de cálculo (con un escenario inventado):**

1. Define el escenario, por ejemplo: 10 000 visitas al mes y 50 KB por visita.
2. Transferencia: 10 000 × 50 KB ≈ 0,5 GB al mes.
3. Peticiones: visitas × número de archivos por visita. Si una visita pide 4 archivos, son 40 000.
4. Peticiones a S3: solo los `Miss`. Con una tasa de aciertos alta, son una fracción muy pequeña del total.
5. Multiplica cada concepto por su precio unitario y suma.

Conclusión que debes poder justificar: para un sitio pequeño, el costo puede quedar dentro de los niveles gratuitos, pero **confírmalo con los precios vigentes**. Compara también cómo cambia el resultado con una *price class* más económica (menos edge locations) y con un sitio sin CDN.

---

## PASO 10 – Limpieza (extra)

Guarda primero tu evidencia. Elimina en este orden:

1. Quita la asociación de la función en el *Behavior* de la distribución.
2. *Disable* la distribución y espera a que termine el despliegue.
3. Elimina la distribución.
4. Elimina el OAC (CloudFront → *Origin access*).
5. Elimina la función de CloudFront.
6. Vacía el bucket con *Empty* y comprueba que no quedan versiones ni marcadores de eliminación.
7. Elimina el bucket.

Tu repositorio de GitHub se queda: es lo que conservas.

---

## 📦 Entregable

El estudiante deberá entregar:

1. La URL de CloudFront que permite acceder a la página web.
2. Una explicación breve (10–15 líneas) describiendo la arquitectura creada, incluyendo:
   * Qué papel cumple S3.
   * Qué función tiene CloudFront.
   * Cómo llega el contenido desde S3 hasta el usuario final.

### (extra) Guía para redactar la explicación

No la escribo por ti: redáctala con tus palabras y con tus propios datos del Paso 6.

| Punto | Ideas que debe incluir | Dato propio para citar |
| --- | --- | --- |
| Papel de S3 | Almacena los archivos como objetos. Es el origen. Es privado y solo CloudFront puede leerlo mediante OAC. | Tu prueba de `AccessDenied` en la URL directa |
| Función de CloudFront | CDN: guarda copias en edge locations cercanas al usuario. Reduce la latencia y la carga sobre S3. Fuerza HTTPS. | Tu tabla de `Miss` y `Hit` y el valor de `x-amz-cf-pop` |
| Camino del contenido | Usuario → edge más cercano → si hay `Hit`, responde desde la caché; si hay `Miss`, pide a S3 con una petición firmada por OAC, guarda la copia y responde. | Tu `age` y los tiempos medidos |
| La función del edge | Corre en cada respuesta y añade headers sin tocar el origen. | Tu salida de `curl` con los headers |

### (extra) Orden recomendado del PDF o ZIP

1. La URL de CloudFront.
2. La explicación de 10 a 15 líneas.
3. **Anexo:** evidencia del Paso 3 (S3 no accesible), política del bucket, tabla de caché, función del edge, pruebas del Paso 8 y estimación de costos.

---

## Para el CV y GitHub (extra)

Este taller sirve para el CV si queda documentado y reproducible. Presenta el proyecto en la sección *Proyectos*, no en *Experiencia*, y apóyalo en tus mediciones.

### Estructura del repositorio

```text
lab-s3-cloudfront/
├── site/            # La web: index.html, 404.html, assets/
├── edge/            # La CloudFront Function y su evento de prueba
├── docs/            # Diagrama de arquitectura y capturas
└── README.md
```

### README recomendado

1. **Qué es:** una frase con la arquitectura.
2. **Diagrama.**
3. **Decisiones de diseño:** por qué OAC y no OAI, por qué no hosting estático de S3, por qué `Cache-Control` distinto por archivo, por qué una función en el edge.
4. **Cómo se despliega:** los pasos resumidos.
5. **Resultados:** tu tabla de `Miss` / `Hit`, las pruebas del Paso 8 y la estimación de costos.
6. **Limitaciones y mejoras.**
7. **Limpieza.**

Antes de publicar capturas, tapa el ID de tu cuenta de AWS y no subas claves.

### Cómo escribirlo en el CV

- *Desplegué un sitio estático en AWS con S3 privado detrás de CloudFront mediante Origin Access Control, con HTTPS obligatorio, compresión y página de error personalizada.*
- *Implementé una CloudFront Function para añadir headers de seguridad en el edge, y validé el comportamiento de la caché (Hit/Miss, TTL e invalidaciones) midiendo cada caso.*

Añade una cifra solo cuando la tengas medida (por ejemplo, la diferencia de tiempo entre `Miss` y `Hit`).

### Mejoras para llevarlo más lejos (opcionales, fuera del taller)

| Mejora | Qué demuestra | Ojo |
| --- | --- | --- |
| Reconstruirlo con Terraform | Infraestructura como código | La mejora con más valor para un perfil DevOps |
| Despliegue con GitHub Actions (sync a S3 + invalidación) usando OIDC | CI/CD sin claves de larga duración | Requiere un rol de IAM con confianza en GitHub |
| Dominio propio + ACM + Route 53 | Certificados y DNS | El certificado para CloudFront debe crearse en `us-east-1` |
| Logs de acceso + consulta con Athena | Observabilidad | Genera almacenamiento y consultas con costo |
| AWS WAF | Protección en el edge | Tiene costo mensual |
| Alarma sobre la tasa de errores 5xx | Alertas de SRE | Requiere permisos en CloudWatch |

---

## Estudio y troubleshooting (extra)

### Preguntas para responder con tus palabras

| Pregunta | Pista para investigar |
| --- | --- |
| ¿Qué es una edge location y qué es una regional edge cache? | Capas de caché de CloudFront |
| ¿Por qué OAC reemplaza a OAI? | Origin Access Identity (legado) y Origin Access Control |
| ¿Por qué el endpoint de website de S3 no funciona con OAC? | Endpoint REST vs endpoint de website |
| ¿Qué diferencia hay entre invalidar y versionar los archivos? | Nombres con hash y TTL largo |
| ¿Qué es la clave de caché y qué cambia con una cache policy distinta? | Cache key, query strings, headers, cookies |
| ¿Cuándo usarías una CloudFront Function y cuándo Lambda@Edge? | Eventos viewer y origin |
| ¿Por qué S3 devuelve 403 y no 404 con un archivo inexistente? | Permiso `s3:ListBucket` |
| ¿Qué es un *origin group* y para qué sirve? | Conmutación por error entre orígenes |

### Temas relacionados con el examen SAA-C03

- CloudFront con S3 y OAC, y con ALB como origen.
- Políticas de caché, TTL y comportamientos (*behaviors*) por ruta.
- Signed URLs y signed cookies para contenido privado.
- Geo restriction y AWS WAF en CloudFront.
- HTTPS con ACM y por qué el certificado va en `us-east-1`.
- Origin groups (alta disponibilidad del origen).

### Troubleshooting

| Síntoma | Causa probable | Qué revisar |
| --- | --- | --- |
| `AccessDenied` al abrir la URL de CloudFront | La política del bucket no autoriza a la distribución, o falta el OAC | S3 → Permissions → Bucket policy y el origen de la distribución |
| `AccessDenied` solo en la raíz `/` | Falta el *Default root object* | Settings de la distribución: `index.html` |
| Error XML de S3 con un 403 en un archivo concreto | El archivo no existe o está en otra carpeta | Que el objeto exista con esa clave exacta |
| Ves la versión vieja de la página | Está en caché | Espera el TTL o crea una invalidación |
| El navegador no aplica los estilos | `Content-Type` incorrecto | Metadatos del objeto en S3 |
| Con el endpoint de website, CloudFront funciona solo si el bucket es público | Origen mal elegido | Cambia al endpoint REST y usa OAC |
| La función no aparece en las respuestas | No está publicada (*Live*) o no está asociada al evento correcto | Etapa de la función y *Function associations* |
| La consola dice *Deploying* mucho tiempo | Propagación en curso | Espera unos minutos antes de probar |
| El navegador bloquea tus scripts tras añadir la función | La `Content-Security-Policy` es demasiado estricta para tu página | Pestaña *Console* de DevTools y la política definida en el plan |
