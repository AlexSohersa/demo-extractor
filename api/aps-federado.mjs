/* ─────────────────────────────────────────────────────────────────────────
   Lista de modelos del visor federado.

   La PERTENENCIA al conjunto es manual (POR_DEFECTO en _modelos.mjs, o
   ACC_FEDERADO_ITEMS); las VERSIONES no: cada modelo se resuelve por /tip,
   así que subir una revisión a ACC se refleja solo.

   La lista se recuperó de la respuesta en vivo del sitio anterior antes de
   perder el acceso a Netlify: vivía únicamente dentro de la función, no en
   ningún archivo estático. Ver rescate-functions/modelos-federados.mjs.

   Era /.netlify/functions/aps-federado; ahora /api/aps-federado.
   ───────────────────────────────────────────────────────────────────────── */
import { resuelveItem, region, json, falla } from './_aps.mjs';
import { lista } from './_modelos.mjs';

export default async function handler(req, res) {
  const projectId = process.env.ACC_PROJECT_ID_FEDERADO || process.env.ACC_PROJECT_ID;
  if (!projectId) {
    return json(res, 200, {
      unconfigured: true, model: 'federado',
      missing: ['ACC_PROJECT_ID'],
      message: 'Este visor todavía no tiene un modelo asignado.'
    });
  }

  try {
    // Una sola lectura de la lista: llamar a lista() dentro del bucle volvería
    // a parsear la variable de entorno en cada vuelta.
    const modelos = lista();

    // En paralelo: son diez llamadas a /tip más su manifiesto. Un modelo que
    // falle no debe tumbar el conjunto, así que cada uno se resuelve aparte
    // y los que no respondan simplemente no se cargan.
    const resultados = await Promise.allSettled(
      modelos.map(m => resuelveItem(projectId, m.item).then(info => ({ ...info, name: m.name || info.name })))
    );

    const models = [];
    const fallidos = [];
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.urn) models.push(r.value);
      else fallidos.push((modelos[i].name || modelos[i].item) + ': ' + (r.reason?.message || 'sin URN'));
    });

    if (fallidos.length) console.warn('[aps-federado] no resolvieron →', fallidos.join(' · '));
    if (!models.length && fallidos.length) {
      return json(res, 502, { error: 'aps-federado', message: fallidos.join(' · ') });
    }

    return json(res, 200, { models, region: region(), total: models.length });
  } catch (err) {
    return falla(res, err, 'aps-federado');
  }
}
