/*
 * PHOENIX - js/online-client.js
 * ---------------------------------------------------------------------------
 * The browser half of online multiplayer. Everything the player does in a real
 * match goes through here and is decided by the server: this file renders the
 * state it is sent and sends back the player's choice. It never decides a rule.
 *
 * WHY THIS USED TO BE WRONG
 * -------------------------
 * The Multiplayer button did nothing at all, and this file is most of why.
 * There are two separate faults, and both had to be fixed for a match to be
 * playable:
 *
 *   1. Nothing was wired to open the lobby. This file was committed at the repo
 *      root as "rules.js" - a name that collided with the real engine, js/rules.js -
 *      and index.html never loaded it. So `#online-screen` existed in the markup
 *      with nothing behind it.
 *
 *   2. It was a whole generation behind the server. It asked the player for an
 *      ally BEFORE creating a room and sent that ally with the join request, but
 *      server.js ignores that field: it runs lobby -> turnDice -> allyDice ->
 *      draft -> playing, and the ally is drafted in-match from the server's own
 *      list, with duplicates refused. The old flow therefore asked for a choice
 *      that was thrown away, and then had no way to roll dice or draft at all, so
 *      a match would have stalled forever at the first dice.
 *
 * So ally selection now happens where the server actually does it, and this file
 * speaks all four phases. server.js is unchanged.
 *
 * PROTOCOL (see server.js)
 * ------------------------
 * In:  create | join | start | roll | chooseAlly | move
 * Out: state (a snapshot) | error
 *
 * The snapshot's `phase` says which screen to draw, and the server recomputes it
 * on every broadcast, so this file never guesses at the phase from what it sent.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let socket = null;
  let state = null;

  // Display titles for the draft picker. The server owns WHICH allies exist and
  // which are still available; these are only labels, so a mismatch can never
  // offer something the server would refuse.
  const titles = {
    phoenix: 'Sneaky Snatcher',
    tilly: 'Trouble Maker',
    ted: 'Slobbery Surprise',
    louie: 'Puppet Master',
    simba: 'Card Sabotage',
    elsie: 'Untouchable'
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function feedback(message) {
    $('online-feedback').textContent = message;
  }

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
      return true;
    }
    feedback('Not connected to the server yet.');
    return false;
  }

  function connect(callback) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      callback();
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(protocol + '//' + location.host);

    socket.onopen = callback;
    socket.onerror = () =>
      feedback('Could not connect to the multiplayer server.');

    socket.onclose = () => {
      state = null;
      feedback('Disconnected from the server. Reload to reconnect.');
      $('online-actions').replaceChildren();
    };

    socket.onmessage = event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'error') {
        feedback(message.message);
      } else if (message.type === 'state') {
        state = message;
        render();
      }
    };
  }

  /** Opens the lobby. This is the only entry point the main menu needs. */
  function enter() {
    $('phoenix-menu').hidden = true;
    $('ally-picker').hidden = true;
    $('online-screen').hidden = false;
    $('online-setup').hidden = false;
    $('online-room').hidden = true;
    $('online-name').value =
      sessionStorage.getItem('phoenix-player-name') || '';
    feedback('Create a room or join with an invite code.');
  }

  function leave() {
    if (socket) socket.close();
    socket = null;
    state = null;
    $('online-screen').hidden = true;
    $('phoenix-menu').hidden = false;
  }

  /**
   * Creates a room, or joins one with an invite code.
   *
   * There is deliberately NO ally field here. The server drafts allies after the
   * dice, and it ignores anything sent now - so asking for one at this point
   * would be asking for a choice that is thrown away.
   */
  function join(type) {
    const name = $('online-name').value.trim();

    if (!name) {
      feedback('Enter your player name.');
      return;
    }

    sessionStorage.setItem('phoenix-player-name', name);

    const ownerPassword =
      type === 'create' ? $('online-owner-password').value : undefined;

    if (type === 'create' && !ownerPassword) {
      feedback('Enter your owner password.');
      return;
    }

    connect(() => {
      send({
        type,
        name,
        code: $('online-code-input').value.trim(),
        ...(type === 'create' ? { ownerPassword } : {})
      });

      if (type === 'create') $('online-owner-password').value = '';
    });
  }

  /* --------------------------------------------------------------------- */
  /* Phases                                                                  */
  /* --------------------------------------------------------------------- */

  /** The seat index the dice are currently waiting on, or null. */
  function diceTurn() {
    return state.dice && typeof state.dice.next === 'number'
      ? state.dice.next
      : null;
  }

  function renderDice() {
    const actions = $('online-actions');
    const waiting = diceTurn();

    actions.append(el(
      'h3',
      '',
      state.phase === 'turnDice'
        ? 'Rolling for turn order'
        : 'Rolling for ally draft order'
    ));

    actions.append(el(
      'p',
      '',
      'Highest roll goes first. Ties are rerolled.'
    ));

    // Every player's roll so far, so the group being decided is visible rather
    // than hidden behind whoever's turn it happens to be.
    state.players.forEach((player, index) => {
      const value = state.dice.rolls[index];
      const line = el('div', 'online-seat' + (index === waiting ? ' online-current' : ''));
      line.append(el('strong', '', player.name + (index === state.seat ? ' (you)' : '')));
      line.append(el('span', '', value ? 'rolled ' + value : 'not rolled yet'));
      actions.append(line);
    });

    if (waiting === state.seat) {
      const roll = el('button', 'online-primary', 'ROLL');
      roll.type = 'button';
      roll.onclick = () => send({ type: 'roll' });
      actions.append(roll);
    } else if (waiting !== null) {
      actions.append(el('p', '', 'Waiting for ' + state.players[waiting].name + ' to roll.'));
    }
  }

  function renderDraft() {
    const actions = $('online-actions');
    const mine = state.draftTurn === state.seat;

    actions.append(el('h3', '', 'Ally draft'));

    if (mine) {
      actions.append(el('p', '', 'Choose your ally. Each ally can only be taken once.'));

      state.availableAllies.forEach(id => {
        const button = el('button', 'online-move', id.toUpperCase() + (titles[id] ? ' — ' + titles[id] : ''));
        button.type = 'button';
        button.onclick = () => send({ type: 'chooseAlly', ally: id });
        actions.append(button);
      });

      if (!state.availableAllies.length) {
        actions.append(el('p', '', 'No allies left to choose.'));
      }
      return;
    }

    const waiting = state.players[state.draftTurn];
    actions.append(el(
      'p',
      '',
      'Waiting for ' + (waiting ? waiting.name : 'the next player') + ' to choose an ally.'
    ));
  }

  function renderLobby() {
    const actions = $('online-actions');
    actions.replaceChildren();

    if (state.host) {
      const start = el('button', 'online-primary', 'START MATCH');
      start.type = 'button';
      // The server decides whether the table is big enough, so the button is
      // never disabled here - it says what is missing instead of going dead.
      start.onclick = () => send({
        type: 'start',
        rounds: Number($('online-rounds').value)
      });
      actions.append(start);

      if (state.players.length < 2) {
        actions.append(el('p', '', 'Waiting for at least one more player.'));
      }
    } else {
      actions.append(el('p', '', 'Waiting for the host to start the match.'));
    }
  }

  function renderPlaying() {
    const actions = $('online-actions');
    actions.replaceChildren();

    if (state.over) {
      actions.append(el('h3', '', 'Match complete!'));
      const winner = state.players.find(p => p.id === state.winner);
      actions.append(el('p', '', winner ? 'Winner: ' + winner.name : 'Game over'));
      return;
    }

    if (!state.acting) {
      actions.append(el('p', '', 'Waiting for your turn.'));
      return;
    }

    actions.append(el(
      'h3',
      '',
      state.pending ? 'Choose a card' : 'Your turn — choose a card'
    ));

    if (!state.moves.length) {
      actions.append(el('p', '', 'No legal moves available.'));
    }

    // Each legal move is its own button. The server already resolved every legal
    // card/target pair into `moves`, so two buttons with the same card are two
    // different targets and neither is a guess.
    state.moves.forEach(move => {
      const card = window.PhoenixCards.byId(move.cardId);
      if (!card) return;

      const target = move.targetId
        ? state.players.find(p => p.id === move.targetId)
        : null;

      const button = el(
        'button',
        'online-move',
        (card.glyph || '') + ' ' + card.name + (target ? ' → ' + target.name : '')
      );
      button.type = 'button';
      button.onclick = () => send({ type: 'move', cardId: move.cardId, targetId: move.targetId || null });
      actions.append(button);
    });
  }

  function render() {
    const s = state;
    if (!s) return;

    $('online-setup').hidden = true;
    $('online-room').hidden = false;
    $('online-room-code').textContent = s.code;

    const current = s.players.find(p => p.id === s.current);

    const phaseText = {
      lobby: `${s.players.length} / 5 players · Minimum 2 to start`,
      turnDice: 'Rolling for turn order',
      allyDice: 'Rolling for ally draft order',
      draft: 'Choosing allies',
      playing: s.over
        ? 'Match finished'
        : `Round ${s.round} / ${s.rounds} · ${current ? current.name : 'Waiting'} is playing`
    };

    $('online-phase').textContent = phaseText[s.phase] || s.phase;

    renderSeats();

    if (s.phase === 'lobby') renderLobby();
    else if (s.phase === 'turnDice' || s.phase === 'allyDice') renderDice();
    else if (s.phase === 'draft') renderDraft();
    else renderPlaying();

    renderHand();
    renderLog();
  }

  function renderSeats() {
    const seats = $('online-seats');
    seats.replaceChildren();

    state.players.forEach((player, index) => {
      const seat = el('div', 'online-seat' + (state.current === player.id ? ' online-current' : ''));

      // No ally until the draft assigns one, so the portrait waits for it. A
      // broken image icon on every seat would look like a bug rather than a
      // phase the game has not reached yet.
      if (player.ally) {
        const picture = el('img', 'online-portrait');
        picture.src = 'assets/allies/' + player.ally + '.jpg';
        picture.alt = player.ally;
        seat.append(picture);
      }

      const meta = el('div', 'online-seat-meta');
      meta.append(el('strong', '', player.name + (index === state.seat ? ' (you)' : '')));

      meta.append(el(
        'small',
        '',
        player.ally
          ? player.ally.toUpperCase() + (titles[player.ally] ? ' — ' + titles[player.ally] : '')
          : 'Ally not chosen yet'
      ));

      meta.append(el('span', '', state.started
        ? player.points.toLocaleString() + ' points · ' + player.handCount + ' cards'
        : player.connected ? 'Connected' : 'Disconnected'));

      if (state.started && player.eliminated) {
        meta.append(el('small', '', 'Eliminated this round'));
      }
      if (player.hunter) {
        meta.append(el('small', '', 'Hunter'));
      }

      seat.append(meta);
      seats.append(seat);
    });
  }

  function renderHand() {
    const hand = $('online-hand');
    hand.replaceChildren();

    if (!state.started) return;

    hand.append(el('h3', '', 'Your private hand'));

    state.hand.forEach(id => {
      const card = window.PhoenixCards.byId(id);
      hand.append(el('span', 'online-card', card ? (card.glyph || '') + ' ' + card.name : id));
    });
  }

  function renderLog() {
    const log = $('online-log');
    log.replaceChildren();

    state.log.slice(-18).forEach(message => {
      log.append(el('li', '', message));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('online-back').onclick = leave;
    $('online-create').onclick = () => join('create');
    $('online-join').onclick = () => join('join');

    $('online-copy').onclick = () => {
      if (!state) return;
      navigator.clipboard.writeText(state.code)
        .then(() => feedback('Invite code copied!'))
        .catch(() => feedback('Invite code: ' + state.code));
    };
  });

  window.PhoenixOnline = { enter, leave };
})();