/* ─────────────────────────────────────────────────────────────────────────
   Cola de eventos del webhook de Forma.

   Las funciones de Vercel no comparten memoria: la que recibe el webhook y
   la que consulta la página son instancias distintas. Para que el aviso
   llegue a la página hace falta un almacén. Se usa Redis de Upstash por su
   API REST (un fetch, sin dependencias), que Vercel conecta desde
   Storage → Upstash → Redis y deja estas variables:

     KV_REST_API_URL   + KV_REST_API_TOKEN        (integración de Vercel)
     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN   (alta directa)

   Sin ellas no se rompe nada: /api/eventos cae en modo «sondeo» y detecta
   las versiones nuevas preguntándole a Forma por la versión vigente.
   ───────────────────────────────────────────────────────────────────────── */

const CLAVE = 'cdc:eventos-forma';
const MAXIMO = 50;

function conexion() {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export const hayCola = () => !!conexion();

async function redis(...comando) {
  const c = conexion();
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando)
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok || cuerpo.error) throw new Error('Redis: ' + (cuerpo.error || 'HTTP ' + r.status));
  return cuerpo.result;
}

export async function encola(evento) {
  await redis('LPUSH', CLAVE, JSON.stringify(evento));
  await redis('LTRIM', CLAVE, 0, MAXIMO - 1);
}

/* Los más recientes primero. */
export async function eventos(desde = 0) {
  const crudos = (await redis('LRANGE', CLAVE, 0, MAXIMO - 1)) || [];
  return crudos.map(s => { try { return JSON.parse(s); } catch { return null; } })
               .filter(e => e && e.recibido > desde);
}
