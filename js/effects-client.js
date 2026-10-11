/* Fire-and-forget presentation: never a turn lock or a source of game rules. */
(function () {
  'use strict';
  var E = window.PhoenixEffects;
  var store;
  try { store = window.localStorage; } catch (e) { store = null; }
  var prefs = E.load(store);
  var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var active = [], voices = [], context = null, master = null, soundBuffers = Object.create(null);
  var audioBlocked = false, saved = true;
  var Context = window.AudioContext || window.webkitAudioContext;
  var network = E.cursor();
  var endings = E.endCursor(), celebration = null, previewing = false, previewSerial = 0;
  var warmup = null;
  var phoenix = null, pendingEnd = null, phoenixBuffer = null, phoenixLoad = null, phoenixContext = null;
  var localState = null, localArmed = false, localFinished = new WeakSet();
  var deferredWin = null;
  var victoryPreview = false, lastMatchDiagnostic = null;

  function isAudioBlocked() { return prefs.sound && prefs.volume > 0 && audioBlocked; }
  function refreshButton() {
    var button = document.getElementById('music-enable-button');
    if (!button) return;
    var musicBlocked = window.PhoenixMusicPlayer && window.PhoenixMusicPlayer.isBlocked();
    button.hidden = !(musicBlocked || isAudioBlocked());
    button.textContent = isAudioBlocked() ? 'Click to enable audio' : 'Click to enable music';
  }
  function sync() {
    var sound = document.getElementById('settings-sound-enabled');
    if (!sound) return;
    sound.checked = prefs.sound;
    document.getElementById('settings-sound-volume').value = Math.round(prefs.volume * 100);
    document.getElementById('settings-sound-value').textContent = Math.round(prefs.volume * 100) + '%';
    document.getElementById('settings-visual-effects').value = prefs.visuals;
    var victory = window.PhoenixVictoryScene && window.PhoenixVictoryScene.diagnostics();
    var lastVictory = victory && victory.stopReason ? ' Last victory: '+victory.stopReason+' at '+Number(victory.stoppedAt || 0).toFixed(2)+'s; on screen '+Number(victory.visibleSeconds || 0).toFixed(2)+'s ('+(victory.endPhase || 'unknown')+').' : '';
    var defeat = window.PhoenixDefeatScene && window.PhoenixDefeatScene.diagnostics();
    var lastDefeat = defeat && defeat.stopReason ? ' Last defeat: '+defeat.stopReason+' at '+Number(defeat.stoppedAt || 0).toFixed(2)+'s; on screen '+Number(defeat.visibleSeconds || 0).toFixed(2)+'s ('+(defeat.endPhase || 'unknown')+').' : '';
    var graphicsStatus = !victory ? 'Victory renderer: script unavailable. ' :
      'Victory renderer: '+(victory.error || victory.preparationError ? 'error' : victory.ready ? 'ready' : victory.active ? 'starting' : 'not prepared')+'. ';
    document.getElementById('settings-effects-status').textContent =
      (!Context ? 'Sound synthesis is unavailable in this browser. ' : '') +
      (isAudioBlocked() ? 'Use the enable-audio button or tap a control to enable sounds. ' : '') +
      (media.matches ? 'Your system requests reduced motion. ' : '') +
       (!saved ? 'This browser could not save these preferences.' : '') + graphicsStatus +
       'Effective motion: '+E.motion(prefs,media.matches)+'. '+
       (pendingEnd ? 'Victory/result is waiting for the Phoenix card cinematic. ' : '') + lastVictory + lastDefeat +
       (victory && (victory.error || victory.preparationError) ? ' Victory effects unavailable: '+(victory.error || victory.preparationError)+'.' : '') +
       (defeat && (defeat.error || defeat.preparationError) ? ' Defeat effects unavailable: '+(defeat.error || defeat.preparationError)+'.' : '');
    refreshButton();
  }
  function disposeVoice(voice) {
    voice.nodes.forEach(function (node) { try { node.stop(); } catch (e) {} node.disconnect(); });
    voice.gains.forEach(function (node) { node.disconnect(); });
    clearTimeout(voice.timer);
    voices = voices.filter(function (v) { return v !== voice; });
  }
  function stopSounds() { voices.slice().forEach(disposeVoice); }
  function bufferFor(key, inert) {
    if (key === 'phoenix' && !inert && phoenixBuffer && phoenixContext === context) return phoenixBuffer;
    var cacheKey = key + (inert ? ':inert' : ':active');
    if (!soundBuffers[cacheKey]) {
      var recipe = E.soundRecipe(key, inert), seed = 173;
      for (var i = 0; i < key.length; i++) seed = (Math.imul(seed,31) + key.charCodeAt(i)) >>> 0;
      var samples = E.renderSound(recipe, context.sampleRate, seed);
      var buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples); soundBuffers[cacheKey] = buffer;
    }
    return soundBuffers[cacheKey];
  }
  function preparePhoenixAudio(current) {
    if (!current || !current.decodeAudioData || !window.fetch) return null;
    if (phoenixContext === current && phoenixLoad) return phoenixLoad;
    phoenixContext = current; phoenixBuffer = null;
    phoenixLoad = window.fetch('assets/phoenix/fire-roar.mp3').then(function (response) {
      if (!response.ok) throw new Error('Phoenix sound unavailable');
      return response.arrayBuffer();
    }).then(function (bytes) { return current.decodeAudioData(bytes); }).then(function (buffer) {
      if (context === current && phoenixContext === current) phoenixBuffer = buffer;
    }).catch(function () { /* Original Phoenix-only fire synthesis fallback. */ });
    return phoenixLoad;
  }
  function warmVictory() {
    // The long fanfare is normally prepared during lobby idle time, never
    // played here. Avoid repeated scheduling and retain a synchronous fallback
    // for browsers without idle callbacks. No context is created speculatively.
    if (!window.requestIdleCallback || warmup !== null || soundBuffers['victory:active']) return;
    var current = context;
    warmup = window.requestIdleCallback(function () {
      warmup = null;
      if (context !== current || !prefs.sound || prefs.volume === 0 || current.state !== 'running') return;
      try { bufferFor('victory', false); } catch (e) { /* On-demand fallback. */ }
    });
  }
  function cleanupVisual(record) {
    clearTimeout(record.timer);
    record.node.remove();
    active = active.filter(function (item) { return item !== record; });
  }
  function clearVisuals() { active.slice().forEach(cleanupVisual);if(!phoenix && window.PhoenixCardScene)window.PhoenixCardScene.stop(); }
  function update(next) {
    prefs = E.normalise(Object.assign({}, prefs, next));
    saved = E.save(store, prefs);
    if (master && context) master.gain.setTargetAtTime(prefs.sound ? prefs.volume * 0.18 : 0, context.currentTime, 0.02);
    if (!prefs.sound || prefs.volume === 0) { audioBlocked = false; stopSounds(); }
    clearVisuals();
    if (celebration && E.motion(prefs, media.matches) !== 'full') finishCelebration('preferences');
    if (phoenix && E.motion(prefs, media.matches) !== 'full') finishPhoenix(true);
    if(window.PhoenixMatchShowcase)window.PhoenixMatchShowcase.preferenceChanged();
    sync();
  }
  // Called synchronously by genuine input, never after a network callback.
  function unlock() {
    if (!Context || !prefs.sound || prefs.volume === 0) return;
    try {
      if (!context || context.state === 'closed') {
        context = new Context();
        soundBuffers = Object.create(null);
        master = context.createGain();
        master.gain.value = prefs.volume * 0.18;
        var compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 20;
        compressor.ratio.value = 8;
        master.connect(compressor);
        compressor.connect(context.destination);
      }
      var current = context;
      var promise = context.resume();
      if (promise && promise.then) promise.then(function () {
        if (context !== current) return;
        audioBlocked = current.state !== 'running';
        if (!audioBlocked) warmVictory();
        if (!audioBlocked) preparePhoenixAudio(current);
        sync();
      }, function () { if (context === current) { audioBlocked = true; sync(); } });
      else { audioBlocked = context.state !== 'running'; if (!audioBlocked) warmVictory(); sync(); }
      return promise;
    } catch (e) { audioBlocked = true; sync(); }
  }
  function sound(key, inert) {
    if (!prefs.sound || prefs.volume === 0 || !Context) return;
    if (!context || context.state !== 'running') { audioBlocked = true; sync(); return; }
    if (voices.length >= 3) disposeVoice(voices[0]);
    var voice = { nodes: [], gains: [], timer: null };
    voices.push(voice);
    try {
      var recipe = E.soundRecipe(key, inert);
      if (!recipe) { disposeVoice(voice); return; }
      var duration = recipe.duration;
      // One bounded source per event, even for multilayer Foley. Existing
      // master gain, compression, mute, deduplication and voice cap stay intact.
      var source = context.createBufferSource();
      source.buffer = bufferFor(key, inert);
      voice.nodes.push(source);
      source.connect(master);
      source.start(context.currentTime);
      var length = source.buffer.duration || duration + (recipe.tail || 0.08);
      source.stop(context.currentTime + length);
      voice.timer = setTimeout(function () { disposeVoice(voice); }, (length + 0.07) * 1000);
    } catch (e) { disposeVoice(voice); }
  }
  function anchor(seat, scope) {
    var node = document.querySelector('#' + scope + ' [data-effect-seat="' + seat + '"]');
    if (!node) return { x: window.innerWidth / 2, y: Math.min(window.innerHeight / 2, 230) };
    var box = node.getBoundingClientRect();
    var margin = Math.min(120, window.innerWidth / 2);
    return { x: Math.max(margin, Math.min(window.innerWidth - margin, box.left + box.width / 2)),
      y: Math.max(80, Math.min(window.innerHeight - 100, box.top + box.height / 2)) };
  }
  function show(event, scope) {
    var safe = E.publicEvent(event && event.key, event && event.actor, event && event.target, event && event.outcome);
    if (!safe || document.hidden) return;
    var definition = E.DEFINITIONS[safe.key];
    if (celebration) return; // End fanfare has priority; consume still advances IDs.
    if (previewing && scope !== 'settings') stopPreview();
    if (phoenix) return; // All public IDs still advance, but avoid SFX pile-up.
    if (window.PhoenixCardScene && window.PhoenixCardScene.supports(safe.key)) {
      // Approved particle artwork replaces only card presentation, not rules,
      // hand UI or audio. Existing SFX stay exactly as configured; no new sounds.
      sound(safe.key,safe.outcome === 'inert');
      var cardSettings=document.getElementById('settings');
      if(scope !== 'settings' && cardSettings && !cardSettings.hidden)return;
      var cardMotion=E.motion(prefs,media.matches);if(cardMotion==='off')return;
      var legendary=safe.key==='phoenix' && safe.outcome!=='inert';
      if(legendary)clearVisuals();
      var cardScene=window.PhoenixCardScene.start(safe,{motion:cardMotion,scope:scope || 'online-screen',
        source:anchor(safe.actor,scope || 'online-screen'),
        onFinish:legendary?function(){finishPhoenix(true);}:null});
      if(legendary)phoenix=cardScene;
      return;
    }
    if (safe.key === 'phoenix' && safe.outcome !== 'inert' && window.PhoenixFireScene) {
      var modal = document.getElementById('settings');
      if (scope !== 'settings' && modal && !modal.hidden) { sound('phoenix',false); return; }
      startPhoenix(false); return;
    }
    sound(safe.key, safe.outcome === 'inert');
    var settings = document.getElementById('settings');
    if (scope !== 'settings' && settings && !settings.hidden) return;
    var mode = E.motion(prefs, media.matches);
    if (mode === 'off') return;
    if (active.length >= 3) cleanupVisual(active[0]);
    var point = anchor(safe.target >= 0 ? safe.target : safe.actor, scope || 'online-screen');
    var destination = anchor(safe.actor, scope || 'online-screen');
    var node = document.createElement('div');
    node.className = 'cinematic cinematic-' + definition[3] + (mode === 'reduced' ? ' cinematic-reduced' : '') +
      (safe.outcome === 'inert' ? ' cinematic-inert' : '');
    node.dataset.effect = safe.key;
    node.dataset.level = safe.key === 'bonus' ? '1' : '2';
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--fx-color', definition[2]);
    node.style.setProperty('--fx-x', point.x + 'px');
    node.style.setProperty('--fx-y', point.y + 'px');
    node.style.setProperty('--fx-dx', (destination.x - point.x) + 'px');
    node.style.setProperty('--fx-dy', (destination.y - point.y) + 'px');
    var seal = document.createElement('span');
    seal.className = 'cinematic-seal';
    seal.textContent = definition[1];
    node.appendChild(seal);
    var label = document.createElement('span');
    label.className = 'cinematic-label';
    label.textContent = definition[0] + (safe.outcome === 'inert' ? ' · No change' : '');
    node.appendChild(label);
    if (mode === 'full' && safe.outcome !== 'inert') {
      var aura = document.createElement('span'); aura.className = 'cinematic-aura'; node.appendChild(aura);
      var ribbon = document.createElement('span'); ribbon.className = 'cinematic-ribbon'; node.appendChild(ribbon);
      for (var i = 0; i < (safe.key === 'bonus' ? 12 : 10); i++) {
        var mote = document.createElement('i');
        mote.className = 'cinematic-mote';
        mote.style.setProperty('--i', i);
        node.appendChild(mote);
      }
    }
    document.body.appendChild(node);
    var record = { node: node, timer: null };
    active.push(record);
    record.timer = setTimeout(function () { cleanupVisual(record); }, mode === 'reduced' ? 650 : 1500);
    node.addEventListener('animationend', function (event) { if (event.target === node) cleanupVisual(record); });
  }
  function displayBatch(events, scope) {
    // A legendary card must not be discarded by the ordinary eight-event cap.
    var legendary = events.find(function (event) { return event.key === 'phoenix' && event.outcome !== 'inert'; });
    if (legendary && window.PhoenixFireScene) { show(legendary, scope); return; }
    (scope === 'online-screen' ? events.slice(-8) : events).forEach(function (event) { show(event, scope); });
  }
  function consume(packet) { displayBatch(network.consume(packet), 'online-screen'); }
  function finishPhoenix(runEnd) {
    var stage = phoenix; phoenix = null;
    if (stage) { stage.stop(false); stopSounds(); }
    var result = pendingEnd; pendingEnd = null;
    if (runEnd && result) celebrate(result.kind,result.winner);
  }
  function startPhoenix(isPreview) {
    finishPhoenix(false); clearVisuals(); stopSounds();
    var mode = E.motion(prefs,media.matches);
    if (mode === 'off') { sound('phoenix',false); return; }
    phoenix = window.PhoenixFireScene.start({ reduced:mode === 'reduced', preview:isPreview,
      restoreFocus:document.getElementById(isPreview?'settings-phoenix-cinematic':'online-settings'),
      onFinish:function(){finishPhoenix(true);} });
    sound('phoenix',false);
  }
  function finishCelebration(reason) {
    if (!celebration) return;
    var c = celebration, focused = document.activeElement === c.skip; celebration = null;
    if(victoryPreview){victoryPreview=false;previewing=false;}
    clearTimeout(c.timer); if (c.stop) c.stop(false,typeof reason==='string'?reason:'dismissed'); else c.node.remove(); stopSounds();
    sync();
    // Never steal focus on entry; if the skip control held it on dismissal,
    // restore the existing match Settings control rather than losing it.
    if (focused) {
      var button = document.getElementById('online-settings');
      if (button && !document.getElementById('online-screen').hidden) button.focus();
    }
  }
  function celebrate(kind, winner) {
    finishCelebration(); clearVisuals(); stopSounds(); previewing = false;
    if(window.PhoenixMatchShowcase)window.PhoenixMatchShowcase.preferenceChanged();
    if (document.hidden) {if(kind==='victory' && window.PhoenixVictoryScene)deferredWin=winner || {};return;}
    sound(kind, false);
    var mode = E.motion(prefs, media.matches);
    if (mode === 'off') return;
    if (kind === 'victory' && window.PhoenixVictoryScene) {
      celebration = window.PhoenixVictoryScene.start({winner:winner,reduced:mode === 'reduced',
        restoreFocus:document.getElementById(!document.getElementById('online-screen').hidden?'online-settings':'btn-play-again'),
        onFinish:finishCelebration});
      return;
    }
    // The defeated local player gets the approved catastrophic-defeat study. The
    // name shown is the confirmed winner (the opponent), never a local guess.
    if (kind === 'defeat' && window.PhoenixDefeatScene) {
      celebration = window.PhoenixDefeatScene.start({winner:winner,reduced:mode === 'reduced',
        restoreFocus:document.getElementById(!document.getElementById('online-screen').hidden?'online-settings':'btn-play-again'),
        onFinish:finishCelebration});
      return;
    }
    var node = document.createElement('section');
    node.className = 'match-celebration celebration-' + kind + (mode === 'reduced' ? ' celebration-reduced' : '');
    node.setAttribute('role', 'region'); node.setAttribute('aria-label', 'Match result celebration');
    var scene = document.createElement('div'); scene.className = 'celebration-scene'; scene.setAttribute('aria-hidden', 'true');
    node.appendChild(scene);
    if (kind === 'victory' && mode === 'full') {
      var mobile = window.innerWidth < 600;
      for (var b = 0; b < (mobile ? 4 : 6); b++) {
        var beam = document.createElement('i'); beam.className = 'celebration-beam';
        beam.style.setProperty('--i', b); scene.appendChild(beam);
      }
      for (var j = 0; j < (mobile ? 32 : 56); j++) {
        var particle = document.createElement('i');
        particle.className = 'celebration-particle particle-' + ['confetti','ember','phoenix'][j % 3];
        particle.style.setProperty('--i', j);
        particle.style.setProperty('--x', ((j * 37) % 100) + '%');
        particle.style.setProperty('--drift', ((j % 9 - 4) * 22) + 'px'); scene.appendChild(particle);
      }
      for (var f = 0; f < 3; f++) {
        var burst = document.createElement('div'); burst.className = 'celebration-burst';
        burst.style.setProperty('--burst', f);
        for (var ray = 0; ray < (mobile ? 8 : 12); ray++) {
          var spark = document.createElement('i'); spark.style.setProperty('--angle', (ray * (mobile ? 45 : 30)) + 'deg'); burst.appendChild(spark);
        }
        scene.appendChild(burst);
      }
    }
    var message = document.createElement('div'); message.className = 'celebration-message';
    var crest = document.createElement('span'); crest.className = 'celebration-crest'; crest.textContent = kind === 'victory' ? '✺' : '◌'; crest.setAttribute('aria-hidden','true');
    var title = document.createElement('h2'); title.textContent = kind === 'victory' ? 'VICTORY' : kind === 'draw' ? 'MATCH DRAWN' : 'DEFEAT';
    var line = document.createElement('p'); line.textContent = kind === 'victory' ? 'RISE. PLAY. SURVIVE.' : kind === 'draw' ? 'The flames remain in balance.' : 'The flame will rise again.';
    message.setAttribute('role','status'); message.appendChild(crest); message.appendChild(title); message.appendChild(line); node.appendChild(message);
    var skip = document.createElement('button'); skip.type = 'button'; skip.className = 'celebration-skip'; skip.textContent = 'Skip celebration';
    skip.addEventListener('click', finishCelebration); node.appendChild(skip);
    document.body.appendChild(node);
    celebration = { node: node, skip: skip, timer: setTimeout(finishCelebration, kind === 'victory' ? 5000 : 2400) };
  }
  function prepareVictory() {
    if(window.PhoenixCardScene && E.motion(prefs,media.matches)==='full')window.PhoenixCardScene.prepare().catch(function(){ /* Card fallback keeps input available. */ });
    if (window.PhoenixVictoryScene && E.motion(prefs,media.matches) === 'full') window.PhoenixVictoryScene.prepare().catch(function(){ /* Result fallback is handled by the scene. */ });
    if (window.PhoenixDefeatScene && E.motion(prefs,media.matches) === 'full') window.PhoenixDefeatScene.prepare().catch(function(){ /* Result fallback is handled by the scene. */ });
  }
  function result(kind,winner) { if (phoenix) pendingEnd={kind:kind,winner:winner}; else celebrate(kind,winner); }
  function match(snapshot) {
    if (snapshot && snapshot.started && !snapshot.over) prepareVictory();
    var kind = endings.consume(snapshot);
    if(snapshot)lastMatchDiagnostic={started:!!snapshot.started,over:!!snapshot.over,result:E.matchResult(snapshot),requested:kind || null};
    if (kind) result(kind,(snapshot.players || []).find(function(p){return p.id === snapshot.winner;}));
  }
  function localMatch(state, ally) {
    if (!state || document.getElementById('phoenix-game').hidden) return;
    if (localState !== state) {localState=state;localArmed=!state.over;}
    if (!state.over) {localArmed=true;prepareVictory();return;}
    if (!localArmed || localFinished.has(state)) return;
    localArmed=false;localFinished.add(state);
    var winner=state.players[state.winnerSeat];
    if (!state.tied && winner) result(winner.isHuman ? 'victory' : 'defeat',{name:winner.name,ally:ally});
  }
  function stopPreview() {
    if (!previewing) return;
    previewSerial++; previewing = false; finishPhoenix(false); stopSounds(); clearVisuals();
    if(victoryPreview)finishCelebration('preview-stopped');
    var status = document.getElementById('settings-preview-status'); if (status) status.textContent = 'Preview stopped.';
  }
  function testVictory() {
    var status=document.getElementById('settings-preview-status');
    if(celebration || phoenix || document.hidden){status.textContent='Wait for the current cinematic to finish, then try again.';return false;}
    if(!window.PhoenixVictoryScene){status.textContent='Victory renderer script is unavailable. Copy the cinematic diagnostic.';sync();return false;}
    var mode=E.motion(prefs,media.matches);
    if(mode==='off'){status.textContent='Visual effects are Disabled. Enable them before testing.';return false;}
    stopPreview();previewing=true;victoryPreview=true;
    celebration=window.PhoenixVictoryScene.start({winner:{name:'Victory preview',ally:'phoenix'},reduced:mode==='reduced',
      restoreFocus:document.getElementById('settings-victory-test'),onFinish:finishCelebration});
    status.textContent='Silent victory visual test started. No game state changed.';sync();return !!celebration;
  }
  function testDefeat() {
    var status=document.getElementById('settings-preview-status');
    if(celebration || phoenix || document.hidden){status.textContent='Wait for the current cinematic to finish, then try again.';return false;}
    if(!window.PhoenixDefeatScene){status.textContent='Defeat renderer script is unavailable. Copy the cinematic diagnostic.';sync();return false;}
    var mode=E.motion(prefs,media.matches);
    if(mode==='off'){status.textContent='Visual effects are Disabled. Enable them before testing.';return false;}
    stopPreview();previewing=true;victoryPreview=true;
    celebration=window.PhoenixDefeatScene.start({winner:{name:'Defeat preview'},reduced:mode==='reduced',
      restoreFocus:document.getElementById('settings-defeat-test'),onFinish:finishCelebration});
    status.textContent='Silent defeat visual test started. No game state changed.';sync();return !!celebration;
  }
  function cinematicReport() {
    var scene=window.PhoenixVictoryScene,defeat=window.PhoenixDefeatScene;
    return {build:'victory-diagnostic-2',motion:E.motion(prefs,media.matches),systemReducedMotion:!!media.matches,
      victory:scene?scene.diagnostics():{missing:true},defeat:defeat?defeat.diagnostics():{missing:true},match:lastMatchDiagnostic,
      pendingResult:pendingEnd?pendingEnd.kind:null,phoenixActive:!!phoenix,
      card:window.PhoenixCardScene?window.PhoenixCardScene.diagnostics():{missing:true}};
  }
  function copyCinematicReport() {
    var text=JSON.stringify(cinematicReport(),function(key,value){
      // No player identity, card events/targets, hands, room codes or credentials.
      return key==='winner'||key==='history'?undefined:value;
    },2),node=document.getElementById('settings-victory-report-text');node.hidden=false;node.textContent=text;
    var status=document.getElementById('settings-preview-status');
    if(navigator.clipboard && navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){status.textContent='Diagnostic copied. Paste it into the chat.';},function(){status.textContent='Select and copy the diagnostic shown below.';});
    else status.textContent='Select and copy the diagnostic shown below.';
  }
  function preview(key, fullPhoenix) {
    if (!E.previews().some(function (p) { return p.key === key; })) return false;
    finishPhoenix(false); finishCelebration(); stopSounds(); clearVisuals(); previewing = true;
    var ticket = ++previewSerial, ready = unlock();
    function play() {
      if (ticket !== previewSerial || !previewing || document.hidden) return;
      if (key === 'phoenix' && fullPhoenix && window.PhoenixFireScene) startPhoenix(true); else sound(key, false);
      var status = document.getElementById('settings-preview-status');
      if (status) status.textContent = !prefs.sound || prefs.volume === 0 ? 'Sound effects are muted. Adjust SFX settings to hear this preview.' :
        isAudioBlocked() ? 'Audio is blocked. Tap Play preview again to enable it.' : 'Preview: ' + E.previews().find(function (p) { return p.key === key; }).label + '.';
    }
    function afterUnlock() {
      var mediaReady = key === 'phoenix' ? preparePhoenixAudio(context) : null;
      if (mediaReady && mediaReady.then) mediaReady.then(play); else play();
    }
    if (ready && ready.then && context && context.state !== 'running') ready.then(afterUnlock, function () {
      if (ticket === previewSerial) document.getElementById('settings-preview-status').textContent = 'Audio is blocked. Tap Play preview again to enable it.';
    }); else afterUnlock();
    return true;
  }
  function cleanup(reason) { deferredWin=null;finishPhoenix(false); finishCelebration(reason || 'cleanup'); clearVisuals(); stopSounds(); previewSerial++; previewing = false; }
  window.PhoenixCinematics = {
    show: show, consume: consume, match: match, localMatch:localMatch, preview: preview, stopPreview: stopPreview, skipCelebration: finishCelebration,
    resetNetwork: function (reason) { network.reset(); endings.reset(); cleanup(reason || 'network-reset'); },
    rules: function (events) { displayBatch(E.fromRules(events), 'phoenix-game'); },
    unlock: unlock, isAudioBlocked: isAudioBlocked, update: update, testVictory:testVictory, testDefeat:testDefeat,
    prefs: function () { return Object.assign({}, prefs); }, cleanup: cleanup,
    diagnostics: function () { return { visuals: active.length + (phoenix ? 1 : 0) + (window.PhoenixCardScene && !phoenix && window.PhoenixCardScene.diagnostics().active ? 1 : 0), voices: voices.length, phoenix:phoenix ? phoenix.node.dataset.phase || 'card-cinematic' : null,
      phoenixAudio:phoenixBuffer ? 'recorded-mix' : 'procedural-fallback', celebration: celebration ? celebration.node.className : null,
      audio: context ? context.state : 'uninitialised', motion: E.motion(prefs, media.matches) }; }
  };
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('settings-sound-enabled').addEventListener('change', function (event) { update({ sound: event.target.checked }); });
    document.getElementById('settings-sound-volume').addEventListener('input', function (event) { update({ volume: Number(event.target.value) / 100 }); });
    document.getElementById('settings-visual-effects').addEventListener('change', function (event) { update({ visuals: event.target.value }); });
    var choices = document.getElementById('settings-effects-choice');
    E.previews().forEach(function (p) { var option = document.createElement('option'); option.value = p.key; option.textContent = p.label; choices.appendChild(option); });
    choices.value = 'bonus';
    choices.addEventListener('change', stopPreview);
    document.getElementById('settings-effects-preview').addEventListener('click', function () { preview(choices.value); });
    document.getElementById('settings-effects-stop').addEventListener('click', stopPreview);
    document.getElementById('settings-phoenix-cinematic').addEventListener('click', function(){preview('phoenix',true);});
    var victoryTest=document.getElementById('settings-victory-test'),victoryReport=document.getElementById('settings-victory-report');
    if(victoryTest)victoryTest.addEventListener('click',testVictory);
    var defeatTest=document.getElementById('settings-defeat-test');
    if(defeatTest)defeatTest.addEventListener('click',testDefeat);
    if(victoryReport)victoryReport.addEventListener('click',copyCinematicReport);
    if (window.PhoenixFireScene) window.PhoenixFireScene.prepare(E.motion(prefs,media.matches) === 'full');
    document.getElementById('settings-back').addEventListener('click', stopPreview);
    document.addEventListener('click', unlock, true);
    // Refresh diagnostics when Settings opens, rather than showing only the
    // startup status or requiring a victory to finish successfully first.
    document.addEventListener('click', function(){var settings=document.getElementById('settings');if(settings && !settings.hidden)sync();});
    document.addEventListener('keydown', function (event) { if (event.target !== document.getElementById('music-enable-button')) unlock(); }, true);
    sync();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { stopPreview(); if (document.getElementById('settings').hidden) { finishPhoenix(true); finishCelebration('escape'); } }
  }, true);
  if (media.addEventListener) media.addEventListener('change', function () { clearVisuals(); finishPhoenix(true); finishCelebration('motion-change'); sync(); });
  document.addEventListener('visibilitychange', function () {
    if(document.hidden){
      if(celebration && celebration.pause){celebration.pause();clearVisuals();stopSounds();}
      else {
        // A confirmed win can be waiting behind the Phoenix-card takeover.
        // Cancel that transient stage, but do not discard the queued result.
        var waiting=deferredWin || (pendingEnd && pendingEnd.kind==='victory' ? pendingEnd.winner || {} : null);
        cleanup('hidden');deferredWin=waiting;
      }
    }else if(celebration && celebration.resume)celebration.resume();
    else if(deferredWin){var winner=deferredWin;deferredWin=null;celebrate('victory',winner);}
  });
  window.addEventListener('pagehide', function () {
    cleanup('page-exit');
    if (warmup !== null && window.cancelIdleCallback) window.cancelIdleCallback(warmup);
    warmup = null;
    if (context) { context.close().catch(function () {}); context = null; master = null; }
    soundBuffers = Object.create(null);
    phoenixBuffer=null;phoenixLoad=null;phoenixContext=null;
    if (window.PhoenixFireScene) window.PhoenixFireScene.release();
    if (window.PhoenixVictoryScene) window.PhoenixVictoryScene.release();
    if (window.PhoenixDefeatScene) window.PhoenixDefeatScene.release();
  });
}());
