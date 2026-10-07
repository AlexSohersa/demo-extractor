/* ─────────────────────────────────────────────────────────────────────────
   Semáforo de avance en el visor federado.

   Colorea los diez modelos segun las fechas de seguimiento:
       con fechaEjecucion              → verde
       sin fechaEjecucion              → rojo (pendiente)
       modelo sin ninguna fecha        → transparente (aun sin capturar)

   La transparencia se consigue aislando los elementos QUE SÍ tienen dato:
   el visor deja al resto en modo fantasma, que es exactamente el efecto
   buscado y no requiere tocar materiales.

   Los diez modelos se tratan igual: no hay nada codificado que suponga qué
   disciplina tiene el parámetro. Hoy sólo algunos lo traen y el resto sale
   transparente; según se vaya capturando en los demás, se colorean solos.
   El contador de la barra refleja el avance de esa captura.

   El indexado es BAJO DEMANDA. Leer las propiedades de diez modelos lleva
   minutos y compite con el visor de la otra pestaña, así que no se hace
   hasta que alguien pulsa «Colorear por avance».
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const EJEC_PROPS = [
    'fechaEjecucion', 'fechaejecucion', 'FechaEjecucion', 'FECHAEJECUCION',
    'fecha_ejecucion', 'Fecha de ejecución', 'FECHA DE EJECUCIÓN'
  ];
  const PLAN_PROPS = [
    'fechaPlaneacion', 'fechaplaneacion', 'FechaPlaneacion', 'FECHAPLANEACION',
    'fecha_planeacion', 'Fecha de planeación', 'FECHA DE PLANEACIÓN'
  ];
  const STATUS_PROPS = EJEC_PROPS.concat(PLAN_PROPS);
  const COLOR = { done: '#6DBE45', pending: '#EE5C63' };   // verde · rojo
  // Lo pendiente se ve a través, pero poco: rojo al 70 % de opacidad.
  const OPACIDAD_PENDIENTE = 0.7;
  const ETIQUETA = { done: 'Ejecutados', pending: 'Pendientes', unknown: 'Sin capturar' };

  let viewer = null;
  let porModelo = [];      // [{ model, done:[], pending:[], unknown:n }]
  let modelos = [];        // [{ name, model }]  en el orden en que se cargaron
  let ocultos = new Set(); // nombres de los modelos apagados
  let listo = false;
  let pintado = false;

  const $ = id => document.getElementById(id);
  const setStatus = t => { const e = $('fed-status'); if (e) e.textContent = t; };

  /* Los parametros son de TEXTO, asi que se comprueba que la fecha sea
     interpretable y no solo que el campo traiga algo escrito. */
  function esFecha(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return false;
    const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    let a, m, d;
    if (iso)      { a = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else if (dmy) { d = +dmy[1]; m = +dmy[2]; a = +dmy[3]; if (a < 100) a += 2000; }
    else return false;
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
  }

  function hex2vec(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return new THREE.Vector4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255,
                             alpha === undefined ? 1 : alpha);
  }

  /* ── Indexado ─────────────────────────────────────────────────────────
     Se pide SÓLO la propiedad de estado. Traer todas las propiedades de
     20 000 elementos en diez modelos satura al visor; con el filtro
     estrecho es cuestión de segundos.

     Los modelos se recorren de uno en uno: en paralelo compiten por el
     mismo worker de la base de propiedades y se atascan. */
  let indexando = false;

  function indexar() {
    if (!viewer || indexando || listo) return;
    indexando = true;
    const ms = viewer.getAllModels();
    porModelo = [];
    setStatus('Leyendo fechas de seguimiento…');

    // Cada modelo descarga su base de propiedades la primera vez. Un límite
    // largo parece prudente pero es peor: si el servicio no responde, diez
    // modelos a dos minutos y medio son veinticinco minutos de espera antes
    // de admitir el fallo. Mejor rendirse pronto y decirlo.
    const uno = (m, ms_ = 20000) => new Promise(res => {
      const acabar = r => res(r);
      const limite = setTimeout(() => acabar({ model: m, done: [], pending: [], unknown: 0, error: 'tiempo agotado' }), ms_);
      m.getObjectTree(tree => {
        const hojas = [];
        tree.enumNodeChildren(tree.getRootId(), id => { if (tree.getChildCount(id) === 0) hojas.push(id); }, true);
        m.getBulkProperties2(hojas, { propFilter: STATUS_PROPS, ignoreHidden: true }, r => {
          clearTimeout(limite);
          const done = [], pending = []; let unknown = 0, conFecha = 0;
          for (const o of r) {
            let ejec = false, plan = false;
            for (const p of o.properties) {
              if (!esFecha(p.displayValue)) continue;
              if (EJEC_PROPS.includes(p.displayName)) ejec = true;
              else if (PLAN_PROPS.includes(p.displayName)) plan = true;
            }
            if (ejec || plan) conFecha++;
            if (ejec) done.push(o.dbId);
            else pending.push(o.dbId);
          }
          /* Salvaguarda por modelo: si NINGUNO de sus elementos trae fecha,
             esa disciplina todavia no esta capturada (o no se pudo leer). Se
             deja transparente en vez de pintarla entera de rojo, que es lo
             que hace legible el avance de la captura entre disciplinas. */
          if (!conFecha) { unknown = pending.length; pending.length = 0; }
          acabar({ model: m, done, pending, unknown });
        }, err => { clearTimeout(limite); acabar({ model: m, done: [], pending: [], unknown: 0, error: String(err) }); });
      }, err => { clearTimeout(limite); acabar({ model: m, done: [], pending: [], unknown: 0, error: String(err) }); });
    });

    (async () => {
      let seguidosEnFallo = 0;
      for (let i = 0; i < ms.length; i++) {
        setStatus(`Leyendo fechas de seguimiento… ${i + 1}/${ms.length}`);
        const r = await uno(ms[i]);
        porModelo.push(r);

        // Tres seguidos sin responder no es lentitud, es que el servicio de
        // propiedades no está disponible. Insistir siete veces más sólo
        // alarga la espera; se corta y se dice.
        seguidosEnFallo = r.error ? seguidosEnFallo + 1 : 0;
        if (seguidosEnFallo >= 3 && !porModelo.some(x => !x.error)) {
          setStatus('La base de propiedades no responde. Recarga la página.');
          console.warn('[viewer-status] abandonado: 3 modelos seguidos sin respuesta del property db');
          indexando = false;
          return;
        }

        // Se puede colorear con lo que ya haya: mejor parcial que nada.
        if (!r.error) { listo = true; if (pintado && !pendienteAislar) colorear(); }
      }

      // Segunda vuelta para los que fallaron: su base de propiedades ya
      // quedó descargada, así que el reintento suele ser inmediato.
      const fallidos = porModelo.map((x, i) => x.error ? i : -1).filter(i => i >= 0);
      if (fallidos.length) {
        setStatus(`Reintentando ${fallidos.length} ${fallidos.length === 1 ? 'modelo' : 'modelos'}…`);
        for (const i of fallidos) {
          const r = await uno(porModelo[i].model, 40000);
          if (!r.error) porModelo[i] = r;
        }
      }

      listo = porModelo.some(x => !x.error);
      resumir();
      indexando = false;
      if (listo && pendienteAislar) aislarEjecutados();
      else if (listo) colorear();
      else setStatus('Ningún modelo devolvió fechas. Recarga la página.');
    })();
  }

  function resumir() {
    const d = porModelo.reduce((a, x) => a + x.done.length, 0);
    const p = porModelo.reduce((a, x) => a + x.pending.length, 0);
    const u = porModelo.reduce((a, x) => a + x.unknown, 0);
    const fallos = porModelo.filter(x => x.error).length;
    setStatus(`${d} ejecutados · ${p} pendientes · ${u} sin capturar` +
              (fallos ? ` · ${fallos} ${fallos === 1 ? 'modelo' : 'modelos'} sin leer` : ''));
    const conDato = porModelo.filter(x => x.done.length || x.pending.length).length;
    console.info(`[viewer-status] fechas → ejecutados:${d} pendientes:${p} sin capturar:${u} · ` +
                 `${conDato} de ${porModelo.length} modelos lo traen`);
    if (fallos) console.warn('[viewer-status] no se pudieron leer:',
      porModelo.filter(x => x.error).map(x => x.error).join(' · '));
  }

  /* ── Pintado ───────────────────────────────────────────────────────────
     El color se aplica POR MODELO, así que limpiarlo también tiene que ir
     modelo por modelo. `clearThemingColors()` sin argumento sólo afecta al
     primero — por eso el botón de restablecer no descoloreaba nada. */
  function limpiarColores() {
    const ms = viewer.getAllModels ? viewer.getAllModels() : [];
    if (ms.length) for (const m of ms) viewer.clearThemingColors(m);
    else viewer.clearThemingColors();
  }

  /* Aislar en una vista federada tiene dos trampas.

     La primera: viewer.isolate([{model, ids}, …]) NO hace aislado agregado en
     esta versión del SDK. Sólo atiende la primera entrada, e incluso ésa la
     interpreta mal — pedirle 40 elementos del modelo 0 y 40 del 3 dejaba el
     modelo 0 entero oculto y el 3 intacto. Medido en el visor:

         isolate([{m0, 40 ids}, {m3, 40 ids}])
           → m0: 2 aislados, 0 fragmentos visibles
           → m3: 0 aislados, 3719 visibles  (ignorado)

         isolate(ids, m0) + isolate(ids, m3)      ← la buena
           → m0: 40 aislados, 40 visibles
           → m3: 40 aislados, 69 visibles

     Así que se llama UNA VEZ POR MODELO con la forma de dos argumentos.

     La segunda: aislar en un modelo no toca a los demás. Los que no reciben
     llamada se quedan enteros en pantalla. Por eso se recorren TODOS los
     modelos cargados y los que no aportan nada se apagan. */
  function nombreDe(m) {
    const x = modelos.find(y => y.model === m);
    return x ? x.name : null;
  }

  /* El «fantasma» es el gris translúcido con que el visor deja lo que no
     está aislado. Apagarlo hace que esos elementos desaparezcan del todo,
     que es lo que se quiere al mirar sólo lo ejecutado. Para el coloreado
     se deja encendido: ahí el fantasma ES el «sin dato = transparente». */
  function fantasmas(on) {
    if (viewer && typeof viewer.setGhosting === 'function') viewer.setGhosting(on);
  }

  function aislarEnTodos(idsDe) {
    const ms = viewer.getAllModels ? viewer.getAllModels() : [];
    let n = 0;
    for (const m of ms) {
      const ids = idsDe(m);
      if (ids && ids.length) {
        // Se respeta el interruptor manual: si el usuario apagó el modelo,
        // sigue apagado aunque tenga elementos que mostrar.
        verModelo(m, !ocultos.has(nombreDe(m)));
        viewer.isolate(ids, m);
        n += ids.length;
      } else {
        verModelo(m, false);
      }
    }
    return n;
  }

  const idsPorModelo = (m, campo) => {
    const x = porModelo.find(y => y.model === m);
    if (!x) return [];
    return campo === 'done' ? x.done : x.done.concat(x.pending);
  };

  function colorear() {
    if (!listo || !viewer) return;
    const verde = hex2vec(COLOR.done), rojo = hex2vec(COLOR.pending);

    limpiarColores();
    if (window.apsOpacidad) window.apsOpacidad.restaurar(viewer);
    fantasmas(true);
    // Aislar lo que tiene dato deja al resto en fantasma: eso es la
    // «transparencia» pedida para los elementos sin capturar. Un modelo
    // entero sin el parámetro se apaga, que es el mismo criterio.
    aislarEnTodos(m => idsPorModelo(m, 'conDato'));

    for (const x of porModelo) {
      for (const id of x.done)    viewer.setThemingColor(id, verde, x.model, true);
      for (const id of x.pending) viewer.setThemingColor(id, rojo,  x.model, true);
      // La transparencia va en el material: el alpha del color de tema sólo
      // pesa la mezcla del RGB, no la opacidad.
      if (window.apsOpacidad && x.pending.length)
        window.apsOpacidad.aplicar(viewer, x.model, x.pending, OPACIDAD_PENDIENTE);
    }
    pintado = true;
    // Se rehace el resumen: si se venía de «Aislar ejecutados», la barra
    // seguiría anunciando el aislamiento en vez del recuento.
    resumir();
    render();
  }

  /* Deja en pantalla sólo lo ejecutado. Necesita el índice, así que si aún
     no se ha leído se lanza la lectura y se reanuda al terminar. */
  let pendienteAislar = false;

  function aislarEjecutados() {
    if (!viewer) return;
    if (!listo) { pendienteAislar = true; indexar(); return; }
    pendienteAislar = false;

    const total = porModelo.reduce((a, x) => a + x.done.length, 0);
    if (!total) { setStatus('Ningún elemento con fecha de ejecución'); return; }

    const verde = hex2vec(COLOR.done);
    limpiarColores();
    if (window.apsOpacidad) window.apsOpacidad.restaurar(viewer);
    // Sin fantasma: lo pendiente no se atenúa, se va de la pantalla.
    fantasmas(false);
    aislarEnTodos(m => idsPorModelo(m, 'done'));
    for (const x of porModelo) for (const id of x.done) viewer.setThemingColor(id, verde, x.model, true);
    pintado = true;
    setStatus(`${total} elementos ejecutados aislados`);
    render();
  }

  function restablecer() {
    if (!viewer) return;
    fantasmas(true);
    limpiarColores();
    if (window.apsOpacidad) window.apsOpacidad.restaurar(viewer);
    /* Primero se vuelven a encender los modelos y luego se deshace el
       aislamiento. Al revés no funciona: sobre un modelo apagado el visor no
       tiene ámbito de visibilidad y isolate() revienta, dejándolo aislado
       para siempre. */
    const ms = viewer.getAllModels ? viewer.getAllModels() : [];
    for (const m of ms) verModelo(m, true);
    for (const m of ms) { try { viewer.isolate([], m); } catch (e) { /* según versión */ } }
    viewer.showAll();
    viewer.clearSelection();
    // showAll también reactiva los modelos apagados a mano: se vuelven a
    // apagar para no deshacer lo que el usuario eligió ver.
    aplicarVisibilidad();
    pintado = false;
    pendienteAislar = false;
    render();
  }

  /* ── Visibilidad por modelo ────────────────────────────────────────────
     hideModel/showModel cambiaron de firma entre versiones del SDK: unas
     esperan el modelo, otras su id. Se prueban ambas. */
  function verModelo(m, visible) {
    const fn = visible ? 'showModel' : 'hideModel';
    if (typeof viewer[fn] !== 'function') return false;
    try { viewer[fn](m); return true; } catch (e) { /* siguiente forma */ }
    try { viewer[fn](m.id); return true; } catch (e) { return false; }
  }

  function aplicarVisibilidad() {
    for (const x of modelos) verModelo(x.model, !ocultos.has(x.name));
  }

  function alternar(nombre) {
    if (ocultos.has(nombre)) ocultos.delete(nombre); else ocultos.add(nombre);
    aplicarVisibilidad();
    renderToggles();
  }

  function renderToggles() {
    const el = $('fed-models');
    if (!el) return;
    if (!modelos.length) { el.innerHTML = ''; return; }
    el.innerHTML = modelos.map(x => {
      const on = !ocultos.has(x.name);
      return `<button type="button" class="model-toggle" data-modelo="${x.name.replace(/"/g, '&quot;')}"
                aria-pressed="${on}" title="${on ? 'Ocultar' : 'Mostrar'} ${x.name}">
                <span class="punto"></span>${x.name}
              </button>`;
    }).join('');
  }

  function render() {
    const btn = $('fed-avance');
    if (btn) btn.textContent = pintado ? 'Quitar color' : 'Colorear por avance';
    const el = $('fed-legend');
    if (!el) return;
    if (!pintado) { el.innerHTML = ''; return; }
    const d = porModelo.reduce((a, x) => a + x.done.length, 0);
    const p = porModelo.reduce((a, x) => a + x.pending.length, 0);
    const u = porModelo.reduce((a, x) => a + x.unknown, 0);
    el.innerHTML = [
      [COLOR.done, `${ETIQUETA.done} (${d})`],
      [COLOR.pending, `${ETIQUETA.pending} (${p})`],
      ['transparent', `${ETIQUETA.unknown} (${u}) · transparentes`]
    ].map(([c, t]) => `
      <span style="display:inline-flex;align-items:center;gap:7px">
        <span style="width:10px;height:10px;border-radius:3px;display:block;background:${c};
                     ${c === 'transparent' ? 'border:1px solid var(--t-faint)' : ''}"></span>${t}
      </span>`).join('');
  }

  /* ── Cableado ──────────────────────────────────────────────────────── */
  window.addEventListener('aps:viewer-ready', e => {
    if (e.detail.key !== 'federado') return;
    viewer = e.detail.viewer;
    modelos = (e.detail.models || []).slice();
    ocultos = new Set();
    renderToggles();
    setStatus('Pulsa «Colorear por avance» para leer el estado de los elementos');
  });

  document.addEventListener('DOMContentLoaded', () => {
    const a = $('fed-avance'), r = $('fed-reset');
    // El indexado es bajo demanda: leer las propiedades de diez modelos toma
    // minutos y compite con el visor de la otra pestaña. No se hace hasta
    // que alguien lo pide.
    if (a) a.addEventListener('click', () => {
      if (pintado) return restablecer();
      if (listo) return colorear();
      indexar();
    });
    if (r) r.addEventListener('click', restablecer);
    const ej = $('fed-ejecutados');
    if (ej) ej.addEventListener('click', aislarEjecutados);

    const cont = $('fed-models');
    if (cont) cont.addEventListener('click', ev => {
      const b = ev.target.closest('[data-modelo]');
      if (b) alternar(b.dataset.modelo);
    });
    const todos = $('fed-todos'), ninguno = $('fed-ninguno');
    if (todos)   todos.addEventListener('click',   () => { ocultos = new Set(); aplicarVisibilidad(); renderToggles(); });
    if (ninguno) ninguno.addEventListener('click', () => { ocultos = new Set(modelos.map(x => x.name)); aplicarVisibilidad(); renderToggles(); });
  });

  window.viewerStatus = { get porModelo() { return porModelo; }, colorear, aislarEjecutados, restablecer };
})();
