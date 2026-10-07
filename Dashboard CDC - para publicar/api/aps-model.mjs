/* ─────────────────────────────────────────────────────────────────────────
   Resuelve el URN vigente de un modelo de ACC Docs.

     /api/aps-model                  → modelo principal (el estructural)
     /api/aps-model?model=federado   → modelo federado, si está configurado

   Se pide /tip en lugar de fijar una versión: subir una revisión a ACC se
   refleja solo, sin tocar configuración.

   Alternativa sin ACC: si existe APS_MODEL_URN se devuelve tal cual. Con esa
   opción el dashboard NO sigue las revisiones nuevas.

   Era /.netlify/functions/aps-model; ahora /api/aps-model.
   ───────────────────────────────────────────────────────────────────────── */
import { resuelveItem, vistaPrincipal, region, faltantes, sinConfigurar, json, falla } from './_aps.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const cual = (url.searchParams.get('model') || 'principal').toLowerCase();
  const esFederado = cual === 'federado';

  // Qué variables mira cada visor. El federado cae al proyecto del principal
  // si no tiene uno propio.
  const varProyecto = esFederado && process.env.ACC_PROJECT_ID_FEDERADO
    ? 'ACC_PROJECT_ID_FEDERADO' : 'ACC_PROJECT_ID';
  const varItem = esFederado ? 'ACC_ITEM_ID_FEDERADO' : 'ACC_ITEM_ID';

  try {
    // Escape para montajes sin ACC: URN fija en base64url.
    if (!esFederado && process.env.APS_MODEL_URN) {
      const urn = process.env.APS_MODEL_URN;
      const vista = await vistaPrincipal(urn);
      return json(res, 200, {
        urn, model: cual, region: region(),
        guid: vista ? vista.guid : null,
        vista: vista ? vista.vista : null,
        name: null, versionNumber: null
      });
    }

    const missing = faltantes([varProyecto, varItem]);
    if (missing.length) return sinConfigurar(res, cual, missing);

    const info = await resuelveItem(process.env[varProyecto], process.env[varItem]);
    return json(res, 200, { ...info, model: cual, region: region() });
  } catch (err) {
    return falla(res, err, 'aps-model');
  }
}
