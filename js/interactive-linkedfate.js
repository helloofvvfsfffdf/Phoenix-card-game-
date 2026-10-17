/* PHOENIX — Linked Fate interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay linkedfate-overlay';
    overlay.id = 'linkedfate-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Linked Fate">' +
      '  <h2>Linked Fate</h2>' +
      '  <p>You and your linked partner will share 50% of point gains for 2 rounds.</p>' +
      '  <div class="linked-chain">' +
      '    <span>You</span> <span>↔</span> <span>Partner</span>' +
      '  </div>' +
      '  <p>Shared gains apply automatically after each card play.</p>' +
      '  <button id="linkedfate-ack" type="button">Acknowledge</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.getElementById('linkedfate-ack').onclick = function () {
      if (window.ws && window.ws.readyState === 1) window.ws.send(JSON.stringify({ type: 'interact', decision: 'ack' }));
      close();
    };
  }
  function close() { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }
  window.PhoenixLinkedFateInteractive = { build: build, close: close };
})();
