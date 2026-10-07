/* ─────────────────────────────────────────────────────────────────────────
   Los diez modelos de CDC: una sola lista para el visor federado, el
   webhook de Forma y la extracción. Antes vivía dentro de aps-federado.mjs.
   ───────────────────────────────────────────────────────────────────────── */

export const POR_DEFECTO = [
  { name: 'Estructura',      item: 'urn:adsk.wipprod:dm.lineage:GobJK6QRRlSV9434I_T7NQ' },
  { name: 'Topografía',      item: 'urn:adsk.wipprod:dm.lineage:MdRxG1HMQIioGac2JBg8_g' },
  { name: 'Eléctrico',       item: 'urn:adsk.wipprod:dm.lineage:faafjH2XQAyJtOJtSPyYBQ' },
  { name: 'Hidráulico',      item: 'urn:adsk.wipprod:dm.lineage:4j72sdBNSam60j16X3yP0A' },
  { name: 'Sanitario',       item: 'urn:adsk.wipprod:dm.lineage:O7oQDpCKScumr3jK1WRsLQ' },
  { name: 'Pluvial',         item: 'urn:adsk.wipprod:dm.lineage:_xkpoyG0SCqqWSkw90l3wg' },
  { name: 'HVAC',            item: 'urn:adsk.wipprod:dm.lineage:RwaXnqkZTkSQo9-zW23m2g' },
  { name: 'Gas',             item: 'urn:adsk.wipprod:dm.lineage:98txx5mXSde2uKjnHIgXcw' },
  { name: 'Contra incendio', item: 'urn:adsk.wipprod:dm.lineage:fEDVn1K9QceDG3htaVmgyg' },
  { name: 'Arquitectura',    item: 'urn:adsk.wipprod:dm.lineage:An97q1IYStSSeYpBgRpQ0w' }
];

/* ACC_FEDERADO_ITEMS permite sustituir la lista sin tocar código.
   Dos formatos: JSON [{name,item},…] o "Nombre=urn:…" separados por coma. */
export function lista() {
  const crudo = process.env.ACC_FEDERADO_ITEMS;
  if (!crudo) return POR_DEFECTO;
  try {
    const p = JSON.parse(crudo);
    if (Array.isArray(p) && p.length) return p;
  } catch { /* no era JSON: se intenta el formato corto */ }
  const partes = crudo.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    return i < 0 ? { name: null, item: s } : { name: s.slice(0, i).trim(), item: s.slice(i + 1).trim() };
  });
  return partes.length ? partes : POR_DEFECTO;
}

export function proyecto() {
  return process.env.ACC_PROJECT_ID_FEDERADO || process.env.ACC_PROJECT_ID || null;
}

/* El webhook trae el linaje como urn:adsk.wipprod:dm.lineage:XXX; se compara
   sólo la parte final para no depender del prefijo. */
const cola = s => String(s || '').split(':').pop();
export function buscaModelo(lineage) {
  const c = cola(lineage);
  return lista().find(m => cola(m.item) === c) || null;
}
