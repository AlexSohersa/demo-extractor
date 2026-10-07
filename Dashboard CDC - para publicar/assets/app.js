/* ─────────────────────────────────────────────────────────────────────────
   Dashboard de avance estructural · Proyecto CDC
   Reescritura en JS plano del artifact original (React + dc-runtime).
   Sin build, sin dependencias. Los datos viven en DATA, abajo.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── Parámetros de ponderación ────────────────────────────────────────
     Antes eran props editables del artifact; ahora son constantes. */
  const PRECIO_CONCRETO = 4500;   // $/m³
  const PRECIO_ACERO_KG = 45;     // $/kg
  const DEFAULT_THEME   = 'dark';

  /* ── Datos ─────────────────────────────────────────────────────────────
     EL MODELO ES LA UNICA FUENTE DE LOS CONTEOS. Aqui no hay ni una cifra
     de avance escrita a mano.

     Antes si la habia: una tabla de julio con los colocados/modelados de
     cada partida. Se pintaba de inmediato al cargar y el modelo la
     sobrescribia al terminar de indexar, asi que la pagina arrancaba en
     50.4 % y saltaba al 93 % unos segundos despues. Peor: si el visor no
     cargaba —token caido, traduccion a medias, red bloqueada— se quedaba en
     50.4 % PARA SIEMPRE, y el indicador de la cabecera decia «Modelo al
     dia». Un numero inventado presentado como real.

     Ahora, sin modelo no hay cifras: se muestra el estado de espera y, si
     no llega, se dice que no llego. Ver renderEspera().

     Lo que sigue en tabla son CANTIDADES de obra (m³, m, kg/m) y PRECIOS.
     Los precios son un dato de negocio, no del modelo. Las cantidades si
     podrian leerse del modelo (Volumen, Longitud de corte y Peso nominal
     del tipo existen); mientras no se lean, la ponderacion por importe
     sigue apoyada en PARTIDA_META. */
  const CONCRETE_VOL = [
    {name:'Zapatas', v:317.17}, {name:'Contratrabes', v:93.42}, {name:'Dados', v:68.85},
    {name:'Castillos', v:13.14}, {name:'Grout', v:1.66}
  ];

  /* Desglose por elemento de cada partida. null hasta que hable el modelo. */
  let ROWS = null;

  const METAL_SETS = {
    cim: {title: 'Cimentación · zapata + dado + placa', label: 'Cimentación'},
    vm:  {title: 'Trabes estructurales VM',             label: 'Trabes VM'},
    cm:  {title: 'Columnas metálicas CM',               label: 'Columnas CM'},
    ar:  {title: 'Armaduras estructurales AR',          label: 'Armaduras AR'}
  };

  // Ponderación por importe de costo directo estimado.
  // Metálica: longitud modelada x peso nominal x precio $/kg.
  // Cimentación: volumen de concreto armado x precio $/m3.
  // done/total ya no se escriben: son la suma de ROWS[key].
  const PARTIDA_META = [
    {key:'cim', name:'Cimentación',  medida:'494.24 m³', qty:494.24, kgm:0},
    {key:'vm',  name:'Trabes VM',    medida:'2,744 m',   qty:2744,   kgm:28.3},
    {key:'cm',  name:'Columnas CM',  medida:'642 m',     qty:642,    kgm:38.7},
    {key:'ar',  name:'Armaduras AR', medida:'1,779 m',   qty:1779,   kgm:20}
  ];

  const sumBy = (rows, field) => rows.reduce((a, r) => a + r[field], 0);

  /* Partidas con los conteos vigentes (respaldo o modelo, según toque). */
  function partidas() {
    return PARTIDA_META.map(m => {
      const rows = ROWS[m.key] || [];
      return Object.assign({}, m, { done: sumBy(rows, 'done'), total: sumBy(rows, 'total') });
    });
  }

  const STEEL_KG = [{name:'PTR (tubular)', v:103578},{name:'Trabes IR', v:77659}];
  const STEEL_M  = [{name:'Trabes IR', v:2744},{name:'PTR (tubular)', v:1846},
                    {name:'Perfil C (viga secundaria)', v:1190},{name:'Columnas CM', v:720}];

  /* ── Helpers ───────────────────────────────────────────────────────── */
  const SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];
  const C = 2 * Math.PI * 76;
  const nf = (v, d) => v.toLocaleString('es-MX', {minimumFractionDigits: d, maximumFractionDigits: d});
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const pctColor = p => p >= 100 ? 'var(--ok)' : p === 0 ? 'var(--info)' : p < 33 ? 'var(--crit)' : p <= 66 ? 'var(--warn)' : 'var(--ok)';

  const CHIP_BASE = "border-radius:10px;padding:9px 18px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;cursor:pointer;transition:all 140ms ease-out;";
  const chip = active => CHIP_BASE + (active
    ? 'background:var(--green-tint);border:1px solid var(--accent);color:var(--accent);'
    : 'background:transparent;border:1px solid var(--line);color:var(--t-muted);');

  const MONO   = "font-family:'IBM Plex Mono',ui-monospace,monospace;";
  const GROT   = "font-family:'Space Grotesk',system-ui,sans-serif;";
  const EYEBROW = MONO + 'font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t-muted)';

  /* Segmentos de dona: mismos cálculos que el artifact original. */
  function donut(rows, fmt) {
    const total = rows.reduce((a, r) => a + r.v, 0);
    let acc = 0;
    return rows.map((r, i) => {
      const frac = r.v / total;
      const len = frac * C;
      const off = -acc * C;
      acc += frac;
      const valueStr = fmt(r.v);
      const pctStr = nf(frac * 100, frac * 100 < 1 ? 1 : 0) + ' %';
      return {
        name: r.name,
        color: SERIES[i % SERIES.length],
        valueStr, pctStr,
        dash: (len - 1.5) + ' ' + (C - len + 1.5),
        offset: off
      };
    });
  }

  /* ── Estado ────────────────────────────────────────────────────────── */
  const state = {
    theme: DEFAULT_THEME === 'light' ? 'light' : 'dark',
    donutMode: 'count',   // 'count' | 'vol'
    metalSet: 'cim',      // 'cim' | 'vm' | 'cm' | 'ar'
    steelMode: 'kg',      // 'kg' | 'm'
    hover: -1,            // índice hover en la dona de cimentación
    steelHover: -1        // índice hover en la dona de acero
  };

  /* Derivados que dependen sólo de donutMode / steelMode: los recalcula render(). */
  let view = null;

  /* Origen de los conteos: 'tabla' hasta que el modelo responda. */
  let dataSource = 'tabla';

  /* Curva S de planeación. La publica viewer-fechas.js leyendo las dos fechas
     elemento por eje y cruzarlo con el cronograma de obra. */
  let planeacion = null;

  const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fechaCorta = iso => {
    const [a, m, d] = iso.split('-');
    return +d + ' ' + MESES_CORTOS[+m - 1] + ' ' + a.slice(2);
  };

  /* Peso de cada partida en el avance general, por importe de obra.
     ES LA MISMA fórmula que usa compute() para el KPI ponderado: si la curva
     usara otra, la gráfica y la tarjeta de arriba darían cifras distintas
     para lo mismo. */
  function pesosPorPartida() {
    const P = partidas();
    const importe = p => p.kgm ? p.qty * p.kgm * PRECIO_ACERO_KG : p.qty * PRECIO_CONCRETO;
    const total = P.reduce((a, p) => a + importe(p), 0);
    const w = {};
    for (const p of P) w[p.key] = importe(p) / total;
    return w;
  }

  /* Acumula una serie de conteos por partida y devuelve el % PONDERADO en
     cada fecha: Σ (hechos/total de la partida) × su peso por importe. */
  function acumularPonderado(serie, totales, pesos) {
    const acum = { cim: 0, vm: 0, cm: 0, ar: 0 };
    return serie.map(p => {
      let n = 0;
      for (const k of Object.keys(acum)) { acum[k] += p.n[k] || 0; n += p.n[k] || 0; }
      let pct = 0;
      for (const k of Object.keys(acum)) {
        if (totales[k]) pct += (acum[k] / totales[k]) * pesos[k];
      }
      return { fecha: p.fecha, eje: p.eje, n, pct: pct * 100,
               acumulado: Object.values(acum).reduce((a, b) => a + b, 0) };
    });
  }

  /* Curva S: avance ponderado acumulado en cada fecha. El eje horizontal es
     TIEMPO REAL, no una fecha por paso: si no, los tramos apretados de
     agosto se verían igual de anchos que los de tres semanas y la curva
     mentiría sobre el ritmo. */
  function curvaSVG() {
    const pesos = pesosPorPartida();
    const c = acumularPonderado(planeacion.plan, planeacion.totales, pesos);
    const cr = acumularPonderado(planeacion.ejec, planeacion.totales, pesos);
    if (c.length < 2) return '';
    const W = 980, H = 360, L = 46, R = 18, T = 20, B = 52;

    const dia = iso => Date.parse(iso + 'T00:00:00Z') / 86400000;
    const t0 = dia(c[0].fecha), t1 = dia(c[c.length - 1].fecha);
    const x = iso => L + (dia(iso) - t0) / (t1 - t0) * (W - L - R);
    const y = pct => T + (100 - pct) * (H - T - B) / 100;

    const pts = c.map(p => ({ x: x(p.fecha), y: y(p.pct), p }));
    const linea = pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' ');
    const area = linea + ` L${pts[pts.length-1].x.toFixed(1)} ${y(0)} L${pts[0].x.toFixed(1)} ${y(0)} Z`;

    const rejilla = [0, 25, 50, 75, 100].map(v => `
      <line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"></line>
      <text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="var(--t-faint)" style="${MONO}font-size:11px">${v}%</text>`).join('');

    // Marca de hoy, e interpolación de lo que tocaría llevar
    const hoyISO = new Date().toISOString().slice(0, 10);
    const hoy = dia(hoyISO);
    let marcaHoy = '', debido = null;
    if (hoy >= t0 && hoy <= t1) {
      for (let i = 1; i < c.length; i++) {
        if (dia(c[i].fecha) >= hoy) {
          const a_ = c[i-1], b_ = c[i];
          const f = (hoy - dia(a_.fecha)) / (dia(b_.fecha) - dia(a_.fecha) || 1);
          debido = a_.pct + (b_.pct - a_.pct) * f;
          break;
        }
      }
      const xh = x(hoyISO);
      marcaHoy = `
        <line x1="${xh}" y1="${T}" x2="${xh}" y2="${H-B}" stroke="var(--t-low)" stroke-width="1.5" stroke-dasharray="3 4"></line>
        <text x="${xh}" y="${T-5}" text-anchor="middle" fill="var(--t-low)" style="${MONO}font-size:10px;letter-spacing:.14em">HOY</text>`
        + (debido !== null ? `<circle cx="${xh}" cy="${y(debido)}" r="5" fill="var(--warn)"></circle>` : '');
    }

    // Etiquetas de fecha: sólo las que caben sin amontonarse
    let ultimaX = -99;
    const ticks = c.map(p => {
      const xp = x(p.fecha);
      if (xp - ultimaX < 62) return '';
      ultimaX = xp;
      return `<text x="${xp}" y="${H-B+20}" text-anchor="middle" fill="var(--t-faint)" style="${MONO}font-size:10px">${fechaCorta(p.fecha)}</text>`;
    }).join('');

    const puntos = pts.map(q => `
      <circle cx="${q.x}" cy="${q.y}" r="4" fill="var(--info)"
              data-tip-label="${esc(q.p.eje ? 'Eje ' + q.p.eje : fechaCorta(q.p.fecha))}"
              data-tip-value="${esc(nf(q.p.pct,1) + ' % acumulado  ·  +' + nf(q.p.n,0) + ' elementos')}"
              style="cursor:pointer"></circle>`).join('');

    /* Curva real. Se dibuja sobre el mismo total, así que la separación
       vertical entre las dos líneas es directamente la ventaja o el retraso
       de la obra en cada momento. Se corta en el día de hoy: más allá no hay
       nada ejecutado que mostrar. */
    let real = '', avance = null;
    if (cr.length > 1) {
      const rp = cr.filter(p => dia(p.fecha) >= t0 && dia(p.fecha) <= t1)
                   .map(p => ({ x: x(p.fecha), y: y(p.pct), p }));
      if (rp.length > 1) {
        const lr = rp.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' ');
        const ult = rp[rp.length - 1];
        real = `
          <path d="${lr}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"></path>
          <circle cx="${ult.x}" cy="${ult.y}" r="6" fill="var(--accent)"></circle>
          <rect x="${ult.x - 24}" y="${T}" width="48" height="${H-T-B}" fill="transparent"
                data-tip-label="Avance real al corte"
                data-tip-value="${esc(nf(ult.p.pct,1) + ' % · ' + nf(ult.p.acumulado,0) + ' elementos ejecutados')}"></rect>`;
        avance = ult.p.pct;
      }
    }

    const desvio = (avance !== null && debido !== null) ? avance - debido : null;

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible">
        ${rejilla}
        <path d="${area}" fill="var(--info)" opacity=".12"></path>
        <path d="${linea}" fill="none" stroke="var(--info)" stroke-width="3" stroke-linejoin="round"></path>
        ${real}
        ${puntos}${marcaHoy}${ticks}
      </svg>
      <div style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-faint);text-transform:uppercase;margin-top:8px">
        ${nf(Object.values(planeacion.totales).reduce((a,b)=>a+b,0),0)} elementos ponderados por importe · de ${fechaCorta(c[0].fecha)} a ${fechaCorta(c[c.length-1].fecha)}
        ${debido !== null ? ` · planeado hoy ${nf(debido,1)} %` : ''}
        ${avance !== null ? ` · real ${nf(avance,1)} %` : ''}
      </div>`;
  }

  function seccionPlaneacion() {
    if (!planeacion || !planeacion.plan || planeacion.plan.length < 2) return '';
    const leyenda = [['var(--info)','Planeado'], ['var(--accent)','Real']].map(([col, txt]) => `
      <div style="display:flex;align-items:center;gap:9px">
        <span style="width:18px;height:3px;background:${col};display:block;border-radius:2px"></span>
        <span style="${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-muted)">${txt}</span>
      </div>`).join('');
    return `
      <section>
        <div class="sec-head">
          <h2 class="sec">Planeación contra avance real.</h2>
          <span class="eyebrow">Mismo total en las dos líneas</span>
        </div>
        <div class="card">
          <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">${leyenda}</div>
          <div class="well">${curvaSVG()}</div>
        </div>
      </section>`;
  }

  /* ── Cálculo ───────────────────────────────────────────────────────── */
  function compute() {
    const PARTIDAS = partidas();
    const importe = p => p.kgm ? p.qty * p.kgm * PRECIO_ACERO_KG : p.qty * PRECIO_CONCRETO;
    const impTotal = PARTIDAS.reduce((a, p) => a + importe(p), 0);
    const frac = p => p.total ? p.done / p.total : 0;
    const weighted = PARTIDAS.reduce((a, p) => a + frac(p) * (importe(p) / impTotal), 0) * 100;
    const doneEls  = PARTIDAS.reduce((a, p) => a + p.done, 0);
    const totalEls = PARTIDAS.reduce((a, p) => a + p.total, 0);

    // El donut por nº de elementos sigue al desglose vigente de cimentación;
    // el de volumen es cantidad de obra y se queda en la tabla.
    const cimRows = state.donutMode === 'count'
      ? ROWS.cim.map(r => ({name: r.name, v: r.total}))
      : CONCRETE_VOL;
    const fmtCim = state.donutMode === 'count'
      ? (v => nf(v, 0) + (v === 1 ? ' pza' : ' pzas'))
      : (v => nf(v, 2) + ' m³');
    const cimTotal = cimRows.reduce((a, r) => a + r.v, 0);

    const set    = Object.assign({}, METAL_SETS[state.metalSet], { rows: ROWS[state.metalSet] || [] });
    const mDone  = sumBy(set.rows, 'done');
    const mTotal = sumBy(set.rows, 'total');
    const mPct   = mTotal ? mDone / mTotal * 100 : 0;
    const rowMax = set.rows.length ? Math.max.apply(null, set.rows.map(r => r.total)) : 1;

    const steelRows  = state.steelMode === 'kg' ? STEEL_KG : STEEL_M;
    const steelUnit  = state.steelMode === 'kg' ? 'kg' : 'm';
    const steelTotal = steelRows.reduce((a, r) => a + r.v, 0);

    return {
      PARTIDAS, importe, impTotal, weighted, doneEls, totalEls,
      cimRows, fmtCim, cimTotal,
      cimSegments: donut(cimRows, fmtCim),
      set, mDone, mTotal, mPct, rowMax,
      steelRows, steelUnit, steelTotal,
      steelSegments: donut(steelRows, v => nf(v, 0) + ' ' + steelUnit)
    };
  }

  /* ── Fragmentos de plantilla ───────────────────────────────────────── */

  function donutSvg(kind, segs) {
    return `
      <svg viewBox="0 0 200 200" width="260" height="260" style="display:block;overflow:visible">
        <g transform="rotate(-90 100 100)">
          ${segs.map((s, i) => `<circle cx="100" cy="100" r="76" fill="none"
             stroke="${s.color}" stroke-width="26"
             stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}" opacity="1"
             data-seg="${kind}" data-i="${i}"
             data-tip-label="${esc(s.name)}" data-tip-value="${esc(s.valueStr + '  ·  ' + s.pctStr)}"
             style="cursor:pointer;transition:stroke-width 140ms ease-out,opacity 140ms ease-out"></circle>`).join('')}
        </g>
      </svg>`;
  }

  function donutLegend(kind, segs) {
    return segs.map((s, i) => `
      <div data-segrow="${kind}" data-i="${i}"
           data-tip-label="${esc(s.name)}" data-tip-value="${esc(s.valueStr + '  ·  ' + s.pctStr)}"
           style="display:flex;align-items:baseline;gap:12px;padding:9px 12px;border-radius:10px;cursor:pointer;transition:background 140ms ease-out;background:transparent">
        <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${s.color}"></span>
        <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:15px;color:var(--t-mid);flex:1;min-width:0">${esc(s.name)}</span>
        <span style="${GROT}font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:var(--t-hi);white-space:nowrap">${esc(s.valueStr)}</span>
        <span style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-muted);text-align:right;white-space:nowrap">${esc(s.pctStr)}</span>
      </div>`).join('');
  }

  function donutCenter(kind, label, value, sub) {
    return `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;pointer-events:none;text-align:center;padding:0 42px">
        <div id="${kind}-center-label" style="${EYEBROW}">${esc(label)}</div>
        <div id="${kind}-center-value" style="${GROT}font-weight:700;font-size:30px;line-height:1;letter-spacing:-.025em;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--t-hi)">${esc(value)}</div>
        <div id="${kind}-center-sub" style="${MONO}font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t-faint)">${esc(sub)}</div>
      </div>`;
  }

  function kpi(label, value, color) {
    return `
      <div style="display:flex;flex-direction:column;gap:6px">
        <span style="${EYEBROW}">${esc(label)}</span>
        <span style="${GROT}font-weight:700;font-size:26px;font-variant-numeric:tabular-nums;color:${color}">${esc(value)}</span>
      </div>`;
  }

  /* ── Render ────────────────────────────────────────────────────────── */
  /* Sin datos del modelo no se pinta ningun numero. */
  let esperaVencida = false;

  function renderEspera() {
    const fallo = esperaVencida;
    applySourceBadge();
    document.getElementById('dashboard-root').innerHTML = `
      <section>
        <div class="card" style="gap:18px;align-items:flex-start">
          <div style="${GROT}font-weight:700;font-size:30px;line-height:1.1;letter-spacing:-.025em;color:var(--t-hi)">
            ${fallo ? 'No se pudo leer el modelo.' : 'Leyendo el modelo…'}
          </div>
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted);max-width:62ch;line-height:1.65">
            ${fallo
              ? 'El visor no respondió o el modelo no expone los parámetros de seguimiento. ' +
                'Sin ellos no hay cifras que mostrar.'
              : 'Las cifras salen del modelo. Puede tardar un minuto.'}
          </div>
        </div>
      </section>`;
  }

  function render() {
    if (!ROWS) { renderEspera(); return; }
    view = compute();
    const v = view;

    /* ── Sección 1: avance general ponderado ── */
    const stack = v.PARTIDAS.map((p, i) => {
      const contrib = (p.total ? p.done / p.total : 0) * (v.importe(p) / v.impTotal) * 100;
      return `<div data-tip-label="${esc(p.name + ' · aporte al general')}"
                   data-tip-value="${esc(nf(contrib, 1) + ' % de 100 %')}"
                   style="height:100%;transition:width 400ms ease-out;cursor:pointer;width:${contrib}%;background:${SERIES[i % SERIES.length]}"></div>`;
    }).join('');

    const cards = v.PARTIDAS.map((p, i) => {
      const pct = p.total ? p.done / p.total * 100 : 0;
      const w = v.importe(p) / v.impTotal * 100;
      const col = pctColor(pct);
      const active = state.metalSet === p.key;
      return `
        <button type="button" data-act="set-metal" data-key="${p.key}"
                data-tip-label="${esc(p.name)}"
                data-tip-value="${esc(nf(p.done, 0) + ' / ' + nf(p.total, 0) + ' elementos  ·  peso ' + nf(w, 1) + ' %')}"
                style="display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:14px;text-align:left;font:inherit;cursor:pointer;transition:background 140ms ease-out,border-color 140ms ease-out;background:var(--well);border:1px solid ${active ? 'var(--accent)' : 'var(--line)'}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${SERIES[i % SERIES.length]}"></span>
              <span style="${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-muted);white-space:nowrap">${esc(p.name)}</span>
            </div>
            <span style="${MONO}font-size:9px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;padding:3px 8px;border-radius:6px;transition:all 140ms ease-out;${active ? 'background:var(--green-tint);color:var(--accent)' : 'background:transparent;color:var(--t-faint)'}">Ver detalle</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:10px">
            <span style="${GROT}font-weight:700;font-size:30px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:${col}">${nf(pct, pct % 1 === 0 ? 0 : 1)} %</span>
            <span style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-faint);white-space:nowrap">${nf(p.done, 0)} / ${nf(p.total, 0)}</span>
          </div>
          <div style="height:8px;border-radius:6px;background:var(--grid);overflow:hidden">
            <div style="height:100%;border-radius:6px;transition:width 400ms ease-out;width:${Math.max(pct, 0.8)}%;background:${col}"></div>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;${MONO}font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t-faint)">
            <span>Peso ${nf(w, 1)} % · ${esc(p.medida)}</span>
            <span>Aporta ${nf(pct * w / 100, 1)} pts</span>
          </div>
        </button>`;
    }).join('');

    const sec1 = `
      <section>
        <div class="sec-head">
          <h2 class="sec">Avance general ponderado.</h2>
          <span class="eyebrow">Ponderado por importe de obra</span>
        </div>
        <div class="card" style="gap:26px">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap">
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="${EYEBROW}">Avance ponderado al corte</div>
              <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
                <span style="${GROT}font-weight:700;font-size:56px;line-height:1;letter-spacing:-.03em;white-space:nowrap;font-variant-numeric:tabular-nums;color:${pctColor(v.weighted)}">${nf(v.weighted, 1)} %</span>
                <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted)">${nf(v.doneEls, 0)} de ${nf(v.totalEls, 0)} elementos colocados · ${nf(v.doneEls / v.totalEls * 100, 1)} % sin ponderar</span>
              </div>
            </div>
            <div style="display:flex;gap:28px;flex-wrap:wrap">
              ${kpi('Colocados', nf(v.doneEls, 0), 'var(--ok)')}
              ${kpi('Pendientes', nf(v.totalEls - v.doneEls, 0), 'var(--t-low)')}
              ${kpi('Total modelado', nf(v.totalEls, 0), 'var(--t-hi)')}
            </div>
          </div>
          <div style="display:flex;height:14px;border-radius:8px;background:var(--grid);overflow:hidden">${stack}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">${cards}</div>
        </div>
      </section>`;

    /* ── Sección 2: avance por partida ── */
    const metalRows = v.set.rows.map(r => {
      const pct = r.total ? r.done / r.total * 100 : 0;
      const scale = r.total / v.rowMax * 100;
      const doneLabel = (r.done > 0 && scale * pct / 100 >= 3.5) ? nf(r.done, 0) : '';
      const pendLabel = ((r.total - r.done) > 0 && scale * (100 - pct) / 100 >= 3.5) ? nf(r.total - r.done, 0) : '';
      return `
        <div data-act="pick-row" data-row="${esc(r.name)}"
             data-tip-label="${esc(r.name)}"
             data-tip-value="${esc(nf(r.done, 0) + ' / ' + nf(r.total, 0) + '  ·  ' + nf(pct, 1) + ' %  ·  clic para ubicar en el modelo')}"
             style="display:flex;align-items:center;gap:16px;cursor:pointer">
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-mid);width:120px;flex:none">${esc(r.name)}</span>
          <div style="flex:1;min-width:0">
            <div style="height:26px;display:flex;transition:width 400ms ease-out;width:${Math.max(scale, 2)}%">
              <div style="height:100%;border-radius:4px 0 0 4px;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:width 400ms ease-out;width:${pct}%;background:var(--accent);${GROT}font-weight:700;font-size:12px;color:#0A1526">${doneLabel}</div>
              <div style="height:100%;border-radius:0 4px 4px 0;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:width 400ms ease-out;width:${100 - pct}%;background:var(--grid);${MONO}font-size:12px;color:var(--t-low)">${pendLabel}</div>
            </div>
          </div>
          <span style="${MONO}font-size:13px;letter-spacing:.04em;font-variant-numeric:tabular-nums;color:var(--t-hi);width:96px;text-align:right;flex:none">${nf(r.done, 0)} / ${nf(r.total, 0)}</span>
          <span style="${MONO}font-size:12px;letter-spacing:.08em;font-variant-numeric:tabular-nums;width:56px;text-align:right;flex:none;color:${pctColor(pct)}">${nf(pct, pct % 1 === 0 ? 0 : 1)} %</span>
        </div>`;
    }).join('');

    const legendDot = (bg, text) => `
      <div style="display:flex;align-items:center;gap:9px">
        <span style="width:11px;height:11px;border-radius:3px;background:${bg};display:block"></span>
        <span style="${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-muted)">${text}</span>
      </div>`;

    const sec2 = `
      <section id="avance-partida">
        <div class="sec-head">
          <h2 class="sec">Avance por partida.</h2>
          <span class="eyebrow">Por conteo de elementos</span>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
            <h3 class="sub">${esc(v.set.title)}</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${['cim','vm','cm','ar'].map(k =>
                `<button type="button" data-act="set-metal" data-key="${k}" style="${chip(state.metalSet === k)}">${esc(METAL_SETS[k].label)}</button>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center">
            ${legendDot('var(--accent)', 'Colocadas')}
            ${legendDot('var(--grid)', 'Pendientes por colocar')}
          </div>
          <div class="well" style="display:flex;flex-direction:column;gap:14px">${metalRows}</div>
          <div style="display:flex;gap:32px;flex-wrap:wrap;padding-top:4px">
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="${EYEBROW}">Colocadas</span>
              <span style="${GROT}font-weight:700;font-size:28px;font-variant-numeric:tabular-nums;color:var(--ok)">${nf(v.mDone, 0)}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="${EYEBROW}">Pendientes</span>
              <span style="${GROT}font-weight:700;font-size:28px;font-variant-numeric:tabular-nums;color:var(--t-low)">${nf(v.mTotal - v.mDone, 0)}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="${EYEBROW}">Total partida</span>
              <span style="${GROT}font-weight:700;font-size:28px;font-variant-numeric:tabular-nums;color:var(--t-hi)">${nf(v.mTotal, 0)}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="${EYEBROW}">Avance</span>
              <span style="${GROT}font-weight:700;font-size:28px;font-variant-numeric:tabular-nums;color:${pctColor(v.mPct)}">${nf(v.mPct, 1)} %</span>
            </div>
          </div>
        </div>
      </section>`;

    /* ── Sección 3: distribución de insumos ── */
    const cimCenterValue = state.donutMode === 'count' ? nf(v.cimTotal, 0) : nf(v.cimTotal, 2);
    const cimCenterSub   = state.donutMode === 'count' ? 'elementos' : 'm³ de concreto';
    const steelFootnote  = state.steelMode === 'kg'
      ? 'Solo perfiles con peso nominal asignado · total 181,237 kg'
      : 'Longitud total modelada · 6,500 m';

    const sec3 = `
      <section>
        <div class="sec-head">
          <h2 class="sec">Distribución de insumos.</h2>
          <span class="eyebrow">Concreto de cimentación y acero modelado</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:20px;align-items:stretch">

          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
              <h3 class="sub">Distribución de cimentación</h3>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button type="button" data-act="donut-mode" data-key="count" style="${chip(state.donutMode === 'count')}">Nº de elementos</button>
                <button type="button" data-act="donut-mode" data-key="vol"   style="${chip(state.donutMode === 'vol')}">Volumen de concreto</button>
              </div>
            </div>
            <div class="well" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px;align-items:center;justify-items:center;flex:1">
              <div style="position:relative;width:260px;height:260px;flex:none">
                ${donutSvg('cim', v.cimSegments)}
                ${donutCenter('cim', 'Total', cimCenterValue, cimCenterSub)}
              </div>
              <div style="display:flex;flex-direction:column;gap:2px;width:100%;min-width:0">${donutLegend('cim', v.cimSegments)}</div>
            </div>
          </div>

          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
              <h3 class="sub">Acero por tipo de perfil</h3>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button type="button" data-act="steel-mode" data-key="kg" style="${chip(state.steelMode === 'kg')}">Peso (kg)</button>
                <button type="button" data-act="steel-mode" data-key="m"  style="${chip(state.steelMode === 'm')}">Metros lineales</button>
              </div>
            </div>
            <div class="well" style="display:flex;flex-direction:column;gap:20px;flex:1;justify-content:center">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px;align-items:center;justify-items:center">
                <div style="position:relative;width:260px;height:260px;flex:none">
                  ${donutSvg('steel', v.steelSegments)}
                  ${donutCenter('steel', 'Total', nf(v.steelTotal, 0), v.steelUnit)}
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;width:100%;min-width:0">${donutLegend('steel', v.steelSegments)}</div>
              </div>
              <div style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-faint);text-transform:uppercase">${esc(steelFootnote)}</div>
            </div>
          </div>

        </div>
      </section>`;

    document.getElementById('dashboard-root').innerHTML = sec1 + sec2 + seccionPlaneacion() + sec3;
    applyHover('cim');
    applyHover('steel');
  }

  /* ── Hover de las donas ────────────────────────────────────────────────
     Se actualiza in-place, sin re-render: repintar el DOM bajo el cursor
     dispararía mouseout/mouseover en bucle. */
  function applyHover(kind) {
    if (!view) return;
    const idx  = kind === 'cim' ? state.hover : state.steelHover;
    const segs = kind === 'cim' ? view.cimSegments : view.steelSegments;

    document.querySelectorAll(`[data-seg="${kind}"]`).forEach(el => {
      const i = +el.dataset.i;
      el.setAttribute('stroke-width', idx === i ? 32 : 26);
      el.setAttribute('opacity', idx >= 0 && idx !== i ? 0.3 : 1);
    });
    document.querySelectorAll(`[data-segrow="${kind}"]`).forEach(el => {
      el.style.background = idx === +el.dataset.i ? 'var(--hover)' : 'transparent';
    });

    const sel = idx >= 0 ? segs[idx] : null;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    if (kind === 'cim') {
      const hv = idx >= 0 ? view.cimRows[idx] : null;
      set('cim-center-label', hv ? 'Seleccionado' : 'Total');
      set('cim-center-value', hv ? view.fmtCim(hv.v).split(' ')[0]
        : (state.donutMode === 'count' ? nf(view.cimTotal, 0) : nf(view.cimTotal, 2)));
      set('cim-center-sub', hv ? hv.name : (state.donutMode === 'count' ? 'elementos' : 'm³ de concreto'));
    } else {
      const sv = idx >= 0 ? view.steelRows[idx] : null;
      set('steel-center-label', sv ? 'Seleccionado' : 'Total');
      set('steel-center-value', sv ? nf(sv.v, 0) : nf(view.steelTotal, 0));
      set('steel-center-sub', sv ? sv.name : view.steelUnit);
    }
    return sel;
  }

  /* ── Tooltip ───────────────────────────────────────────────────────── */
  const tipEl = document.getElementById('tip');
  const tipLabelEl = document.getElementById('tip-label');
  const tipValueEl = document.getElementById('tip-value');
  let tipVisible = false;

  function showTip(label, value, x, y) {
    tipLabelEl.textContent = label;
    tipValueEl.textContent = value;
    tipEl.style.opacity = '1';
    tipEl.style.left = (x + 16) + 'px';
    tipEl.style.top  = (y + 16) + 'px';
    tipVisible = true;
  }
  function hideTip() {
    if (!tipVisible) return;
    tipEl.style.opacity = '0';
    tipEl.style.left = '-9999px';
    tipEl.style.top  = '-9999px';
    tipVisible = false;
  }

  /* ── Eventos (delegados: sobreviven a cada render) ─────────────────── */
  const root = document.getElementById('dashboard-root');

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.dataset.key;
    hideTip();
    if (btn.dataset.act === 'pick-row') {
      // Un elemento concreto (VM-1, AR-3, Zapata Z2…): lo selecciona en el visor.
      window.dispatchEvent(new CustomEvent('dashboard:element', {detail: {name: btn.dataset.row}}));
      return;
    }
    if (btn.dataset.act === 'set-metal') {
      state.metalSet = key;
      render();
      window.dispatchEvent(new CustomEvent('dashboard:partida', {detail: {key: key}}));
    } else if (btn.dataset.act === 'donut-mode') {
      state.donutMode = key; state.hover = -1; render();
    } else if (btn.dataset.act === 'steel-mode') {
      state.steelMode = key; state.steelHover = -1; render();
    }
  });

  root.addEventListener('mouseover', e => {
    const seg = e.target.closest('[data-seg],[data-segrow]');
    if (seg) {
      const kind = seg.dataset.seg || seg.dataset.segrow;
      const i = +seg.dataset.i;
      if (kind === 'cim' && state.hover !== i) { state.hover = i; applyHover('cim'); }
      if (kind === 'steel' && state.steelHover !== i) { state.steelHover = i; applyHover('steel'); }
    }
    const t = e.target.closest('[data-tip-label]');
    if (t) showTip(t.dataset.tipLabel, t.dataset.tipValue, e.clientX, e.clientY);
  });

  root.addEventListener('mousemove', e => {
    if (tipVisible) {
      tipEl.style.left = (e.clientX + 16) + 'px';
      tipEl.style.top  = (e.clientY + 16) + 'px';
    }
  });

  root.addEventListener('mouseout', e => {
    const to = e.relatedTarget;
    const seg = e.target.closest('[data-seg],[data-segrow]');
    if (seg && (!to || !to.closest || !to.closest('[data-seg],[data-segrow]'))) {
      if (state.hover !== -1)      { state.hover = -1;      applyHover('cim'); }
      if (state.steelHover !== -1) { state.steelHover = -1; applyHover('steel'); }
    }
    const t = e.target.closest('[data-tip-label]');
    if (t && (!to || !to.closest || !to.closest('[data-tip-label]'))) hideTip();
  });

  /* Tema */
  const themeBtn = document.getElementById('theme-toggle');
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    themeBtn.textContent = state.theme === 'light' ? 'Modo oscuro' : 'Modo claro';
    window.dispatchEvent(new CustomEvent('dashboard:theme', {detail: {theme: state.theme}}));
  }
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme();
  });

  /* ── Conteos en vivo desde el modelo ───────────────────────────────────
     viewer-link.js emite 'dashboard:model-data' cuando termina de indexar.
     Payload: { partidas: { vm: [{name, done, total}, …], … }, corte }

     Si el visor no carga (sin credenciales, modelo caído, red bloqueada)
     este evento nunca llega y el dashboard se queda con los datos de la
     tabla. Ese es el comportamiento deseado: nunca una pantalla vacía. */

  // Orden natural: VM-2 antes que VM-10, que es lo que un sort de texto rompe.
  function naturalSort(a, b) {
    const re = /^(\D*)(\d*)/;
    const [, pa, na] = a.name.match(re);
    const [, pb, nb] = b.name.match(re);
    if (pa !== pb) return pa.localeCompare(pb, 'es');
    return (parseInt(na, 10) || 0) - (parseInt(nb, 10) || 0);
  }

  function applyModelData(data) {
    if (!data || !data.partidas) return;

    const next = {};
    let cambiadas = 0;
    for (const m of PARTIDA_META) {
      const rows = data.partidas[m.key];
      // Una partida sin filas se queda vacia y se muestra en cero. Antes
      // conservaba su respaldo escrito a mano; ya no hay respaldo.
      if (!Array.isArray(rows) || !rows.length) { next[m.key] = []; continue; }
      next[m.key] = rows;
      cambiadas++;
    }

    if (!cambiadas) {
      console.warn('[app] El modelo no devolvió filas para ninguna partida: ' +
                   'no hay nada que mostrar. Revisa ELEMENT_MATCH en viewer-link.js.');
      return;
    }

    ROWS = next;
    dataSource = 'modelo';
    render();
    applySourceBadge(data);
    console.info('[app] Conteos tomados del modelo para %d de %d partidas.',
      cambiadas, PARTIDA_META.length);
  }

  function applySourceBadge(data) {
    const label = document.getElementById('data-source');
    const sub = document.getElementById('header-sub');
    if (label) {
      /* Tres estados, y ninguno miente: en vivo, esperando, o no llegó.
         Antes aquí decía «Modelo al día» justo cuando los datos NO venían
         del modelo. */
      const enVivo = dataSource === 'modelo';
      label.textContent = enVivo ? 'Datos en vivo del modelo'
                        : esperaVencida ? 'Sin datos del modelo'
                        : 'Leyendo el modelo…';
      label.title = enVivo
        ? 'Los conteos se leen de fechaEjecucion en cada carga'
        : esperaVencida ? 'Sin lectura del modelo, no se muestran cifras'
        : 'Esperando la lectura del modelo';
    }
    // El subtítulo describe la página y no cambia: antes se sobreescribía
    // con el nombre y la versión del .rvt, que es ruido para quien consulta.
    void sub;
  }

  window.addEventListener('dashboard:model-data', e => applyModelData(e.detail));

  window.addEventListener('dashboard:planeacion', e => {
    planeacion = e.detail;
    console.info('[app] curva de planeación:', planeacion.plan.length, 'fechas ·',
                 Object.values(planeacion.totales).reduce((a,b)=>a+b,0), 'elementos ponderables');
    render();
  });

  /* ── Arranque ──────────────────────────────────────────────────────── */
  applyTheme();
  render();

  /* Indexar el modelo tarda, pero no debe tardar para siempre. Si pasado
     este tiempo no hay datos, el estado de espera pasa a decir que no se
     pudo leer, en vez de dejar un «Leyendo…» eterno. */
  setTimeout(() => {
    if (ROWS) return;
    esperaVencida = true;
    render();
  }, 150000);
})();
