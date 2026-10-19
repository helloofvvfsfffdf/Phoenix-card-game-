/* PHOENIX — Dice Challenge interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myRoll = null;
  var myId = null;
  var die = null;
  var transitions = [];
  var PIPS = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  var ROTATIONS = {1:{x:0,y:0},2:{x:0,y:-90},3:{x:-90,y:0},4:{x:90,y:0},5:{x:0,y:90},6:{x:0,y:180}};

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
      '    <div class="dice-stage" id="dice-stage-my">' +
      '      <div class="dice-cube" id="dice-cube-my" aria-label="Your roll"></div>' +
      '    </div>' +
      '    <span id="dice-vs">VS</span>' +
      '    <div class="dice-stage" id="dice-stage-opponent">' +
      '      <div class="dice-cube" id="dice-cube-opponent" aria-label="Opponent roll"></div>' +
      '    </div>' +
      '  </div>' +
      '  <p id="dice-feedback" aria-live="polite">Press Roll to roll the die.</p>' +
      '  <button id="dice-roll-btn" type="button" class="primary">Roll</button>' +
      '  <button id="dice-confirm" type="button" style="display:none">Confirm result</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    // Build die faces for both cubes
    buildDieFaces('dice-cube-my');
    buildDieFaces('dice-cube-opponent');

    document.getElementById('dice-roll-btn').onclick = submitRoll;

    // Get my player ID
    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function buildDieFaces(cubeId) {
    var cube = document.getElementById(cubeId);
    if (!cube) return;
    cube.innerHTML = '';
    for (var value = 1; value <= 6; value++) {
      var face = document.createElement('div');
      face.className = 'dice-die-face';
      face.dataset.face = String(value);
      PIPS[value].forEach(function(pos) {
        var pip = document.createElement('i');
        pip.className = 'dice-die-pip';
        pip.style.gridColumn = String(pos % 3 + 1);
        pip.style.gridRow = String(Math.floor(pos / 3) + 1);
        face.appendChild(pip);
      });
      cube.appendChild(face);
    }
  }

  function submitRoll() {
    if (!window.ws || window.ws.readyState !== 1) return;
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'roll' }));
    var rollBtn = document.getElementById('dice-roll-btn');
    rollBtn.disabled = true;
    rollBtn.textContent = 'Rolling…';
    document.getElementById('dice-feedback').textContent = 'Rolling… waiting for opponent.';
  }

  function animateRoll(cubeId, value, name) {
    var cube = document.getElementById(cubeId);
    if (!cube) return;
    if (!window.gsap) {
      // Fallback: just show the result face
      var faces = cube.querySelectorAll('.dice-die-face');
      faces.forEach(function(f) { f.classList.remove('is-result'); });
      var resultFace = cube.querySelector('.dice-die-face[data-face="' + value + '"]');
      if (resultFace) resultFace.classList.add('is-result');
      return;
    }

    var rotation = ROTATIONS[value];
    window.gsap.set(cube, {rotationX: -160, rotationY: -200, rotationZ: -25, y: -12, scale: 0.65});

    var timeline = window.gsap.timeline({
      onComplete: function() {
        // Mark result face
        var faces = cube.querySelectorAll('.dice-die-face');
        faces.forEach(function(f) { f.classList.remove('is-result'); });
        var resultFace = cube.querySelector('.dice-die-face[data-face="' + value + '"]');
        if (resultFace) resultFace.classList.add('is-result');
      }
    });

    timeline.to(cube, {
      rotationX: 720 + rotation.x,
      rotationY: 720 + rotation.y,
      rotationZ: 360,
      y: 0,
      scale: 1,
      duration: 1.05,
      ease: 'power3.out'
    }, 0)
    .call(function() {
      // Update feedback after animation
      var feedback = document.getElementById('dice-feedback');
      var oppCube = document.getElementById('dice-cube-opponent');
      var myCube = document.getElementById('dice-cube-my');
      var bothRolled = myCube.dataset.rolled && oppCube.dataset.rolled;
      if (bothRolled) {
        var myRoll = parseInt(myCube.dataset.rolled, 10);
        var oppRoll = parseInt(oppCube.dataset.rolled, 10);
        var winner = myRoll > oppRoll ? 'You win!' : (oppRoll > myRoll ? 'Opponent wins!' : 'Tie!');
        feedback.textContent = 'You rolled ' + myRoll + ', opponent rolled ' + oppRoll + '. ' + winner;
        document.getElementById('dice-roll-btn').hidden = true;
      }
    }, null, 1.05)
    .to(cube, {scale: 1.06, duration: 0.12, repeat: 1, yoyo: true}, 1.05);

    transitions.push({tween: timeline, finish: function() {}});
    return timeline;
  }

  function showRoll(myValue, oppValue) {
    var myCube = document.getElementById('dice-cube-my');
    var oppCube = document.getElementById('dice-cube-opponent');
    myCube.dataset.rolled = myValue;
    oppCube.dataset.rolled = oppValue;

    // Animate my roll
    animateRoll('dice-cube-my', myValue, 'You');

    // Animate opponent roll with slight delay
    animateRoll('dice-cube-opponent', oppValue, 'Opponent');
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'dice') return;

    var pi = msg.pendingInteraction;
    var feedback = document.getElementById('dice-feedback');
    var rollBtn = document.getElementById('dice-roll-btn');

    // Check if result is available
    if (pi.roundData && pi.roundData.rolls) {
      var displayId = pi.participants.includes(myId) ? myId : pi.participants[0];
      var myRoll = pi.roundData.rolls[displayId];
      var otherId = pi.participants.find(function (id) { return id !== displayId; });
      var theirRoll = otherId ? pi.roundData.rolls[otherId] : null;

      if (myRoll && theirRoll) {
        showRoll(myRoll, theirRoll);
        feedback.textContent = msg.events && msg.events[0] ? msg.events[0].text : 'Dice rolled.';
        rollBtn.hidden = true;
      }
      return;
    }

    // Check if I've submitted
    var mySubmitted = (pi.submitted || []).includes(myId);

    if (mySubmitted && !rollBtn.disabled) {
      rollBtn.disabled = true;
      rollBtn.textContent = 'Rolling…';
      feedback.textContent = 'Rolling… waiting for opponent.';
    } else if (!mySubmitted && rollBtn.disabled) {
      rollBtn.disabled = false;
      rollBtn.textContent = 'Roll';
      feedback.textContent = pi.roundData.message || 'Press Roll to roll the die.';
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    transitions.forEach(function(r) { if (r.tween) r.tween.kill(); if (r.finish) r.finish(); });
    transitions = [];
    die = null;
    myRoll = null;
  }

  window.PhoenixDiceInteractive = { build: build, close: close, onState: onState };
})();
