/* ─────────────────────────────────────────────────────────────────────────
   Token 2-legged de APS para el visor.

   El CLIENT_SECRET nunca sale del servidor: el navegador sólo recibe el
   access_token y su caducidad, que es lo que pide getAccessToken() del
   Initializer del SDK (ver ensureInit en assets/viewer.js).

   Era /.netlify/functions/aps-token; ahora /api/aps-token.
   ───────────────────────────────────────────────────────────────────────── */
import { token, json } from './_aps.mjs';

export default async function handler(req, res) {
  try {
    const t = await token();
    // expires_in fijo a la hora que da APS: el token cacheado puede llevar
    // rato vivo, así que se recorta un margen para que el SDK lo renueve
    // antes de que caduque de verdad.
    return json(res, 200, { access_token: t, expires_in: 1800, token_type: 'Bearer' });
  } catch (err) {
    if (err.code === 'sin-credenciales') {
      console.error('[aps-token] faltan APS_CLIENT_ID / APS_CLIENT_SECRET');
      return json(res, 500, {
        error: 'sin-credenciales',
        message: 'Faltan APS_CLIENT_ID o APS_CLIENT_SECRET en las variables de entorno.'
      });
    }
    console.error('[aps-token]', err.message);
    return json(res, 502, { error: 'auth', message: err.message });
  }
}
