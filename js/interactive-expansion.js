/* PHOENIX — the expansion's interactive overlays.
 *
 * One file for all of them, because they share the same shape: a panel, a
 * button, and a message to the server. The server decides everything - the
 * timings, the targets, the outcomes - and this file only shows what the
 * server said and sends what the player did.
 *
 * Each card gets its own global (PhoenixMusicalChairsInteractive and friends)
 * so the existing overlay plumbing in online-client.js does not have to change.
 */
(function () {
  'use strict';

  var root = window;
  var SfxVolume = 0.35;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function send(decision) {
    if (root.ws && root.ws.readyState === 1) {
      root.ws.send(JSON.stringify({ type: 'interact', decision: decision }));
    }
  }

  function myId() {
    if (root.PhoenixOnline && root.PhoenixOnline.getState) {
      var state = root.PhoenixOnline.getState();
      if (state && state.players && state.seat !== undefined) {
        return state.players[state.seat].id;
      }
    }
    return null;
  }

  function mySeat() {
    if (root.PhoenixOnline && root.PhoenixOnline.getState) {
      var state = root.PhoenixOnline.getState();
      if (state && state.seat !== undefined) return state.seat;
    }
    return 0;
  }

  function playerName(id) {
    if (root.PhoenixOnline && root.PhoenixOnline.getState) {
      var state = root.PhoenixOnline.getState();
      var found = (state.players || []).filter(function (p) { return p.id === id; })[0];
      if (found) return found.name;
    }
    return id;
  }

  /** The sound preferences, so the overlays honour mute and volume. */
  function readPrefs() {
    if (root.PhoenixEffects && root.PhoenixEffects.load) {
      try { return root.PhoenixEffects.load(window.localStorage); } catch (e) { /* no storage */ }
    }
    return { sound: true, volume: SfxVolume, visuals: 'full' };
  }

  function reducedMotion() {
    if (root.PhoenixEffects && root.PhoenixEffects.motion) {
      try { return root.PhoenixEffects.motion(readPrefs(), window.matchMedia('(prefers-reduced-motion: reduce)').matches) === 'reduced'; } catch (e) { /* default */ }
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** A panel with a heading, a body and a footer. */
  function panel(id, cls, title, bodyHtml) {
    var overlay = document.createElement('div');
    overlay.className = 'interactive-overlay ' + cls;
    overlay.id = id;
    overlay.innerHTML =
      '<div class="interactive-shell" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '  <h2>' + title + '</h2>' +
      bodyHtml +
      '</div>';
    document.body.appendChild(overlay);
    overlay.hidden = false;
    return overlay;
  }

  function teardown(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.hidden = true;
      overlay.remove();
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Musical Chairs                                                      */
  /* ------------------------------------------------------------------ */

  var chairs = { overlay: null, audio: null, clock: null, disabledUntil: 0 };

  function stopChairsAudio() {
    if (chairs.audio) {
      try { chairs.audio.pause(); chairs.audio.currentTime = 0; } catch (e) { /* already stopped */ }
      chairs.audio = null;
    }
  }

  function startChairsAudio() {
    var prefs = readPrefs();
    if (!prefs.sound) return;
    stopChairsAudio();
    // One of the game's own licensed tracks, so nothing new is licensed.
    var audio = new Audio('assets/music/retro.mp3');
    audio.volume = Math.max(0, Math.min(1, (prefs.volume || SfxVolume) * 0.6));
    audio.loop = true;
    var started = audio.play();
    if (started && started.catch) started.catch(function () { /* blocked until a gesture */ });
    chairs.audio = audio;
  }

  function chairsBuild() {
    if (chairs.overlay && document.body.contains(chairs.overlay)) {
      chairs.overlay.hidden = false;
      return;
    }
    chairs.overlay = panel('musical-chairs-overlay', 'musicalchairs-overlay', 'Musical Chairs',
      '  <p id="mc-status">The music is playing. Press only AFTER it stops.</p>' +
      '  <div class="mc-stage" id="mc-stage"></div>' +
      '  <button type="button" id="mc-press" class="primary">PRESS</button>' +
      '  <p id="mc-feedback" aria-live="polite"></p>');
    document.getElementById('mc-press').onclick = function () {
      if (Date.now() < chairs.disabledUntil) return;
      send('press');
    };
    startChairsAudio();
  }

  function chairsOnState(msg) {
    var pi = msg.pendingInteraction;
    if (!pi) return;
    var data = pi.roundData || {};
    var status = document.getElementById('mc-status');
    var feedback = document.getElementById('mc-feedback');
    var button = document.getElementById('mc-press');
    if (!status) return;

    var stopsIn = Math.max(0, Math.ceil(((data.musicStopsAt || 0) - Date.now()) / 1000));
    var mine = (pi.submitted || []).indexOf(myId()) !== -1;
    if (mine) {
      status.textContent = 'You have pressed. Waiting for everybody else.';
      if (button) button.disabled = true;
    } else {
      status.textContent = stopsIn > 0
        ? 'The music is playing. It stops in ' + stopsIn + ' seconds.'
        : 'The music has stopped. PRESS NOW!';
      if (button) button.disabled = false;
    }
    if (feedback && data.message) feedback.textContent = data.message;
  }

  function chairsClose() {
    stopChairsAudio();
    if (chairs.clock) { clearInterval(chairs.clock); chairs.clock = null; }
    chairs.overlay = teardown(chairs.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Russian Roulette                                                    */
  /* ------------------------------------------------------------------ */

  var roulette = { overlay: null };

  function rouletteBuild() {
    if (roulette.overlay && document.body.contains(roulette.overlay)) {
      roulette.overlay.hidden = false;
      return;
    }
    roulette.overlay = panel('russian-roulette-overlay', 'roulette-overlay', 'Russian Roulette',
      '  <p id="rr-status">A revolver. One chamber. Choose who holds it.</p>' +
      '  <div class="rr-revolver" id="rr-revolver"><span id="rr-chamber">1/6</span></div>' +
      '  <div class="mc-stage" id="rr-targets"></div>' +
      '  <p id="rr-feedback" aria-live="polite"></p>');
  }

  function rouletteOnState(msg) {
    var pi = msg.pendingInteraction;
    if (!pi) return;
    var data = pi.roundData || {};
    var chamber = document.getElementById('rr-chamber');
    if (chamber) chamber.textContent = data.chamber + '/6';
    var status = document.getElementById('rr-status');
    var targets = document.getElementById('rr-targets');
    if (!status || !targets) return;

    var mine = myId();
    var iAmHolder = data.holder === mine;
    status.textContent = iAmHolder
      ? 'You are holding the revolver. Choose somebody to hand it to. The odds of the shot are ' + data.chamber + ' in 6.'
      : playerName(data.holder) + ' is holding the revolver.';

    targets.replaceChildren();
    if (!iAmHolder) return;
    var state = root.PhoenixOnline.getState();
    (state.players || []).forEach(function (p) {
      if (p.id === mine) return;
      var button = el('button', 'online-primary', p.name);
      button.type = 'button';
      button.onclick = function () { send('aim:' + p.id); };
      targets.appendChild(button);
    });
  }

  function rouletteClose() {
    roulette.overlay = teardown(roulette.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Memory Mayhem                                                       */
  /* ------------------------------------------------------------------ */

  var memory = { overlay: null, clock: null, revealed: false, sequence: [] };

  function memoryBuild() {
    if (memory.overlay && document.body.contains(memory.overlay)) {
      memory.overlay.hidden = false;
      return;
    }
    memory.overlay = panel('memory-mayhem-overlay', 'memory-overlay', 'Memory Mayhem',
      '  <p id="mm-status">Watch the sequence.</p>' +
      '  <div class="mm-sequence" id="mm-sequence"></div>' +
      '  <div class="mm-answer" id="mm-answer" hidden>' +
      '    <label for="mm-input">Type the symbols you saw</label>' +
      '    <input id="mm-input" type="text" maxlength="12" autocomplete="off" aria-label="The sequence you saw">' +
      '    <button type="button" id="mm-submit" class="primary">SUBMIT</button>' +
      '  </div>' +
      '  <p id="mm-feedback" aria-live="polite"></p>');
    document.getElementById('mm-submit').onclick = function () {
      var input = document.getElementById('mm-input');
      var value = (input && input.value ? input.value : '').trim();
      send('mem:' + (memory.sequenceIndex || 0) + ':' + value);
      if (input) input.disabled = true;
      var button = document.getElementById('mm-submit');
      if (button) button.disabled = true;
    };
  }

  function memoryOnState(msg) {
    var pi = msg.pendingInteraction;
    if (!pi) return;
    var data = pi.roundData || {};
    var index = data.phaseIndex || 0;
    var sequence = (data.sequences || [])[index] || [];
    memory.sequenceIndex = index;

    var status = document.getElementById('mm-status');
    var display = document.getElementById('mm-sequence');
    var answer = document.getElementById('mm-answer');
    if (!status || !display) return;

    // The sequence is shown for a server-decided time, then the player writes it
    // back. Everyone gets the same sequence and the same amount of time.
    if (!memory.revealed) {
      memory.revealed = true;
      status.textContent = 'Sequence ' + (index + 1) + ' of 3 - watch it.';
      display.replaceChildren();
      sequence.forEach(function (symbol) {
        display.appendChild(el('span', 'mm-symbol', symbol));
      });
      if (answer) answer.hidden = true;
      memory.clock = setTimeout(function () {
        memory.revealed = false;
        status.textContent = 'Sequence ' + (index + 1) + ' of 3 - write it back.';
        display.replaceChildren();
        if (answer) {
          answer.hidden = false;
          var input = document.getElementById('mm-input');
          if (input) { input.disabled = false; input.value = ''; input.focus(); }
        }
      }, data.revealMs || 2500);
    }
  }

  function memoryClose() {
    if (memory.clock) { clearTimeout(memory.clock); memory.clock = null; }
    memory.revealed = false;
    memory.overlay = teardown(memory.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* The Mimic                                                           */
  /* ------------------------------------------------------------------ */

  var mimic = { overlay: null };

  function mimicBuild() {
    if (mimic.overlay && document.body.contains(mimic.overlay)) {
      mimic.overlay.hidden = false;
      return;
    }
    mimic.overlay = panel('mimic-overlay', 'mimic-overlay', 'The Mimic',
      '  <p>Choose the card the Mimic will pretend to be. It will look exactly like it.</p>' +
      '  <div class="mc-stage" id="mimic-choices"></div>' +
      '  <p id="mimic-feedback" aria-live="polite"></p>');
  }

  function mimicOnState(msg) {
    var choices = document.getElementById('mimic-choices');
    if (!choices) return;
    choices.replaceChildren();
    var Cards = root.PhoenixCards;
    if (!Cards) return;
    Cards.CARDS.filter(function (c) {
      return !c.ownerOnly && c.id !== 'mimic' && c.inDeck !== false && c.inLiveGame !== false;
    }).forEach(function (card) {
      var button = el('button', 'online-primary', card.name);
      button.type = 'button';
      button.onclick = function () { send('disguise:' + card.id); };
      choices.appendChild(button);
    });
  }

  function mimicClose() {
    mimic.overlay = teardown(mimic.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Customer Support                                                    */
  /* ------------------------------------------------------------------ */

  var support = { overlay: null };

  var COMPLAINTS = [
    'My points have disappeared!',
    'This game is unfair!',
    'I demand compensation!'
  ];

  function supportBuild() {
    if (support.overlay && document.body.contains(support.overlay)) {
      support.overlay.hidden = false;
      return;
    }
    support.overlay = panel('support-overlay', 'support-overlay', 'PHOENIX Entertainment Customer Support',
      '  <p>Please tell us what went wrong. Every complaint is read by a real person.</p>' +
      '  <div class="mc-stage" id="support-choices"></div>' +
      '  <p id="support-feedback" aria-live="polite"></p>');
  }

  function supportOnState(msg) {
    var choices = document.getElementById('support-choices');
    if (!choices) return;
    choices.replaceChildren();
    COMPLAINTS.forEach(function (complaint) {
      var button = el('button', 'online-primary', complaint);
      button.type = 'button';
      button.onclick = function () { send('complaint:' + complaint); };
      choices.appendChild(button);
    });
  }

  function supportClose() {
    support.overlay = teardown(support.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Joshua Survey - owner only                                          */
  /* ------------------------------------------------------------------ */

  var survey = { overlay: null };

  function surveyBuild() {
    if (survey.overlay && document.body.contains(survey.overlay)) {
      survey.overlay.hidden = false;
      return;
    }
    survey.overlay = panel('survey-overlay', 'survey-overlay', 'Joshua Survey',
      '  <p id="survey-question" class="survey-question"></p>' +
      '  <div id="survey-answer-box" hidden>' +
      '    <label for="survey-input">Your answer</label>' +
      '    <input id="survey-input" type="text" maxlength="500" autocomplete="off" aria-label="Your answer">' +
      '    <button type="button" id="survey-submit" class="primary">SUBMIT ANSWER</button>' +
      '  </div>' +
      '  <div id="survey-answers"></div>' +
      '  <p id="survey-feedback" aria-live="polite"></p>');
    document.getElementById('survey-submit').onclick = function () {
      var input = document.getElementById('survey-input');
      var value = (input && input.value ? input.value : '').trim();
      if (!value) return;
      send('answer:' + value);
      if (input) input.disabled = true;
      var button = document.getElementById('survey-submit');
      if (button) button.disabled = true;
    };
  }

  function surveyOnState(msg) {
    var pi = msg.pendingInteraction;
    if (!pi) return;
    var data = pi.roundData || {};
    var question = document.getElementById('survey-question');
    if (question) question.textContent = data.question || '';
    var box = document.getElementById('survey-answer-box');
    var mine = myId();
    if (box) box.hidden = !!(data.answers && data.answers[mine] !== undefined);

    // The owner sees every answer, and accepts or declines them.
    var list = document.getElementById('survey-answers');
    if (!list) return;
    list.replaceChildren();
    var isOwner = pi.actorId === mine;
    if (!isOwner) return;
    Object.keys(data.answers || {}).forEach(function (who) {
      var row = el('div', 'survey-answer');
      row.appendChild(el('strong', '', playerName(who) + ': '));
      row.appendChild(el('span', '', data.answers[who]));
      if (!data.judged || !data.judged[who]) {
        var accept = el('button', 'online-primary', 'ACCEPT');
        accept.type = 'button';
        accept.onclick = function () { send('judge:' + who + ':accept'); };
        var decline = el('button', 'online-secondary', 'DECLINE');
        decline.type = 'button';
        decline.onclick = function () { send('judge:' + who + ':decline'); };
        row.appendChild(accept);
        row.appendChild(decline);
      } else {
        row.appendChild(el('span', 'survey-verdict', ' ' + data.judged[who].toUpperCase()));
      }
      list.appendChild(row);
    });
  }

  function surveyClose() {
    survey.overlay = teardown(survey.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* Did You Like the Trailer? - owner only                              */
  /* ------------------------------------------------------------------ */

  var trailer = { overlay: null, video: null, timer: null };

  function trailerBuild() {
    if (trailer.overlay && document.body.contains(trailer.overlay)) {
      trailer.overlay.hidden = false;
      return;
    }
    // The trailer is NOT ready. The placeholder is clearly labelled as such -
    // inventing trailer footage would be worse than admitting there is none -
    // and it cannot be skipped, because the card says so.
    trailer.overlay = panel('trailer-overlay', 'trailer-overlay', 'Did You Like the Trailer?',
      '  <p>The official PHOENIX trailer is not available in this build yet.</p>' +
      '  <p class="trailer-placeholder" id="trailer-placeholder">TRAILER PLACEHOLDER</p>' +
      '  <p id="trailer-status" aria-live="polite">Playing…</p>');
    var status = document.getElementById('trailer-status');
    var seconds = 0;
    trailer.timer = setInterval(function () {
      seconds += 1;
      if (status) status.textContent = 'Playing… ' + seconds + 's';
    }, 1000);
    // The trailer always ends, whatever happened, so nobody is stuck.
    trailer.timer2 = setTimeout(function () {
      if (trailer.timer) { clearInterval(trailer.timer); trailer.timer = null; }
      trailerClose();
    }, 20000);
  }

  function trailerOnState() { /* the server only has to say it happened */ }

  function trailerClose() {
    if (trailer.timer) { clearInterval(trailer.timer); trailer.timer = null; }
    if (trailer.timer2) { clearTimeout(trailer.timer2); trailer.timer2 = null; }
    trailer.overlay = teardown(trailer.overlay);
  }

  /* ------------------------------------------------------------------ */
  /* The registered overlays                                             */
  /* ------------------------------------------------------------------ */

  function register(name, spec) {
    root[name] = {
      build: function () { spec.build(); },
      onState: function (msg) { spec.onState(msg); },
      close: function () { spec.close(); }
    };
  }

  register('PhoenixMusicalChairsInteractive', {
    build: chairsBuild, onState: chairsOnState, close: chairsClose
  });
  register('PhoenixRussianRouletteInteractive', {
    build: rouletteBuild, onState: rouletteOnState, close: rouletteClose
  });
  register('PhoenixMemoryMayhemInteractive', {
    build: memoryBuild, onState: memoryOnState, close: memoryClose
  });
  register('PhoenixMimicInteractive', {
    build: mimicBuild, onState: mimicOnState, close: mimicClose
  });
  register('PhoenixSupportInteractive', {
    build: supportBuild, onState: supportOnState, close: supportClose
  });
  register('PhoenixJoshuaSurveyInteractive', {
    build: surveyBuild, onState: surveyOnState, close: surveyClose
  });
  register('PhoenixTrailerInteractive', {
    build: trailerBuild, onState: trailerOnState, close: trailerClose
  });

  /* ------------------------------------------------------------------ */
  /* The Dehydrated effect - the target's whole screen turns              */
  /* ------------------------------------------------------------------ */

  root.PhoenixDehydrated = {
    /** Is this connection being rotated right now? */
    active: function () {
      var state = root.PhoenixOnline && root.PhoenixOnline.getState();
      return !!(state && state.dehydrated);
    },
    /** Turn the effect on or off. Reduced motion gets a still alternative. */
    apply: function (on) {
      var screen = document.getElementById('online-screen');
      if (!screen) return;
      screen.classList.toggle('is-dehydrated', !!on);
      screen.classList.toggle('is-dehydrated-still', !!on && reducedMotion());
    }
  };
})();
