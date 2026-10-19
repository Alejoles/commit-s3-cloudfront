# Arquitectura

Un sitio estático en un bucket de S3 **privado**, publicado únicamente a través de CloudFront. Nadie puede leer el bucket directamente: solo la distribución, y solo con peticiones firmadas.

## Vista general

```mermaid
flowchart LR
    U([Usuario]) -- "HTTPS" --> CF

    subgraph Edge["Edge location más cercana"]
        CF["CloudFront<br/>caché + compresión"]
    end

    CF -- "Miss: petición firmada<br/>(SigV4 vía OAC)" --> S3[("S3 privado")]
    S3 -. "objeto" .-> CF
    CF -. "respuesta + x-cache, age, x-amz-cf-pop" .-> U
```

## Flujo de una petición

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant CF as CloudFront (edge)
    participant S3 as S3 (privado)

    U->>CF: GET http://dominio/
    CF-->>U: 301 → https://dominio/
    U->>CF: GET https://dominio/
    alt El objeto está en caché
        CF-->>U: 200 · x-cache: Hit from cloudfront · age: N
    else No está en caché (Miss)
        CF->>S3: GET /index.html (firmado con OAC)
        S3-->>CF: 200 + objeto
        CF-->>U: 200 · x-cache: Miss from cloudfront
    end
    U->>CF: GET /ruta-inexistente
    CF->>S3: GET /ruta-inexistente (firmado)
    S3-->>CF: 403 (sin permiso de listado)
    CF-->>U: 404 con el contenido de /404.html
```

## Componentes

### S3

- Bucket **privado** con *Block Public Access* activado en sus cuatro opciones.
- Sin *static website hosting*: ese endpoint exige acceso público y no admite OAC. CloudFront usa el endpoint **REST** (`<bucket>.s3.<región>.amazonaws.com`).
- Cifrado en reposo con SSE-S3 (AES-256).

### Origin Access Control (OAC)

CloudFront firma cada petición al origen con SigV4 (`Sign requests`). S3 la acepta solo si la política del bucket autoriza a esa distribución.

### Bucket policy

Concede `s3:GetObject` al servicio `cloudfront.amazonaws.com` con una condición sobre el ARN de **una** distribución concreta:

```json
{
  "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::<bucket>/*",
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::<cuenta>:distribution/<id>"
    }
  }
}
```

Sin esa condición, cualquier distribución de CloudFront de cualquier cuenta podría leer el bucket.

### CloudFront

| Ajuste | Valor |
|---|---|
| Origen | Endpoint REST del bucket, con *Origin path* vacío |
| Default root object | `index.html` |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Métodos permitidos | `GET`, `HEAD` |
| Compresión | Activada |
| Páginas de error | `403` y `404` → `/404.html`, con código `404` |

### Por qué 403 → 404

Si el bucket no concede `s3:ListBucket`, S3 responde `403` cuando falta un objeto, para no revelar qué claves existen. Sin la respuesta de error personalizada, el visitante vería el XML de `AccessDenied` en lugar de una página 404.

## Caché

- El TTL lo marcan los headers `cache-control` del objeto (`max-age` / `s-maxage`) dentro de los límites de la *cache policy*.
- `x-cache` indica el resultado: `Hit`, `Miss`, `RefreshHit` o `Error`.
- `age` son los segundos que lleva el objeto en la caché del edge.
- `x-amz-cf-pop` identifica el edge que respondió.
- Tras subir una versión nueva, invalida las rutas afectadas (`aws cloudfront create-invalidation`) o espera a que expire el TTL.

## Cómo la página lee todo esto

Un navegador no expone los headers del documento ya cargado. La página (`site/assets/js/app.js`) vuelve a pedir su propia URL, del mismo origen y con `cache: 'no-store'`, y lee los headers de esa respuesta. Por eso:

- La CSP puede ser `default-src 'self'`: no hay recursos externos.
- El valor de `x-cache` que muestra corresponde a **esa** petición, no a la primera carga.
- Abierta desde `file://`, la página no hace ninguna petición y muestra *SIN CLOUDFRONT*.

## Estructura del repositorio

```
site/        contenido que se sube a la raíz del bucket
docs/        documentación (este archivo)
```
