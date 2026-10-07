/* ─────────────────────────────────────────────────────────────────────────
   Extracción de un modelo · GET /api/extraccion?item=<linaje>

   Lo que hacía el sohersa-extractor, pero con los parámetros que consume el
   dashboard y corriendo en el servidor de Vercel. Para un modelo de CDC:

     1. versión vigente en Forma (/tip): número, autor, fecha
     2. ¿Autodesk ya lo tradujo? (manifiesto). Si no, se dice cuánto lleva.
     3. árbol de objetos → categoría de cada elemento
     4. propiedades de todos los elementos → sólo las que usa el dashboard

   No hay estado entre llamadas: si Autodesk todavía está procesando, la
   respuesta lo dice (`estado`) y la página vuelve a preguntar. Así una
   versión recién publicada se ve pasar por «traduciendo» e «indexando»
   antes de llegar a «listo».
   ───────────────────────────────────────────────────────────────────────── */
import { aps, versionVigente, derivativeBase, json, falla } from './_aps.mjs';
import { buscaModelo, proyecto } from './_modelos.mjs';

/* Lo que se extrae. Los nombres son los que publica Model Derivative, que
   no siempre coinciden con los del visor (que los muestra en el idioma del
   .rvt): por eso cada columna admite varios. `grupo` restringe dónde se
   busca cuando el mismo nombre aparece en varios grupos. */
const COLUMNAS = [
  { clave: 'fechaPlaneacion', nombres: ['fechaPlaneacion'] },
  { clave: 'fechaEjecucion',  nombres: ['fechaEjecucion'] },
  { clave: 'tipo',            nombres: ['Type Name', 'Nombre de tipo'] },
  { clave: 'marca',           nombres: ['Mark', 'Marca', 'Type Mark', 'Marca de tipo'], grupo: /identity|identidad/i },
  { clave: 'comentarios',     nombres: ['Comments', 'Comentarios'] },
  { clave: 'area_m2',         nombres: ['Area', 'Área'],               numero: true, grupo: /dimension|cota/i },
  { clave: 'longitud_m',      nombres: ['Length', 'Longitud', 'Cut Length', 'Longitud de corte'], numero: true, grupo: /dimension|cota/i },
  { clave: 'volumen_m3',      nombres: ['Volume', 'Volumen'],          numero: true, grupo: /dimension|cota/i }
];
export const CAMPOS = ['id', 'categoria', 'familia', ...COLUMNAS.map(c => c.clave)];

const LOTE = 800;   // objetos por consulta cuando las propiedades no caben en una

function numero(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function lee(props, col) {
  for (const [grupo, valores] of Object.entries(props || {})) {
    if (!valores || typeof valores !== 'object') continue;
    if (col.grupo && !col.grupo.test(grupo)) continue;
    for (const n of col.nombres) {
      let v = valores[n];
      if (Array.isArray(v)) v = v.find(Boolean);
      if (v === undefined || v === null || v === '') continue;
      return col.numero ? numero(v) : String(v).trim();
    }
  }
  return null;
}

/* Hojas del árbol = instancias. La categoría es el ancestro de primer nivel
   (Walls, Pipes…), la familia el de segundo. */
function indexaArbol(arbol) {
  const raiz = arbol?.data?.objects?.[0];
  const hojas = new Map();
  if (!raiz) return hojas;
  const baja = (nodo, categoria, familia, nivel) => {
    const hijos = nodo.objects || [];
    if (!hijos.length) { if (nivel > 1) hojas.set(nodo.objectid, { categoria, familia }); return; }
    for (const h of hijos) {
      baja(h, nivel === 0 ? h.name : categoria, nivel === 1 ? h.name : familia, nivel + 1);
    }
  };
  baja(raiz, null, null, 0);
  return hojas;
}

/* La vista que se extrae es la misma que abre el visor: la maestra, o la de
   la fase por defecto. */
function vistaMaestra(lista) {
  const vistas = (lista || []).filter(m => m.role === '3d');
  return vistas.find(m => m.isMasterView) ||
         vistas.find(m => /^(nueva construcci[oó]n|new construction)$/i.test(String(m.name).trim())) ||
         vistas[0] || null;
}

async function propiedades(base, guid, ids) {
  const todo = await aps(base + '/metadata/' + guid + '/properties');
  if (todo.status !== 413) return todo;

  /* Más de 20 MB: Autodesk pide trocearlo. Se consulta por lotes de ids. */
  const coleccion = [];
  let bytes = 0;
  for (let i = 0; i < ids.length; i += LOTE) {
    const r = await aps(base + '/metadata/' + guid + '/properties:query', {
      method: 'POST',
      body: { query: { $in: ['objectid', ...ids.slice(i, i + LOTE)] }, pagination: { offset: 0, limit: LOTE } }
    });
    if (r.status !== 200) return r;
    bytes += r.bytes;
    coleccion.push(...(r.datos?.data?.collection || []));
  }
  return { status: 200, bytes, datos: { data: { collection: coleccion } } };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const modelo = buscaModelo(url.searchParams.get('item'));
  const projectId = proyecto();
  if (!modelo)    return json(res, 400, { error: 'extraccion', message: 'Modelo desconocido.' });
  if (!projectId) return json(res, 200, { unconfigured: true, missing: ['ACC_PROJECT_ID'] });

  const t0 = Date.now();
  try {
    const v = await versionVigente(projectId, modelo.item);
    const cabecera = { modelo: modelo.name, item: modelo.item, ...v };
    const base = derivativeBase() + '/' + v.urn;
    const espera = (estado, extra) => json(res, 200, { ...cabecera, estado, ...extra });

    const manifiesto = await aps(base + '/manifest');
    if (manifiesto.status === 404) return espera('traduciendo', { progreso: '0%' });
    const m = manifiesto.datos || {};
    if (m.status === 'failed') return espera('error', { message: 'Autodesk no pudo traducir esta versión.' });
    if (m.status !== 'success') return espera('traduciendo', { progreso: m.progress || '' });

    const meta = await aps(base + '/metadata');
    if (meta.status === 202) return espera('indexando');
    const vista = vistaMaestra(meta.datos?.data?.metadata);
    if (!vista) return espera('error', { message: 'El modelo no tiene vista 3D.' });

    const arbol = await aps(base + '/metadata/' + vista.guid);
    if (arbol.status === 202) return espera('indexando');
    const hojas = indexaArbol(arbol.datos);

    const props = await propiedades(base, vista.guid, [...hojas.keys()]);
    if (props.status === 202) return espera('indexando');
    if (props.status !== 200) throw new Error('Propiedades: HTTP ' + props.status);

    const filas = [];
    const llenos = {};
    for (const o of props.datos?.data?.collection || []) {
      const h = hojas.get(o.objectid);
      if (!h) continue;
      const fila = [o.objectid, h.categoria, h.familia];
      for (const c of COLUMNAS) {
        const valor = lee(o.properties, c);
        fila.push(valor);
        if (valor !== null) llenos[c.clave] = (llenos[c.clave] || 0) + 1;
      }
      filas.push(fila);
    }

    return json(res, 200, {
      ...cabecera,
      estado: 'listo',
      vista: vista.name,
      campos: CAMPOS,
      filas,
      llenos,
      bytesAutodesk: arbol.bytes + props.bytes,
      ms: Date.now() - t0
    });
  } catch (err) {
    return falla(res, err, 'extraccion');
  }
}
