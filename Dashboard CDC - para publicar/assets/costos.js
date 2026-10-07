/* ─────────────────────────────────────────────────────────────────────────
   Costos unitarios ESTIMADOS · para ponderar el avance entre disciplinas.

   ⚠ ESTOS NÚMEROS NO SON UN PRESUPUESTO.

   El cliente no comparte sus precios, así que esta tabla existe para que el
   avance general tenga un sustento defendible en lugar de promediar peras
   con manzanas. Son órdenes de magnitud de obra instalada (material + mano
   de obra) para Guadalajara, Jalisco, 2026, en pesos.

   POR QUÉ SIRVE AUNQUE SEA APROXIMADA
   En un avance ponderado sólo pesa la PROPORCIÓN entre disciplinas, no el
   precio absoluto. Si toda la tabla estuviera un 20 % alta, el porcentaje
   no cambiaría ni un decimal. Sólo distorsiona si se equivoca la RELACIÓN
   entre partidas — poner el eléctrico pesando el doble de lo que pesa
   frente a arquitectura, por ejemplo.

   CÓMO SUSTITUIRLA POR LA REAL
   Cuando el cliente entregue su presupuesto, se cambian los números de
   `costo` aquí y ya: nada más en el proyecto depende de estos valores. Si
   entrega importes por disciplina en vez de unitarios, usar IMPORTE_DIRECTO
   al final del archivo, que tiene prioridad sobre el cálculo por elemento.

   CÓMO SE CALCULA
   Para cada elemento del modelo se busca su categoría aquí, se lee del
   modelo la cantidad en la unidad correspondiente y se multiplica:

       importe = cantidad × costo

   Si la categoría no está en la tabla, el elemento no pondera (y se
   reporta, para que se note y se pueda añadir).
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* Propiedades de donde sale la cantidad, por unidad. Los modelos están en
     español, pero se aceptan los dos idiomas por si se republica en inglés. */
  /* Algunas categorías no publican la cantidad ya calculada aunque el .rvt
     sí la tenga: las zapatas traen Anchura, Longitud y Grosor, pero NO
     Volumen. Para esos casos la fila lleva `producto`, y la cantidad sale
     de multiplicar esas propiedades entre sí.

     OJO CON LA PRECISIÓN. El producto supone un prisma recto. Contrastado
     contra el volumen real que reporta Revit para las 99 zapatas del CDC:
     sale exacto en 6 de los 8 tipos (Z1 73.75, Z5 52.05, Z6 29.40, Z7 1.48,
     Z4 10.98, ZC2 36.94) y sobreestima en Z2 y Z3, que llevan escalones o
     chaflán. En total 330.33 m³ derivados contra 317.81 reales: +3.9 %.

     Para PONDERAR eso es aceptable —y muchísimo mejor que la alternativa,
     que era dejar fuera las 99 zapatas por completo, como pasaba antes—.
     Para presupuestar no: ahí hay que sacar los volúmenes del modelo. */
  const PROP_CANTIDAD = {
    m2:  ['Área', 'Area'],
    m:   ['Longitud de corte', 'Longitud', 'Length'],
    m3:  ['Volumen', 'Volume'],
    pza: null                     // el conteo del propio elemento
  };

  /* ── Tabla ────────────────────────────────────────────────────────────
     `cat` admite los nombres en los dos idiomas tal como los expone el
     modelo traducido. `nota` es lo que se supuso al poner el precio: sirve
     para discutirlo con quien sí conozca el presupuesto. */
  const COSTOS = [
    /* ── Arquitectura ─────────────────────────────────────────────── */
    { cat: ['Muros', 'Walls'],                    u: 'm2',  costo: 1150, nota: 'Block 15 cm, aplanado y pintura en ambas caras' },
    { cat: ['Suelos', 'Floors'],                  u: 'm2',  costo:  950, nota: 'Firme, impermeabilización y acabado cerámico' },
    { cat: ['Techos', 'Ceilings'],                u: 'm2',  costo:  620, nota: 'Plafón reticular con suspensión' },
    { cat: ['Cubiertas', 'Roofs'],                u: 'm2',  costo: 1400, nota: 'Losa con impermeabilización y pendientes' },
    { cat: ['Puertas', 'Doors'],                  u: 'pza', costo: 9500, nota: 'Puerta abatible con marco y herrajes' },
    { cat: ['Ventanas', 'Windows'],               u: 'pza', costo: 14000, nota: 'Cantería de aluminio con cristal templado' },
    { cat: ['Muros cortina', 'Curtain Wall Panels'], u: 'm2', costo: 3800, nota: 'Panel de fachada con perfilería' },
    { cat: ['Barandales', 'Railings'],            u: 'm',   costo: 2600, nota: 'Barandal metálico con pasamanos' },
    { cat: ['Escaleras', 'Stairs'],               u: 'pza', costo: 85000, nota: 'Tramo de escalera con acabados' },
    { cat: ['Mobiliario', 'Furniture'],           u: 'pza', costo: 6500, nota: 'Mobiliario fijo promedio' },

    /* ── Eléctrico ────────────────────────────────────────────────── */
    { cat: ['Luminarias', 'Lighting Fixtures'],   u: 'pza', costo: 2400, nota: 'Luminaria LED empotrada, instalada' },
    { cat: ['Dispositivos de iluminación', 'Lighting Devices'], u: 'pza', costo: 520, nota: 'Apagador con placa y cableado' },
    { cat: ['Aparatos eléctricos', 'Electrical Fixtures'], u: 'pza', costo: 620, nota: 'Contacto o salida especial' },
    { cat: ['Equipos eléctricos', 'Electrical Equipment'], u: 'pza', costo: 38000, nota: 'Tablero o centro de carga' },
    { cat: ['Tubo IMC', 'Conduits', 'Conduit'],   u: 'm',   costo:  310, nota: 'Canalización conduit con soportería' },
    { cat: ['Bandeja de cables', 'Cable Trays'],  u: 'm',   costo: 1050, nota: 'Charola portacables con soportes' },
    { cat: ['Dispositivos de datos', 'Data Devices'], u: 'pza', costo: 900, nota: 'Salida de voz y datos' },
    { cat: ['Dispositivos de comunicación', 'Communication Devices'], u: 'pza', costo: 1200, nota: 'Dispositivo de comunicación' },

    /* ── Hidráulico · Sanitario · Pluvial · Gas ───────────────────── */
    { cat: ['Tuberías', 'Pipes', 'Pipe Curves'],  u: 'm',   costo:  560, nota: 'Promedio de diámetros con soportería y pruebas' },
    { cat: ['Accesorios de tubería', 'Pipe Fittings'], u: 'pza', costo: 280, nota: 'Codo, tee o reducción' },
    { cat: ['Accesorios de tubería especializados', 'Pipe Accessories'], u: 'pza', costo: 1900, nota: 'Válvula o accesorio de control' },
    { cat: ['Aparatos sanitarios', 'Plumbing Fixtures'], u: 'pza', costo: 7200, nota: 'Mueble de baño instalado' },
    { cat: ['Equipos de fontanería', 'Plumbing Equipment'], u: 'pza', costo: 42000, nota: 'Equipo de bombeo o calentamiento' },

    /* ── HVAC ─────────────────────────────────────────────────────── */
    { cat: ['Conductos', 'Ducts', 'Duct Curves'], u: 'm2',  costo: 1950, nota: 'Ducto de lámina galvanizada con aislamiento' },
    { cat: ['Accesorios de conducto', 'Duct Fittings'], u: 'pza', costo: 1400, nota: 'Codo, transición o derivación' },
    { cat: ['Terminales de aire', 'Air Terminals'], u: 'pza', costo: 2800, nota: 'Difusor o rejilla con regulador' },
    { cat: ['Equipos mecánicos', 'Mechanical Equipment'], u: 'pza', costo: 52000, nota: 'Unidad de clima o manejadora' },

    /* ── Contra incendio ──────────────────────────────────────────── */
    { cat: ['Rociadores', 'Sprinklers'],          u: 'pza', costo: 2100, nota: 'Rociador con ramal y pruebas' },
    { cat: ['Dispositivos de alarma de incendios', 'Fire Alarm Devices'], u: 'pza', costo: 2600, nota: 'Detector o estación manual' },
    { cat: ['Protección contra incendios', 'Fire Protection'], u: 'pza', costo: 8500, nota: 'Gabinete o extintor con accesorios' },

    /* ── Estructura ───────────────────────────────────────────────────
       Se deja por coherencia, pero el avance estructural ya se pondera con
       su propia tabla (PARTIDA_META en app.js), que es más fina porque
       distingue concreto de acero. Si ambas coexisten, manda aquélla. */
    { cat: ['Cimentación estructural', 'Structural Foundations'], u: 'm3', costo: 4500,
      producto: ['Anchura', 'Longitud', 'Grosor de cimentación'],
      nota: 'Concreto armado en cimentación · el visor no publica Volumen, se deriva de las dimensiones' },
    { cat: ['Armazón estructural', 'Structural Framing'], u: 'm',  costo: 1250, nota: 'Perfil metálico montado, promedio' },
    { cat: ['Pilares estructurales', 'Structural Columns'], u: 'm', costo: 1600, nota: 'Columna metálica montada' },
    { cat: ['Placas', 'Plates'],                  u: 'pza', costo: 1800, nota: 'Placa base con anclas' },

    /* ── Terreno ──────────────────────────────────────────────────────
       Topografía es levantamiento, no obra ejecutable: pondera 0 para que
       no infle el avance general. Si algún día lleva obra exterior con
       fechas, se le pone precio. */
    { cat: ['Superficie topográfica', 'Toposolid', 'Topography'], u: 'm2', costo: 0, nota: 'Levantamiento, no obra ejecutable' },
    { cat: ['Emplazamiento', 'Site'],             u: 'm2',  costo: 0, nota: 'Referencia de terreno' }
  ];

  /* Si el cliente entrega importes POR DISCIPLINA, se ponen aquí y tienen
     prioridad: el cálculo por elemento se ignora para esa disciplina. La
     clave es el nombre del modelo tal como lo publica aps-federado.
     Ejemplo:  'Arquitectura': 18500000 */
  const IMPORTE_DIRECTO = {};

  /* ── Índice de consulta ──────────────────────────────────────────── */
  const porCategoria = new Map();
  for (const fila of COSTOS) {
    for (const nombre of fila.cat) {
      porCategoria.set(nombre.toLowerCase(), fila);
    }
  }

  const sinPrecio   = new Map();   // categoría sin precio en la tabla → veces
  const sinCantidad = new Map();   // categoría con precio pero sin cantidad → veces

  const numero = crudo => {
    if (crudo == null || crudo === '') return NaN;
    // El visor entrega "12.34 m²"; interesa sólo el número.
    return parseFloat(String(crudo).replace(/[^\d.,-]/g, '').replace(',', '.'));
  };

  /* Primero la cantidad publicada; si no está, el producto de dimensiones. */
  function cantidadDe(fila, p) {
    for (const a of (PROP_CANTIDAD[fila.u] || [])) {
      const n = numero(p[a]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (fila.producto) {
      let q = 1;
      for (const a of fila.producto) {
        const n = numero(p[a]);
        if (!Number.isFinite(n) || n <= 0) return 0;   // falta un factor
        q *= n;
      }
      return q;
    }
    return 0;
  }

  /* Importe de un elemento. `p` es el mapa displayName → valor ya leído.
     Devuelve 0 si la categoría no está en la tabla, y lo anota para que se
     pueda revisar después con costos.sinPrecio(). */
  function importeDe(categoria, p) {
    const cat = String(categoria || '').replace('Revit ', '').trim();
    const fila = porCategoria.get(cat.toLowerCase());
    if (!fila) {
      if (cat) sinPrecio.set(cat, (sinPrecio.get(cat) || 0) + 1);
      return 0;
    }
    if (fila.u === 'pza') return fila.costo;

    const cant = cantidadDe(fila, p);
    if (cant > 0) return cant * fila.costo;

    /* La categoría SÍ tiene precio, pero no se pudo leer su cantidad. Antes
       esto devolvía 0 sin decir nada y el elemento desaparecía del avance:
       así se perdieron las 99 zapatas, que no publican Volumen. Ahora se
       anota para que salga en consola y en la nota de método. */
    sinCantidad.set(cat, (sinCantidad.get(cat) || 0) + 1);
    return 0;
  }

  /* Propiedades que hay que pedirle al modelo para poder costear. */
  const PROPS_CANTIDAD = [...new Set(
    Object.values(PROP_CANTIDAD).filter(Boolean).flat()
      .concat(COSTOS.flatMap(f => f.producto || []))
  )];

  window.costos = {
    tabla: COSTOS,
    importeDirecto: IMPORTE_DIRECTO,
    propsCantidad: PROPS_CANTIDAD,
    importeDe,
    sinPrecio:   () => [...sinPrecio.entries()].sort((a, b) => b[1] - a[1]),
    sinCantidad: () => [...sinCantidad.entries()].sort((a, b) => b[1] - a[1])
  };
})();
