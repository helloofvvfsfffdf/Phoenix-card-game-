/* PHOENIX — Dice Challenge interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay dice-overlay';
    overlay.id = 'dice-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Dice Challenge">' +
      '  <h2>Dice Challenge</h2>' +
      '  <p>Both players roll a six-sided die. Higher roll wins 20,000 points.</p>' +
      '  <div id="dice-visual" class="dice-visual">' +
      '    <span class="dice-face" aria-label="Your roll">🎲</span>' +
      '    <span id="dice-vs">VS</span>' +
      '    <span class="dice-face" aria-label="Opponent roll">🎲</span>' +
      '  </div>' +
      '  <p id="dice-feedback" aria-live="polite">Waiting for both rolls…</p>' +
      '  <button id="dice-confirm" type="button" style="display:none">Confirm result</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
  }
  function close() { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }
  window.PhoenixDiceInteractive = { build: build, close: close };
})();
