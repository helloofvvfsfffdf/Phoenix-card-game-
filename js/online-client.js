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

  /**
   * Everything the game already knows about one ally: name, title, description,
   * portrait and colour.
   *
   * Read from js/allies.js - the same catalogue the main menu's ally picker draws
   * from, already on the page as window.PhoenixAllies. That file is the single
   * source of truth for what an ally does, so the draft shows the game's own
   * wording rather than a second copy that could drift away from it. This file
   * used to carry its own hardcoded title table, which is exactly how one ally
   * ends up described two different ways on the same screen.
   *
   * The server still owns WHICH allies are offered; this only describes the id it
   * sent, so it can never offer something the server would refuse.
   *
   * @returns {?{name: string, title: string, desc: string, color: string, src: string}}
   */
  function allyInfo(id) {
    var allies = window.PhoenixAllies;
    if (!allies) return null;

    var all = (allies.roster || []).slice();

    // Maple is not drafted - the server never sends her id - but she is in the
    // same catalogue, so including her means a description exists if that changes.
    if (allies.maple) all.push(allies.maple);

    var found = all.filter(function (a) { return a.id === id; })[0];
    if (!found) return null;

    return {
      name: found.name || id.toUpperCase(),
      title: found.title || '',
      desc: found.desc || '',
      color: found.color || '',
      src: found.src || ('assets/allies/' + id + '.jpg')
    };
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /**
   * A real PHOENIX card face.
   *
   * Restored from the previous client (commit a66b491), which built the same
   * markup this file now builds. The important part is the class: `card`, with
   * `data-tone` carrying the card's tone. That is what css/styles.css styles,
   * so a card drawn here is the same artwork, colour, corner tag, blurb and
   * legendary badge a single-player card gets - because it is literally the same
   * markup and the same stylesheet. Replacing this with a text span is what made
   * the multiplayer cards look unbranded.
   *
   * @param card the card definition from PhoenixCards.byId
   * @param clickable true for a button the player can act on
   */
  function cardFace(card, clickable) {
    const node = el(clickable ? 'button' : 'div', 'card');

    if (clickable) node.type = 'button';

    node.dataset.tone = card.tone;
    node.dataset.card = card.id;
    node.title = (card.rule || '') + ' ' + (card.targetNote || '');
    node.setAttribute('aria-label', card.name + '. ' + (card.rule || ''));

    const corner = el('span', 'card-corner');
    corner.append(el('span', 'card-corner-glyph', card.glyph));
    corner.append(el('span', 'card-corner-tag', card.short));
    node.append(corner);

    const art = el('span', 'card-art');

    if (card.art) {
      // Static markup authored in cards.js, not anything typed in.
      art.innerHTML = card.art;

      const svg = art.querySelector('svg');
      if (svg) {
        svg.classList.add('card-art-art');
        svg.setAttribute('focusable', 'false');
      }
    } else {
      art.append(el('span', 'card-glyph', card.glyph));
    }

    node.append(art);
    node.append(el('span', 'card-name', card.name));
    node.append(el('span', 'card-blurb', card.blurb));

    node.append(el(
      'span',
      'card-tag',
      card.legendary
        ? 'Legendary - one use'
        : card.needsTarget
          ? 'Needs a target'
          : 'No target'
    ));

    return node;
  }

  /**
   * A card behind Ted's fog.
   *
   * Slobbery Surprise is a handicap laid ON the victim: they keep holding the
   * cards, they just cannot see what they are and have to choose by position.
   * The server sends the real hand and flags `tedObscured` on the victim's own
   * connection, and this is that flag being honoured - the whole cost of the
   * ability, and the reason the victim is in trouble until it wears off.
   */
  function hiddenCard(index) {
    const node = el('div', 'card');

    node.dataset.tone = 'neutral';
    node.title = 'Ted has hidden this card!';
    node.setAttribute('aria-label', 'Hidden card ' + (index + 1));

    node.append(el('span', 'card-corner', '?'));
    node.append(el('span', 'card-art', '\u{1F436}'));
    node.append(el('span', 'card-name', 'Card ' + (index + 1)));
    node.append(el('span', 'card-blurb', 'Hidden by Ted\u2019s Slobbery Surprise'));

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

    // CLEARED FIRST, every time. The server broadcasts a fresh snapshot on every
    // single roll, so a phase that only appends draws a new copy of its heading
    // and its player list on top of the last one - which is how two "Rolling for
    // turn order" headings and a stack of dice rows end up on screen at once.
    // Every phase renderer clears here, so only the current one is ever visible.
    actions.replaceChildren();

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

    // Cleared first for the same reason as the dice phases: every draft broadcast
    // would otherwise stack another "Ally draft" heading and another set of
    // buttons underneath the last one.
    actions.replaceChildren();

    actions.append(el('h3', '', 'Ally draft'));

    if (mine) {
      actions.append(el('p', '', 'Choose your ally. Each ally can only be taken once.'));

      // A grid, because these carry a description now and a full-width stack of
      // five tall tiles reads as a wall. auto-fill does the resizing, so the same
      // markup is three across on a desktop and one on a phone.
      const grid = el('div', 'online-draft-grid');

      // The portrait, the name AND what the ally actually does. The draft is the one
      // moment the player picks, and choosing between seven animals on sight alone
      // means guessing. The description is the game's own wording from
      // js/allies.js, so it cannot disagree with the rest of the game.
      state.availableAllies.forEach(id => {
        const info = allyInfo(id);
        const button = el('button', 'online-draft-choice');

        if (info && info.color) button.style.setProperty('--ally-color', info.color);

        const picture = el('img', 'online-portrait');
        picture.src = info ? info.src : ('assets/allies/' + id + '.jpg');
        picture.alt = info ? info.name : id;
        button.append(picture);

        button.append(el('strong', '', info ? info.name : id.toUpperCase()));
        if (info && info.title) button.append(el('small', '', info.title));
        if (info && info.desc) button.append(el('p', 'online-draft-desc', info.desc));

        button.type = 'button';
        button.onclick = () => send({ type: 'chooseAlly', ally: id });
        grid.append(button);
      });

      actions.append(grid);

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

  /**
 * Maple's Sweet Tooth, shown to whoever it was laid on.
 *
 * Called before the acting check, so a restricted player reads it while they are
 * WAITING too - the restriction lasts three rounds and most of that is spent not
 * being their turn. It says which cards are off the menu, because a hand that
 * quietly stops offering Zombie reads as a bug rather than as an Ally.
 *
 * The server refuses those moves whatever a client sends; this is the honest
 * version of that, not the thing enforcing it.
 */
function renderMapleNotice(actions) {
  const names = state.mapleBlocked
    .map(id => {
      const card = window.PhoenixCards.byId(id);
      return card ? card.name : id;
    })
    .join(', ');

  actions.append(el('p', 'online-restricted',
    '🍁 Maple’s Sweet Tooth: nice cards only for 3 rounds. Not for now: ' + names + '.'
  ));
}

function renderPlaying() {
    const actions = $('online-actions');
    actions.replaceChildren();

    if (state.over) {
      // The victory screen, restored from the previous client (commit a66b491).
      //
      // Its CSS - .phoenix-victory, .phoenix-champion, .phoenix-victory-ally,
      // .phoenix-victory-trophy, .phoenix-victory-display and
      // .phoenix-victory-standings - was never removed from css/online.css, so
      // nothing new had to be styled: this is the original markup, and it lands
      // on the original theme.
      //
      // It is drawn here, inside the actions area, for EVERY connected player. The
      // snapshot carries `over` and `winner` for all of them, so the screen is
      // per-connection state rather than something only the winner is told about.
      const winner = state.players.find(p => p.id === state.winner);
      const victory = el('div', 'phoenix-victory');

      victory.append(el('h1', '', '\u{1F3C6} VICTORY! \u{1F3C6}'));

      if (winner) {
        const champion = el('div', 'phoenix-champion');

        const photo = el('img', 'phoenix-victory-ally');
        // Same path as everywhere else: assets/allies/<id>.jpg, from the id the
        // server sent. No filename invented here.
        photo.src = 'assets/allies/' + winner.ally + '.jpg';
        photo.alt = winner.ally + ' the winning ally';

        const trophy = el('div', 'phoenix-victory-trophy', '\u{1F3C6}');
        const display = el('div', 'phoenix-victory-display');
        display.append(photo, trophy);
        champion.append(display);

        champion.append(el(
          'h2',
          '',
          winner.name + ' & ' + (winner.ally || '').toUpperCase() + ' WON!'
        ));

        champion.append(el(
          'p',
          '',
          winner.points.toLocaleString() + ' POINTS'
        ));

        victory.append(champion);
      }

      const standings = el('div', 'phoenix-victory-standings');
      standings.append(el('h3', '', 'FINAL LEADERBOARD'));

      [...state.players]
        .sort((a, b) => b.points - a.points)
        .forEach((player, index) => {
          const medal = ['\u{1F947}', '\u{1F948}', '\u{1F949}'][index] || '\u{1F3C5}';

          standings.append(el(
            'p',
            '',
            medal + ' ' + player.name +
            ' & ' +
            (player.ally || 'No ally').toUpperCase() +
            ' — ' +
            player.points.toLocaleString() +
            ' points'
          ));
        });

      victory.append(standings);
      actions.append(victory);
      return;
    }

    // A restricted player reads this whatever else is on screen - including while
    // they are only waiting, which is most of the three rounds it lasts.
    if (state.mapleBlocked && state.mapleBlocked.length) {
      renderMapleNotice(actions);
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
    } else {
      // One button per PLAYABLE CARD, drawn as the real card face. The server has
      // already resolved every legal card/target pair into `moves`, so the player
      // picks the card they want and then the target, instead of being shown the
      // same face once per legal target.
      const grid = el('div', 'online-card-grid');
      const cardIds = [...new Set(state.moves.map(move => move.cardId))];

      cardIds.forEach(cardId => {
        const card = window.PhoenixCards.byId(cardId);
        if (!card) return;

        // Maple took this one off the menu. Drawn greyed and unclickable rather
        // than hidden, so the restriction is visible rather than mysterious - the
        // same treatment a blocked card gets anywhere else.
        if (state.mapleBlocked && state.mapleBlocked.indexOf(cardId) !== -1) {
          const blockedFace = cardFace(card, false);
          blockedFace.classList.add('online-blocked');
          blockedFace.title = 'Maple will not let you play this - nice cards only.';
          grid.append(blockedFace);
          return;
        }

        const button = cardFace(card, true);

        button.onclick = () => {
          const possible = state.moves.filter(move => move.cardId === cardId);

          // Whether to ask for a target comes from the MOVES, not from the card.
          //
          // Reading it off the card is what deadlocked an Alvin burn. When Alvin
          // resolves, the server owes ITS CASTER a choice of which card to destroy,
          // and it sends those options as plain moves with no target - but the card
          // being burned might itself be an aimed one (Alvin, Zombie, Knife, Trick,
          // Curse, Steal Points). Asking for a target then offered a picker with
          // nothing in it, and the chooser could neither answer nor back out, so the
          // match stopped dead with the server waiting on them.
          //
          // A move with no targetId means there is nothing to aim at, whatever the
          // card says on its own.
          const aimsSomewhere = possible.some(move => move.targetId);

          if (!aimsSomewhere) {
            send({ type: 'move', cardId, targetId: null });
            return;
          }

          // Swap the grid for a target picker, so the same card is not drawn once
          // per possible victim.
          grid.replaceChildren();
          grid.append(el('h3', '', '\u{1F3AF} Pick your target for ' + card.name));

          const targets = el('div', 'online-card-grid');

          possible.forEach(move => {
            if (!move.targetId) return;

            const player = state.players.find(p => p.id === move.targetId);
            if (!player) return;

            const targetButton = el('button', 'online-primary', player.name);
            targetButton.type = 'button';
            targetButton.onclick = () => {
              // Lock the choices so a double click cannot play two moves.
              targets.querySelectorAll('button').forEach(b => { b.disabled = true; });
              send({ type: 'move', cardId, targetId: move.targetId });
            };
            targets.append(targetButton);
          });

          grid.append(targets);

          const back = el('button', '', '\u{2190} Back to cards');
          back.type = 'button';
          back.onclick = render;
          grid.append(back);
        };

        grid.append(button);
      });

      actions.append(grid);
    }
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

    // Both piles, for EVERY player.
    //
    // This is deliberately outside the branch above rather than inside the
    // acting branch: a player waiting for their turn still needs to see how many
    // cards are left and what was played last. The previous client drew them from
    // render() and every seat saw them, which is the behaviour being restored.
    // renderPiles() no-ops until the match has actually started.
    renderPiles();

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

      const info = player.ally ? allyInfo(player.ally) : null;

      meta.append(el(
        'small',
        '',
        player.ally
          ? (info ? info.name : player.ally.toUpperCase()) +
            (info && info.title ? ' — ' + info.title : '')
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

    // A grid of real card faces, not a list of words. Ted's fog wins over
    // everything: if the server says this hand is concealed, no card in it is
    // drawn, whatever it actually is.
    const grid = el('div', 'online-card-grid online-private-cards');

    state.hand.forEach((id, index) => {
      const card = window.PhoenixCards.byId(id);

      if (!card) {
        grid.append(el('span', 'online-card', id));
        return;
      }

      // Ted's fog wins over everything. While it is up the victim sees numbered
      // positions instead of their own cards - that blindness IS the ability, not
      // a bug, and it lasts until the fog's round is up. The position number is
      // kept because they still choose by position while it lasts.
      grid.append(state.tedObscured ? hiddenCard(index) : cardFace(card, false));
    });

    hand.append(grid);
  }

  /**
   * The pickup (draw) pile and the discard pile.
   *
   * Restored from the previous client. The server has always sent `deckCount`,
   * `discardCount` and `lastDiscard` in every snapshot - this client simply
   * never read them, which is why the piles were not on screen at all.
   *
   * Nothing here draws a card or changes the game. Cards are dealt and discarded
   * by the server; this only reports what the server says and shows the real
   * face of the most recently discarded card, which is why it uses cardFace()
   * rather than naming it.
   */
  function renderPiles() {
    const s = state;
    if (!s.started) return;

    const piles = el('div', 'phoenix-piles');

    // Pickup pile - cards are dealt from here automatically, so there is nothing
    // to click. It exists to answer "how many are left".
    const pickup = el('div', 'phoenix-pile');
    pickup.append(el('h3', '', '\u{1F0CF} PICKUP PILE'));

    const pickupCard = el('div', 'card phoenix-pile-card');
    pickupCard.append(el('span', 'card-art', '\u{1F98E}'));
    pickupCard.append(el('span', 'card-name', 'PHOENIX'));
    pickup.append(pickupCard);

    pickup.append(el('p', '', s.deckCount + ' cards remaining'));
    piles.append(pickup);

    // Discard pile - the actual card on top, drawn with its real design.
    const discard = el('div', 'phoenix-pile');
    discard.append(el('h3', '', '\u{1F0B4} DISCARD PILE'));

    const lastCard = s.lastDiscard ? window.PhoenixCards.byId(s.lastDiscard) : null;

    if (lastCard) {
      const discardCard = cardFace(lastCard, false);
      discardCard.classList.add('phoenix-pile-card');
      discard.append(discardCard);
    } else {
      const empty = el('div', 'card phoenix-pile-card');
      empty.append(el('span', 'card-art', '\u{1F43E}'));
      empty.append(el('span', 'card-name', 'NO CARDS YET'));
      discard.append(empty);
    }

    discard.append(el('p', '', s.discardCount + ' cards discarded'));
    piles.append(discard);

    $('online-actions').append(piles);
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