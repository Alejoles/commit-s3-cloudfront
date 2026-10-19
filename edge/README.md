# Función del edge

CloudFront Function que añade headers de seguridad a cada respuesta. Código en [`viewer-response.js`](viewer-response.js), comentado línea a línea.

| | |
|---|---|
| Runtime | `cloudfront-js-2.0` |
| Evento | *Viewer response* |
| Asociación | Comportamiento por defecto (`*`) |

## Headers que añade

| Header | Valor | Para qué |
|---|---|---|
| `strict-transport-security` | `max-age=31536000; includeSubDomains` | Obliga a usar HTTPS durante un año |
| `x-content-type-options` | `nosniff` | El navegador no adivina el tipo de archivo |
| `x-frame-options` | `DENY` | Nadie puede incrustar la página en un `<iframe>` |
| `referrer-policy` | `strict-origin-when-cross-origin` | No filtra la ruta completa a otros sitios |
| `permissions-policy` | `camera=(), microphone=(), geolocation=()` | Desactiva APIs que no se usan |
| `content-security-policy` | Solo recursos del mismo origen, sin `unsafe-inline`, `frame-ancestors 'none'` | Bloquea scripts y estilos ajenos |
| `x-lab-function` | `viewer-response/security-headers` | Marca que demuestra que la función corrió |

Si el origen ya definió alguno de los seis primeros, se respeta su valor. `x-lab-function` se escribe siempre.

## Cómo publicarla

1. CloudFront → **Functions** → **Create function**. Nombre: `security-headers`, runtime `cloudfront-js-2.0`.
2. Pega el contenido de `viewer-response.js` y guarda.
3. Pestaña **Test**: tipo *Viewer response* y pega `viewer-response.test.json`. En la salida deben aparecer los 7 headers, más `content-type` y `cache-control` intactos.
4. **Publish**. La función pasa de *Development* a *Live*.
5. Distribución → **Behaviors** → editar el `Default (*)` → **Function associations** → *Viewer response* → *CloudFront Functions* → `security-headers`.
6. Espera a que termine el *Deploying* y comprueba:

```bash
curl -sI https://<dominio>.cloudfront.net/ | rg -i 'strict-transport|x-content-type|x-lab-function'
```

## Por qué una función y no una *response headers policy*

CloudFront ofrece *response headers policies* administradas que añaden estos mismos headers sin escribir código, y en un proyecto real serían la primera opción por ser más simples. Aquí se usa una función para aprender el mecanismo: qué es un evento *viewer response*, cómo se leen y escriben los headers, y que corre incluso en un `Hit`.
