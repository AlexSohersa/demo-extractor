/* ─────────────────────────────────────────────────────────────────────────
   Eventos para la pestaña «Extracción» · GET /api/eventos

   ?desde=<ms>     eventos del webhook recibidos después de ese instante
   ?versiones=1    además, la versión vigente de cada uno de los diez modelos

   Con cola (Redis) el modo es «webhook»: se devuelve lo que llegó de Forma.
   Sin cola el modo es «sondeo»: siempre se devuelven las versiones y la
   página detecta por diferencia cuál cambió. El resultado en pantalla es el
   mismo; sólo cambia quién se entera primero.
   ───────────────────────────────────────────────────────────────────────── */
import { versionVigente, json, falla } from './_aps.mjs';
import { lista, proyecto } from './_modelos.mjs';
import { hayCola, eventos } from './_cola.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const desde = Number(url.searchParams.get('desde')) || 0;
  const conCola = hayCola();
  const projectId = proyecto();
  if (!projectId) return json(res, 200, { unconfigured: true, missing: ['ACC_PROJECT_ID'] });

  try {
    const cuerpo = { modo: conCola ? 'webhook' : 'sondeo', ahora: Date.now() };
    if (conCola) cuerpo.eventos = await eventos(desde);

    if (!conCola || url.searchParams.get('versiones')) {
      const modelos = lista();
      const r = await Promise.allSettled(modelos.map(m => versionVigente(projectId, m.item)));
      cuerpo.versiones = modelos.map((m, i) => ({
        modelo: m.name,
        item: m.item,
        ...(r[i].status === 'fulfilled' ? r[i].value : { error: r[i].reason?.message })
      }));
    }
    return json(res, 200, cuerpo);
  } catch (err) {
    return falla(res, err, 'eventos');
  }
}
