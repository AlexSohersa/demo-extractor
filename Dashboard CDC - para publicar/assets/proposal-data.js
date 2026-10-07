/* ─────────────────────────────────────────────────────────────────────────
   Proveedor de elementos para el dashboard de avance general.

   ═══ QUÉ ES REAL Y QUÉ ESTÁ INVENTADO ═══

   REAL — sale de los modelos de ACC (assets/inventario.json, extraído con
   scripts/extraer-inventario.mjs):
     · el elemento y su GUID de Revit
     · disciplina (de qué modelo viene), categoría, workset
     · cantidades: longitud, longitud de corte, área, volumen
     · ELEMENTO TERMINADO, pero SÓLO en el modelo estructural, que es el
       único donde ese parámetro está lleno

   INVENTADO — porque el parámetro todavía no existe en el modelo:
     · precio unitario  (tabla PRECIOS, a precios de mercado mexicano)
     · fecha de planeación
     · fecha de ejecución

   El costo NO es un número inventado suelto: es
        precio unitario × cantidad REAL del modelo
   que es el modelo paramétrico que se usará en producción. Cuando lleguen
   los precios de verdad, se sustituye la tabla y nada más.

   ═══ LA COSTURA DE MIGRACIÓN ═══
   Cuando los parámetros existan en Revit, este archivo pasa a leerlos del
   inventario en vez de sintetizarlos. assets/proposal.js no se toca.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const INICIO = '2025-11-01';
  const FIN    = '2027-04-30';
  const CORTE  = '2026-08-18';
  const ALTURA_MURO = 3.0;           // m · para estimar área cuando falta

  /* Modelos que NO son obra contratada y por tanto no entran al avance.
     Topografía es de referencia: son 20 superficies de terreno que, medidas
     por m², se comían el 22 % del presupuesto. */
  const FUERA_DE_ALCANCE = ['Topografía'];

  /* ── Cuantificación: qué unidad le toca a cada categoría ───────────────
     La unidad la manda la CATEGORÍA, no lo que haya disponible. Dejar que
     gane «la primera cantidad que exista» produce disparates como zapatas
     medidas en metros lineales.

       campo : de dónde sale la cantidad — l longitud · c corte · a área ·
               v volumen · null = se cuenta por pieza
       est   : cómo estimarla si el modelo no la trae                      */
  const CUANTIFICACION = {
    // Redes: metro lineal
    'Pipes':                  { u:'m',   campo:'l' },
    'Conduits':               { u:'m',   campo:'l' },
    'Ducts':                  { u:'m',   campo:'l' },
    'Cable Trays':            { u:'m',   campo:'l' },
    'Flex Pipes':             { u:'m',   campo:'l' },
    'Flex Ducts':             { u:'m',   campo:'l' },
    'Duct Insulations':       { u:'m',   campo:'l' },
    'Pipe Insulations':       { u:'m',   campo:'l' },

    // Superficies: metro cuadrado
    'Walls':                  { u:'m2',  campo:'a', est: e => (e.l || 0) * ALTURA_MURO },
    'Floors':                 { u:'m2',  campo:'a' },
    'Ceilings':               { u:'m2',  campo:'a' },
    'Roofs':                  { u:'m2',  campo:'a' },
    'Curtain Panels':         { u:'m2',  campo:'a' },
    'Ramps':                  { u:'m2',  campo:'a' },

    // Estructura: mixta. Concreto por m³, acero por metro lineal de perfil.
    'Structural Framing':     { mixto: true },
    'Structural Columns':     { mixto: true },
    // Las zapatas traen longitud pero no volumen: no se pueden pagar por m³.
    'Structural Foundations': { u:'pza', campo:null },
    'Topography':             { u:'m2',  campo:'a' },

    // Todo lo demás — accesorios, muebles, equipos, luminarias — por pieza.
    '*':                      { u:'pza', campo:null }
  };

  // Dentro de estructura: si el nombre habla de concreto, es concreto.
  const ES_CONCRETO = /concreto|dado|castillo|grout|zapata|losa|muro/i;

  /* ── Precios unitarios ─────────────────────────────────────────────────
     INVENTADOS, a precios de mercado mexicano 2026, precio instalado
     (material + mano de obra). Clave: 'Disciplina|Categoría', con respaldo
     a 'Categoría' y luego al genérico de la unidad.

     Cuando exista el precio paramétrico real, se sustituye esta tabla.     */
  const PRECIOS = {
    // Hidráulico
    'Hidráulico|Pipes':               320,    // $/m  CPVC / cobre
    'Hidráulico|Pipe Fittings':       110,    // $/pza
    'Hidráulico|Plumbing Fixtures':  4800,    // $/pza  muebles
    'Hidráulico|Mechanical Equipment': 68000, // $/pza  bombas, hidroneumático
    'Hidráulico|Pipe Accessories':    850,    // $/pza  válvulas

    // Sanitario y pluvial
    'Sanitario|Pipes':                180,    // $/m  PVC sanitario
    'Sanitario|Pipe Fittings':         95,
    'Sanitario|Plumbing Fixtures':   5200,
    'Pluvial|Pipes':                  195,
    'Pluvial|Pipe Fittings':           95,
    'Pluvial|Plumbing Fixtures':     1400,    // coladeras

    // Gas y contra incendio
    'Gas|Pipes':                      450,    // $/m  acero cédula 40
    'Gas|Pipe Fittings':              260,
    'Gas|Pipe Accessories':          1900,
    'Contra incendio|Pipes':          780,    // $/m  acero ranurado
    'Contra incendio|Pipe Fittings':  340,
    'Contra incendio|Sprinklers':     980,
    'Contra incendio|Fire Alarm Devices': 2400,

    // HVAC
    'HVAC|Ducts':                     980,    // $/m  lámina galvanizada
    'HVAC|Duct Fittings':             620,
    'HVAC|Pipes':                     540,    // $/m  refrigeración, cobre aislado
    'HVAC|Pipe Fittings':             180,
    'HVAC|Air Terminals':            2600,    // $/pza  difusores y rejillas
    'HVAC|Mechanical Equipment':    92000,    // $/pza  minisplits, manejadoras
    'HVAC|Duct Insulations':          210,

    // Eléctrico
    'Eléctrico|Conduits':             145,    // $/m
    'Eléctrico|Conduit Fittings':      70,
    'Eléctrico|Cable Trays':          620,
    'Eléctrico|Lighting Fixtures':   1850,
    'Eléctrico|Electrical Fixtures':  420,    // contactos y apagadores
    'Eléctrico|Electrical Equipment': 32000,  // tableros
    'Eléctrico|Data Devices':        1900,
    'Eléctrico|Communication Devices': 2100,
    'Eléctrico|Security Devices':    3400,
    'Eléctrico|Fire Alarm Devices':  2400,

    // Estructura
    'Estructura|__concreto__':       4500,    // $/m3  igual que la pestaña 1
    'Estructura|__acero__':          1250,    // $/m   perfil metálico montado
    'Estructura|Structural Foundations': 18500, // $/pza  zapata + dado + placa
    'Estructura|Floors':             1150,    // $/m2  losa
    'Estructura|Walls':               520,

    // Arquitectura
    'Arquitectura|Walls':             520,    // $/m2  muro divisorio
    'Arquitectura|Floors':           1150,    // $/m2  piso y acabado
    'Arquitectura|Ceilings':          480,    // $/m2  plafón
    'Arquitectura|Doors':            9500,    // $/pza
    'Arquitectura|Windows':          6800,    // $/pza  cancelería
    'Arquitectura|Curtain Panels':   3200,    // $/m2
    'Arquitectura|Railings':          980,
    'Arquitectura|Stairs':          42000,
    'Arquitectura|Generic Models':   2800,
    'Arquitectura|Furniture':        4200,

    // Topografía
    'Topografía|Topography':           85,    // $/m2  despalme y trazo
    'Topografía|Site':              12000,

    // Respaldos por categoría, sin disciplina
    'Pipes':                          260,
    'Pipe Fittings':                  120,
    'Conduits':                       145,
    'Conduit Fittings':                70,
    'Walls':                          520,
    'Floors':                        1150,
    'Ceilings':                       480,
    'Structural Framing':            1250,
    'Structural Columns':            1250,
    'Generic Models':                2400,
    'Mechanical Equipment':         75000,
    'Plumbing Fixtures':             4600,
    'Lighting Fixtures':             1850,
    'Electrical Fixtures':            420,

    // Último recurso, por unidad
    '__m':                            240,
    '__m2':                           600,
    '__m3':                          4500,
    '__pza':                          950
  };

  /* ── Ventanas de programa e inercia por disciplina ─────────────────────
     INVENTADO. Refleja una secuencia constructiva razonable: la estructura
     va primero, los acabados al final, y cada frente arrastra su desfase.
       ventana : [mes inicio, mes fin] de las fechas de planeación
       retraso : días típicos entre lo planeado y lo ejecutado
       bloqueo : fracción que no se ejecuta aunque toque                    */
  const PROGRAMA = {
    'Estructura':      { ventana:[0.5,12], retraso:11, bloqueo:0.016 },
    'Topografía':      { ventana:[0,   3], retraso: 5, bloqueo:0.010 },
    'Arquitectura':    { ventana:[4,  16], retraso:16, bloqueo:0.020 },
    'Eléctrico':       { ventana:[3,  15], retraso:10, bloqueo:0.014 },
    'Hidráulico':      { ventana:[2,  13], retraso: 6, bloqueo:0.010 },
    'Sanitario':       { ventana:[2,  13], retraso: 8, bloqueo:0.012 },
    'Pluvial':         { ventana:[4,  14], retraso:14, bloqueo:0.018 },
    'HVAC':            { ventana:[5,  15], retraso:14, bloqueo:0.016 },
    'Gas':             { ventana:[6,  15], retraso:18, bloqueo:0.024 },
    'Contra incendio': { ventana:[5,  16], retraso:23, bloqueo:0.032 }
  };

  /* Los worksets son REALES; su desfase es inventado. Se asigna por hash del
     nombre para que sea estable y no haya que mantener una lista a mano. */
  function desfaseWorkset(nombre) {
    let h = 0;
    for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 9) - 3) * 9;      // −27 … +45 días
  }

  /* ── Utilidades ─────────────────────────────────────────────────────── */
  const MS_DIA = 86400000;
  const aDia = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / MS_DIA);
  const aISO = dia => new Date(dia * MS_DIA).toISOString().slice(0, 10);
  const DIA_INICIO = aDia(INICIO), DIA_FIN = aDia(FIN), DIA_CORTE = aDia(CORTE);
  const mesADia = m => DIA_INICIO + Math.round(m * 30.44);

  function semilla(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const campana = r => (r() + r() + r()) / 3;

  /* ── Cuantificación de un elemento ──────────────────────────────────── */
  function cuantificar(e, disciplina) {
    const cat = e.categoria || '';
    let regla = CUANTIFICACION[cat] || CUANTIFICACION['*'];

    if (regla.mixto) {
      const concreto = ES_CONCRETO.test(e.nombre || '');
      regla = concreto ? { u:'m3', campo:'v', clave:'__concreto__' }
                       : { u:'m',  campo:'c', clave:'__acero__', alt:'l' };
    }

    let cantidad = null, estimado = false;
    if (regla.campo) {
      cantidad = e[regla.campo];
      if (cantidad === undefined && regla.alt) cantidad = e[regla.alt];
      if (cantidad === undefined && regla.est) { cantidad = regla.est(e); estimado = true; }
    }
    if (!(cantidad > 0)) { cantidad = 1; return { u:'pza', cantidad:1, estimado: regla.u !== 'pza', clave: regla.clave }; }
    return { u: regla.u, cantidad, estimado, clave: regla.clave };
  }

  function precio(disciplina, categoria, clave, unidad) {
    if (clave && PRECIOS[disciplina + '|' + clave] !== undefined) return PRECIOS[disciplina + '|' + clave];
    if (PRECIOS[disciplina + '|' + categoria] !== undefined) return PRECIOS[disciplina + '|' + categoria];
    if (PRECIOS[categoria] !== undefined) return PRECIOS[categoria];
    return PRECIOS['__' + unidad] !== undefined ? PRECIOS['__' + unidad] : PRECIOS['__pza'];
  }

  /* ── Construcción de la lista ───────────────────────────────────────── */
  function construir(inv) {
    const r = semilla(20260818);
    const out = [];

    for (const m of inv.modelos) {
      if (FUERA_DE_ALCANCE.includes(m.disciplina)) continue;
      const prog = PROGRAMA[m.disciplina] || { ventana:[3,15], retraso:20, bloqueo:0.02 };
      const desde = mesADia(prog.ventana[0]), hasta = mesADia(prog.ventana[1]);
      // Sólo el modelo estructural trae ELEMENTO TERMINADO lleno; en los
      // demás el estado es inventado por completo.
      const tieneEstadoReal = m.elementos.some(e => e.t);

      for (const e of m.elementos) {
        const q = cuantificar(e, m.disciplina);
        const pu = precio(m.disciplina, e.categoria, q.clave, q.u);
        const ws = e.workset || 'Sin workset';

        const diaPlan = Math.round(desde + campana(r) * (hasta - desde));
        const ruido = (r() - 0.35) * prog.retraso * 2.2;
        let diaEjec = Math.round(diaPlan + prog.retraso + desfaseWorkset(ws) + ruido);
        const bloqueado = r() < prog.bloqueo;

        let fechaEjec;
        if (tieneEstadoReal) {
          // Se respeta el dato real: si el modelo dice terminado, la fecha
          // inventada cae antes del corte; si no, queda pendiente.
          fechaEjec = e.t ? aISO(Math.min(diaEjec, DIA_CORTE - 1 - Math.floor(r() * 30))) : null;
        } else {
          fechaEjec = (!bloqueado && diaEjec <= DIA_CORTE) ? aISO(diaEjec) : null;
        }

        out.push({
          id: m.disciplina.slice(0, 3).toUpperCase() + '-' + e.id,
          ext: e.ext,
          disciplina: m.disciplina,
          partida: e.categoria || 'Sin categoría',
          categoria: e.categoria || 'Sin categoría',
          subproyecto: ws,
          cantidad: Math.round(q.cantidad * 1000) / 1000,
          unidad: q.u,
          precioUnitario: pu,
          estimado: q.estimado,
          costo: Math.round(q.cantidad * pu * 100) / 100,
          fechaPlan: aISO(Math.min(Math.max(diaPlan, DIA_INICIO), DIA_FIN)),
          fechaEjec
        });
      }
    }
    return out;
  }

  /* ── API ────────────────────────────────────────────────────────────── */
  let CACHE = null, PROMESA = null, META = null;

  function cargar() {
    if (CACHE) return Promise.resolve(CACHE);
    if (PROMESA) return PROMESA;
    PROMESA = fetch('assets/inventario.json')
      .then(r => { if (!r.ok) throw new Error('inventario.json → HTTP ' + r.status); return r.json(); })
      .then(inv => {
        META = {
          generado: inv.generado,
          modelos: inv.modelos.map(m => ({
            disciplina: m.disciplina, archivo: m.archivo, version: m.version, n: m.elementos.length
          }))
        };
        CACHE = construir(inv);
        return CACHE;
      });
    return PROMESA;
  }

  global.ProposalData = {
    cargar,
    elementos: () => CACHE || [],
    meta: () => META,
    esSimulado: true,          // los precios y las fechas lo son; el resto no
    INICIO, FIN, CORTE,
    aDia, aISO,
    get IMPORTE_TOTAL() { return (CACHE || []).reduce((a, e) => a + e.costo, 0); },
    get DISCIPLINAS() {
      const s = new Map();
      for (const e of (CACHE || [])) s.set(e.disciplina, (s.get(e.disciplina) || 0) + e.costo);
      return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => ({ name }));
    },
    get SUBPROYECTOS() {
      const s = new Map();
      for (const e of (CACHE || [])) s.set(e.subproyecto, (s.get(e.subproyecto) || 0) + e.costo);
      return [...s.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n]) => n);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
