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
        ? 'Pick a username, a password of at least 8 characters, and an email address.'
        : 'Enter your username and password to continue.';
    }
    // The email field belongs to CREATE only. Sign-in never needs an address,
    // and an extra field there would just be one more thing to get wrong.
    var email = $('account-email');
    if (email) {
      email.hidden = !isRegister;
      email.required = isRegister;
      if (!isRegister) email.value = '';
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

  /**
   * Email verification.
   *
   * Two faces on one overlay:
   *   - ADDRESS: the server says this session still owes a verified address.
   *   - CODE: a six-digit code is on its way and we are waiting for it.
   *
   * The screen is modal and cannot be dismissed, because play is genuinely
   * blocked until this is done. It never signs anybody out and never shows a
   * password field again.
   */
  var verify = {
    email: '',
    cooldownTimer: null,
    awaitingCode: false
  };

  function showVerify(mode) {
    var overlay = $('verify-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    verify.awaitingCode = mode === 'code';

    $('verify-address-form').hidden = verify.awaitingCode;
    $('verify-code-form').hidden = !verify.awaitingCode;

    var title = $('verify-title');
    var note = $('verify-note');
    if (title) {
      title.textContent = verify.awaitingCode ? 'CHECK YOUR EMAIL' : 'ADD YOUR EMAIL';
    }
    if (note) {
      note.textContent = verify.awaitingCode
        ? 'We sent a six-digit code to ' + verify.email +
          '. Enter it below to prove the address is yours.'
        : (verify.notice ||
           'Every PHOENIX account now requires a verified email.');
    }
    verifyFeedback('');
    var field = $(verify.awaitingCode ? 'verify-code' : 'verify-email');
    if (field) setTimeout(function () { field.focus(); }, 60);
  }

  function hideVerify() {
    var overlay = $('verify-overlay');
    if (overlay) overlay.hidden = true;
    if (verify.cooldownTimer) { clearInterval(verify.cooldownTimer); verify.cooldownTimer = null; }
  }

  function verifyFeedback(message, good) {
    var node = $('verify-feedback');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-good', !!good);
    node.classList.toggle('is-bad', !good && !!message);
  }

  function verifyBusy(on) {
    ['verify-send', 'verify-confirm', 'verify-resend', 'verify-change'].forEach(function (id) {
      var node = $(id);
      if (node) node.disabled = !!on;
    });
  }

  /** Live "send another in Ns" line, counting down from the server's number. */
  function startCooldown(seconds) {
    var left = Number(seconds) || 0;
    var line = $('verify-cooldown');
    var resend = $('verify-resend');
    if (verify.cooldownTimer) clearInterval(verify.cooldownTimer);
    if (left <= 0) {
      if (line) line.textContent = '';
      if (resend) resend.disabled = false;
      return;
    }
    if (resend) resend.disabled = true;
    var tick = function () {
      if (left <= 0) {
        clearInterval(verify.cooldownTimer);
        verify.cooldownTimer = null;
        if (line) line.textContent = '';
        if (resend) resend.disabled = false;
        return;
      }
      if (line) line.textContent = 'You can request another code in ' + left + ' second' +
        (left === 1 ? '' : 's') + '.';
      left -= 1;
    };
    tick();
    verify.cooldownTimer = setInterval(tick, 1000);
  }

  /** Ask the server for the current state and open the right face of it. */
  function openVerifyFromServer() {
    return fetch('/api/account/email/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (status) {
        if (!status || status.ok === false) return false;
        if (!status.required && !status.awaitingCode) { hideVerify(); return true; }
        verify.email = status.email || '';
        // The server owns this sentence - it is required to be exact - so it is
        // taken verbatim rather than restated here.
        verify.notice = status.notice || null;
        if (status.awaitingCode) {
          showVerify('code');
          startCooldown(status.resendInSeconds);
        } else {
          showVerify('address');
        }
        return false;
      })
      .catch(function () { return false; });
  }

  /**
   * Called after sign-in and after /api/me. If the server says this account
   * still owes a verified address, block play behind the verification screen.
   */
  function enforceVerification() {
    if (!available || !account) return Promise.resolve(false);
    return fetch('/api/account/email/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (status) {
        // Any answer we cannot read leaves play open: a broken page must not
        // lock out somebody the server is happy to let in.
        if (!status || status.ok === false) return false;
        if (!status.required) return false;
        verify.email = status.email || '';
        verify.notice = status.notice || null;
        showVerify(status.awaitingCode ? 'code' : 'address');
        if (status.awaitingCode) startCooldown(status.resendInSeconds);
        return true;
      })
      .catch(function () { return false; });
  }

  /** The server accepted something: refresh the local account and the screen. */
  function afterVerified(result) {
    if (result && result.account) account = result.account;
    renderAccountBits();
    hideVerify();
    var line = $('menu-feedback');
    if (line) line.textContent = 'Email verified. Welcome to PHOENIX.';
    if (typeof pending === 'function') {
      var fn = pending;
      pending = null;
      fn();
    }
  }

  function wireVerify() {
    var overlay = $('verify-overlay');
    if (!overlay) return;

    // Sending a code. The address is whatever was typed - it is allowed to be
    // different from anything on the account, because proving it is the point.
    $('verify-address-form').onsubmit = function (event) {
      event.preventDefault();
      var email = $('verify-email').value.trim();
      if (!email) { verifyFeedback('Enter an email address.'); return; }
      verifyBusy(true);
      verifyFeedback('Sending your code…', true);
      post('/api/account/email/request', { email: email })
        .then(function (out) {
          var data = out.data || {};
          if (!out.res.ok || !data.ok) {
            var message = data.message || 'A code could not be sent.';
            if (data.code) message += ' [' + data.code + ']';
            verifyFeedback(message);
            if (data.retryInSeconds) startCooldown(data.retryInSeconds);
            return;
          }
          verify.email = email;
          showVerify('code');
          startCooldown(data.resendAfter);
          verifyFeedback(data.message || 'We sent a six-digit code to ' + email + '.', true);
        })
        .catch(function () { verifyFeedback('Cannot reach the server. Try again.'); })
        .then(function () { verifyBusy(false); });
    };

    // Checking the six digits.
    $('verify-code-form').onsubmit = function (event) {
      event.preventDefault();
      var code = ($('verify-code').value || '').replace(/\D/g, '');
      if (code.length !== 6) { verifyFeedback('Enter the six-digit code.'); return; }
      verifyBusy(true);
      verifyFeedback('Checking…', true);
      post('/api/account/email/verify', { code: code })
        .then(function (out) {
          var data = out.data || {};
          $('verify-code').value = '';
          if (!out.res.ok || !data.ok) {
            var message = data.message || 'That code did not work.';
            if (data.code) message += ' [' + data.code + ']';
            verifyFeedback(message);
            if (typeof data.attemptsLeft === 'number') {
              verifyFeedback(message + ' (' + data.attemptsLeft + ' attempts left)');
            }
            return;
          }
          afterVerified(data);
        })
        .catch(function () { verifyFeedback('Cannot reach the server. Try again.'); })
        .then(function () { verifyBusy(false); });
    };

    // A fresh code, once the cooldown has run out.
    $('verify-resend').onclick = function () {
      if (!verify.email) { showVerify('address'); return; }
      verifyBusy(true);
      post('/api/account/email/request', { email: verify.email })
        .then(function (out) {
          var data = out.data || {};
          if (!out.res.ok || !data.ok) {
            verifyFeedback(data.message || 'A new code could not be sent.');
            if (data.retryInSeconds) startCooldown(data.retryInSeconds);
            return;
          }
          startCooldown(data.resendAfter);
          verifyFeedback('A new code is on its way.', true);
        })
        .catch(function () { verifyFeedback('Cannot reach the server. Try again.'); })
        .then(function () { verifyBusy(false); });
    };

    // Start over with a different address.
    $('verify-change').onclick = function () {
      showVerify('address');
    };
  }

  function signedIn(result, done) {
    account = result.account;
    renderAccountBits();
    hide();
    feedback('', false);

    // An account that still owes us a verified address goes straight to that
    // screen. `pending` is deliberately NOT cleared here: the callback the
    // player was waiting for runs once verification is done.
    if (done) pending = done;
    enforceVerification().then(function (blocked) {
      if (blocked) return;
      var line = $('menu-feedback');
      if (line) line.textContent = 'Signed in as ' + account.username + '.';
      if (typeof pending === 'function') {
        var fn = pending;
        pending = null;
        fn();
      }
    });
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

    wireVerify();

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
      var body = { username: username, password: password };
      if (mode === 'register') {
        // The server refuses a registration with no address when the migration
        // is installed, so ask here rather than letting it fail remotely.
        var email = ($('account-email').value || '').trim();
        if (!email) {
          feedback('Enter an email address. Every PHOENIX account needs a verified one.');
          return;
        }
        body.email = email;
      }
      busy(true);
      feedback(mode === 'register' ? 'Creating your account…' : 'Signing in…', false);
      post(mode === 'register' ? '/api/register' : '/api/login', body)
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
        if (current) {
          renderAccountBits();
          // An EXISTING account, signed in from before this feature existed,
          // meets the mandatory update screen here. Nothing is deleted, no
          // session is ended, and their stats, badges and name are untouched.
          enforceVerification();
          return;
        }
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
    available: function () { return available; },
    // Re-check whether this session still owes a verified address and open the
    // screen if it does. Returns true when play is blocked behind it.
    enforceVerification: enforceVerification,
    // Open the verification screen directly (used by the update notice).
    openVerification: openVerifyFromServer
  };
})();
