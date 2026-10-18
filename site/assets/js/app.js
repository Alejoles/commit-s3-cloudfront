/*
 * Lee los headers de la propia página y los muestra.
 * Sin dependencias ni módulos, así funciona también abierta desde file://.
 *
 * El documento ya cargado no expone sus headers a JavaScript, así que se repite
 * la petición a la misma URL (mismo origen) y se leen los de esa respuesta.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PROBE_METHOD = 'HEAD';          // si el origen no la admite se cae a GET
  var FALLBACK_METHOD = 'GET';
  var REQUEST_TIMEOUT_MS = 10000;
  var EXPERIMENT_RUNS = 5;
  var DASH = '—';

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- 404 */

  if (document.body.dataset.page === 'notfound') {
    var requested = $('requestedPath');
    if (requested) requested.textContent = location.pathname;
    return;
  }

  /* ------------------------------------------------------------- estados */

  var STATES = {
    loading: {
      label: 'CONSULTANDO', icon: 'i-refresh', tag: 'Consultando', path: [],
      short: 'Consultando los headers de esta página',
      long: 'Pidiendo esta misma URL otra vez, sin usar la caché del navegador, para leer los headers de la respuesta.',
      diagram: 'Esperando el resultado de la consulta.',
      cache: DASH, origin: DASH
    },
    hit: {
      label: 'HIT', icon: 'i-hit', tag: 'Hit', path: ['user', 'edge', 'cache'],
      short: 'Respondió la caché del edge',
      long: 'CloudFront respondió desde su caché; S3 no fue consultado.',
      diagram: 'El usuario pide al edge, la caché responde con un Hit y S3 no se consulta.',
      cache: 'Hit', origin: 'No consultado'
    },
    miss: {
      label: 'MISS', icon: 'i-miss', tag: 'Miss', path: ['user', 'edge', 'cache', 'origin'],
      short: 'CloudFront consultó S3',
      long: 'La caché no tenía el objeto: CloudFront lo pidió a S3 y guardó una copia para las siguientes visitas.',
      diagram: 'El usuario pide al edge, la caché no tiene el objeto, CloudFront lo pide a S3 y devuelve la respuesta.',
      cache: 'Miss', origin: 'Consultado'
    },
    refresh: {
      label: 'REFRESH HIT', icon: 'i-refresh', tag: 'Refresh', path: ['user', 'edge', 'cache', 'origin'],
      short: 'La copia venció y se revalidó con el origen',
      long: 'La copia en caché había vencido: CloudFront preguntó a S3 si seguía vigente y la reutilizó sin descargarla otra vez.',
      diagram: 'El usuario pide al edge, la copia está vencida, CloudFront la revalida con S3 y responde.',
      cache: 'Vencida', origin: 'Revalidado'
    },
    error: {
      label: 'ERROR', icon: 'i-error', tag: 'Error', path: ['user', 'edge'],
      short: 'Respuesta de error',
      long: 'CloudFront devolvió una respuesta de error. Revisa el código HTTP y la política del bucket.',
      diagram: 'El usuario pide al edge y CloudFront devuelve una respuesta de error.',
      cache: DASH, origin: DASH
    },
    other: {
      label: 'OTRO', icon: 'i-other', tag: 'Otro', path: ['user', 'edge'],
      short: 'Respuesta de CloudFront no clasificada',
      long: function (r) { return 'CloudFront respondió con «' + r.xcache + '», un valor que esta página no clasifica.'; },
      diagram: 'El usuario pide al edge y CloudFront responde con un valor de x-cache no clasificado.',
      cache: DASH, origin: DASH
    },
    none: {
      label: 'SIN CLOUDFRONT', icon: 'i-none', tag: 'Sin CF', path: ['user'],
      short: 'Estás en local o fuera de CloudFront',
      long: 'La respuesta no trae x-cache: esta página no pasó por CloudFront.',
      diagram: 'El usuario pide la página, pero la respuesta no pasó por CloudFront.',
      cache: DASH, origin: DASH
    },
    offline: {
      label: 'SIN CONEXIÓN', icon: 'i-offline', tag: 'Sin red', path: [],
      short: 'No se pudo consultar los headers',
      long: 'No se pudo consultar los headers de esta página. Revisa tu conexión y vuelve a intentarlo.',
      diagram: 'La consulta de headers falló, no hay camino que mostrar.',
      cache: DASH, origin: DASH
    }
  };

  function classify(xcache) {
    if (!xcache) return 'none';
    var v = xcache.trim().toLowerCase();
    if (v.indexOf('refreshhit') === 0) return 'refresh';
    if (v.indexOf('hit') === 0) return 'hit';
    if (v.indexOf('miss') === 0) return 'miss';
    if (v.indexOf('error') === 0) return 'error';
    return 'other';
  }

  /* ------------------------------------------------- descripción de headers */

  var KEY_HEADERS = [
    ['x-cache', 'Resultado de la caché de CloudFront para esta petición: Hit, Miss, RefreshHit o Error.'],
    ['age', 'Segundos que la copia lleva guardada en la caché del edge.'],
    ['x-amz-cf-pop', 'Edge location que respondió: un código de aeropuerto cercano más un número.'],
    ['x-amz-cf-id', 'Identificador único de la petición; útil al abrir un caso con soporte.'],
    ['via', 'Indica que la respuesta pasó por CloudFront y qué intermediario la entregó.'],
    ['server', 'Software que entrega la respuesta; con S3 como origen suele ser AmazonS3.'],
    ['content-type', 'Tipo de contenido; si es incorrecto, el navegador no interpreta bien el archivo.'],
    ['content-encoding', 'Compresión aplicada (gzip o br). CloudFront solo comprime archivos de más de 1 000 bytes.'],
    ['cache-control', 'Directivas de caché definidas en S3; max-age fija cuánto vive la copia.'],
    ['etag', 'Huella de la versión del objeto; sirve para revalidar con el origen.'],
    ['last-modified', 'Fecha de la última modificación del objeto en S3.']
  ];

  var SECURITY_CHECKS = [
    ['strict-transport-security', 'Obliga al navegador a usar siempre HTTPS con este dominio.'],
    ['x-content-type-options', 'Impide que el navegador adivine el tipo de un archivo.'],
    ['x-frame-options', 'Evita que otra página incruste esta en un marco.'],
    ['referrer-policy', 'Limita la información de origen que se envía al salir de la página.'],
    ['permissions-policy', 'Desactiva cámara, micrófono y geolocalización.'],
    ['content-security-policy', 'Solo permite recursos del mismo origen y sin código en línea.'],
    ['x-edge-function', 'Marca propia que confirma que la función del edge se ejecutó.']
  ];

  /* ---------------------------------------------------------------- utilidades */

  function svgIcon(id, className) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className || 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function tag(stateKey, text) {
    var span = document.createElement('span');
    span.className = 'tag';
    span.setAttribute('data-state', stateKey);
    span.appendChild(svgIcon(STATES[stateKey].icon));
    span.appendChild(document.createTextNode(text));
    return span;
  }

  function cell(tagName, content, scope) {
    var node = document.createElement(tagName);
    if (scope) node.setAttribute('scope', scope);
    if (content instanceof Node) node.appendChild(content);
    else node.textContent = content;
    return node;
  }

  function headerOf(result, name) {
    return result && result.headers && result.headers.has(name) ? result.headers.get(name) : null;
  }

  function formatDuration(seconds) {
    if (seconds < 120) return seconds + ' s';
    if (seconds < 7200) return Math.round(seconds / 60) + ' min';
    return (seconds / 3600).toFixed(1).replace('.0', '') + ' h';
  }

  function parseCacheControl(value) {
    var out = { maxAge: null, sMaxAge: null, blocksCache: false };
    if (!value) return out;
    value.toLowerCase().split(',').forEach(function (part) {
      var pair = part.trim().split('=');
      var seconds = parseInt((pair[1] || '').replace(/"/g, ''), 10);
      if (pair[0] === 'max-age' && isFinite(seconds)) out.maxAge = seconds;
      if (pair[0] === 's-maxage' && isFinite(seconds)) out.sMaxAge = seconds;
      if (pair[0] === 'no-store' || pair[0] === 'no-cache' || pair[0] === 'private') out.blocksCache = true;
    });
    return out;
  }

  var live = $('live');
  var lastAnnounced = '';

  function announce(message, force) {
    if (!force && message === lastAnnounced) return;
    lastAnnounced = message;
    live.textContent = '';
    window.setTimeout(function () { live.textContent = message; }, 60);
  }

  /* ------------------------------------------------------------------ consulta */

  function timedRequest(url, method) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    var started = performance.now();
    return fetch(url, {
      method: method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    }).then(function (res) {
      var ms = performance.now() - started;
      window.clearTimeout(timer);
      if (method !== 'HEAD' && res.body) res.body.cancel().catch(function () {});
      return { res: res, ms: ms };
    }, function (err) {
      window.clearTimeout(timer);
      throw err;
    });
  }

  function probe() {
    if (location.protocol === 'file:') {
      return Promise.resolve({ ok: false, state: 'none', reason: 'file', at: new Date() });
    }
    var url = location.href.split('#')[0];
    var method = PROBE_METHOD;

    return timedRequest(url, method).then(function (first) {
      if (first.res.status === 405 || first.res.status === 501) {
        method = FALLBACK_METHOD;
        return timedRequest(url, method);
      }
      return first;
    }).then(function (done) {
      var headers = new Map();
      done.res.headers.forEach(function (value, name) { headers.set(name.toLowerCase(), value); });
      var xcache = headers.get('x-cache') || '';
      return {
        ok: true,
        state: classify(xcache),
        xcache: xcache,
        status: done.res.status,
        method: method,
        ms: Math.round(done.ms),
        headers: headers,
        at: new Date()
      };
    }).catch(function () {
      return { ok: false, state: 'offline', reason: 'network', at: new Date() };
    });
  }

  /* ---------------------------------------------------------------- render: petición */

  function describe(result) {
    var st = STATES[result.state];
    return typeof st.long === 'function' ? st.long(result) : st.long;
  }

  function renderRequest(result, force) {
    var st = STATES[result.state];
    var pop = headerOf(result, 'x-amz-cf-pop');

    document.body.setAttribute('data-state', result.state);

    $('stateLabel').textContent = st.label;
    $('stateIcon').setAttribute('href', '#' + st.icon);
    $('readout').style.setProperty('--chars', String(st.label.length + 1.4));
    $('stateText').textContent = describe(result);

    $('pillText').textContent = st.label + (pop ? ' · ' + pop : '');
    $('pillIcon').setAttribute('href', '#' + st.icon);

    $('fStatus').textContent = result.ok ? 'HTTP ' + result.status : DASH;
    $('fTime').textContent = result.ok ? result.ms + ' ms' : DASH;
    $('fPop').textContent = pop || DASH;
    $('fMethod').textContent = result.ok ? result.method : DASH;
    $('metaTime').textContent = 'Lectura ' + result.at.toLocaleTimeString();

    var diagrams = document.querySelectorAll('.diagram');
    Array.prototype.forEach.call(diagrams, function (svg) {
      svg.setAttribute('data-path', st.path.join(' '));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-slot="diagramDesc"]'), function (node) {
      node.textContent = st.diagram;
    });
    var notes = { edge: pop || DASH, cache: st.cache, origin: st.origin };
    Object.keys(notes).forEach(function (key) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-note="' + key + '"]'), function (node) {
        node.textContent = notes[key];
      });
    });

    announce(st.label + '. ' + st.short + (pop ? '. PoP ' + pop : '') + '.', force);
  }

  /* ---------------------------------------------------------------- render: headers */

  function renderHeaders(result) {
    var body = $('headersBody');
    body.replaceChildren();

    if (!result.ok) {
      var msg = result.reason === 'file'
        ? 'Abriste la página desde el disco (file://): no hay respuesta HTTP que leer. Sírvela con un servidor local o desde CloudFront.'
        : 'No se pudo leer la respuesta.';
      var row = document.createElement('tr');
      var td = cell('td', msg);
      td.colSpan = 2;
      td.className = 'empty';
      row.appendChild(td);
      body.appendChild(row);
      $('metaHeaders').textContent = '0 headers';
      return;
    }

    var shown = {};
    var fragment = document.createDocumentFragment();

    function addRow(name, description, isKey) {
      var tr = document.createElement('tr');
      tr.className = isKey ? 'key' : 'other';

      var th = document.createElement('th');
      th.setAttribute('scope', 'row');
      var label = document.createElement('span');
      label.className = 'hname';
      label.textContent = name;
      th.appendChild(label);
      if (description) {
        var desc = document.createElement('span');
        desc.className = 'hdesc';
        desc.textContent = description;
        th.appendChild(desc);
      }
      tr.appendChild(th);

      var value = result.headers.get(name);
      var td = document.createElement('td');
      if (value === undefined) {
        td.textContent = DASH;
        td.className = 'muted';
      } else if (name === 'x-cache') {
        td.appendChild(tag(result.state, value));
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
      fragment.appendChild(tr);
    }

    KEY_HEADERS.forEach(function (pair) {
      shown[pair[0]] = true;
      addRow(pair[0], pair[1], true);
    });

    Array.from(result.headers.keys()).sort().forEach(function (name) {
      if (!shown[name]) addRow(name, '', false);
    });

    body.appendChild(fragment);
    $('metaHeaders').textContent = result.headers.size + (result.headers.size === 1 ? ' header' : ' headers');
  }

  /* ---------------------------------------------------------------- render: caché */

  var clock = null;

  function renderCache(result) {
    var cc = headerOf(result, 'cache-control');
    var parsed = parseCacheControl(cc);
    var ttl = parsed.sMaxAge !== null ? parsed.sMaxAge : parsed.maxAge;
    var cached = result.state === 'hit' || result.state === 'miss' || result.state === 'refresh';
    var age = cached ? (parseInt(headerOf(result, 'age'), 10) || 0) : null;

    $('cAge').textContent = age === null ? DASH : age + ' s' + (result.state === 'miss' ? ' (recién traído)' : '');
    $('cTtl').textContent = ttl === null ? DASH : formatDuration(ttl);
    $('cCc').textContent = cc || DASH;
    $('ttlMax').textContent = ttl === null ? DASH : formatDuration(ttl);

    clock = null;
    if (cached && ttl !== null && ttl > 0) {
      clock = { ttl: ttl, age0: age, t0: performance.now() };
      paintClock();
      return;
    }

    var message;
    if (!cached) message = 'Sin datos de caché de CloudFront: abre la página desde la URL de tu distribución.';
    else if (parsed.blocksCache) message = 'El origen pidió no cachear este objeto (no-store, no-cache o private).';
    else message = 'El objeto no declara max-age: CloudFront aplica el TTL por defecto de su política de caché.';
    paintBar(0, false, message);
  }

  function paintBar(pct, expired, message) {
    var bar = $('ttlBar');
    $('ttlFill').style.setProperty('--p', String(pct));
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.setAttribute('aria-valuetext', message);
    bar.setAttribute('data-expired', expired ? 'true' : 'false');
    $('ttlText').textContent = message;
  }

  function paintClock() {
    if (!clock) return;
    var age = clock.age0 + (performance.now() - clock.t0) / 1000;
    var remaining = Math.ceil(clock.ttl - age);
    if (remaining > 0) {
      paintBar(Math.min(100, (age / clock.ttl) * 100), false,
        'Vence en ' + formatDuration(remaining) + '; después verás un Miss o un Refresh Hit.');
    } else {
      paintBar(100, true, 'La copia ya venció: la próxima consulta será un Miss o un Refresh Hit.');
    }
  }

  window.setInterval(paintClock, 1000);

  /* ---------------------------------------------------------------- render: seguridad */

  function renderSecurity(result) {
    var list = $('checks');
    list.replaceChildren();

    var rows = [];
    var https = location.protocol === 'https:' ? 'ok' : location.protocol === 'http:' ? 'fail' : 'unknown';
    rows.push({
      name: 'HTTPS',
      hint: 'La página se sirvió por una conexión cifrada.',
      value: location.protocol === 'file:' ? 'file://' : location.protocol.replace(':', '') + '://',
      status: https
    });
    SECURITY_CHECKS.forEach(function (pair) {
      var value = headerOf(result, pair[0]);
      rows.push({
        name: pair[0],
        hint: pair[1],
        value: value,
        status: !result.ok ? 'unknown' : value !== null ? 'ok' : 'fail'
      });
    });

    var passed = 0;
    var known = 0;
    rows.forEach(function (r) {
      if (r.status !== 'unknown') known += 1;
      if (r.status === 'ok') passed += 1;

      var li = document.createElement('li');
      li.setAttribute('data-ok', r.status === 'ok' ? 'true' : r.status === 'fail' ? 'false' : 'unknown');
      var icon = r.status === 'ok' ? 'i-check' : r.status === 'fail' ? 'i-cross' : 'i-unknown';
      li.appendChild(svgIcon(icon, 'ico check-ico'));

      var name = document.createElement('span');
      name.className = 'check-name';
      name.textContent = r.name;
      li.appendChild(name);

      var state = document.createElement('span');
      state.className = 'check-state';
      state.textContent = r.status === 'ok' ? 'Presente' : r.status === 'fail' ? 'Ausente' : 'Sin datos';
      li.appendChild(state);

      var hint = document.createElement('span');
      hint.className = 'check-hint';
      hint.textContent = r.hint;
      li.appendChild(hint);

      if (r.status === 'ok' && r.value) {
        var val = document.createElement('span');
        val.className = 'check-value';
        val.textContent = r.value;
        li.appendChild(val);
      }
      list.appendChild(li);
    });

    $('secScore').textContent = known === 0
      ? 'Sin datos: no hay respuesta HTTP que evaluar.'
      : passed + ' de ' + rows.length + ' comprobaciones superadas';
  }

  /* ---------------------------------------------------------------- consulta manual y automática */

  var probing = false;
  var experimenting = false;
  var autoTimer = null;

  function refresh(manual) {
    if (probing || experimenting) return Promise.resolve();
    probing = true;
    $('btnProbe').disabled = true;
    $('btnProbeText').textContent = 'Consultando…';

    return probe().then(function (result) {
      renderRequest(result, manual);
      renderHeaders(result);
      renderCache(result);
      renderSecurity(result);
    }).then(function () {
      probing = false;
      $('btnProbe').disabled = false;
      $('btnProbeText').textContent = 'Consultar de nuevo';
    });
  }

  function setAuto(on) {
    window.clearInterval(autoTimer);
    autoTimer = null;
    if (!on) return;
    var secs = parseInt($('autoSecs').value, 10) || 10;
    autoTimer = window.setInterval(function () {
      if (!document.hidden) refresh(false);
    }, secs * 1000);
  }

  /* ---------------------------------------------------------------- experimento */

  function expRow(index, result) {
    var tr = document.createElement('tr');
    tr.appendChild(cell('td', String(index)));
    var xc = cell('td', tag(result.state, result.ok && result.xcache ? result.xcache : STATES[result.state].label));
    tr.appendChild(xc);
    tr.appendChild(cell('td', result.ok && headerOf(result, 'age') !== null ? headerOf(result, 'age') + ' s' : DASH));
    tr.appendChild(cell('td', headerOf(result, 'x-amz-cf-pop') || DASH));
    tr.appendChild(cell('td', result.ok ? result.ms + ' ms' : DASH));
    return tr;
  }

  function renderChart(results) {
    var group = $('chartBars');
    group.replaceChildren();
    var baseY = 118;
    var topY = 26;
    var barW = 40;
    var step = 360 / EXPERIMENT_RUNS;
    var max = 1;
    results.forEach(function (r) { if (r.ok && r.ms > max) max = r.ms; });

    results.forEach(function (r, i) {
      var h = r.ok ? Math.max(3, (r.ms / max) * (baseY - topY)) : 3;
      var x = step * i + (step - barW) / 2;
      var cx = step * i + step / 2;

      var rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'bar-rect');
      rect.setAttribute('data-state', r.state);
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(baseY - h));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '3');
      group.appendChild(rect);

      var value = document.createElementNS(SVG_NS, 'text');
      value.setAttribute('class', 'chart-val');
      value.setAttribute('x', String(cx));
      value.setAttribute('y', String(baseY - h - 6));
      value.textContent = r.ok ? r.ms + ' ms' : DASH;
      group.appendChild(value);

      var idx = document.createElementNS(SVG_NS, 'text');
      idx.setAttribute('class', 'chart-idx');
      idx.setAttribute('x', String(cx));
      idx.setAttribute('y', String(baseY + 16));
      idx.textContent = '#' + (i + 1);
      group.appendChild(idx);

      var name = document.createElementNS(SVG_NS, 'text');
      name.setAttribute('class', 'chart-idx');
      name.setAttribute('x', String(cx));
      name.setAttribute('y', String(baseY + 31));
      name.textContent = STATES[r.state].tag;
      group.appendChild(name);
    });

    $('chart').setAttribute('aria-label', 'Tiempos de las peticiones: ' + results.map(function (r, i) {
      return '#' + (i + 1) + ' ' + STATES[r.state].tag + (r.ok ? ' ' + r.ms + ' ms' : '');
    }).join(', '));
  }

  function average(list) {
    return Math.round(list.reduce(function (a, b) { return a + b; }, 0) / list.length);
  }

  function renderSummary(results) {
    var summary = $('expSummary');
    summary.replaceChildren();

    var groups = {};
    results.forEach(function (r) {
      if (!groups[r.state]) groups[r.state] = [];
      if (r.ok) groups[r.state].push(r.ms);
      else groups[r.state].push(null);
    });

    Object.keys(groups).forEach(function (key) {
      var times = groups[key].filter(function (v) { return v !== null; });
      var row = document.createElement('div');
      row.className = 'summary-row';
      row.appendChild(tag(key, STATES[key].tag + ' × ' + groups[key].length));
      var avg = document.createElement('span');
      avg.textContent = times.length ? 'promedio ' + average(times) + ' ms' : DASH;
      row.appendChild(avg);
      summary.appendChild(row);
    });

    var diff = $('expDiff');
    diff.textContent = '';
    for (var i = 0; i < results.length - 1; i += 1) {
      if (results[i].state === 'miss' && results[i + 1].state === 'hit' && results[i].ok && results[i + 1].ok) {
        var delta = results[i].ms - results[i + 1].ms;
        diff.textContent = 'Del Miss (' + results[i].ms + ' ms) al Hit siguiente (' + results[i + 1].ms + ' ms) hubo ' +
          (delta >= 0 ? delta + ' ms menos' : Math.abs(delta) + ' ms más') +
          '. La red añade ruido: es una referencia, no una medida exacta.';
        break;
      }
    }
  }

  function runExperiment() {
    if (probing || experimenting) return;
    experimenting = true;
    var button = $('btnExp');
    button.disabled = true;
    var body = $('expBody');
    body.replaceChildren();
    $('expSummary').replaceChildren();
    $('expDiff').textContent = '';
    var results = [];

    function step(i) {
      if (i > EXPERIMENT_RUNS) return Promise.resolve();
      button.textContent = 'Probando… ' + i + '/' + EXPERIMENT_RUNS;
      return probe().then(function (result) {
        results.push(result);
        body.appendChild(expRow(i, result));
        renderChart(results);
        return step(i + 1);
      });
    }

    step(1).then(function () {
      renderSummary(results);
      var tags = results.map(function (r) { return STATES[r.state].tag; }).join(', ');
      announce('Experimento terminado: ' + tags + '.', true);
      experimenting = false;
      button.disabled = false;
      button.textContent = 'Probar 5 veces';
    });
  }

  /* ---------------------------------------------------------------- arranque */

  $('year').textContent = String(new Date().getFullYear());

  $('btnProbe').addEventListener('click', function () { refresh(true); });
  $('btnExp').addEventListener('click', runExperiment);
  $('autoSwitch').addEventListener('change', function (event) { setAuto(event.target.checked); });
  $('autoSecs').addEventListener('change', function () { setAuto($('autoSwitch').checked); });

  if (location.protocol === 'file:') {
    $('btnExp').disabled = true;
    $('btnExp').textContent = 'Requiere HTTP(S)';
    $('autoSwitch').disabled = true;
    $('autoSecs').disabled = true;
  }

  refresh(false);
}());
