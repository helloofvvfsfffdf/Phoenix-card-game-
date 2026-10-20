/* PHOENIX - Wheel of Fortune and Wheel of Misfortune interactive minigames.
 *
 * Two wheels, one overlay. The Wheel of Fortune has nine outcomes; the Wheel
 * of Misfortune has eight, and every one of them is terrible in a different
 * way. The server decides which one comes up - the client only shows it.
 */
(function () {
  'use strict';
  var overlay = null;
  var myId = null;
  var spinResult = null;

  /* The Wheel of Fortune: nine outcomes, all of them survivable. */
  var FORTUNE = [
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

  /* The Wheel of Misfortune: eight outcomes, and the odds are printed on the
   * wheel so nobody is surprised. The weights are the server's weights. */
  var MISFORTUNE = [
    ['loan', 'Take out<br>a loan', 'An opponent is charged 40,000 points for a loan they never asked for', 20],
    ['puppets', 'Master of<br>Puppets', 'An opponent is imprisoned until your score reaches zero', 15],
    ['invisible', 'Now you<br>see me', 'You become untargetable for 5 rounds', 15],
    ['apocalypse', 'Phoenix<br>apocalypse', 'Everybody is handed a Phoenix card', 12],
    ['restart', 'Play<br>again', 'The match restarts - everybody gets a fresh hand', 10],
    ['nothing', 'Nothing', 'You have successfully wasted everyone’s time', 25],
    ['hell', 'Welcome to<br>hell', 'Your score is set to -100,000', 2],
    ['victory', 'Instant<br>victory', 'You win the match on the spot', 1]
  ];

  /** The wheel that belongs to this interaction. */
  function wheelFor(type) {
    return type === 'wheelofmisfortune' ? MISFORTUNE : FORTUNE;
  }

  function isMisfortune(type) {
    return type === 'wheelofmisfortune';
  }

  function wheelMarkup(list, misfortune) {
    return '<div class="wheel-stage"><div class="wheel-pointer" aria-hidden="true">▼</div>' +
      '<div class="wheel-graphic' + (misfortune ? ' wheel-graphic-misfortune' : '') + '" id="wheel-graphic" role="img" aria-label="Wheel with ' +
      list.length + ' numbered outcomes, listed below">' +
      list.map(function (outcome, index) {
        // The angle of this segment, measured clockwise from the top. The
        // spin uses the same number, so the wheel lands on the outcome.
        var angle = (360 / list.length) * index;
        return '<div class="wheel-segment s' + (index + 1) + '" data-outcome="' + outcome[0] +
          '" style="--angle:' + angle + 'deg" aria-hidden="true">' +
          '<span class="wheel-segment-number">' + (index + 1) + '</span><span>' + outcome[1] + '</span>' +
          (misfortune ? '<span class="wheel-segment-odds">' + outcome[3] + '%</span>' : '') + '</div>';
      }).join('') + '</div></div>';
  }

  function outcomeListMarkup(list, misfortune) {
    return '<p class="wheel-caption">' + (misfortune
      ? 'The wheel decides your fate. The odds are on the wheel.'
      : 'Match the wheel number to its outcome below.') + '</p>' +
      '<ol class="wheel-outcomes' + (misfortune ? ' wheel-outcomes-misfortune' : '') + '" id="wheel-outcomes" aria-label="Possible wheel outcomes">' +
      list.map(function (outcome, index) {
        return '<li data-outcome="' + outcome[0] + '"><span class="wheel-outcome-number" aria-hidden="true">' +
          (index + 1) + '</span><span>' + outcome[2] +
          (misfortune ? ' <b class="wheel-outcome-odds">' + outcome[3] + '%</b>' : '') + '</span></li>';
      }).join('') + '</ol>';
  }

  function build(type) {
    var misfortune = isMisfortune(type);
    var list = wheelFor(type);
    if (overlay && document.body.contains(overlay)) {
      // The wheel may have changed under us: rebuild it for the new type.
      if (overlay.getAttribute('data-wheel') === type) {
        overlay.hidden = false;
        // A HARDCORE second run: the wheel is spun again, so the button comes
        // back, the feedback is cleared and the last result's highlight goes.
        var spinAgain = document.getElementById('wheel-spin');
        if (spinAgain) spinAgain.hidden = false;
        var feedbackAgain = document.getElementById('wheel-feedback');
        if (feedbackAgain) feedbackAgain.textContent = 'Waiting for spin…';
        var graphicAgain = document.getElementById('wheel-graphic');
        if (graphicAgain) graphicAgain.classList.remove('wheel-spinning');
        var markedAgain = graphicAgain ? graphicAgain.querySelectorAll('.wheel-segment') : [];
        Array.prototype.forEach.call(markedAgain, function (seg) {
          seg.classList.remove('wheel-result');
        });
        return;
      }
      close();
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay wheel-overlay' + (misfortune ? ' wheel-overlay-misfortune' : '');
    overlay.id = 'wheel-overlay';
    overlay.setAttribute('data-wheel', type);
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="' + (misfortune ? 'Wheel of Misfortune' : 'Wheel of Fortune') + '">' +
      '  <h2>' + (misfortune ? 'Wheel of Misfortune' : 'Wheel of Fortune') + '</h2>' +
      wheelMarkup(list, misfortune) +
      '  <button type="button" id="wheel-spin" class="primary">' + (misfortune ? 'Spin the Wheel of Misfortune' : 'Spin the Wheel') + '</button>' +
      outcomeListMarkup(list, misfortune) +
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
    if (!msg.pendingInteraction || (msg.pendingInteraction.type !== 'wheel' && msg.pendingInteraction.type !== 'wheelofmisfortune')) return;

    var pi = msg.pendingInteraction;
    var misfortune = isMisfortune(pi.type);
    var list = wheelFor(pi.type);
    var spinBtn = document.getElementById('wheel-spin');
    var feedback = document.getElementById('wheel-feedback');
    var graphic = document.getElementById('wheel-graphic');

    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && (e.cardId === 'wheel' || e.cardId === 'wheelofmisfortune');
      });
      if (resultEvent) {
        feedback.textContent = resultEvent.text || 'Wheel result.';

        // Highlight the winning segment
        if (resultEvent.outcome && graphic) {
          var index = list.findIndex(function (o) { return o[0] === resultEvent.outcome; });
          if (index >= 0) {
            // The segment sits at this angle, so turning the wheel by the
            // opposite brings it to the pointer - which is where the outcome
            // says it landed.
            var step = 360 / list.length;
            var rotation = 1080 - index * step;
            if (window.gsap) window.gsap.to(graphic, {rotation: rotation, duration: misfortune ? 2.6 : 1.4, ease: 'power3.out'});
            else graphic.style.transform = 'rotate(' + rotation + 'deg)';
            var segments = graphic.querySelectorAll('.wheel-segment');
            segments.forEach(function (seg) {
              seg.classList.remove('wheel-result');
              if (seg.dataset.outcome === resultEvent.outcome) {
                seg.classList.add('wheel-result');
              }
            });
          }
        }

        if (spinBtn) {
          spinBtn.hidden = true;
          if (window.gsap) {
            window.gsap.to(feedback, {color: misfortune ? '#ff6b6b' : '#ffd700', duration: 0.5, yoyo: true, repeat: 1});
          }
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
