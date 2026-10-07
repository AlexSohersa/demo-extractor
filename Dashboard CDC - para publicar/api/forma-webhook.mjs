/* ─────────────────────────────────────────────────────────────────────────
   Receptor del webhook de Autodesk Forma · POST /api/forma-webhook

   Autodesk llama aquí con el evento dm.version.added cada vez que se publica
   una versión nueva de un archivo en las carpetas suscritas (el alta está en
   scripts/registrar-webhook.mjs). Si el archivo es uno de los diez modelos
   de CDC, el evento se guarda en la cola y la pestaña «Extracción» lo
   recoge desde /api/eventos.

   Siempre se contesta 200 rápido: Autodesk reintenta lo que no se confirma,
   y un archivo ajeno a CDC no es un error, sólo se ignora.

   Si existe WEBHOOK_KEY, la URL registrada debe llevar ?k=<WEBHOOK_KEY>.
   ───────────────────────────────────────────────────────────────────────── */
import { json } from './_aps.mjs';
import { buscaModelo } from './_modelos.mjs';
import { hayCola, encola } from './_cola.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 200, { escuchando: true, cola: hayCola() });
  }

  const clave = process.env.WEBHOOK_KEY;
  if (clave && new URL(req.url, 'http://localhost').searchParams.get('k') !== clave) {
    return json(res, 401, { error: 'forma-webhook', message: 'Clave incorrecta.' });
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = {}; } }
  const p = cuerpo?.payload || {};
  const modelo = buscaModelo(p.lineageUrn);

  if (!modelo) return json(res, 200, { ignorado: true, archivo: p.name || null });

  const evento = {
    id: cuerpo?.hook?.hookId + ':' + (p.source || Date.now()),
    recibido: Date.now(),
    tipo: cuerpo?.hook?.event || 'dm.version.added',
    modelo: modelo.name,
    item: modelo.item,
    archivo: p.name || null,
    version: p.version != null ? Number(p.version) : null,
    fecha: p.modifiedTime || p.createdTime || null
  };
  console.info('[forma-webhook]', evento.modelo, 'v' + evento.version);

  if (hayCola()) {
    try { await encola(evento); }
    catch (err) { console.error('[forma-webhook] no se pudo encolar:', err.message); }
  }
  return json(res, 200, { recibido: true, modelo: evento.modelo, version: evento.version });
}
