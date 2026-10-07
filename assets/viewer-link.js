/* ─────────────────────────────────────────────────────────────────────────
   Puente dashboard ↔ visor.

   Construye UNA VEZ, al cargar el modelo, un índice
        nombre de elemento  →  [dbId, dbId, …]
        partida             →  [dbId, dbId, …]
        estado de avance    →  [dbId, dbId, …]   (parámetro fechaEjecucion)
   leyendo las propiedades de cada elemento. A partir de ahí seleccionar,
   aislar y colorear son búsquedas instantáneas en memoria.

   No se usa viewer.search() porque hace substring: buscar "AR-1" también
   devolvería AR-10, AR-11 y AR-12. Aquí el emparejamiento es por token exacto.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── Configuración ──────────────────────────────────────────────────── */

  /* Parametros que dicen si el elemento esta en seguimiento y si ya se
     ejecuto. ELEMENTO TERMINADO se retiro de los modelos: se contradecia
     con las fechas y ademas no situaba el avance en el tiempo.

     Con las dos fechas el estado sale sin ambiguedad:

       fechaEjecucion        -> ejecutado
       sin fechaEjecucion    -> pendiente

     No hay un tercer estado: un elemento sin ninguna de las dos fechas es
     trabajo que no se ha hecho, y asi tiene que verse. fechaPlaneacion se
     lee igualmente, pero solo para saber si el modelo trae los parametros
     (ver la salvaguarda al final del indexado).

     Se incluyen variantes de escritura porque propFilter compara el nombre
     exacto tal y como lo expone el modelo traducido. */
  const EJEC_PROPS = [
    'fechaEjecucion', 'fechaejecucion', 'FechaEjecucion', 'FECHAEJECUCION',
    'fecha_ejecucion', 'Fecha de ejecución', 'FECHA DE EJECUCIÓN'
  ];
  const PLAN_PROPS = [
    'fechaPlaneacion', 'fechaplaneacion', 'FechaPlaneacion', 'FECHAPLANEACION',
    'fecha_planeacion', 'Fecha de planeación', 'FECHA DE PLANEACIÓN'
  ];
  const STATUS_PROPS = EJEC_PROPS.concat(PLAN_PROPS);

  // Propiedades donde buscar el identificador del elemento (VM-1, Z3, …).
  const NAME_PROPS = [
    'Name', 'Nombre',
    'Type Name', 'Nombre de tipo',
    'Family Name', 'Nombre de familia', 'Family and Type', 'Familia y tipo',
    'Mark', 'Marca',
    'Type Mark', 'Marca de tipo',
    'Comments', 'Comentarios'
  ];

  const PROPS = NAME_PROPS.concat(STATUS_PROPS);

  /* Criterio ÚNICO de qué entra en el dashboard.

     El grupo 1 es el código de la fila del desglose ("Avance por partida").
     Un elemento pertenece a una partida si, y sólo si, aquí encaja: no hay
     categoría "Otros". Todo lo que el dashboard cuenta tiene una fila con
     nombre, y todo lo que tiene fila lo cuenta el dashboard.

     Cimentación son SÓLO las zapatas declaradas (Z1…Z7, ZC2). Dados,
     castillos, contratrabes y zapata corrida existen en el modelo pero
     quedan fuera a propósito: la tabla de obra nunca los contó como
     elementos de la partida. Para incluirlos bastaría añadir aquí sus
     códigos (DA-\d+, CT-\d+, K\d+) y ampliar ROW_LABEL. */
  const ELEMENT_MATCH = {
    cim: /\b(ZC\d+|Z\d+)\b/i,
    vm:  /\b(VM[-\s]?\d+)\b/i,
    cm:  /\b(CM[-\s]?\d+)\b/i,
    /* Armaduras: se cuentan por MIEMBRO, no por agrupación.

       Los nodos AR3/AR4/AR6 agrupan sólo 38 piezas de 1.8 m, y su bandera
       de terminado decía «sí» mientras sus perfiles seguían sin colocar:
       la partida marcaba 100 % con obra a medio montar. Contando cada
       poste, diagonal y cuerda por separado, el avance es el real.

       \b no vale como frontera por delante: el nombre trae un guion bajo
       («SOH-FM-ES_PO-2 PTR») y \b no dispara entre «_» y «P». */
    ar:  /(?:^|[^A-Za-z0-9])(AR[-\s]?\d+|PO-\d+|DI-\d+|CI-\d+|CS-\d+|CU-\d+)/i
  };
  // Cómo se muestra ese código como nombre de fila en el dashboard.
  const ROW_LABEL = { cim: c => 'Zapata ' + c, vm: c => c, cm: c => c, ar: c => c };

  const PARTIDA_COLOR = { cim: '#6DBE45', vm: '#4A9FD8', cm: '#E8A200', ar: '#9B7FE8' };

  // Semáforo de avance. Los que no tienen dato no llevan color: se dejan
  // transparentes aislando a los que sí lo tienen (ver paint()).
  const STATUS_COLOR = {
    done:    '#6DBE45',   // con fechaEjecucion
    pending: '#EE5C63'    // sin fechaEjecucion
  };
  // Lo pendiente se ve a través, pero poco: rojo al 70 % de opacidad.
  const STATUS_OPACIDAD = 0.7;
  const STATUS_LABEL = { done: 'Ejecutados', pending: 'Pendientes', unknown: 'Sin dato' };

  /* ── Estado ─────────────────────────────────────────────────────────── */
  let viewer = null;
  let byName = new Map();      // 'VM-1' → Set<dbId>
  let byPartida = new Map();   // 'vm'   → Set<dbId>
  let byStatus = new Map();    // 'done' | 'pending' | 'unknown' → Set<dbId>
  let statusOf = new Map();    // dbId   → estado · SÓLO elementos de partida
  /* El coloreado abarca más que el dashboard.

     Los conteos del dashboard sólo miran las cuatro partidas (zapatas, VM,
     CM, AR), y así debe seguir. Pero el modelo tiene además ~1 100 perfiles
     sueltos —postes, diagonales, cuerdas, vigas secundarias— que son los
     miembros de las armaduras agrupadas. No encajan en ningún código de
     partida, pero SÍ traen fechaEjecucion capturada.

     Antes se quedaban sin colorear. Ahora se pintan con su valor real: no
     hace falta suponerles nada. */
  let statusAll = new Map();   // dbId   → estado · TODO el que tenga dato
  let byRow = new Map();       // 'vm'   → Map('VM-1' → {name, done, total})
  let ready = false;
  let sync = true;
  let mode = 'none';           // 'none' | 'partida' | 'status'
  let isolatedTo = null;       // partida actualmente aislada, si la hay
  let modelLabel = null;       // nombre y versión del modelo en ACC
  let leafCount = 0;           // hojas del modelo, para decidir si hay que aislar

  const $ = id => document.getElementById(id);
  const setStatus = txt => { const el = $('viewer-link-status'); if (el) el.textContent = txt; };

  /* Misma tolerancia que aISO() en viewer-fechas.js: los parametros son de
     TEXTO y Revit no valida nada. Aqui no interesa QUE fecha es, solo si hay
     una interpretable; el corte lo aplica viewer-fechas.js sobre la curva. */
  function esFecha(value) {
    const s = String(value == null ? '' : value).trim();
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

  /* O tiene fecha de ejecucion, o esta pendiente. */
  const estadoPorFechas = ejec => ejec ? 'done' : 'pending';

  const add = (map, key, dbId) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(dbId);
  };

  /* ── Construcción del índice ───────────────────────────────────────── */
  function buildIndex(v, label) {
    viewer = v;
    modelLabel = label || null;
    const model = viewer.model;
    setStatus('Indexando elementos…');

    model.getObjectTree(function (tree) {
      // Sólo las hojas: los nodos intermedios son agrupadores de Revit.
      const leaves = [];
      tree.enumNodeChildren(tree.getRootId(), function (dbId) {
        if (tree.getChildCount(dbId) === 0) leaves.push(dbId);
      }, true);

      if (!leaves.length) { setStatus('El modelo no expone árbol de objetos'); return; }
      leafCount = leaves.length;

      // La base de propiedades puede tardar o no llegar nunca. Sin esto la
      // barra se queda en «Indexando…» de forma indefinida y parece colgado.
      const limite = setTimeout(() => {
        if (!ready) setStatus('La lectura está tardando; recarga si no avanza');
      }, 45000);

      model.getBulkProperties2(
        leaves,
        { propFilter: PROPS, ignoreHidden: true },
        function (results) {
          clearTimeout(limite);
          const samples = [];
          let statusSeen = 0;
          let fuera = 0;   // elementos del archivo ajenos a las cuatro partidas

          for (const r of results) {
            const names = [];
            let tieneEjec = false, tienePlan = false;

            for (const p of r.properties) {
              const val = String(p.displayValue);
              if (!val) continue;
              if (EJEC_PROPS.includes(p.displayName)) {
                if (esFecha(val)) { tieneEjec = true; statusSeen++; }
              } else if (PLAN_PROPS.includes(p.displayName)) {
                if (esFecha(val)) { tienePlan = true; statusSeen++; }
              } else {
                names.push(val);
              }
            }
            const status = estadoPorFechas(tieneEjec);

            if (samples.length < 8 && names.length) samples.push(names.join(' | '));

            // Se anota el estado ANTES de exigir partida: el coloreado lo
            // aprovecha aunque el elemento no entre en los conteos.
            if (status === 'done' || status === 'pending') statusAll.set(r.dbId, status);

            // Partida y código de fila salen del MISMO patrón: sin código no
            // hay partida, así que el dashboard y el visor cuentan lo mismo.
            let partidaOf = null, code = null;
            for (const raw of names) {
              for (const [partida, re] of Object.entries(ELEMENT_MATCH)) {
                const m = raw.match(re);
                if (m) { partidaOf = partida; code = m[1].replace(/\s+/g, '-').toUpperCase(); break; }
              }
              if (partidaOf) break;
            }

            // Fuera del alcance: muros, losas, terreno… Ni se cuentan ni se
            // colorean, para no mezclar universos con el dashboard.
            if (!partidaOf) { fuera++; continue; }

            statusOf.set(r.dbId, status);
            add(byStatus, status, r.dbId);
            add(byPartida, partidaOf, r.dbId);

            for (const raw of names) {
              // Token exacto: "VM-1" no cae dentro de "VM-12".
              const tokens = raw.match(/[A-Za-zÁÉÍÓÚÑ]+[-\s]?\d+|Zapata\s+\w+/gi) || [];
              for (const t of tokens) add(byName, t.replace(/\s+/g, '-').toUpperCase(), r.dbId);
            }

            // Desglose por fila, para alimentar los conteos del dashboard.
            const rowName = ROW_LABEL[partidaOf](code);
            if (!byRow.has(partidaOf)) byRow.set(partidaOf, new Map());
            const bucket = byRow.get(partidaOf);
            if (!bucket.has(rowName)) bucket.set(rowName, { name: rowName, done: 0, total: 0 });
            const row = bucket.get(rowName);
            row.total++;
            if (status === 'done') row.done++;
          }

          /* Salvaguarda: si NINGUN elemento del modelo trae fecha, no es que
             la obra vaya al 0 % — es que no se pudieron leer los parametros
             (traduccion a medias, parametro sin exportar, nombre distinto al
             de STATUS_PROPS). Pintar el modelo entero de rojo seria mentir
             con seguridad, asi que en ese caso todo se queda sin dato y salta
             el aviso de mas abajo. */
          if (!statusSeen) {
            for (const id of statusOf.keys())  statusOf.set(id, 'unknown');
            for (const id of statusAll.keys()) statusAll.set(id, 'unknown');
            const pend = byStatus.get('pending');
            if (pend) { byStatus.set('unknown', pend); byStatus.delete('pending'); }
          }

          ready = true;
          renderLegend();
          publishModelData();

          const size = k => (byStatus.get(k) || new Set()).size;
          const alcance = size('done') + size('pending') + size('unknown');
          setStatus(`Partidas: ${size('done')} de ${alcance} ejecutados` +
                    (size('unknown') ? ` · ${size('unknown')} sin dato` : ''));

          /* ── Diagnóstico ── */
          console.info('[viewer-link] Elementos por partida →',
            Object.keys(ELEMENT_MATCH).map(k => `${k}:${(byPartida.get(k) || new Set()).size}`).join('  '),
            `| en alcance: ${alcance} de ${results.length} · fuera: ${fuera}`);
          let pa = 0, pb = 0;
          for (const v of statusAll.values()) { if (v === 'done') pa++; else pb++; }
          console.info('[viewer-link] fechaEjecucion →',
            `partidas con fecha:${size('done')} sin fecha:${size('pending')} · ` +
            `coloreado en todo el modelo con:${pa} sin:${pb} de ${leafCount} elementos`);

          if (!statusSeen) {
            console.warn(
              '[viewer-link] Ningún elemento trae el parámetro fechaEjecucion.\n' +
              '  · Comprueba el nombre exacto en el panel de propiedades del visor y añádelo a STATUS_PROPS.\n' +
              '  · Tiene que ser parámetro de EJEMPLAR, no de tipo: uno de tipo daría la misma fecha a toda la familia.\n' +
              '  · Si es un parámetro de proyecto no exportado, marca "Exportar a IFC/propiedades" en Revit.'
            );
          }
          const vacias = Object.keys(ELEMENT_MATCH).filter(k => !(byPartida.get(k) || []).size);
          if (vacias.length) {
            console.warn(
              `[viewer-link] Sin coincidencias de partida para: ${vacias.join(', ')}.\n` +
              'Ajusta ELEMENT_MATCH en assets/viewer-link.js. Valores de ejemplo del modelo:\n  ' +
              samples.join('\n  ')
            );
          }
        },
        function (err) { clearTimeout(limite); setStatus('No se pudieron leer las propiedades'); console.error('[viewer-link]', err); }
      );
    });
  }

  /* ── Publicación de conteos al dashboard ───────────────────────────────
     app.js sustituye sus tablas por esto y vuelve a renderizar. Si este
     evento no llega (visor caído, sin credenciales), el dashboard se queda
     con los datos de respaldo: nunca se ve una pantalla vacía. */
  function publishModelData() {
    const partidas = {};
    for (const [key, bucket] of byRow) partidas[key] = Array.from(bucket.values());
    window.dispatchEvent(new CustomEvent('dashboard:model-data', {
      detail: { partidas: partidas, corte: modelLabel }
    }));
  }

  /* ── Utilidades ────────────────────────────────────────────────────── */
  const idsOf = set => set ? Array.from(set) : [];

  function hex2vec(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return new THREE.Vector4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha ?? 1);
  }

  /* Aplica el modo de color vigente al conjunto de ids indicado
     (o a todo el modelo si no se pasa ninguno). */
  function paint(ids) {
    if (!viewer) return;
    viewer.clearThemingColors(viewer.model);
    if (window.apsOpacidad) window.apsOpacidad.restaurar(viewer);
    if (mode === 'none') return;

    if (mode === 'status') {
      // Aquí se usa statusAll, no statusOf: se colorea todo lo que tenga
      // dato, incluidos los perfiles de armadura que no pertenecen a
      // ninguna partida. Los conteos del dashboard no se tocan.
      const target = ids || Array.from(statusAll.keys());
      const conDato = target.filter(id => statusAll.has(id));
      // Sin dato = transparente: aislar a los que sí lo tienen deja al resto
      // en modo fantasma, sin tocar materiales.
      if (conDato.length && conDato.length < leafCount) viewer.isolate(conDato);
      const cache = {};
      const pendientes = [];
      for (const id of conDato) {
        const s = statusAll.get(id);
        cache[s] = cache[s] || hex2vec(STATUS_COLOR[s]);
        viewer.setThemingColor(id, cache[s], viewer.model, true);
        if (s === 'pending') pendientes.push(id);
      }
      /* La transparencia va en el material, no en el color de tema: el
         alpha de setThemingColor sólo pesa la mezcla del RGB. */
      if (window.apsOpacidad && pendientes.length)
        window.apsOpacidad.aplicar(viewer, viewer.model, pendientes, STATUS_OPACIDAD);
      return;
    }

    // mode === 'partida'
    const scope = ids ? new Set(ids) : null;   // Set, no Array: esto corre sobre miles de ids
    for (const [key, set] of byPartida) {
      const color = hex2vec(PARTIDA_COLOR[key]);
      for (const id of set) {
        if (scope && !scope.has(id)) continue;
        viewer.setThemingColor(id, color, viewer.model, true);
      }
    }
  }

  /* El «fantasma» es el gris translúcido con que el visor deja lo que no
     está aislado. Apagarlo hace que esos elementos desaparezcan del todo,
     que es lo que se quiere al mirar sólo lo ejecutado. Se vuelve a
     encender en cuanto se sale de ese modo: en el resto de vistas el
     fantasma es información útil, marca el contexto de lo aislado. */
  function fantasmas(on) {
    if (viewer && typeof viewer.setGhosting === 'function') viewer.setGhosting(on);
  }

  function resetView() {
    if (!viewer) return;
    fantasmas(true);
    mode = 'none';
    isolatedTo = null;
    viewer.clearThemingColors(viewer.model);
    if (window.apsOpacidad) window.apsOpacidad.restaurar(viewer);
    viewer.showAll();
    viewer.clearSelection();
    viewer.fitToView();
    renderLegend();
  }

  /* ── Acciones ──────────────────────────────────────────────────────── */
  function focusPartida(key) {
    if (!ready || !sync || !viewer) return;
    const ids = idsOf(byPartida.get(key));
    if (!ids.length) { setStatus(`Sin elementos para «${key}» en el modelo`); return; }

    // Aislar una partida no cambia el modo de color: si estabas viendo el
    // semáforo de avance, lo sigues viendo dentro de la partida aislada.
    if (mode === 'none') mode = 'partida';
    isolatedTo = key;

    fantasmas(true);
    viewer.isolate(ids);
    paint(ids);
    viewer.fitToView(ids, viewer.model);

    const done = ids.filter(i => statusAll.get(i) === 'done').length;
    setStatus(`${ids.length} elementos aislados · ${done} ejecutados`);
    renderLegend();
  }

  function focusElement(name) {
    if (!ready || !sync || !viewer) return;

    // El dashboard dice "Zapata Z1"; el modelo puede llamarlo "Z1".
    // Probamos el nombre completo y luego cada token por separado.
    const full = String(name).replace(/\s+/g, '-').toUpperCase();
    const candidates = [full, ...String(name).trim().split(/\s+/).map(t => t.toUpperCase()).reverse()];

    let ids = [];
    for (const key of candidates) {
      ids = idsOf(byName.get(key));
      if (ids.length) break;
    }
    if (!ids.length) { setStatus(`«${name}» no se encontró en el modelo`); return; }

    viewer.select(ids);
    viewer.fitToView(ids, viewer.model);
    const done = ids.filter(i => statusOf.get(i) === 'done').length;
    setStatus(`${name}: ${ids.length} ${ids.length === 1 ? 'elemento' : 'elementos'} · ${done} ${done === 1 ? 'ejecutado' : 'ejecutados'}`);
  }

  function setMode(next) {
    if (!ready || !viewer) return;
    mode = mode === next ? 'none' : next;
    fantasmas(true);
    paint(isolatedTo ? idsOf(byPartida.get(isolatedTo)) : null);
    renderLegend();
  }

  /* Deja en pantalla sólo lo ejecutado. Se toma de statusAll, no de
     byStatus, para incluir los perfiles de armadura que no pertenecen a
     ninguna partida pero sí están montados. */
  function isolateDone() {
    if (!ready || !viewer) return;
    const ids = [];
    for (const [id, s] of statusAll) if (s === 'done') ids.push(id);
    if (!ids.length) { setStatus('No hay elementos ejecutados en el modelo'); return; }
    mode = 'status';
    isolatedTo = null;
    // Sin fantasma: lo pendiente no se atenúa, se va de la pantalla.
    fantasmas(false);
    viewer.isolate(ids);
    paint(ids);
    viewer.fitToView(ids, viewer.model);
    setStatus(`${ids.length} elementos ejecutados aislados`);
    renderLegend();
  }

  /* ── Leyenda ───────────────────────────────────────────────────────── */
  function renderLegend() {
    const el = $('viewer-link-legend');
    if (!el) return;
    if (!ready || mode === 'none') { el.innerHTML = ''; return; }

    // La leyenda cuenta lo que HAY EN PANTALLA: si una partida está
    // aislada, sólo ese conjunto; si no, el modelo entero. Contar siempre
    // todo haría que los números no cuadraran con lo que se ve.
    const ambito = isolatedTo ? idsOf(byPartida.get(isolatedTo)) : null;
    let pintados = { done: 0, pending: 0 };
    if (ambito) {
      for (const id of ambito) { const v = statusAll.get(id); if (v) pintados[v]++; }
    } else {
      for (const v of statusAll.values()) pintados[v]++;
    }
    const total = ambito ? ambito.length : leafCount;
    const sinDato = total - (pintados.done + pintados.pending);
    const entries = mode === 'status'
      ? ['done', 'pending']
          .filter(k => pintados[k])
          .map(k => [STATUS_COLOR[k], `${STATUS_LABEL[k]} (${pintados[k]})`])
          // Los que no traen dato quedan transparentes; se declara en la leyenda.
          .concat(sinDato ? [['transparent', `${STATUS_LABEL.unknown} (${sinDato}) · transparentes`]] : [])
      : Array.from(byPartida.keys())
          .map(k => [PARTIDA_COLOR[k], `${k.toUpperCase()} (${byPartida.get(k).size})`]);

    el.innerHTML = entries.map(([color, label]) =>
      `<span style="display:inline-flex;align-items:center;gap:7px">
         <span style="width:10px;height:10px;border-radius:3px;background:${color};display:block;
                      ${color === 'transparent' ? 'border:1px solid var(--t-faint)' : ''}"></span>${label}
       </span>`).join('');
  }

  /* ── Cableado ──────────────────────────────────────────────────────── */
  // Sólo el visor estructural alimenta el dashboard. El federado emite el
  // mismo evento y hay que dejarlo pasar de largo.
  window.addEventListener('aps:viewer-ready', function (e) {
    if (e.detail.key !== 'estructural') return;
    buildIndex(e.detail.viewer, e.detail.label);
  });
  window.addEventListener('dashboard:partida', e => focusPartida(e.detail.key));
  window.addEventListener('dashboard:element', e => focusElement(e.detail.name));

  document.addEventListener('DOMContentLoaded', function () {
    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };

    on('viewer-link-sync', function () {
      sync = !sync;
      this.textContent = sync ? 'Vinculado al dashboard' : 'Vinculación pausada';
      this.style.opacity = sync ? '1' : '.55';
      if (!sync) resetView();
    });
    on('viewer-link-status-mode', function () { setMode('status'); });
    on('viewer-link-paint',       function () { setMode('partida'); });
    on('viewer-link-ejecutados',  isolateDone);
    on('viewer-link-reset',       function () { resetView(); setStatus(ready ? 'Vista restablecida' : ''); });
  });

  // Para depurar desde la consola del navegador.
  window.viewerLink = {
    get viewer() { return viewer; },
    get byName() { return byName; },
    get byPartida() { return byPartida; },
    get byStatus() { return byStatus; },
    focusPartida, focusElement, isolateDone, resetView,
    paintByStatus: () => setMode('status'),
    paintByPartida: () => setMode('partida')
  };
})();
