'use strict';

// Execute the existing browser controller with controlled DOM/media APIs. Each
// play result can settle independently, including after a newer track is chosen.
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'js', 'music.js'), 'utf8');

function browser(saved, mode) {
  var nodes = {};
  var listeners = {};
  var attempts = [];
  var data = { 'phoenix.music.v1': saved ? JSON.stringify(saved) : null };
  var now = 0, serial = 0, timers = new Map(), windowListeners = {}, audioInstances = 0;
  function node() {
    return {
      hidden: true, textContent: '', children: [], listeners: {},
      dataset: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {} },
      style: { setProperty: function () {} }, remove: function () { this.removed = true; },
      value: '',
      setAttribute: function (key, value) { this[key] = value; },
      getAttribute: function (key) { return this[key] || null; },
      removeAttribute: function (key) { delete this[key]; },
      focus: function () { document.activeElement = this; },
      tabIndex: 0,
      getClientRects: function () { return [{}]; },
      isConnected: true,
      addEventListener: function (key, fn) { this.listeners[key] = fn; },
      appendChild: function (child) { this.children.push(child); },
      append: function () { this.children.push.apply(this.children, arguments); },
      insertAdjacentElement: function () {},
      querySelectorAll: function () { return []; },
      querySelector: function () { return null; },
      replaceChildren: function () { this.children = []; }
    };
  }
  var audio = node();
  audio.paused = true;
  audio.ended = false;
  audio.currentTime = 0;
  audio.pause = function () { this.paused = true; };
  audio.play = function () {
    if (mode === 'throw') throw new Error('Playback refused');
    if (mode === 'legacy') { this.paused = false; return; }
    var success, failure;
    var promise = {
      then: function (fn) { success = fn; return promise; },
      catch: function (fn) { failure = fn; return promise; }
    };
    attempts.push({
      src: audio.src, volume: audio.volume,
      resolve: function () { audio.paused = false; success(); },
      reject: function () { failure(new Error('NotAllowedError')); }
    });
    return promise;
  };
  var document = {
    readyState: 'loading', body: node(),
    getElementById: function (id) { return nodes[id] || (nodes[id] = node()); },
    createElement: function (tag) { if (tag === 'audio') { audioInstances++; return audio; } return node(); },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    addEventListener: function (key, fn) {
      (listeners[key] || (listeners[key] = [])).push(fn);
    },
    removeEventListener: function (key, fn) {
      listeners[key] = (listeners[key] || []).filter(function (item) { return item !== fn; });
    }
  };
  var context = { document: document,
    Date: { now: function () { return now; } },
    setTimeout: function (fn, delay) { timers.set(++serial, { fn: fn, at: now + delay }); return serial; },
    clearTimeout: function (id) { timers.delete(id); },
    addEventListener: function (key, fn) { windowListeners[key] = fn; },
    localStorage: {
    getItem: function (key) { return data[key] || null; },
    setItem: function (key, value) { data[key] = value; }
  } };
  context.window = context;
  vm.runInNewContext(source, context);
  function dispatch(type, target, details) {
    (listeners[type] || []).slice().forEach(function (fn) { fn(Object.assign({ target: target }, details)); });
  }
  dispatch('DOMContentLoaded');
  var button = nodes['music-enable-button'];
  return {
    api: context.PhoenixMusicPlayer, settings: context.PhoenixMusicSettings, nodes: nodes, context: context, document: document, audio: audio, attempts: attempts, button: button,
    dispatch: dispatch,
    click: function () { dispatch('click', button); button.listeners.click(); },
    saved: function () { return JSON.parse(data['phoenix.music.v1']); },
    timers: timers,
    windowListeners: windowListeners,
    loadScript: function (file) {
      var count = (listeners.DOMContentLoaded || []).length;
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
      (listeners.DOMContentLoaded || []).slice(count).forEach(function (fn) { fn(); });
    },
    audioInstances: function () { return audioInstances; },
    advance: function (ms) {
      var end = now + ms, next;
      while ((next = Array.from(timers.entries()).filter(function (entry) { return entry[1].at <= end; })
        .sort(function (a, b) { return a[1].at - b[1].at; })[0])) {
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    }
  };
}

module.exports = function (test, equal, deepEqual) {
  test('only authoritative gameplay snapshots silence music, not lobby, dice or draft', function () {
    var Music = require('../js/music');
    ['lobby', 'turnDice', 'allyDice', 'draft'].forEach(function (phase) {
      equal(Music.isActiveMatch({ phase: phase, started: false, over: false }), false);
    });
    equal(Music.isActiveMatch({ phase: 'playing', started: true, over: false }), true);
    equal(Music.isActiveMatch({ phase: 'playing', started: true, over: true }), false);
    equal(Music.isActiveMatch(null), false);
  });
  test('match start fades and pauses the single music element without saving silence', function () {
    var b = browser({ track: 'epic', volume: 0.25 }); b.attempts[0].resolve();
    b.audio.currentTime = 42;
    b.api.setMatchActive('online', true);
    equal(b.audio.volume, 0.25);
    b.advance(210); equal(b.audio.volume > 0 && b.audio.volume < 0.25, true);
    equal(b.audio.paused, false, 'fade is audible before pause');
    b.api.setMatchActive('online', true); // Same snapshot must not restart fade.
    b.advance(240); equal(b.audio.paused, true); equal(b.audio.volume, 0);
    equal(b.api.isBlocked(), false);
    equal(b.audio.currentTime, 42); equal(b.audioInstances(), 1);
    deepEqual(b.saved(), { track: 'epic', volume: 0.25 }); equal(b.timers.size, 0);
  });
  test('settings, gestures, retry and repeated active snapshots cannot restart match music', function () {
    var b = browser(); b.attempts[0].resolve(); b.api.setMatchActive('online', true); b.advance(450);
    b.api.select('calm'); b.api.setVolume(0.63); b.api.retry(); b.dispatch('click', {});
    b.api.setMatchActive('online', true);
    equal(b.attempts.length, 1); equal(b.audio.paused, true); equal(b.audio.volume, 0);
    deepEqual(b.saved(), { track: 'calm', volume: 0.63 });
    b.api.setMatchActive('online', false);
    equal(b.attempts.length, 2); equal(b.attempts[1].src, 'assets/music/calm.mp3'); equal(b.attempts[1].volume, 0.63);
    b.attempts[1].resolve(); equal(b.api.isPlaying(), true); equal(b.audioInstances(), 1);
  });
  test('leaving during fade cancels it and restores selected music without a delayed pause', function () {
    var b = browser({ track: 'retro', volume: 0.51 }); b.attempts[0].resolve();
    b.api.setMatchActive('local', true); b.advance(120); b.api.setMatchActive('local', false);
    b.attempts[1].resolve(); b.advance(1000);
    equal(b.audio.paused, false); equal(b.audio.volume, 0.51); equal(b.timers.size, 0);
  });
  test('Disabled remains disabled after match end and does not overwrite saved volume', function () {
    var b = browser({ track: 'off', volume: 0.73 });
    b.api.setMatchActive('local', true); b.api.retry(); b.api.setMatchActive('local', false);
    equal(b.attempts.length, 0); equal(b.audio.paused, true);
    deepEqual(b.saved(), { track: 'off', volume: 0.73 });
  });
  test('delayed autoplay completion and incidental media play cannot break match silence', function () {
    var b = browser(); b.api.setMatchActive('online', true); b.attempts[0].resolve();
    equal(b.audio.paused, true); equal(b.audio.volume, 0);
    b.audio.paused = false; b.audio.listeners.play(); equal(b.audio.paused, true);
    b.attempts[0].reject(); equal(b.api.isBlocked(), false);
  });
  test('hidden tabs and back-forward restoration retain active-match silence', function () {
    var b = browser(); b.attempts[0].resolve(); b.api.setMatchActive('online', true);
    b.document.hidden = true; b.dispatch('visibilitychange'); equal(b.audio.paused, true); equal(b.timers.size, 0);
    b.windowListeners.pagehide(); b.document.hidden = false; b.windowListeners.pageshow({ persisted: true });
    equal(b.attempts.length, 1); equal(b.audio.paused, true);
    b.api.setMatchActive('online', false); b.attempts[1].reject();
    equal(b.button.hidden, false, 'return autoplay failure is recoverable');
    b.click(); b.attempts[2].resolve(); equal(b.audio.paused, false);
  });
  test('one active match source cannot be cleared by an unrelated screen rerender', function () {
    var b = browser(); b.attempts[0].resolve(); b.api.setMatchActive('online', true); b.advance(450);
    b.api.setMatchActive('local', false); equal(b.api.isMatchActive(), true); equal(b.attempts.length, 1);
    b.api.setMatchActive('online', false); equal(b.attempts.length, 2);
  });
  test('disconnect/reconnect baselines keep music silent until an authoritative non-match state', function () {
    var b = browser(); b.attempts[0].resolve(); b.api.setMatchActive('online', true); b.advance(450);
    // Losing a connection intentionally does NOT clear the last active gate.
    b.api.retry(); b.api.setMatchActive('online', true); equal(b.attempts.length, 1);
    b.api.setMatchActive('online', false); b.attempts[1].resolve(); equal(b.audio.paused, false);
  });
  test('Settings traps focus and Escape returns to the match', function () {
    var b = browser();
    b.document.getElementById('phoenix-game').hidden = false;
    b.nodes['match-settings'].focus();
    b.settings.open();
    var first = b.nodes['settings-volume-slider'], last = b.nodes['settings-back'];
    b.nodes.settings.querySelectorAll = function () { return [first, last]; };
    var prevented = 0;
    b.dispatch('keydown', last, { key: 'Tab', preventDefault: function () { prevented++; } });
    equal(b.document.activeElement, first);
    b.dispatch('keydown', first, { key: 'Tab', shiftKey: true, preventDefault: function () { prevented++; } });
    equal(b.document.activeElement, last);
    b.dispatch('keydown', last, { key: 'Escape', preventDefault: function () { prevented++; } });
    equal(b.nodes.settings.hidden, true);
    equal(b.document.activeElement, b.nodes['match-settings']);
    equal(prevented, 3);
  });
  test('match Settings preserves visibility and playback, then restores background input and focus', function () {
    var b = browser({ track: 'calm', volume: 0.63 });
    b.attempts[0].resolve();
    b.document.getElementById('phoenix-game').hidden = false;
    b.nodes['match-settings'].focus();
    b.settings.open();
    equal(b.nodes['phoenix-game'].hidden, false);
    equal(b.nodes['phoenix-game'].inert, true);
    equal(b.api.isPlaying(), true);
    equal(b.nodes['settings-back'].textContent, '← RETURN TO MATCH');
    b.settings.leave();
    equal(b.nodes['phoenix-game'].hidden, false);
    equal(b.nodes['settings'].hidden, true);
    equal(!!b.nodes['phoenix-game'].inert, false);
    equal(b.document.activeElement, b.nodes['match-settings']);
    equal(b.attempts.length, 1, 'opening settings never restarts music');
  });
  test('online Settings does not undo state updates or send player to the main menu', function () {
    var b = browser();
    b.document.getElementById('online-screen').hidden = false;
    b.document.getElementById('phoenix-menu').hidden = true;
    b.settings.open();
    b.document.getElementById('online-room').textContent = 'live update';
    b.settings.leave();
    equal(b.nodes['online-screen'].hidden, false);
    equal(b.nodes['phoenix-menu'].hidden, true);
    equal(b.nodes['online-room'].textContent, 'live update');
  });
  test('music success cannot hide recovery while sound effects are still blocked', function () {
    var b = browser();
    b.context.PhoenixCinematics = { isAudioBlocked: function () { return true; } };
    b.attempts[0].resolve();
    equal(b.button.hidden, false);
  });
  test('autoplay rejection shows global recovery; click retries saved track and volume', function () {
    var b = browser({ track: 'mysterious', volume: 0.63 });
    equal(b.attempts.length, 1);
    equal(b.button.hidden, true);
    b.attempts[0].reject();
    equal(b.button.hidden, false);
    b.dispatch('pointerdown', b.button);
    b.dispatch('keydown', b.button);
    equal(b.attempts.length, 1, 'activation does not hide the button early');
    b.click();
    equal(b.attempts.length, 2, 'one synchronous retry in the button click');
    equal(b.attempts[1].src, 'assets/music/mysterious.mp3');
    equal(b.attempts[1].volume, 0.63);
    equal(b.button.hidden, false, 'visible until playback succeeds');
    b.attempts[1].resolve();
    equal(b.button.hidden, true);
    deepEqual(b.saved(), { track: 'mysterious', volume: 0.63 });
  });

  test('repeated refusal keeps recovery available; retry uses updated preferences', function () {
    var b = browser();
    b.attempts[0].reject();
    b.click();
    b.attempts[1].reject();
    equal(b.button.hidden, false);
    b.api.select('retro');
    b.api.setVolume(0.17);
    b.click();
    var last = b.attempts[b.attempts.length - 1];
    equal(last.src, 'assets/music/retro.mp3');
    equal(last.volume, 0.17);
    last.resolve();
    equal(b.button.hidden, true);
    b.attempts[2].reject();
    equal(b.button.hidden, true, 'older failures cannot undo successful recovery');
    deepEqual(b.saved(), { track: 'retro', volume: 0.17 });
  });

  test('Disabled never autoplays or retries and ignores outstanding failures', function () {
    var disabled = browser({ track: 'off', volume: 0.18 });
    equal(disabled.attempts.length, 0);
    disabled.api.retry();
    equal(disabled.attempts.length, 0);
    equal(disabled.button.hidden, true);
    var b = browser();
    b.api.select('off');
    b.attempts[0].reject();
    equal(b.button.hidden, true);
    equal(b.api.isBlocked(), false);
    deepEqual(b.saved(), { track: 'off', volume: 0.25 });
  });

  test('new track ignores previous pending failure before any user gesture', function () {
    var b = browser();
    b.api.select('calm');
    b.attempts[0].reject();
    equal(b.api.isBlocked(), false);
    b.api.retry();
    equal(b.attempts[1].src, 'assets/music/calm.mp3');
    equal(b.attempts[1].volume, 0.25);
  });

  test('normal clicks retry autoplay and volume changes preserve playback position', function () {
    var b = browser();
    b.attempts[0].reject();
    b.dispatch('click', {});
    equal(b.attempts.length, 2);
    b.attempts[1].resolve();
    b.audio.currentTime = 42;
    b.api.setVolume(0.51);
    equal(b.audio.currentTime, 42);
    equal(b.audio.volume, 0.51);
    equal(b.audio.src, 'assets/music/epic.mp3');
  });

  test('synchronous playback refusal and legacy play results update recovery', function () {
    var refused = browser(null, 'throw');
    equal(refused.button.hidden, false);
    refused.click();
    equal(refused.button.hidden, false);
    var legacy = browser(null, 'legacy');
    equal(legacy.button.hidden, true);
    equal(legacy.api.isPlaying(), true);
  });
};
module.exports.browser = browser;
