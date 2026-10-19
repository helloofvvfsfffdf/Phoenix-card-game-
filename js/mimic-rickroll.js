/* PHOENIX — the Mimic's prank.
 *
 * The whole point of the Mimic is that the card LOOKS like something else and
 * then nothing happens. This is what "nothing happens" looks like: the official
 * Rick Astley video, full screen, over the player's game.
 *
 * The video is played through the OFFICIAL YouTube IFrame Player API, which is
 * the supported way to embed a YouTube video on a web page. Nothing here tries
 * to hide advertisements, defeat a "watch on YouTube" restriction, or get
 * around anything YouTube does. The player is simply given the video.
 *
 * Three rules this file keeps to:
 *
 *   1. There is NO skip and NO fast-forward while the video is playing. The
 *      controls are off and the video runs to its end.
 *   2. If the video CANNOT play - blocked embed, an error, a disconnect, or it
 *      simply never loads - the player is offered a way to continue. A match
 *      must never be held hostage by a video.
 *   3. The server is told when it is over, so the game can carry on. The
 *      client never decides that a card may be played; it only says "the video
 *      finished".
 */
(function () {
  'use strict';

  var root = window;

  /* The official Rick Astley video. */
  var VIDEO_ID = 'dQw4w9WgXcQ';

  /* How long we wait for the API and the first frame before offering a way out.
     Long enough for a slow phone, short enough that nobody is stuck. */
  var LOAD_TIMEOUT_MS = 15000;
  /* A backstop for the whole thing, so a video that never reports its end (a
     backgrounded tab, a paused player) cannot hold a match forever. */
  var MAX_PLAYBACK_MS = 6 * 60 * 1000;

  var overlay = null;
  var player = null;
  var loadTimer = null;
  var maxTimer = null;
  var fallbackTimer = null;
  var reported = false;

  function clearTimers() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }

  /** Tell the server it is over, so the game can carry on. */
  function reportDone() {
    if (reported) return;
    reported = true;
    try {
      if (root.ws && root.ws.readyState === 1) {
        root.ws.send(JSON.stringify({ type: 'rickroll_done' }));
      }
    } catch (e) { /* the socket is going away; the server has its own backstop */ }
  }

  function teardown() {
    clearTimers();
    if (player && typeof player.destroy === 'function') {
      try { player.destroy(); } catch (e) { /* already gone */ }
    }
    player = null;
    if (overlay && overlay.parentNode) {
      overlay.hidden = true;
      overlay.remove();
    }
    overlay = null;
    document.body.classList.remove('phoenix-rickroll-playing');
  }

  /** The video ended, or the player gave up. Either way, the game resumes. */
  function finish() {
    reportDone();
    teardown();
  }

  /**
   * The video cannot be shown. The player is offered a way to continue, because
   * a match must never be stuck behind a video that will not play.
   */
  function offerWayOn(reason) {
    if (!overlay) return;
    var note = overlay.querySelector('.phoenix-rickroll-note');
    var button = overlay.querySelector('.phoenix-rickroll-continue');
    if (note) {
      note.textContent = reason === 'blocked'
        ? 'The video could not be loaded here, so the card simply does nothing. You can carry on.'
        : 'The video would not start, so the card simply does nothing. You can carry on.';
    }
    if (button) {
      button.hidden = false;
      button.onclick = finish;
    }
    // Nothing is playing, so the game is not actually held up - but the server
    // still needs to be told, or it will keep refusing that player's moves.
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(finish, 20000);
  }

  /** Load the official IFrame Player API, once. */
  function withApi(callback) {
    if (root.YT && root.YT.Player) { callback(); return; }
    root.__phoenixYouTubeReady = function () {
      root.__phoenixYouTubeReady = null;
      callback();
    };
    if (!document.getElementById('phoenix-youtube-api')) {
      var tag = document.createElement('script');
      tag.id = 'phoenix-youtube-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = function () {
        if (root.__phoenixYouTubeReady) { root.__phoenixYouTubeReady = null; }
        offerWayOn('blocked');
      };
      document.head.appendChild(tag);
    }
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (!player) offerWayOn('timeout');
    }, LOAD_TIMEOUT_MS);
  }

  function buildOverlay() {
    if (overlay && overlay.parentNode) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'phoenix-rickroll';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'The Mimic');
    overlay.innerHTML =
      '<div class="phoenix-rickroll-panel">' +
      '  <div class="phoenix-rickroll-frame" id="phoenix-rickroll-frame"></div>' +
      '  <p class="phoenix-rickroll-note">The card was a Mimic. This was never going to work.</p>' +
      '  <button type="button" class="phoenix-rickroll-continue" hidden>CONTINUE</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    document.body.classList.add('phoenix-rickroll-playing');
  }

  /**
   * Show the video.
   *
   * The controls are OFF, so there is no skip and no fast-forward while it
   * plays. Autoplay is attempted with sound; if the browser refuses - which
   * mobile browsers usually do until the player has interacted with the page -
   * a Play Video button appears instead, and the video then plays with sound.
   */
  function show() {
    reported = false;
    buildOverlay();

    withApi(function () {
      if (!overlay) return;
      var frame = document.getElementById('phoenix-rickroll-frame');
      if (!frame) return;
      try {
        player = new root.YT.Player('phoenix-rickroll-frame', {
          videoId: VIDEO_ID,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1
          },
          events: {
            onReady: function (event) {
              // The browser may refuse to start with sound. Asking for it
              // plainly is the supported way to get there.
              try {
                event.target.playVideo();
                if (event.target.getPlayerState && event.target.getPlayerState() === 1) {
                  hideContinue();
                }
              } catch (e) { /* the player reports the state instead */ }
            },
            onStateChange: function (event) {
              if (!event || !root.YT) return;
              if (event.data === root.YT.PlayerState.ENDED) {
                // The video ran to its end. The game carries on.
                finish();
              } else if (event.data === root.YT.PlayerState.PLAYING) {
                hideContinue();
              }
            },
            onError: function () {
              offerWayOn('error');
            }
          }
        });
      } catch (e) {
        offerWayOn('error');
      }
    });

    // The backstop, whatever happens.
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = setTimeout(finish, MAX_PLAYBACK_MS);
  }

  function hideContinue() {
    if (!overlay) return;
    var button = overlay.querySelector('.phoenix-rickroll-continue');
    if (button) button.hidden = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }

  root.PhoenixMimicRickroll = {
    show: show,
    finish: finish,
    isPlaying: function () { return !!overlay; }
  };
})();
