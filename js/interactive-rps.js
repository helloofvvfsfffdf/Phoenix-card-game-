/* PHOENIX — Rock Paper Scissors interactive gameplay screen */
(function () {
  'use strict';
  var overlay = null;
  var submitted = false;
  var choiceMade = null;

  function build() {
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
    if (submitted) return;
    submitted = true;
    choiceMade = choice;
    document.getElementById('rps-rock').disabled = true;
    document.getElementById('rps-paper').disabled = true;
    document.getElementById('rps-scissors').disabled = true;
    document.getElementById('rps-status').textContent = 'Choice locked. Waiting for opponent…';

    if (typeof window.ws !== 'undefined' && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'interact', decision: choice }));
    }
  }

  function revealBoth(pick1, pick2, result) {
    var reveal = document.getElementById('rps-reveal');
    if (!reveal) return;
    reveal.hidden = false;
    reveal.querySelector('.rps-both').innerHTML =
      '<span class="rps-pill rps-actor">You: ' + (choiceMade || '?') + '</span>' +
      '<span class="rps-pill rps-target">Opponent: ' + pick2 + '</span>';
    document.getElementById('rps-result').textContent = result || 'Result revealed.';
  }

  function onState(message) {
    // The server broadcasts the resolved interaction through the state snapshot.
    // We listen for the interaction result being present.
    if (message.pendingInteraction && message.pendingInteraction.type === 'rps') {
      // Still waiting.
      return;
    }
    // If the interaction is cleared and we have a result event, reveal.
    if (message.events) {
      var resultEvent = message.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'rps';
      });
      if (resultEvent) {
        revealBoth(choiceMade || '?', '?', resultEvent.text);
        // Auto-dismiss after viewing.
        setTimeout(function () { close(); }, 6000);
      }
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    submitted = false; choiceMade = null;
  }

  window.PhoenixRpsInteractive = { build: build, close: close, onState: onState, submitChoice: submitChoice };
})();
