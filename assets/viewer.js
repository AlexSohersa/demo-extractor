/* ─────────────────────────────────────────────────────────────────────────
   Visores 3D · Autodesk Platform Services Viewer v7

   Monta un visor por cada elemento [data-viewer] del documento. Cada uno
   carga su propio modelo, identificado por data-model (que viaja como
   ?model= a la función aps-model).

   El montaje es PEREZOSO: un visor sólo se inicializa cuando su pestaña se
   muestra por primera vez. Inicializarlo dentro de un panel oculto daría un
   contenedor de tamaño cero y el canvas saldría roto.

   El token NUNCA vive en el navegador: se pide a /api/aps-token, que lo firma
   con el CLIENT_SECRET guardado en las variables de entorno.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Rutas de las funciones. En Netlify eran /.netlify/functions/<nombre>;
  // al migrar a Vercel pasan a /api/<nombre>, que es donde éste enruta los
  // archivos de la carpeta api/.
  const TOKEN_URL = '/api/aps-token';
  const MODEL_URL = '/api/aps-model';
  const COORD_URL = '/api/aps-coordination';   // Model Coordination (requiere cuenta de servicio; aún sin portar)
  const FED_URL   = '/api/aps-federado';       // lista de modelos de ACC Docs

  async function getJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${url} → HTTP ${res.status}. ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  /* El Initializer del SDK es global y se llama UNA sola vez, aunque haya
     varios visores. La región sale del primer modelo que responda. */
  let initPromise = null;
  function ensureInit(region) {
    if (initPromise) return initPromise;
    const emea = String(region || 'US').toUpperCase() === 'EMEA';
    initPromise = new Promise(function (resolve) {
      Autodesk.Viewing.Initializer({
        env: 'AutodeskProduction2',
        api: emea ? 'streamingV2_EU' : 'streamingV2',
        getAccessToken: async function (onSuccess, onError) {
          try {
            const t = await getJSON(TOKEN_URL);
            onSuccess(t.access_token, t.expires_in);
          } catch (err) {
            console.error('[aps-viewer] token:', err);
            if (onError) onError(err);
          }
        }
      }, resolve);
    });
    return initPromise;
  }

  /* ── Una instancia ─────────────────────────────────────────────────── */
  function mount(card) {
    const key   = card.dataset.viewer;                 // 'estructural' | 'federado'
    const query = card.dataset.model || '';            // '' | 'federado'
    const q     = sel => card.querySelector(sel);

    const host      = q('.viewer-host');
    const loadingEl = q('.viewer-loading');
    const errorEl   = q('.viewer-error');
    const errorMsg  = q('.viewer-error-msg');
    const errorDet  = q('.viewer-error-detail');
    const fallback  = q('.viewer-fallback');
    const metaEl    = q('.viewer-meta');
    const homeBtn   = q('.viewer-home');
    const fsBtn     = q('.viewer-fs');

    let viewer = null;

    function show(el) {
      for (const s of [loadingEl, errorEl]) if (s) s.hidden = s !== el;
    }
    function fail(msg, detail, kind) {
      show(errorEl);
      errorMsg.textContent = msg;
      errorDet.textContent = detail || '';
      if (fallback) fallback.hidden = kind === 'unconfigured';
      metaEl.textContent = kind === 'unconfigured' ? 'Pendiente de configurar' : 'Visor no disponible';
      if (kind !== 'unconfigured') console.error('[aps-viewer:' + key + ']', msg, detail || '');
    }

    async function start() {
      if (typeof Autodesk === 'undefined' || !Autodesk.Viewing) {
        return fail('No se pudo cargar el SDK del visor de Autodesk.',
                    'Revisa la conexión o si alguna política de red bloquea developer.api.autodesk.com');
      }

      // data-source="coordination" → la lista de modelos sale de la vista de
      // Model Coordination. Si no, es un único modelo de ACC Docs.
      const fuente = card.dataset.source || 'docs';
      const url = fuente === 'coordination' ? COORD_URL
                : fuente === 'federado'     ? FED_URL
                : MODEL_URL + (query ? '?model=' + encodeURIComponent(query) : '');

      let model;
      try {
        model = await getJSON(url);
      } catch (err) {
        return fail(fuente === 'docs'
          ? 'No se pudo resolver el modelo en Autodesk Construction Cloud.'
          : 'No se pudo resolver la lista de modelos federados.', err.message);
      }

      // Modelo aún no dado de alta: no es un fallo, es configuración pendiente.
      if (model.unconfigured) {
        return fail(model.message || 'Este visor todavía no tiene un modelo asignado.',
                    'Faltan variables de entorno: ' + (model.missing || []).join(', '),
                    'unconfigured');
      }
      // Un solo modelo o varios: a partir de aquí el flujo es el mismo.
      // El guid de la vista tiene que sobrevivir también aquí: al reconstruir
      // el objeto a mano se perdía, y el visor de un solo modelo acababa
      // abriendo la vista por defecto en lugar de la principal.
      const lista = Array.isArray(model.models) && model.models.length
        ? model.models
        : (model.urn ? [{ urn: model.urn, name: model.name, guid: model.guid }] : []);

      if (!lista.length) {
        return fail('No se obtuvo ningún modelo que cargar.',
                    'Revisa la configuración de «' + (query || 'principal') + '».');
      }

      await ensureInit(model.region);

      viewer = new Autodesk.Viewing.GuiViewer3D(host, {
        extensions: ['Autodesk.DocumentBrowser'],
        theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light-theme' : 'dark-theme'
      });

      const code = viewer.start();
      if (code > 0) return fail('El visor no pudo inicializarse.', 'Código ' + code);

      const cargarDoc = urn => new Promise((resolve, reject) => {
        Autodesk.Viewing.Document.load('urn:' + urn, resolve,
          (c, m) => reject(new Error('código ' + c + '. ' + (m || ''))));
      });

      let globalOffset = null;   // lo fija el primer modelo; alinea a los demás
      const cargados = [], fallidos = [], modelosCargados = [];

      for (let i = 0; i < lista.length; i++) {
        const m = lista[i];
        if (lista.length > 1) {
          metaEl.textContent = `Cargando ${i + 1} de ${lista.length}…`;
        }
        try {
          const doc = await cargarDoc(m.urn);
          const raiz = doc.getRoot();

          /* Qué vista 3D abrir.

             getDefaultGeometry() devuelve la PRIMERA vista 3D, y en varios de
             estos modelos ésa es una vista de coordinación sin geometría
             propia: el árbol de elementos sale completo y el visor, vacío.
             El servidor manda el guid de la vista principal — ver
             vistaPrincipal() en aps-model.mjs. */
          let node = null;
          if (m.guid && raiz.findByGuid) node = raiz.findByGuid(m.guid);
          if (!node) node = raiz.getDefaultGeometry();
          if (!node) { fallidos.push((m.name || m.urn) + ' (sin vista 3D)'); continue; }

          // keepCurrentModels agrega en vez de reemplazar.
          //
          // applyRefPoint va en TODOS, incluido el primero: es lo que aplica
          // la georreferenciación de Revit. Si el primero se carga sin él,
          // se queda en coordenadas locales mientras los demás se van a UTM,
          // y el conjunto acaba desperdigado por millones de unidades.
          //
          // globalOffset sólo lo lleva a partir del segundo, porque lo fija
          // el primero: es el punto común al que se recentra todo (y evita
          // perder precisión trabajando con cifras UTM enormes).
          const loaded = await viewer.loadDocumentNode(doc, node, {
            keepCurrentModels: i > 0,
            applyRefPoint: true,
            ...(globalOffset ? { globalOffset } : {})
          });
          if (!globalOffset) {
            const data = loaded && loaded.getData ? loaded.getData() : null;
            globalOffset = data && data.globalOffset ? data.globalOffset : null;
          }
          cargados.push(m.name || m.urn);
          if (loaded) modelosCargados.push({ name: m.name || m.urn, model: loaded });
        } catch (err) {
          fallidos.push((m.name || m.urn) + ' (' + err.message + ')');
        }
      }

      if (!cargados.length) {
        return fail('Ningún modelo se pudo cargar en el visor.', fallidos.join(' · '));
      }

      show(null);
      const label = lista.length > 1
        ? `${cargados.length} de ${lista.length} modelos` +
          (model.version ? ' · versión ' + model.version : '')
        : [model.name, model.versionNumber ? 'v' + model.versionNumber : null].filter(Boolean).join(' · ');
      metaEl.textContent = label || 'Modelo cargado';

      if (fallidos.length) console.warn('[aps-viewer:' + key + '] no cargaron:', fallidos.join(' · '));

      // Aviso de descoordinación: un modelo sin coordenadas compartidas
      // aterriza lejísimos del resto y obliga al visor a encuadrar medio
      // planeta. Vale más detectarlo que dejar la escena vacía sin explicación.
      if (cargados.length > 1) {
        const cajas = viewer.getAllModels().map(m => m.getBoundingBox());
        const centro = b => [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2];
        const ref = centro(cajas[0]);
        const lejos = [];
        cajas.forEach((b, i) => {
          const c = centro(b);
          const d = Math.hypot(c[0] - ref[0], c[1] - ref[1]);
          if (d > 5000) lejos.push((lista[i] && lista[i].name ? lista[i].name : 'modelo ' + i) +
                                   ' a ' + Math.round(d).toLocaleString('es-MX') + ' unidades');
        });
        if (lejos.length) {
          console.warn('[aps-viewer:' + key + '] fuera de las coordenadas del conjunto: ' +
                       lejos.join(' · ') + '. Revisa las coordenadas compartidas en Revit.');
          metaEl.textContent += ' · ' + lejos.length + (lejos.length === 1 ? ' descoordinado' : ' descoordinados');
        }
      }

      // Encuadre inicial. Llamarlo de inmediato deja la pantalla en blanco:
      // la geometría acaba de entrar y la cámara aún no sabe qué abarcar.
      // Se reintenta hasta que el encuadre cambie algo, y esa vista se fija
      // como «vista inicial» para que el botón devuelva exactamente aquí.
      const encuadrar = (intento = 0) => {
        viewer.fitToView();
        if (viewer.autocam && viewer.autocam.setCurrentViewAsHome) {
          try { viewer.autocam.setCurrentViewAsHome(true); } catch (e) { /* según versión */ }
        }
        if (intento < 3) setTimeout(() => encuadrar(intento + 1), 600);
      };
      setTimeout(encuadrar, 300);

      window.dispatchEvent(new CustomEvent('aps:viewer-ready', {
        detail: {
          key: key, viewer: viewer, label: label || null,
          count: cargados.length, models: modelosCargados
        }
      }));
    }

    /* ── Controles ─────────────────────────────────────────────────── */
    if (homeBtn) homeBtn.addEventListener('click', function () {
      if (viewer) viewer.navigation.setRequestHomeView(true);
    });
    if (fsBtn) fsBtn.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (host.requestFullscreen) host.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', function () {
      if (fsBtn) fsBtn.textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
      if (viewer && document.contains(host)) viewer.resize();
    });
    window.addEventListener('dashboard:theme', function (e) {
      if (viewer && viewer.setTheme) viewer.setTheme(e.detail.theme === 'light' ? 'light-theme' : 'dark-theme');
    });

    // Accesible desde la consola del navegador: window.apsViewers.federado
    window.apsViewers = window.apsViewers || {};
    Object.defineProperty(window.apsViewers, key, { get: () => viewer, configurable: true });

    return { start: start, resize: function () { if (viewer) viewer.resize(); } };
  }

  /* ── Registro y montaje perezoso ───────────────────────────────────── */
  const instances = new Map();   // panel key → { instance, started }

  function register() {
    for (const card of document.querySelectorAll('[data-viewer]')) {
      const panel = card.closest('[data-tab-panel]');
      const panelKey = panel ? panel.dataset.tabPanel : null;
      instances.set(panelKey, { card: card, instance: mount(card), started: false });
    }
    // Sin pestañas (o panel ya visible), arrancamos de inmediato.
    for (const [panelKey, rec] of instances) {
      const panel = panelKey ? document.querySelector(`[data-tab-panel="${panelKey}"]`) : null;
      if (!panel || !panel.hidden) startOnce(panelKey);
    }
  }

  function startOnce(panelKey) {
    const rec = instances.get(panelKey);
    if (!rec || rec.started) return;
    rec.started = true;
    rec.instance.start();
  }

  // tabs.js avisa al mostrar un panel: ahí es cuando el contenedor ya tiene
  // tamaño y el visor puede montarse o recalcular su canvas.
  window.addEventListener('tab:shown', function (e) {
    const rec = instances.get(e.detail.key);
    if (!rec) return;
    if (!rec.started) startOnce(e.detail.key);
    else rec.instance.resize();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
  else register();
})();
