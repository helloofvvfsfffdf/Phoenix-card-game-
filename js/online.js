
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let socket = null;
  let state = null;

  const names = {
    phoenix: 'Sneaky Snatcher — Steals one random opponent card each round.',
    tilly: 'Trouble Maker — 50% chance to eliminate an opponent for one round. Protective Paws: 40% Phoenix block.',
    ted: 'Slobbery Surprise — 50% chance to hide a random opponent’s cards for 3 rounds. Protective Howl: 60% Phoenix block. Requires 3 or more players; at least 4 recommended for an enjoyable match.',
    louie: 'Puppet Master — 40% chance to control an opponent’s next turn. Quick Reflexes: 80% Phoenix block.',
    simba: 'Card Sabotage — Blocks one opponent card for a round. Sharp Claws: 60% Phoenix block.',
    elsie: 'Untouchable — Blocks Phoenix 100%, Louie 70%, Maple 20%.',
    maple: 'Sweet Tooth — 40% chance to force nice cards for 3 rounds (independent).'
  };

  function hiddenCard(index, clickable) {
    const node = el(clickable ? 'button' : 'div', 'card');
    if (clickable) node.type = 'button';
    node.dataset.tone = 'neutral';
    node.title = 'Ted has hidden this card!';
    node.setAttribute('aria-label', 'Hidden card ' + (index + 1));
    node.append(el('span','card-corner','?'));
    node.append(el('span','card-art','🐶'));
    node.append(el('span','card-name','Card ' + (index + 1)));
    node.append(el('span','card-blurb','Hidden by Ted’s Slobbery Surprise'));
    return node;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Draw a card using the original PHOENIX design.
  function cardFace(card, clickable) {
    const node = el(clickable ? 'button' : 'div', 'card');

    if (clickable) node.type = 'button';

    node.dataset.tone = card.tone;
    node.dataset.card = card.id;
    node.title = (card.rule || '') + ' ' + (card.targetNote || '');
    node.setAttribute(
      'aria-label',
      card.name + '. ' + (card.rule || '')
    );

    const corner = el('span', 'card-corner');
    corner.append(el('span', 'card-corner-glyph', card.glyph));
    corner.append(el('span', 'card-corner-tag', card.short));
    node.append(corner);

    const art = el('span', 'card-art');

    if (card.art) {
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

  function feedback(message) {
    $('online-feedback').textContent = message;
  }

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
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
      feedback('Disconnected from server. Reload to reconnect.');
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

  function join(type) {
    const name = $('online-name').value.trim();

    if (!name) {
      feedback('Enter your player name.');
      return;
    }

    sessionStorage.setItem('phoenix-player-name', name);


    const ownerPassword =
      type === 'create'
        ? $('online-owner-password').value
        : undefined;

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

      if (type === 'create') {
        $('online-owner-password').value = '';
      }
    });
  }

  function render() {
    const s = state;
    if (!s) return;

    $('online-setup').hidden = true;
    $('online-room').hidden = false;
    $('online-room-code').textContent = s.code;

    const currentPlayer =
      s.players.find(p => p.id === s.current);

    $('online-phase').textContent = !s.started
      ? (s.phase === 'lobby' ? `${s.players.length} / 5 players · Minimum 2 to start` : s.phase === 'turnDice' ? 'Stage 1: Roll for turn order' : s.phase === 'allyDice' ? 'Stage 2: Roll for ally draft order' : 'Stage 3: Choose your ally')
      : s.over
        ? 'Match finished'
        : `Round ${s.round} / ${s.rounds} · ${
            currentPlayer ? currentPlayer.name : 'Waiting'
          } is playing`;

    // Player seats
    const seats = $('online-seats');
    seats.replaceChildren();

    s.players.forEach((player, index) => {
      const seat = el(
        'div',
        'online-seat' +
          (s.current === player.id ? ' online-current' : '')
      );

      const picture = el('img', 'online-portrait');
      if (player.ally) picture.src = 'assets/allies/' + player.ally + '.jpg';
      else picture.hidden = true;
      picture.alt = player.ally || 'Not chosen';
      seat.append(picture);

      const meta = el('div', 'online-seat-meta');

      meta.append(el(
        'strong',
        '',
        player.name + (index === s.seat ? ' (you)' : '')
      ));

      meta.append(el(
        'small',
        '',
        player.ally ? player.ally.toUpperCase() + ' · ' + (names[player.ally] || player.ally) : 'Ally not chosen yet'
      ));

      meta.append(el(
        'span',
        '',
        s.started
          ? player.points.toLocaleString() +
              ' points · ' + player.handCount + ' cards'
          : player.connected
            ? 'Connected'
            : 'Disconnected'
      ));

      seat.append(meta);
      seats.append(seat);
    });

    // Match controls
    const actions = $('online-actions');
    actions.replaceChildren();

    if (s.phase === 'turnDice' || s.phase === 'allyDice') {
      const d = s.dice;
      const roller = s.players[d.next];
      actions.append(el('h3', '', s.phase === 'turnDice' ? '🎲 Roll for turn order' : '🎲 Roll for ally draft order'));
      actions.append(el('p', '', roller ? roller.name + ' rolls next.' : 'Calculating order...'));
      if (d.next === s.seat) {
        const roll = el('button','online-primary','ROLL DICE 🎲');
        roll.onclick = () => {roll.disabled=true;send({type:'roll'});};
        actions.append(roll);
      }
      Object.entries(d.rolls).forEach(([i,n])=>actions.append(el('p','',s.players[Number(i)].name+' rolled '+n)));
    } else if (s.phase === 'draft') {
      const picker = s.players[s.draftTurn];
      actions.append(el('h3','','🐾 Ally selection'));
      actions.append(el('p','',picker ? picker.name+' chooses next.' : 'Waiting...'));
      if (s.draftTurn === s.seat) {
        if (s.players.length < 3) {
          const notice = el('p', '', '🔒 Ted requires at least 3 players to select. For a more enjoyable match, 4 or more players are recommended.');
          actions.append(notice);
        }
        s.availableAllies.forEach(id=>{
          const button=el('button','online-primary',id.toUpperCase()+' — '+names[id]);
          const portrait=el('img','online-portrait'); portrait.src='assets/allies/'+id+'.jpg'; portrait.alt=id; button.prepend(portrait);
          button.onclick=()=>{button.disabled=true;send({type:'chooseAlly',ally:id});};
          actions.append(button);
        });
      }
    } else if (!s.started) {
      if (s.host) {
        const start = el(
          'button',
          'online-primary',
          'START MATCH'
        );

        // Keep two-player matches working.
        start.disabled = s.players.length < 2;

        start.onclick = () => {
          send({
            type: 'start',
            rounds: Number($('online-rounds').value)
          });
        };

        actions.append(start);

        if (s.players.length < 2) {
          actions.append(el(
            'p',
            '',
            'Waiting for at least one more player.'
          ));
        }
      } else {
        actions.append(el(
          'p',
          '',
          'Waiting for the host to start the match.'
        ));
      }
    } else if (s.over) {
      actions.append(el('h3', '', 'Match complete!'));

      const winner =
        s.players.find(p => p.id === s.winner);

      actions.append(el(
        'p',
        '',
        winner ? 'Winner: ' + winner.name : 'Game over'
      ));
    } else if (!s.acting) {
      actions.append(el('p', '', 'Waiting for your turn.'));
    } else {
      actions.append(el(
        'h3',
        '',
        s.pending
          ? 'Choose a card'
          : 'Your turn — choose a card'
      ));

      if (!s.moves.length) {
        actions.append(el(
          'p',
          '',
          'No legal moves available.'
        ));
      }

      // Playable cards
      const movesGrid = el('div', 'online-card-grid');

      s.moves.forEach((move, moveIndex) => {
        const card = window.PhoenixCards.byId(move.cardId);
        if (!card) return;

        const target =
          s.players.find(p => p.id === move.targetId);

        const option = el('div', 'online-card-option');
        const button = s.tedObscured ? hiddenCard(s.hand.indexOf(move.cardId) >= 0 ? s.hand.indexOf(move.cardId) : moveIndex, true) : cardFace(card, true);

        button.onclick = () => {
          send({
            type: 'move',
            cardId: move.cardId,
            targetId: move.targetId || null
          });
        };

        option.append(button);

        if (target) {
          option.append(el(
            'span',
            'online-card-target',
            'Target: ' + target.name
          ));
        }

        movesGrid.append(option);
      });

      actions.append(movesGrid);
    }

    // Your private hand
    const hand = $('online-hand');
    hand.replaceChildren();

    if (s.started) {
      hand.append(el('h3', '', 'Your private hand'));

      const handGrid = el(
        'div',
        'online-card-grid online-private-cards'
      );

      s.hand.forEach((id, index) => {
        const card = window.PhoenixCards.byId(id);

        if (card) {
          handGrid.append(s.tedObscured ? hiddenCard(index, false) : cardFace(card, false));
        } else {
          handGrid.append(el('span', 'online-card', id));
        }
      });

      hand.append(handGrid);
    }

    // Match history
    const log = $('online-log');
    log.replaceChildren();

    s.log.slice(-18).forEach(message => {
      log.append(el('li', '', message));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Multiplayer allies are drafted after the dice ceremony, not at the main menu.
    $('menu-multi').addEventListener('click', event => {
      event.stopImmediatePropagation();
      enter();
    }, true);
    $('online-back').onclick = leave;
    $('online-create').onclick = () => join('create');
    $('online-join').onclick = () => join('join');

    $('online-copy').onclick = () => {
      if (!state) return;

      navigator.clipboard.writeText(state.code)
        .then(() => feedback('Invite code copied!'))
        .catch(() => feedback('Invite code: ' + state.code));
    };

    document.addEventListener(
      'phoenix-ally-confirmed',
      event => {
        if (event.detail.mode === 'multi') {
          enter();
        }
      }
    );
  });
})();
