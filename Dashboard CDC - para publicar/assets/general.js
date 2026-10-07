/* ─────────────────────────────────────────────────────────────────────────
   Avance general · las diez disciplinas juntas.

   Cada modelo del federado es una disciplina. Para cada elemento se lee su
   categoría y sus dos fechas, se le pone precio con assets/costos.js y se
   suma. El avance de una disciplina es importe ejecutado / importe total, y
   el general es la suma de todas — o sea, ponderado por costo, no por
   conteo: un tablero no puede pesar lo mismo que una luminaria.

   LECTURA PROGRESIVA, NO TODO O NADA
   Leer las propiedades de diez modelos lleva minutos y compite con los otros
   visores de la página. Así que se leen en serie y se repinta en cuanto
   termina cada una: ves arquitectura lista mientras hidráulico sigue. Cada
   modelo tiene su propio límite de tiempo; el que no responda se marca y no
   arrastra a los demás.

   EL MODELO ES LA ÚNICA FUENTE
   Igual que en la pestaña de avance estructural: sin datos no se inventa
   nada. Una disciplina sin fechas capturadas aparece en cero y se dice por
   qué. Lo único que no sale del modelo son los precios, que son estimados y
   están aparte en costos.js con su propia advertencia.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const LIMITE_MODELO = 120000;    // ms antes de rendirse con un modelo
  const HORIZONTE     = 30;        // días que mira la proyección de riesgo

  /* Nombres de propiedad, en los dos idiomas: el modelo traducido los expone
     en el del .rvt y este proyecto viene en español. */
  const P_CAT  = ['Category', 'Categoría'];
  const P_PLAN = ['fechaPlaneacion'];
  const P_EJEC = ['fechaEjecucion'];

  const val = (p, alias) => { for (const a of alias) if (p[a]) return p[a]; return ''; };

  /* ── Fechas ───────────────────────────────────────────────────────────
     Mismo criterio que viewer-fechas.js: los parámetros son de texto, se
     normaliza a ISO y lo que no se entienda se cuenta en vez de tragarse. */
  const malFormadas = new Map();

  function aISO(crudo) {
    const s = String(crudo == null ? '' : crudo).trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    let a, m, d;
    if (iso)      { a = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else if (dmy) { d = +dmy[1]; m = +dmy[2]; a = +dmy[3]; if (a < 100) a += 2000; }
    else { malFormadas.set(s, (malFormadas.get(s) || 0) + 1); return null; }
    const f = new Date(Date.UTC(a, m - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) {
      malFormadas.set(s, (malFormadas.get(s) || 0) + 1);
      return null;
    }
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  const DIA_MS = 86400000;
  const dia    = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DIA_MS);
  const desdeDia = n => new Date(n * DIA_MS).toISOString().slice(0, 10);
  const MESES  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fCorta = iso => { const [a,m,d] = iso.split('-'); return d + ' ' + MESES[+m-1] + ' ' + a.slice(2); };

  const nf  = (v, d) => Number(v).toLocaleString('es-MX', {minimumFractionDigits: d, maximumFractionDigits: d});
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)',
                  'var(--s6)','var(--s7)','var(--s8)','var(--s1)','var(--s3)'];
  const pctColor = p => p >= 100 ? 'var(--ok)' : p === 0 ? 'var(--info)' : p < 33 ? 'var(--crit)' : p <= 66 ? 'var(--warn)' : 'var(--ok)';
  const desvColor = d => d <= 0 ? 'var(--ok)' : d <= 7 ? 'var(--warn)' : 'var(--crit)';
  const MONO = "font-family:'IBM Plex Mono',ui-monospace,monospace;";
  const GROT = "font-family:'Space Grotesk',system-ui,sans-serif;";
  const EYEBROW = MONO + 'font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t-muted)';

  /* ── Estado ──────────────────────────────────────────────────────────── */
  let viewer = null;
  let disciplinas = [];
  let arrancado = false;      // el visor llegó a estar listo
  let visorFallo = false;     // el visor nunca llegó
  let aislada = null;         // la disciplina cuyo desglose está abierto
  let ocultos = new Set();    // nombres apagados en el visor
  let modo = 'ninguno';       // 'ninguno' | 'avance' | 'disciplina' | 'ejecutados'

  /* Las series de arriba son variables CSS y el visor necesita color real.
     Son los mismos valores del tema oscuro de styles.css. */
  const SERIE_HEX = ['#6DBE45','#4A9FD8','#E8A200','#9B7FE8','#2BD1E8',
                     '#E5748C','#F2704A','#57D9A3','#6DBE45','#E8A200'];
  const COLOR_EJEC = '#6DBE45', COLOR_PEND = '#EE5C63';
  const OPACIDAD_PEND = 0.7;  // lo pendiente se ve, pero deja ver a través

  const $ = id => document.getElementById(id);
  const setStatus = t => { const e = $('general-status'); if (e) e.textContent = t; };

  function limpiaNombre(n) {
    return String(n || '?')
      .replace('26080CDC-SOH-VV-', '')
      .replace(/[-_]RVT[ _]GEORREFERENCIADO\.rvt$/i, '')
      .replace(/\.rvt$/i, '');
  }

  /* ── Lectura de un modelo ─────────────────────────────────────────────
     En serie y con límite propio: un modelo que no responda no debe dejar
     al resto sin pintar. */
  function leer(d) {
    return new Promise(resolve => {
      const m = d.modelo;
      let cerrado = false;
      const acabar = (estado, detalle) => {
        if (cerrado) return;
        cerrado = true;
        d.estado = estado;
        if (detalle) d.detalle = detalle;
        resolve();
      };
      const limite = setTimeout(() => acabar('timeout', 'no respondió a tiempo'), LIMITE_MODELO);

      d.estado = 'leyendo';
      pintar();

      const props = [].concat(P_CAT, P_PLAN, P_EJEC, window.costos.propsCantidad);

      m.getObjectTree(tree => {
        const hojas = [];
        tree.enumNodeChildren(tree.getRootId(), id => {
          if (tree.getChildCount(id) === 0) hojas.push(id);
        }, true);
        d.elementos = hojas.length;
        if (!hojas.length) { clearTimeout(limite); return acabar('vacio', 'sin árbol de objetos'); }

        m.getBulkProperties2(hojas, { propFilter: props }, res => {
          clearTimeout(limite);
          procesar(d, res);
          acabar('listo');
        }, err => { clearTimeout(limite); acabar('error', String(err)); });
      }, err => { clearTimeout(limite); acabar('error', String(err)); });
    });
  }

  /* Acumula por combinación de fechas, no elemento por elemento: son ~1800
     elementos por modelo y sólo hacen falta los importes agrupados. */
  function procesar(d, res) {
    for (const o of res) {
      const p = {};
      for (const x of o.properties) p[x.displayName] = String(x.displayValue);

      const imp = window.costos.importeDe(val(p, P_CAT), p);
      if (imp <= 0) { d.sinCosto++; continue; }

      d.importeTotal += imp;
      d.conCosto++;

      const plan = aISO(val(p, P_PLAN));
      const ejec = aISO(val(p, P_EJEC));
      if (plan) d.conPlan++;
      if (ejec) d.conEjec++;

      const k = (plan || '') + '|' + (ejec || '');
      const c = d.comb.get(k) || { plan, ejec, imp: 0, n: 0 };
      c.imp += imp; c.n++;
      d.comb.set(k, c);

      /* Mismo agregado, pero por categoría: es el desglose que se abre al
         hacer clic en la disciplina. Cimentación, armazón, suelos… */
      const cat = String(val(p, P_CAT) || 'Sin categoría').replace('Revit ', '').trim();
      let pc = d.porCat.get(cat);
      if (!pc) { pc = { cat, n: 0, imp: 0, comb: new Map() }; d.porCat.set(cat, pc); }
      pc.n++; pc.imp += imp;
      const c2 = pc.comb.get(k) || { plan, ejec, imp: 0, n: 0 };
      c2.imp += imp; c2.n++;
      pc.comb.set(k, c2);

      /* Los dbId sí se guardan uno por uno: sin ellos no se puede teñir
         ni aislar nada en el visor. */
      (ejec ? d.idsEjec : d.idsPend).push(o.dbId);
    }
  }

  /* ── Métricas ─────────────────────────────────────────────────────────
     Todo se deriva de d.comb, así que cambiar el corte no obliga a releer. */
  function metricas(d, corte) {
    return metricasDe(d.comb, d.importeTotal, corte);
  }

  /* La misma fórmula sirve para una disciplina entera o para una sola
     categoría dentro de ella: lo único que cambia es el comb que recibe. */
  function metricasDe(comb, importeTotal, corte) {
    let ejec = 0, plan = 0, atraso = 0, adelanto = 0, difPond = 0, impDif = 0;
    let efPond = 0, efImp = 0;
    const curvaPlan = new Map(), curvaEjec = new Map();

    for (const c of comb.values()) {
      const hecho  = c.ejec && (!corte || c.ejec <= corte);
      const debido = c.plan && (!corte || c.plan <= corte);
      if (hecho)  { ejec += c.imp; curvaEjec.set(c.ejec, (curvaEjec.get(c.ejec) || 0) + c.imp); }
      if (debido) { plan += c.imp; }
      if (c.plan) curvaPlan.set(c.plan, (curvaPlan.get(c.plan) || 0) + c.imp);
      if (debido && !hecho) atraso += c.imp;
      if (c.plan && c.ejec) {
        const dd = dia(c.ejec) - dia(c.plan);
        difPond += dd * c.imp; impDif += c.imp;
        if (dd < 0) adelanto += c.imp;
      }

      /* Desviación EFECTIVA. La de arriba sólo mira elementos con las dos
         fechas, así que es ciega a lo que se comprometió y nunca se hizo:
         una disciplina sentada sobre trabajo vencido salía «adelantada»
         por lo poco que sí ejecutó temprano. Aquí lo vencido y sin ejecutar
         entra con los días que lleva acumulados (corte − plan), que es el
         atraso que de verdad se siente en obra. */
      if (c.plan && hecho) {
        efPond += (dia(c.ejec) - dia(c.plan)) * c.imp; efImp += c.imp;
      } else if (debido && !hecho && corte) {
        efPond += (dia(corte) - dia(c.plan)) * c.imp; efImp += c.imp;
      }
    }

    const total = importeTotal || 0;
    return {
      total, ejec, plan, atraso, adelanto,
      pctEjec: total ? ejec / total * 100 : 0,
      pctPlan: total ? plan / total * 100 : 0,
      /* desvDias  = de lo ejecutado, cuántos días antes o después se hizo.
         desvEfectiva = lo anterior MÁS el atraso acumulado de lo vencido.
         La que se enseña es la efectiva; la otra queda para diagnóstico. */
      desvDias: impDif ? difPond / impDif : null,
      desvEfectiva: efImp ? efPond / efImp : null,
      curvaPlan, curvaEjec
    };
  }

  /* ── Proyección de cierre ─────────────────────────────────────────────
     No es una promesa: es aritmética sobre sus propios datos. Se mide el
     ritmo real —importe ejecutado entre el primer y el último corte de esa
     disciplina— y se extrapola lo que falta. Con menos de dos cortes no hay
     ritmo medible y no se proyecta nada, que es más honesto que inventar. */
  function proyectar(d, corte) {
    const fechas = [...d.comb.values()].filter(c => c.ejec).map(c => c.ejec).sort();
    if (fechas.length < 2) return null;
    const primera = fechas[0], ultima = fechas[fechas.length - 1];
    const span = dia(ultima) - dia(primera);
    if (span <= 0) return null;

    const m = metricas(d, corte);
    const ritmo = m.ejec / span;                       // importe por día
    if (ritmo <= 0) return null;

    const restante = m.total - m.ejec;
    if (restante <= 0) return { terminada: true, desliz: 0 };

    const diasFaltan = restante / ritmo;
    const finProyectado = desdeDia(dia(corte) + Math.round(diasFaltan));
    const planFin = [...d.comb.values()].filter(c => c.plan).map(c => c.plan).sort().pop();
    const desliz = planFin ? dia(finProyectado) - dia(planFin) : null;

    /* Riesgo a corto plazo: lo que vence en el horizonte más lo ya vencido,
       contra lo que esa disciplina puede entregar a su ritmo actual. */
    const hasta = desdeDia(dia(corte) + HORIZONTE);
    let comprometido = 0;
    for (const c of d.comb.values()) {
      const hecho = c.ejec && c.ejec <= corte;
      if (hecho || !c.plan) continue;
      if (c.plan <= hasta) comprometido += c.imp;
    }
    const capacidad = ritmo * HORIZONTE;
    const enRiesgo = Math.max(0, comprometido - capacidad);

    return { ritmo, diasFaltan, finProyectado, planFin, desliz, enRiesgo, comprometido, capacidad, terminada: false };
  }

  /* ── Arranque ─────────────────────────────────────────────────────────── */
  window.addEventListener('aps:viewer-ready', e => {
    if (e.detail.key !== 'general') return;
    viewer = e.detail.viewer;
    arrancar();
  });

  async function arrancar() {
    arrancado = true;
    const ms = viewer.getAllModels();
    disciplinas = ms.map((m, i) => {
      const nodo = m.getDocumentNode && m.getDocumentNode();
      return {
        i, modelo: m,
        nombre: limpiaNombre(nodo ? nodo.getModelName() : null),
        estado: 'pendiente', elementos: 0, conCosto: 0, sinCosto: 0,
        conPlan: 0, conEjec: 0, importeTotal: 0, comb: new Map(), detalle: '',
        porCat: new Map(),          // categoría → { n, imp, comb }
        idsEjec: [], idsPend: []    // para colorear y aislar en el visor
      };
    });
    pintar();

    for (const d of disciplinas) {
      await leer(d);
      pintar();
    }

    const listas = disciplinas.filter(d => d.estado === 'listo').length;
    setStatus(textoVisibles());
    const sp = window.costos.sinPrecio();
    if (sp.length) {
      console.info('[general] categorías sin precio en costos.js →',
                   sp.slice(0, 15).map(([c, n]) => c + ' x' + n).join(' · '));
    }
    const sc = window.costos.sinCantidad();
    if (sc.length) {
      console.warn('[general] categorías CON precio pero sin cantidad legible →',
                   sc.map(([c, n]) => c + ' x' + n).join(' · '),
                   '· no ponderan: revisa qué propiedad publica el visor para esa categoría');
    }
    if (malFormadas.size) {
      console.warn('[general] fechas que no se pudieron interpretar:',
                   [...malFormadas].map(([v, c]) => '«' + v + '» x' + c).join(' · '));
    }
    pintar();
  }

  /* ── Pintado ──────────────────────────────────────────────────────────── */
  function corteGlobal() {
    let max = null;
    for (const d of disciplinas) {
      for (const c of d.comb.values()) {
        if (c.ejec && (!max || c.ejec > max)) max = c.ejec;
      }
    }
    return max;
  }

  function pintar() {
    pintarToggles();
    const root = $('general-root');
    if (!root) return;

    const listas = disciplinas.filter(d => d.estado === 'listo');
    const leyendo = disciplinas.find(d => d.estado === 'leyendo');
    const badge = $('general-source');

    if (!disciplinas.length) {
      if (visorFallo) {
        if (badge) badge.textContent = 'Sin datos del modelo';
        root.innerHTML = tarjetaEstado('Sin datos del modelo',
          'El visor federado no cargó. Sin modelo no hay avance que calcular.');
      } else {
        root.innerHTML = tarjetaEstado('Leyendo los modelos…',
          'Suele tardar un par de minutos.');
      }
      return;
    }

    if (badge) {
      badge.textContent = listas.length === disciplinas.length
        ? 'Datos en vivo del modelo'
        : `Leyendo ${listas.length}/${disciplinas.length} disciplinas…`;
    }

    if (!listas.length) {
      root.innerHTML = tarjetaEstado(
        leyendo ? 'Leyendo ' + esc(leyendo.nombre) + '…' : 'Leyendo los modelos…',
        'Leer diez modelos tarda varios minutos.')
        + progresoHTML();
      return;
    }

    const corte = corteGlobal();
    const filas = disciplinas.map(d => ({ d, m: metricas(d, corte), p: proyectar(d, corte) }));
    const conDatos = filas.filter(f => f.m.total > 0);

    const total = conDatos.reduce((a, f) => a + f.m.total, 0) || 1;
    const ejec  = conDatos.reduce((a, f) => a + f.m.ejec, 0);
    const plan  = conDatos.reduce((a, f) => a + f.m.plan, 0);
    const general = ejec / total * 100;
    const programa = plan / total * 100;
    const brecha = general - programa;

    let difPond = 0, impDif = 0;
    for (const f of conDatos) if (f.m.desvEfectiva !== null) { difPond += f.m.desvEfectiva * f.m.total; impDif += f.m.total; }
    const desvGlobal = impDif ? difPond / impDif : null;

    root.innerHTML =
      seccionGeneral(general, programa, brecha, desvGlobal, corte, conDatos, total) +
      progresoHTML() +
      seccionDisciplinas(filas, total, corte) +
      seccionDesglose(filas, corte) +
      seccionRiesgo(filas, total, corte) +
      seccionCurva(conDatos, total, corte) +
      seccionMetodo(filas);
  }

  function tarjetaEstado(titulo, texto) {
    return `
      <section>
        <div class="card" style="gap:16px;align-items:flex-start">
          <div style="${GROT}font-weight:700;font-size:28px;line-height:1.15;letter-spacing:-.02em;color:var(--t-hi)">${esc(titulo)}</div>
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted);max-width:62ch;line-height:1.65">${esc(texto)}</div>
        </div>
      </section>`;
  }

  function progresoHTML() {
    const filas = disciplinas.map(d => {
      const etiqueta = d.estado === 'listo'   ? nf(d.conCosto, 0) + ' elementos'
                     : d.estado === 'leyendo' ? 'leyendo…'
                     : d.estado === 'pendiente' ? 'en cola'
                     : d.estado === 'timeout' ? 'sin respuesta'
                     : d.estado === 'vacio'   ? 'sin datos'
                     : 'error';
      const color = d.estado === 'listo' ? 'var(--ok)'
                  : d.estado === 'leyendo' ? 'var(--warn)'
                  : d.estado === 'pendiente' ? 'var(--t-faint)' : 'var(--crit)';
      return `<div style="display:flex;align-items:center;gap:10px">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};display:block;flex:none"></span>
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-mid);flex:1;min-width:0">${esc(d.nombre)}</span>
          <span style="${MONO}font-size:11px;color:var(--t-faint);white-space:nowrap">${esc(etiqueta)}</span>
        </div>`;
    }).join('');

    const listas = disciplinas.filter(d => d.estado === 'listo').length;
    if (listas === disciplinas.length) return '';
    return `
      <section>
        <div class="card" style="gap:12px">
          <span style="${EYEBROW}">Lectura de disciplinas · ${listas} de ${disciplinas.length}</span>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 24px">${filas}</div>
        </div>
      </section>`;
  }

  function seccionGeneral(general, programa, brecha, desv, corte, conDatos, total) {
    const stack = conDatos.map((f, i) => `
      <div data-tip-label="${esc(f.d.nombre + ' · aporte al general')}"
           data-tip-value="${esc(nf(f.m.ejec / total * 100, 1) + ' % de 100 %')}"
           style="height:100%;transition:width 400ms ease-out;cursor:pointer;width:${f.m.ejec / total * 100}%;background:${SERIES[i % SERIES.length]}"></div>`).join('');

    return `
      <section>
        <div class="sec-head">
          <h2 class="sec">Avance general del proyecto.</h2>
          <span class="eyebrow">Ponderado por costo estimado</span>
        </div>
        <div class="card" style="gap:26px">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap">
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="${EYEBROW}">Avance ponderado al corte</div>
              <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
                <span style="${GROT}font-weight:700;font-size:64px;line-height:1;letter-spacing:-.03em;white-space:nowrap;font-variant-numeric:tabular-nums;color:${pctColor(general)}">${nf(general, 1)} %</span>
                <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted)">${conDatos.length} disciplinas con datos${corte ? ' · corte ' + fCorta(corte) : ''}</span>
              </div>
            </div>
            <div style="display:flex;gap:28px;flex-wrap:wrap">
              ${kpi('Programa al corte', nf(programa, 1) + ' %', 'var(--t-mid)')}
              ${kpi('Brecha', (brecha >= 0 ? '+' : '') + nf(brecha, 1) + ' pts', brecha >= 0 ? 'var(--ok)' : 'var(--crit)')}
              ${kpi('Desviación media', desv === null ? '—' : (desv >= 0 ? '+' : '') + nf(desv, 1) + ' d', desv === null ? 'var(--t-faint)' : desvColor(desv))}
            </div>
          </div>
          <div style="display:flex;height:16px;border-radius:8px;background:var(--grid);overflow:hidden">${stack}</div>
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-muted)">
            ${brecha >= 0
              ? 'La obra va por delante del programa.'
              : 'La obra va por detrás del programa.'}
          </div>
        </div>
      </section>`;
  }

  function kpi(label, valor, color) {
    return `<div style="display:flex;flex-direction:column;gap:6px">
        <span style="${EYEBROW}">${esc(label)}</span>
        <span style="${GROT}font-weight:700;font-size:26px;font-variant-numeric:tabular-nums;color:${color}">${esc(valor)}</span>
      </div>`;
  }

  /* Tarjeta compacta de una disciplina que ya arrancó. */
  function tarjetaConAvance(f) {
    const { d, m, p, color } = f;
    const activa = aislada === d.nombre;
    const desliz = p && !p.terminada && p.desliz !== null ? p.desliz : null;
    return `
      <button data-disciplina="${esc(d.nombre)}" style="display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:14px;text-align:left;font:inherit;cursor:pointer;transition:background 140ms ease-out,border-color 140ms ease-out;background:var(--well);border:1px solid ${activa ? 'var(--accent)' : 'var(--line)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${color}"></span>
            <span style="${MONO}font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.nombre)}</span>
          </div>
          <span style="${MONO}font-size:9px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;padding:3px 8px;border-radius:6px;${activa ? 'background:var(--green-tint);color:var(--accent)' : 'background:transparent;color:var(--t-faint)'}">${activa ? 'Aislada' : 'Aislar'}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:10px">
          <span style="${GROT}font-weight:700;font-size:30px;line-height:1;font-variant-numeric:tabular-nums;color:${pctColor(m.pctEjec)}">${nf(m.pctEjec, 1)} %</span>
          <span style="${MONO}font-size:11px;letter-spacing:.1em;color:var(--t-faint);white-space:nowrap">peso ${nf(f.peso, 1)} %</span>
        </div>
        <div style="position:relative;height:8px;border-radius:6px;background:var(--grid)">
          <div style="position:absolute;left:0;top:0;bottom:0;border-radius:6px;transition:width 400ms ease-out;width:${Math.max(m.pctEjec, 0.8)}%;background:${pctColor(m.pctEjec)}"></div>
          <div style="position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--t-mid);opacity:.9;left:${Math.min(m.pctPlan, 99.7)}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;${MONO}font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--t-faint)">
          <span>Programa ${nf(m.pctPlan, 0)} %</span>
          <span title="Incluye el atraso de lo vencido sin ejecutar" style="padding:3px 8px;border-radius:6px;background:var(--surface);color:${m.desvEfectiva === null ? 'var(--t-faint)' : desvColor(m.desvEfectiva)}">${m.desvEfectiva === null ? 'sin desviación' : (m.desvEfectiva >= 0 ? '+' : '') + nf(m.desvEfectiva, 0) + ' d'}</span>
        </div>
        <div style="${MONO}font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${desliz === null ? 'var(--t-faint)' : desvColor(desliz)}">
          ${p && p.terminada ? 'Terminada'
            : desliz === null ? 'Sin ritmo medible'
            : desliz > 0 ? 'Proyección: ' + desliz + ' d tarde'
            : desliz < 0 ? 'Proyección: ' + (-desliz) + ' d antes'
            : 'Proyección: en fecha'}
        </div>
      </button>`;
  }

  /* Renglón ancho para una disciplina que todavía no arranca.

     Va aparte y a todo lo ancho a propósito: meter en la rejilla una tarjeta
     con barra en cero, «sin desviación» y «sin ritmo medible» es ruido que
     compite por la atención con las que sí avanzan. Pero sigue siendo una
     tarjeta pulsable, porque aislar en el visor una disciplina sin empezar es
     justo lo que uno quiere hacer para ver dónde va a caer.

     Lo poco que hay que decir, se dice: si el programa ya la comprometía y
     nadie la ha tocado, eso es lo importante de esa disciplina hoy. */
  function filaSinArrancar(f) {
    const { d, m, color } = f;
    const activa = aislada === d.nombre;
    const sinDatos = m.total <= 0;

    const comprometido = !sinDatos && m.pctPlan > 0;
    const titular = sinDatos ? 'Sin datos'
                  : comprometido ? 'Sin ejecución'
                  : 'Fuera de programa al corte';
    const detalle = sinDatos ? estadoTexto(d)
                  : comprometido
                    ? nf(m.pctPlan, 0) + ' % comprometido al corte, sin ejecutar'
                    : 'Primera fecha de planeación posterior al corte';

    const dato = (etiqueta, valor, color2) => `<div style="display:flex;flex-direction:column;gap:4px;min-width:74px">
        <span style="${MONO}font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-faint)">${esc(etiqueta)}</span>
        <span style="${GROT}font-weight:700;font-size:15px;font-variant-numeric:tabular-nums;color:${color2}">${esc(valor)}</span>
      </div>`;

    const datos = sinDatos ? '' : [
      dato('Peso', nf(f.peso, 1) + ' %', 'var(--t-mid)'),
      dato('Programa', nf(m.pctPlan, 0) + ' %', comprometido ? 'var(--warn)' : 'var(--t-faint)'),
      m.desvEfectiva === null ? ''
        : dato('Atraso', (m.desvEfectiva >= 0 ? '+' : '') + nf(m.desvEfectiva, 0) + ' d', desvColor(m.desvEfectiva)),
      dato('Elementos', nf(d.conCosto, 0), 'var(--t-mid)')
    ].join('');

    return `
      <button data-disciplina="${esc(d.nombre)}" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;width:100%;padding:16px 20px;border-radius:14px;text-align:left;font:inherit;cursor:pointer;transition:background 140ms ease-out,border-color 140ms ease-out;background:var(--well);border:1px solid ${activa ? 'var(--accent)' : 'var(--line)'}">
        <span style="width:10px;height:10px;border-radius:3px;flex:none;background:${color};opacity:${sinDatos ? '.35' : '.7'}"></span>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:200px">
          <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
            <span style="${GROT}font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--t-hi)">${esc(d.nombre)}</span>
            <span style="${MONO}font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${sinDatos ? 'var(--t-faint)' : comprometido ? 'var(--warn)' : 'var(--t-muted)'}">${esc(titular)}</span>
          </div>
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-muted);line-height:1.45">${esc(detalle)}</span>
        </div>
        <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">${datos}</div>
        <span style="${MONO}font-size:9px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;padding:4px 10px;border-radius:6px;flex:none;${activa ? 'background:var(--green-tint);color:var(--accent)' : 'background:var(--surface);color:var(--t-faint)'}">${activa ? 'Aislada' : 'Aislar'}</span>
      </button>`;
  }

  function seccionDisciplinas(filas, total, corte) {
    /* «Arrancada» es tener algo ejecutado, no tener datos: una disciplina
       leída correctamente pero con cero avance pertenece abajo. */
    const conAvance = [], sinArrancar = [];
    filas.forEach((f, i) => {
      const fila = Object.assign({}, f, {
        color: SERIES[i % SERIES.length],
        peso: total ? f.m.total / total * 100 : 0
      });
      (f.m.ejec > 0 ? conAvance : sinArrancar).push(fila);
    });

    const arriba = conAvance.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">${conAvance.map(tarjetaConAvance).join('')}</div>`
      : `<div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted)">Sin avance ejecutado.</div>`;

    const abajo = sinArrancar.length ? `
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:4px">
        <span style="${EYEBROW}">Sin arrancar · ${sinArrancar.length} de ${filas.length}</span>
        ${sinArrancar.map(filaSinArrancar).join('')}
      </div>` : '';

    return `
      <section id="general-disciplinas">
        <div class="sec-head">
          <h2 class="sec">Avance por disciplina.</h2>
          <span class="eyebrow">La marca vertical es el programa</span>
        </div>
        <div class="card" style="gap:22px">${arriba}${abajo}</div>
      </section>`;
  }

  function seccionDesglose(filas, corte) {
    if (!aislada) return '';
    const f = filas.find(x => x.d.nombre === aislada);
    if (!f) return '';
    const d = f.d;
    if (!d.porCat.size) {
      return `
      <section id="general-desglose">
        <div class="card" style="gap:14px">
          <span style="${EYEBROW}">${esc(d.nombre)} · desglose</span>
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted)">Sin elementos con precio en la tabla de costos.</div>
        </div>
      </section>`;
    }

    const total = f.m.total || 1;
    const cats = [...d.porCat.values()]
      .map(pc => ({ pc, m: metricasDe(pc.comb, pc.imp, corte) }))
      .sort((a, b) => b.pc.imp - a.pc.imp);
    const maxImp = Math.max(...cats.map(c => c.pc.imp));

    const renglones = cats.map((c, i) => {
      const peso = c.pc.imp / total * 100;
      const col = pctColor(c.m.pctEjec);
      /* El ancho del riel es proporcional al peso de la categoría: una
         categoría que vale el 2 % no debe verse igual de larga que una que
         vale el 60 %, o el desglose engaña a simple vista. */
      const escala = Math.max(c.pc.imp / maxImp * 100, 6);
      return `
        <div style="display:flex;align-items:center;gap:16px">
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-mid);width:200px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.pc.cat)}">${esc(c.pc.cat)}</span>
          <div style="flex:1;min-width:0">
            <div style="position:relative;height:22px;width:${escala}%;background:var(--grid);border-radius:5px;min-width:40px">
              <div style="position:absolute;left:0;top:0;bottom:0;border-radius:5px;transition:width 400ms ease-out;width:${Math.max(c.m.pctEjec, 0.8)}%;background:${col}"></div>
              <div style="position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--t-mid);opacity:.9;left:${Math.min(c.m.pctPlan, 99.5)}%"></div>
            </div>
          </div>
          <span style="${MONO}font-size:12px;color:var(--t-faint);width:96px;text-align:right;flex:none;font-variant-numeric:tabular-nums">${nf(c.pc.n, 0)} pzas</span>
          <span style="${MONO}font-size:12px;color:var(--t-muted);width:72px;text-align:right;flex:none;font-variant-numeric:tabular-nums">${nf(peso, 1)} %</span>
          <span style="${MONO}font-size:12px;width:76px;text-align:right;flex:none;font-variant-numeric:tabular-nums;color:${c.m.desvEfectiva === null ? 'var(--t-faint)' : desvColor(c.m.desvEfectiva)}">${c.m.desvEfectiva === null ? '—' : (c.m.desvEfectiva >= 0 ? '+' : '') + nf(c.m.desvEfectiva, 0) + ' d'}</span>
          <span style="${GROT}font-weight:700;font-size:15px;width:64px;text-align:right;flex:none;font-variant-numeric:tabular-nums;color:${col}">${nf(c.m.pctEjec, 0)} %</span>
        </div>`;
    }).join('');

    return `
      <section id="general-desglose">
        <div class="sec-head">
          <h2 class="sec">${esc(d.nombre)} · por partida.</h2>
          <span class="eyebrow">Ancho del riel: peso de la partida</span>
        </div>
        <div class="card" style="gap:22px">
          <div style="display:flex;gap:32px;flex-wrap:wrap">
            ${kpi('Avance de la disciplina', nf(f.m.pctEjec, 1) + ' %', pctColor(f.m.pctEjec))}
            ${kpi('Programa al corte', nf(f.m.pctPlan, 1) + ' %', 'var(--t-mid)')}
            ${kpi('Partidas', String(cats.length), 'var(--t-hi)')}
            ${kpi('Elementos con precio', nf(d.conCosto, 0), 'var(--t-hi)')}
          </div>
          <div class="well" style="display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;align-items:center;gap:16px;${MONO}font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-faint)">
              <span style="width:200px;flex:none">Partida</span>
              <span style="flex:1;min-width:0">Avance</span>
              <span style="width:96px;text-align:right;flex:none">Elementos</span>
              <span style="width:72px;text-align:right;flex:none">Peso</span>
              <span style="width:76px;text-align:right;flex:none">Desv.</span>
              <span style="width:64px;text-align:right;flex:none">%</span>
            </div>
            ${renglones}
          </div>
          ${d.sinCosto ? `<div style="${MONO}font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--t-faint)">${nf(d.sinCosto, 0)} elementos sin precio en la tabla no entran en este desglose</div>` : ''}
        </div>
      </section>`;
  }

  function estadoTexto(d) {
    if (d.estado === 'leyendo')   return 'leyendo…';
    if (d.estado === 'pendiente') return 'en cola';
    if (d.estado === 'timeout')   return 'el modelo no respondió';
    if (d.estado === 'error')     return 'error al leer';
    if (d.estado === 'vacio')     return 'sin árbol de objetos';
    if (!d.conCosto)              return 'sin categorías con precio';
    return 'sin fechas capturadas';
  }

  /* ── Riesgo: vencido, en riesgo y proyección ─────────────────────────── */
  function seccionRiesgo(filas, total, corte) {
    if (!corte) return '';

    const conDatos = filas.filter(f => f.m.total > 0);
    const vencido  = conDatos.reduce((a, f) => a + f.m.atraso, 0);
    const enRiesgo = conDatos.reduce((a, f) => a + (f.p && !f.p.terminada ? f.p.enRiesgo : 0), 0);

    /* Ranking con signo: arriba lo más atrasado, abajo lo más adelantado.
       Se ordena por desviación en días, que es lo que se siente en obra. */
    /* Se ordena por la desviación EFECTIVA, no por la de lo ejecutado: si
       no, una disciplina con trabajo vencido sin tocar aparece adelantada
       porque lo poco que hizo lo hizo temprano. */
    const rank = conDatos
      .filter(f => f.m.desvEfectiva !== null)
      .sort((a, b) => b.m.desvEfectiva - a.m.desvEfectiva);

    const maxAbs = Math.max(1, ...rank.map(f => Math.abs(f.m.desvEfectiva)));
    const barras = rank.map(f => {
      const v = f.m.desvEfectiva;
      const ancho = Math.abs(v) / maxAbs * 50;
      const col = v > 0 ? 'var(--crit)' : v < 0 ? 'var(--ok)' : 'var(--t-faint)';
      return `
        <div style="display:flex;align-items:center;gap:14px">
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-mid);width:150px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.d.nombre)}</span>
          <div style="flex:1;min-width:0;display:flex;align-items:center;height:18px">
            <div style="width:50%;display:flex;justify-content:flex-end">
              ${v < 0 ? `<span style="height:10px;border-radius:3px 0 0 3px;background:${col};width:${ancho * 2}%"></span>` : ''}
            </div>
            <span style="width:1px;height:18px;background:var(--line);flex:none"></span>
            <div style="width:50%">
              ${v > 0 ? `<span style="display:block;height:10px;border-radius:0 3px 3px 0;background:${col};width:${ancho * 2}%"></span>` : ''}
            </div>
          </div>
          <span style="${GROT}font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;width:76px;text-align:right;flex:none;color:${col}">${v >= 0 ? '+' : ''}${nf(v, 0)} d</span>
        </div>`;
    }).join('');

    const proyecciones = conDatos
      .filter(f => f.p && !f.p.terminada && f.p.desliz !== null && f.p.desliz > 0)
      .sort((a, b) => b.p.desliz - a.p.desliz)
      .map(f => `
        <div style="display:flex;align-items:baseline;gap:14px">
          <span style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-mid);flex:1;min-width:0">${esc(f.d.nombre)}</span>
          <span style="${MONO}font-size:11px;color:var(--t-faint);white-space:nowrap">plan ${fCorta(f.p.planFin)}</span>
          <span style="${MONO}font-size:11px;color:var(--t-muted);white-space:nowrap">→ ${fCorta(f.p.finProyectado)}</span>
          <span style="${GROT}font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;color:${desvColor(f.p.desliz)};width:64px;text-align:right">+${f.p.desliz} d</span>
        </div>`).join('');

    return `
      <section>
        <div class="sec-head">
          <h2 class="sec">Atrasos y riesgo.</h2>
        </div>
        <div class="card" style="gap:26px">
          <div style="display:flex;gap:32px;flex-wrap:wrap">
            ${kpi('Vencido sin ejecutar', nf(vencido / total * 100, 1) + ' pts', vencido > 0 ? 'var(--crit)' : 'var(--ok)')}
            ${kpi('En riesgo a ' + HORIZONTE + ' días', nf(enRiesgo / total * 100, 1) + ' pts', enRiesgo > 0 ? 'var(--warn)' : 'var(--ok)')}
            ${kpi('Disciplinas atrasadas', String(rank.filter(f => f.m.desvEfectiva > 0).length), 'var(--t-hi)')}
            ${kpi('Disciplinas adelantadas', String(rank.filter(f => f.m.desvEfectiva < 0).length), 'var(--ok)')}
          </div>

          ${barras ? `
          <div class="well" style="display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between;${MONO}font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--t-faint)">
              <span>◀ adelantado</span><span>atrasado ▶</span>
            </div>
            <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:12px;color:var(--t-muted);line-height:1.5;margin-bottom:4px">
              Días ponderados por importe. Incluye lo vencido sin ejecutar.
            </div>
            ${barras}
          </div>` : ''}

          ${proyecciones ? `
          <div style="display:flex;flex-direction:column;gap:12px">
            <span style="${EYEBROW}">Proyección de cierre al ritmo actual</span>
            <div class="well" style="display:flex;flex-direction:column;gap:10px">${proyecciones}</div>
            <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;color:var(--t-muted);line-height:1.6;max-width:70ch">
              Extrapola a lo que falta el ritmo de cada disciplina entre su primer y su último
              corte. Con menos de dos cortes no se proyecta.
            </div>
          </div>` : ''}
        </div>
      </section>`;
  }

  /* ── Curva ───────────────────────────────────────────────────────────── */
  function seccionCurva(conDatos, total, corte) {
    const plan = new Map(), ejec = new Map();
    for (const f of conDatos) {
      for (const [k, v] of f.m.curvaPlan) plan.set(k, (plan.get(k) || 0) + v);
      for (const [k, v] of f.m.curvaEjec) ejec.set(k, (ejec.get(k) || 0) + v);
    }
    const acum = m => {
      let a = 0;
      return [...m.entries()].sort(([x], [y]) => x < y ? -1 : 1)
        .map(([fecha, v]) => { a += v; return { fecha, pct: a / total * 100 }; });
    };
    const cp = acum(plan), ce = acum(ejec);
    if (cp.length < 2) return '';

    const W = 980, H = 340, L = 48, R = 18, T = 20, B = 46;
    const todas = cp.concat(ce).map(p => dia(p.fecha));
    const t0 = Math.min(...todas), t1 = Math.max(...todas);
    const x = iso => L + (dia(iso) - t0) / ((t1 - t0) || 1) * (W - L - R);
    const y = v => T + (1 - v / 100) * (H - T - B);

    const rejilla = [0, 25, 50, 75, 100].map(v => `
      <line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"></line>
      <text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="var(--t-faint)" style="${MONO}font-size:11px">${v}%</text>`).join('');

    const linea = pts => pts.map((p, i) => (i ? 'L' : 'M') + x(p.fecha).toFixed(1) + ' ' + y(p.pct).toFixed(1)).join(' ');
    const areaE = ce.length > 1
      ? `<path d="${linea(ce)} L${x(ce[ce.length-1].fecha).toFixed(1)} ${y(0)} L${x(ce[0].fecha).toFixed(1)} ${y(0)} Z" fill="var(--accent)" opacity=".12"></path>` : '';

    const meses = [];
    const vistos = {};
    for (const p of cp) {
      const k = p.fecha.slice(0, 7);
      if (vistos[k]) continue;
      vistos[k] = 1;
      meses.push(`<text x="${x(p.fecha).toFixed(1)}" y="${H - B + 22}" text-anchor="middle" fill="var(--t-faint)" style="${MONO}font-size:11px;text-transform:uppercase">${MESES[+p.fecha.slice(5,7)-1]} ${p.fecha.slice(2,4)}</text>`);
    }

    const marcaCorte = corte && dia(corte) >= t0 && dia(corte) <= t1
      ? `<line x1="${x(corte).toFixed(1)}" y1="${T}" x2="${x(corte).toFixed(1)}" y2="${H-B}" stroke="var(--crit)" stroke-width="1.5" stroke-dasharray="4 5"></line>
         <text x="${(x(corte)-8).toFixed(1)}" y="${T+12}" text-anchor="end" fill="var(--crit)" style="${MONO}font-size:11px;text-transform:uppercase">corte</text>` : '';

    const puntos = ce.map(p => `<circle cx="${x(p.fecha).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--well)" stroke-width="2"
        data-tip-label="${esc('Ejecutado al ' + fCorta(p.fecha))}" data-tip-value="${esc(nf(p.pct,1) + ' %')}" style="cursor:pointer"></circle>`).join('');

    return `
      <section>
        <div class="sec-head">
          <h2 class="sec">Programa contra obra.</h2>
          <span class="eyebrow">Ponderado por costo</span>
        </div>
        <div class="card" style="gap:20px">
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:9px">
              <span style="width:22px;height:0;border-top:2px dashed var(--info);display:block"></span>
              <span style="${EYEBROW}">Programa</span>
            </div>
            <div style="display:flex;align-items:center;gap:9px">
              <span style="width:22px;height:3px;border-radius:2px;background:var(--accent);display:block"></span>
              <span style="${EYEBROW}">Ejecutado</span>
            </div>
          </div>
          <div class="well">
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible">
              ${rejilla}${areaE}
              <path d="${linea(cp)}" fill="none" stroke="var(--info)" stroke-width="2.5" stroke-dasharray="7 6" stroke-linejoin="round"></path>
              ${ce.length > 1 ? `<path d="${linea(ce)}" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linejoin="round"></path>` : ''}
              ${marcaCorte}${puntos}${meses.join('')}
            </svg>
          </div>
        </div>
      </section>`;
  }

  function seccionMetodo(filas) {
    const sin = window.costos.sinPrecio().slice(0, 8);
    const sinCant = window.costos.sinCantidad().slice(0, 8);
    const sinFechas = filas.filter(f => f.d.estado === 'listo' && !f.d.conEjec && !f.d.conPlan);
    return `
      <section>
        <div class="card" style="gap:16px">
          <span style="${EYEBROW}">Método</span>
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;color:var(--t-muted);line-height:1.7;max-width:78ch">
            Los importes salen de una tabla de <strong>costos estimados</strong>, no del
            presupuesto del cliente. Sirven para comparar disciplinas entre sí.
            ${sinFechas.length ? `<br><br>Sin fechas capturadas: ${esc(sinFechas.map(f => f.d.nombre).join(', '))}.` : ''}
            ${sin.length ? `<br><br>Categorías vistas sin precio en la tabla: ${esc(sin.map(([c, n]) => c + ' (' + n + ')').join(' · '))}. No ponderan.` : ''}
            ${sinCant.length ? `<br><br><strong>Con precio pero sin cantidad legible:</strong> ${esc(sinCant.map(([c, n]) => c + ' (' + n + ')').join(' · '))}. Tampoco ponderan: el visor no publica su cantidad.` : ''}
          </div>
        </div>
      </section>`;
  }

  /* ── Coloreado del visor ─────────────────────────────────────────────
     Ojo con un detalle que cuesta un rato descubrir: clearThemingColors()
     sin argumento sólo limpia el PRIMER modelo. Con diez cargados hay que
     pasarle cada uno, o el botón de restablecer parece no hacer nada. */
  function hex2vec(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return new THREE.Vector4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255,
                             (n & 255) / 255, alpha === undefined ? 1 : alpha);
  }

  function limpiarColores() {
    for (const d of disciplinas) {
      try { viewer.clearThemingColors(d.modelo); } catch (err) { /* según versión */ }
    }
  }

  /* Quién se ve lo decide `ocultos` y nadie más. Aislar una disciplina desde
     su tarjeta apaga las otras nueve, así que los interruptores quedan al día
     solos y se puede seguir encendiendo modelos a mano desde ahí. El modo de
     color es independiente: cambiarlo no devuelve a la pantalla lo apagado. */
  function aplicarVisibilidad() {
    for (const d of disciplinas) {
      const mostrar = !ocultos.has(d.nombre);
      try {
        if (mostrar) viewer.showModel(d.modelo, true);
        else viewer.hideModel(d.modelo);
      } catch (err) { /* según versión del SDK */ }
    }
  }

  function setModo(nuevo) {
    if (!viewer || typeof THREE === 'undefined') return;
    modo = modo === nuevo ? 'ninguno' : nuevo;
    limpiarColores();
    try { viewer.showAll(); } catch (err) { /* según versión */ }
    aplicarVisibilidad();

    if (modo === 'avance') {
      for (const d of disciplinas) {
        for (const id of d.idsEjec) viewer.setThemingColor(id, hex2vec(COLOR_EJEC), d.modelo);
        for (const id of d.idsPend) viewer.setThemingColor(id, hex2vec(COLOR_PEND, OPACIDAD_PEND), d.modelo);
      }
    } else if (modo === 'disciplina') {
      disciplinas.forEach((d, i) => {
        const c = hex2vec(SERIE_HEX[i % SERIE_HEX.length]);
        for (const id of d.idsEjec) viewer.setThemingColor(id, c, d.modelo);
        for (const id of d.idsPend) viewer.setThemingColor(id, c, d.modelo);
      });
    } else if (modo === 'ejecutados') {
      /* Aislar deja al resto en modo fantasma, que es justo el efecto que
         se busca: ves lo hecho sin perder de vista dónde va. */
      for (const d of disciplinas) {
        if (ocultos.has(d.nombre)) continue;
        try { viewer.isolate(d.idsEjec, d.modelo); } catch (err) { /* según versión */ }
      }
      aplicarVisibilidad();
    }
    leyenda();
    marcarBotones();
  }

  function leyenda() {
    const el = $('general-legend');
    if (!el) return;
    const punto = (c, txt) => '<span style="display:inline-flex;align-items:center;gap:7px;margin-right:16px"><span style="width:11px;height:11px;border-radius:3px;background:' + c + ';display:block"></span><span style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--t-muted)">' + esc(txt) + '</span></span>';
    if (modo === 'avance') {
      const ej = disciplinas.reduce((a, d) => a + d.idsEjec.length, 0);
      const pe = disciplinas.reduce((a, d) => a + d.idsPend.length, 0);
      el.innerHTML = punto(COLOR_EJEC, 'Ejecutados (' + nf(ej, 0) + ')') + punto(COLOR_PEND, 'Pendientes (' + nf(pe, 0) + ')');
    } else if (modo === 'disciplina') {
      el.innerHTML = disciplinas.map((d, i) => punto(SERIE_HEX[i % SERIE_HEX.length], d.nombre)).join('');
    } else if (modo === 'ejecutados') {
      el.innerHTML = punto(COLOR_EJEC, 'Sólo lo ejecutado · el resto en fantasma');
    } else {
      el.innerHTML = '';
    }
  }

  /* Lo que dice la barra sale de lo que se ve, no de lo último que se pulsó. */
  function textoVisibles() {
    const listas = disciplinas.filter(d => d.estado === 'listo').length;
    const vis = disciplinas.filter(d => !ocultos.has(d.nombre));
    if (!vis.length) return 'Ningún modelo en pantalla';
    if (vis.length === disciplinas.length) return `${listas} de ${disciplinas.length} disciplinas leídas`;
    if (vis.length === 1) return 'Sólo en pantalla: ' + vis[0].nombre;
    return `${vis.length} de ${disciplinas.length} modelos en pantalla`;
  }

  /* Encender o apagar un modelo suelto rompe el aislamiento: ya no hay una
     disciplina sola en pantalla, así que el desglose de abajo se cierra en vez
     de quedarse colgando de una selección que la vista ya no refleja. */
  function verModelos(nuevos) {
    ocultos = nuevos;
    const vis = disciplinas.filter(d => !ocultos.has(d.nombre));
    aislada = vis.length === 1 ? vis[0].nombre : null;
    if (viewer) aplicarVisibilidad();
    setStatus(textoVisibles());
    pintar();
  }

  function pintarToggles() {
    const card = $('general-models-card'), el = $('general-models');
    if (!card || !el) return;
    card.hidden = !disciplinas.length;
    if (!disciplinas.length) { el.innerHTML = ''; return; }
    el.innerHTML = disciplinas.map((d, i) => {
      const on = !ocultos.has(d.nombre);
      return `<button type="button" class="model-toggle" data-general-modelo="${esc(d.nombre)}"
                aria-pressed="${on}" title="${on ? 'Ocultar' : 'Mostrar'} ${esc(d.nombre)}">
                <span class="punto"${on ? ` style="background:${SERIES[i % SERIES.length]}"` : ''}></span>${esc(d.nombre)}
              </button>`;
    }).join('');
  }

  function marcarBotones() {
    const mapa = { avance: 'general-avance', disciplina: 'general-disciplina', ejecutados: 'general-ejecutados' };
    for (const k of Object.keys(mapa)) {
      const b = $(mapa[k]);
      if (b) b.classList.toggle('is-active', modo === k);
    }
  }

  /* ── Interacción con el visor ─────────────────────────────────────────── */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-disciplina]');
    if (btn) {
      const n = btn.dataset.disciplina;
      aislar(aislada === n ? null : n);
      return;
    }
    const tog = e.target.closest('[data-general-modelo]');
    if (tog) {
      const n = tog.dataset.generalModelo;
      const nuevos = new Set(ocultos);
      if (nuevos.has(n)) nuevos.delete(n); else nuevos.add(n);
      verModelos(nuevos);
      return;
    }
    if (e.target.closest('#general-todos'))   return verModelos(new Set());
    if (e.target.closest('#general-ninguno')) return verModelos(new Set(disciplinas.map(d => d.nombre)));
    if (e.target.closest('#general-avance'))     return setModo('avance');
    if (e.target.closest('#general-disciplina')) return setModo('disciplina');
    if (e.target.closest('#general-ejecutados')) return setModo('ejecutados');
    if (e.target.closest('#general-reset')) {
      modo = 'ninguno';
      aislar(null);
      if (viewer) {
        limpiarColores();
        try { viewer.showAll(); } catch (err) { /* según versión */ }
        aplicarVisibilidad();
      }
      leyenda();
      marcarBotones();
    }
  });

  function aislar(nombre) {
    aislada = nombre;
    ocultos = new Set(nombre ? disciplinas.filter(d => d.nombre !== nombre).map(d => d.nombre) : []);
    /* La barra y el desglose se actualizan haya visor o no: sin él la pestaña
       sigue siendo legible, sólo que no hay nada que apagar en pantalla. */
    setStatus(textoVisibles());
    if (viewer) aplicarVisibilidad();
    pintar();
    /* El desglose se abre debajo de las tarjetas; sin esto queda fuera de
       pantalla y parece que el clic no hizo nada. */
    if (nombre) {
      const el = $('general-desglose');
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: 'smooth' });
    }
  }

  /* El visor puede no llegar nunca —sin credenciales, red bloqueada, modelo
     caído—. Se pinta el estado de espera de inmediato y, pasado el límite,
     se dice que no llegó en vez de dejar la pestaña en blanco. */
  pintar();
  setTimeout(() => {
    if (arrancado) return;
    visorFallo = true;
    pintar();
  }, 150000);

  window.general = {
    get disciplinas() { return disciplinas; },
    get corte() { return corteGlobal(); },
    metricas: d => metricas(d, corteGlobal()),
    proyectar: d => proyectar(d, corteGlobal()),
    aislar,
    get ocultos() { return new Set(ocultos); },
    verModelos,
    repintar: pintar
  };
})();
