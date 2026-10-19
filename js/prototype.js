(function () {
  'use strict';
  var mode = 'menu';
  var botAllies = {};
  var testerState = null;
  function $(id) { return document.getElementById(id); }
  function game() { return window.phoenix && window.phoenix.game; }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function enter(nextMode) {
    mode = nextMode;
    document.body.classList.toggle('phoenix-testing-mode', mode === 'test');
    $('phoenix-menu').hidden = true;
    $('phoenix-game').hidden = false;
    $('game-toolbar').hidden = false;
    $('testing-panel').hidden = mode !== 'test';
    $('game-mode-label').textContent = mode === 'test' ? 'Multiplayer Testing · Local pass-and-play' : 'Single Player · Creator Only';
    if (mode === 'test') {
      window.phoenix.newGame();
      $('testing-feedback').textContent = 'Local test match started. Only you control the players.';
      renderTest();
    }
    if (window.PhoenixMusicPlayer) window.PhoenixMusicPlayer.setMatchActive('local', !!game() && !!game().state && !game().state.over);
  }
  function leave() {
    if (window.PhoenixCinematics) window.PhoenixCinematics.cleanup();
    mode = 'menu';
    document.body.classList.remove('phoenix-testing-mode');
    $('phoenix-menu').hidden = false;
    $('ally-picker').hidden = true;
    $('phoenix-game').hidden = true;
    $('game-toolbar').hidden = true;
    $('testing-panel').hidden = true;
    $('win-screen').hidden = true;
    if (window.PhoenixMusicPlayer) window.PhoenixMusicPlayer.setMatchActive('local', false);
  }
  function renderTest() {
    if (mode !== 'test' || !game()) return;
    var g = game(), state = g.state;
    if (state !== testerState) { testerState = state; botAllies = {}; state.players.forEach(function(p){ if (!p.isHuman) botAllies[p.id] = window.PhoenixAllies.random(); }); }
    var root = $('testing-cards'), status = $('testing-status');
    var scores = $('testing-scores');
    root.replaceChildren();
    scores.replaceChildren();
    state.players.forEach(function (player) {
      var seat = element('div', 'testing-seat');
      if (!state.over && state.players[state.turnInRound].id === player.id) seat.classList.add('is-current');
      var ally = botAllies[player.id] || window.PhoenixAllies.selected();
      seat.appendChild(element('strong', 'testing-original-name', player.name));
      if (ally) { seat.appendChild(element('span', '', 'Ally: '+ally.name.charAt(0)+ally.name.slice(1).toLowerCase())); seat.appendChild(element('small', 'testing-ally-title', ally.title)); seat.appendChild(element('small', 'testing-ally-description', ally.desc)); }
      seat.appendChild(element('span', '', player.points + ' points'));
      var count = state.hands && state.hands[player.id] ? state.hands[player.id].length : 0;
      seat.appendChild(element('small', '', count + ' cards'));
      scores.appendChild(seat);
    });
    if (state.over) {
      status.textContent = 'Match finished · Start a New Game to test again.';
      root.appendChild(element('p', '', 'The match is over. See the results above.'));
      return;
    }
    var choice = g.isAwaitingChoice() && g.isChoiceDue();
    var pending = choice ? g.pendingChoice() : null;
    var seatIndex = state.turnInRound, player = state.players[seatIndex];
    status.textContent = choice ? ('Decision for ' + pending.chooserName + ' · ' + pending.kind + ' · Round ' + state.round) : ('Round ' + state.round + ' / ' + state.rounds + ' · ' + player.name + "'s turn");
    var moves = choice ? pending.options : window.PhoenixRules.legalMoves(state, seatIndex);
    if (!moves.length) {
      root.appendChild(element('p', '', 'No legal moves available.'));
      return;
    }
    moves.forEach(function (move) {
      var card = window.PhoenixCards.byId(move.cardId);
      if (!card) return;
      var button = element('button', 'testing-move');
      button.type = 'button';
      button.appendChild(element('strong', '', card.name));
      var art=element('span','art');
      if(window.PhoenixCardCinematicArt)art.innerHTML=window.PhoenixCardCinematicArt.icon(card.id);else art.textContent=card.glyph || '✦';
      art.setAttribute('aria-hidden','true');button.appendChild(art);
      var target = move.targetId ? window.PhoenixRules.playerById(state, move.targetId) : null;
      button.appendChild(element('small', '', target ? 'Target: ' + target.name : (card.blurb || 'Play this card')));
      button.addEventListener('click', function () {
        var result;
        if (choice) {
          result = g.playForcedChoice(move.cardId, move.targetId);
        } else if (player.isHuman) {
          result = g.playHuman(move.cardId, move.targetId);
        } else {
          var reply = 'PLAY: ' + window.PhoenixRules.formatCard(move.cardId);
          if (target) reply += '\nTARGET: ' + target.name;
          result = g.submitAiMove(reply);
        }
        $('testing-feedback').textContent = result.ok ? (player.name + ' played ' + card.name + (target ? ' on ' + target.name : '') + '.') : (result.error || 'Move rejected.');
        window.phoenix.render();
        renderTest();
      });
      root.appendChild(button);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('menu-single').addEventListener('click', function () { window.PhoenixModeAccess.request('single'); });
    $('menu-test').addEventListener('click', function () { window.PhoenixModeAccess.request('test'); });
    $('back-to-menu').addEventListener('click', leave);

    // Note: the legacy ally picker is NOT used anymore - not for the online
    // lobby (allies are drafted in-match after the dice) and not for the local
    // tester either (the human seat keeps the currently selected ally and bots
    // draw a random one). Both single player and Multiplayer Testing go straight
    // into their match once the access code unlocks them.
    document.addEventListener('phoenix-mode-unlocked', function(event) { if(event.detail.mode==='single') enter('single'); else if(event.detail.mode==='test') enter('test'); });
    $('menu-multi').addEventListener('click', function () {
      window.PhoenixOnline.enter();
    });

    // Settings is no longer a stub - it opens the background music screen.
    $('menu-settings').addEventListener('click', function () {
      window.PhoenixMusicSettings.open();
    });
    $('menu-cinematics').addEventListener('click', function () {
      window.location.href = 'card-effects.html';
    });

    ['menu-cards'].forEach(function (id) {
      $(id).addEventListener('click', function () {
        window.location.href = 'card-effects.html';
      });
    });
    ['btn-new', 'btn-play-again'].forEach(function (id) {
      $(id).addEventListener('click', function () {
        if (mode === 'test') {
          $('testing-feedback').textContent = 'New local test match started.';
          renderTest();
        }
      });
    });
    leave();
  });
  window.PhoenixLocalAllies = {forPlayer:function(id,state) {
    var player=state && state.players.find(function(p){return p.id===id;});
    return player && player.isHuman ? window.PhoenixAllies.selected() : state===testerState ? botAllies[id] || null : null;
  }};
})();
