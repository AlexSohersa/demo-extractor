/* ─────────────────────────────────────────────────────────────────────────
   Transparencia real por elemento.

   No la da setThemingColor: su cuarta componente NO es opacidad sino peso
   de mezcla — el sombreador hace mix(color, tema.rgb, tema.a) y sólo toca
   el RGB. Un rojo con alpha 0.5 sale rosa opaco, no rojo translúcido.

   La transparencia de verdad está en el material, así que aquí se sustituye
   el material de los fragmentos afectados por un clon translúcido. Los
   materiales se comparten entre miles de fragmentos, de modo que se clona
   UNA VEZ por material distinto y se reutiliza: son dos o tres clones por
   modelo, no uno por elemento.

   El color de tema se sigue aplicando encima: vive en el fragmento, no en
   el material, y el clon conserva el mismo sombreador.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* Para deshacer: visor → [[fragList, fragId, material original], …].
     Va por visor, no en una lista única: los dos visores viven a la vez en
     pestañas distintas, y una lista compartida haría que colorear en uno
     restaurara los materiales del otro a su espalda. */
  const previos = new Map();
  let contador = 0;

  const registro = viewer => {
    if (!previos.has(viewer)) previos.set(viewer, []);
    return previos.get(viewer);
  };

  /* depthWrite = false es lo que hace que se vea a través de la pieza y no
     sólo a través de su cara frontal. Sin esto, una columna translúcida
     tapa a las que tiene detrás. */
  function clonar(viewer, orig) {
    const clon = orig.clone();
    clon.transparent = true;
    clon.opacity = 0;          // la fija aplicar(), el clon se cachea por opacidad
    clon.depthWrite = false;
    clon.needsUpdate = true;
    try { viewer.impl.matman().addMaterial('translucido-' + (contador++), clon, true); }
    catch (e) { /* según versión del SDK; el material funciona igual */ }
    return clon;
  }

  function aplicar(viewer, model, dbIds, opacidad) {
    if (!viewer || !model || !dbIds || !dbIds.length) return 0;
    const it = model.getInstanceTree ? model.getInstanceTree() : null;
    const frags = model.getFragmentList ? model.getFragmentList() : null;
    if (!it || !frags || typeof frags.getMaterial !== 'function') return 0;

    const cache = new Map();   // material original → clon translúcido
    const deshacer = registro(viewer);
    let n = 0;

    for (const dbId of dbIds) {
      it.enumNodeFragments(dbId, fragId => {
        const orig = frags.getMaterial(fragId);
        if (!orig || orig.__translucido) return;   // ya sustituido
        let clon = cache.get(orig);
        if (!clon) {
          clon = clonar(viewer, orig);
          clon.opacity = opacidad;
          clon.__translucido = true;
          cache.set(orig, clon);
        }
        deshacer.push([frags, fragId, orig]);
        frags.setMaterial(fragId, clon);
        n++;
      }, true);
    }

    if (n) viewer.impl.invalidate(true, true, true);
    return n;
  }

  function restaurar(viewer) {
    const deshacer = previos.get(viewer);
    if (!deshacer || !deshacer.length) return 0;
    for (const [frags, fragId, orig] of deshacer) {
      try { frags.setMaterial(fragId, orig); } catch (e) { /* modelo descargado */ }
    }
    const n = deshacer.length;
    previos.set(viewer, []);
    if (viewer && viewer.impl) viewer.impl.invalidate(true, true, true);
    return n;
  }

  window.apsOpacidad = {
    aplicar, restaurar,
    activos: viewer => (previos.get(viewer) || []).length
  };
})();
