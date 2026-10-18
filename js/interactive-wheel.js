/* PHOENIX — Wheel of Fortune interactive minigame */
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
    overlay.className = 'interactive-overlay wheel-overlay';
    overlay.id = 'wheel-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Wheel of Fortune">' +
      '  <h2>Wheel of Fortune</h2>' +
      '  <div class="wheel-graphic" aria-label="Spinning wheel with nine segments">' +
      '    <div class="wheel-segment s1"></div><div class="wheel-segment s2"></div>' +
      '    <div class="wheel-segment s3"></div><div class="wheel-segment s4"></div>' +
      '    <div class="wheel-segment s5"></div><div class="wheel-segment s6"></div>' +
      '    <div class="wheel-segment s7"></div><div class="wheel-segment s8"></div>' +
      '    <div class="wheel-segment s9"></div>' +
      '    <div class="wheel-pointer" aria-hidden="true">▼</div>' +
      '  </div>' +
      '  <button type="button" id="wheel-spin" class="primary">Spin the Wheel</button>' +
      '  <p id="wheel-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('wheel-spin').onclick = submit;

    // Get my player ID
    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function submit() {
    if (!window.ws || window.ws.readyState !== 1) return;
    var spinBtn = document.getElementById('wheel-spin');
    spinBtn.disabled = true;
    spinBtn.textContent = 'Spinning…';
    document.getElementById('wheel-feedback').textContent = 'The wheel is turning…';
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'spin' }));
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'wheel') return;

    var pi = msg.pendingInteraction;
    var spinBtn = document.getElementById('wheel-spin');
    var feedback = document.getElementById('wheel-feedback');
    var graphic = overlay ? overlay.querySelector('.wheel-graphic') : null;

    // Check if result is available
    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'wheel';
      });
      if (resultEvent) {
        // Show result with animation
        feedback.textContent = resultEvent.text || 'Wheel result.';
        if (graphic) graphic.classList.add('wheel-result');
        spinBtn.hidden = true;
        setTimeout(function () { close(); }, 6000);
      }
      return;
    }

    // Still waiting
    if (pi.phase === 'spun') {
      feedback.textContent = 'The wheel is turning…';
      if (graphic) graphic.classList.add('wheel-spinning');
    } else {
      feedback.textContent = 'Waiting for spin…';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
  }

  window.PhoenixWheelInteractive = { build: build, close: close, onState: onState };
})();