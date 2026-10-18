/* PHOENIX — Betrayal interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay betrayal-overlay';
    overlay.id = 'betrayal-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Betrayal">' +
      '  <h2>Betrayal</h2>' +
      '  <p>Both opponents secretly choose Share or Steal.</p>' +
      '  <div class="betrayal-choices">' +
      '    <button id="betrayal-share" type="button">✦ Share</button>' +
      '    <button id="betrayal-steal" type="button">☠ Steal</button>' +
      '  </div>' +
      '  <p id="betrayal-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.getElementById('betrayal-share').onclick = () => submit('share');
    document.getElementById('betrayal-steal').onclick = () => submit('steal');
  }
  function submit(decision) {
    document.getElementById('betrayal-share').disabled = true;
    document.getElementById('betrayal-steal').disabled = true;
    document.getElementById('betrayal-feedback').textContent = 'Choice locked. Waiting for both opponents.';
    if (window.ws && window.ws.readyState === 1) window.ws.send(JSON.stringify({ type: 'interact', decision: decision }));
  }
  function onState(msg) {
    if (msg.pendingInteraction && msg.pendingInteraction.type === 'betrayal') { return; }
    if (msg.events && msg.events.some(e => e.type === 'result' && e.cardId === 'betrayal')) {
      const text = msg.events.find(e => e.type === 'result' && e.cardId === 'betrayal').text;
      document.getElementById('betrayal-feedback').textContent = text || 'Betrayal resolved.';
      setTimeout(() => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, 6000);
    }
  }
  window.PhoenixBetrayalInteractive = { build: build, close: () => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, onState: onState };
})();
