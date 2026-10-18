/* PHOENIX — Ally Swapper interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myId = null;

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
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
      '  <p id="swapper-feedback">Waiting for opponent to acknowledge…</p>' +
      '  <button id="swapper-ack" type="button">Acknowledge</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('swapper-ack').onclick = function () {
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'interact', decision: 'ack' }));
      }
      document.getElementById('swapper-ack').disabled = true;
      document.getElementById('swapper-ack').textContent = 'Acknowledged';
      document.getElementById('swapper-feedback').textContent = 'Waiting for opponent…';
    };

    // Get my player ID
    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'swapper') return;

    var pi = msg.pendingInteraction;
    var ackBtn = document.getElementById('swapper-ack');
    var feedback = document.getElementById('swapper-feedback');

    // Check if result is available
    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'swapper';
      });
      if (resultEvent) {
        feedback.textContent = resultEvent.text || 'Allies swapped.';
        if (ackBtn) ackBtn.hidden = true;
        setTimeout(function () { close(); }, 6000);
      }
      return;
    }

    // Check if I've submitted
    var mySubmitted = pi.decisions && pi.decisions.main && pi.decisions.main[myId];
    if (mySubmitted && ackBtn && !ackBtn.disabled) {
      ackBtn.disabled = true;
      ackBtn.textContent = 'Acknowledged';
      feedback.textContent = 'Waiting for opponent…';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
  }

  window.PhoenixSwapperInteractive = { build: build, close: close, onState: onState };
})();