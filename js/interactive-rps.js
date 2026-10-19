/* PHOENIX — Rock Paper Scissors interactive gameplay screen */
(function () {
  'use strict';
  var overlay = null;
  var choiceMade = null;
  var transitions = [];

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay rps-overlay';
    overlay.id = 'rps-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Rock Paper Scissors">' +
      '  <h2>Rock Paper Scissors</h2>' +
      '  <p class="rps-instruction" id="rps-instr">Make your secret choice. Your opponent will not see it.</p>' +
      '  <div class="rps-choices">' +
      '    <button type="button" id="rps-rock" class="rps-btn" aria-label="Rock"><span>✊</span><span>Rock</span></button>' +
      '    <button type="button" id="rps-paper" class="rps-btn" aria-label="Paper"><span>✋</span><span>Paper</span></button>' +
      '    <button type="button" id="rps-scissors" class="rps-btn" aria-label="Scissors"><span>✌</span><span>Scissors</span></button>' +
      '  </div>' +
      '  <div class="rps-status" id="rps-status" aria-live="polite"></div>' +
      '  <div class="rps-reveal" id="rps-reveal" hidden>' +
      '    <div class="rps-both"></div>' +
      '    <p id="rps-result"></p>' +
      '  </div>' +
      '  <p class="rps-fineprint">A server-authoritative result is shown to both players. Ties reroll.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('rps-rock').onclick = function () { submitChoice('rock'); };
    document.getElementById('rps-paper').onclick = function () { submitChoice('paper'); };
    document.getElementById('rps-scissors').onclick = function () { submitChoice('scissors'); };
  }

  function submitChoice(choice) {
    if (!window.ws || window.ws.readyState !== 1) return;
    choiceMade = choice;
    document.getElementById('rps-rock').disabled = true;
    document.getElementById('rps-paper').disabled = true;
    document.getElementById('rps-scissors').disabled = true;
    document.getElementById('rps-status').textContent = 'Choice locked. Waiting for opponent…';

    window.ws.send(JSON.stringify({ type: 'interact', decision: choice }));

    // Animate the chosen button
    if (window.gsap) {
      var btn = document.querySelector('#rps-' + choice);
      if (btn) {
        window.gsap.to(btn, {scale: 1.1, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out'});
      }
    }
  }

  function revealBoth(pick1, pick2, result) {
    var reveal = document.getElementById('rps-reveal');
    if (!reveal) return;
    reveal.hidden = false;

    var emoji = {rock: '✊', paper: '✋', scissors: '✌'};
    reveal.querySelector('.rps-both').innerHTML =
      '<span class="rps-pill rps-actor">' + (emoji[pick1] || '?') + ' ' + pick1 + '</span>' +
      '<span class="rps-pill rps-target">' + (emoji[pick2] || '?') + ' ' + pick2 + '</span>';

    document.getElementById('rps-result').textContent = result || 'Result revealed.';

    // Animate reveal
    if (window.gsap) {
      var both = reveal.querySelector('.rps-both');
      window.gsap.from(both.children, {opacity: 0, y: 20, duration: 0.4, stagger: 0.1, ease: 'power2.out'});
    }

  }

  function onState(message) {
    if (message.pendingInteraction && message.pendingInteraction.type === 'rps') {
      document.getElementById('rps-status').textContent = message.pendingInteraction.roundData.message || 'Make your secret choice.';
      return;
    }
    if (message.events) {
      var resultEvent = message.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'rps';
      });
      if (resultEvent) {
        var choices = message.lastInteractionResult.roundData.choices || {};
        var ids = message.lastInteractionResult.participants;
        revealBoth(choices[ids[0]] || '?', choices[ids[1]] || '?', resultEvent.text);
      }
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    choiceMade = null;
  }

  window.PhoenixRpsInteractive = { build: build, close: close, onState: onState, submitChoice: submitChoice };
})();
