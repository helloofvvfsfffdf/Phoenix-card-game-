'use strict';
const assert = require('assert');
const online = require('./match-audio-tests').online;
const interactionView = require('../js/interaction-view');
const Cards = require('../js/cards');
const Speed = require('../js/speed-interaction');

const modules = {
  rps: 'PhoenixRpsInteractive', betrayal: 'PhoenixBetrayalInteractive',
  speed: 'PhoenixSpeedInteractive', dice: 'PhoenixDiceInteractive',
  wheel: 'PhoenixWheelInteractive', linkedfate: 'PhoenixLinkedFateInteractive',
  impostor: 'PhoenixImpostorInteractive', swapper: 'PhoenixSwapperInteractive'
};
let failed = 0;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

Object.keys(modules).forEach(type => {
  test(type + ': actual socket handler delivers every snapshot after build', () => {
    const b = online();
    const calls = [];
    b.context[modules[type]] = {
      build() { calls.push('build'); },
      onState(message) {
        assert.strictEqual(b.context.PhoenixOnline.getState(), message);
        calls.push(message.pendingInteraction.phase);
      },
      close() { calls.push('close'); }
    };
    const pendingInteraction = { type, participants: ['human'], submitted: [], phase: 'waiting' };
    b.receive('playing', false, { pendingInteraction });
    b.receive('playing', false, { pendingInteraction: { ...pendingInteraction, phase: 'vote' } });
    b.receive('playing');
    assert.deepStrictEqual(calls, ['build', 'waiting', 'build', 'vote', 'close']);
  });
});

test('switching card types closes the previous overlay', () => {
  const b = online();
  let closed = 0;
  b.context.PhoenixDiceInteractive = { build() {}, onState() {}, close() { closed++; } };
  b.context.PhoenixRpsInteractive = { build() {}, onState() {}, close() {} };
  b.receive('playing', false, { pendingInteraction: { type: 'dice' } });
  closed = 0;
  b.receive('playing', false, { pendingInteraction: { type: 'rps' } });
  assert.strictEqual(closed, 1);
});

test('disconnect closes the active overlay and clears its state', () => {
  const b = online();
  let closed = false;
  b.context.PhoenixDiceInteractive = { build() {}, onState() {}, close() { closed = true; } };
  b.receive('playing', false, { pendingInteraction: { type: 'dice' } });
  b.disconnect();
  assert(closed);
  assert.strictEqual(b.context.PhoenixOnline.getState(), null);
});

test('completed results reach the existing overlay once and survive the next snapshot', () => {
  const b = online();
  const calls = [];
  b.context.PhoenixDiceInteractive = { build() { calls.push('build'); }, onState(msg) { calls.push(msg.pendingInteraction.phase); }, close() { calls.push('close'); } };
  const pi = { type: 'dice', createdAt: 12, phase: 'waiting', participants: ['human'], submitted: [] };
  const result = { ...pi, phase: 'result', roundData: { rolls: { human: 5 } }, events: [{ type: 'result', cardId: 'dice', text: 'rolled 5' }] };
  b.receive('playing', false, { pendingInteraction: pi });
  b.receive('playing', false, { lastInteractionResult: result });
  b.receive('playing', false, { lastInteractionResult: result });
  assert.deepStrictEqual(calls, ['build', 'waiting', 'result']);
  b.advance(6000);
  assert.deepStrictEqual(calls, ['build', 'waiting', 'result', 'close']);
});
test('disconnect during a displayed result closes it and cancels stale timers', () => {
  const b = online();
  let closed = 0;
  b.context.PhoenixDiceInteractive = { build() {}, onState() {}, close() { closed++; } };
  const pi = { type: 'dice', createdAt: 12, participants: ['human'] };
  b.receive('playing', false, { pendingInteraction: pi });
  b.receive('playing', false, { lastInteractionResult: { ...pi, events: [] } });
  b.disconnect();
  assert.strictEqual(closed, 1);
  b.advance(6001);
  assert.strictEqual(closed, 1);
});
test('a new instance of the same card replaces the old result without a stale close', () => {
  const b = online();
  let closed = 0;
  b.context.PhoenixDiceInteractive = { build() {}, onState() {}, close() { closed++; } };
  const pi = { type: 'dice', createdAt: 12, participants: ['human'] };
  b.receive('playing', false, { pendingInteraction: pi });
  b.receive('playing', false, { lastInteractionResult: { ...pi, events: [] } });
  b.receive('playing', false, { pendingInteraction: { ...pi, createdAt: 13 } });
  assert.strictEqual(closed, 1);
  b.advance(6001);
  assert.strictEqual(closed, 1);
});

test('Impostor projection sends only the viewer word, never identities or votes', () => {
  const pi = {
    type: 'impostor', participants: ['a', 'b', 'c', 'd'], phase: 'clues',
    actorSeat: 0, decisions: { clues: { a: 'clue:drink' } },
    roundData: { impostorId: 'a', wordPair: { main: 'Coffee', impostor: 'Tea' },
      playerWords: { a: 'Tea', b: 'Coffee', c: 'Coffee', d: 'Coffee' },
      clues: { a: 'drink' }, votes: { a: 'b' } }
  };
  for (const id of pi.participants.concat('spectator')) {
    const view = interactionView(pi, id);
    assert.deepStrictEqual(view.roundData, { myWord: pi.roundData.playerWords[id] || null, clues: {} });
    assert.strictEqual(view.actorSeat, 0);
    assert.deepStrictEqual(view.submitted, ['a']);
    const json = JSON.stringify(view);
    for (const secret of ['impostorId', 'wordPair', 'playerWords', 'votes', 'clue:drink']) {
      assert(!json.includes(secret), secret + ' leaked');
    }
  }
  pi.phase = 'vote';
  pi.decisions.vote = { b: 'vote:a' };
  const view = interactionView(pi, 'b');
  assert.deepStrictEqual(view.submitted, ['b'], 'clues do not count as submitted votes');
  assert.deepStrictEqual(view.roundData.clues, { a: 'drink' });
  assert(!JSON.stringify(view).includes('vote:a'));
});

test('all eight released cards are enabled and present in the live deck', () => {
  const live = Cards.deckCards().map(card => card.id);
  for (const id of Object.keys(modules)) {
    assert.strictEqual(Cards.byId(id).inLiveGame, true, id + ' is not enabled');
    assert(live.includes(id), id + ' was left out of the live deck');
  }
});

function speedFixture() {
  return { type: 'speed', phase: 'ready', participants: ['a', 'b'], decisions: {}, roundData: {} };
}
test('Speed requires both players ready and never awards points for readiness', () => {
  const pi = speedFixture();
  assert.deepStrictEqual(Speed.submit(pi, 'a', 'ready', 1000, 0), {});
  assert(Speed.submit(pi, 'a', 'ready', 1001, 0).error);
  const result = Speed.submit(pi, 'b', 'ready', 1002, 0);
  assert(result.countdownMs >= 4000 && result.countdownMs <= 6000);
  assert.strictEqual(pi.phase, 'countdown');
  const state = { players: [{ id: 'a', points: 0 }, { id: 'b', points: 0 }] };
  Speed.resolve(state, pi);
  assert.deepStrictEqual(state.players.map(p => p.points), [0, 0]);
});
test('Speed rejects reported times and uses receipt time with bounded measured latency', () => {
  const pi = speedFixture(); pi.phase = 'react'; pi.goTime = 1000;
  assert(Speed.submit(pi, 'a', 'time:-100', 1100, 0).error);
  assert(Speed.submit(pi, 'a', 'ready', 1100, 0).error);
  Speed.submit(pi, 'a', 'react', 1400, 50);
  assert.strictEqual(pi.reactions.a, 350);
  assert(Speed.submit(pi, 'a', 'react', 1401, 50).error);
  assert(Speed.submit(pi, 'b', 'react', 1600, 9999).done);
  assert.strictEqual(pi.reactions.b, 350, 'latency compensation is capped');
});
test('Speed false starts and missing reactions cannot win a fabricated prize', () => {
  const pi = speedFixture(); pi.phase = 'countdown';
  Speed.submit(pi, 'a', 'react', 100, 0);
  assert.strictEqual(pi.reactions.a, 'false_start');
  const state = { players: [{ id: 'a', name: 'A', points: 0 }, { id: 'b', name: 'B', points: 0 }] };
  Speed.resolve(state, pi);
  assert.deepStrictEqual(state.players.map(p => p.points), [0, 0]);
  pi.phase = 'react'; pi.goTime = 1000;
  Speed.submit(pi, 'b', 'react', 1400, 0);
  Speed.resolve(state, pi);
  assert.deepStrictEqual(state.players.map(p => p.points), [0, 15000]);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
