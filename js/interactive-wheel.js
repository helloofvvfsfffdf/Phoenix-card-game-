/* PHOENIX — Wheel of Fortune interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myId = null;
  var spinResult = null;
  var outcomes = [
    ['reshuffle', 'Shuffle<br>cards', 'Reshuffle all cards'],
    ['reset_self', 'Reset<br>you', 'Reset your points to 0'],
    ['reset_others', 'Reset<br>others', 'Reset everyone else’s points to 0'],
    ['eliminate_self_3', 'Out for<br>3 rounds', 'Miss 3 rounds'],
    ['reverse', 'Reverse<br>turns', 'Reverse turn order'],
    ['gain_10k', '+10,000<br>points', 'Gain 10,000 points'],
    ['lose_20k', '−20,000<br>points', 'Lose 20,000 points'],
    ['others_gain_20k', '+20,000<br>others', 'Everyone else gains 20,000'],
    ['no_evil_permanent', 'No evil<br>cards', 'No evil cards for the rest of the game']
  ];

  function wheelMarkup() {
    return '<div class="wheel-stage"><div class="wheel-pointer" aria-hidden="true">▼</div>' +
      '<div class="wheel-graphic" id="wheel-graphic" role="img" aria-label="Wheel with nine numbered outcomes, listed below">' +
      outcomes.map(function (outcome, index) {
        return '<div class="wheel-segment s' + (index + 1) + '" data-outcome="' + outcome[0] + '" aria-hidden="true">' +
          '<span class="wheel-segment-number">' + (index + 1) + '</span><span>' + outcome[1] + '</span></div>';
      }).join('') + '</div></div>';
  }

  function outcomeListMarkup() {
    return '<p class="wheel-caption">Match the wheel number to its outcome below.</p>' +
      '<ol class="wheel-outcomes" id="wheel-outcomes" aria-label="Possible wheel outcomes">' +
      outcomes.map(function (outcome, index) {
        return '<li data-outcome="' + outcome[0] + '"><span class="wheel-outcome-number" aria-hidden="true">' +
          (index + 1) + '</span><span>' + outcome[2] + '</span></li>';
      }).join('') + '</ol>';
  }

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
      wheelMarkup() +
      '  <button type="button" id="wheel-spin" class="primary">Spin the Wheel</button>' +
      outcomeListMarkup() +
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
          var index = outcomes.findIndex(function (o) { return o[0] === resultEvent.outcome; });
          var rotation = 1080 + 360 - (index * 40 + 20);
          if (window.gsap) window.gsap.to(graphic, {rotation: rotation, duration: 1.4, ease: 'power3.out'});
          else graphic.style.transform = 'rotate(' + rotation + 'deg)';
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
