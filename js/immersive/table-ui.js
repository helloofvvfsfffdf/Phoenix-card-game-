/* PHOENIX - the 3D table's furniture: the lobby, the table, and the picker.
 *
 * The 3D room is the stage; this is everything around it that a player has
 * to read or press:
 *
 *   - the connection, and the room it is in
 *   - the lobby: the list of open rooms, the code, and the players in it
 *   - the table: who is playing, what they have scored, whose turn it is
 *   - the picker: who a card should be aimed at, when it needs a target
 *
 * None of it decides anything. Every button here sends exactly what the
 * server already said may be sent, and the table is redrawn from the
 * server's own snapshot every time one arrives.
 */
'use strict';

/** The phases, in the words the game uses. */
const PHASE_WORDS = {
  lobby: 'In the lobby',
  turnDice: 'Rolling for the turn order',
  allyDice: 'Rolling for the ally order',
  draft: 'Choosing an ally',
  playing: 'Playing'
};

function text(node, value) {
  if (node) node.textContent = value === undefined || value === null ? '' : String(value);
}

/**
 * Build the UI.
 *
 * `options`:
 *   root      the document or element to look in
 *   client    the multiplayer client
 *   onPlay    (cardId, targetId) - the player chose a card and a target
 *   onNotice  (message)         - something worth saying out loud
 */
export function createTableUI(options) {
  const settings = Object.assign({
    root: document,
    client: null,
    onPlay: null,
    onNotice: null
  }, options || {});

  const root = settings.root;
  const client = settings.client;

  const nodes = {
    status: root.querySelector('#immersive-net-status'),
    code: root.querySelector('#immersive-room-code'),
    lobby: root.querySelector('#immersive-lobby'),
    codeInput: root.querySelector('#immersive-code'),
    create: root.querySelector('#immersive-create'),
    join: root.querySelector('#immersive-join'),
    leave: root.querySelector('#immersive-leave'),
    start: root.querySelector('#immersive-start'),
    roll: root.querySelector('#immersive-roll'),
    rooms: root.querySelector('#immersive-rooms'),
    players: root.querySelector('#immersive-players'),
    table: root.querySelector('#immersive-table'),
    targets: root.querySelector('#immersive-targets'),
    allies: root.querySelector('#immersive-allies'),
    turn: root.querySelector('#immersive-turn')
  };

  let state = null;
  /** The card that is waiting to be aimed at something. */
  let pendingCard = null;
  /** The targets the server said that card may be aimed at. */
  let pendingTargets = [];

  function notice(message) {
    if (settings.onNotice) settings.onNotice(message);
  }

  /* ---- the connection ---- */

  function setStatus(line, kind) {
    text(nodes.status, line);
    if (nodes.status) nodes.status.dataset.kind = kind || 'info';
  }

  /* ---- the lobby ---- */

  function renderRooms(rooms) {
    if (!nodes.rooms) return;
    nodes.rooms.innerHTML = '';
    if (!rooms || !rooms.length) {
      const empty = document.createElement('p');
      empty.className = 'immersive-rooms-empty';
      empty.textContent = 'No open rooms. Make one.';
      nodes.rooms.appendChild(empty);
      return;
    }
    rooms.forEach(function (room) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'immersive-room';
      button.textContent = room.code + ' - ' + (room.players || 0) + '/' + (room.max || 5);
      button.addEventListener('click', function () {
        if (nodes.codeInput) nodes.codeInput.value = room.code;
        client.joinRoom(room.code);
      });
      nodes.rooms.appendChild(button);
    });
  }

  /* ---- the table: who is playing ---- */

  function renderPlayers() {
    if (!nodes.players) return;
    nodes.players.innerHTML = '';
    if (!state || !state.players || !state.players.length) return;

    const me = state.seat;
    state.players.forEach(function (player, index) {
      const row = document.createElement('li');
      row.className = 'immersive-player';
      if (index === me) row.classList.add('is-me');
      if (state.current && state.current === player.id) row.classList.add('is-turn');
      if (player.eliminated) row.classList.add('is-out');
      if (!player.connected) row.classList.add('is-away');

      const name = document.createElement('span');
      name.className = 'immersive-player-name';
      name.textContent = player.name + (index === me ? ' (you)' : '');
      row.appendChild(name);

      const score = document.createElement('span');
      score.className = 'immersive-player-score';
      score.textContent = String(player.points || 0);
      row.appendChild(score);

      const cards = document.createElement('span');
      cards.className = 'immersive-player-cards';
      cards.textContent = player.handCount + ' cards';
      row.appendChild(cards);

      if (player.ally) {
        const ally = document.createElement('span');
        ally.className = 'immersive-player-ally';
        ally.textContent = player.ally;
        row.appendChild(ally);
      }

      nodes.players.appendChild(row);
    });
  }

  /* ---- the picker: who a card is aimed at ---- */

  function renderTargets() {
    if (!nodes.targets) return;
    nodes.targets.innerHTML = '';
    if (!pendingCard) {
      nodes.targets.hidden = true;
      return;
    }
    nodes.targets.hidden = false;
    const heading = document.createElement('p');
    heading.className = 'immersive-targets-heading';
    heading.textContent = 'Who is ' + pendingCard.name + ' aimed at?';
    nodes.targets.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'immersive-targets-row';
    pendingTargets.forEach(function (target) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'immersive-target';
      button.textContent = target.name;
      button.addEventListener('click', function () {
        const cardId = pendingCard.id;
        const targetId = target.id;
        clearPending();
        if (settings.onPlay) settings.onPlay(cardId, targetId);
      });
      row.appendChild(button);
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'immersive-target is-back';
    back.textContent = 'CANCEL';
    back.addEventListener('click', clearPending);
    row.appendChild(back);
    nodes.targets.appendChild(row);
  }

  function clearPending() {
    pendingCard = null;
    pendingTargets = [];
    renderTargets();
  }

  /**
   * The player chose a card.
   *
   * If the server says the card can be aimed at somebody, the picker is
   * opened with exactly those people on it. If it cannot, the card is
   * played at once. The client never decides which.
   */
  function chooseCard(card) {
    if (!state) return;
    // The moves are the server's, from the snapshot. Nothing here works out
    // what a card may be aimed at.
    const moves = (state.moves || []).filter(function (move) { return move.cardId === card.id; });
    if (!moves.length) {
      notice('You cannot play that card right now.');
      return;
    }
    const aimed = moves.filter(function (move) { return move.targetId; });
    if (!aimed.length) {
      clearPending();
      if (settings.onPlay) settings.onPlay(card.id, null);
      return;
    }
    // The same target can be offered by more than one legal move.
    const seen = {};
    pendingTargets = [];
    aimed.forEach(function (move) {
      if (seen[move.targetId]) return;
      seen[move.targetId] = true;
      const player = (state.players || []).filter(function (p) { return p.id === move.targetId; })[0];
      pendingTargets.push({ id: move.targetId, name: player ? player.name : move.targetId });
    });
    pendingCard = card;
    renderTargets();
  }

  /* ---- the allies, when the game asks for one ---- */

  function renderAllies() {
    if (!nodes.allies) return;
    nodes.allies.innerHTML = '';
    const available = state && state.availableAllies ? state.availableAllies : [];
    if (!available.length) {
      nodes.allies.hidden = true;
      return;
    }
    nodes.allies.hidden = false;
    available.forEach(function (ally) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'immersive-ally';
      button.textContent = ally;
      button.addEventListener('click', function () {
        client.chooseAlly(ally);
      });
      nodes.allies.appendChild(button);
    });
  }

  /* ---- the whole thing, from a snapshot ---- */

  function render() {
    if (!state) return;

    text(nodes.code, state.code ? 'ROOM ' + state.code : '');
    if (nodes.lobby) nodes.lobby.hidden = state.phase !== 'lobby' && !!state.started;
    if (nodes.table) nodes.table.hidden = !state.started;

    const phase = PHASE_WORDS[state.phase] || 'Waiting';
    if (nodes.turn) {
      const who = state.current && (state.players || []).filter(function (p) {
        return p.id === state.current;
      })[0];
      text(nodes.turn, state.over
        ? 'The match is over'
        : phase + (who ? ' - ' + who.name + "'s turn" : ''));
    }

    renderPlayers();
    renderAllies();

    // The buttons that only make sense at a particular moment.
    if (nodes.start) nodes.start.hidden = !(state.phase === 'lobby' && state.host);
    if (nodes.roll) {
      const myTurn = state.phase === 'turnDice' || state.phase === 'allyDice';
      nodes.roll.hidden = !myTurn;
    }
    if (nodes.leave) nodes.leave.hidden = !state.code;
  }

  /* ---- the wiring ---- */

  if (nodes.create) {
    nodes.create.addEventListener('click', function () {
      client.createRoom(nodes.codeInput ? nodes.codeInput.value : '');
    });
  }
  if (nodes.join) {
    nodes.join.addEventListener('click', function () {
      client.joinRoom(nodes.codeInput ? nodes.codeInput.value : '');
    });
  }
  if (nodes.leave) {
    nodes.leave.addEventListener('click', function () {
      client.leave();
      clearPending();
    });
  }
  if (nodes.start) {
    nodes.start.addEventListener('click', function () {
      client.start(10);
    });
  }
  if (nodes.roll) {
    nodes.roll.addEventListener('click', function () {
      client.roll();
    });
  }

  return {
    /** A new snapshot from the server. */
    setState: function (next) {
      state = next;
      render();
    },
    /** The open rooms. */
    setRooms: renderRooms,
    /** The connection. */
    setStatus: setStatus,
    /** The player chose a card. */
    chooseCard: chooseCard,
    /** Whether a card is waiting to be aimed at something. */
    isChoosing: function () { return !!pendingCard; },
    /** Put the picker away. */
    clearPending: clearPending
  };
}
