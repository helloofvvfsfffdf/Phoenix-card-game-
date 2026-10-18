/* PHOENIX — Wheel of Fortune interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myId = null;
  var spinResult = null;

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
      '  <div class="wheel-graphic" id="wheel-graphic" aria-label="Spinning wheel with nine segments">' +
      '    <div class="wheel-segment s1" data-outcome="reshuffle">Reshuffle</div>' +
      '    <div class="wheel-segment s2" data-outcome="reset_self">Reset Self</div>' +
      '    <div class="wheel-segment s3" data-outcome="reset_others">Reset Others</div>' +
      '    <div class="wheel-segment s4" data-outcome="eliminate_self_3">Eliminate 3</div>' +
      '    <div class="wheel-segment s5" data-outcome="reverse">Reverse</div>' +
      '    <div class="wheel-segment s6" data-outcome="gain_10k">+10,000</div>' +
      '    <div class="wheel-segment s7" data-outcome="lose_20k">-20,000</div>' +
      '    <div class="wheel-segment s8" data-outcome="others_gain_20k">Others +20k</div>' +
      '    <div class="wheel-segment s9" data-outcome="no_evil_permanent">No Evil</div>' +
      '    <div class="wheel-pointer" aria-hidden="true">▼</div>' +
      '  </div>' +
      '  <button type="button" id="wheel-spin" class="primary">Spin the Wheel</button>' +
      '  <p id="wheel-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('wheel-spin').onclick = submit;

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

    if (window.gsap) {
      var graphic = document.getElementById('wheel-graphic');
      if (graphic) {
        window.gsap.to(graphic, {rotation: 720 + Math.random() * 360, duration: 2, ease: 'power3.out'});
      }
    }

    window.ws.send(JSON.stringify({ type: 'interact', decision: 'spin' }));
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'wheel') return;

    var pi = msg.pendingInteraction;
    var spinBtn = document.getElementById('wheel-spin');
    var feedback = document.getElementById('wheel-feedback');
    var graphic = document.getElementById('wheel-graphic');

    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'wheel';
      });
      if (resultEvent) {
        feedback.textContent = resultEvent.text || 'Wheel result.';

        // Highlight the winning segment
        if (resultEvent.outcome && graphic) {
          var segments = graphic.querySelectorAll('.wheel-segment');
          segments.forEach(function(seg) {
            seg.classList.remove('wheel-result');
            if (seg.dataset.outcome === resultEvent.outcome) {
              seg.classList.add('wheel-result');
            }
          });
        }

        spinBtn.hidden = true;
        if (window.gsap) {
          window.gsap.to(feedback, {color: '#ffd700', duration: 0.5, yoyo: true, repeat: 1});
        }
        setTimeout(function () { close(); }, 6000);
      }
      return;
    }

    if (pi.phase === 'spun') {
      feedback.textContent = 'The wheel is turning…';
      if (graphic) graphic.classList.add('wheel-spinning');
    } else {
      feedback.textContent = 'Waiting for spin…';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    myId = null;
    spinResult = null;
  }

  window.PhoenixWheelInteractive = { build: build, close: close, onState: onState };
})();