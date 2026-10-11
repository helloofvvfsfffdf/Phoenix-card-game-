'use strict';
var browser = require('./music-player-tests').browser;
var Music = require('../js/music');
var E = require('../js/effects');

function online() {
  var b = browser({ track: 'calm', volume: 0.42 });
  b.attempts[0].resolve();
  var sockets = [];
  function Socket() { this.readyState = 1; sockets.push(this); }
  Socket.OPEN = 1;
  Socket.prototype.send = function () {};
  Socket.prototype.close = function () { this.onclose(); };
  b.context.WebSocket = Socket;
  b.context.PhoenixMusic = Music;
  b.context.location = { protocol: 'http:', host: 'localhost' };
  b.context.sessionStorage = { getItem: function () { return ''; }, setItem: function () {} };
  b.context.PhoenixCards = require('../js/cards');
  b.loadScript('online-client.js');
  b.context.PhoenixOnline.enter();
  b.nodes['online-name'].value = 'Player';
  b.document.getElementById('online-owner-password').value = 'test-only-password';
  b.nodes['online-create'].onclick(); sockets[0].onopen();
  b.receive = function (phase, over, extra) {
    sockets[0].onmessage({ data: JSON.stringify(Object.assign({ type: 'state', phase: phase, started: phase === 'playing', over: !!over,
      players: [{ id: 'human', name: 'Player', points: 0, handCount: 0, connected: true }],
      seat: 0, code: 'TEST', current: 'human', round: 1, rounds: 5, host: false,
      hand: [], acting: false, moves: [], log: [], availableAllies: [], dice: { rolls: {}, order: [], next: 0 },
      deckCount: 0, discardCount: 0 }, extra)) });
  };
  b.disconnect = function () { sockets[0].onclose(); };
  return b;
}

module.exports = function (test, equal, deepEqual, assert) {
  test('actual multiplayer message handler fades only at match start and keeps silence across updates/Settings', function () {
    var b = online();
    ['lobby', 'turnDice', 'allyDice', 'draft'].forEach(function (phase) { b.receive(phase); equal(b.api.isMatchActive(), false); });
    b.receive('playing'); b.advance(450); equal(b.audio.paused, true);
    b.settings.open(); b.api.select('retro'); b.api.setVolume(0.21); b.settings.leave();
    b.receive('playing'); equal(b.attempts.length, 1); equal(b.audio.paused, true);
    b.disconnect(); b.api.retry(); equal(b.audio.paused, true);
    b.receive('playing'); equal(b.attempts.length, 1, 'a resumed active snapshot does not play');
    b.context.PhoenixOnline.leave(); equal(b.attempts.length, 2);
    equal(b.attempts[1].src, 'assets/music/retro.mp3'); equal(b.attempts[1].volume, 0.21);
    b.attempts[1].resolve(); equal(b.audio.paused, false);
  });
  test('actual multiplayer match-end snapshot restores music exactly once', function () {
    var b = online(); b.receive('playing'); b.advance(450);
    b.receive('playing', true); equal(b.api.isMatchActive(), false); equal(b.attempts.length, 2);
    b.attempts[1].resolve(); b.receive('playing', true);
    equal(b.attempts.length, 2); equal(b.audio.volume, 0.42);
  });
  test('local entry/exit uses game state without resetting music preferences', function () {
    var b = browser(); b.attempts[0].resolve();
    b.context.phoenix = { game: { state: { over: false } } };
    b.loadScript('prototype.js');
    b.dispatch('phoenix-mode-unlocked', null, { detail: { mode: 'single' } });
    equal(b.api.isMatchActive(), true); b.advance(450); equal(b.audio.paused, true);
    b.nodes['back-to-menu'].listeners.click(); equal(b.api.isMatchActive(), false);
    b.attempts[1].resolve(); equal(b.audio.paused, false);
  });
  test('gallery doorway restores menu music without changing private invite access', function () {
    var b = browser(); b.attempts[0].resolve(); b.api.setMatchActive('local', true); b.advance(450);
    b.context.PhoenixNet = { onGallery: function () {}, onGalleryError: function () {}, setGalleryOwner: function () {} };
    b.loadScript('gallery-client.js'); b.context.PhoenixGalleryView.open();
    equal(b.api.isMatchActive(), false); equal(b.attempts.length, 2);
    equal(b.nodes['gallery-gate'].hidden, false); b.attempts[1].resolve(); equal(b.audio.paused, false);
  });
  var implemented = ['bonus', 'knife', 'hunter', 'zombie', 'steal', 'judge', 'reveal', 'skipall', 'phoenix',
    'trick', 'stealturn', 'curse', 'ghost', 'alvin', 'alvin-burn', 'curse-trigger',
    'ally-phoenix', 'ally-ted', 'ally-maple', 'block-tilly', 'block-ted', 'block-louie', 'block-simba', 'block-elsie', 'maple-restriction'];
  implemented.forEach(function (key) {
    test(key + ' uses a dedicated original sound recipe without changing its visual', function () {
      var visual = JSON.stringify(E.DEFINITIONS[key]);
      var recipe = E.soundRecipe(key);
      equal(JSON.stringify(E.DEFINITIONS[key]), visual, 'sound recipe leaves visual catalogue unchanged');
      assert(recipe.layers.length >= 2, 'implemented effects have layered material sounds');
      assert(recipe.duration > 0 && recipe.duration <= (key === 'phoenix' ? 4.4 : 1.6));
      var inert = E.soundRecipe(key, true);
      equal(inert.duration, 0.25);
      var unique = implemented.filter(function (other) { return JSON.stringify(E.soundRecipe(other)) === JSON.stringify(recipe); });
      equal(unique.length, 1, 'sound identities are distinct');
    });
  });
  test('private or unknown card identities cannot select a sound recipe', function () {
    equal(E.soundRecipe('secret-hand'), null); equal(E.soundRecipe('__proto__'), null);
  });
  test('real SFX controller remains independent, audible and deduplicated while match music is paused', function () {
    var b = browser({ track: 'epic', volume: 0.25 }); b.attempts[0].resolve();
    var audioMock = require('./effects-tests').browser(true);
    b.context.AudioContext = audioMock.context.AudioContext;
    b.context.PhoenixEffects = E; b.context.matchMedia = audioMock.context.matchMedia;
    b.context.innerWidth = 375; b.context.innerHeight = 700;
    b.loadScript('effects-client.js');
    var effects = b.context.PhoenixCinematics;
    effects.unlock(); b.api.setMatchActive('online', true); b.advance(450);
    effects.update({ volume: 0.18, visuals: 'reduced' });
    var journal = { stream: 'test-match', sequence: 0, events: [] };
    effects.consume(journal); E.append(journal, E.publicEvent('ally-ted', 0, 1));
    effects.consume(journal); equal(effects.diagnostics().voices, 1);
    effects.consume(journal); equal(effects.diagnostics().voices, 1, 'repeat snapshot has no second sound');
    equal(b.audio.paused, true); equal(b.audio.volume, 0); equal(effects.diagnostics().motion, 'reduced');
    deepEqual(b.api.prefs(), { track: 'epic', volume: 0.25 });
    deepEqual(b.saved(), { track: 'epic', volume: 0.25 }, 'SFX saves do not overwrite music storage');
    effects.update({ sound: false }); equal(effects.diagnostics().voices, 0);
    effects.show(E.publicEvent('phoenix', 0)); equal(effects.diagnostics().voices, 0);
    effects.cleanup(); b.api.setMatchActive('online', false); equal(b.attempts[1].volume, 0.25);
  });
};
module.exports.online = online;
