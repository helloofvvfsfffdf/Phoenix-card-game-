/* PHOENIX — Impostor interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay impostor-overlay';
    overlay.id = 'impostor-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Impostor">' +
      '  <h2>Impostor</h2>' +
      '  <p>Secret words given. Give short clues without revealing directly.</p>' +
      '  <div id="impostor-words" style="padding:1rem;background:#2a2030;border-radius:10px;margin:1rem 0;"></div>' +
      '  <div id="impostor-vote" style="margin-top:1rem;">' +
      '    <button type="button" onclick="window.PhoenixImpostorVote && window.PhoenixImpostorVote.submitVote(\'vincent\')">Vote Vincent</button>' +
      '  </div>' +
      '  <p id="impostor-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
  }
  function submitVote(name) {
    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'interact', decision: 'vote:' + name }));
    }
  }
  window.PhoenixImpostorVote = { submitVote: submitVote };
  window.PhoenixImpostorInteractive = { build: build, close: function () { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } } };
})();
