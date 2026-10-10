/* Fire-and-forget presentation: never a turn lock or a source of game rules. */
(function () {
  'use strict';
  var E = window.PhoenixEffects;
  var store;
  try { store = window.localStorage; } catch (e) { store = null; }
  var prefs = E.load(store);
  var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var active = [], voices = [], context = null, master = null, noiseBuffer = null;
  var audioBlocked = false, saved = true;
  var Context = window.AudioContext || window.webkitAudioContext;
  var network = E.cursor();

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
    document.getElementById('settings-effects-status').textContent =
      (!Context ? 'Sound synthesis is unavailable in this browser. ' : '') +
      (isAudioBlocked() ? 'Use the enable-audio button or tap a control to enable sounds. ' : '') +
      (media.matches ? 'Your system requests reduced motion. ' : '') +
      (!saved ? 'This browser could not save these preferences.' : '');
    refreshButton();
  }
  function disposeVoice(voice) {
    voice.nodes.forEach(function (node) { try { node.stop(); } catch (e) {} node.disconnect(); });
    voice.gains.forEach(function (node) { node.disconnect(); });
    clearTimeout(voice.timer);
    voices = voices.filter(function (v) { return v !== voice; });
  }
  function stopSounds() { voices.slice().forEach(disposeVoice); }
  function cleanupVisual(record) {
    clearTimeout(record.timer);
    record.node.remove();
    active = active.filter(function (item) { return item !== record; });
  }
  function clearVisuals() { active.slice().forEach(cleanupVisual); }
  function update(next) {
    prefs = E.normalise(Object.assign({}, prefs, next));
    saved = E.save(store, prefs);
    if (master && context) master.gain.setTargetAtTime(prefs.sound ? prefs.volume * 0.18 : 0, context.currentTime, 0.02);
    if (!prefs.sound || prefs.volume === 0) { audioBlocked = false; stopSounds(); }
    clearVisuals();
    sync();
  }
  // Called synchronously by genuine input, never after a network callback.
  function unlock() {
    if (!Context || !prefs.sound || prefs.volume === 0) return;
    try {
      if (!context || context.state === 'closed') {
        context = new Context();
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
        sync();
      }, function () { if (context === current) { audioBlocked = true; sync(); } });
      else { audioBlocked = context.state !== 'running'; sync(); }
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
      var notes = recipe.notes;
      var duration = recipe.duration;
      var step = duration / notes.length;
      notes.forEach(function (frequency, index) {
        var oscillator = context.createOscillator();
        var gain = context.createGain();
        voice.nodes.push(oscillator);
        voice.gains.push(gain);
        oscillator.type = recipe.wave;
        var start = context.currentTime + index * step;
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * recipe.sweep), start + step);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + Math.min(0.025, step / 4));
        gain.gain.exponentialRampToValueAtTime(0.001, start + step);
        gain.gain.setValueAtTime(0, start + step + 0.015);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(start);
        oscillator.stop(start + step + 0.02);
        if (recipe.harmonic) {
          var overtone = context.createOscillator();
          var overtoneGain = context.createGain();
          voice.nodes.push(overtone); voice.gains.push(overtoneGain);
          overtone.type = 'sine';
          overtone.frequency.setValueAtTime(frequency * recipe.harmonic, start);
          overtone.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * recipe.harmonic * recipe.sweep), start + step);
          overtoneGain.gain.setValueAtTime(0, start);
          overtoneGain.gain.linearRampToValueAtTime(0.04, start + Math.min(0.025, step / 4));
          overtoneGain.gain.exponentialRampToValueAtTime(0.001, start + step);
          overtone.connect(overtoneGain); overtoneGain.connect(master);
          overtone.start(start); overtone.stop(start + step + 0.02);
        }
      });
      // Original procedural texture adds a metallic scrape, fire rush or soft
      // impact beneath the tonal signature. Reuse one short noise buffer.
      if (recipe.texture) {
        if (!noiseBuffer) {
          noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.2), context.sampleRate);
          var samples = noiseBuffer.getChannelData(0);
          var seed = 173;
          for (var i = 0; i < samples.length; i++) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            samples[i] = seed / 2147483648 - 1;
          }
        }
        var rush = context.createBufferSource();
        var filter = context.createBiquadFilter();
        var envelope = context.createGain();
        voice.nodes.push(rush);
        voice.gains.push(filter, envelope);
        rush.buffer = noiseBuffer;
        filter.type = recipe.texture;
        filter.frequency.setValueAtTime(recipe.cutoff, context.currentTime);
        filter.frequency.exponentialRampToValueAtTime(Math.max(80, recipe.cutoff * recipe.sweep), context.currentTime + duration);
        var now = context.currentTime;
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(recipe.noiseGain, now + 0.02);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
        rush.connect(filter); filter.connect(envelope); envelope.connect(master);
        rush.start(now); rush.stop(now + duration);
      }
      voice.timer = setTimeout(function () { disposeVoice(voice); }, (duration + 0.15) * 1000);
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
      for (var i = 0; i < 8; i++) {
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
  function consume(packet) { network.consume(packet).slice(-8).forEach(function (event) { show(event, 'online-screen'); }); }
  function cleanup() { clearVisuals(); stopSounds(); }
  window.PhoenixCinematics = {
    show: show, consume: consume, resetNetwork: function () { network.reset(); cleanup(); },
    rules: function (events) { E.fromRules(events).forEach(function (event) { show(event, 'phoenix-game'); }); },
    unlock: unlock, isAudioBlocked: isAudioBlocked, update: update,
    prefs: function () { return Object.assign({}, prefs); }, cleanup: cleanup,
    diagnostics: function () { return { visuals: active.length, voices: voices.length, audio: context ? context.state : 'uninitialised', motion: E.motion(prefs, media.matches) }; }
  };
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('settings-sound-enabled').addEventListener('change', function (event) { update({ sound: event.target.checked }); });
    document.getElementById('settings-sound-volume').addEventListener('input', function (event) { update({ volume: Number(event.target.value) / 100 }); });
    document.getElementById('settings-visual-effects').addEventListener('change', function (event) { update({ visuals: event.target.value }); });
    document.getElementById('settings-effects-preview').addEventListener('click', function () { unlock(); show({ key: 'bonus', actor: -1, target: -1 }, 'settings'); });
    document.addEventListener('click', unlock, true);
    document.addEventListener('keydown', function (event) { if (event.target !== document.getElementById('music-enable-button')) unlock(); }, true);
    sync();
  });
  if (media.addEventListener) media.addEventListener('change', function () { clearVisuals(); sync(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) cleanup(); });
  window.addEventListener('pagehide', function () {
    cleanup();
    if (context) { context.close().catch(function () {}); context = null; master = null; noiseBuffer = null; }
  });
}());
