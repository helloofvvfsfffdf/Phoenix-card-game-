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
    profile: null
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
  });

  window.PhoenixBadges = { open: open, close: close, reload: load };
})();
