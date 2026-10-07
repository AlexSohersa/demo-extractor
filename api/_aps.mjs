/* ─────────────────────────────────────────────────────────────────────────
   Utilidades compartidas de Autodesk Platform Services.

   Vercel NO enruta los archivos de `api/` que empiezan por guion bajo, pero
   sí los incluye en el bundle. Por eso el código común vive aquí y no en una
   carpeta de la raíz: cualquier cosa fuera de `api/` se sirve como estático.

   Portado desde las Netlify Functions del sitio anterior, que se perdieron
   con el repositorio. Los contratos de respuesta se reconstruyeron a partir
   de lo que consume assets/viewer.js y de las respuestas reales capturadas
   del sitio publicado antes de darlo de baja.
   ───────────────────────────────────────────────────────────────────────── */

const AUTH = 'https://developer.api.autodesk.com/authentication/v2/token';
const DM   = 'https://developer.api.autodesk.com/data/v1';

export function region() {
  return String(process.env.APS_REGION || 'US').toUpperCase() === 'EMEA' ? 'EMEA' : 'US';
}

/* Model Derivative tiene host propio por región; Data Management y el
   endpoint de autenticación son globales. */
export function derivativeBase() {
  return region() === 'EMEA'
    ? 'https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata'
    : 'https://developer.api.autodesk.com/modelderivative/v2/designdata';
}

/* Falta de configuración: no es un error, es una respuesta que el visor sabe
   interpretar (pinta «Pendiente de configurar» en vez de un fallo rojo).
   Ver el bloque `model.unconfigured` en assets/viewer.js. */
export function faltantes(nombres) {
  return nombres.filter(n => !process.env[n]);
}

export function sinConfigurar(res, modelo, missing) {
  return json(res, 200, {
    unconfigured: true,
    model: modelo,
    missing,
    message: 'Este visor todavía no tiene un modelo asignado.'
  });
}

export function json(res, code, cuerpo) {
  res.status(code);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // El token dura una hora; el resto se revalida en cada carga de página.
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(cuerpo));
}

/* ── Token 2-legged ─────────────────────────────────────────────────────
   Se guarda en memoria del módulo: entre invocaciones en caliente evita
   pedir un token nuevo cada vez. En frío simplemente vuelve a pedirlo. */
let cache = { token: null, expira: 0 };

export async function token() {
  const ahora = Date.now();
  if (cache.token && ahora < cache.expira - 60_000) return cache.token;

  const id     = process.env.APS_CLIENT_ID;
  const secret = process.env.APS_CLIENT_SECRET;
  if (!id || !secret) {
    const e = new Error('Faltan APS_CLIENT_ID o APS_CLIENT_SECRET');
    e.code = 'sin-credenciales';
    throw e;
  }

  const r = await fetch(AUTH, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'data:read viewables:read'
    })
  });

  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error('Autenticación de APS: HTTP ' + r.status + '. ' +
                        (cuerpo.errorDescription || cuerpo.error || ''));
    e.code = 'auth';
    throw e;
  }

  cache = { token: cuerpo.access_token, expira: ahora + cuerpo.expires_in * 1000 };
  return cache.token;
}

/* ── Llamadas autenticadas ──────────────────────────────────────────── */
async function pide(url) {
  const t = await token();
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) {
    const texto = await r.text().catch(() => '');
    const e = new Error('HTTP ' + r.status + ' en ' + url.replace(/^https:\/\/[^/]+/, '') +
                        '. ' + texto.slice(0, 300));
    e.status = r.status;
    // 403 casi siempre es el mismo olvido, así que vale la pena decirlo.
    if (r.status === 403) {
      e.pista = 'Un token 2-legged no ve los datos de ACC hasta que el Client ID ' +
                'se da de alta en ACC Account Admin → Settings → Custom Integrations ' +
                'y se le asigna el proyecto.';
    }
    throw e;
  }
  return r.json();
}

/* Igual que pide(), pero devuelve el estado aunque no sea 200. Model
   Derivative contesta 202 mientras prepara un recurso y 413 cuando las
   propiedades no caben en una sola respuesta: ninguno de los dos es un error
   para quien llama, son estados que hay que mostrar o sortear. */
export async function aps(url, { method = 'GET', body } = {}) {
  const t = await token();
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + t,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* cuerpo vacío o no JSON */ }
  return { status: r.status, datos, bytes: texto.length };
}

export function base64url(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── Vista 3D a abrir ───────────────────────────────────────────────────
   getDefaultGeometry() del visor devuelve la PRIMERA vista 3D, y en varios
   de estos modelos ésa es una vista de coordinación sin geometría propia:
   el árbol sale completo y el visor, vacío. Así que el servidor manda el
   guid de la vista principal y el cliente lo busca con findByGuid.

   Criterio: entre las vistas 3D con geometría, se prefiere la que lleva el
   nombre de la fase por defecto de Revit («Nueva construcción» en los
   modelos en español, «New Construction» en los que se hicieron en inglés).
   Si no aparece ninguna, la primera con geometría. */
const VISTA_POR_DEFECTO = /^(nueva construcci[oó]n|new construction)$/i;

export async function vistaPrincipal(urn) {
  let manifiesto;
  try {
    manifiesto = await pide(derivativeBase() + '/' + urn + '/manifest');
  } catch {
    return null;               // sin manifiesto, que el cliente use la vista por defecto
  }

  const vistas = [];
  const recorre = nodo => {
    if (!nodo) return;
    if (nodo.type === 'geometry' && nodo.role === '3d' && nodo.guid) vistas.push(nodo);
    (nodo.derivatives || nodo.children || []).forEach(recorre);
  };
  (manifiesto.derivatives || []).forEach(recorre);
  if (!vistas.length) return null;

  const preferida = vistas.find(v => VISTA_POR_DEFECTO.test(String(v.name || '').trim()));
  const elegida = preferida || vistas[0];
  return { guid: elegida.guid, vista: elegida.name || null };
}

/* ── Resolver un item de ACC a la URN de su versión vigente ─────────────
   Se pide /tip en vez de fijar una versión: así subir una revisión a ACC se
   refleja en el dashboard sin tocar configuración. */
export async function resuelveItem(projectId, itemId) {
  const url = DM + '/projects/' + encodeURIComponent(projectId) +
              '/items/' + encodeURIComponent(itemId) + '/tip';
  const tip = await pide(url);

  const datos   = tip.data || {};
  const attrs   = datos.attributes || {};
  const versUrn = datos.id;                        // urn:adsk.wipprod:fs.file:vf.XXX?version=N
  if (!versUrn) throw new Error('La respuesta de /tip no trae el id de la versión.');

  const urn = base64url(versUrn);
  const vista = await vistaPrincipal(urn);

  return {
    urn,
    name: attrs.displayName || attrs.name || null,
    versionNumber: attrs.versionNumber ?? null,
    guid: vista ? vista.guid : null,
    vista: vista ? vista.vista : null
  };
}

/* La versión vigente con sus datos de autoría, sin resolver la vista: lo que
   necesitan la extracción y el detector de versiones nuevas. */
export async function versionVigente(projectId, itemId) {
  const url = DM + '/projects/' + encodeURIComponent(projectId) +
              '/items/' + encodeURIComponent(itemId) + '/tip';
  const datos = (await pide(url)).data || {};
  const a = datos.attributes || {};
  if (!datos.id) throw new Error('La respuesta de /tip no trae el id de la versión.');
  return {
    versionUrn: datos.id,
    urn: base64url(datos.id),
    archivo: a.displayName || a.name || null,
    version: a.versionNumber ?? null,
    usuario: a.lastModifiedUserName || a.createUserName || null,
    fecha: a.lastModifiedTime || a.createTime || null,
    bytes: a.storageSize ?? null
  };
}

/* Traduce un fallo a la forma que espera el visor, sin filtrar secretos. */
export function falla(res, err, contexto) {
  if (err.code === 'sin-credenciales') {
    return json(res, 200, {
      unconfigured: true,
      missing: ['APS_CLIENT_ID', 'APS_CLIENT_SECRET'],
      message: 'Faltan las credenciales de APS en las variables de entorno.'
    });
  }
  console.error('[' + contexto + ']', err.message, err.pista || '');
  return json(res, err.status && err.status < 500 ? err.status : 502, {
    error: contexto,
    message: err.message,
    ...(err.pista ? { hint: err.pista } : {})
  });
}
