/* PHOENIX — Speed Challenge interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var reactionStarted = false;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay speed-overlay';
    overlay.id = 'speed-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Speed Challenge">' +
      '  <h2>Speed Challenge</h2>' +
      '  <p id="speed-ready">Press when ready. A GO signal will appear.</p>' +
      '  <button type="button" id="speed-ready-btn" class="primary">Ready!</button>' +
      '  <button type="button" id="speed-go-btn" hidden>GO!</button>' +
      '  <p id="speed-feedback" aria-live="polite"></p>' +
      '<p class="speed-fineprint">Server-authoritative timing. False starts are penalised.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.getElementById('speed-ready-btn').onclick = () => submitReady();
  }
  function submitReady() {
    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'interact', decision: 'ready' }));
    }
    document.getElementById('speed-ready-btn').hidden = true;
    document.getElementById('speed-ready').textContent = 'Waiting for GO signal…';
  }
  function onState(msg) {
    if (msg.pendingInteraction && msg.pendingInteraction.type === 'speed') {
      if (msg.pendingInteraction.submitted && msg.pendingInteraction.submitted.includes('you')) {
        document.getElementById('speed-go-btn').hidden = false;
        document.getElementById('speed-feedback').textContent = 'GO! Press as fast as you can!';
      }
      return;
    }
    if (msg.events && msg.events.some(e => e.type === 'result' && e.cardId === 'speed')) {
      const text = msg.events.find(e => e.type === 'result' && e.cardId === 'speed').text;
      document.getElementById('speed-feedback').textContent = text || 'Speed Challenge result.';
      setTimeout(() => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, 6000);
    }
  }
  window.PhoenixSpeedInteractive = { build: build, close: () => { if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; } }, onState: onState };
})();
