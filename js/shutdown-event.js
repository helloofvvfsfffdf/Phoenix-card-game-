/* PHOENIX — the Fake System Shutdown.
 *
 * A SECRET event, not a card. Every successful card play has an independent
 * five percent chance of triggering it for the player who played the card.
 *
 * It is entirely inside the browser: nothing here touches the operating
 * system, asks for a reboot, or does anything a person would have to undo.
 * The browser's own controls - closing the tab, reloading, going back - are
 * never touched, because the browser's controls are the user's, not ours.
 *
 * It never overlaps: one at a time, and never over a moment that matters
 * (a victory screen, or a card that is still resolving).
 */
(function () {
  'use strict';

  var root = window;
  var CHANCE = 0.10;
  /* HARDCORE: the shock is much more likely, and there is no waiting after it. */
  var HARDCORE_CHANCE = 0.50;
  /* How long a player is left alone after it happens to them. */
  var COOLDOWN_MS = 3 * 60 * 1000;
  var COOLDOWN_KEY = 'phoenix.shutdown.cooldown.';
  var overlay = null;
  var timers = [];
  var running = false;
  // How many times the event has waited for the screen to be quiet.
  var defers = 0;
  // The round this player was last shocked in. HARDCORE rolls once a round.
  var shockedRound = -1;
  var MAX_DEFERS = 10;
  var DEFER_MS = 600;

  /** The player this browser is playing as. */
  function playerId() {
    try {
      var state = root.PhoenixOnline && root.PhoenixOnline.getState();
      if (!state || !state.players || state.seat === undefined) return 'guest';
      var seat = state.players[state.seat];
      return seat ? seat.id : 'guest';
    } catch (e) {
      return 'guest';
    }
  }

  /**
   * Is this a hardcore match?
   *
   * The room's own flag, from the server's snapshot - not something the
   * browser decided.
   */
  function hardcore() {
    try {
      var state = root.PhoenixOnline && root.PhoenixOnline.getState();
      return !!(state && state.hardcore);
    } catch (e) {
      return false;
    }
  }

  /** The round this match is on, or zero. */
  function currentRound() {
    try {
      var state = root.PhoenixOnline && root.PhoenixOnline.getState();
      return state && state.round ? Number(state.round) : 0;
    } catch (e) {
      return 0;
    }
  }

  /** When this player was last shocked, or zero. */
  function lastShock() {
    try {
      return Number(window.localStorage.getItem(COOLDOWN_KEY + playerId())) || 0;
    } catch (e) {
      return 0;
    }
  }

  function rememberShock() {
    try {
      window.localStorage.setItem(COOLDOWN_KEY + playerId(), String(Date.now()));
    } catch (e) { /* no storage; the event simply happens again sooner */ }
  }

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function later(fn, ms) {
    var t = setTimeout(function () {
      timers = timers.filter(function (other) { return other !== t; });
      fn();
    }, ms);
    timers.push(t);
    return t;
  }

  /**
   * Is something important on screen that must not be covered?
   *
   * A card cinematic, a minigame the player has to press a button in, the
   * Mimic's video, the victory screen, the settings or a ban - none of these
   * may be covered by a joke.
   */
  function somethingImportantIsOnScreen() {
    var victory = document.querySelector('.phoenix-victory');
    if (victory) return true;
    var settings = document.getElementById('settings');
    if (settings && !settings.hidden) return true;
    var ban = document.getElementById('ban-overlay');
    if (ban && !ban.hidden) return true;
    // A card cinematic is playing.
    if (document.querySelector('.pc-scene')) return true;
    // A minigame or another interaction is waiting for a decision.
    if (document.querySelector('.interactive-overlay')) return true;
    // The Mimic's video.
    if (document.querySelector('.phoenix-rickroll')) return true;
    return false;
  }

  function dismiss() {
    clearTimers();
    running = false;
    defers = 0;
    if (overlay && overlay.parentNode) {
      overlay.hidden = true;
      overlay.remove();
    }
    overlay = null;
    document.body.classList.remove('phoenix-fake-shutdown');
  }

  function show() {
    if (running) return;
    if (document.hidden) return;
    if (somethingImportantIsOnScreen()) {
      // The screen is busy, so the event waits for a quiet moment. The roll
      // has already happened, so this is the same event, not a new one - and
      // it gives up rather than covering anything that matters.
      if (defers < MAX_DEFERS) {
        defers += 1;
        later(function () {
          defers -= 1;
          show();
        }, DEFER_MS);
      }
      return;
    }

    running = true;
    rememberShock();
    document.body.classList.add('phoenix-fake-shutdown');

    overlay = document.createElement('div');
    overlay.className = 'phoenix-fake-shutdown-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML =
      '<div class="phoenix-fake-shutdown-panel">' +
      '  <p class="phoenix-fake-shutdown-title">PHOENIX Entertainment</p>' +
      '  <p class="phoenix-fake-shutdown-line" id="phoenix-fake-shutdown-line">Shutting down…</p>' +
      '  <div class="phoenix-fake-shutdown-bar"><span id="phoenix-fake-shutdown-fill"></span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    var fill = document.getElementById('phoenix-fake-shutdown-fill');
    var line = document.getElementById('phoenix-fake-shutdown-line');
    var messages = [
      'Closing open sessions…',
      'Saving your progress…',
      'Disconnecting players…',
      'Shutting down…'
    ];
    var step = 0;

    var tick = setInterval(function () {
      step += 1;
      if (fill) fill.style.width = Math.min(100, step * 25) + '%';
      if (line) line.textContent = messages[Math.min(messages.length - 1, step - 1)];
    }, 420);
    timers.push(tick);

    // The reveal, and then the game carries on exactly where it was.
    later(function () {
      if (fill) fill.style.width = '100%';
      if (line) line.textContent = 'JUST KIDDING! — PHOENIX Entertainment';
      later(dismiss, 2200);
    }, 2100);
  }

  /**
   * The roll. Called when a card has been played successfully.
   *
   * The chance is independent every time, and the event is only ever shown to
   * the player who played the card.
   */
  function maybeTrigger() {
    if (running) return false;
    var hard = hardcore();
    if (hard) {
      // HARDCORE: once a round. The roll is made again on the next round, so
      // a table is not held up by a joke every other card, and the player is
      // left alone after it - no three minute wait in a hardcore match.
      var round = currentRound();
      if (shockedRound === round) return false;
      if (Math.random() >= HARDCORE_CHANCE) return false;
      shockedRound = round;
      show();
      return true;
    }
    // This player was left alone for a while after the last time.
    if (Date.now() - lastShock() < COOLDOWN_MS) return false;
    if (Math.random() >= CHANCE) return false;
    show();
    return true;
  }

  root.PhoenixFakeShutdown = {
    maybeTrigger: maybeTrigger,
    dismiss: dismiss,
    isRunning: function () { return running; },
    // How long this player is left alone after it happens to them.
    cooldownMs: COOLDOWN_MS,
    onCooldown: function () {
      if (hardcore()) return false;
      return Date.now() - lastShock() < COOLDOWN_MS;
    }
  };
})();
