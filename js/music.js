/*
 * Phoenix - music.js
 * ---------------------------------------------------------------------------
 * Background music: the soundtrack, the player's choice, and the browser rules
 * that get in the way of playing it.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * Same reason js/maple.js and js/gallery.js are: requiring server.js starts a
 * server and demands PHOENIX_OWNER_PASSWORD, so anything living there cannot be
 * asserted by a test. The preference and selection logic below is therefore
 * pure and injectable, and the DOM/audio part hangs off it.
 *
 * ONE PLAYER, ONE SETTING, NO SERVER INVOLVED
 * -------------------------------------------
 * There is deliberately no `music_set` message. Music is a per-player preference
 * stored in that player's own browser, so it needs no owner password, no room and
 * no server round trip - which is exactly why it works for multiplayer guests and
 * single-player alike. Two browsers playing the same match can have different
 * music at different volumes, and neither can observe the other's.
 *
 * LICENSING
 * ---------
 * All four tracks are CC0 1.0 public-domain dedications from OpenGameArt, verified
 * page by page and recorded in MUSIC-LICENSES.md. CC0 permits redistribution with
 * no conditions, so the files may be hosted in this repository. They were
 * re-encoded to 96 kbps stereo for the web; see MUSIC-LICENSES.md for that and for
 * each track's source, author and licence.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhoenixMusic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Bumped if the shape of the saved preferences ever changes. */
  var STORAGE_KEY = 'phoenix.music.v1';

  /** Default volume. Loud enough to hear, quiet enough to talk over. */
  var DEFAULT_VOLUME = 0.25;

  /**
   * The soundtrack.
   *
   * Epic is first and is the default, deliberately: the game opens on RISE.
   * PLAY. SURVIVE. and the default should sound like it means it rather than like
   * a settings screen nobody chose.
   *
   * `off` is a real entry rather than a null track so that "Disabled" is a
   * choice the player made, is saved like any other choice, and can be told apart
   * from "never configured".
   */
  var TRACKS = [
    {
      id: 'epic',
      name: 'Epic',
      file: 'assets/music/epic.mp3',
      blurb: 'Cinematic strings and horns. The default - a battlefield in full voice.'
    },
    {
      id: 'mysterious',
      name: 'Mysterious',
      file: 'assets/music/mysterious.mp3',
      blurb: 'Low, echoing ambience for tombs and labyrinths.'
    },
    {
      id: 'retro',
      name: 'Retro',
      file: 'assets/music/retro.mp3',
      blurb: 'Seamlessly looping 8-bit chiptune action.'
    },
    {
      id: 'calm',
      name: 'Calm',
      file: 'assets/music/calm.mp3',
      blurb: 'Bell, flute and arpeggios. Purpose-built to loop.'
    },
    {
      id: 'off',
      name: 'Disabled',
      file: null,
      blurb: 'No music at all.'
    }
  ];

  /** The track a player gets before they have chosen anything. */
  var DEFAULT_TRACK = 'epic';

  function trackById(id) {
    for (var i = 0; i < TRACKS.length; i++) {
      if (TRACKS[i].id === id) return TRACKS[i];
    }
    return null;
  }

  /** Volume is clamped to 0..1 so a hand-edited value can never break the slider. */
  function clampVolume(value) {
    var n = Number(value);
    if (!isFinite(n)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, n));
  }

  /** What a player has before they have expressed any preference. */
  function defaultPrefs() {
    return { track: DEFAULT_TRACK, volume: DEFAULT_VOLUME };
  }

  /**
   * Reads saved preferences, repairing anything wrong.
   *
   * Every field is checked rather than trusted. A saved value can be missing,
   * stale from an older build, hand-edited in devtools, or written by a different
   * version of this file - and none of those should stop the game from starting.
   * An unrecognised track falls back to the default instead of silencing the
   * player, because silence is a worse surprise than the wrong song.
   *
   * @param storage anything with getItem/setItem; null for a fresh browser
   */
  function loadPrefs(storage) {
    var prefs = defaultPrefs();

    if (!storage) return prefs;

    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (e) {
      // Private browsing modes can throw on access. Music is a nicety; never let
      // it stop the game from loading.
      return prefs;
    }

    if (!raw) return prefs;

    var saved;
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      return prefs;
    }

    if (!saved || typeof saved !== 'object') return prefs;

    if (trackById(saved.track)) prefs.track = saved.track;
    if (saved.volume !== undefined && saved.volume !== null) {
      prefs.volume = clampVolume(saved.volume);
    }

    return prefs;
  }

  /** Saves preferences. Never throws - a failed write must not break the game. */
  function savePrefs(storage, prefs) {
    if (!storage) return false;

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        track: trackById(prefs.track) ? prefs.track : DEFAULT_TRACK,
        volume: clampVolume(prefs.volume)
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * What the player element should be doing, given their preferences.
   *
   * Returned rather than applied so it can be tested, and so the audio layer has
   * one obvious place to ask.
   */
  function resolve(prefs) {
    var track = trackById(prefs.track);

    if (!track) return { playing: false, src: null, volume: clampVolume(prefs.volume) };
    if (!track.file) return { playing: false, src: null, volume: clampVolume(prefs.volume) };

    return { playing: true, src: track.file, volume: clampVolume(prefs.volume) };
  }

  /**
   * Does this change require reloading the audio element?
   *
   * This is what stops music restarting every time the player moves between the
   * menu, the gallery and a match: as long as the file has not actually changed,
   * the answer is no, and the caller is expected to leave the element alone.
   * Even the volume is applied in place, because reloading on a volume change
   * would restart the track mid-sentence.
   */
  function needsReload(current, next) {
    return current.src !== next.src;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    DEFAULT_TRACK: DEFAULT_TRACK,
    TRACKS: TRACKS,
    trackById: trackById,
    clampVolume: clampVolume,
    defaultPrefs: defaultPrefs,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    resolve: resolve,
    needsReload: needsReload
  };
}));

/* ========================================================================= */
/* Browser half                                                              */
/* ========================================================================= */
/*
 * Everything above is testable. Everything below is the part that can only exist
 * in a browser: one <audio> element, created once and never destroyed.
 *
 * It lives on document.body for the lifetime of the page rather than inside any
 * screen. That is the whole answer to "keep the music playing across the menu,
 * the gallery and the game": changing screens never touches the element at all,
 * so nothing can interrupt it.
 *
 * AUTOPLAY
 * --------
 * Browsers may refuse audible autoplay until a user gesture. We attempt normal
 * playback on load and respect the result, showing "Click to enable music" if
 * refused. A completed click (including a mobile tap) or keypress can retry;
 * play() runs synchronously inside that gesture, not after an asynchronous task.
 * No browser policy is bypassed and the player's saved preferences stay intact.
 */
if (typeof document !== 'undefined') {
  (function () {
    'use strict';

    var Music = window.PhoenixMusic;
    var audio = null;
    var prefs = Music.defaultPrefs();
    var blocked = false;       // true when the browser refused to start
    var unlocked = false;      // true once a user gesture has been seen
    var onChange = [];         // listeners for the settings UI
    var preferencesSaved = true;
    var playAttempt = 0;

    function storage() {
      try {
        return window.localStorage;
      } catch (e) {
        return null;
      }
    }

    /** Creates the element exactly once and never again. */
    function ensureElement() {
      if (audio) return audio;

      audio = document.createElement('audio');
      audio.id = 'phoenix-music';
      audio.loop = true;        // background music, so it repeats forever
      audio.preload = 'none';   // nothing is fetched until music is asked for
      audio.setAttribute('aria-hidden', 'true');

      var want = Music.resolve(prefs);
      if (want.src) audio.src = want.src;
      audio.volume = want.volume;

      document.body.appendChild(audio);
      return audio;
    }

    function notify() {
      var state = { track: prefs.track, volume: prefs.volume, blocked: blocked, playing: isPlaying() };
      onChange.forEach(function (fn) { fn(state); });
      var enable = document.getElementById('music-enable-button');
      if (enable) enable.hidden = !blocked;
    }

    function isPlaying() {
      return !!audio && !audio.paused && !audio.ended && !!audio.src;
    }

    /**
     * Starts playback, and records honestly if the browser would not.
     *
     * play() rejects rather than throwing when autoplay policy says no, so the
     * promise is handled: otherwise this produces an unhandled rejection in the
     * console every time a page loads.
     */
    function play() {
      var el = ensureElement();
      var want = Music.resolve(prefs);

      if (!want.playing) return;

      var attempt;
      var attemptId = ++playAttempt;
      try {
        attempt = el.play();
      } catch (e) {
        if (attemptId === playAttempt) {
          blocked = true;
          notify();
        }
        return;
      }

      if (attempt && typeof attempt.then === 'function') {
        attempt.then(function () {
          if (attemptId === playAttempt) {
            blocked = false;
            notify();
          }
        }).catch(function () {
          if (attemptId === playAttempt) {
            blocked = true;
            notify();
          }
        });
      } else {
        // Older media implementations do not return a promise from play().
        blocked = el.paused;
        notify();
      }
    }

    /**
     * Applies preferences, doing the least possible to the audio element.
     *
     * Volume is applied in place and never triggers a reload, because reloading
     * would restart the track from the top on every slider nudge.
     */
    function apply(tryAutoplay) {
      var el = ensureElement();
      var want = Music.resolve(prefs);
      var had = isPlaying();

      if (el.volume !== want.volume) el.volume = want.volume;

      if (!want.playing) {
        playAttempt++;
        if (!el.paused) el.pause();
        blocked = false;
        notify();
        return;
      }

      var current = { src: el.getAttribute('src') };

      if (Music.needsReload(current, want)) {
        // A pending result for the previous soundtrack must not change the UI.
        playAttempt++;
        el.src = want.src;
        el.currentTime = 0;
      } else if (!had) {
        // Same file, but stopped (paused by a previous Disable, or blocked).
        // Resume where it was rather than starting again.
      }

      if (had || unlocked || tryAutoplay) play();
      notify();
    }

    /**
     * Records the first real user gesture.
     *
     * Once true, apply() will start playback without further prompting. This is
     * what satisfies autoplay policy honestly - the music begins because the
     * player did something, not because the page tried to sneak it in.
     */
    function onFirstGesture(event) {
      if (unlocked) return;
      // Let the recovery button's own click retry. Starting on pointerdown or
      // its activation key can hide it before mobile/keyboard activation ends.
      if (event.target === document.getElementById('music-enable-button')) return;
      unlocked = true;

      document.removeEventListener('click', onFirstGesture, true);
      document.removeEventListener('keydown', onFirstGesture, true);

      // Only start if the player actually wants music.
      if (Music.resolve(prefs).playing) play();
    }

    function install() {
      var store = storage();
      preferencesSaved = !!store;
      prefs = Music.loadPrefs(store);
      ensureElement();
      // Attempt autoplay on startup. Browsers that require a gesture reject
      // play(); play() reports that and the settings UI offers an enable button.
      // Do not mark this attempt as a user gesture or bypass that browser policy.
      apply(true);

      if (!unlocked) {
        document.addEventListener('click', onFirstGesture, true);
        document.addEventListener('keydown', onFirstGesture, true);
      }
    }

    var api = {
      /** Current preferences, as a copy. */
      prefs: function () { return { track: prefs.track, volume: prefs.volume }; },

      /** Choose a track by id, remember it, and start it if permitted. */
      select: function (id) {
        if (!Music.trackById(id)) return false;
        prefs.track = id;
        preferencesSaved = Music.savePrefs(storage(), prefs);
        apply();
        return true;
      },

      /** Set volume 0..1, remember it, and apply it without restarting. */
      setVolume: function (value) {
        prefs.volume = Music.clampVolume(value);
        preferencesSaved = Music.savePrefs(storage(), prefs);
        apply();
      },

      /** True when the browser is refusing to start audio. */
      isBlocked: function () { return blocked; },

      /** True when music is actually coming out. */
      isPlaying: function () { return isPlaying(); },

      /** True when the latest preference change was saved to this browser. */
      preferencesSaved: function () { return preferencesSaved; },

      /**
       * Called by a button when autoplay was blocked.
       *
       * A click on a button is exactly the kind of gesture browsers want, so this
       * is the documented way out of a blocked state.
       */
      retry: function () { unlocked = true; apply(true); },

      onChange: function (fn) { onChange.push(fn); },

      /** Called once when the page is ready. */
      init: install
    };

    window.PhoenixMusicPlayer = api;

    /* ------------------------------------------------------------------ */
    /* The settings screen                                                */
    /* ------------------------------------------------------------------ */
    /*
     * Built from Music.TRACKS rather than from markup, so the screen cannot
     * disagree with the engine about which tracks exist - the same rule the
     * gallery follows for allies and cards.
     */
    function $(id) { return document.getElementById(id); }

    function screens() {
      return ['phoenix-menu', 'phoenix-game', 'gallery-gate', 'gallery', 'win-screen', 'ally-picker'];
    }

    function hideEverything() {
      screens().forEach(function (id) {
        var node = $(id);
        if (node) node.hidden = true;
      });
      ['game-toolbar', 'testing-panel'].forEach(function (id) {
        var node = $(id);
        if (node) node.hidden = true;
      });
    }

    function renderTracks() {
      var host = $('settings-tracks');
      host.replaceChildren();

      Music.TRACKS.forEach(function (track) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-track';
        button.setAttribute('role', 'radio');
        button.setAttribute('data-track', track.id);
        button.setAttribute('tabindex', '-1');

        var name = document.createElement('strong');
        name.textContent = track.name;

        var blurb = document.createElement('em');
        blurb.textContent = track.blurb;

        button.appendChild(name);
        button.appendChild(blurb);

        button.addEventListener('click', function () {
          // A click here is a user gesture, so this also serves to unlock audio
          // if the browser had been refusing it.
          unlocked = true;
          api.select(track.id);
          sync();
        });

        host.appendChild(button);
      });

      host.addEventListener('keydown', function (event) {
        var offset = {
          ArrowRight: 1,
          ArrowDown: 1,
          ArrowLeft: -1,
          ArrowUp: -1
        }[event.key];
        if (!offset) return;

        var buttons = host.querySelectorAll('.settings-track');
        var current = -1;
        buttons.forEach(function (button, index) {
          if (button === document.activeElement) current = index;
        });
        if (current < 0) return;

        event.preventDefault();
        var next = (current + offset + buttons.length) % buttons.length;
        var button = buttons[next];
        unlocked = true;
        api.select(button.getAttribute('data-track'));
        sync();
        button.focus();
      });
    }

    /** Pushes current state into the controls. */
    function sync() {
      var current = api.prefs();

      document.querySelectorAll('.settings-track').forEach(function (button) {
        var selected = button.getAttribute('data-track') === current.track;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('tabindex', selected ? '0' : '-1');
      });

      var percent = Math.round(current.volume * 100);
      $('settings-volume-slider').value = String(percent);
      $('settings-volume-value').textContent = percent + '%';

      var status = $('settings-music-status');

      if (api.isBlocked()) {
        status.textContent = 'Your browser paused the music. Use the enable-music button to let it play.';
      } else {
        status.textContent = current.track === 'off'
          ? 'Music is off.'
          : (api.isPlaying() ? 'Playing.' : 'Ready.');
      }
      if (!api.preferencesSaved()) {
        status.textContent += ' Your browser could not save this preference; it may reset when you reload.';
      }
    }

    api.onChange(sync);

    var settings = {
      open: function () {
        hideEverything();
        $('settings').hidden = false;
        sync();
        $('settings-back').focus();
      },

      leave: function () {
        $('settings').hidden = true;
        $('phoenix-menu').hidden = false;
      }
    };

    window.PhoenixMusicSettings = settings;

    document.addEventListener('DOMContentLoaded', function () {
      renderTracks();

      $('settings-back').addEventListener('click', settings.leave);

      $('settings-volume-slider').addEventListener('input', function (event) {
        api.setVolume(Number(event.target.value) / 100);
      });

      $('music-enable-button').addEventListener('click', function () {
        api.retry();
        sync();
      });
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  })();
}
