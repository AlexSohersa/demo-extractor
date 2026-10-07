/* ─────────────────────────────────────────────────────────────────────────
   Pestañas de nivel superior.

   Cada botón [data-tab-btn="clave"] muestra el panel [data-tab-panel="clave"].
   La pestaña activa va en el hash de la URL, así que se puede enlazar y
   sobrevive a un refresco — útil con `netlify dev`, donde uno recarga cada
   dos por tres.

   Al mostrar un panel se emite 'tab:shown'. viewer.js lo escucha para montar
   su visor la primera vez (dentro de un panel oculto el contenedor mide 0) y
   para recalcular el canvas en las siguientes.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const btns = Array.from(document.querySelectorAll('[data-tab-btn]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  if (!btns.length || !panels.length) return;

  const keys = btns.map(b => b.dataset.tabBtn);

  function show(key, updateHash) {
    if (keys.indexOf(key) < 0) key = keys[0];

    for (const b of btns) {
      const on = b.dataset.tabBtn === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    for (const p of panels) p.hidden = p.dataset.tabPanel !== key;

    if (updateHash !== false && location.hash.slice(1) !== key) {
      history.replaceState(null, '', '#' + key);
    }
    window.dispatchEvent(new CustomEvent('tab:shown', { detail: { key: key } }));
  }

  for (const b of btns) {
    b.addEventListener('click', () => show(b.dataset.tabBtn));
  }

  // Flechas izquierda/derecha entre pestañas, como espera un lector de pantalla.
  for (const b of btns) {
    b.addEventListener('keydown', function (e) {
      const i = keys.indexOf(b.dataset.tabBtn);
      let next = null;
      if (e.key === 'ArrowRight') next = (i + 1) % keys.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + keys.length) % keys.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = keys.length - 1;
      if (next === null) return;
      e.preventDefault();
      show(keys[next]);
      btns[next].focus();
    });
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1), false));

  show(location.hash.slice(1) || keys[0]);
})();
