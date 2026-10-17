/* PHOENIX — Ally Swapper interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay swapper-overlay';
    overlay.id = 'swapper-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Ally Swapper">' +
      '  <h2>Ally Swapper</h2>' +
      '  <p>You and your opponent have exchanged allies.</p>' +
      '  <div class="swapper-animation" aria-label="Ally swap animation">' +
      '    <span class="swapper-icon">✢</span> <span>↔</span> <span class="swapper-icon">✢</span>' +
      '  </div>' +
      '  <p id="swapper-feedback">Your new ally is shown above.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
  }
  window.PhoenixSwapperInteractive = { build: build, close: function () { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } } };
})();
