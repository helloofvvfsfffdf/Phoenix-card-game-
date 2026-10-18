/* PHOENIX — Linked Fate interactive minigame */
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
      '  <p id="linkedfate-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('linkedfate-ack').onclick = function () {
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'interact', decision: 'ack' }));
      }
      document.getElementById('linkedfate-ack').disabled = true;
      document.getElementById('linkedfate-ack').textContent = 'Acknowledged';
      document.getElementById('linkedfate-feedback').textContent = 'Waiting for partner…';
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
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'linkedfate') return;

    var pi = msg.pendingInteraction;
    var ackBtn = document.getElementById('linkedfate-ack');
    var feedback = document.getElementById('linkedfate-feedback');

    // Check if result is available
    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'linkedfate';
      });
      if (resultEvent) {
        feedback.textContent = resultEvent.text || 'Linked Fate established.';
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
      feedback.textContent = 'Waiting for partner…';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
  }

  window.PhoenixLinkedFateInteractive = { build: build, close: close, onState: onState };
})();