/* ─────────────────────────────────────────────────────────────────────────
   Pestaña «Extracción» · el viaje de los datos.

   No hay botón de inicio. La página escucha a Forma a través de
   /api/eventos y, en cuanto se publica una versión nueva de cualquiera de
   los diez modelos, corre la extracción completa del proyecto:

     Revit → Forma (webhook) → APS (traduce/indexa) → Sohersa Cloud → Dashboard

   El modelo que disparó el evento se espera aunque Autodesk tarde en
   traducirlo; los otros nueve se extraen en paralelo mientras tanto, así
   que la pantalla nunca se queda quieta.

   Modo ensayo: la tecla E reprocesa la versión vigente del modelo publicado
   más recientemente, por si en la demo no hay una publicación a mano.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const raiz = document.querySelector('[data-tab-panel="extraccion"]');
  if (!raiz) return;

  const SONDEO_WEBHOOK = 3000;    // ms entre consultas con cola de webhook
  const SONDEO_VERSION = 8000;    // ms entre consultas en modo detección
  const REINTENTO      = 4000;    // ms entre preguntas mientras Autodesk procesa
  const EN_PARALELO    = 2;       // modelos que se extraen a la vez
  const FILAS_VISIBLES = 12;
  const MUESTRA        = 24;      // filas por modelo que pasan por la tabla

  const ESTADOS = {
    espera: 'Vigente', cola: 'En cola', traduciendo: 'Autodesk traduciendo',
    indexando: 'Indexando propiedades', extrayendo: 'Extrayendo', listo: 'Extraído',
    error: 'Error', esperando: 'Esperando versión'
  };

  const nf = n => Number(n).toLocaleString('es-MX');
  const mb = b => b < 1048576
    ? Math.max(1, Math.round(b / 1024)).toLocaleString('es-MX') + ' KB'
    : (b / 1048576).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
  const hora = (d = new Date()) => d.toLocaleTimeString('es-MX', { hour12: false });
  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fCorta = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getDate() + ' ' + MESES[d.getMonth()]; };
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const espera = ms => new Promise(r => setTimeout(r, ms));

  /* ── Estado ─────────────────────────────────────────────────────────── */
  let modo = null;
  let desde = 0;
  let modelos = [];               // {modelo, item, version, usuario, fecha, estado, res}
  let corriendo = false;
  let pendientes = [];            // eventos que llegaron con una extracción en marcha
  const vistos = new Set();
  let resultado = null;

  async function pideJSON(url, intentos = 3) {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || 'HTTP ' + r.status);
        return j;
      } catch (e) {
        if (i + 1 >= intentos) throw e;
        await espera(1500 * (i + 1));
      }
    }
  }

  /* ── Bitácora ───────────────────────────────────────────────────────── */
  function log(html, clase) {
    const el = $('ex-log');
    const p = document.createElement('p');
    p.innerHTML = '<time>' + hora() + '</time>' + (clase ? '<span class="' + clase + '">' + html + '</span>' : html);
    el.appendChild(p);
    while (el.children.length > 200) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  }

  /* ── Flujo ──────────────────────────────────────────────────────────── */
  const nodo  = k => raiz.querySelector('[data-nodo="' + k + '"]');
  const tramo = n => raiz.querySelector('[data-tramo="' + n + '"]');
  function marca(el, estado, dato) {
    if (!el) return;
    el.classList.toggle('is-activo', estado === 'activo');
    el.classList.toggle('is-listo', estado === 'listo');
    if (dato !== undefined) { const d = el.querySelector('[data-dato]'); if (d) d.innerHTML = dato; }
  }
  function flujoInicial() {
    ['revit','forma','aps','nube','dash'].forEach(k => marca(nodo(k), null, ''));
    [1,2,3,4].forEach(n => marca(tramo(n), null));
  }

  /* ── Contadores ─────────────────────────────────────────────────────── */
  const kpiActual = {};
  function kpi(clave, valor, texto) {
    const el = raiz.querySelector('[data-kpi="' + clave + '"]');
    if (!el) return;
    if (texto !== undefined) { el.innerHTML = texto; return; }
    const de = kpiActual[clave] || 0;
    kpiActual[clave] = valor;
    const t0 = performance.now(), dur = 700;
    const paso = t => {
      const k = Math.min(1, (t - t0) / dur);
      const v = Math.round(de + (valor - de) * (1 - Math.pow(1 - k, 3)));
      el.innerHTML = clave === 'modelos' ? v + '<small>/' + modelos.length + '</small>' : nf(v);
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  function kpisEnCero() {
    for (const k of ['modelos','elementos','valores','fechas']) { kpiActual[k] = 0; kpi(k, 0); }
    kpi('bytes', 0, '0 MB');
  }

  /* ── Modelos ────────────────────────────────────────────────────────── */
  function pintaModelos() {
    $('ex-modelos').innerHTML = modelos.map((m, i) => {
      const r = m.res;
      const pie = m.estado === 'listo' && r ? nf(r.filas.length) + ' elem.'
                : m.estado === 'traduciendo' && m.progreso ? esc(m.progreso)
                : m.usuario ? esc(m.usuario.split(' ')[0]) + ' · ' + fCorta(m.fecha) : '';
      return '<div class="ex-modelo' + (m.disparo ? ' is-disparo' : '') + '" data-estado="' + m.estado + '" data-i="' + i + '">' +
        '<div class="ex-modelo-top"><span class="ex-modelo-nom">' + esc(m.modelo) + '</span>' +
        '<span class="ex-modelo-ver' + (m.nueva ? ' is-nueva' : '') + '">v' + (m.version ?? '?') + '</span></div>' +
        '<div class="ex-barra"><i></i></div>' +
        '<div class="ex-modelo-pie"><span>' + (ESTADOS[m.estado] || '') + '</span><span>' + pie + '</span></div></div>';
    }).join('');
  }

  /* ── Tabla en vivo ──────────────────────────────────────────────────── */
  let colaFilas = [];
  let reloj = null;
  function tablaVacia(texto) {
    $('ex-tabla').innerHTML = '<tr class="ex-tabla-vacia"><td colspan="7">' + texto + '</td></tr>';
  }
  function cantidad(o) {
    if (o.volumen_m3) return o.volumen_m3.toFixed(2) + ' m³';
    if (o.area_m2)    return o.area_m2.toFixed(2) + ' m²';
    if (o.longitud_m) return o.longitud_m.toFixed(2) + ' m';
    return '1 pza';
  }
  function encolaMuestra(m) {
    const { campos, filas } = m.res;
    const obj = f => Object.fromEntries(campos.map((c, i) => [c, f[i]]));
    const conFecha = filas.filter(f => f[campos.indexOf('fechaPlaneacion')] || f[campos.indexOf('fechaEjecucion')]);
    const fuente = conFecha.length >= MUESTRA / 2 ? conFecha : filas;
    const paso = Math.max(1, Math.floor(fuente.length / MUESTRA));
    for (let i = 0; i < fuente.length && colaFilas.length < 400; i += paso) {
      colaFilas.push({ modelo: m.modelo, ...obj(fuente[i]) });
      if (i / paso >= MUESTRA) break;
    }
    if (!reloj) reloj = setInterval(goteo, 110);
  }
  function goteo() {
    const o = colaFilas.shift();
    if (!o) { clearInterval(reloj); reloj = null; return; }
    const tb = $('ex-tabla');
    if (tb.querySelector('.ex-tabla-vacia')) tb.innerHTML = '';
    const celda = (v, num) => '<td class="' + (num ? 'num ' : '') + (v ? '' : 'vacio') + '">' + (v ? esc(v) : '—') + '</td>';
    const tr = document.createElement('tr');
    tr.className = 'is-nueva';
    tr.innerHTML = '<td>' + esc(o.modelo) + '</td>' + celda(o.categoria) + celda(o.tipo || o.familia) + celda(o.marca) +
                   celda(o.fechaPlaneacion) + celda(o.fechaEjecucion) + celda(cantidad(o), true);
    tb.prepend(tr);
    while (tb.children.length > FILAS_VISIBLES) tb.lastChild.remove();
  }

  /* ── Extracción de un modelo ───────────────────────────────────────────
     Pregunta hasta que el servidor diga «listo». Mientras Autodesk procesa
     la versión, la tarjeta y el nodo APS dicen en qué va. */
  async function extrae(m, minVersion) {
    m.estado = 'extrayendo'; pintaModelos();
    let avisado = '';
    for (let vuelta = 0; vuelta < 225; vuelta++) {          // ~15 min como máximo
      let r;
      try { r = await pideJSON('/api/extraccion?item=' + encodeURIComponent(m.item)); }
      catch (e) { m.estado = 'error'; pintaModelos(); log(esc(m.modelo) + ': ' + esc(e.message), 'crit'); return; }

      m.version = r.version ?? m.version;
      m.usuario = r.usuario || m.usuario;
      m.fecha   = r.fecha   || m.fecha;

      let estado = r.estado;
      if (estado === 'listo' && minVersion && r.version < minVersion) estado = 'esperando';

      if (estado === 'listo') {
        m.res = r; m.estado = 'listo'; pintaModelos();
        return r;
      }
      if (estado === 'error') { m.estado = 'error'; pintaModelos(); log(esc(m.modelo) + ': ' + esc(r.message || 'error'), 'crit'); return; }

      m.estado = estado; m.progreso = r.progreso || ''; pintaModelos();
      const aviso = estado + m.progreso;
      if (aviso !== avisado) {
        avisado = aviso;
        const txt = estado === 'traduciendo' ? 'Autodesk está traduciendo ' + esc(m.modelo) + ' v' + r.version + (m.progreso ? ' · ' + esc(m.progreso) : '')
                  : estado === 'indexando'   ? 'Autodesk indexa las propiedades de ' + esc(m.modelo)
                  : 'Esperando a que Forma exponga la v' + minVersion + ' de ' + esc(m.modelo);
        log(txt, 'warn');
        marca(nodo('aps'), 'activo', txt.replace('Autodesk ', ''));
      }
      await espera(REINTENTO);
    }
    m.estado = 'error'; pintaModelos(); log(esc(m.modelo) + ': Autodesk no terminó a tiempo', 'crit');
  }

  function acumula() {
    const listos = modelos.filter(m => m.res);
    let elementos = 0, valores = 0, fechas = 0, bytes = 0, utiles = 0;
    for (const m of listos) {
      const { campos, filas, llenos, bytesAutodesk } = m.res;
      const iP = campos.indexOf('fechaPlaneacion'), iE = campos.indexOf('fechaEjecucion');
      elementos += filas.length;
      valores   += Object.values(llenos || {}).reduce((a, b) => a + b, 0) + filas.length * 2;
      fechas    += filas.filter(f => f[iP] || f[iE]).length;
      bytes     += bytesAutodesk || 0;
      utiles    += JSON.stringify(filas).length;
    }
    kpi('modelos', listos.length);
    kpi('elementos', elementos);
    kpi('valores', valores);
    kpi('fechas', fechas);
    kpi('bytes', 0, mb(bytes) + ' <small>→ ' + mb(utiles) + '</small>');
    return { elementos, valores, fechas, bytes, utiles };
  }

  /* ── Corrida completa ───────────────────────────────────────────────── */
  async function corre(eventos) {
    corriendo = true;
    resultado = null;
    $('ex-fin').hidden = true;
    $('ex-escucha').classList.add('is-busy');
    $('ex-escucha-txt').textContent = 'Extrayendo…';
    flujoInicial(); kpisEnCero(); colaFilas = []; tablaVacia('Esperando los primeros datos…');
    const t0 = performance.now();

    const disparos = new Map();
    for (const e of eventos) {
      const m = modelos.find(x => x.item === e.item || x.modelo === e.modelo);
      if (!m) continue;
      disparos.set(m, Math.max(disparos.get(m) || 0, e.version || 0));
    }
    modelos.forEach(m => { m.estado = 'cola'; m.res = null; m.disparo = disparos.has(m); m.nueva = false; m.progreso = ''; });
    for (const [m, v] of disparos) { if (v) { m.version = v; m.nueva = true; } }
    pintaModelos();

    // 1 · Revit → Forma
    const e0 = eventos[0];
    const quien = e0.usuario ? ' · ' + esc(e0.usuario) : '';
    marca(nodo('revit'), 'activo', esc(e0.modelo) + ' v' + (e0.version ?? '?') + quien);
    log((e0.manual ? 'Ensayo: se reprocesa ' : 'Publicación nueva en Forma: ') + '<span class="hi">' + esc(e0.modelo) + ' v' + (e0.version ?? '?') + '</span>' + quien);
    await espera(700);
    marca(nodo('revit'), 'listo'); marca(tramo(1), 'activo');
    await espera(700);
    marca(tramo(1), 'listo');
    marca(nodo('forma'), 'activo', (e0.manual ? 'manual' : 'dm.version.added') + '<br>' + hora());
    log(e0.manual ? 'Evento manual recibido' : 'Webhook <span class="hi">dm.version.added</span> recibido en /api/forma-webhook', 'ok');
    await espera(900);
    marca(nodo('forma'), 'listo'); marca(tramo(2), 'activo');
    marca(nodo('aps'), 'activo', 'Pidiendo la versión vigente…');
    log('Sohersa Cloud pide a Autodesk los 10 modelos del proyecto CDC');
    await espera(600);

    // 2 · Extracción: los disparados se esperan; el resto en paralelo
    marca(nodo('nube'), 'activo', 'Esperando datos…');
    const terminado = async (m, r) => {
      if (!r) return;
      marca(tramo(2), 'listo'); marca(tramo(3), 'activo');
      log('<span class="hi">' + esc(m.modelo) + '</span> v' + r.version + ': ' + nf(r.filas.length) + ' elementos · ' +
          mb(r.bytesAutodesk) + ' leídos · ' + (r.ms / 1000).toFixed(1) + ' s', 'ok');
      encolaMuestra(m);
      const tot = acumula();
      marca(nodo('nube'), 'activo', nf(tot.elementos) + ' elementos<br>' + nf(tot.valores) + ' valores');
      marca(nodo('aps'), 'activo', 'Leyendo propiedades · ' + mb(tot.bytes));
    };

    const disparados = [...disparos.keys()];
    const resto = modelos.filter(m => !disparos.has(m));
    const tareas = disparados.map(m => extrae(m, disparos.get(m) || 0).then(r => terminado(m, r)));
    let i = 0;
    const trabajador = async () => {
      while (i < resto.length) { const m = resto[i++]; await terminado(m, await extrae(m)); }
    };
    for (let k = 0; k < EN_PARALELO; k++) tareas.push(trabajador());
    await Promise.all(tareas);

    // 3 · Cierre
    const tot = acumula();
    const seg = ((performance.now() - t0) / 1000).toFixed(0);
    const ok = modelos.filter(m => m.res).length;
    marca(nodo('aps'), 'listo', mb(tot.bytes) + ' leídos');
    marca(tramo(3), 'listo');
    marca(nodo('nube'), 'listo', nf(tot.elementos) + ' elementos<br>' + mb(tot.utiles) + ' útiles');
    marca(tramo(4), 'activo');
    log('Datos limpios en Sohersa Cloud: <span class="hi">' + nf(tot.elementos) + ' elementos</span>, ' + nf(tot.fechas) + ' con fechas de obra', 'ok');
    await espera(900);
    marca(tramo(4), 'listo');
    marca(nodo('dash'), 'listo', 'Listo para analizar');
    log('Dashboard actualizado. Total: ' + seg + ' s', 'ok');

    resultado = {
      proyecto: 'CDC',
      extraido: new Date().toISOString(),
      disparo: eventos.map(e => ({ modelo: e.modelo, version: e.version, manual: !!e.manual })),
      totales: tot,
      modelos: modelos.filter(m => m.res).map(m => ({
        modelo: m.modelo, archivo: m.res.archivo, version: m.res.version, usuario: m.res.usuario,
        fecha: m.res.fecha, vista: m.res.vista, campos: m.res.campos, filas: m.res.filas
      }))
    };
    $('ex-fin-txt').textContent = nf(tot.elementos) + ' elementos de ' + ok + ' modelos en ' + seg + ' segundos.';
    $('ex-fin').hidden = false;
    $('ex-escucha').classList.remove('is-busy');
    escuchando();
    corriendo = false;

    if (pendientes.length) { const p = pendientes; pendientes = []; corre(p); }
  }

  function dispara(eventos) {
    eventos = eventos.filter(e => { const k = e.id || e.item + ':' + e.version; if (vistos.has(k)) return false; vistos.add(k); return true; });
    if (!eventos.length) return;
    if (corriendo) { pendientes.push(...eventos); log('Otra publicación en cola: ' + eventos.map(e => esc(e.modelo)).join(', '), 'warn'); return; }
    corre(eventos);
  }

  /* ── Escucha ────────────────────────────────────────────────────────── */
  function escuchando() {
    $('ex-escucha').classList.add('is-on');
    $('ex-escucha-txt').textContent = modo === 'webhook'
      ? 'Escuchando Autodesk Forma · webhook activo'
      : 'Vigilando Autodesk Forma · detección de versiones';
  }

  async function sondea() {
    try {
      if (!corriendo) {
        const r = await pideJSON('/api/eventos' + (modo === 'webhook' ? '?desde=' + desde : ''), 1);
        if (modo === 'webhook') {
          const ev = (r.eventos || []).slice().reverse();
          if (ev.length) desde = Math.max(desde, ...ev.map(e => e.recibido));
          dispara(ev);
        } else {
          const nuevos = [];
          for (const v of r.versiones || []) {
            const m = modelos.find(x => x.item === v.item);
            if (m && v.version != null && m.version != null && v.version > m.version) {
              nuevos.push({ modelo: v.modelo, item: v.item, version: v.version, usuario: v.usuario });
            }
          }
          dispara(nuevos);
        }
      }
    } catch (e) {
      console.warn('[extraccion] sondeo:', e.message);
    }
    setTimeout(sondea, modo === 'webhook' ? SONDEO_WEBHOOK : SONDEO_VERSION);
  }

  async function arranca() {
    flujoInicial(); kpisEnCero();
    tablaVacia('Aquí aparecerán los datos en cuanto se publique un modelo en Forma.');
    let r;
    try { r = await pideJSON('/api/eventos?versiones=1'); }
    catch (e) {
      $('ex-escucha-txt').textContent = 'Sin conexión con Autodesk';
      log('No se pudo conectar: ' + esc(e.message), 'crit');
      setTimeout(arranca, 10000);
      return;
    }
    if (r.unconfigured) { $('ex-escucha-txt').textContent = 'Pendiente de configurar'; return; }

    modo = r.modo;
    desde = r.ahora;
    for (const e of r.eventos || []) vistos.add(e.id);
    modelos = (r.versiones || []).map(v => ({ ...v, estado: v.error ? 'error' : 'espera' }));
    pintaModelos();
    kpi('modelos', 0);
    escuchando();
    marca(nodo('forma'), 'activo', 'Esperando una publicación…');
    log('Conectado a Autodesk Forma · ' + modelos.length + ' modelos de CDC vigilados');
    log(modo === 'webhook'
      ? 'Webhook <span class="hi">dm.version.added</span> activo en las carpetas del proyecto'
      : 'Detección de versiones activa (cada ' + SONDEO_VERSION / 1000 + ' s)');
    setTimeout(sondea, 1000);
    if (/[?&]ensayo\b/.test(location.search)) setTimeout(ensayo, 1500);
  }

  /* ── Acciones ───────────────────────────────────────────────────────── */
  $('ex-analizar').addEventListener('click', () => {
    // Recargar garantiza que el visor abra las versiones recién extraídas.
    location.hash = 'general';
    location.reload();
  });

  $('ex-json').addEventListener('click', () => {
    if (!resultado) return;
    const blob = new Blob([JSON.stringify(resultado, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'extraccion-CDC-' + resultado.extraido.slice(0, 16).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  function ensayo() {
    if (corriendo || !modelos.length) return;
    const m = modelos.filter(x => x.fecha).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))[0] || modelos[0];
    dispara([{ id: 'manual:' + Date.now(), manual: true, modelo: m.modelo, item: m.item, version: m.version, usuario: m.usuario }]);
  }

  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'e' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/input|textarea|select/i.test(e.target.tagName) || raiz.hidden) return;
    ensayo();
  });

  /* Se arranca al cargar aunque la pestaña no esté a la vista: así el
     aviso de Forma no se pierde si el presentador está en otra pestaña. */
  arranca();
})();
