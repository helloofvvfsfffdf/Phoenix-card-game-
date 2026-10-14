/* PHOENIX — browser half of the Phase 1 account system.
 *
 * Shows a sign-in / register screen AFTER the cinematic intro (the intro is
 * untouched), and the main menu when already signed in. All credential checks
 * happen on the server; this file only collects input and renders answers.
 *
 * The session lives in an httpOnly cookie, so no token is ever readable here.
 */
(function () {
  'use strict';

  var account = null;          // { id, username, role } or null
  var available = true;        // server actually has an account system
  var pending = null;          // callback waiting for a successful sign-in
  var started = false;         // auth screen already shown once

  function $(id) { return document.getElementById(id); }

  /* ---------- server calls ---------- */

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    });
  }

  function refresh() {
    return fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (payload) {
        available = payload.available !== false;
        account = payload.account ? payload.account : null;
        renderAccountBits();
        return account;
      })
      .catch(function () {
        // Network failure: keep the last known state rather than logging out.
        renderAccountBits();
        return account;
      });
  }

  /* ---------- screen ---------- */

  function show(mode, reason) {
    var overlay = $('account-overlay');
    if (!overlay) return;
    started = true;
    setMode(mode || 'login');
    overlay.hidden = false;
    $('account-reason').textContent =
      reason || 'Sign in to save your place and play online multiplayer.';
    $('account-feedback').textContent = '';
    // The intro must never sit on top of the form.
    if (window.PhoenixOpeningCinematic) window.PhoenixOpeningCinematic.stop();
    var field = $('account-username');
    if (field) setTimeout(function () { field.focus(); }, 60);
  }

  function hide() {
    var overlay = $('account-overlay');
    if (overlay) overlay.hidden = true;
  }

  function setMode(mode) {
    var isRegister = mode === 'register';
    var title = $('account-title');
    var submit = $('account-submit');
    var hint = $('account-hint');
    if (title) title.textContent = isRegister ? 'CREATE ACCOUNT' : 'SIGN IN';
    if (submit) submit.textContent = isRegister ? 'CREATE ACCOUNT →' : 'SIGN IN →';
    if (hint) {
      hint.textContent = isRegister
        ? 'Pick a username and a password of at least 8 characters. No email needed.'
        : 'Enter your username and password to continue.';
    }
    var toggle = $('account-toggle');
    if (toggle) {
      toggle.textContent = isRegister
        ? 'Already have an account? Sign in'
        : 'New here? Create an account';
    }
    var pw = $('account-password');
    if (pw) pw.autocomplete = isRegister ? 'new-password' : 'current-password';
    var shell = document.querySelector('.account-shell');
    if (shell) shell.setAttribute('data-mode', mode);
  }

  function feedback(message, isError) {
    var node = $('account-feedback');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', isError !== false);
  }

  function busy(on) {
    var form = $('account-form');
    if (!form) return;
    var buttons = form.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !!on;
  }

  /* ---------- what happens after a sign-in ---------- */

  function signedIn(result, done) {
    account = result.account;
    renderAccountBits();
    hide();
    feedback('', false);
    var line = $('menu-feedback');
    if (line) line.textContent = 'Signed in as ' + account.username + '.';
    if (typeof done === 'function') {
      var fn = done;
      pending = null;
      fn();
    }
  }

  /** Runs `callback` once a session exists, showing the sign-in screen if not. */
  function requireLogin(callback) {
    if (!available || account) { callback(); return; }
    pending = callback;
    show('login', 'Sign in to enter online multiplayer.');
  }

  /* ---------- menu chrome ---------- */

  function renderAccountBits() {
    var status = $('menu-account');
    if (status) {
      if (!available) {
        status.textContent = '';
        status.hidden = true;
      } else {
        status.hidden = false;
        if (account) {
          status.textContent =
            'Signed in as ' + account.username +
            (account.role === 'owner' ? ' · OWNER' : '');
          status.classList.add('is-signed-in');
        } else {
          status.textContent = 'Not signed in';
          status.classList.remove('is-signed-in');
        }
      }
    }
    var logout = $('menu-logout');
    if (logout) logout.hidden = !(available && account);

    // Give a signed-out visitor a way back to the sign-in screen from the menu
    // (they may have dismissed it, or arrived via MULTIPLAYER).
    var signin = $('menu-signin');
    if (signin) signin.hidden = !available || !!account;

    // Owner-only controls stay hidden from regular players. With no account
    // system at all, keep the legacy password-gated button exactly as before.
    var ownerBtn = $('menu-owner');
    if (ownerBtn) {
      ownerBtn.hidden = available && !(account && account.role === 'owner');
      // The signed-in owner is authorised by their session, so the old
      // "password required" caption would be a lie.
      var cap = ownerBtn.querySelector('small');
      if (cap) {
        cap.textContent = (available && account && account.role === 'owner')
          ? 'SIGNED-IN OWNER · NO PASSWORD'
          : 'SERVER ADMIN · PASSWORD REQUIRED';
      }
    }

    var dash = $('menu-dashboard');
    if (dash) dash.hidden = !(account && account.role === 'owner');

    // The one-time owner-claim button. Hidden unless the setup hash is in the
    // URL AND the signed-in account is not already the owner, so the menu
    // never offers to claim ownership it already holds.
    var claim = $('menu-claim-owner');
    if (claim) {
      claim.hidden = !(
        location.hash === '#owner-setup' &&
        available && account && account.role !== 'owner'
      );
    }

    // The SERVER button on the multiplayer screen opens the same dashboard, so
    // it is owner-only as well. With no account system it stays as it always was.
    var serverBtn = $('online-admin');
    if (serverBtn) {
      serverBtn.hidden = available && !(account && account.role === 'owner');
    }
  }

  /* ---------- wiring ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    var form = $('account-form');
    if (!form) return;

    $('account-toggle').onclick = function () {
      setMode(
        document.querySelector('.account-shell').getAttribute('data-mode') === 'register'
          ? 'login' : 'register'
      );
      $('account-feedback').textContent = '';
    };

    $('account-cancel').onclick = function () {
      hide();
      pending = null;
      // Only offered when the sign-in was optional (e.g. the intro gate).
      if (!account && $('phoenix-menu')) $('phoenix-menu').hidden = false;
    };

    form.onsubmit = function (event) {
      event.preventDefault();
      var mode = document.querySelector('.account-shell').getAttribute('data-mode');
      var username = $('account-username').value.trim();
      var password = $('account-password').value;
      if (!username || !password) {
        feedback('Enter both a username and a password.');
        return;
      }
      busy(true);
      feedback(mode === 'register' ? 'Creating your account…' : 'Signing in…', false);
      post(mode === 'register' ? '/api/register' : '/api/login', { username: username, password: password })
        .then(function (out) {
          if (!out.res.ok || !out.data.ok) {
            // The server keeps real database errors in its own log; all that
            // reaches us is a short, non-sensitive reference code so a bug
            // report can be matched to that log line exactly.
            var message = (out.data && out.data.message) || 'Could not sign in.';
            if (out.data && out.data.code) message += ' [' + out.data.code + ']';
            feedback(message);
            return;
          }
          $('account-password').value = '';
          signedIn(out.data, pending);
        })
        .catch(function () { feedback('Cannot reach the server. Try again.'); })
        .then(function () { busy(false); });
    };

    var signin = $('menu-signin');
    if (signin) {
      signin.onclick = function () {
        show('login', 'Sign in to save your place. New here? Create an account.');
      };
    }

    var logout = $('menu-logout');
    if (logout) {
      logout.onclick = function () {
        post('/api/logout').catch(function () { /* best effort */ }).then(function () {
          account = null;
          renderAccountBits();
          var line = $('menu-feedback');
          if (line) line.textContent = 'Signed out.';
        });
      };
    }

    var claim = $('menu-claim-owner');
    if (claim) {
      // Owner setup is deliberately invisible in the normal UI: it only appears
      // when the page is opened with #owner-setup in the URL. The server is the
      // real gate - it still requires a signed-in session AND the one-time key.
      //
      // It is ALSO hidden for an account that already owns the game, so the
      // menu never offers to claim what it already has. That is decided from
      // the role the server sent back, not from anything on this page.
      claim.hidden = !(
        location.hash === '#owner-setup' &&
        available && account && account.role !== 'owner'
      );
      claim.onclick = function () {
        var key = prompt('Enter the one-time owner setup key:');
        if (!key) return;
        post('/api/claim-owner', { setupKey: key }).then(function (out) {
          if (!out.res.ok || !out.data.ok) {
            alert((out.data && out.data.message) || 'Could not claim ownership.');
            return;
          }
          account = out.data.account;
          renderAccountBits();
          claim.hidden = true;
          // Drop the setup hash so a reload does not re-offer the button.
          if (history.replaceState) history.replaceState(null, '', location.pathname);
          alert('Ownership claimed. You are now the permanent OWNER.');
        }).catch(function () { alert('Cannot reach the server.'); });
      };
    }

    // Kick off the session check immediately; the screen itself waits for the
    // cinematic so the intro is never cut short.
    refresh().then(function (current) {
      // No account system on this server: leave the menu exactly as it was.
      if (!available) { renderAccountBits(); return; }

      var waitForIntro = function () {
        if (current) { renderAccountBits(); return; }
        // Logged out: reveal the sign-in screen once the intro has had its turn.
        show('login', 'Sign in to save your place. New here? Create an account.');
      };
      if (window.PhoenixOpeningCinematic && window.PhoenixOpeningCinematic.active()) {
        var tries = 0;
        var poll = setInterval(function () {
          tries += 1;
          if (!window.PhoenixOpeningCinematic.active() || tries > 120) {
            clearInterval(poll);
            waitForIntro();
          }
        }, 250);
      } else {
        waitForIntro();
      }
    });
  });

  window.PhoenixAccount = {
    refresh: refresh,
    requireLogin: requireLogin,
    current: function () { return account; },
    // Whether THIS server runs an account system at all. Distinct from
    // `current()` being null: a signed-out visitor and a server with no
    // accounts both have no current account, but only the latter means
    // "there is no owner role here to read".
    available: function () { return available; }
  };
})();
