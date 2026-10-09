
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let socket = null;
  let state = null;

  const names = {
    phoenix: 'The Legendary Inferno',
    tilly: 'The Chaos Queen',
    maple: 'The Fearless Shadow',
    louie: 'The Midnight Trickster',
    simba: 'The Ginger Phantom',
    elsie: 'The Ancient Empress'
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
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
    socket.onerror = () => feedback('Could not connect to the multiplayer server.');
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

    const selected = window.PhoenixAllies.selected();
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
        ally: selected.id,
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

    const currentPlayer = s.players.find(p => p.id === s.current);

    $('online-phase').textContent = !s.started
      ? `${s.players.length} / 5 players · Minimum 2 to start`
      : s.over
        ? 'Match finished'
        : `Round ${s.round} / ${s.rounds} · ${
            currentPlayer ? currentPlayer.name : 'Waiting'
          } is playing`;

    const seats = $('online-seats');
    seats.replaceChildren();

    s.players.forEach((player, index) => {
      const seat = el(
        'div',
        'online-seat' +
          (s.current === player.id ? ' online-current' : '')
      );

      const picture = el('img', 'online-portrait');
      picture.src = 'assets/allies/' + player.ally + '.jpg';
      picture.alt = player.ally;
      seat.append(picture);

      const meta = el('div', 'online-seat-meta');

      meta.append(
        el(
          'strong',
          '',
          player.name + (index === s.seat ? ' (you)' : '')
        )
      );

      meta.append(
        el(
          'small',
          '',
          player.ally.toUpperCase() + ' · ' +
            (names[player.ally] || player.ally)
        )
      );

      meta.append(
        el(
          'span',
          '',
          s.started
            ? player.points.toLocaleString() +
                ' points · ' + player.handCount + ' cards'
            : player.connected ? 'Connected' : 'Disconnected'
        )
      );

      seat.append(meta);
      seats.append(seat);
    });

    const actions = $('online-actions');
    actions.replaceChildren();

    if (!s.started) {
      if (s.host) {
        const start = el('button', 'online-primary', 'START MATCH');

        // Allow any room size from 2 to 5 players.
        start.disabled = s.players.length < 2;

        start.onclick = () => {
          send({
            type: 'start',
            rounds: Number($('online-rounds').value)
          });
        };

        actions.append(start);

        if (s.players.length < 2) {
          actions.append(
            el('p', '', 'Waiting for at least one more player.')
          );
        }
      } else {
        actions.append(
          el('p', '', 'Waiting for the host to start the match.')
        );
      }
    } else if (s.over) {
      actions.append(el('h3', '', 'Match complete!'));

      const winner = s.players.find(p => p.id === s.winner);

      actions.append(
        el('p', '', winner ? 'Winner: ' + winner.name : 'Game over')
      );
    } else if (!s.acting) {
      actions.append(
        el('p', '', 'Waiting for your turn.')
      );
    } else {
      actions.append(
        el(
          'h3',
          '',
          s.pending ? 'Choose a card' : 'Your turn — choose a card'
        )
      );

      if (!s.moves.length) {
        actions.append(el('p', '', 'No legal moves available.'));
      }

      s.moves.forEach(move => {
        const card = window.PhoenixCards.byId(move.cardId);
        if (!card) return;

        const target = s.players.find(p => p.id === move.targetId);

        const button = el(
          'button',
          'online-move',
          (card.glyph || '') + ' ' + card.name +
            (target ? ' → ' + target.name : '')
        );

        button.onclick = () => {
          send({
            type: 'move',
            cardId: move.cardId,
            targetId: move.targetId || null
          });
        };

        actions.append(button);
      });
    }

    const hand = $('online-hand');
    hand.replaceChildren();

    if (s.started) {
      hand.append(el('h3', '', 'Your private hand'));

      s.hand.forEach(id => {
        const card = window.PhoenixCards.byId(id);

        hand.append(
          el(
            'span',
            'online-card',
            card ? (card.glyph || '') + ' ' + card.name : id
          )
        );
      });
    }

    const log = $('online-log');
    log.replaceChildren();

    s.log.slice(-18).forEach(message => {
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

    document.addEventListener('phoenix-ally-confirmed', event => {
      if (event.detail.mode === 'multi') {
        enter();
      }
    });
  });
})();
