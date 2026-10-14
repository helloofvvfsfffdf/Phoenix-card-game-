/* PHOENIX - browser half of the leaderboard.
 *
 * A ranking of PLAYERS by how many online matches they have won. The owner is
 * never on it: js/wins.js leaves them off before the list is built, so there
 * is nothing here that could add them back - this file only ever draws the
 * rows the server chose to send, each username as text.
 *
 * Nothing here is required for a match to run. If this script, its markup or
 * the endpoint are missing, the menu carries on without a leaderboard.
 */
(function () {
  'use strict';

  var state = { available: false, players: [] };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // Usernames are words from the accounts table. textContent, never innerHTML.
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function api(url) {
    return fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    });
  }

  function medal(rank) {
    return ['\u{1F947}', '\u{1F948}', '\u{1F949}'][rank - 1] || String(rank);
  }

  function render() {
    var list = $('leaderboard-list');
    if (list) {
      list.replaceChildren();
      state.players.forEach(function (p) {
        var row = el('li', 'leaderboard-row');
        row.appendChild(el('span', 'leaderboard-medal', medal(p.rank)));
        row.appendChild(el('span', 'leaderboard-name', p.username));
        row.appendChild(el('span', 'leaderboard-wins',
          p.wins + (p.wins === 1 ? ' WIN' : ' WINS')));
        list.appendChild(row);
      });
    }

    var empty = $('leaderboard-empty');
    if (empty) {
      empty.textContent = state.players.length
        ? ''
        : (state.available
          ? 'No wins recorded yet. Win an online match to appear here.'
          : 'The leaderboard is not available on this server yet.');
    }
  }

  /**
   * Fetch the board.
   *
   * Only ever asked for when the leaderboard is opened, so nothing is fetched
   * on the menu for someone who will never look at it.
   */
  function load() {
    return api('/api/leaderboard').then(function (r) {
      var d = r.data || {};
      if (!d.ok || d.available === false) {
        // The migration has not been run here. No board, no error the visitor
        // has to understand - just a quiet line saying it is not there yet.
        state.available = false;
        state.players = [];
        render();
        return;
      }
      state.available = true;
      state.players = Array.isArray(d.players) ? d.players : [];
      render();
    }).catch(function () {
      // Offline, or an endpoint that is not there. A shrug, not a crash.
      state.available = false;
      state.players = [];
      render();
    });
  }

  function open() {
    var overlay = $('leaderboard-overlay');
    if (!overlay) return;
    render();
    overlay.hidden = false;
    if (window.scrollTo) window.scrollTo(0, 0);
    load();
  }

  function close() {
    var overlay = $('leaderboard-overlay');
    if (overlay) overlay.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var opener = $('menu-leaderboard');
    if (opener) opener.onclick = open;

    var closeBtn = $('leaderboard-close');
    if (closeBtn) closeBtn.onclick = close;

    var overlay = $('leaderboard-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) close();
    });
  });

  window.PhoenixLeaderboard = {
    refresh: load,
    open: open,
    close: close
  };
})();
