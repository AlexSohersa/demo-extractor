/* ─────────────────────────────────────────────────────────────────────────
   Dashboard propuesta · avance general de obra

   TODO se calcula a partir de la lista de elementos que entrega
   assets/proposal-data.js. No hay curvas ni totales escritos a mano: las
   curvas S, los KPIs, la ponderación por partida y los vencidos son
   agregaciones de {costo, fechaPlan, fechaEjec}.

   Consecuencia práctica: el día que los parámetros existan en Revit, se
   cambia el proveedor y este archivo no se toca.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const root = document.getElementById('proposal-root');
  if (!root || !window.ProposalData) return;

  const D = window.ProposalData;
  let TODOS = [];
  const CORTE = D.aDia(D.CORTE);

  const MONO = "font-family:'IBM Plex Mono',ui-monospace,monospace;";
  const GROT = "font-family:'Space Grotesk',system-ui,sans-serif;";
  const SANS = "font-family:'IBM Plex Sans',system-ui,sans-serif;";
  const EYEBROW = MONO + 'font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t-muted)';
  const SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];

  const nf = (v, d) => Number(v).toLocaleString('es-MX', {minimumFractionDigits:d, maximumFractionDigits:d});
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const money = v => '$' + nf(v/1e6, 1) + ' M';
  const signed = v => (v >= 0 ? '+' : '−') + nf(Math.abs(v), 1);
  const semaforo = d => d >= -3 ? 'var(--ok)' : d >= -12 ? 'var(--warn)' : 'var(--crit)';

  const state = { curva: 'fisico', disciplina: '', subproyecto: '' };

  /* ── Meses del proyecto ─────────────────────────────────────────────── */
  const MESES = (() => {
    const out = [];
    const [ai, mi] = D.INICIO.split('-').map(Number);
    const [af, mf] = D.FIN.split('-').map(Number);
    let a = ai, m = mi;
    while (a < af || (a === af && m <= mf)) {
      out.push(String(a) + '-' + String(m).padStart(2, '0'));
      m++; if (m > 12) { m = 1; a++; }
    }
    return out;
  })();
  const IDX = new Map(MESES.map((m, i) => [m, i]));
  const CORTE_MES = IDX.get(D.CORTE.slice(0, 7));
  const NOMBRE_MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const etiqueta = k => { const [a, m] = k.split('-'); return NOMBRE_MES[+m - 1] + ' ' + a.slice(2); };

  /* ── Filtro ─────────────────────────────────────────────────────────── */
  function filtrados() {
    return TODOS.filter(e =>
      (!state.disciplina  || e.disciplina  === state.disciplina) &&
      (!state.subproyecto || e.subproyecto === state.subproyecto));
  }

  /* ── Agregados ──────────────────────────────────────────────────────── */
  const valor = e => state.curva === 'fisico' ? 1 : e.costo;

  function resumen(els) {
    const total = els.length;
    const costoTotal = els.reduce((a, e) => a + e.costo, 0);
    const hechos = els.filter(e => e.fechaEjec);
    const planeados = els.filter(e => D.aDia(e.fechaPlan) <= CORTE);
    const vencidos = els.filter(e => !e.fechaEjec && D.aDia(e.fechaPlan) < CORTE);

    return {
      total, costoTotal,
      hechos: hechos.length,
      costoHecho: hechos.reduce((a, e) => a + e.costo, 0),
      fisicoReal: total ? hechos.length / total * 100 : 0,
      fisicoPlan: total ? planeados.length / total * 100 : 0,
      finReal: costoTotal ? hechos.reduce((a, e) => a + e.costo, 0) / costoTotal * 100 : 0,
      finPlan: costoTotal ? planeados.reduce((a, e) => a + e.costo, 0) / costoTotal * 100 : 0,
      vencidos,
      costoVencido: vencidos.reduce((a, e) => a + e.costo, 0),
      diasMax: vencidos.length ? Math.max(...vencidos.map(e => CORTE - D.aDia(e.fechaPlan))) : 0
    };
  }

  /* Curvas acumuladas, en % sobre el total del conjunto filtrado. */
  function curvas(els) {
    const plan = new Array(MESES.length).fill(0);
    const real = new Array(MESES.length).fill(0);
    let total = 0;
    for (const e of els) {
      const v = valor(e);
      total += v;
      const ip = IDX.get(e.fechaPlan.slice(0, 7));
      if (ip !== undefined) plan[ip] += v;
      if (e.fechaEjec) {
        const ie = IDX.get(e.fechaEjec.slice(0, 7));
        if (ie !== undefined) real[ie] += v;
      }
    }
    const acum = arr => { let s = 0; return arr.map(x => (s += x) / (total || 1) * 100); };
    return { planMes: plan, realMes: real, planAcum: acum(plan), realAcum: acum(real), total };
  }

  /* Retraso en TIEMPO: ¿cuándo previó el programa el avance que hoy tenemos?
     Restar porcentajes no da días; esto sí. */
  function retrasoMeses(c) {
    const hoy = c.realAcum[CORTE_MES];
    for (let i = 1; i <= CORTE_MES; i++) {
      if (c.planAcum[i] >= hoy) {
        const t = (hoy - c.planAcum[i-1]) / ((c.planAcum[i] - c.planAcum[i-1]) || 1);
        return CORTE_MES - (i - 1 + t);
      }
    }
    return 0;
  }

  /* Pronóstico por índice de desempeño (SPI).

     Extrapolar el ritmo de los últimos meses sería un error: estamos en la
     parte empinada de la curva y proyectarla en línea recta daría un término
     ANTERIOR al programa aun yendo retrasados. Incoherente.

     El método estándar: SPI = avance real / avance planeado al corte. Si vas
     al 80 % de lo previsto, lo que falta te llevará 1/0.8 = 1.25 veces más.
     Se estira en el tiempo lo que resta del programa por ese factor, y la
     curva conserva la forma del tramo final en vez de volverse una recta. */
  function pronostico(c, spiExacto) {
    const vReal = c.realAcum[CORTE_MES];
    const vPlan = c.planAcum[CORTE_MES];
    // El SPI llega calculado con la fecha exacta de corte. Derivarlo de los
    // cubos mensuales metería el mes del corte entero en el planeado y lo
    // dejaría peor de lo que es, contradiciendo a los KPIs de arriba.
    const spi = spiExacto != null ? spiExacto : (vPlan > 0 ? vReal / vPlan : 1);

    const finPlan = MESES.length - 1;
    const mesesRestantesPlan = Math.max(finPlan - CORTE_MES, 0.5);
    const factor = Math.min(Math.max(spi, 0.25), 2);          // acota casos extremos
    const mesesRestantes = mesesRestantesPlan / factor;

    // Interpola el acumulado del programa en una posición fraccionaria.
    const planEn = pos => {
      const lo = Math.floor(pos), hi = Math.min(lo + 1, c.planAcum.length - 1);
      const t = pos - lo;
      return c.planAcum[Math.max(lo,0)] * (1 - t) + c.planAcum[hi] * t;
    };

    const restanteReal = 100 - vReal;
    const restantePlan = 100 - vPlan || 1;
    const puntos = [];
    const pasos = Math.ceil(mesesRestantes);
    for (let k = 0; k <= pasos; k++) {
      const u = Math.min(k / mesesRestantes, 1);              // 0..1 del tramo que falta
      const forma = (planEn(CORTE_MES + u * mesesRestantesPlan) - vPlan) / restantePlan;
      puntos.push({ i: CORTE_MES + k, v: Math.min(100, vReal + restanteReal * Math.max(forma, 0)) });
    }
    return { puntos, spi, mesFin: CORTE_MES + mesesRestantes };
  }

  function finEstimado(mesFin) {
    const i = Math.round(mesFin);
    const extra = i - (MESES.length - 1);
    if (extra <= 0) return etiqueta(MESES[Math.max(i, 0)]);
    const [a, m] = MESES[MESES.length - 1].split('-').map(Number);
    let mm = m - 1 + extra, aa = a + Math.floor(mm / 12);
    mm = ((mm % 12) + 12) % 12;
    return `${NOMBRE_MES[mm]} ${String(aa).slice(2)} · +${extra} ${extra === 1 ? 'mes' : 'meses'}`;
  }

  /* ── Tooltip (comparte el #tip global) ──────────────────────────────── */
  const tipEl = document.getElementById('tip');
  const tipLabel = document.getElementById('tip-label');
  const tipValue = document.getElementById('tip-value');
  let tipOn = false;
  const showTip = (l, v, x, y) => {
    tipLabel.textContent = l; tipValue.textContent = v;
    tipEl.style.opacity = '1';
    tipEl.style.left = (x + 16) + 'px'; tipEl.style.top = (y + 16) + 'px';
    tipOn = true;
  };
  const hideTip = () => {
    if (!tipOn) return;
    tipEl.style.opacity = '0'; tipEl.style.left = '-9999px'; tipEl.style.top = '-9999px';
    tipOn = false;
  };

  /* ── Piezas ─────────────────────────────────────────────────────────── */
  const chip = on => 'border-radius:10px;padding:9px 16px;' + MONO +
    'font-size:11px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;cursor:pointer;transition:all 140ms ease-out;' +
    (on ? 'background:var(--green-tint);border:1px solid var(--accent);color:var(--accent);'
        : 'background:transparent;border:1px solid var(--line);color:var(--t-muted);');

  const kpi = (label, value, color, sub) => `
    <div style="display:flex;flex-direction:column;gap:8px;padding:22px;border-radius:14px;background:var(--well);border:1px solid var(--line);min-width:0">
      <span style="${EYEBROW}">${esc(label)}</span>
      <span style="${GROT}font-weight:700;font-size:30px;line-height:1;font-variant-numeric:tabular-nums;color:${color};white-space:nowrap">${esc(value)}</span>
      <span style="${MONO}font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t-faint)">${esc(sub)}</span>
    </div>`;

  function curvaSVG(c, spi) {
    const W = 980, H = 400, L = 48, R = 18, T = 18, B = 46;
    const pr = pronostico(c, spi);
    const nX = Math.max(MESES.length - 1, pr.mesFin);
    const x = i => L + i * (W - L - R) / nX;
    const y = v => T + (100 - v) * (H - T - B) / 100;
    const path = pts => pts.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');

    const planPts = c.planAcum.map((v, i) => ({i, v}));
    const realPts = c.realAcum.slice(0, CORTE_MES + 1).map((v, i) => ({i, v}));

    const grid = [0,25,50,75,100].map(v => `
      <line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"></line>
      <text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="var(--t-faint)" style="${MONO}font-size:11px">${v}%</text>`).join('');

    const ticks = MESES.map((m, i) => (i % 2 === 0 || i === MESES.length - 1)
      ? `<text x="${x(i)}" y="${H-B+20}" text-anchor="middle" fill="var(--t-faint)" style="${MONO}font-size:10px">${etiqueta(m)}</text>` : '').join('');

    const hits = MESES.map((m, i) => {
      const pv = c.planAcum[i], rv = i <= CORTE_MES ? c.realAcum[i] : null;
      const txt = rv !== null
        ? `plan ${nf(pv,1)} %  ·  real ${nf(rv,1)} %  ·  ${signed(rv-pv)} pts`
        : `plan ${nf(pv,1)} %  ·  sin ejecutar`;
      return `<rect x="${x(i)-(W-L-R)/nX/2}" y="${T}" width="${(W-L-R)/nX}" height="${H-T-B}" fill="transparent"
                data-tip-label="${esc(etiqueta(m))}" data-tip-value="${esc(txt)}"></rect>`;
    }).join('');

    const area = path(realPts) + ` L${x(CORTE_MES).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible">
        ${grid}
        <path d="${area}" fill="var(--accent)" opacity=".10"></path>
        <path d="${path(planPts)}" fill="none" stroke="var(--info)" stroke-width="2.5" stroke-dasharray="7 5"></path>
        <path d="${path(pr.puntos)}" fill="none" stroke="var(--warn)" stroke-width="2.5" stroke-dasharray="2 5" stroke-linecap="round"></path>
        <path d="${path(realPts)}" fill="none" stroke="var(--accent)" stroke-width="3"></path>
        ${realPts.map(p => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="3" fill="var(--accent)"></circle>`).join('')}
        <line x1="${x(CORTE_MES)}" y1="${T}" x2="${x(CORTE_MES)}" y2="${H-B}" stroke="var(--t-low)" stroke-width="1.5" stroke-dasharray="3 4"></line>
        <text x="${x(CORTE_MES)}" y="${T-4}" text-anchor="middle" fill="var(--t-low)" style="${MONO}font-size:10px;letter-spacing:.14em">HOY</text>
        ${ticks}${hits}
      </svg>
      <div style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-faint);text-transform:uppercase;margin-top:6px">
        SPI ${nf(pr.spi,2)} · término estimado ${finEstimado(pr.mesFin)}
        · programa ${etiqueta(MESES[MESES.length-1])}
      </div>`;
  }

  /* Desglose: por disciplina, o por partida si hay una disciplina elegida. */
  function desglose(els) {
    const campo = state.disciplina ? 'partida' : 'disciplina';
    const grupos = new Map();
    for (const e of els) {
      const k = e[campo];
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    }
    const filas = [...grupos.entries()].map(([nombre, g]) => {
      const r = resumen(g);
      return { nombre, r, desv: r.fisicoReal - r.fisicoPlan, peso: r.costoTotal };
    }).sort((a, b) => b.peso - a.peso);

    const pesoTotal = filas.reduce((a, f) => a + f.peso, 0);

    return { campo, html: filas.map((f, i) => `
      <div data-tip-label="${esc(f.nombre)}"
           data-tip-value="${esc(`real ${nf(f.r.fisicoReal,1)} %  ·  plan ${nf(f.r.fisicoPlan,1)} %  ·  ${signed(f.desv)} pts  ·  ${f.r.vencidos.length} vencidos`)}"
           style="display:grid;grid-template-columns:170px 1fr 62px 60px 66px 72px;gap:14px;align-items:center;padding:9px 0;cursor:default">
        <div style="display:flex;align-items:center;gap:9px;min-width:0">
          <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${SERIES[i % SERIES.length]}"></span>
          <span style="${SANS}font-size:14px;color:var(--t-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.nombre)}</span>
        </div>
        <div style="position:relative;height:22px;border-radius:5px;background:var(--grid);overflow:hidden">
          <div style="position:absolute;inset:0 auto 0 0;width:${f.r.fisicoReal}%;background:${SERIES[i % SERIES.length]};opacity:.85"></div>
          <div style="position:absolute;top:-3px;bottom:-3px;left:${f.r.fisicoPlan}%;width:2.5px;background:var(--t-hi);border-radius:2px"></div>
        </div>
        <span style="${GROT}font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:var(--t-hi);text-align:right">${nf(f.r.fisicoReal,0)} %</span>
        <span style="${MONO}font-size:12px;font-variant-numeric:tabular-nums;color:${semaforo(f.desv)};text-align:right">${signed(f.desv)}</span>
        <span style="${MONO}font-size:11px;font-variant-numeric:tabular-nums;color:${f.r.vencidos.length ? 'var(--crit)' : 'var(--t-faint)'};text-align:right">${f.r.vencidos.length || '—'}</span>
        <span style="${MONO}font-size:11px;font-variant-numeric:tabular-nums;color:var(--t-faint);text-align:right">${nf(f.peso/pesoTotal*100,1)} %</span>
      </div>`).join('') };
  }

  /* Vencidos agrupados por partida, ordenados por importe detenido: para
     un director de obra, el dinero parado es el mejor criterio. */
  function vencidos(els) {
    const r = resumen(els);
    const grupos = new Map();
    for (const e of r.vencidos) {
      const k = e.disciplina + ' · ' + e.partida;
      if (!grupos.has(k)) grupos.set(k, { n: 0, costo: 0, dias: 0 });
      const g = grupos.get(k);
      g.n++; g.costo += e.costo;
      g.dias = Math.max(g.dias, CORTE - D.aDia(e.fechaPlan));
    }
    const filas = [...grupos.entries()].sort((a, b) => b[1].costo - a[1].costo).slice(0, 10);
    const maxCosto = filas.length ? filas[0][1].costo : 1;

    if (!filas.length) return '<div style="' + SANS + 'font-size:15px;color:var(--t-muted);padding:8px 0">Sin elementos vencidos en este filtro.</div>';

    return filas.map(([nombre, g]) => `
      <div data-tip-label="${esc(nombre)}"
           data-tip-value="${esc(`${g.n} elementos vencidos · ${money(g.costo)} detenidos · hasta ${g.dias} días`)}"
           style="display:grid;grid-template-columns:230px 1fr 56px 84px 74px;gap:14px;align-items:center;padding:8px 0;cursor:default">
        <span style="${SANS}font-size:14px;color:var(--t-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nombre)}</span>
        <div style="height:16px;border-radius:4px;background:var(--grid);overflow:hidden">
          <div style="height:100%;width:${g.costo/maxCosto*100}%;background:var(--crit);opacity:.85"></div>
        </div>
        <span style="${GROT}font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;color:var(--crit);text-align:right">${g.n}</span>
        <span style="${MONO}font-size:11px;font-variant-numeric:tabular-nums;color:var(--t-mid);text-align:right">${money(g.costo)}</span>
        <span style="${MONO}font-size:11px;font-variant-numeric:tabular-nums;color:var(--t-faint);text-align:right">${g.dias} d</span>
      </div>`).join('');
  }

  function mensualSVG(c) {
    const W = 470, H = 250, L = 34, R = 8, T = 12, B = 34;
    const esc100 = arr => arr.map(v => v / (c.total || 1) * 100);
    const dPlan = esc100(c.planMes), dReal = esc100(c.realMes);
    const max = Math.max(...dPlan, ...dReal, 1) * 1.1;
    const bw = (W - L - R) / MESES.length;
    const y = v => T + (1 - v / max) * (H - T - B);

    const barras = MESES.map((m, i) => {
      const x0 = L + i * bw;
      const p = `<rect x="${x0+bw*0.12}" y="${y(dPlan[i])}" width="${bw*0.34}" height="${Math.max(H-B-y(dPlan[i]),0)}" fill="var(--info)" opacity=".55" rx="1.5"></rect>`;
      const r = i <= CORTE_MES
        ? `<rect x="${x0+bw*0.5}" y="${y(dReal[i])}" width="${bw*0.34}" height="${Math.max(H-B-y(dReal[i]),0)}" fill="var(--accent)" rx="1.5"></rect>` : '';
      const txt = i <= CORTE_MES ? `plan ${nf(dPlan[i],1)} · real ${nf(dReal[i],1)} pts` : `plan ${nf(dPlan[i],1)} pts · sin ejecutar`;
      return p + r + `<rect x="${x0}" y="${T}" width="${bw}" height="${H-T-B}" fill="transparent"
                        data-tip-label="${esc(etiqueta(m))}" data-tip-value="${esc(txt)}"></rect>`;
    }).join('');

    const ticks = MESES.map((m, i) => i % 3 === 0
      ? `<text x="${L+i*bw+bw/2}" y="${H-B+18}" text-anchor="middle" fill="var(--t-faint)" style="${MONO}font-size:9px">${etiqueta(m)}</text>` : '').join('');

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="var(--grid)"></line>
      <text x="${L-8}" y="${y(max)+10}" text-anchor="end" fill="var(--t-faint)" style="${MONO}font-size:10px">${nf(max,0)}</text>
      ${barras}${ticks}
    </svg>`;
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render() {
    const els = filtrados();
    const r = resumen(els);
    const c = curvas(els);
    const dias = Math.round(retrasoMeses(c) * 30.44);
    const desvF = r.fisicoReal - r.fisicoPlan;
    const desvE = r.finReal - r.finPlan;
    const d = desglose(els);
    const esFisico = state.curva === 'fisico';
    // SPI de la métrica activa, con la fecha exacta de corte.
    const spiActual = esFisico
      ? (r.fisicoPlan > 0 ? r.fisicoReal / r.fisicoPlan : 1)
      : (r.finPlan    > 0 ? r.finReal    / r.finPlan    : 1);

    const filtroChips = (label, campo, opciones) => `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="${EYEBROW};min-width:96px">${label}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" data-filtro="${campo}" data-valor="" style="${chip(!state[campo])}">Todas</button>
          ${opciones.map(o => `<button type="button" data-filtro="${campo}" data-valor="${esc(o)}" style="${chip(state[campo]===o)}">${esc(o)}</button>`).join('')}
        </div>
      </div>`;

    root.innerHTML = `
      <section>
        <div class="card" style="gap:16px">
          ${filtroChips('Disciplina', 'disciplina', D.DISCIPLINAS.map(x => x.name))}
          ${filtroChips('Subproyecto', 'subproyecto', D.SUBPROYECTOS)}
          <div style="${MONO}font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t-faint);padding-top:4px">
            ${nf(els.length,0)} de ${nf(TODOS.length,0)} elementos · ${money(r.costoTotal)} de ${money(D.IMPORTE_TOTAL)}
          </div>
        </div>
      </section>

      <section>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px">
          ${kpi('Avance físico real', nf(r.fisicoReal,1) + ' %', semaforo(desvF), 'Planeado ' + nf(r.fisicoPlan,1) + ' %')}
          ${kpi('Desviación física', signed(desvF) + ' pts', desvF >= 0 ? 'var(--ok)' : 'var(--crit)', 'Respecto al programa')}
          ${kpi('Retraso estimado', dias + ' días', dias <= 15 ? 'var(--ok)' : dias <= 45 ? 'var(--warn)' : 'var(--crit)', 'Desfase sobre la curva')}
          ${kpi('Avance financiero', nf(r.finReal,1) + ' %', semaforo(desvE), 'Planeado ' + nf(r.finPlan,1) + ' %')}
          ${kpi('Importe ejecutado', money(r.costoHecho), 'var(--t-hi)', 'De ' + money(r.costoTotal))}
          ${kpi('Elementos vencidos', nf(r.vencidos.length,0), r.vencidos.length ? 'var(--crit)' : 'var(--ok)', money(r.costoVencido) + ' detenidos')}
        </div>
      </section>

      <section>
        <div class="sec-head">
          <h2 class="sec">Curva S.</h2>
          <span class="eyebrow">Acumulado planeado vs. real vs. pronóstico</span>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
            <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">
              ${[['var(--info)','Planeado'],['var(--accent)','Real'],['var(--warn)','Pronóstico']].map(([col,txt]) => `
                <div style="display:flex;align-items:center;gap:9px">
                  <span style="width:18px;height:3px;background:${col};display:block;border-radius:2px"></span>
                  <span style="${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-muted)">${txt}</span>
                </div>`).join('')}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" data-curva="fisico" style="${chip(esFisico)}">Avance físico</button>
              <button type="button" data-curva="financiero" style="${chip(!esFisico)}">Avance financiero</button>
            </div>
          </div>
          <div class="well">${curvaSVG(c, spiActual)}</div>
        </div>
      </section>

      <section>
        <div class="sec-head">
          <h2 class="sec">Avance por ${d.campo}.</h2>
          <span class="eyebrow">Barra: real · marca blanca: planeado</span>
        </div>
        <div class="card">
          <div style="display:grid;grid-template-columns:170px 1fr 62px 60px 66px 72px;gap:14px;${EYEBROW};font-size:10px">
            <span>${d.campo === 'partida' ? 'Partida' : 'Disciplina'}</span><span>Avance</span>
            <span style="text-align:right">Real</span><span style="text-align:right">Desv.</span>
            <span style="text-align:right">Venc.</span><span style="text-align:right">Peso $</span>
          </div>
          <div class="well" style="padding:20px 28px">${d.html}</div>
        </div>
      </section>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px;align-items:stretch">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap">
            <h3 class="sub">Vencidos por partida</h3>
            <span class="eyebrow">Ordenado por importe detenido</span>
          </div>
          <div class="well" style="padding:20px 28px;flex:1">${vencidos(els)}</div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap">
            <h3 class="sub">Avance del mes</h3>
            <span class="eyebrow">${esFisico ? 'Físico' : 'Financiero'} · puntos por mes</span>
          </div>
          <div class="well" style="flex:1;display:flex;align-items:center">${mensualSVG(c)}</div>
        </div>
      </div>

      <section>
        <div class="sec-head">
          <h2 class="sec">Cómo se calcula.</h2>
          <span class="eyebrow">Todo sale de tres campos por elemento</span>
        </div>
        <div class="card" style="gap:0">
          ${[
            ['Fecha planeación · Fecha ejecución · Costo',
             'Los tres parámetros que llevará cada elemento en Revit, en formato <code>AAAA-MM-DD</code> el par de fechas y numérico el costo. De ahí sale absolutamente todo lo de arriba.'],
            ['Curvas S',
             'Costo (o conteo) acumulado por mes: la planeada ordena por fecha de planeación, la real por fecha de ejecución. No hay tabla de programa aparte.'],
            ['Ponderación',
             'El peso de cada partida es la suma de los costos de sus elementos entre el total. No hace falta cargar el catálogo de conceptos.'],
            ['Vencidos',
             'Fecha de planeación anterior al corte y sin fecha de ejecución. Es lo que ya debería estar puesto y no está, con su importe detenido.'],
            ['Pronóstico',
             'Ritmo medido de los últimos 4 meses proyectado sobre lo que falta. Si la obra acelera o se frena, la estimación se mueve sola.'],
            ['Lo que falta por decidir',
             'Que la suma de costos de los elementos sea el importe contratado obliga a que todo lo contratado esté modelado. Si hay partidas fuera del modelo, hay que decidir cómo se reparten.']
          ].map(([t, x], i, arr) => `
            <div style="display:flex;gap:18px;padding:20px 0;${i < arr.length-1 ? 'border-bottom:1px solid var(--line)' : ''}">
              <span style="${MONO}font-size:12px;color:var(--accent);flex:none;width:26px">${String(i+1).padStart(2,'0')}</span>
              <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
                <span style="${GROT}font-weight:600;font-size:16px;color:var(--t-hi)">${t}</span>
                <span style="${SANS}font-size:14px;line-height:1.55;color:var(--t-muted)">${x}</span>
              </div>
            </div>`).join('')}
        </div>
      </section>`;
  }

  /* ── Eventos ────────────────────────────────────────────────────────── */
  root.addEventListener('click', e => {
    const f = e.target.closest('[data-filtro]');
    const c = e.target.closest('[data-curva]');
    if (!f && !c) return;
    hideTip();
    if (f) state[f.dataset.filtro] = f.dataset.valor;
    if (c) state.curva = c.dataset.curva;
    render();
  });
  root.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip-label]');
    if (t) showTip(t.dataset.tipLabel, t.dataset.tipValue, e.clientX, e.clientY);
  });
  root.addEventListener('mousemove', e => {
    if (tipOn) { tipEl.style.left = (e.clientX+16)+'px'; tipEl.style.top = (e.clientY+16)+'px'; }
  });
  root.addEventListener('mouseout', e => {
    const to = e.relatedTarget, t = e.target.closest('[data-tip-label]');
    if (t && (!to || !to.closest || !to.closest('[data-tip-label]'))) hideTip();
  });

  /* ── Arranque ──────────────────────────────────────────────────────────
     El inventario pesa varios MB, así que no se baja hasta que alguien abre
     esta pestaña. tabs.js avisa con 'tab:shown'. */
  function cargando(msg) {
    root.innerHTML = `
      <div class="card" style="align-items:center;text-align:center;gap:16px;padding:64px 32px">
        <div class="spinner"></div>
        <div style="${SANS}font-size:15px;color:var(--t-muted)">${esc(msg)}</div>
      </div>`;
  }

  let iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    cargando('Leyendo el inventario de los modelos de ACC…');
    D.cargar().then(els => {
      TODOS = els;
      render();
    }).catch(err => {
      root.innerHTML = `
        <div class="card" style="align-items:center;text-align:center;gap:12px;padding:56px 32px">
          <div style="${SANS}font-size:15px;color:var(--t-mid)">No se pudo cargar el inventario.</div>
          <div style="${MONO}font-size:11px;color:var(--t-faint)">${esc(String(err.message || err))}</div>
        </div>`;
    });
  }

  window.addEventListener('tab:shown', e => { if (e.detail.key === 'propuesta') iniciar(); });
  // Si no hay pestañas (o ya estamos en ella), arranca de inmediato.
  const panel = root.closest('[data-tab-panel]');
  if (!panel || !panel.hidden) iniciar();
})();
