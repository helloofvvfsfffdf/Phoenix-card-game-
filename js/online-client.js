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
  let fooglePuzzleWindow = null;
  let hostSelectedRounds = null;
  let state = null;
  const resumeStorageKey = 'phoenix-online-resume:' + (location.pathname || '/') + (location.search || '');
  let resumeSession = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let intentionalLeave = false;
  try { resumeSession = JSON.parse(sessionStorage.getItem(resumeStorageKey) || 'null'); } catch (_) {}

  function saveResume(value) {
    resumeSession = value;
    try { sessionStorage.setItem(resumeStorageKey, JSON.stringify(value)); } catch (_) {}
  }
  function retryResume() {
    clearTimeout(reconnectTimer);
    if (!resumeSession || intentionalLeave || banShown) return;
    if (reconnectAttempts >= 10) { feedback('Could not reconnect. Reload this tab to retry your saved seat.'); return; }
    const delay = Math.min(5000, 500 * Math.pow(2, reconnectAttempts++));
    reconnectTimer = setTimeout(() => {
      if (!resumeSession || intentionalLeave) return;
      connect(() => send({ type: 'resume', ...resumeSession }));
    }, delay);
  }
  const interactiveModules = {
    rps: 'PhoenixRpsInteractive', betrayal: 'PhoenixBetrayalInteractive',
    speed: 'PhoenixSpeedInteractive', wheel: 'PhoenixWheelInteractive', wheelofmisfortune: 'PhoenixWheelInteractive',
    dice: 'PhoenixDiceInteractive', linkedfate: 'PhoenixLinkedFateInteractive',
    impostor: 'PhoenixImpostorInteractive', swapper: 'PhoenixSwapperInteractive',
    musicalchairs: 'PhoenixMusicalChairsInteractive',
    russianroulette: 'PhoenixRussianRouletteInteractive',
    memorymayhem: 'PhoenixMemoryMayhemInteractive',
    mimic: 'PhoenixMimicInteractive',
    support: 'PhoenixSupportInteractive',
    joshuasurvey: 'PhoenixJoshuaSurveyInteractive',
    trailer: 'PhoenixTrailerInteractive',
    enjoyingthetrailer: 'PhoenixTrailerInteractive'
  };
  let activeInteractionModule = null;
  let interactionKey = null;
  let resultTimer = null;
  let showingResult = false;

  function updateInteraction(message) {
    if (message && message.paused) {
      const previous = activeInteractionModule && window[activeInteractionModule];
      if (previous && previous.close) previous.close();
      clearTimeout(resultTimer);
      activeInteractionModule = null;
      showingResult = false;
      return;
    }
    const pi = message && message.pendingInteraction;
    const name = pi && interactiveModules[pi.type];
    const result = message && message.lastInteractionResult;
    if (!pi && activeInteractionModule && result && interactionKey === result.createdAt && !showingResult) {
      showingResult = true;
      const previous = window[activeInteractionModule];
      const view = { ...message, events: result.events,
        pendingInteraction: ['rps', 'betrayal'].includes(result.type) ? null : result };
      if (previous && previous.onState) previous.onState(view);
      document.querySelectorAll('.interactive-overlay button, .interactive-overlay input').forEach(el => { el.disabled = true; });
      const dismiss = () => {
        clearTimeout(resultTimer);
        if (previous && previous.close) previous.close();
        activeInteractionModule = null;
        showingResult = false;
      };
      const shell = document.querySelector('.interactive-overlay .interactive-shell');
      if (shell) {
        // The answer, in front of everything, and the old controls put away
        // so nobody is left looking at a form that is already finished.
        const banner = document.createElement('p');
        banner.className = 'interaction-result';
        const said = (result.events || []).map(function (e) { return e.text || ''; }).join(' ');
        banner.textContent = said || 'The result is in the table log.';
        shell.insertBefore(banner, shell.firstChild);
        shell.querySelectorAll('.mc-stage, .mc-symbols, .mm-answer, .mm-picked').forEach(function (el) { el.hidden = true; });
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Continue';
        button.onclick = dismiss;
        shell.appendChild(button);
      }
      resultTimer = setTimeout(dismiss, 6000);
      return;
    }
    if (!pi && showingResult && message && message.phase === 'playing') return;
    if (pi && interactionKey !== pi.createdAt && activeInteractionModule) {
      const previous = window[activeInteractionModule];
      if (previous && previous.close) previous.close();
      activeInteractionModule = null;
    }
    if (activeInteractionModule && activeInteractionModule !== name) {
      const previous = window[activeInteractionModule];
      if (previous && typeof previous.close === 'function') previous.close();
      activeInteractionModule = null;
    }
    if (!pi || interactionKey !== pi.createdAt) {
      clearTimeout(resultTimer);
      showingResult = false;
    }
    const mod = name && window[name];
    if (mod && typeof mod.build === 'function') {
      activeInteractionModule = name;
      interactionKey = pi.createdAt;
      mod.build(pi.type);
      if (typeof mod.onState === 'function') mod.onState(message);
      if (pi.type === 'speed') return; // Speed owns its ready/countdown/reaction controls.
      const myId = message.players[message.seat] && message.players[message.seat].id;
      // Only the caster spins a wheel: the Wheel of Fortune and the Wheel of
      // Misfortune both belong to the player who played the card.
      const casterOnly = pi.type === 'wheel' || pi.type === 'wheelofmisfortune';
      const eligible = (pi.participants || []).includes(myId) && (!casterOnly || pi.actorId === myId);
      // A card that can ask the same player more than once must not lock
      // their buttons: the revolver passes around and can come back, the
      // memory sequences come one at a time, an early press has to be made
      // again, and the owner judges every answer in turn.
      const answersMoreThanOnce = ['musicalchairs', 'russianroulette', 'memorymayhem',
        'joshuasurvey'].includes(pi.type);
      const locked = !answersMoreThanOnce && (pi.submitted || []).includes(myId);
      document.querySelectorAll('.interactive-overlay button, .interactive-overlay input').forEach(el => {
        el.disabled = !eligible || locked;
        if (!eligible) el.hidden = true;
      });
    }
  }

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

  function showBadgeUnlockedNotification(badge) {
    if (!badge) return;
    // Create a small, polished notification that doesn't interrupt gameplay.
    const existing = document.getElementById('badge-unlocked-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'badge-unlocked-notification';
    notif.className = 'badge-unlocked-notification';
    notif.setAttribute('role', 'status');
    notif.setAttribute('aria-live', 'polite');

    const title = document.createElement('div');
    title.className = 'badge-unlocked-title';
    title.textContent = 'Badge Unlocked!';
    notif.appendChild(title);

    if (badge.icon) {
      const img = document.createElement('img');
      img.className = 'badge-unlocked-icon';
      img.setAttribute('src', badge.icon);
      img.setAttribute('alt', '');
      notif.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'badge-unlocked-name';
    name.textContent = badge.name || '';
    notif.appendChild(name);

    if (badge.rarity) {
      const rarity = document.createElement('div');
      rarity.className = 'badge-unlocked-rarity';
      rarity.textContent = String(badge.rarity).toUpperCase();
      notif.appendChild(rarity);
    }

    if (badge.description) {
      const desc = document.createElement('div');
      desc.className = 'badge-unlocked-desc';
      desc.textContent = badge.description;
      notif.appendChild(desc);
    }

    document.body.appendChild(notif);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      if (notif.parentNode) {
        notif.classList.add('badge-unlocked-fade');
        setTimeout(() => { if (notif.parentNode) notif.remove(); }, 500);
      }
    }, 5000);
  }

  /* ------------------------------------------------------------------ */
  /* The ban screen                                                      */
  /*                                                                     */
  /* Everything it shows comes from the server's public projection of the */
  /* restriction: a headline, a scope, a reason, whether it is permanent, */
  /* when it expires, and - for a network or device restriction - the     */
  /* warning that somebody ELSE on this connection may be affected.       */
  /* It never receives, and therefore never renders, an address, a device */
  /* token, an internal id, or the name of any other player.              */
  /* ------------------------------------------------------------------ */

  let banShown = false;

  function showBanScreen(ban) {
    const overlay = $('ban-overlay');
    if (!overlay || !ban) return;
    banShown = true;

    $('ban-headline').textContent = ban.headline || 'YOU HAVE BEEN BANNED FROM PHOENIX';

    const status = $('ban-status');
    if (ban.permanent) {
      status.textContent = 'PERMANENT';
      status.classList.remove('is-temporary');
    } else {
      status.textContent = ban.expiresAt
        ? 'UNTIL ' + formatWhen(ban.expiresAt).toUpperCase()
        : 'TEMPORARY';
      status.classList.add('is-temporary');
    }

    $('ban-reason').textContent = ban.reason
      ? 'Reason: ' + ban.reason
      : 'No reason was recorded.';
    $('ban-issued').textContent = ban.issuedAt
      ? 'Issued ' + formatWhen(ban.issuedAt) + '.'
      : '';
    $('ban-expires').textContent = (!ban.permanent && ban.expiresAt)
      ? 'This restriction lifts automatically ' + formatWhen(ban.expiresAt) +
        ', or sooner if the owner lifts it.'
      : '';

    // The shared-household warning. Absent for a plain account restriction,
    // present for a network or device one - and never softened.
    const notice = $('ban-notice');
    if (ban.notice) {
      notice.textContent = ban.notice;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }

    overlay.hidden = false;
    if (window.PhoenixOpeningCinematic) window.PhoenixOpeningCinematic.stop();
  }

  function hideBanScreen() {
    const overlay = $('ban-overlay');
    if (overlay) overlay.hidden = true;
    banShown = false;
  }

  /** "3 April 2026, 14:05" from an ISO string, or a plain relative hint. */
  function formatWhen(iso) {
    const at = new Date(iso);
    if (!isFinite(at.getTime())) return String(iso);
    return at.toLocaleString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
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
    const connection = socket;
    intentionalLeave = false;
    window.ws = socket;

    socket.onopen = callback;
    socket.onerror = () =>
      feedback('Could not connect to the multiplayer server.');

    socket.onclose = () => {
      if (socket !== connection) return;
      if (state && state.phase === 'lobby') saveResume(null);
      updateInteraction(null);
      if (window.PhoenixCinematics) window.PhoenixCinematics.resetNetwork('disconnect');
      if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.reset();
      state = null;
      window.ws = null;
      socket = null;
      feedback(resumeSession ? 'Connection lost. Reconnecting to your saved seat…' : 'Disconnected from the server. Enter the lobby to reconnect.');
      $('online-actions').replaceChildren();
      retryResume();
    };

    socket.onmessage = event => {
      if (socket !== connection) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'lobby') {
        renderLobbyList(message.rooms);
        return;
      } else if (message.type === 'banned') {
        clearTimeout(reconnectTimer);
        // The SERVER has decided this connection is restricted. Everything on
        // the screen comes from its projection - no address, no other player,
        // no internal id. There is no "dismiss and carry on" here: the socket
        // is closed by the server, so play genuinely cannot continue.
        showBanScreen(message.ban);
        return;
      } else if (message.type === 'roomClosed') {
        intentionalLeave = true;
        clearTimeout(reconnectTimer);
        saveResume(null);
        feedback(message.message || 'Room closed.');
        return;
      } else if (message.type === 'interact-ack') {
        feedback('Decision recorded. Waiting for the other player…');
        return;
            } else if (message.type === 'banned-cleared') {
        // A restriction was lifted while this player was sitting on the screen.
        hideBanScreen();
        feedback('Your restriction has been lifted. Welcome back to PHOENIX.');
        return;
      } else if (message.type === 'account') {
        // The server tells us who we are signed in as (set by the httpOnly
        // session cookie). An OWNER account opens the dashboard with no
        // separate owner password.
        PhoenixOnline.account = message.account;
        return;
      } else if (message.type === 'badgeUnlocked') {
        // A secret badge was just earned. Show a small, polished notification
        // that reveals the name and artwork, without interrupting gameplay.
        showBadgeUnlockedNotification(message.badge);
        return;
      } else if (message.type === 'admin_state') {
        PhoenixOnline.adminState = message;
        // A correct owner password is answered with admin_state. This is the
        // only place the dashboard is revealed, so it stays password-gated.
        revealAdminPanel();
        return;
      } else if (message.type === 'friend-request') {
        // A friend is waiting for permission. The owner is told the moment it
        // arrives, not the next time they happen to open the dashboard.
        PhoenixOnline.friendRequests = PhoenixOnline.friendRequests || [];
        if (!PhoenixOnline.friendRequests.some(function (r) {
          return r.id === message.request.id;
        })) {
          PhoenixOnline.friendRequests.push(message.request);
        }
        renderAdminPanel();
        return;
      } else if (message.type === 'admin_friend_requests') {
        PhoenixOnline.friendRequests = message.requests || [];
        renderAdminPanel();
        return;
      } else if (message.type === 'admin_friend_respond_result') {
        var line = $('admin-friend-feedback');
        if (line) {
          line.textContent = message.message ||
            (message.ok ? 'The request has been answered.' : 'That could not be done.');
          line.classList.toggle('is-error', !message.ok);
        }
        renderAdminPanel();
        return;
      } else if (message.type === 'admin_rooms') {
        PhoenixOnline.adminRooms = message.rooms;
        renderAdminPanel();
        return;
      } else if (message.type === 'error') {
        if (message.code === 'resume-invalid') {
          clearTimeout(reconnectTimer);
          saveResume(null);
        } else if (message.code === 'resume-busy') retryResume();
        // The server refused play because this account still owes a verified
        // address. Open the screen that fixes it rather than making the player
        // find it - they were trying to play, so show what unblocks play.
        if (message.code === 'email-required' && window.PhoenixAccount &&
            typeof window.PhoenixAccount.openVerification === 'function') {
          window.PhoenixAccount.openVerification();
        }
        feedback(message.message);
        // The multiplayer feedback line is hidden while on the main menu, so a
        // wrong-password (or lockout) message there would otherwise be invisible.
        if ($('menu-feedback') && $('phoenix-menu') && !$('phoenix-menu').hidden) {
          $('menu-feedback').textContent = message.message;
        }
      } else if (message.type === 'effect') {
      } else if (message.type === 'chairs-stop') {
        // The music has stopped. The server decides when, and nobody is told.
        const chairs = window.PhoenixMusicalChairsInteractive;
        if (chairs && typeof chairs.stopped === 'function') chairs.stopped();
      } else if (message.type === 'rickroll') {
        // The Mimic's prank. The SERVER is holding this player's turn;
        // the video is simply what they see while it does.
        showMimicRickroll();
        return;
      } else if (message.type === 'mimicRickroll') {
        // THE MIMIC. The card was a disguise, so its real effect never
        // happened - and the player is Rickrolled instead.
        showMimicRickroll();
        return;
      } else if (message.type === 'effect') {
        if (window.PhoenixCinematics) window.PhoenixCinematics.show(message.effect, 'online-screen');
      } else if (message.type === 'state') {
        const previous = state;
        state = message;
        if (message.resumeToken) saveResume({ code: message.code, token: message.resumeToken });
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);
        feedback('');
        render();
        updateInteraction(message);
        if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.observe(previous, message);
        maybeFakeShutdown(message.effects);
        if (window.PhoenixCinematics) window.PhoenixCinematics.consume(message.effects);
        if (window.PhoenixCinematics) window.PhoenixCinematics.match(message);
      }
    };
  }

  // One listener, not another copy after every socket reconnect.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (socket && socket.readyState === WebSocket.OPEN && state && state.started) send({ type: 'ping' });
    else if (!socket && resumeSession) retryResume();
  });

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

    // An owner needs no password: their authority is the signed-in session, and
    // the SERVER re-checks it on the create. Everyone else still types it.
    // (Purely cosmetic - the server refuses regardless of what this shows.)
    const account = window.PhoenixAccount && window.PhoenixAccount.current
      ? window.PhoenixAccount.current()
      : null;
    const isOwner = !!(account && account.role === 'owner');
    const passwordField = $('online-owner-password-field');
    if (passwordField) passwordField.hidden = isOwner;

    feedback(owner
      ? (isOwner
          ? 'Owner & Friends: you are signed in as the owner, so create a private room directly.'
          : 'Owner & Friends: create a private room with the owner password, or join with an invite code.')
      : 'Create a lobby or join one with an invite code.');
  }

  /** Opens the lobby. This is the only entry point the main menu needs. */
  function enter() {
    // Multiplayer is an authenticated feature: a signed-in session must exist
    // before the lobby is shown at all. If the account module is not present
    // (unit-test harnesses load this file on its own), fall back to opening
    // the lobby directly so nothing is blocked.
    const openLobby = function () {
      if (window.PhoenixOpeningCinematic) window.PhoenixOpeningCinematic.stop();
      $('phoenix-menu').hidden = true;
      $('ally-picker').hidden = true;
      $('online-screen').hidden = false;
      $('online-setup').hidden = false;
      $('online-room').hidden = true;

      // Your name in a lobby is your ACCOUNT name. There is no name field any
      // more: the server derives it from the signed-in session, so a player
      // cannot type somebody else's name and nobody has to invent one.
      setMode('public');

      // Open the socket as soon as the lobby is entered, not only when a room is
      // created or joined: the server pushes a lobby snapshot on connect, and
      // that is what fills the PUBLIC LOBBY BROWSER. Without this a visitor sees
      // an empty list until they already try to create or join something.
      connect(() => { if (resumeSession) send({ type: 'resume', ...resumeSession }); });
    };

    if (window.PhoenixAccount && window.PhoenixAccount.requireLogin) {
      window.PhoenixAccount.requireLogin(openLobby);
    } else {
      openLobby();
    }
  }

  function leave() {
    intentionalLeave = true;
    clearTimeout(reconnectTimer);
    saveResume(null);
    updateInteraction(null);
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
    window.ws = null;
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
  async function openAdmin() {
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

    // Learn the signed-in role BEFORE opening the socket. /api/me reads the
    // same httpOnly session cookie the WebSocket reads, so the two always
    // agree - and asking here avoids racing the socket's `account` message.
    // An owner account is then never shown a password prompt.
    let role = null;
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (res.ok) {
        const payload = await res.json();
        role = payload.account && payload.account.role;
      }
    } catch (e) { /* offline or unauthenticated: fall back to the prompt */ }

    connect(() => {
      if (role === 'owner') {
        PhoenixOnline.adminFromMenu = fromMenu;
        send({ type: 'admin_auth' });
        return;
      }
      const pwd = prompt('Enter the owner password to open the owner dashboard:');
      if (!pwd) return;
      PhoenixOnline.adminFromMenu = fromMenu;
      send({ type: 'admin_auth', password: pwd });
    });
  }

  /** Reveals the admin dashboard (once authorised) and brings it into view. */
  function revealAdminPanel() {
    renderAdminPanel();
    // The announcements list in the dashboard is rendered by its own module, so
    // ask it for a fresh copy now that the owner can actually see it. Absent
    // from the page, or absent from a server without announcements, this is a
    // no-op - the dashboard must never depend on it.
    if (window.PhoenixAnnouncements) window.PhoenixAnnouncements.refresh();
    // Ban Management is a set of REST calls rather than a socket message, so
    // it has to be asked for a fresh copy here too. Absent from the page this
    // is a no-op, exactly like the announcements refresh above.
    if (window.PhoenixModeration) window.PhoenixModeration.refresh();
    const panel = $('admin-panel');
    // Opened from the main menu: tuck the menu away so the dashboard is the page.
    if (PhoenixOnline.adminFromMenu && $('phoenix-menu')) {
      $('phoenix-menu').hidden = true;
    }
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'start' });
    // Ask for the current room list. The server answers with admin_rooms, which
    // renderAdminPanel() draws - without this the lobby list stayed empty.
    send({ type: 'admin_rooms' });
    // And for the friend requests that are waiting, in case one arrived while
    // the dashboard was closed.
    send({ type: 'admin_friend_requests' });
  }

  /**
   * Creates a room, or joins one with an invite code.
   *
   * There is deliberately NO ally field here. The server drafts allies after the
   * dice, and it ignores anything sent now - so asking for one at this point
   * would be asking for a choice that is thrown away.
   */
  function openHostSettings(hostType) {
    hostType = hostType === 'owner' ? 'owner' : 'public';
    const dialog=$('host-settings-dialog'); if (!dialog) return join('create');
    const mode=$('host-game-mode'), rounds=$('host-rounds'), custom=$('host-custom-rounds'), invite=$('host-invite-code');
    const account=(window.PhoenixAccount&&typeof window.PhoenixAccount.current==='function'&&window.PhoenixAccount.current())||PhoenixOnline.account||{};
    const ownerPermission=account.role==='owner';
    function refresh(){const foogle=mode.value==='foogle';const values=['5','10','15','20','25','30','35','40','45','50','custom'];const selected=rounds.value||'10';rounds.replaceChildren(...values.map(value=>{const o=document.createElement('option');o.value=value;o.textContent=value==='custom'?'Custom':value;return o;}));rounds.value=values.includes(selected)?selected:'10';const isCustom=rounds.value==='custom';$('host-custom-rounds-label').hidden=!isCustom;const count=isCustom?Math.min(100,Math.max(5,Number(custom.value)||55)):Number(rounds.value);const minutes=Math.ceil(count*1.5);$('host-duration').textContent='Estimated duration: approximately '+minutes+'–'+(minutes*2)+' minutes'+(foogle?' · cooperative puzzles may finish earlier':'');$('host-foogle-note').hidden=!foogle;$('host-owner-password-label').hidden=hostType!=='owner'||ownerPermission;$('host-invite-label').hidden=hostType==='owner'||ownerPermission;}
    const close=()=>{if(typeof dialog.close==='function')dialog.close();dialog.removeAttribute('open');dialog.classList.remove('host-settings-visible');};
    if (dialog.open || dialog.classList.contains('host-settings-visible')) return;
    mode.onchange=refresh;rounds.onchange=refresh;custom.oninput=refresh;refresh();
    if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.classList.add('host-settings-visible');}
    $('host-settings-close').onclick=close;$('host-settings-cancel').onclick=close;
    $('host-settings-form').onsubmit=event=>{event.preventDefault();const count=rounds.value==='custom'?Math.min(100,Math.max(5,Number(custom.value)||55)):Number(rounds.value);hostSelectedRounds=count;$('online-game-mode').value=mode.value;$('online-lobby-rounds').value=rounds.value;$('online-long-rounds').checked=false;$('online-create-code').value=(ownerPermission||hostType==='owner')?'':invite.value;if(hostType==='owner')$('online-owner-password').value=ownerPermission?'':$('host-owner-password').value;close();join(hostType==='owner'?'ownerCreate':'create');};
  }

  function join(request) {
    // Accept either a plain action string ('create' / 'join' typed by the main
    // buttons) or a { type, code } object from a public-lobby row's JOIN button.
    const action =
      request && typeof request === 'object' ? request : { type: request };

    // Owner & Friends has its own controls; every public action shares the
    // original ones, so the two modes never read each other's inputs.
    const ownerAction =
      action.type === 'ownerCreate' || action.type === 'ownerJoin';

    // NO NAME FIELD ANY MORE. A player's lobby name is their ACCOUNT name,
    // decided by the server from the signed-in session. This file never sends
    // one, so nobody can join a lobby wearing somebody else's name.

    if (action.type === 'create') {
      // Optional custom invite code: blank (or missing) creates a PUBLIC lobby,
      // a 3-6 character code creates a PRIVATE lobby joinable with that code.
      const code = $('online-create-code').value.trim();
      const gameMode = $('online-game-mode') ? $('online-game-mode').value : 'classic';
      const roundSelect=$('online-lobby-rounds');
      const rounds = hostSelectedRounds || (roundSelect && roundSelect.value === 'custom'
        ? Math.min(100, Math.max(5, Number($('online-rounds-custom')?.value) || 55))
        : (roundSelect ? Number(roundSelect.value) : 10));
      const allowLongRounds = !!($('online-long-rounds') && $('online-long-rounds').checked);
      connect(() => {
        send({ type: 'create', code, gameMode, rounds, allowLongRounds });
      });
      return;
    }

    if (action.type === 'ownerCreate') {
      // The password is what marks this as an Owner & Friends room for anyone
      // who is NOT the owner: it becomes a private room with the real allies
      // and is never listed in the public lobby browser.
      //
      // A signed-in OWNER sends no password at all - their authority is the
      // session, and the server reads the role off it. Cleared as soon as it
      // is used.
      const account = window.PhoenixAccount && window.PhoenixAccount.current
        ? window.PhoenixAccount.current()
        : null;
      const isOwner = !!(account && account.role === 'owner');

      const ownerPassword = isOwner ? '' : $('online-owner-password').value;
      if (!isOwner && !ownerPassword) {
        feedback('Enter the owner password to create a room.');
        return;
      }
      connect(() => {
        send({ type: 'create', code: '', ownerPassword,
          gameMode: $('online-game-mode') ? $('online-game-mode').value : 'classic',
           rounds: hostSelectedRounds || ($('online-lobby-rounds') && $('online-lobby-rounds').value === 'custom'
             ? Math.min(100, Math.max(5, Number($('online-rounds-custom')?.value) || 55))
             : ($('online-lobby-rounds') ? Number($('online-lobby-rounds').value) : 10)),
          allowLongRounds: !!($('online-long-rounds') && $('online-long-rounds').checked) });
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
      send({ type: 'join', code });
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
      const rollBadges = badgesFor(player);
      if (rollBadges) line.append(rollBadges);
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
    actions.append(el('p', 'foogle-lobby-settings-copy', (state.gameMode === 'foogle' ? 'FOOGLE CHALLENGE' : 'CLASSIC PHOENIX') + ' · ' + state.requestedRounds + ' rounds · estimated ' + (state.estimatedDuration || 15) + '–' + ((state.estimatedDuration || 15) * 2) + ' minutes'));

    if (state.host) {
      const start = el('button', 'online-primary', 'START MATCH');
      start.type = 'button';
      start.onclick = () => {
        // Round settings were chosen before the room was created. Starting the
        // match must use that saved server-approved value, not a second control.
        send({ type: 'start', rounds: state.requestedRounds });
      };
      actions.append(start);

      // Player list with kick buttons (host only)
      const playerList = el('div', 'lobby-player-list');
      state.players.forEach((p, idx) => {
        const row = el('div', 'lobby-player-row');
        row.append(el('span', 'lobby-player-name', p.name + (idx === 0 ? ' (host)' : '')));

        const lobbyBadges = badgesFor(p);
        if (lobbyBadges) row.append(lobbyBadges);
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
/**
 * WHO IS ONLINE.
 *
 * Every connection the server can see, with the room it is sitting at. The
 * owner already owns the server, so this is only ever shown to them.
 */
function renderAdminPlayers() {
  const box = $('admin-online-list');
  if (!box) return;
  const state = PhoenixOnline.adminState;
  const online = (state && state.online) || [];
  box.replaceChildren();
  if (!online.length) {
    box.append(el('p', 'admin-online-empty', 'Nobody is connected right now.'));
    return;
  }
  online.forEach(function (player) {
    const row = el('div', 'admin-online-row');
    row.append(el('span', 'admin-online-name', player.name));
    const tags = [];
    if (player.owner) tags.push('OWNER');
    else if (player.signedIn) tags.push('SIGNED IN');
    else tags.push('NOT SIGNED IN');
    if (player.admin) tags.push('ADMIN');
    tags.push(player.room ? 'ROOM ' + player.room : 'LOBBY');
    row.append(el('span', 'admin-online-tags', tags.join(' \u00b7 ')));
    box.appendChild(row);
  });
}

/**
 * THE FRIEND REQUESTS.
 *
 * One row per friend who is waiting: their name, how long they have left,
 * and the two buttons. Accepting makes the account - with no email address,
 * because there is nobody to send a code to - and declining tells them so.
 */
function renderAdminFriends() {
  const box = $('admin-friend-list');
  if (!box) return;
  const requests = (PhoenixOnline.friendRequests || []).filter(function (r) {
    return r.state === 'pending';
  });
  box.replaceChildren();

  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'mod-sub';
    empty.textContent = 'No friend is waiting.';
    box.appendChild(empty);
    return;
  }

  requests.forEach(function (request) {
    const row = document.createElement('div');
    row.className = 'mod-hit';

    const who = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'mod-hit-name';
    name.textContent = request.username;
    who.appendChild(name);
    const left = document.createElement('span');
    left.className = 'mod-hit-id';
    const seconds = Math.max(0, Math.round((request.expiresAt - Date.now()) / 1000));
    left.textContent = seconds + ' second' + (seconds === 1 ? '' : 's') + ' left to answer';
    who.appendChild(left);
    row.appendChild(who);

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'online-primary';
    accept.textContent = 'ACCEPT';
    accept.onclick = function () { answerFriend(request.id, 'accept'); };
    row.appendChild(accept);

    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'online-secondary';
    decline.textContent = 'DECLINE';
    decline.onclick = function () { answerFriend(request.id, 'decline'); };
    row.appendChild(decline);

    box.appendChild(row);
  });
}

function answerFriend(id, decision) {
  send({ type: 'admin_friend_respond', id: id, decision: decision });
}

function renderAdminPanel() {
  const panel = $('admin-panel');
  if (!panel) return;
  renderAdminFriends();
  panel.hidden = false;
  const stateDiv = $('admin-state');
  if (stateDiv && PhoenixOnline.adminState) {
    const s = PhoenixOnline.adminState;
    stateDiv.textContent = `Multiplayer Open: ${s.multiplayerOpen}, Creation Locked: ${s.creationLocked}`;
  }
  renderAdminPlayers();
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

window.addEventListener('message', function(event) {
  if (event.origin !== window.location.origin || !event.data) return;
  if (event.data.type === 'foogle-start-puzzle') send({ type:'foogle_start_puzzle', puzzleId:String(event.data.puzzleId || '') });
  if (event.data.type === 'foogle-puzzle-action') send({ type:'foogle_action', action:'solve', payload:event.data.payload });
  if (event.data.type === 'foogle-place-piece') send({ type:'foogle_place_piece', puzzleId:String(event.data.puzzleId || '') });
});

function renderFoogleTurn(actions) {
  const fc=state.foogleChallenge; if (!fc) return false;
  const mine=(state.players[state.seat]||{}).id;
  const box=el('div','foogle-challenge-panel');
  box.append(el('h3','','🧩 THE PUZZLE — '+Object.keys(fc.placements||{}).length+'/9 PIECES'));
  const board=el('button','online-secondary','OPEN THE PUZZLE BOARD');board.type='button';board.onclick=()=>{fooglePuzzleWindow=window.open('/the-puzzle.html','foogle-board','noopener');};box.append(board);
  if (fc.visit && fc.visit.playerId===mine) {
    const left=Math.max(0,Math.ceil((fc.visit.expiresAt-Date.now())/1000));
    box.append(el('p','','FOOGLE visit active: '+left+' seconds remaining. Progress saves automatically.'));
    const assigned=fc.assignments&&fc.assignments[mine];
    if (!assigned) {
      box.append(el('p','','Choose one available website puzzle. Your assignment remains yours across turns.'));
      (fc.puzzles||[]).filter(p=>p.status==='available').forEach(p=>{const b=el('button','online-secondary','START PUZZLE: '+p.name);b.type='button';b.onclick=()=>send({type:'foogle_start_puzzle',puzzleId:p.id});box.append(b);const link=el('a','foogle-puzzle-link','Open website');link.href=({'nvidia':'definitely-not-nvidia','news':'phoenix-news','microsoft':'definitely-not-microsoft','weather':'foogle-weather','wikipedia':'definitely-not-wikipedia','reddit':'definitely-not-reddit','apple':'definitely-not-apple','technologies':'phoenix-technologies','steam':'definitely-not-steam'}[p.id]||'foogle')+'.html?puzzle='+encodeURIComponent(p.id);link.target='_blank';link.onclick=e=>{e.preventDefault();fooglePuzzleWindow=window.open(link.href,'foogle-puzzle','noopener');};box.append(link);});
    } else {
      const progress=fc.progress[assigned]||{stage:0};
      box.append(el('p','','Assigned puzzle: '+assigned.toUpperCase()+' · stage '+progress.stage+' / '+fc.difficulty.stages));
      if (!fc.completed[assigned]) { const solve=el('button','online-primary','SOLVE NEXT CLUE');solve.type='button';solve.onclick=()=>send({type:'foogle_action',action:'advance'});box.append(solve); }
      else box.append(el('p','','PUZZLE WON! +10,000 POINTS · A new jigsaw piece is unlocked.'));
    }
    Object.keys(fc.completed||{}).filter(id=>!fc.placements[id]).forEach(id=>{const b=el('button','online-secondary','PLACE '+id.toUpperCase()+' PIECE');b.type='button';b.onclick=()=>send({type:'foogle_place_piece',puzzleId:id});box.append(b);});
    const end=el('button','online-secondary','END FOOGLE VISIT');end.type='button';end.onclick=()=>send({type:'foogle_end'});box.append(end);actions.append(box);return true;
  }

  // Defensive delegation: the lobby markup can be revealed after this module
  // initializes, so the host button must still open settings when that happens.
  document.addEventListener('click', function(event) {
    const button=event.target && event.target.closest ? event.target.closest('#online-create') : null;
    if (!button) return;
    event.preventDefault();
    openHostSettings();
  });
  if (state.acting && !fc.visit) { const visit=el('button','online-primary','VISIT FOOGLE');visit.type='button';visit.onclick=()=>{visit.disabled=true;feedback('Starting FOOGLE visit…');if(!send({type:'foogle_visit'}))visit.disabled=false;};box.append(el('p','','Choose to play a PHOENIX card or spend this turn solving a website puzzle.'),visit); }
  else if (fc.visit) box.append(el('p','',''+playerName(fc.visit.playerId)+' is visiting FOOGLE. Their 60-second puzzle turn is in progress.'));
  actions.append(box); return false;
}

  function renderPlaying() {
    const actions = $('online-actions');
    actions.replaceChildren();

    const shoppers = state.shoppingPlayers || [];
    if (shoppers.length) {
      shoppers.forEach(id => {
        const player = state.players.find(p => p.id === id);
        if (player) actions.append(el('p', 'shopping-table-notice', '🛒 ' + player.name + ' is completing a shopping challenge.'));
      });
    }
     if (state.shoppingChallenge) {
      const box = el('div', 'shopping-match-card');
      box.append(el('h3', '', '🛒 Definitely Not Amazon'));
      box.append(el('p', '', state.shoppingChallenge.actorName + ' sent you shopping. Your PHOENIX match stays open while you browse.'));
      const open = el('button', 'online-primary', 'OPEN SHOPPING WEBSITE');
      open.type = 'button';
      open.onclick = () => window.open('/shopping.html?token=' + encodeURIComponent(state.shoppingChallenge.token), '_blank', 'noopener');
      const back = el('button', 'online-secondary', 'RETURN TO SHOPPING');
      back.type = 'button'; back.onclick = () => window.open('/shopping.html?token=' + encodeURIComponent(state.shoppingChallenge.token), '_blank', 'noopener');
      box.append(open, back, el('small', '', 'You have five minutes. This button is only visible to you.'));
       actions.append(box);
     }
     const tubePlayers = state.phoenixTubePlayers || [];
     tubePlayers.forEach(id => {
       const player = state.players.find(p => p.id === id);
       if (player) actions.append(el('p', 'phoenixtube-table-notice', '📺 ' + player.name + ' is completing a PHOENIXTube challenge.'));
     });
      if (state.phoenixTubeChallenge) {
       const box = el('div', 'phoenixtube-match-card');
       box.append(el('h3', '', '📺 PHOENIXTube'));
       box.append(el('p', '', state.phoenixTubeChallenge.actorName + ' sent you to PHOENIXTube. Your PHOENIX match stays open while you watch.'));
       const open = el('button', 'online-primary', 'OPEN PHOENIXTUBE');
       open.type = 'button';
       open.onclick = () => window.open('/phoenixtube.html?token=' + encodeURIComponent(state.phoenixTubeChallenge.token), '_blank', 'noopener');
       const back = el('button', 'online-secondary', 'RETURN TO PHOENIXTUBE');
       back.type = 'button'; back.onclick = () => window.open('/phoenixtube.html?token=' + encodeURIComponent(state.phoenixTubeChallenge.token), '_blank', 'noopener');
       box.append(open, back, el('small', '', 'You have ten minutes. These controls are private to you.'));
        actions.append(box);
      }
      if (state.gameMode === 'foogle' && renderFoogleTurn(actions)) return;

    if (state.over) {
      if (state.gameMode === 'foogle') {
        const cooperative = el('div', 'phoenix-victory');
        cooperative.append(el('h1', '', state.foogleChallenge && state.foogleChallenge.victory ? '🧩 YOU ALL WIN! 🧩' : 'CHALLENGE INCOMPLETE'));
        cooperative.append(el('p', '', state.foogleChallenge && state.foogleChallenge.victory ? 'THE TRUTH HAS BEEN REVEALED' : 'The team did not finish THE PUZZLE before the round limit.'));
        const image=el('img','phoenix-victory-display'); image.src='assets/phoenix.jpg'; image.alt='Phoenix the leopard gecko'; cooperative.append(image);
        actions.append(cooperative); return;
      }
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

          const line = el(
            'p',
            '',
            medal + ' ' + player.name +
            ' & ' +
            allyShown +
            ' — ' +
            player.points.toLocaleString() +
            ' points'
          );
          const placeBadges = badgesFor(player);
          if (placeBadges) line.appendChild(placeBadges);
          standings.append(line);
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
    if (state.noEvilPermanent) {
      actions.append(el('p', 'online-restricted',
        '🖤 The wheel has banned you from Evil cards for the rest of this match.'
      ));
    }

    if (!state.acting) {
      const chooser=state.pending && state.players.find(p=>p.id===state.pending.chooserId);
      // A HOSTAGE is told that their captor is playing their turn, so the
      // silence is explained rather than mysterious.
      const held = state.hostage && state.players.find(p=>p.id===state.hostage.hostageId);
      if (held && held.id === (state.players[state.seat] || {}).id) {
        const criminal = state.players.find(p=>p.id===state.hostage.criminalId);
        actions.append(el('p', 'online-hostage-note',
          '🔒 You are being held hostage. ' + (criminal ? criminal.name : 'Your captor') + ' is playing your turn.'));
        return;
      }
      actions.append(el('p', '', chooser ? 'Waiting for '+chooser.name+' to make the required choice.' : 'Waiting for your turn.'));
      return;
    }

    // A HOSTAGE'S TURN: the criminal plays it, from the hostage's hand.
    const hostageHand = state.hostageHand || null;
    if (hostageHand) {
      const hostage = state.hostage && state.players.find(function (p) { return p.id === state.hostage.hostageId; });
      actions.append(el('p', 'online-hostage-note',
        '🔒 You are the criminal. You are playing ' + (hostage ? hostage.name : 'the hostage') +
        "'s turn, and these are their cards."));
    }

    actions.append(el(
      'h3',
      '',
      hostageHand ? 'Choose a card for the hostage'
        : state.pending && state.pending.kind==='burn' ? 'Choose a card to destroy — Alvin'
        : state.pending ? 'Choose the card for this stolen turn'
        : 'Your turn — choose a card'
    ));

    // THE PRESIDENT'S POLICY MENU. Bans bind everybody, the President
    // included, and the President may only pass one on their own turn.
    if (state.president) {
      const president = state.president;
      const isPresident = president.id === (state.players[state.seat] || {}).id;
      const myTurn = state.acting;
      const policy = el('div', 'online-policy');
      policy.appendChild(el('h3', '', 'PRESIDENTIAL POLICY'));
      policy.appendChild(el(
        'p',
        'online-policy-note',
        isPresident
          ? 'You are President. Pass a ban on your own turn, and lift one on anybody else\'s turn.'
          : playerName(president.id) + ' is President. ' + (state.bannedCards || []).length + ' card type(s) banned.'
      ));
      const cards = window.PhoenixCards;
      if (cards) {
        const banned = state.bannedCards || [];
        cards.CARDS.filter(function (c) {
          return !c.ownerOnly && c.inDeck !== false && c.inLiveGame !== false;
        }).forEach(function (card) {
          const row = el('div', 'online-policy-row');
          row.appendChild(el('span', '', card.name));
          const isBanned = banned.indexOf(card.id) !== -1;
          if (isBanned) {
            row.appendChild(el('span', 'online-policy-banned', 'BANNED'));
            if (isPresident && !myTurn) {
              const lift = el('button', 'online-secondary', 'LIFT');
              lift.type = 'button';
              lift.onclick = function () { send({ type: 'president_ban', cardId: card.id, remove: true }); };
              row.appendChild(lift);
            }
          } else if (isPresident && myTurn) {
            const ban = el('button', 'online-secondary', 'BAN');
            ban.type = 'button';
            ban.onclick = function () { send({ type: 'president_ban', cardId: card.id }); };
            row.appendChild(ban);
          }
          actions.appendChild(row);
        });
      }
      actions.appendChild(policy);
    }

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
        const bannedByMaple = state.mapleBlocked && state.mapleBlocked.indexOf(cardId) !== -1;
        const bannedByEvil = !!(state.noEvilPermanent && window.PhoenixCards.isEvil(cardId));
        if (bannedByMaple || bannedByEvil) {
          const blockedFace = cardFace(card, false);
          blockedFace.classList.add('online-blocked');
          blockedFace.title = bannedByMaple
            ? 'Maple will not let you play this - nice cards only.'
            : 'The wheel has banned you from Evil cards.';
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
    if (fooglePuzzleWindow && !fooglePuzzleWindow.closed && s.foogleChallenge) fooglePuzzleWindow.postMessage({type:'foogle-state',state:s.foogleChallenge},window.location.origin);
    if (window.PhoenixMusicPlayer) {
      window.PhoenixMusicPlayer.setMatchActive('online', !$('online-screen').hidden && window.PhoenixMusic.isActiveMatch(s));
    }

    $('online-setup').hidden = true;
    $('online-room').hidden = false;
    $('online-room-code').textContent = s.code;
    $('online-room-mode').textContent =
      s.mode === 'owner' ? 'OWNER & FRIENDS' : (s.gameMode === 'foogle' ? 'FOOGLE CHALLENGE' : 'PUBLIC MULTIPLAYER');

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

    if (s.paused) {
      $('online-phase').textContent = 'MATCH PAUSED — waiting for disconnected players to reconnect';
      $('online-actions').replaceChildren(el('p', '', 'Match paused. Cards and timers resume when every player reconnects. The reconnect window is 10 minutes; an unfinished match awards no win.'));
    }
    else if (s.phase === 'lobby') renderLobby();
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

    // THE MIMIC'S PRANK. The server is holding this player's turn, so their
    // controls are locked until the video is over.
    document.body.classList.toggle('phoenix-rickroll-locked', !!s.watchingVideo);

    // THE DEHYDRATED EFFECT. The target's whole screen turns for two rounds.
    if (window.PhoenixDehydrated) window.PhoenixDehydrated.apply(!!s.dehydrated);

    renderPresidentMenu();
    renderHand();
    renderLog();
    if (window.PhoenixMatchShowcase) window.PhoenixMatchShowcase.decorate('online-screen');
  }

  /**
   * This player's VERIFIED badges, as compact chips, or nothing.
   *
   * The list comes from the server snapshot, which built it from the badges
   * catalogue against the account row at connect time. Nothing here reads a
   * player-supplied string, so no one can put a fake crown next to their own
   * name by typing it. If the badge module is not on this page, this is a
   * no-op - matches must never depend on it.
   */
  /** A player's display name, by their id. */
  function playerName(id) {
    if (!id || !state || !state.players) return '';
    const found = state.players.filter(function (p) { return p.id === id; })[0];
    return found ? found.name : id;
  }

  /** The Mimic's prank. */
  function showMimicRickroll() {
    if (window.PhoenixMimicRickroll) window.PhoenixMimicRickroll.show();
  }

  /**
   * The secret Fake System Shutdown.
   *
   * Every successful card play has an independent five percent chance of
   * triggering it for the player who played the card. It is the browser's
   * own event, entirely inside this page: nothing here asks the operating
   * system for anything, and the browser's own controls are never touched.
   */
  let lastEffectSequence = -1;
  function maybeFakeShutdown(effects) {
    if (!effects || !Array.isArray(effects.events)) return;
    if (effects.sequence === lastEffectSequence) return;
    lastEffectSequence = effects.sequence;
    const played = effects.events.some(function (e) { return e.key && e.type === 'card'; });
    if (!played) return;
    if (window.PhoenixFakeShutdown) window.PhoenixFakeShutdown.maybeTrigger();
  }

  function badgesFor(player) {
    const badges = window.PhoenixBadges;
    if (!badges || typeof badges.chips !== 'function') return null;
    return badges.chips(player && player.badges);
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

      // THE HOSTAGE SITUATION. Everybody can see who is the criminal, who
      // is being held, and who is the police officer.
      const situation = state.hostage;
      if (situation) {
        if (player.id === situation.criminalId) {
          meta.append(el('small', 'online-role online-role-criminal', '🔒 Criminal'));
        } else if (player.id === situation.hostageId) {
          meta.append(el('small', 'online-role online-role-hostage', '⛓️ Hostage'));
        } else if (player.id === situation.officerId) {
          meta.append(el('small', 'online-role online-role-officer', '🚓 Police officer'));
        }
      }

      const seatBadges = badgesFor(player);
      if (seatBadges) meta.append(seatBadges);

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

  /**
   * THE PRESIDENT'S MENU.
   *
   * Every card in the game, with the switch that makes it illegal. It is the
   * President's alone, it is shut while it is their own turn, and they may only
   * change one card a round.
   */
  function renderPresidentMenu() {
    const box = $('online-president');
    if (!box) return;
    const president = state.president;
    const me = state.players[state.seat];
    const isPresident = !!(president && me && president.id === me.id);
    // Only the President sees it at all.
    box.hidden = !isPresident;
    if (!isPresident) {
      const body = $('online-president-body');
      if (body) body.hidden = true;
      const toggle = $('online-president-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      box.classList.remove('is-open');
      return;
    }

    const body = $('online-president-body');
    const toggle = $('online-president-toggle');
    const hint = $('online-president-hint');
    const note = $('online-president-note');
    const list = $('online-president-cards');
    if (!body || !toggle || !list) return;

    const banned = state.bannedCards || [];
    const locked = !!state.presidentTurn || !!state.presidentChanged;

    if (hint) hint.textContent = '';
    if (note) {
      note.textContent = state.presidentTurn
        ? 'You are President and it is your turn. Take it - the law you have made applies to you as well.'
        : state.presidentChanged
          ? 'You have already changed the law this round. Wait a full round before you change it again.'
          : 'Make a card illegal and nobody may play it - including you. You may change one card a round.';
    }

    list.replaceChildren();
    const Cards = window.PhoenixCards;
    const Art = window.PhoenixCardCinematicArt;
    if (!Cards) return;
    Cards.CARDS.forEach(function (card) {
      const row = el('div', 'online-president-card');
      // The card as the card itself, not a line of text.
      const face = el('span', 'online-president-card-face');
      face.innerHTML = (Art && Art.icon) ? Art.icon(card.id) : '';
      face.setAttribute('aria-hidden', 'true');
      row.appendChild(face);
      const name = el('span', 'online-president-card-name', card.name);
      row.appendChild(name);
      const illegal = banned.indexOf(card.id) !== -1;
      const button = el('button', 'online-president-toggle-button ' + (illegal ? 'is-illegal' : ''), illegal ? 'MAKE LEGAL' : 'MAKE ILLEGAL');
      button.type = 'button';
      button.disabled = !!locked;
      button.title = illegal ? 'Let this card be played again' : 'Nobody may play this card';
      button.onclick = function () {
        send({ type: 'president_ban', cardId: card.id });
      };
      row.appendChild(button);
      list.appendChild(row);
    });
  }

  function renderHand() {
    const hand = $('online-hand');
    hand.replaceChildren();

    if (!state.started) return;

    // A HOSTAGE'S HAND. The criminal is the one who chooses from it, so it
    // is shown to them while they hold the hostage.
    const hostageHand = state.hostageHand || null;
    const shownHand = hostageHand || state.hand;
    hand.append(el('h3', '', hostageHand ? 'The hostage\'s hand — you choose for them' : 'Your private hand'));

    // A grid of real card faces, not a list of words. Ted's fog wins over
    // everything: if the server says this hand is concealed, no card in it is
    // drawn, whatever it actually is.
    const grid = el('div', 'online-card-grid online-private-cards');

    shownHand.forEach((id, index) => {
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

    // THE PRESIDENT'S MENU opens and shuts.
    const presidentToggle = $('online-president-toggle');
    if (presidentToggle) {
      presidentToggle.onclick = () => {
        const body = $('online-president-body');
        if (!body) return;
        const open = body.hidden;
        body.hidden = !open;
        presidentToggle.setAttribute('aria-expanded', String(open));
        const box = $('online-president');
        if (box) box.classList.toggle('is-open', open);
      };
    }
    $('online-create').onclick = openHostSettings;
    $('online-join').onclick = () => join('join');

    // Owner & Friends, kept separate from the public lobby system.
    $('online-mode-public').onclick = () => setMode('public');
    $('online-mode-owner').onclick = () => setMode('owner');
    $('online-owner-create').onclick = () => openHostSettings('owner');
    $('online-owner-join').onclick = () => join('ownerJoin');

    const lobbyMode = $('online-game-mode');
    const lobbyRounds = $('online-lobby-rounds');
    const longRounds = $('online-long-rounds');
    const longLabel = $('classic-long-toggle');
    function refreshLobbySettings() {
      if (!lobbyMode || !lobbyRounds) return;
      const foogle = lobbyMode.value === 'foogle';
      if (longLabel) longLabel.hidden = foogle;
       const values = [5,10,15,20,25,30,35,40,45,50,'custom'];
      const selected = Number(lobbyRounds.value) || 10;
      lobbyRounds.replaceChildren(...values.map(value => { const option=document.createElement('option'); option.value=String(value); option.textContent=String(value); return option; }));
       lobbyRounds.value = values.includes(selected) ? String(selected) : '10';
       const estimate = $('online-duration-estimate');
       if (estimate) { const count=lobbyRounds.value==='custom'?Math.min(100,Math.max(5,Number($('online-rounds-custom')?.value)||55)):Number(lobbyRounds.value); const minutes=Math.ceil(count*1.5); estimate.textContent='Estimated duration: approximately '+minutes+'–'+(minutes*2)+' minutes'+(foogle?' · cooperative puzzle may finish earlier':''); }
    }
    if (lobbyMode) lobbyMode.addEventListener('change', refreshLobbySettings);
    if (longRounds) longRounds.addEventListener('change', refreshLobbySettings);
    if (lobbyRounds) lobbyRounds.addEventListener('change', refreshLobbySettings);
    refreshLobbySettings();

    // Admin entry points: the SERVER button on the multiplayer screen and the
    // OWNER DASHBOARD button on the main menu both open the same dashboard.
    const adminBtn = $('online-admin');
    if (adminBtn) adminBtn.onclick = openAdmin;
    const ownerMenuBtn = $('menu-owner');
    if (ownerMenuBtn) ownerMenuBtn.onclick = openAdmin;

const roundsSelect = $('online-rounds');
    if (roundsSelect) {
      roundsSelect.addEventListener('change', () => {
        const customInput = $('online-rounds-custom');
        if (customInput) {
          // `hidden` rather than a style: the input is a real control, and a
          // style-based toggle left it focusable and unlabelled in some
          // browsers.
          customInput.hidden = roundsSelect.value !== 'custom';
          if (roundsSelect.value === 'custom' && customInput.focus) {
            customInput.focus();
            if (customInput.select) customInput.select();
          }
        }
      });
    }

    $('online-copy').onclick = () => {
      if (!state) return;
      navigator.clipboard.writeText(state.code)
        .then(() => feedback('Invite code copied!'))
        .catch(() => feedback('Invite code: ' + state.code));
    };

    // Admin panel buttons
    const closeAllBtn = $('admin-close-all');
    if (closeAllBtn) closeAllBtn.onclick = () => send({ type: 'admin_shutdown_all' });

    // The ban screen's CLOSE. It dismisses the panel and nothing else: the
    // server has already closed the socket, so there is no game left behind
    // it to return to, and closing the notice never un-bans anybody.
    const banClose = $('ban-close');
    if (banClose) banClose.onclick = () => {
      hideBanScreen();
      const online = $('online-screen');
      if (online) online.hidden = true;
      if ($('phoenix-menu')) $('phoenix-menu').hidden = false;
      if ($('menu-feedback')) {
        $('menu-feedback').textContent =
          'Your access to PHOENIX is restricted. Only the owner can lift it.';
      }
    };
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
    // A refresh restores only this tab's secret saved seat. It does not join by
    // name or bypass the normal account/verification gate on the server.
    if (resumeSession) {
      const ready = window.PhoenixAccount && window.PhoenixAccount.refresh
        ? window.PhoenixAccount.refresh() : Promise.resolve();
      ready.then(() => { if (resumeSession) enter(); }).catch(() => {});
    }
  });

  window.PhoenixOnline = { enter, leave, join, openAdmin, openHostSettings, getState: () => state };
})();
