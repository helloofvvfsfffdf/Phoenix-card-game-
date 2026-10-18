/* PHOENIX — Dice Challenge interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myRoll = null;
  var myId = null;

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay dice-overlay';
    overlay.id = 'dice-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Dice Challenge">' +
      '  <h2>Dice Challenge</h2>' +
      '  <p>Both players roll a six-sided die. Higher roll wins 20,000 points.</p>' +
      '  <div id="dice-visual" class="dice-visual">' +
      '    <span class="dice-face" id="dice-my" aria-label="Your roll">🎲</span>' +
      '    <span id="dice-vs">VS</span>' +
      '    <span class="dice-face" id="dice-opponent" aria-label="Opponent roll">🎲</span>' +
      '  </div>' +
      '  <p id="dice-feedback" aria-live="polite">Press Roll to roll the die.</p>' +
      '  <button id="dice-roll-btn" type="button" class="primary">Roll</button>' +
      '  <button id="dice-confirm" type="button" style="display:none">Confirm result</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('dice-roll-btn').onclick = submitRoll;

    // Get my player ID
    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function submitRoll() {
    if (!window.ws || window.ws.readyState !== 1) return;
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'roll' }));
    document.getElementById('dice-roll-btn').disabled = true;
    document.getElementById('dice-roll-btn').textContent = 'Rolling…';
    document.getElementById('dice-feedback').textContent = 'Rolling… waiting for opponent.';
  }

  function showRoll(roll) {
    var myFace = document.getElementById('dice-my');
    if (myFace) myFace.textContent = '⚀⚁⚂⚃⚄⚅'.charAt(roll - 1);
  }

  function showOpponentRoll(roll) {
    var oppFace = document.getElementById('dice-opponent');
    if (oppFace) oppFace.textContent = '⚀⚁⚂⚃⚄⚅'.charAt(roll - 1);
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'dice') return;

    var pi = msg.pendingInteraction;
    var feedback = document.getElementById('dice-feedback');
    var rollBtn = document.getElementById('dice-roll-btn');
    var myFace = document.getElementById('dice-my');
    var oppFace = document.getElementById('dice-opponent');

    // Check if I've submitted
    var mySubmitted = pi.decisions && pi.decisions.main && pi.decisions.main[myId];

    if (pi.roundData && pi.roundData.rolls) {
      // Both rolls are in - show results
      var myRoll = pi.roundData.rolls[myId];
      var otherId = pi.participants.find(function (id) { return id !== myId; });
      var theirRoll = otherId ? pi.roundData.rolls[otherId] : null;

      if (myRoll) showRoll(myRoll);
      if (theirRoll) showOpponentRoll(theirRoll);

      if (myRoll && theirRoll) {
        var winner = myRoll > theirRoll ? 'You win!' : (theirRoll > myRoll ? 'Opponent wins!' : 'Tie!');
        feedback.textContent = 'You rolled ' + myRoll + ', opponent rolled ' + theirRoll + '. ' + winner;
        rollBtn.hidden = true;
        setTimeout(function () { close(); }, 6000);
      }
      return;
    }

    if (mySubmitted && !rollBtn.disabled) {
      rollBtn.disabled = true;
      rollBtn.textContent = 'Rolling…';
      feedback.textContent = 'Waiting for opponent to roll…';
    } else if (!mySubmitted && rollBtn.disabled) {
      rollBtn.disabled = false;
      rollBtn.textContent = 'Roll';
      feedback.textContent = 'Press Roll to roll the die.';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    myRoll = null;
  }

  window.PhoenixDiceInteractive = { build: build, close: close, onState: onState };
})();