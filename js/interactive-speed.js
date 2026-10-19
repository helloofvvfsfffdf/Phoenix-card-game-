/* PHOENIX — Speed Challenge. Only the server can issue GO or award a prize. */
(function () {
  'use strict';
  var overlay = null;
  var phase = null;
  var countdownTimer = null;
  var goTime = null;
  var reacted = false;

  function node(id) { return document.getElementById(id); }

  function build() {
    if (overlay && document.body.contains(overlay)) return;
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay speed-overlay';
    overlay.id = 'speed-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Speed Challenge">' +
      '<h2>Speed Challenge</h2>' +
      '<div class="speed-visual"><div class="speed-light" id="speed-light" aria-hidden="true"></div>' +
      '<div class="speed-timer" id="speed-timer" aria-live="polite">0ms</div></div>' +
      '<p id="speed-status">Press Ready when prepared.</p>' +
      '<button type="button" id="speed-ready-btn" class="primary">Ready!</button>' +
      '<button type="button" id="speed-go-btn" class="danger" hidden>Wait for GO</button>' +
      '<p id="speed-feedback" aria-live="polite"></p>' +
      '<p class="speed-fineprint">Wait for green. An early press forfeits your reaction.</p></div>';
    document.body.appendChild(overlay);
    node('speed-ready-btn').onclick = function () {
      if (send('ready')) {
        this.hidden = true;
        node('speed-status').textContent = 'Waiting for opponent…';
      }
    };
    node('speed-go-btn').onclick = function () {
      if (reacted) return;
      var early = phase !== 'react';
      if (!send(early ? 'false_start' : 'react')) return;
      reacted = true;
      this.hidden = true;
      node('speed-status').textContent = early ? 'False start. Waiting for opponent…' : 'Reaction sent. Waiting for opponent…';
      // This is feedback only; the server independently measures the reaction.
      if (!early && goTime !== null) node('speed-timer').textContent = Math.round(performance.now() - goTime) + 'ms';
    };
  }

  function send(decision) {
    if (!window.ws || window.ws.readyState !== 1) return false;
    window.ws.send(JSON.stringify({ type: 'interact', decision: decision }));
    return true;
  }

  function clearCountdown() {
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function onState(message) {
    var pi = message.pendingInteraction;
    if (!pi || pi.type !== 'speed' || !overlay) return;
    if (pi.phase === 'result') {
      clearCountdown();
      node('speed-ready-btn').hidden = true;
      node('speed-go-btn').hidden = true;
      node('speed-feedback').textContent = (message.events || []).map(e => e.text).join(' ');
      return;
    }
    var me = message.players[message.seat].id;
    var participant = pi.participants.indexOf(me) !== -1;
    var submitted = (pi.submitted || []).indexOf(me) !== -1;
    var changed = phase !== pi.phase;
    phase = pi.phase;
    node('speed-ready-btn').hidden = !participant || phase !== 'ready' || submitted;
    node('speed-go-btn').hidden = !participant || phase === 'ready' || submitted || reacted;
    if (!participant) {
      node('speed-status').textContent = 'Watching the Speed Challenge…';
      return;
    }
    if (phase === 'ready') {
      node('speed-status').textContent = submitted ? 'Waiting for opponent…' : 'Press Ready when prepared.';
    } else if (phase === 'countdown' && changed) {
      var count = 3;
      node('speed-status').textContent = String(count);
      node('speed-go-btn').textContent = 'Wait for GO (early press forfeits)';
      node('speed-light').classList.add('speed-light-waiting');
      clearCountdown();
      countdownTimer = setInterval(function () {
        if (!overlay) return clearCountdown();
        count--;
        node('speed-status').textContent = count > 0 ? String(count) : 'Get ready…';
        if (count <= 0) clearCountdown();
        // No local random timer can turn the light green.
      }, 1000);
    } else if (phase === 'react' && changed) {
      clearCountdown();
      node('speed-light').classList.remove('speed-light-waiting');
      node('speed-light').classList.add('speed-light-go');
      node('speed-go-btn').textContent = 'GO!';
      if (!submitted && !reacted) {
        goTime = performance.now();
        node('speed-status').textContent = 'GO! Press NOW!';
      }
    }
  }

  function close() {
    clearCountdown();
    if (overlay) overlay.remove();
    overlay = null;
    phase = null;
    goTime = null;
    reacted = false;
  }

  window.PhoenixSpeedInteractive = { build: build, onState: onState, close: close };
})();
