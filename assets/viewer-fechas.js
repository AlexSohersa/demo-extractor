/* ─────────────────────────────────────────────────────────────────────────
   Curva de avance en el tiempo: programa contra obra.

   Lee dos parámetros compartidos de cada elemento del modelo y publica el
   desglose por partida que app.js necesita para dibujar la curva:

       fechaPlaneacion  e03e636e-e850-4161-8d93-896c80a1d97b
       fechaEjecucion   0810e722-767a-4acf-ba5b-7235c50b86e4

   EL MODELO ES LA ÚNICA FUENTE. Este módulo no tiene datos propios: ni
   cronograma, ni fecha de corte, ni supuestos de secuencia de montaje.

   Antes sí los tenía, y por eso se llamaba viewer-ejes.js. Deducía la
   retícula del edificio a partir de la geometría —regresión sobre las
   columnas marcadas, agrupación de coordenadas en líneas, votación del
   nombre de cada eje— para cruzar cada elemento con un cronograma escrito a
   mano, y repartía las fechas de ejecución con una curva en S inventada.
   Todo aquello existía porque los parámetros no estaban en el modelo. Ahora
   están, así que se eliminó: eran unas 150 líneas produciendo información
   que no era cierta, y encima la retícula era precondición de la curva, de
   modo que si fallaba se perdía la gráfica entera.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* Las fechas son parámetros compartidos, así que Revit no las traduce y
     basta un nombre. Se dejan como lista por si alguien las renombra: es el
     mismo patrón que NAME_PROPS en viewer-link.js. */
  const P_PLAN = ['fechaPlaneacion'];
  const P_EJEC = ['fechaEjecucion'];
  const PROPS  = [].concat(P_PLAN, P_EJEC);

  // Primer alias que traiga valor; cadena vacía si ninguno.
  const val = (p, alias) => { for (const a of alias) if (p[a]) return p[a]; return ''; };

  /* ── Fechas ────────────────────────────────────────────────────────────
     Los dos parámetros son de TEXTO: Revit no valida nada y puede entrar
     cualquier cosa. Aquí se comparan como cadenas ISO (aaaa-mm-dd), que
     ordenan alfabéticamente igual que cronológicamente, así que se normaliza
     y se CUENTA lo que no se pudo interpretar, en vez de dejarlo pasar en
     silencio y que la curva mienta.

     Se aceptan:  14/07/2026 · 14-7-2026 · 2026-07-14 · 14/07/26 */
  const malFormadas = new Map();          // valor crudo → veces que apareció

  function aISO(crudo) {
    const s = String(crudo == null ? '' : crudo).trim();
    if (!s) return null;

    const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    let a, m, d;
    if (iso)      { a = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else if (dmy) { d = +dmy[1]; m = +dmy[2]; a = +dmy[3]; if (a < 100) a += 2000; }
    else { malFormadas.set(s, (malFormadas.get(s) || 0) + 1); return null; }

    // Que sea una fecha de verdad, no sólo que lo parezca: el 31/02 se cae.
    const f = new Date(Date.UTC(a, m - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) {
      malFormadas.set(s, (malFormadas.get(s) || 0) + 1);
      return null;
    }
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  let viewer = null;
  let asignacion = new Map();      // dbId → { fechaPlaneada, fechaEjecucion }
  let reintentoPendiente = false;

  const setStatus = t => console.info('[viewer-fechas]', t);

  /* ── Lectura del modelo ────────────────────────────────────────────────
     Sólo propiedades: ya no hace falta esperar a la geometría ni recorrer
     las cajas envolventes, que era lo que tardaba. */
  function analizar() {
    if (!viewer) return;
    const m = viewer.model;
    setStatus('Leyendo fechas de seguimiento…');

    m.getObjectTree(tree => {
      const hojas = [];
      tree.enumNodeChildren(tree.getRootId(), id => {
        if (tree.getChildCount(id) === 0) hojas.push(id);
      }, true);
      if (!hojas.length) { setStatus('El modelo no expone árbol de objetos'); return; }

      m.getBulkProperties2(hojas, { propFilter: PROPS }, res => {
        asignacion = new Map();
        for (const o of res) {
          const p = {};
          for (const x of o.properties) p[x.displayName] = String(x.displayValue);
          asignacion.set(o.dbId, {
            fechaPlaneada:  aISO(val(p, P_PLAN)),
            fechaEjecucion: aISO(val(p, P_EJEC))
          });
        }
        informarFechas();
        publicar();
      }, () => setStatus('No se pudieron leer las propiedades'));
    }, () => setStatus('No se pudo leer el árbol de objetos'));
  }

  /* Cuánto del programa y de la ejecución está capturado y cuánto no.

     Interesa que se vea: mientras haya elementos sin fecha, la curva se
     queda corta y conviene saber por cuánto. */
  function informarFechas() {
    let conPlan = 0, conEjec = 0;
    for (const a of asignacion.values()) {
      if (a.fechaPlaneada) conPlan++;
      if (a.fechaEjecucion) conEjec++;
    }
    const n = asignacion.size;
    console.info('[viewer-fechas] fechaPlaneacion:', conPlan, 'de', n);
    console.info('[viewer-fechas] fechaEjecucion:', conEjec, 'de', n);
    if (!conPlan && !conEjec) {
      console.warn('[viewer-fechas] Ningún elemento trae fechas de seguimiento.\n' +
                   '  · Comprueba el nombre exacto en el panel de propiedades del visor.\n' +
                   '  · Tienen que ser parámetros de EJEMPLAR, no de tipo.\n' +
                   '  · Si son parámetros de proyecto sin exportar, márcalos en Revit.');
    }
    if (malFormadas.size) {
      console.warn('[viewer-fechas] fechas que no se pudieron interpretar:',
                   [...malFormadas].map(([v, c]) => '«' + v + '» x' + c).join(' · '),
                   '· son parámetros de texto, revisar la captura en Revit');
    }
  }

  /* ── Publicación ──────────────────────────────────────────────────────
     Se publica el desglose POR PARTIDA, no un conteo plano: el dashboard
     pondera el avance por el importe de cada partida y la curva tiene que
     usar exactamente la misma regla, o la gráfica y el KPI de arriba dan
     cifras distintas para lo mismo. La fórmula vive en app.js; aquí sólo se
     le entregan los conteos que necesita. */
  function publicar() {
    const partidaDe = new Map();
    if (window.viewerLink && window.viewerLink.byPartida) {
      for (const [k, set] of window.viewerLink.byPartida) for (const id of set) partidaDe.set(id, k);
    }

    /* viewer-link indexa por su cuenta y puede no haber terminado. Sin su
       mapa de partidas el bucle de abajo descartaría todo y se publicaría
       una curva vacía, así que se espera su aviso y se reintenta una vez. */
    if (!partidaDe.size) {
      if (!reintentoPendiente) {
        reintentoPendiente = true;
        console.info('[viewer-fechas] viewer-link todavía no tiene partidas; ' +
                     'la curva se publica cuando termine de indexar');
        window.addEventListener('dashboard:model-data', () => publicar(), { once: true });
      } else {
        console.warn('[viewer-fechas] viewer-link terminó sin asignar ninguna partida: ' +
                     'la curva se queda sin datos. Revisa ELEMENT_MATCH en viewer-link.js.');
      }
      return;
    }

    const vacio = () => ({ cim: 0, vm: 0, cm: 0, ar: 0 });
    const totales = vacio();
    const plan = new Map(), ejec = new Map();

    for (const [id, a] of asignacion) {
      const k = partidaDe.get(id);
      if (!k) continue;                 // fuera de las cuatro partidas del dashboard
      totales[k]++;
      if (a.fechaPlaneada) {
        if (!plan.has(a.fechaPlaneada)) plan.set(a.fechaPlaneada, vacio());
        plan.get(a.fechaPlaneada)[k]++;
      }
      if (a.fechaEjecucion) {
        if (!ejec.has(a.fechaEjecucion)) ejec.set(a.fechaEjecucion, vacio());
        ejec.get(a.fechaEjecucion)[k]++;
      }
    }

    const ordenar = m => [...m.entries()].sort(([x], [y]) => x < y ? -1 : 1)
      .map(([fecha, n]) => ({ fecha, n }));

    /* La fecha de corte también sale del modelo: es la última fechaEjecucion
       registrada. Si obra captura un día más, el corte se mueve solo en la
       siguiente carga. */
    const corte = [...ejec.keys()].sort().pop() || null;

    const enPartidas = Object.values(totales).reduce((s, n) => s + n, 0);
    console.info('[viewer-fechas] curva ponderable:', enPartidas, 'elementos en partidas',
                 JSON.stringify(totales), '· corte', corte || '(sin ejecución)');

    window.dispatchEvent(new CustomEvent('dashboard:planeacion', {
      detail: { plan: ordenar(plan), ejec: ordenar(ejec), totales, corte }
    }));
  }

  /* ── Cableado ──────────────────────────────────────────────────────── */
  window.addEventListener('aps:viewer-ready', e => {
    if (e.detail.key !== 'estructural') return;
    viewer = e.detail.viewer;
    analizar();
  });

  window.viewerFechas = {
    get asignacion() { return asignacion; },
    get malFormadas() { return malFormadas; },
    analizar,
    exportar() { return [...asignacion.entries()].map(([id, a]) => ({ id, ...a })); }
  };
})();
