// CloudFront Function · evento: viewer response · runtime: cloudfront-js-2.0
//
// Qué hace: añade headers de seguridad a cada respuesta que CloudFront
// entrega al usuario. No toca el cuerpo ni el código de estado.
//
// Cuándo corre: en CADA petición, incluso cuando la respuesta sale de la
// caché (Hit). Por eso los headers siempre llegan, y por eso no hace falta
// que S3 los conozca ni invalidar la caché para cambiarlos.
//
// Límites de las CloudFront Functions: sin red, sin archivos, sin librerías
// y con muy poco tiempo de ejecución. Para esto sobra.

// Headers que se añaden. Las claves van en minúsculas porque CloudFront
// entrega los headers así dentro del evento.
var SECURITY_HEADERS = {
  // Obliga a usar HTTPS durante un año (31536000 s), también en subdominios.
  'strict-transport-security': 'max-age=31536000; includeSubDomains',

  // Evita que el navegador "adivine" el tipo de un archivo distinto al declarado.
  'x-content-type-options': 'nosniff',

  // Impide que otra web meta esta página dentro de un <iframe> (clickjacking).
  'x-frame-options': 'DENY',

  // Al salir a otro sitio solo se envía el origen, nunca la ruta completa.
  'referrer-policy': 'strict-origin-when-cross-origin',

  // Desactiva funciones del navegador que esta página no usa.
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',

  // Solo se permite lo que viene de este mismo dominio. Es lo que la página
  // necesita (su CSS, su JS, su favicon y las peticiones a sí misma) y nada
  // más. No hay 'unsafe-inline': la página no tiene scripts ni estilos en línea.
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
};

// Marca propia: la página la lee para mostrar que la función sí se ejecutó.
var EDGE_MARKER = 'viewer-response/security-headers';

function handler(event) {
  var response = event.response;
  var headers = response.headers;

  // 1) Headers de seguridad: se añaden solo si el origen no los definió.
  //    Si S3 (u otra capa) ya puso uno a propósito, se respeta su valor.
  for (var name in SECURITY_HEADERS) {
    if (!headers[name]) {
      headers[name] = { value: SECURITY_HEADERS[name] };
    }
  }

  // 2) La marca se escribe siempre, para que el valor sea el de esta función.
  headers['x-lab-function'] = { value: EDGE_MARKER };

  return response;
}
