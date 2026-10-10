'use strict';
var E = require('../js/effects');
var Cards = require('../js/cards');
var Rules = require('../js/rules');
var fs = require('fs');
var vm = require('vm');
var path = require('path');

// Exercise the real server's ability handlers deterministically without binding
// a port. Only RNG, credentials and its idle auth-cleanup timer are substituted.
function serverFixture(targetAlly, block) {
  var filename = path.join(__dirname, '../server.js');
  var code = fs.readFileSync(filename, 'utf8');
  code = code.slice(0, code.lastIndexOf('httpServer.listen('));
  var localRequire = require('module').createRequire(filename);
  var actualCrypto = require('crypto');
  var randomCalls = 0;
  var context = {
    require: function (id) {
      if (id === 'crypto') return Object.assign({}, actualCrypto, { randomInt: function (max) {
        randomCalls++;
        return max === 100 ? block ? 0 : 99 : 0;
      } });
      if (id === './js/maple.js') {
        var Maple = localRequire(id);
        return Object.assign({}, Maple, { apply: function (room, rules, rng, log) { return Maple.apply(room, rules, function () { return 0; }, log); } });
      }
      return localRequire(id);
    },
    __dirname: path.join(__dirname, '..'), console: { log: function () {}, error: function () {} },
    process: { env: { PHOENIX_OWNER_PASSWORD: 'test-password-at-least-24-characters', PHOENIX_MODE_ACCESS_CODE: 'test-mode-code-123456' }, pid: 1, exit: function () { throw new Error('Invalid fixture'); } },
    setInterval: function () { return { unref: function () {} }; }, URL: URL, Buffer: Buffer
  };
  vm.runInNewContext(code + '\nglobalThis.fixture = { applyPhoenix, applyTed, applyMaple, snapshot, recordEvents, broadcast };', context);
  var s = Rules.createGame({ seed: 42, fixedOrder: true, rotateStart: false, rounds: 8 });
  s.players.forEach(function (p, i) { p.enabled = i < 3; });
  var room = { code: 'TEST', state: s, phase: 'playing', log: [], lastPhoenixRound: 1,
    members: [{ seat: 0, name: 'Actor', ally: 'phoenix' }, { seat: 1, name: 'Target', ally: targetAlly }, { seat: 2, name: 'Third', ally: 'ted' }] };
  return { api: context.fixture, room: room, randomCalls: function () { return randomCalls; } };
}

function browser(reduced) {
  var nodes = {}, timers = new Map(), serial = 0, contexts = [], documentListeners = {}, windowListeners = {};
  var data = {};
  var soundCalls = [];
  function node() {
    return {
      children: [], style: { setProperty: function () {} }, dataset: {}, listeners: {},
      hidden: true,
      setAttribute: function () {}, addEventListener: function (key, fn) { this.listeners[key] = fn; },
      appendChild: function (child) { this.children.push(child); },
      remove: function () { this.removed = true; }
    };
  }
  var media = { matches: !!reduced, addEventListener: function (key, fn) { this.change = fn; } };
  function param() { return { value: 0, setTargetAtTime: function () {}, setValueAtTime: function () {}, linearRampToValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }; }
  function audioNode() {
    return { gain: param(), frequency: param(), threshold: param(), knee: param(), ratio: param(),
      connect: function () {}, disconnect: function () { this.disconnected = true; },
      start: function () { this.started = true; }, stop: function () { this.stopped = true; } };
  }
  function Context() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.nodes = []; contexts.push(this); }
  Context.prototype.createBuffer = function (channels, length) { return { getChannelData: function () { return new Float32Array(length); } }; };
  Context.prototype.createGain = Context.prototype.createOscillator = Context.prototype.createDynamicsCompressor = Context.prototype.createBiquadFilter = Context.prototype.createBufferSource = function () {
    var n = audioNode(); this.nodes.push(n); return n;
  };
  Context.prototype.resume = function () { this.state = 'running'; return { then: function (fn) { fn(); } }; };
  Context.prototype.close = function () { this.state = 'closed'; return { catch: function () {} }; };
  var document = {
    hidden: false, body: node(), querySelector: function () { return null; },
    createElement: node, getElementById: function (id) { return nodes[id] || (nodes[id] = node()); },
    addEventListener: function (key, fn) { (documentListeners[key] || (documentListeners[key] = [])).push(fn); }
  };
  var context = {
    PhoenixEffects: Object.assign({}, E, { soundRecipe: function (key, inert) {
      soundCalls.push({ key: key, inert: inert }); return E.soundRecipe(key, inert);
    } }), PhoenixMusicPlayer: { isBlocked: function () { return false; } }, document: document,
    AudioContext: Context, innerWidth: 375, innerHeight: 700, matchMedia: function () { return media; },
    localStorage: { getItem: function (key) { return data[key] || null; }, setItem: function (key, value) { data[key] = value; } },
    setTimeout: function (fn) { timers.set(++serial, fn); return serial; }, clearTimeout: function (id) { timers.delete(id); },
    addEventListener: function (key, fn) { windowListeners[key] = fn; }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/effects-client.js'), 'utf8'), context);
  documentListeners.DOMContentLoaded.forEach(function (fn) { fn(); });
  return { api: context.PhoenixCinematics, context: context, media: media, contexts: contexts, nodes: nodes, timers: timers, soundCalls: soundCalls,
    flush: function () { Array.from(timers.values()).forEach(function (fn) { fn(); }); },
    hide: function () { document.hidden = true; documentListeners.visibilitychange[0](); },
    close: function () { windowListeners.pagehide(); } };
}

module.exports = function (test, equal, deepEqual, assert) {
  Cards.CARDS.forEach(function (card) {
    test(card.name + ' has a unique cinematic and authoritative engine trigger', function () {
      var s = Rules.createGame({ fixedOrder: true, rotateStart: false, seed: 42, rounds: 8 });
      var actor = s.players[s.turnInRound];
      s.hands[actor.id].push(card.id);
      if (card.id === 'phoenix') actor.hasPhoenix = true;
      var target = card.needsTarget ? Rules.legalTargets(s, actor.seat, card.id)[0] : null;
      var result = Rules.playCard(s, actor.seat, card.id, target || null);
      assert(result.ok, result.error);
      var effects = E.fromRules(result.events);
      assert(effects.some(function (event) { return event.key === card.id; }), card.id + ' triggers');
      assert(E.DEFINITIONS[card.id][5].length > 0, 'original synthesis exists');
      equal(E.fromRules([{ type: 'draw', cardId: card.id, text: 'secret' }]).length, 0, 'drawing does not reveal or animate identity');
      var b = browser();
      b.api.unlock();
      b.api.rules(result.events);
      assert(b.api.diagnostics().visuals > 0, 'browser renders the outcome');
      assert(b.api.diagnostics().voices > 0, 'browser generates the sound');
      assert(b.soundCalls.some(function (call) { return call.key === card.id; }), 'sound matches the actual card');
      b.flush();
      equal(b.api.diagnostics().visuals, 0, 'visuals have bounded cleanup');
    });
  });

  ['phoenix', 'tilly', 'ted', 'louie', 'simba', 'elsie', 'maple'].forEach(function (id) {
    test(id + ' ally has its own safe visual/audio identity', function () {
      var event = E.publicEvent('ally-' + id, 0, 1);
      assert(event);
      var b = browser(); b.api.unlock(); b.api.show(event);
      equal(b.api.diagnostics().visuals, 1);
      equal(b.api.diagnostics().voices, 1);
      equal(b.soundCalls[0].key, 'ally-' + id);
      b.flush();
      equal(b.api.diagnostics().voices, 0);
    });
  });
  ['tilly', 'ted', 'louie', 'simba', 'elsie'].forEach(function (id) {
    test(id + ' authoritative theft defense renders and sounds', function () {
      var b = browser(); b.api.unlock(); b.api.show(E.publicEvent('block-' + id, 1, 1));
      equal(b.api.diagnostics().visuals, 1); equal(b.api.diagnostics().voices, 1);
      equal(b.soundCalls[0].key, 'block-' + id);
      b.api.cleanup(); equal(b.timers.size, 0);
    });
    test(id + ' defense event comes from the actual server and leaves hands unchanged', function () {
      var f = serverFixture(id, true);
      var before = JSON.stringify(f.room.state.hands);
      f.api.applyPhoenix(f.room);
      equal(f.room.effects.events.length, 1);
      equal(f.room.effects.events[0].key, 'block-' + id);
      equal(JSON.stringify(f.room.state.hands), before);
    });
  });
  test('actual server emits theft only after transferring a card, never its identity', function () {
    var f = serverFixture('tilly', false);
    var actor = f.room.state.players[0], victim = f.room.state.players[1];
    var held = f.room.state.hands[actor.id].length, lost = f.room.state.hands[victim.id].length;
    f.api.applyPhoenix(f.room);
    equal(f.room.state.hands[actor.id].length, held + 1);
    equal(f.room.state.hands[victim.id].length, lost - 1);
    equal(f.room.effects.events[0].key, 'ally-phoenix');
    deepEqual(Object.keys(f.room.effects.events[0]).sort(), ['actor', 'id', 'key', 'outcome', 'target']);
  });
  test('actual Ted activation preserves own-hand fog duration and does not repeat', function () {
    var f = serverFixture('tilly', true);
    f.api.applyTed(f.room);
    equal(f.room.effects.events[0].key, 'ally-ted');
    equal(f.room.tedHiddenUntil[0], f.room.state.round + 2);
    equal(f.api.snapshot(f.room, f.room.members[0]).tedObscured, true);
    f.api.applyTed(f.room); equal(f.room.effects.sequence, 1);
  });
  test('actual neutral Maple activation preserves restrictions and emits no fictional shield', function () {
    var f = serverFixture('tilly', true);
    f.api.applyMaple(f.room);
    equal(f.room.effects.events[0].key, 'ally-maple');
    equal(f.room.effects.events[0].actor, -1);
    equal(f.room.mapleUntil[0], f.room.state.round + 2);
    equal(f.api.snapshot(f.room, f.room.members[0]).mapleBlocked.length, 6);
    f.api.applyMaple(f.room); equal(f.room.effects.sequence, 1);
  });
  test('server snapshots expose private reveal details only to actor and suppress fogged draws', function () {
    var f = serverFixture('tilly', true);
    f.api.recordEvents(f.room, [{ type: 'card', cardId: 'reveal', seat: 0, targetSeat: 1, text: 'Actor plays Reveal' },
      { type: 'result', cardId: 'reveal', text: 'PRIVATE_HAND' }, { type: 'draw', seat: 1, cardId: 'knife', text: 'PRIVATE_DRAW' }]);
    assert(f.api.snapshot(f.room, f.room.members[0]).log.indexOf('PRIVATE_HAND') >= 0);
    assert(f.api.snapshot(f.room, f.room.members[1]).log.indexOf('PRIVATE_HAND') < 0);
    assert(f.api.snapshot(f.room, f.room.members[2]).log.indexOf('PRIVATE_DRAW') < 0);
    f.room.tedHiddenUntil = { 1: f.room.state.round + 2 };
    assert(f.api.snapshot(f.room, f.room.members[1]).log.indexOf('PRIVATE_DRAW') < 0);
  });
  test('Alvin burns only on completed destruction, without the destroyed card identity', function () {
    deepEqual(E.fromRules([{ type: 'alvin', seat: 0, targetSeat: 1, cardId: 'secret', text: 'private' }]),
      [{ key: 'alvin-burn', actor: 0, target: 1, outcome: 'active' }]);
    equal(E.fromRules([{ type: 'result', cardId: 'alvin', text: 'private hand' }]).length, 0);
  });
  test('Judge failure is subdued; curse activation and Hunter reflection match outcomes', function () {
    equal(E.fromRules([{ type: 'card', cardId: 'judge', seat: 0 }, { type: 'result', cardId: 'judge', text: 'Judge is inert - it failed' }])[0].outcome, 'inert');
    equal(E.fromRules([{ type: 'curse', seat: 2, cardId: 'bonus' }])[0].key, 'curse-trigger');
    var reflected = E.fromRules([{ type: 'card', cardId: 'zombie', seat: 0, targetSeat: 1 }, { type: 'result', cardId: 'zombie', text: 'Zombie reflected!' }]);
    equal(reflected[0].key, 'hunter-block'); equal(reflected[1].target, 0);
    equal(E.fromRules([{ type: 'card', cardId: 'steal', seat: 0, targetSeat: 1 }, { type: 'result', cardId: 'steal', text: 'Actor steals all of Target points (0).' }])[0].outcome, 'inert');
  });
  test('network cursor ignores baselines, repeats, reordered snapshots and reconnect history', function () {
    var c = E.cursor();
    var j = { stream: 'match-a', sequence: 0, events: [] };
    equal(c.consume(j).length, 0);
    E.append(j, E.publicEvent('knife', 0, 1));
    equal(c.consume(j).length, 1); equal(c.consume(j).length, 0);
    equal(c.consume({ stream: 'match-a', sequence: 0, events: [] }).length, 0);
    c.reset(); equal(c.consume(j).length, 0);
    j.stream = 'match-b'; equal(c.consume(j).length, 0);
    E.append(j, E.publicEvent('ghost', 0)); j.events.push(j.events[1]);
    equal(c.consume(j).length, 1, 'duplicate IDs within packet ignored');
  });
  test('public channel rejects unknown effects and strips all secret fields', function () {
    var j = { sequence: 0, events: [] };
    E.append(j, { key: 'ally-phoenix', actor: 0, target: 1, hand: ['phoenix'], cardId: 'curse', text: '<script>', cursed: 'knife' });
    deepEqual(j.events[0], { key: 'ally-phoenix', actor: 0, target: 1, outcome: 'active', id: 1 });
    E.append(j, { key: '__proto__' }); equal(j.events.length, 1);
    equal(E.publicEvent('unknown', 0), null);
    for (var i = 0; i < 100; i++) E.append(j, E.publicEvent('bonus', 0));
    equal(j.events.length, 64);
  });
  test('public log masks draws, reveals and burns as well as the effect channel', function () {
    ['draw', 'alvin'].forEach(function (type) { assert(E.publicLog({ type: type, text: 'SECRET_KNIFE' }).indexOf('SECRET') < 0); });
    ['alvin', 'reveal'].forEach(function (cardId) { assert(E.publicLog({ type: 'result', cardId: cardId, text: 'SECRET_HAND' }).indexOf('SECRET') < 0); });
  });
  test('effect settings persist separately without touching saved music', function () {
    var data = { 'phoenix.music.v1': '{"track":"calm","volume":0.63}' };
    var store = { getItem: function (k) { return data[k] || null; }, setItem: function (k, v) { data[k] = v; } };
    var p = { sound: false, volume: 0.17, visuals: 'off' };
    assert(E.save(store, p)); deepEqual(E.load(store), p);
    equal(data['phoenix.music.v1'], '{"track":"calm","volume":0.63}');
    deepEqual(E.load(null), E.defaults());
    equal(E.save(null, p), false);
    deepEqual(E.normalise({ sound: 'yes', volume: Infinity, visuals: 'bad' }), E.defaults());
  });
  test('muted sounds and zero volume allocate no audio resources', function () {
    var b = browser(); b.api.update({ sound: false }); b.api.unlock(); b.api.show(E.publicEvent('phoenix', 0));
    equal(b.contexts.length, 0); equal(b.api.isAudioBlocked(), false);
    b.api.update({ sound: true, volume: 0 }); b.api.unlock(); b.api.show(E.publicEvent('knife', 0));
    equal(b.contexts.length, 0);
  });
  test('blocked effects share music recovery button; muted effects do not hide music recovery', function () {
    var b = browser(); b.api.show(E.publicEvent('bonus', 0));
    equal(b.api.isAudioBlocked(), true); equal(b.nodes['music-enable-button'].hidden, false);
    b.api.unlock(); equal(b.api.isAudioBlocked(), false);
    b.context.PhoenixMusicPlayer.isBlocked = function () { return true; };
    b.api.update({ sound: false }); equal(b.nodes['music-enable-button'].hidden, false);
  });
  test('system reduced motion overrides full and disabled visuals allocate no overlays', function () {
    var b = browser(true); b.api.show(E.publicEvent('phoenix', 0));
    var overlay = b.context.document.body.children[0];
    assert(overlay.className.indexOf('cinematic-reduced') >= 0);
    equal(overlay.children.length, 2, 'no moving particles');
    b.api.update({ visuals: 'off' }); b.api.show(E.publicEvent('bonus', 0));
    equal(b.api.diagnostics().visuals, 0);
    equal(E.motion({ visuals: 'off' }, true), 'off');
  });
  test('effects are bounded and clean up nodes, timers and oscillators', function () {
    var b = browser(); b.api.unlock();
    for (var i = 0; i < 20; i++) b.api.show(E.publicEvent('phoenix', 0));
    equal(b.api.diagnostics().visuals, 3); equal(b.api.diagnostics().voices, 3);
    b.flush(); equal(b.api.diagnostics().visuals, 0); equal(b.api.diagnostics().voices, 0); equal(b.timers.size, 0);
    b.api.show(E.publicEvent('knife', 0)); b.hide();
    equal(b.api.diagnostics().visuals, 0); equal(b.api.diagnostics().voices, 0);
    b.close(); equal(b.contexts[0].state, 'closed');
    assert(b.contexts[0].nodes.filter(function (n) { return n.started; }).every(function (n) { return n.disconnected && n.stopped; }));
  });
};
module.exports.browser = browser;
