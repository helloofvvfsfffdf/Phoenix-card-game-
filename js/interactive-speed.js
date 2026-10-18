/* PHOENIX — Speed Challenge interactive minigame */
(function () {
  'use strict';
  var overlay = null;
  var reactionStarted = false;
  var goTime = 0;
  var myReactionTime = null;
  var myId = null;

  function build() {
    if (overlay && document.body.contains(overlay)) {
      overlay.hidden = false;
      return;
    }
    overlay = document.createElement('div');
    overlay.className = 'interactive-overlay speed-overlay';
    overlay.id = 'speed-overlay';
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="Speed Challenge">' +
      '  <h2>Speed Challenge</h2>' +
      '  <div class="speed-visual" id="speed-visual">' +
      '    <div class="speed-light" id="speed-light" aria-hidden="true"></div>' +
      '    <div class="speed-timer" id="speed-timer" aria-live="polite">0ms</div>' +
      '  </div>' +
      '  <p id="speed-status">Press Ready when both players are prepared.</p>' +
      '  <button type="button" id="speed-ready-btn" class="primary">Ready!</button>' +
      '  <button type="button" id="speed-go-btn" class="danger" hidden aria-label="GO!">GO!</button>' +
      '  <p id="speed-feedback" aria-live="polite"></p>' +
      '  <p class="speed-fineprint">Server-authoritative timing. False starts are penalised.</p>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;

    document.getElementById('speed-ready-btn').onclick = submitReady;
    document.getElementById('speed-go-btn').onclick = submitReaction;

    if (window.PhoenixOnline && window.PhoenixOnline.getState) {
      var state = window.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        myId = state.players[state.seat].id;
      }
    }
  }

  function submitReady() {
    if (!window.ws || window.ws.readyState !== 1) return;
    window.ws.send(JSON.stringify({ type: 'interact', decision: 'ready' }));
    document.getElementById('speed-ready-btn').hidden = true;
    document.getElementById('speed-status').textContent = 'Waiting for opponent to ready…';
  }

  function startCountdown() {
    var countdownEl = document.getElementById('speed-countdown');
    var goBtn = document.getElementById('speed-go-btn');
    var statusEl = document.getElementById('speed-status');
    var feedbackEl = document.getElementById('speed-feedback');
    var light = document.getElementById('speed-light');

    if (light) light.classList.add('speed-light-waiting');

    var count = 3;
    function tick() {
      if (count > 0) {
        statusEl.textContent = count;
        if (window.gsap) {
          window.gsap.fromTo(statusEl, {scale: 0.5, opacity: 0}, {scale: 1, opacity: 1, duration: 0.3, ease: 'power2.out'});
        }
        count--;
        setTimeout(tick, 1000);
      } else {
        statusEl.textContent = 'Get ready…';
        var delay = 1000 + Math.random() * 2000;
        setTimeout(showGoSignal, delay);
      }
    }
    tick();
  }

  function showGoSignal() {
    var countdownEl = document.getElementById('speed-countdown');
    var goBtn = document.getElementById('speed-go-btn');
    var statusEl = document.getElementById('speed-status');
    var feedbackEl = document.getElementById('speed-feedback');
    var light = document.getElementById('speed-light');

    if (light) {
      light.classList.remove('speed-light-waiting');
      light.classList.add('speed-light-go');
    }

    countdownEl.hidden = true;
    goBtn.hidden = false;
    statusEl.textContent = 'GO! Press NOW!';
    feedbackEl.textContent = '';

    goTime = Date.now();
    reactionStarted = true;

    if (window.gsap) {
      window.gsap.fromTo(goBtn, {scale: 0.8}, {scale: 1, duration: 0.2, ease: 'back.out(2)'});
    }
  }

  function submitReaction() {
    if (!reactionStarted) {
      reactionStarted = false;
      document.getElementById('speed-go-btn').hidden = true;
      document.getElementById('speed-status').textContent = 'False start! You reacted too early.';
      document.getElementById('speed-feedback').textContent = 'Penalty applied. Waiting for opponent…';
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'interact', decision: 'false_start' }));
      }
      return;
    }

    var reactionTime = Date.now() - goTime;
    myReactionTime = reactionTime;

    reactionStarted = false;
    document.getElementById('speed-go-btn').hidden = true;
    document.getElementById('speed-status').textContent = 'You reacted in ' + reactionTime + 'ms.';
    document.getElementById('speed-feedback').textContent = 'Waiting for opponent…';

    if (window.gsap) {
      window.gsap.to(document.getElementById('speed-status'), {color: '#00ff88', duration: 0.3, yoyo: true, repeat: 1});
    }

    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'interact', decision: 'time:' + reactionTime }));
    }
  }

  function onState(msg) {
    if (!msg.pendingInteraction || msg.pendingInteraction.type !== 'speed') return;

    var pi = msg.pendingInteraction;
    var statusEl = document.getElementById('speed-status');
    var countdownEl = document.getElementById('speed-countdown');
    var goBtn = document.getElementById('speed-go-btn');
    var feedbackEl = document.getElementById('speed-feedback');
    var readyBtn = document.getElementById('speed-ready-btn');
    var light = document.getElementById('speed-light');

    var mySubmitted = pi.decisions && pi.decisions.main && pi.decisions.main[myId];

    if (pi.phase === 'countdown' || (pi.submitted && pi.submitted.length === 1 && !mySubmitted)) {
      if (!mySubmitted && readyBtn && !readyBtn.hidden) {
        statusEl.textContent = 'Opponent is ready. Press Ready!';
      }
      return;
    }

    if (pi.submitted && pi.submitted.length === 2) {
      if (!reactionStarted && !countdownEl.hidden === false && goBtn.hidden) {
        startCountdown();
      }
      return;
    }

    if (pi.roundData && pi.roundData.goSignal) {
      if (!reactionStarted && goBtn.hidden) {
        showGoSignal();
      }
      return;
    }

    if (msg.events) {
      var resultEvent = msg.events.find(function (e) {
        return e.type === 'result' && e.cardId === 'speed';
      });
      if (resultEvent) {
        goBtn.hidden = true;
        countdownEl.hidden = true;
        statusEl.textContent = 'Complete';
        feedbackEl.textContent = resultEvent.text || 'Speed Challenge resolved.';
        if (myReactionTime !== null) {
          feedbackEl.textContent += ' Your time: ' + myReactionTime + 'ms.';
        }
        if (window.gsap) {
          window.gsap.to(feedbackEl, {color: '#00ff88', duration: 0.5, yoyo: true, repeat: 1});
        }
        setTimeout(function () { close(); }, 6000);
      }
    }
  }

  function close() {
    if (overlay) { overlay.hidden = true; overlay.remove(); overlay = null; }
    reactionStarted = false;
    goTime = 0;
    myReactionTime = null;
  }

  window.PhoenixSpeedInteractive = { build: build, close: close, onState: onState };
})();