/* PHOENIX — Impostor interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var myId = null;
  var myWord = null;
  var isImpostor = false;
  var clock = null;
  var deadline = null;
  var clockPhase = '';

  function renderClock() {
    var node = document.getElementById('impostor-timer');
    if (node) node.textContent = deadline ? clockPhase + ' · ' + Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + 's remaining' : '';
  }

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay impostor-overlay';
    overlay.id = 'impostor-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Impostor">' +
      '  <h2>Impostor</h2>' +
      '  <p>Secret words given. Give short clues without revealing directly.</p>' +
      '  <p id="impostor-timer" role="timer"></p>' +
      '  <div id="impostor-words" style="padding:1rem;background:#2a2030;border-radius:10px;margin:1rem 0;"></div>' +
      '  <div id="impostor-clues" style="margin-top:1rem;"></div>' +
      '  <div id="impostor-vote" style="margin-top:1rem;"></div>' +
      '  <p id="impostor-feedback" aria-live="polite"></p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    clock = setInterval(renderClock, 250);

    // Get my player ID
    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function submitClue(clue) {
    if (!window.ws || window.ws.readyState !== 1) return;
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'clue:' + clue }));
    document.getElementById('impostor-feedback').textContent = 'Clue submitted. Waiting for others…';
  }

  function submitVote(votedId) {
    if (!window.ws || window.ws.readyState !== 1) return;
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'vote:' + votedId }));
    document.getElementById('impostor-feedback').textContent = 'Vote cast. Waiting for results…';
  }

  function showWords(word, impostor) {
    myWord = word;
    isImpostor = impostor;
    var wordsDiv = document.getElementById('impostor-words');
    wordsDiv.innerHTML = '<strong>Your word: </strong>' + word + (impostor ? ' <span style="color:#ff6b6b">(IMPOSTOR)</span>' : '');
  }

  function showCluePhase() {
    var cluesDiv = document.getElementById('impostor-clues');
    cluesDiv.innerHTML = '<h3>Give a clue about your word:</h3>' +
      '<input type="text" id="impostor-clue-input" placeholder="Enter your clue" style="width:100%;padding:0.5rem;margin:0.5rem 0;">' +
      '<button type="button" id="impostor-submit-clue" class="primary">Submit Clue</button>';
    document.getElementById('impostor-submit-clue').onclick = function () {
      var input = document.getElementById('impostor-clue-input');
      if (input.value.trim()) {
        submitClue(input.value.trim());
        input.disabled = true;
        document.getElementById('impostor-submit-clue').disabled = true;
      }
    };
  }

  function showVotePhase(participants) {
    var voteDiv = document.getElementById('impostor-vote');
    var others = participants.filter(function (id) { return id !== myId; });
    var buttons = others.map(function (id) {
      // Find player name from state
      var name = 'Player';
      if (window.PhoenixOnline && window.PhoenixOnline.getState) {
        var state = window.PhoenixOnline.getState();
        if (state && state.players) {
          var p = state.players.find(function (pl) { return pl.id === id; });
          if (p) name = p.name;
        }
      }
      var safeName = document.createElement('span');
      safeName.textContent = name;
      return '<button type="button" class="impostor-vote-btn" data-vote="' + id + '">Vote ' + safeName.innerHTML + '</button>';
    }).join(' ');
    voteDiv.innerHTML = '<h3>Vote for the Impostor:</h3>' + buttons;
    voteDiv.querySelectorAll('.impostor-vote-btn').forEach(function (btn) {
      btn.onclick = function () {
        submitVote(this.dataset.vote);
        voteDiv.querySelectorAll('.impostor-vote-btn').forEach(function (b) { b.disabled = true; });
      };
    });
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'impostor') return;

    var pi = msg.pendingInteraction;
    deadline = pi.deadlineAt;
    clockPhase = pi.phase === 'vote' ? 'Secret ballot' : 'Clues';
    renderClock();
    var wordsDiv = document.getElementById('impostor-words');
    var cluesDiv = document.getElementById('impostor-clues');
    var voteDiv = document.getElementById('impostor-vote');
    var feedback = document.getElementById('impostor-feedback');

    // Check if result is available
    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'impostor';
      });
      if (resultEvent) {
        clearInterval(clock);
        deadline = null;
        renderClock();
        feedback.textContent = resultEvent.text || 'Impostor round complete.';
        var revealed = pi.roundData.revealedWords;
        if (revealed) wordsDiv.textContent = 'Words revealed: ' + revealed.main + ' / ' + revealed.impostor;
        cluesDiv.innerHTML = '';
        voteDiv.innerHTML = '';
      }
      if (resultEvent) return;
    }

    // Phase: clues (waiting/main/clues)
    if (pi.phase === 'clues' || pi.phase === 'waiting' || pi.phase === 'main') {
      // Show my word if available
      if (pi.roundData && pi.roundData.myWord) {
        wordsDiv.textContent = 'Your word: ' + pi.roundData.myWord;
      }
      if (!document.getElementById('impostor-clue-input')) showCluePhase();
      document.getElementById('impostor-clue-input').maxLength = 35;
      var clued = (pi.submitted || []).includes(myId);
      document.getElementById('impostor-clue-input').disabled = clued;
      document.getElementById('impostor-submit-clue').disabled = clued;
      if (clued) feedback.textContent = 'Clue submitted. Waiting for others…';
      return;
    }

    // Phase: vote
    if (pi.phase === 'vote') {
      if (!voteDiv.querySelector('.impostor-vote-btn')) {
        cluesDiv.replaceChildren();
        pi.participants.forEach(function (id) {
          var line = document.createElement('p');
          var player = msg.players.find(function (p) { return p.id === id; });
          line.textContent = (player ? player.name : id) + ': ' + (pi.roundData.clues[id] || '').replace(/^clue:/, '');
          cluesDiv.appendChild(line);
        });
        showVotePhase(pi.participants);
      }
      var voted = (pi.submitted || []).includes(myId);
      voteDiv.querySelectorAll('.impostor-vote-btn').forEach(function (button) { button.disabled = voted; });
      feedback.textContent = voted ? 'Vote cast. Waiting for results…' : 'Read the public clues, then cast your secret ballot.';
      return;
    }
  }

  function close() {
    clearInterval(clock);
    clock = null;
    deadline = null;
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    myId = null;
    myWord = null;
    isImpostor = false;
  }

  window.PhoenixImpostorInteractive = {
    build: build,
    close: close,
    onState: onState,
    submitVote: function(votedId) {
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'interact', decision: 'vote:' + votedId }));
      }
    }
  };
})();
