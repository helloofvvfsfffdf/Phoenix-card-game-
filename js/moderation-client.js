/* PHOENIX — browser half of Ban Management.
 *
 * This lives inside the owner dashboard and does four things:
 *   1. search for an account by username OR by account id
 *   2. issue a restriction - account (always), plus optional network and
 *      device restrictions as separate, independently liftable rows
 *   3. list restrictions filtered by state: active, expired, revoked, all
 *   4. show the append-only moderation audit log
 *
 * SECURITY NOTE. Nothing in this file decides anything. Every control here is
 * only a way of ASKING the server: the role is re-checked on every single call,
 * and again in Postgres by the RLS policies in sql/moderation.sql, so an
 * ordinary player who finds these endpoints gets a 403 and an audit line.
 * Rendering is textContent throughout - a reason is words a person typed.
 *
 * PRIVACY NOTE. The server's restriction projection deliberately contains no
 * IP address and no device token, so this screen cannot render one. What it
 * shows is a scope, a reason, a duration and who issued it. The shared-address
 * warning is drawn verbatim from the server so it can never be softened here.
 *
 * Nothing here is required for a match to run. If the markup or the endpoints
 * are missing, the dashboard carries on without a moderation section.
 */
(function () {
  'use strict';

  var selected = null;   // the account the owner has picked to restrict

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
    }).catch(function () {
      return { res: { ok: false, status: 0 }, data: { ok: false,
        message: 'Cannot reach the server.' } };
    });
  }

  function say(id, message, isError) {
    var node = $(id);
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', !!isError);
  }

  /* ---------- 1. search ---------------------------------------------------- */

  /**
   * Search by username or by account id.
   *
   * Both go to the same endpoint because the SERVER decides which it is
   * looking at. This file never parses the box to guess - an id is just as
   * searchable as a name, and the owner should not have to care which they
   * have been given.
   */
  function search() {
    var box = $('mod-search');
    var query = box ? box.value.trim() : '';
    if (!query) { say('mod-feedback', 'Enter a username or an account ID.'); return; }

    say('mod-feedback', 'Searching…', false);
    api('/api/moderation/accounts?q=' + encodeURIComponent(query))
      .then(function (out) {
        var data = out.data || {};
        if (!out.res.ok || !data.ok) {
          say('mod-feedback', data.message || 'That search could not be run.', true);
          return;
        }
        renderHits(data.accounts || []);
      });
  }

  function renderHits(accounts) {
    var box = $('mod-results');
    if (!box) return;
    box.replaceChildren();

    if (!accounts.length) {
      box.append(el('p', 'mod-sub', 'No account matched that.'));
      say('mod-feedback', '');
      return;
    }
    say('mod-feedback', accounts.length + ' account' +
      (accounts.length === 1 ? '' : 's') + ' found. Pick one.');

    accounts.forEach(function (acct) {
      var row = el('div', 'mod-hit');

      var who = el('div');
      who.appendChild(el('span', 'mod-hit-name', acct.username));
      // The id is shown because it is the unambiguous key - but only THIS
      // account's id, never anybody else's.
      who.appendChild(el('span', 'mod-hit-id', acct.id));
      row.appendChild(who);

      var pick = el('button', 'online-secondary', 'SELECT');
      pick.type = 'button';
      pick.onclick = function () { pickAccount(acct); };
      row.appendChild(pick);

      box.appendChild(row);
    });
  }

  function pickAccount(acct) {
    selected = acct;
    var panel = $('mod-issue');
    var title = $('mod-issue-title');
    if (title) title.textContent = 'RESTRICT ' + acct.username;
    if (panel) panel.hidden = false;
    var reason = $('mod-reason');
    if (reason) { reason.value = ''; setTimeout(function () { reason.focus(); }, 40); }
    say('mod-feedback', '');
  }

  /* ---------- 2. issue ----------------------------------------------------- */

  /** Read the duration the owner chose, as the server wants to hear it. */
  function readDuration() {
    var picked = document.querySelector('input[name="mod-duration"]:checked');
    var temporary = picked && picked.value === 'temporary';
    if (!temporary) return { permanent: true };

    var length = $('mod-duration-length');
    var value = length ? length.value : '86400';
    if (value === 'custom') {
      var custom = $('mod-duration-custom');
      var at = custom && custom.value ? new Date(custom.value).getTime() : NaN;
      if (!isFinite(at)) return { error: 'Pick when this restriction should lift.' };
      if (at <= Date.now()) return { error: 'That time has already passed.' };
      return { expiresAt: new Date(at).toISOString() };
    }
    return { duration: Number(value) };
  }

  function issue() {
    if (!selected) { say('mod-feedback', 'Pick an account first.', true); return; }

    var reason = ($('mod-reason').value || '').trim();
    if (!reason) { say('mod-feedback', 'Give a reason for the restriction.', true); return; }

    var when = readDuration();
    if (when.error) { say('mod-feedback', when.error, true); return; }

    var body = {
      accountId: selected.id,
      reason: reason,
      permanent: !!when.permanent
    };
    if (when.duration) body.duration = when.duration;
    if (when.expiresAt) body.expiresAt = when.expiresAt;

    // Both are OPTIONAL and independent. Each becomes its own row, so each can
    // be lifted on its own without touching the account restriction.
    var ip = $('mod-ip');
    var device = $('mod-device');
    if (ip && ip.checked) body.ip = true;
    if (device && device.checked) body.device = true;

    var button = $('mod-issue-btn');
    if (button) button.disabled = true;
    say('mod-feedback', 'Applying…', false);

    api('/api/moderation/restrictions', {
      method: 'POST',
      body: JSON.stringify(body)
    }).then(function (out) {
      var data = out.data || {};
      if (!out.res.ok || !data.ok) {
        say('mod-feedback', data.message || 'The restriction could not be applied.', true);
        return;
      }

      var made = data.created || [];
      var lines = ['Applied ' + made.length + ' restriction' +
        (made.length === 1 ? '' : 's') + ' to ' + selected.username + '.'];
      // The server's own notes - "no address has been observed for this
      // account", "the account was restricted but the network row failed" -
      // are always shown, because a half-applied restriction is exactly the
      // thing an owner must not be left guessing about.
      (data.notes || []).forEach(function (note) { lines.push(note); });

      say('mod-feedback', lines.join(' '));
      closeIssue();
      refresh();
    }).then(function () {
      if (button) button.disabled = false;
    });
  }

  function closeIssue() {
    var panel = $('mod-issue');
    if (panel) panel.hidden = true;
    selected = null;
  }

  /* ---------- 3. list ------------------------------------------------------ */

  function refresh() {
    var status = $('mod-status');
    var value = status ? status.value : 'active';
    api('/api/moderation/restrictions?status=' + encodeURIComponent(value))
      .then(function (out) {
        var data = out.data || {};
        if (!out.res.ok || !data.ok) {
          say('mod-feedback', data.message || 'Restrictions could not be read.', true);
          return;
        }
        renderList(data.restrictions || []);
      });
    loadLog();
  }

  function renderList(rows) {
    var list = $('mod-list');
    var empty = $('mod-empty');
    if (!list) return;
    list.replaceChildren();

    if (!rows.length) {
      if (empty) {
        empty.textContent = 'Nothing here.';
        empty.hidden = false;
      }
      return;
    }
    if (empty) empty.hidden = true;

    rows.forEach(function (row) {
      var item = el('li', 'mod-row' +
        (row.revokedAt ? ' is-revoked' : (row.expired ? ' is-expired' : '')));

      var body = el('div');

      var head = el('div');
      // The scope word. A network restriction is described as "NETWORK" here
      // rather than by any address - this screen never receives one.
      var scope = el('span', 'mod-scope is-' + row.kind,
        row.kind === 'ip' ? 'NETWORK' : String(row.kind || '').toUpperCase());
      head.appendChild(scope);
      head.appendChild(el('span', 'mod-who', row.username || '—'));
      body.appendChild(head);

      body.appendChild(el('p', 'mod-why', row.reason || 'No reason recorded.'));

      var when = el('p', 'mod-when');
      when.textContent = row.permanent
        ? 'Permanent'
        : (row.expiresAt ? 'Lifts ' + formatDate(row.expiresAt) : 'Temporary');
      when.textContent += ' · issued ' + formatDate(row.createdAt) +
        (row.createdBy ? ' by ' + row.createdBy : '');
      body.appendChild(when);

      var state = el('p', 'mod-state');
      if (row.revokedAt) {
        state.textContent = 'REVOKED ' + formatDate(row.revokedAt) +
          (row.revokedBy ? ' by ' + row.revokedBy : '');
      } else if (row.expired) {
        state.textContent = 'EXPIRED';
      } else {
        state.textContent = 'ACTIVE';
      }
      body.appendChild(state);

      item.appendChild(body);

      // Lifting is offered for anything not already lifted - INCLUDING a
      // permanent one, which never expires on its own and is always reversible.
      if (!row.revokedAt) {
        var lift = el('button', 'online-secondary', 'LIFT');
        lift.type = 'button';
        lift.onclick = function () { liftRestriction(row); };
        item.appendChild(lift);
      }

      list.appendChild(item);
    });
  }

  function liftRestriction(row) {
    var what = (row.username || 'that account') +
      (row.kind === 'ip' ? ' (network)' : (row.kind === 'device' ? ' (device)' : ''));
    if (!confirm('Lift the restriction on ' + what + '?\n\n' +
        'Nothing is deleted: the account, its stats, badges and saved progress ' +
        'are all left exactly as they are.')) return;

    api('/api/moderation/restrictions/revoke', {
      method: 'POST',
      body: JSON.stringify({ id: row.id })
    }).then(function (out) {
      var data = out.data || {};
      say('mod-feedback', (data.ok ? 'Lifted. ' : '') +
        (data.message || (data.ok ? '' : 'That could not be lifted.')), !data.ok);
      refresh();
    });
  }

  /* ---------- 4. audit log ------------------------------------------------- */

  function loadLog() {
    api('/api/moderation/log?limit=60').then(function (out) {
      var data = out.data || {};
      var list = $('mod-log');
      if (!list) return;
      list.replaceChildren();
      if (!out.res.ok || !data.ok) return;

      (data.entries || []).forEach(function (entry) {
        var line = el('li', 'mod-log-entry');
        line.appendChild(el('strong', '', entry.action));
        line.appendChild(document.createTextNode(
          ' · ' + (entry.actor_name || 'unknown') +
          (entry.subject_name ? ' → ' + entry.subject_name : '') +
          (entry.detail ? ' · ' + entry.detail : '') +
          ' · ' + formatDate(entry.at)
        ));
        list.appendChild(line);
      });
    });
  }

  /* ---------- dates -------------------------------------------------------- */

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** "14 OCT 2026, 15:02" in UTC - the same instant reads the same everywhere. */
  function formatDate(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return '';
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return when.getUTCDate() + ' ' + MONTHS[when.getUTCMonth()] + ' ' +
      when.getUTCFullYear() + ', ' + two(when.getUTCHours()) + ':' +
      two(when.getUTCMinutes());
  }

  /* ---------- wiring ------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    var searchBtn = $('mod-search-btn');
    if (!searchBtn) return;   // dashboard markup absent: nothing to wire

    searchBtn.onclick = search;
    var box = $('mod-search');
    if (box) {
      box.onkeydown = function (event) {
        if (event.key === 'Enter') { event.preventDefault(); search(); }
      };
    }

    $('mod-issue-btn').onclick = issue;
    $('mod-cancel').onclick = closeIssue;
    $('mod-refresh').onclick = refresh;
    $('mod-status').onchange = refresh;

    // The permanent/temporary pair. Choosing Temporary reveals the length
    // picker; choosing Permanent hides it again, because a permanent
    // restriction has no length to pick.
    var radios = document.querySelectorAll('input[name="mod-duration"]');
    var syncDuration = function () {
      var picked = document.querySelector('input[name="mod-duration"]:checked');
      var temporary = picked && picked.value === 'temporary';
      var length = $('mod-duration-length');
      var custom = $('mod-duration-custom');
      if (length) length.hidden = !temporary;
      if (custom && length) {
        custom.hidden = !(temporary && length.value === 'custom');
      }
    };
    for (var i = 0; i < radios.length; i++) radios[i].onchange = syncDuration;
    var length = $('mod-duration-length');
    if (length) length.onchange = syncDuration;
    syncDuration();

    // The network warning appears the moment the box is ticked. It is the
    // server's own words, so it cannot be softened here.
    var ip = $('mod-ip');
    if (ip) {
      ip.onchange = function () {
        var warn = $('mod-ip-warning');
        var detail = $('mod-ip-detail');
        if (warn) {
          warn.hidden = !ip.checked;
          warn.textContent = ip.checked
            ? '⚠ A network restriction blocks the internet connection, not the ' +
              'person. Anyone else using the same network - family on the same ' +
              'Wi-Fi, for example - would be blocked too, even though they did ' +
              'nothing. It can be lifted at any time, on its own.'
            : '';
        }
        if (detail) {
          detail.hidden = !ip.checked;
          detail.textContent = ip.checked
            ? 'Uses the address this server last saw for the account. A player ' +
              'on a different connection, or using a VPN, is not covered by it. ' +
              'Addresses are kept only as long as needed for moderation and are ' +
              'never shown to other players.'
            : '';
        }
      };
    }

    // The device note, always visible as a caveat once offered.
    var device = $('mod-device');
    if (device) {
      device.onchange = function () {
        var detail = $('mod-device-detail');
        if (detail) {
          detail.hidden = !device.checked;
          detail.textContent = device.checked
            ? 'This restricts the BROWSER, not the computer. It follows the ' +
              'device token this browser was given, across accounts. It is NOT ' +
              'a hardware ban: clearing site data, using another browser or ' +
              'another device produces a new token and is not stopped by it. ' +
              'Nothing is installed and no fingerprinting is used.'
            : '';
        }
      };
    }
  });

  window.PhoenixModeration = {
    /** Called when the dashboard is revealed, so the lists are never stale. */
    refresh: refresh
  };
})();
