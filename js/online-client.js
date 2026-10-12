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
   * In a PUBLIC online match the server also sends `state.publicAllies` - this
   * room's randomised animal names and emojis. When it does, the public name and
   * emoji REPLACE the catalogue name everywhere (abilities stay the catalogue's),
   * and the portrait is never touched: the private portraits and real names must
   * not reach a public screen.
   *
   * @returns {?{name: string, emoji: ?string, title: string, desc: string, color: string, src: string}}
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

    var map = state && state.publicAllies;
    var pub = map && map[id];

    // The catalogue's ability wording names other allies (e.g. "40% chance to
    // block Phoenix"). In a public match those names are swapped for this room's
    // public names, so the ability reads identically while nobody's private name
    // is revealed. Owner modes (no publicAllies) keep the raw catalogue text.
    var desc = found.desc || '';
    if (map) {
      desc = desc.replace(/\b(Phoenix|Tilly|Ted|Louie|Simba|Elsie|Maple)\b/g, function (word) {
        var pubId = word.toLowerCase();
        return map[pubId] ? map[pubId].name : word;
      });
    }

    return {
      name: pub ? pub.name : (found.name || id.toUpperCase()),
      emoji: pub ? pub.emoji : null,
      title: found.title || '',
      desc: desc,
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

    // A connection already in flight: chain rather than open a second socket,
    // so entering the lobby (which connects early to show the public browser)
    // and then pressing CREATE/JOIN quickly still sends on ONE socket.
    if (socket && socket.readyState === WebSocket.CONNECTING) {
      const previous = socket.onopen;
      socket.onopen = () => {
        if (previous) previous();
        callback();
      };
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(protocol + '//' + location.host);

    socket.onopen = callback;
    socket.onerror = () =>
      feedback('Could not connect to the multiplayer server.');

    socket.onclose = () => {
      if (window.PhoenixCinematics) window.PhoenixCinematics.resetNetwork('disconnect');
      if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.reset();
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

      if (message.type === 'lobby') {
        renderLobbyList(message.rooms);
        return;
      } else if (message.type === 'admin_state') {
        PhoenixOnline.adminState = message;
        // A correct owner password is answered with admin_state. This is the
        // only place the dashboard is revealed, so it stays password-gated.
        revealAdminPanel();
        return;
      } else if (message.type === 'admin_rooms') {
        PhoenixOnline.adminRooms = message.rooms;
        renderAdminPanel();
        return;
      } else if (message.type === 'error') {
        feedback(message.message);
        // The multiplayer feedback line is hidden while on the main menu, so a
        // wrong-password (or lockout) message there would otherwise be invisible.
        if ($('menu-feedback') && $('phoenix-menu') && !$('phoenix-menu').hidden) {
          $('menu-feedback').textContent = message.message;
        }
      } else if (message.type === 'effect') {
        if (window.PhoenixCinematics) window.PhoenixCinematics.show(message.effect, 'online-screen');
      } else if (message.type === 'state') {
        const previous = state;
        state = message;
        feedback('');
        render();
        if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.observe(previous, message);
        if (window.PhoenixCinematics) window.PhoenixCinematics.consume(message.effects);
        if (window.PhoenixCinematics) window.PhoenixCinematics.match(message);
      }
    };
  }

  /**
   * Shows one of the two multiplayer modes on the ONLINE MULTIPLAYER screen.
   *
   * PUBLIC MULTIPLAYER is the open lobby system (randomised animal identities,
   * a shared lobby browser). OWNER & FRIENDS is the original private game:
   * owner-password create, real ally names/portraits/abilities, invite-code
   * join, and never listed.
   */
  function setMode(mode) {
    const owner = mode === 'owner';

    $('online-public-panel').hidden = owner;
    $('online-owner-panel').hidden = !owner;

    $('online-mode-public').classList.toggle('online-mode-tab-active', !owner);
    $('online-mode-owner').classList.toggle('online-mode-tab-active', owner);
    $('online-mode-public').setAttribute('aria-selected', String(!owner));
    $('online-mode-owner').setAttribute('aria-selected', String(owner));

    // Carry a typed name across so switching modes does not mean retyping it.
    const from = owner ? $('online-name') : $('online-owner-name');
    const to = owner ? $('online-owner-name') : $('online-name');
    if (from && to && from.value && !to.value) to.value = from.value;

    feedback(owner
      ? 'Owner & Friends: create a private room with the owner password, or join with an invite code.'
      : 'Create a lobby or join one with an invite code.');
  }

  /** Opens the lobby. This is the only entry point the main menu needs. */
  function enter() {
    $('phoenix-menu').hidden = true;
    $('ally-picker').hidden = true;
    $('online-screen').hidden = false;
    $('online-setup').hidden = false;
    $('online-room').hidden = true;

    const rememberedName = sessionStorage.getItem('phoenix-player-name') || '';
    $('online-name').value = rememberedName;
    $('online-owner-name').value = rememberedName;

    setMode('public');

    // Open the socket as soon as the lobby is entered, not only when a room is
    // created or joined: the server pushes a lobby snapshot on connect, and that
    // is what fills the PUBLIC LOBBY BROWSER. Without this a visitor sees an
    // empty list until they already try to create or join something.
    connect(() => {});
  }

  function leave() {
    if (window.PhoenixCinematics) window.PhoenixCinematics.resetNetwork('leave');
    if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.reset();

    // Tell the server we are leaving BEFORE closing the socket.
    //
    // The close event alone is not enough: behind a host's proxy the client's
    // close frame can take several seconds to arrive, and in that window the
    // lobby we just walked away from is still listed for everyone else. A plain
    // message is delivered immediately, so the room disappears at once. The
    // server keeps its close handler as the backstop for a dropped connection.
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'leave' }));
      } catch (e) { /* the socket is going away regardless */ }
    }

    if (socket) socket.close();
    socket = null;
    state = null;
    $('online-screen').hidden = true;
    $('phoenix-menu').hidden = false;
    if (window.PhoenixMusicPlayer) window.PhoenixMusicPlayer.setMatchActive('online', false);
  }

  /**
   * Opens the owner admin dashboard - the SERVER dashboard.
   *
   * It is reachable two ways: the OWNER DASHBOARD button on the main menu, and
   * the SERVER button on the online-multiplayer screen. Both go through here.
   *
   * It ALWAYS requires the owner password. The client only asks for it and sends
   * it; the server is the one that decides. The dashboard is revealed only when
   * the server answers a correct `admin_auth` with an `admin_state` message, so
   * the menu option gives no access to any admin command without the password
   * (and the server locks out repeated wrong guesses by IP).
   */
  function openAdmin() {
    // Was the dashboard opened from the main menu (rather than from inside the
    // multiplayer screen)? If so, remember it so we can put the menu back on
    // Logout, and so we can hide the menu while the dashboard is showing.
    const fromMenu = !$('phoenix-menu').hidden;

    // Already authenticated on this connection: just show it again.
    if (PhoenixOnline.adminState) {
      PhoenixOnline.adminFromMenu = fromMenu;
      revealAdminPanel();
      return;
    }

    connect(() => {
      const pwd = prompt('Enter the owner password to open the owner dashboard:');
      if (!pwd) return;
      PhoenixOnline.adminFromMenu = fromMenu;
      send({ type: 'admin_auth', password: pwd });
    });
  }

  /** Reveals the admin dashboard (once authorised) and brings it into view. */
  function revealAdminPanel() {
    renderAdminPanel();
    const panel = $('admin-panel');
    // Opened from the main menu: tuck the menu away so the dashboard is the page.
    if (PhoenixOnline.adminFromMenu && $('phoenix-menu')) {
      $('phoenix-menu').hidden = true;
    }
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'start' });
    // Ask for the current room list. The server answers with admin_rooms, which
    // renderAdminPanel() draws - without this the lobby list stayed empty.
    send({ type: 'admin_rooms' });
  }

  /**
   * Creates a room, or joins one with an invite code.
   *
   * There is deliberately NO ally field here. The server drafts allies after the
   * dice, and it ignores anything sent now - so asking for one at this point
   * would be asking for a choice that is thrown away.
   */
  function join(request) {
    // Accept either a plain action string ('create' / 'join' typed by the main
    // buttons) or a { type, code } object from a public-lobby row's JOIN button.
    const action =
      request && typeof request === 'object' ? request : { type: request };

    // Owner & Friends has its own name field; every public action shares the
    // original one, so the two modes never read each other's inputs.
    const ownerAction =
      action.type === 'ownerCreate' || action.type === 'ownerJoin';

    const name =
      (ownerAction ? $('online-owner-name') : $('online-name')).value.trim();

    if (!name) {
      feedback('Enter your player name.');
      return;
    }

    sessionStorage.setItem('phoenix-player-name', name);

    if (action.type === 'create') {
      // Optional custom invite code: blank (or missing) creates a PUBLIC lobby,
      // a 3-6 character code creates a PRIVATE lobby joinable with that code.
      const code = $('online-create-code').value.trim();
      connect(() => {
        send({ type: 'create', name, code });
      });
      return;
    }

    if (action.type === 'ownerCreate') {
      // The owner password is what marks this as an Owner & Friends room on the
      // server: it becomes a private room with the real allies and is never
      // listed in the public lobby browser. Cleared as soon as it is used.
      const ownerPassword = $('online-owner-password').value;
      if (!ownerPassword) {
        feedback('Enter the owner password to create a room.');
        return;
      }
      connect(() => {
        send({ type: 'create', name, code: '', ownerPassword });
        $('online-owner-password').value = '';
      });
      return;
    }

    const code =
      action.code != null
        ? String(action.code).trim()
        : $(ownerAction ? 'online-owner-code-input' : 'online-code-input')
            .value.trim();

    connect(() => {
      send({ type: 'join', name, code });
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
      const line = el('div', 'online-seat online-dice-row' + (index === waiting ? ' online-current' : ''));
      line.append(el('strong', '', player.name + (index === state.seat ? ' (you)' : '')));
      line.append(el('span', 'online-dice-value', value ? 'rolled ' + value : 'not rolled yet'));
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

        // Public matches have no animal portraits: the tile shows the room's
        // randomised public emoji instead. Portraits only appear where the
        // game is showing the real catalogue (owner modes send no publicAllies).
        const picture = info && info.emoji
          ? el('span', 'online-portrait online-ally-emoji', info.emoji)
          : el('img', 'online-portrait');
        if (!info || !info.emoji) {
          picture.src = info ? info.src : ('assets/allies/' + id + '.jpg');
          picture.alt = info ? info.name : id;
        }
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
      start.onclick = () => send({
        type: 'start',
        rounds: Number($('online-rounds').value)
      });
      actions.append(start);

      // Player list with kick buttons (host only)
      const playerList = el('div', 'lobby-player-list');
      state.players.forEach((p, idx) => {
        const row = el('div', 'lobby-player-row');
        row.append(el('span', 'lobby-player-name', p.name + (idx === 0 ? ' (host)' : '')));
        if (idx !== 0) {
          const kickBtn = el('button', 'online-secondary', 'KICK');
          kickBtn.type = 'button';
          kickBtn.onclick = () => send({ type: 'kick', seat: idx });
          row.append(kickBtn);
        }
        playerList.append(row);
      });
      actions.append(playerList);

      // Close lobby button (host only)
      const closeBtn = el('button', 'online-secondary', 'CLOSE LOBBY');
      closeBtn.type = 'button';
      closeBtn.onclick = () => {
        if (confirm('Close this lobby? All players will be disconnected.')) {
          send({ type: 'close_room' });
        }
      };
      actions.append(closeBtn);

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
function renderLobbyList(rooms) {
  const list = $('lobby-list');
  if (!list) return;
  list.replaceChildren();
  if (!rooms || !rooms.length) {
    list.append(el('p', '', 'No public lobbies.'));
    return;
  }
  for (const r of rooms) {
    const row = el('div', 'lobby-row');
    row.append(el('span', 'lobby-code', r.code));
    row.append(el('span', 'lobby-host', r.host || '?'));
    row.append(el('span', 'lobby-players', r.players + '/' + r.max));
    const btn = el('button', 'online-primary lobby-join', 'JOIN');
    btn.type = 'button';
    btn.onclick = () => PhoenixOnline.join({ type: 'join', code: r.code });
    row.append(btn);
    list.append(row);
  }
}

// Admin dashboard rendering
function renderAdminPanel() {
  const panel = $('admin-panel');
  if (!panel) return;
  panel.hidden = false;
  const stateDiv = $('admin-state');
  if (stateDiv && PhoenixOnline.adminState) {
    const s = PhoenixOnline.adminState;
    stateDiv.textContent = `Multiplayer Open: ${s.multiplayerOpen}, Creation Locked: ${s.creationLocked}`;
  }
  const list = $('admin-room-list');
  if (!list) return;
  list.replaceChildren();
  (PhoenixOnline.adminRooms || []).forEach(r => {
    const row = el('div', 'admin-room-row');
    row.append(el('span', '', r.code));
    row.append(el('span', '', r.visibility));
    row.append(el('span', '', r.host));
    row.append(el('span', '', `${r.count}/${r.max}`));
    const shut = el('button', 'online-secondary', 'SHUT DOWN');
    shut.onclick = () => {
      if (confirm('Shutdown room ' + r.code + '?')) {
        send({ type: 'admin_shutdown_room', code: r.code });
      }
    };
    row.append(shut);
    list.append(row);
  });
}

function renderMapleNotice(actions) {
  const names = state.mapleBlocked
    .map(id => {
      const card = window.PhoenixCards.byId(id);
      return card ? card.name : id;
    })
    .join(', ');

  // A public room uses Maple's randomised public name from the server; only the
  // owner modes ever say the real name. The 🍁 stays - it is the Sweet Tooth
  // glyph, part of the ability, not her name.
  const pub = state.publicAllies && state.publicAllies.maple;
  const mapleName = pub ? pub.name : 'Maple';

  actions.append(el('p', 'online-restricted',
    '🍁 ' + mapleName + '’s Sweet Tooth: nice cards only for 3 rounds. Not for now: ' + names + '.'
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

      const result = window.PhoenixEffects ? window.PhoenixEffects.matchResult(state) : null;
      victory.classList.toggle('phoenix-defeat', result === 'defeat');
      victory.append(el('h1', '', result === 'victory' ? '\u{1F3C6} VICTORY! \u{1F3C6}' : result === 'draw' ? 'MATCH DRAWN' : 'DEFEAT'));

      if (winner) {
        const champion = el('div', 'phoenix-champion');

        // Public matches show the room's randomised public emoji + name instead
        // of the private portrait and catalogue name. The portrait path is only
        // a fallback for modes that send no publicAllies.
        const pub = state.publicAllies && winner.ally && state.publicAllies[winner.ally];
        const photo = pub && pub.emoji
          ? el('span', 'phoenix-victory-ally online-ally-emoji', pub.emoji)
          : el('img', 'phoenix-victory-ally');
        if (!pub || !pub.emoji) {
          photo.src = 'assets/allies/' + winner.ally + '.jpg';
          photo.alt = winner.ally + ' the winning ally';
        }

        const trophy = el('div', 'phoenix-victory-trophy', '\u{1F3C6}');
        const display = el('div', 'phoenix-victory-display');
        display.append(photo, trophy);
        champion.append(display);

        const winnerAllyName = pub ? pub.name : (winner.ally || '');
        champion.append(el(
          'h2',
          '',
          winner.name + ' & ' + winnerAllyName.toUpperCase() + ' WON!'
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

          const allyShown = state.publicAllies && player.ally && state.publicAllies[player.ally]
            ? state.publicAllies[player.ally].name.toUpperCase()
            : (player.ally || 'No ally').toUpperCase();

          standings.append(el(
            'p',
            '',
            medal + ' ' + player.name +
            ' & ' +
            allyShown +
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
      const chooser=state.pending && state.players.find(p=>p.id===state.pending.chooserId);
      actions.append(el('p', '', chooser ? 'Waiting for '+chooser.name+' to make the required choice.' : 'Waiting for your turn.'));
      return;
    }

    actions.append(el(
      'h3',
      '',
      state.pending && state.pending.kind==='burn' ? 'Choose a card to destroy — Alvin' : state.pending ? 'Choose the card for this stolen turn' : 'Your turn — choose a card'
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
    if (window.PhoenixMusicPlayer) {
      window.PhoenixMusicPlayer.setMatchActive('online', !$('online-screen').hidden && window.PhoenixMusic.isActiveMatch(s));
    }

    $('online-setup').hidden = true;
    $('online-room').hidden = false;
    $('online-room-code').textContent = s.code;
    $('online-room-mode').textContent =
      s.mode === 'owner' ? 'OWNER & FRIENDS' : 'PUBLIC MULTIPLAYER';

    const current = s.players.find(p => p.id === s.current);
    const chooser=s.pending && s.players.find(p=>p.id===s.pending.chooserId);
    const choosing=chooser ? (s.pending.kind==='burn' ? chooser.name+' must choose a card for Alvin to destroy' : chooser.name+' is choosing '+(current?current.name+"’s":'the')+' card for this stolen turn') : null;

    const phaseText = {
      lobby: `${s.players.length} / 5 players · Minimum 2 to start`,
      turnDice: 'Rolling for turn order',
      allyDice: 'Rolling for ally draft order',
      draft: 'Choosing allies',
      playing: s.over
        ? 'Match finished'
        : `Round ${s.round} / ${s.rounds} · ${choosing || ((current ? current.name : 'Waiting')+' is playing')}`
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
    if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.decorate('online-screen');
  }

  function renderSeats() {
    const seats = $('online-seats');
    seats.replaceChildren();

    state.players.forEach((player, index) => {
      const actingId=state.pending ? state.pending.chooserId : state.current;
      const seat = el('div', 'online-seat' + (actingId === player.id ? ' online-current' : ''));
      seat.dataset.effectSeat = index;

      seat.append(el('span', 'online-player-number', String(index + 1).padStart(2, '0')));
      if (player.eliminated) seat.classList.add('online-out');

      const meta = el('div', 'online-seat-meta');
      meta.append(el('strong', '', player.name + (index === state.seat ? ' (you)' : '')));

      const info = player.ally ? allyInfo(player.ally) : null;

      const allyName = info ? info.name : player.ally;
      meta.append(el('small', 'online-ally-label', player.ally
        ? 'Ally: ' + allyName.charAt(0).toUpperCase() + allyName.slice(1).toLowerCase()
        : 'Ally not chosen yet'));
      if (info && info.title) meta.append(el('small', 'online-ally-title', info.title));
      if (info && info.desc) meta.append(el('p', 'online-ally-description', info.desc));

      if (state.started) {
        const score = el('span', 'online-score', player.points.toLocaleString());
        score.dataset.player = player.id;
        meta.append(score);
        meta.append(el('small', 'online-hand-count', 'points · ' + player.handCount + ' cards'));
      } else meta.append(el('span', '', player.connected ? 'Connected' : 'Disconnected'));

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
    const settingsButton = el('button', 'online-primary', 'Settings');
    settingsButton.id = 'online-settings';
    settingsButton.type = 'button';
    settingsButton.onclick = () => window.PhoenixMusicSettings.open();
    $('online-back').insertAdjacentElement('beforebegin', settingsButton);
    $('online-back').onclick = leave;
    $('online-create').onclick = () => join('create');
    $('online-join').onclick = () => join('join');

    // Owner & Friends, kept separate from the public lobby system.
    $('online-mode-public').onclick = () => setMode('public');
    $('online-mode-owner').onclick = () => setMode('owner');
    $('online-owner-create').onclick = () => join('ownerCreate');
    $('online-owner-join').onclick = () => join('ownerJoin');

    // Admin entry points: the SERVER button on the multiplayer screen and the
    // OWNER DASHBOARD button on the main menu both open the same dashboard.
    const adminBtn = $('online-admin');
    if (adminBtn) adminBtn.onclick = openAdmin;
    const ownerMenuBtn = $('menu-owner');
    if (ownerMenuBtn) ownerMenuBtn.onclick = openAdmin;

    $('online-copy').onclick = () => {
      if (!state) return;
      navigator.clipboard.writeText(state.code)
        .then(() => feedback('Invite code copied!'))
        .catch(() => feedback('Invite code: ' + state.code));
    };

    // Admin panel buttons
    const closeAllBtn = $('admin-close-all');
    if (closeAllBtn) closeAllBtn.onclick = () => send({ type: 'admin_shutdown_all' });
    const reopenBtn = $('admin-reopen');
    if (reopenBtn) reopenBtn.onclick = () => send({ type: 'admin_reopen' });
    const lockBtn = $('admin-lock');
    if (lockBtn) lockBtn.onclick = () => send({ type: 'admin_lock_creation' });
    const unlockBtn = $('admin-unlock');
    if (unlockBtn) unlockBtn.onclick = () => send({ type: 'admin_unlock_creation' });
    const logoutBtn = $('admin-logout');
    if (logoutBtn) logoutBtn.onclick = () => {
      const panel = $('admin-panel');
      if (panel) panel.hidden = true;
      // If the dashboard was opened from the main menu, put the menu back so the
      // owner is returned to the main website rather than left on a blank page.
      if (PhoenixOnline.adminFromMenu) {
        if ($('phoenix-menu')) $('phoenix-menu').hidden = false;
        if (window.scrollTo) window.scrollTo(0, 0);
      }
      PhoenixOnline.adminFromMenu = false;
      PhoenixOnline.adminState = null;
      PhoenixOnline.adminRooms = null;
      if ($('menu-feedback')) $('menu-feedback').textContent = '';
    };
  });

  window.PhoenixOnline = { enter, leave, join, openAdmin };
})();
