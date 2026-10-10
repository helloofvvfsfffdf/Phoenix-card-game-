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
  var data = saved ? JSON.stringify(saved) : null;
  function node() {
    return {
      hidden: true, textContent: '', children: [], listeners: {},
      setAttribute: function (key, value) { this[key] = value; },
      getAttribute: function (key) { return this[key] || null; },
      removeAttribute: function (key) { delete this[key]; },
      focus: function () { document.activeElement = this; },
      tabIndex: 0,
      getClientRects: function () { return [{}]; },
      isConnected: true,
      addEventListener: function (key, fn) { this.listeners[key] = fn; },
      appendChild: function (child) { this.children.push(child); },
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
    createElement: function (tag) { return tag === 'audio' ? audio : node(); },
    querySelectorAll: function () { return []; },
    addEventListener: function (key, fn) {
      (listeners[key] || (listeners[key] = [])).push(fn);
    },
    removeEventListener: function (key, fn) {
      listeners[key] = (listeners[key] || []).filter(function (item) { return item !== fn; });
    }
  };
  var context = { document: document, localStorage: {
    getItem: function () { return data; },
    setItem: function (key, value) { data = value; }
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
    saved: function () { return JSON.parse(data); }
  };
}

module.exports = function (test, equal, deepEqual) {
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
