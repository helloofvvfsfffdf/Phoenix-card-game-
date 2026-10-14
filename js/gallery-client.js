/*
 * Phoenix - gallery-client.js
 * ---------------------------------------------------------------------------
 * PHOENIX Gallery: the browser half. The doorway and the browsing.
 *
 * NOTHING IN THE BROWSING HALF SENDS ANYTHING
 * --------------------------------------------
 * Opening a card, switching section, going back to the overview - none of it
 * touches the WebSocket. All of it is local DOM state on this page.
 *
 * That is not a shortcut, it is the whole design. If a click produced a message,
 * two visitors would share a room and one of them opening a card would move
 * everybody else's screen, which is precisely what a gallery must not do. The
 * only three messages this file ever sends are gallery_create, gallery_join and
 * gallery_close, all of them at the doorway.
 *
 * THE CONTENT IS NOT SENT EITHER
 * ------------------------------
 * Every ally and card is already on this page as ordinary script - PhoenixAllies,
 * PhoenixCards, PhoenixMaple. The gallery renders those catalogues and adds no
 * data of its own, so there is nothing private for a gallery visitor to receive
 * and nothing for a leak to carry. That also satisfies "use the existing
 * definitions as the source of truth" in the strongest possible way: there is
 * only one copy of every description.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  // Per-visit state. Deliberately local: this is what keeps two visitors
  // independent, because none of it is ever shared with anybody.
  let tab = 'allies';
  let openItem = null;
  let isOwner = false;
  let code = '';

  function make(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function hideAll() {
    $('phoenix-menu').hidden = false;
    $('phoenix-game').hidden = true;
    $('game-toolbar').hidden = true;
    $('gallery-gate').hidden = true;
    $('gallery').hidden = true;
    if (window.PhoenixMusicPlayer) window.PhoenixMusicPlayer.setMatchActive('local', false);
  }

  /* --------------------------------------------------------------------- */
  /* The doorway                                                             */
  /* --------------------------------------------------------------------- */

  function gateMessage(text) {
    $('gallery-gate-feedback').textContent = text || '';
  }

  /**
   * The CREATE panel's visibility, and whether it needs a password.
   *
   * Production (accounts configured): the SERVER grants access from the
   * session's verified owner role, so no password is asked and the field is
   * not rendered at all.
   *
   * A server with no account system has no owner role to read, so it keeps the
   * original password field. That is local development only - and even there
   * the server still validates the secret; nothing is opened by the page.
   *
   * Either way this is cosmetic. The server refuses gallery_create for anyone
   * it does not accept, whatever the page chooses to display.
   */
  function ownerAccess() {
    const accounts = window.PhoenixAccount;
    const configured = !!(accounts && accounts.available && accounts.available());

    if (configured) {
      const account = accounts.current ? accounts.current() : null;
      return {
        isOwner: !!(account && account.role === 'owner'),
        needsPassword: false
      };
    }

    return { isOwner: true, needsPassword: true };
  }

  function openGate() {
    hideAll();
    gateMessage('');
    $('gallery-gate').hidden = false;
    $('gallery-code-input').value = '';

    const access = ownerAccess();
    setNode('gallery-create-panel', function (node) { node.hidden = !access.isOwner; });

    // Defensive throughout: a headless test harness supplies stub nodes with no
    // children and no methods, and the doorway must open there just the same.
    const input = $('gallery-owner-password');
    if (input) {
      const field = $('gallery-owner-password-field');
      if (field) field.hidden = !access.needsPassword;
      input.value = '';
    }

    const copy = $('gallery-create-copy');
    if (copy && copy.textContent !== undefined) {
      copy.textContent = access.needsPassword
        ? 'Enter the owner password. You will get a six-character invitation code to share.'
        : 'You are signed in as the owner of PHOENIX. Open a gallery and you will get a six-character invitation code to share.';
    }

    const focusTarget = access.isOwner ? $('gallery-create') : $('gallery-code-input');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  }

  /** Runs `fn` on an element only if it actually exists. */
  function setNode(id, fn) {
    const node = $(id);
    if (node) fn(node);
  }

  /**
   * Sends one gallery message.
   *
   * There is no socket of the gallery's own - it reuses the multiplayer socket,
   * and gallery messages are answered before the socket ever looks at ws.member.
   */
  function send(message) {
    window.PhoenixNet.send(message);
  }

  /* --------------------------------------------------------------------- */
  /* Browsing                                                                */
  /* --------------------------------------------------------------------- */

  /** Every ally, Maple included, in one list. */
  function allyList() {
    const allies = window.PhoenixAllies;
    const out = (allies.roster || []).slice();
    if (allies.maple) out.push(allies.maple);
    return out;
  }

  /**
   * Maple is the odd one out, and the gallery has to say so plainly: she is not on
   * the draftable list, has no owner, and acts on her own. That is not an opinion
   * - server.js keeps her out of ALLIES - and the wording here says which.
   *
   * The pronoun comes from the catalogue (`ally.pronoun`), never from the ally's
   * name: Ted is "him", Phoenix is "her", and neither is guessed here.
   */
  function allyFacts(ally) {
    const facts = [];
    const pronoun = ally.pronoun || 'them';

    if (ally.id === 'maple') {
      facts.push('Neutral · belongs to nobody · cannot be drafted');
      facts.push('Independent — ' + (ally.pronoun === 'him' ? 'he' : 'she') +
                 ' rolls once every round on ' + (ally.pronoun === 'him' ? 'his' : 'her') + ' own');
    } else {
      facts.push('Draftable · one player holds ' + pronoun);
    }

    return facts;
  }

  /** What Sweet Tooth actually forbids, read from the rule rather than restated. */
  function mapleRules() {
    const maple = window.PhoenixMaple;
    if (!maple) return [];

    const cards = (maple.NOT_NICE || []).map(id => {
      const card = window.PhoenixCards.byId(id);
      return card ? card.name : id;
    });

    return [
      maple.CHANCE_PERCENT + '% chance each round to force a random player to play only nice cards.',
      'Lasts ' + maple.ROUNDS + ' rounds.',
      'Off the menu: ' + cards.join(', ') + '.'
    ];
  }

  function renderAllies(view) {
    view.appendChild(make('p', 'gallery-note',
      'Every companion in PHOENIX. One player brings one to a match, except Maple, ' +
      'who belongs to nobody. Photographs and wording are the game\'s own.'));

    const grid = make('div', 'gallery-grid');

    allyList().forEach(ally => {
      const tile = make('button', 'gallery-tile gallery-ally');
      tile.type = 'button';
      tile.style.setProperty('--ally-color', ally.color || '#7ed6df');

      const photo = make('img', 'gallery-photo');
      photo.src = ally.src;
      photo.alt = ally.name + ' portrait';
      tile.appendChild(photo);

      tile.appendChild(make('strong', '', ally.name));
      tile.appendChild(make('em', '', ally.title));
      if (ally.id === 'maple') tile.appendChild(make('span', 'gallery-tag', 'NEUTRAL'));

      tile.addEventListener('click', () => showAlly(ally.id));
      grid.appendChild(tile);
    });

    view.appendChild(grid);
  }

  function showAlly(id) {
    openItem = { kind: 'ally', id: id };
    renderDetail();
  }

  function renderAllyDetail(view) {
    const ally = allyList().filter(a => a.id === openItem.id)[0];
    if (!ally) return renderTab();

    const detail = make('div', 'gallery-detail');

    const photo = make('img', 'gallery-detail-photo');
    photo.src = ally.src;
    photo.alt = ally.name + ' portrait';
    photo.style.setProperty('--ally-color', ally.color || '#7ed6df');
    detail.appendChild(photo);

    const body = make('div', 'gallery-detail-body');
    body.appendChild(make('h2', '', ally.name));
    body.appendChild(make('p', 'gallery-detail-title', ally.title));
    body.appendChild(make('p', 'gallery-detail-desc', ally.desc));

    const facts = make('ul', 'gallery-facts');
    allyFacts(ally).forEach(fact => facts.appendChild(make('li', '', fact)));
    body.appendChild(facts);

    if (ally.id === 'maple') {
      const rules = make('ul', 'gallery-facts gallery-facts-rules');
      mapleRules().forEach(rule => rules.appendChild(make('li', '', rule)));
      body.appendChild(rules);
    }

    detail.appendChild(body);
    view.appendChild(detail);
  }

  function renderCards(view) {
    view.appendChild(make('p', 'gallery-note',
      'Every card in the PHOENOX deck. Click one to read exactly what it does, ' +
      'what it needs, and how long it lasts.'));

    const grid = make('div', 'gallery-grid gallery-grid-cards');
    const cards = window.PhoenixCards.CARDS || [];

    cards.forEach(card => {
      const tile = make('button', 'gallery-tile gallery-card');
      tile.type = 'button';
      tile.setAttribute('data-tone', card.tone);

      // The real card face, not a summary of it: the same markup and stylesheet
      // the game itself uses, so the gallery shows the original design rather than
      // a picture of one.
      tile.appendChild(cardFace(card));

      tile.addEventListener('click', () => showCard(card.id));
      grid.appendChild(tile);
    });

    view.appendChild(grid);
  }

  /**
   * A PHOENIX card face - identical markup to the one the game draws, so the
   * gallery shows the original artwork, corner tag, blurb and badge rather than a
   * reduced copy that could drift from it.
   */
  function cardFace(card) {
    const node = make('div', 'card gallery-card-face');
    node.setAttribute('data-tone', card.tone);

    const corner = make('span', 'card-corner');
    corner.appendChild(make('span', 'card-corner-glyph', card.glyph));
    corner.appendChild(make('span', 'card-corner-tag', card.short));
    node.appendChild(corner);

    const art = make('span', 'card-art');
    if (card.art) {
      // Static markup authored in cards.js, not anything typed in.
      art.innerHTML = card.art;
      const svg = art.querySelector('svg');
      if (svg) {
        svg.classList.add('card-art-art');
        svg.setAttribute('focusable', 'false');
      }
    } else {
      art.appendChild(make('span', 'card-glyph', card.glyph));
    }
    node.appendChild(art);

    node.appendChild(make('span', 'card-name', card.name));
    node.appendChild(make('span', 'card-blurb', card.blurb));
    node.appendChild(make('span', 'card-tag', cardTag(card)));
    return node;
  }

  function cardTag(card) {
    if (card.legendary) return 'Legendary · one use';
    if (card.informational) return 'Information only';
    return card.needsTarget ? 'Needs a target' : 'No target';
  }

  function showCard(id) {
    openItem = { kind: 'card', id: id };
    renderDetail();
  }

  function renderCardDetail(view) {
    const card = (window.PhoenixCards.CARDS || []).filter(c => c.id === openItem.id)[0];
    if (!card) return renderTab();

    const detail = make('div', 'gallery-detail gallery-detail-card');

    const face = make('div', 'gallery-detail-face');
    face.appendChild(cardFace(card));
    detail.appendChild(face);

    const body = make('div', 'gallery-detail-body');
    body.appendChild(make('h2', '', card.name));
    body.appendChild(make('p', 'gallery-detail-desc', card.rule));

    const facts = make('ul', 'gallery-facts');

    facts.appendChild(make('li', '', 'Target: ' + card.targetNote));

    if (card.legendary) {
      facts.appendChild(make('li', '', 'Legendary — one use per game.'));
      facts.appendChild(make('li', '',
        'Never dealt and never drawn: it is held by whoever won the previous game outright.'));
    }

    if (card.oncePerGame) {
      facts.appendChild(make('li', '', 'Lasts once per game.'));
    }

    if (card.reflected) {
      facts.appendChild(make('li', '', 'A Hunter reflects this back at you instead.'));
    }

    if (card.forcedChoice) {
      facts.appendChild(make('li', '',
        'Playing this forces a decision before your turn is finished.'));
    }

    // Maple's Sweet Tooth is the one card interaction worth spelling out, and the
    // list is read from the rule so it cannot go stale.
    const maple = window.PhoenixMaple;
    if (maple && maple.NOT_NICE.indexOf(card.id) !== -1) {
      facts.appendChild(make('li', '',
        'Maple’s Sweet Tooth forbids this card for ' + maple.ROUNDS + ' rounds.'));
    }

    if (card.informational) {
      facts.appendChild(make('li', '', 'Changes nothing on the table — it is information.'));
    }

    body.appendChild(facts);
    detail.appendChild(body);
    view.appendChild(detail);
  }

  function renderTab() {
    const view = $('gallery-view');
    clear(view);
    if (tab === 'allies') renderAllies(view);
    else renderCards(view);
  }

  function renderDetail() {
    const view = $('gallery-view');
    clear(view);

    const back = make('button', 'gallery-back-to-overview', '← BACK TO OVERVIEW');
    back.type = 'button';
    back.addEventListener('click', () => {
      openItem = null;
      render();
    });
    view.appendChild(back);

    if (openItem.kind === 'ally') renderAllyDetail(view);
    else renderCardDetail(view);
  }

  function render() {
    if ($('gallery').hidden) return;
    if (openItem) renderDetail();
    else renderTab();
  }

  /* --------------------------------------------------------------------- */
  /* Opening and closing                                                     */
  /* --------------------------------------------------------------------- */

  function showGallery(session, owner) {
    code = session.code;
    isOwner = !!owner;

    hideAll();
    $('gallery').hidden = false;
    $('gallery-close').hidden = !isOwner;

    $('gallery-code-line').textContent =
      'Invitation code ' + session.code +
      (isOwner ? ' · you opened this gallery' : ' · guest') +
      ' · closes in ' + minutes(session.expiresIn);

    openItem = null;
    render();
  }

  function minutes(ms) {
    return Math.max(1, Math.round((ms || 0) / 60000));
  }

  function onMessage(message, owner) {
    if (!message || !message.type) return;

    if (message.type === 'gallery_open') {
      showGallery(message, owner);
      return;
    }

    if (message.type === 'gallery_closed') {
      leave('The gallery has closed.');
    }
  }

  function leave(message) {
    openItem = null;
    isOwner = false;
    code = '';
    window.PhoenixNet.setGalleryOwner(false);
    hideAll();
    if (message) {
      $('menu-feedback').textContent = message;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Wiring                                                                  */
  /* --------------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', () => {
    $('menu-gallery').addEventListener('click', openGate);
    $('gallery-gate-back').addEventListener('click', leave);
    $('gallery-leave').addEventListener('click', function () { leave(''); });

    $('gallery-create').addEventListener('click', function () {
      const access = ownerAccess();

      // Account servers: send nothing. The SERVER reads the owner role off the
      // session and decides - this file claims nothing on the player's behalf.
      // Servers with no accounts: the original password is still required.
      if (access.needsPassword) {
        const field = $('gallery-owner-password');
        const value = field ? field.value : '';
        if (!value) {
          gateMessage('Enter the owner password.');
          return;
        }
        gateMessage('Checking your password...');
        window.PhoenixNet.setGalleryOwner(true);
        send({ type: 'gallery_create', ownerPassword: value });
        if (field) field.value = '';
        return;
      }

      gateMessage('Opening your gallery...');
      window.PhoenixNet.setGalleryOwner(true);
      send({ type: 'gallery_create' });
    });

    $('gallery-join').addEventListener('click', function () {
      gateMessage('Checking the code...');
      window.PhoenixNet.setGalleryOwner(false);
      const codeInput = $('gallery-code-input');
      send({ type: 'gallery_join', code: codeInput ? codeInput.value : '' });
    });

    // Enter submits from either field, which is how anyone actually types a code.
    const codeInput = $('gallery-code-input');
    if (codeInput) {
      codeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') $('gallery-join').click();
      });
    }
    const passwordInput = $('gallery-owner-password');
    if (passwordInput) {
      passwordInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') $('gallery-create').click();
      });
    }

    $('gallery-close').addEventListener('click', function () {
      send({ type: 'gallery_close' });
    });

    [...document.querySelectorAll('[data-gallery-tab]')].forEach(function (button) {
      button.addEventListener('click', function () {
        tab = button.getAttribute('data-gallery-tab');
        openItem = null;
        document.querySelectorAll('[data-gallery-tab]').forEach(function (other) {
          other.classList.toggle('is-active', other === button);
        });
        render();
      });
    });

    window.PhoenixNet.onGallery(onMessage);
    window.PhoenixNet.onGalleryError(function (text) {
      // A refusal belongs at the doorway: the visitor is still standing in front
      // of it, and never saw a gallery to be disappointed about.
      gateMessage(text);
      window.PhoenixNet.setGalleryOwner(false);
    });
  });

  window.PhoenixGalleryView = {
    open: openGate,
    leave: leave,
    render: render
  };
})();
