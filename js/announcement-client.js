/* PHOENIX — browser half of the announcement system.
 *
 * Three pieces, all driven by one public read:
 *   1. a corner card on the main menu carrying the newest announcement
 *   2. an archive of everything from the last 30 days
 *   3. the owner's composer, which lives in the owner dashboard
 *
 * SECURITY NOTE. An announcement is words a person typed. The only safe way to
 * put those on a page is as text, so every one of them is written with
 * textContent and this file never touches innerHTML. The card and the archive
 * are built from a public, read-only endpoint; posting needs the owner session,
 * and the server re-checks that whatever this file believes.
 *
 * Nothing here is required for a match to run. If this script, its markup or
 * the endpoint are missing, the menu carries on without an announcement.
 */
(function () {
  'use strict';

  var state = {
    available: false,
    windowDays: 30,
    maxLength: 400,
    announcements: []
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // textContent, never innerHTML - see the note at the top of this file.
    if (text !== undefined && text !== null) node.textContent = text;
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

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** "14 OCT 2026". UTC on purpose: the same post reads the same everywhere. */
  function formatDate(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return '';
    return when.getUTCDate() + ' ' + MONTHS[when.getUTCMonth()] + ' ' + when.getUTCFullYear();
  }

  /* ---------- the corner card ---------------------------------------------- */

  /**
   * The newest post, in the bottom right of the main menu.
   *
   * The card lives INSIDE #phoenix-menu in the markup, so opening the badges
   * screen, the dashboard or a match hides it along with the menu - no
   * observer or timer needed to keep it off other screens.
   */
  function renderCard() {
    var card = $('menu-announcement');
    if (!card) return;

    var latest = state.announcements[0];
    if (!state.available || !latest) { card.hidden = true; return; }

    var body = $('menu-announcement-body');
    if (body) body.textContent = latest.body;

    var stamp = $('menu-announcement-stamp');
    if (stamp) stamp.textContent = formatDate(latest.createdAt);

    card.hidden = false;
  }

  /* ---------- the archive and the dashboard list --------------------------- */

  /** One dated post. The same row is used by the archive and the dashboard. */
  function item(announce) {
    var row = el('li', 'announcement-item');
    row.appendChild(el('span', 'announcement-date', formatDate(announce.createdAt)));
    row.appendChild(el('p', 'announcement-body', announce.body));
    return row;
  }

  function renderList(listId, emptyId, emptyText) {
    var list = $(listId);
    if (list) {
      list.replaceChildren();
      state.announcements.forEach(function (announce) {
        list.appendChild(item(announce));
      });
    }
    var empty = $(emptyId);
    if (empty) empty.textContent = state.announcements.length ? '' : emptyText;
  }

  function renderAll() {
    renderCard();

    var note = $('announcement-note');
    if (note) {
      note.textContent = 'Official posts from the last ' + state.windowDays +
        ' days, newest first.';
    }

    var hint = $('announce-hint-days');
    if (hint) hint.textContent = String(state.windowDays);

    var field = $('announce-body');
    if (field) field.setAttribute('maxlength', String(state.maxLength));

    renderList('announcement-list', 'announcement-empty',
      'No announcements in the last ' + state.windowDays + ' days.');
    renderList('announce-list', 'announce-empty',
      'No announcements yet. Yours will appear here.');
  }

  /* ---------- posting ------------------------------------------------------- */

  function say(message, isError) {
    var node = $('announce-feedback');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', !!isError);
  }

  /**
   * Post whatever is in the dashboard's box.
   *
   * This sends the words and nothing else. Whether this session may post at all
   * is decided by the server from accounts.role; the composer only exists
   * inside a dashboard that is already owner-gated, and a player who posted to
   * the endpoint anyway would still get the same refusal.
   */
  function post() {
    var field = $('announce-body');
    var text = field ? field.value.trim() : '';
    if (!text) { say('Write an announcement first.', true); return; }

    say('Posting…');

    api('/api/announcements', {
      method: 'POST',
      body: JSON.stringify({ body: text })
    }).then(function (r) {
      var d = r.data || {};
      if (!d.ok) {
        say(d.message || 'Could not post that announcement.', true);
        if (d.available === false) load();
        return;
      }
      if (field) field.value = '';
      updateCount();
      say('Posted. It is on the main menu now.');
      load();
    }).catch(function () {
      say('Could not reach the server. Try again.', true);
    });
  }

  function updateCount() {
    var count = $('announce-count');
    var field = $('announce-body');
    if (!count || !field) return;
    var left = state.maxLength - field.value.length;
    count.textContent = left >= 0 ? left + ' left' : 'over the limit';
  }

  /* ---------- reading ------------------------------------------------------- */

  function load() {
    return api('/api/announcements').then(function (r) {
      var d = r.data || {};
      if (!d.ok || d.available === false) {
        // The migration has not been run here. No card, no archive, no error
        // in the console - the menu simply carries on without them.
        state.available = false;
        state.announcements = [];
        renderAll();
        return;
      }
      state.available = true;
      state.windowDays = d.windowDays || state.windowDays;
      state.maxLength = d.maxLength || state.maxLength;
      state.announcements = Array.isArray(d.announcements) ? d.announcements : [];
      renderAll();
    }).catch(function () {
      // Offline, or an endpoint that is not there. A shrug, not a crash: the
      // menu has to keep working either way.
      state.available = false;
      renderAll();
    });
  }

  /* ---------- open / close -------------------------------------------------- */

  function open() {
    var overlay = $('announcement-overlay');
    if (!overlay) return;
    renderAll();
    overlay.hidden = false;
    if (window.scrollTo) window.scrollTo(0, 0);
    load();
  }

  function close() {
    var overlay = $('announcement-overlay');
    if (overlay) overlay.hidden = true;
  }

  /* ---------- wiring -------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    var opener = $('menu-announcements');
    if (opener) opener.onclick = open;

    var more = $('menu-announcement-more');
    if (more) more.onclick = open;

    var dismiss = $('menu-announcement-close');
    if (dismiss) {
      dismiss.onclick = function () {
        var card = $('menu-announcement');
        if (card) card.hidden = true;
      };
    }

    var closeBtn = $('announcement-close');
    if (closeBtn) closeBtn.onclick = close;

    var overlay = $('announcement-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) close();
    });

    var postBtn = $('announce-post');
    if (postBtn) postBtn.onclick = post;

    var field = $('announce-body');
    if (field) {
      field.addEventListener('input', updateCount);
      field.addEventListener('keydown', function (e) {
        // Ctrl/Cmd+Enter posts. Plain Enter stays a newline, because this is a
        // textarea and a multi-line post should be possible.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          post();
        }
      });
    }

    // The corner card belongs to the main menu, so it is fetched straight away.
    updateCount();
    load();
  });

  window.PhoenixAnnouncements = {
    // Called by the dashboard when it opens, so the owner's list is never
    // showing a page-old copy of what they posted ten seconds ago.
    refresh: load,
    open: open,
    close: close
  };
})();
