/* PHOENIX — browser half of the Phase 2 badge system.
 *
 * Renders the player's own badge collection, their three featured slots, and
 * a public "who really is the owner" lookup.
 *
 * SECURITY NOTE. Everything on screen is built from fields the SERVER sent
 * (name / rarity / description straight from the badges catalogue). Nothing
 * here ever renders a badge from a string the user typed, and the equip rules
 * are re-checked server-side regardless of what this file believes.
 */
(function () {
  'use strict';

  var state = {
    available: true,
    isOwner: false,
    catalogue: [],
    owned: [],
    featured: [null, null, null],
    draft: [null, null, null],
    profile: null,
    // What the SERVER says this session may award. Empty for everyone who is
    // not the owner, and empty until the badge seed migration has run.
    awardable: []
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text; // never innerHTML
    return node;
  }

  function api(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    }, opts || {})).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    });
  }

  /* ---------- the badge itself (DOM only, catalogue data only) ------------- */

  /** Three featured slots, and never more: the same limit the server enforces. */
  var MAX_FEATURED = 3;

  var RARITY_LABEL = {
    common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC',
    legendary: 'LEGENDARY', impossible: 'IMPOSSIBLE', divine: 'DIVINE'
  };

  /** The crowned, flame-wrapped crest used for Divine badges. */
  function crest() {
    var c = el('div', 'badge-crest');
    c.setAttribute('aria-hidden', 'true');

    var flames = el('div', 'badge-flames');
    for (var i = 0; i < 5; i++) flames.appendChild(el('span', 'badge-flame'));
    c.appendChild(flames);

    var crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    crown.setAttribute('viewBox', '0 0 64 44');
    crown.setAttribute('class', 'badge-crown');
    crown.setAttribute('aria-hidden', 'true');
    crown.innerHTML =
      '<path d="M6 36 L3 11 L17 22 L32 5 L47 22 L61 11 L58 36 Z" ' +
      'fill="url(#phoenixGold)" stroke="#7a5312" stroke-width="1.6" ' +
      'stroke-linejoin="round"/>' +
      '<rect x="6" y="34" width="52" height="7" rx="3" ' +
      'fill="url(#phoenixGold)" stroke="#7a5312" stroke-width="1.6"/>' +
      '<defs><linearGradient id="phoenixGold" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffe9a8"/>' +
      '<stop offset="0.5" stop-color="#ffc93c"/>' +
      '<stop offset="1" stop-color="#d98c1a"/>' +
      '</linearGradient></defs>';
    c.appendChild(crown);
    return c;
  }

  /** One badge tile. `badge` is always a server catalogue row. */
  function badgeTile(badge, opts) {
    opts = opts || {};
    var rarity = (badge.rarity || 'common').toLowerCase();
    var tile = el('article', 'badge-tile badge--' + rarity + (opts.compact ? ' is-compact' : ''));
    tile.setAttribute('data-badge-key', badge.key);
    tile.setAttribute('data-rarity', rarity);

    if (rarity === 'divine') tile.appendChild(crest());

    var name = el('div', 'badge-name', badge.name);
    var tier = el('div', 'badge-rarity', RARITY_LABEL[rarity] || rarity.toUpperCase());
    tile.appendChild(name);
    tile.appendChild(tier);

    if (!opts.compact) {
      tile.appendChild(el('p', 'badge-desc', badge.description));
    }
    return tile;
  }

  /**
   * One COMPACT badge marker - for match seats, the lobby roster and anywhere
   * there is no room for a full tile.
   *
   * Same rarity classes as the tiles, so a badge looks like itself wherever it
   * turns up: a gold pill with a crown for Divine, a tier-coloured pill for
   * everything else. The label is the rarity, which is what a player needs to
   * read at a glance during a match.
   *
   * `badge` is always a server catalogue row (key/name/rarity). It is written
   * with textContent, never innerHTML, so nothing a player typed can reach the
   * screen through this function.
   */
  function badgeChip(badge) {
    if (!badge || typeof badge !== 'object') return null;

    var rarity = String(badge.rarity || 'common').toLowerCase();
    var label = RARITY_LABEL[rarity] || rarity.toUpperCase();
    var name = badge.name ? String(badge.name) : '';

    var chip = el('span', 'badge-chip badge--' + rarity);
    if (badge.key) chip.setAttribute('data-badge-key', String(badge.key));
    chip.setAttribute('data-rarity', rarity);
    chip.setAttribute('title', (name ? name + ' \u00b7 ' : '') + label);

    if (rarity === 'divine') {
      var mark = el('span', 'badge-chip-mark', '\uD83D\uDC51'); // crown
      mark.setAttribute('aria-hidden', 'true');
      chip.appendChild(mark);
    }

    if (name) chip.appendChild(el('span', 'badge-chip-name', name));
    chip.appendChild(el('span', 'badge-chip-rarity', label));
    return chip;
  }

  /**
   * Every badge in `list`, as chips inside ONE wrapper element, capped at
   * three. Returns null when there is nothing to show so callers can simply
   * skip appending.
   *
   * A single wrapper rather than a fragment: it gives the layout somewhere to
   * apply its gap, and it keeps every DOM the game runs on - the real one and
   * the headless one the tests use - to plain append.
   *
   * Defensive about shape: a missing or malformed list renders as "no badges"
   * rather than throwing inside a match render loop.
   */
  function badgeChips(list) {
    if (!Array.isArray(list) || !list.length) return null;

    var group = el('span', 'badge-chips');
    var shown = 0;
    for (var i = 0; i < list.length && shown < MAX_FEATURED; i++) {
      var chip = badgeChip(list[i]);
      if (chip) { group.appendChild(chip); shown++; }
    }
    return shown ? group : null;
  }

  /* ---------- rendering ---------------------------------------------------- */

  function setFeedback(message, isError) {
    var node = $('badge-feedback');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', !!isError);
  }

  function renderSlots() {
    var grid = $('badge-featured');
    if (!grid) return;
    grid.textContent = '';

    for (var i = 0; i < 3; i++) {
      var badge = state.draft[i];
      var cell = el('div', 'badge-slot');
      cell.appendChild(el('span', 'badge-slot-label', 'SLOT ' + (i + 1)));

      if (badge) {
        cell.appendChild(badgeTile(badge, { compact: true }));
        // Slot 1 belongs to THE PHOENIX for the owner and is not removable.
        if (!(i === 0 && state.isOwner)) {
          var clear = el('button', 'badge-slot-clear', '×');
          clear.type = 'button';
          clear.setAttribute('aria-label', 'Remove ' + badge.name + ' from slot ' + (i + 1));
          clear.onclick = (function (index) {
            return function () { state.draft[index] = null; renderSlots(); };
          })(i);
          cell.appendChild(clear);
        } else {
          cell.appendChild(el('span', 'badge-slot-lock', 'PERMANENT'));
        }
      } else {
        cell.appendChild(el('div', 'badge-slot-empty', 'EMPTY'));
      }
      grid.appendChild(cell);
    }
  }

  function renderCollection() {
    var grid = $('badge-collection');
    if (!grid) return;
    grid.textContent = '';

    if (!state.owned.length) {
      grid.appendChild(el('p', 'badge-empty', 'No badges yet. Badges are earned in game.'));
      return;
    }

    state.owned.forEach(function (badge) {
      var tile = badgeTile(badge);
      var featured = state.draft.some(function (b) { return b && b.key === badge.key; });
      var locked = badge.key === 'phoenix' && state.isOwner;

      var action = el('button', 'badge-equip', locked ? 'ALWAYS ON' : (featured ? 'UNEQUIP' : 'FEATURE'));
      action.type = 'button';
      action.disabled = !!locked;
      action.setAttribute('aria-label',
        (featured ? 'Unequip ' : 'Equip ') + badge.name);

      action.onclick = function () {
        if (locked) return;
        var at = -1;
        for (var i = 0; i < state.draft.length; i++) {
          if (state.draft[i] && state.draft[i].key === badge.key) at = i;
        }
        if (at >= 0) {
          state.draft[at] = null;
        } else {
          var free = -1;
          for (var j = 0; j < state.draft.length; j++) {
            if (!state.draft[j] && !(j === 0 && state.isOwner)) free = j;
          }
          if (free < 0) {
            setFeedback('All three slots are full. Remove one first.', true);
            return;
          }
          state.draft[free] = badge;
        }
        setFeedback('');
        renderSlots();
        renderCollection();
      };

      tile.appendChild(action);
      grid.appendChild(tile);
    });
  }

  function render() {
    var save = $('badge-save');
    if (save) save.disabled = !state.available;
    renderSlots();
    renderCollection();
    renderProfile();
    renderAward();
  }

  /**
   * The award panel: owner only, and only for a badge the server actually has
   * to give.
   *
   * Two independent conditions, both server-supplied. `isOwner` comes from
   * accounts.role, and `awardable` is the server's allowlist resolved against
   * the catalogue - so the panel cannot appear because the page was edited,
   * and cannot appear before sql/played-with-owner-badge.sql has been run.
   */
  function renderAward() {
    var panel = $('badge-award-panel');
    if (!panel) return;

    var badge = state.awardable && state.awardable[0];
    var show = !!state.isOwner && !!badge;
    panel.hidden = !show;
    if (!show) return;

    var note = $('badge-award-note');
    if (note) {
      note.textContent = '';
      note.appendChild(el('strong', '', badge.name));
      note.appendChild(document.createTextNode(
        ' \u2014 ' + (badge.description || '') +
        ' Type the player\u2019s username below. It goes straight into their ' +
        'collection, and they choose whether to feature it.'
      ));
    }
  }

  function renderProfile() {
    var out = $('badge-profile-result');
    if (!out) return;
    out.textContent = '';

    var p = state.profile;
    if (p === undefined) return;
    if (p === null) return;

    var card = el('div', 'badge-profile-card');
    var head = el('div', 'badge-profile-head');
    head.appendChild(el('span', 'badge-profile-name', p.username));

    if (p.isOwner) {
      // Rendered from a SERVER-derived flag on a SERVER-owned account row.
      var mark = el('span', 'badge-owner-mark');
      mark.appendChild(document.createTextNode('VERIFIED OWNER '));
      mark.appendChild(el('span', 'badge-owner-crown', '👑'));
      head.appendChild(mark);
    } else {
      head.appendChild(el('span', 'badge-not-owner', 'PLAYER'));
    }
    card.appendChild(head);

    var any = false;
    p.featured.forEach(function (badge) {
      if (badge) { card.appendChild(badgeTile(badge)); any = true; }
    });
    if (!any) card.appendChild(el('p', 'badge-empty', 'This player features no badges.'));
    out.appendChild(card);
  }

  /* ---------- server calls ------------------------------------------------- */

  function load() {
    if (!window.PhoenixAccount) return Promise.resolve();
    return api('/api/badges').then(function (r) {
      var d = r.data || {};
      if (!d.ok || d.available === false) {
        state.available = false;
        setFeedback('Badges are not available right now.', true);
        render();
        return;
      }
      state.available = true;
      state.isOwner = !!d.isOwner;
      state.catalogue = d.catalogue || [];
      state.owned = d.owned || [];
      state.featured = d.featured || [null, null, null];
      state.draft = state.featured.slice();
      state.awardable = Array.isArray(d.awardable) ? d.awardable : [];
      setFeedback('');
      render();
    }).catch(function () {
      setFeedback('Could not reach the server. Try again.', true);
    });
  }

  function save() {
    var save = $('badge-save');
    if (save) save.disabled = true;
    setFeedback('Saving…');

    api('/api/badges/feature', {
      method: 'POST',
      body: JSON.stringify({
        slots: state.draft.map(function (b) { return b ? b.key : null; })
      })
    }).then(function (r) {
      var d = r.data || {};
      if (!d.ok) {
        setFeedback(d.message || 'Could not save your badges.', true);
        // Trust the server's version of events over our optimistic draft.
        if (d.available !== false) load(); else render();
        return;
      }
      state.featured = d.featured || state.featured;
      state.draft = state.featured.slice();
      setFeedback('Featured badges saved.');
      render();
    }).catch(function () {
      setFeedback('Could not reach the server. Try again.', true);
    }).then(function () {
      if (save) save.disabled = false;
    });
  }

  function lookup() {
    var input = $('badge-profile-input');
    var name = input ? input.value.trim() : '';
    if (!name) { setFeedback('Enter a username to verify.', true); return; }
    setFeedback('Checking…');

    api('/api/badges/profile?username=' + encodeURIComponent(name)).then(function (r) {
      var d = r.data || {};
      if (!d.ok) {
        state.profile = null;
        setFeedback(d.message || 'Could not look up that player.', true);
        renderProfile();
        return;
      }
      state.profile = d.profile;
      setFeedback('');
      renderProfile();
    }).catch(function () {
      setFeedback('Could not reach the server. Try again.', true);
    });
  }

  /**
   * Award the allowlisted badge to the player named in the field.
   *
   * This sends a username and a badge key - nothing else. Every decision
   * (is this session the owner, does this badge exist, may it be awarded, does
   * that account exist) is made on the server, and the panel it lives in is
   * only a convenience: a non-owner who posts to the endpoint anyway gets the
   * same refusal from the role check.
   */
  function award() {
    var badge = state.awardable && state.awardable[0];
    if (!badge) return;

    var input = $('badge-award-input');
    var name = input ? input.value.trim() : '';
    if (!name) {
      setFeedback('Enter the username of the player to award it to.', true);
      return;
    }

    setFeedback('Awarding\u2026');

    api('/api/badges/award', {
      method: 'POST',
      body: JSON.stringify({ username: name, badgeKey: badge.key })
    }).then(function (r) {
      var d = r.data || {};
      if (!d.ok) {
        setFeedback(d.message || 'Could not award that badge.', true);
        if (d.available === false) load();
        return;
      }
      if (input) input.value = '';
      // d.username is the account's stored name, not what was typed.
      setFeedback(d.alreadyHad
        ? d.username + ' already has ' + badge.name + '.'
        : 'Awarded ' + badge.name + ' to ' + d.username +
          '. They can feature it from their own badge screen.');
    }).catch(function () {
      setFeedback('Could not reach the server. Try again.', true);
    });
  }

  /* ---------- open / close ------------------------------------------------- */

  function open() {
    var overlay = $('badge-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('badge-open');
    setFeedback('');
    state.profile = null;
    load();
    var first = $('badge-close');
    if (first) first.focus();
  }

  function close() {
    var overlay = $('badge-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('badge-open');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var opener = $('menu-badges');
    if (opener) {
      opener.onclick = function () {
        // Signing in first keeps the badge screen from opening on a session
        // that has not been established yet.
        if (window.PhoenixAccount && window.PhoenixAccount.requireLogin) {
          window.PhoenixAccount.requireLogin(open);
        } else {
          open();
        }
      };
    }
    var closeBtn = $('badge-close');
    if (closeBtn) closeBtn.onclick = close;

    var overlay = $('badge-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) close();
    });

    var saveBtn = $('badge-save');
    if (saveBtn) saveBtn.onclick = save;

    var findBtn = $('badge-profile-find');
    if (findBtn) findBtn.onclick = lookup;

    // The security notice's "who really owns PHOENIX" link opens the same
    // badge screen, focused on the verification section.
    var verifyBtn = $('menu-security-verify');
    if (verifyBtn) {
      verifyBtn.onclick = function () {
        open();
        var input = $('badge-profile-input');
        if (input) input.focus();
      };
    }

    var profileInput = $('badge-profile-input');
    if (profileInput) {
      profileInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); lookup(); }
      });
    }

    // Owner-only award controls. Hidden unless renderAward() revealed them,
    // but harmless either way: the server decides who may award what.
    var awardBtn = $('badge-award-give');
    if (awardBtn) awardBtn.onclick = award;

    var awardInput = $('badge-award-input');
    if (awardInput) {
      awardInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); award(); }
      });
    }
  });

  window.PhoenixBadges = {
    open: open,
    close: close,
    reload: load,
    // Compact markers, shared with the match UI so a badge renders the same
    // way in a seat as it does on the badge screen.
    chips: badgeChips,
    chip: badgeChip
  };
})();
