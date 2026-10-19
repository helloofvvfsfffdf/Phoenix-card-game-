'use strict';
const assert = require('assert');
const Rules = require('../js/rules');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function fresh(seed = 42) { return Rules.createGame({ seed, fixedOrder: true, rotateStart: false, rounds: 20 }); }
function unique(state) {
  state.players.forEach(player => {
    const hand = Rules.handOf(state, player.id);
    assert.strictEqual(new Set(hand).size, hand.length, 'duplicate in ' + player.id + ': ' + hand);
  });
}
function inventory(state) {
  return state.deck.concat(state.discard, state.destroyed, ...Object.values(state.hands)).sort();
}

test('opening hands and repeated draws stay unique across 100 deals', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const state = fresh(seed);
    const before = inventory(state);
    unique(state);
    for (let i = 0; i < 100; i++) {
      Rules.drawCard(state, state.players[i % state.players.length]);
      unique(state);
    }
    assert.deepStrictEqual(inventory(state), before, 'drawing never deletes or creates cards');
  }
});

test('a duplicate draw stays in the deck and the next different card is drawn', () => {
  const state = fresh(); const player = state.players[0];
  state.hands[player.id] = ['bonus'];
  state.deck = ['bonus', 'bonus', 'knife']; state.discard = [];
  const before = inventory(state);
  assert.strictEqual(Rules.drawCard(state, player), 'knife');
  assert.deepStrictEqual(state.hands[player.id], ['bonus', 'knife']);
  assert.deepStrictEqual(state.deck, ['bonus', 'bonus']);
  assert.deepStrictEqual(inventory(state), before);
});

test('a different discarded card is recycled when only owned types remain in the deck', () => {
  const state = fresh(); const player = state.players[0];
  state.hands[player.id] = ['bonus']; state.deck = ['bonus']; state.discard = ['knife'];
  const before = inventory(state); const reshuffles = state.reshuffles;
  assert.strictEqual(Rules.drawCard(state, player), 'knife');
  assert.strictEqual(state.reshuffles, reshuffles + 1);
  assert.deepStrictEqual(inventory(state), before);
  assert.deepStrictEqual(state.deck, ['bonus']);
});

test('an all-duplicate supply skips drawing without looping or losing cards', () => {
  const state = fresh(); const player = state.players[0];
  state.hands[player.id] = ['bonus']; state.deck = ['bonus']; state.discard = ['bonus'];
  const before = inventory(state);
  for (let i = 0; i < 100; i++) assert.strictEqual(Rules.drawCard(state, player), null);
  assert.deepStrictEqual(inventory(state), before);
  assert.deepStrictEqual(state.hands[player.id], ['bonus']);
});

test('playing a held type makes it eligible to draw again', () => {
  const state = fresh(); const player = state.players[state.turnInRound];
  state.hands[player.id] = ['bonus']; state.deck = ['bonus']; state.discard = [];
  assert.strictEqual(Rules.drawCard(state, player), null);
  assert(Rules.playCard(state, player.seat, 'bonus', null).ok);
  assert.strictEqual(Rules.drawCard(state, player), 'bonus');
  unique(state);
});

test('a transfer rejects duplicate ownership and leaves both hands untouched', () => {
  const state = fresh(); const [from, to] = state.players;
  state.hands[from.id] = ['bonus', 'knife']; state.hands[to.id] = ['bonus'];
  const before = inventory(state);
  assert.strictEqual(Rules.transferCard(state, from.id, to.id, 'bonus'), false);
  assert.deepStrictEqual(state.hands[from.id], ['bonus', 'knife']);
  assert.deepStrictEqual(state.hands[to.id], ['bonus']);
  assert.strictEqual(Rules.transferCard(state, from.id, to.id, 'knife'), true);
  assert.deepStrictEqual(state.hands[from.id], ['bonus']);
  assert.deepStrictEqual(state.hands[to.id], ['bonus', 'knife']);
  assert.deepStrictEqual(inventory(state), before);
});

test('the real Phoenix ally steals only a new type, or leaves the victim hand intact', () => {
  const fixture = require('./effects-tests').serverFixture('tilly', false);
  const state = fixture.room.state;
  const [owner, victim] = state.players;
  state.hands[owner.id] = ['bonus'];
  state.hands[victim.id] = ['bonus', 'knife'];
  state.hands[state.players[2].id] = [];
  const before = inventory(state);
  fixture.api.applyPhoenix(fixture.room);
  assert.deepStrictEqual(state.hands[owner.id], ['bonus', 'knife']);
  assert.deepStrictEqual(state.hands[victim.id], ['bonus']);
  fixture.api.applyPhoenix(fixture.room);
  assert.deepStrictEqual(state.hands[owner.id], ['bonus', 'knife']);
  assert.deepStrictEqual(state.hands[victim.id], ['bonus']);
  assert.deepStrictEqual(inventory(state), before);
  unique(state);
});

test('Phoenix hand replacement also draws unique cards and conserves the supply', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const state = fresh(seed);
    const before = inventory(state);
    const result = Rules.clearAndRedrawVictim(state, 0);
    assert(result.victim);
    unique(state);
    assert.deepStrictEqual(inventory(state), before);
  }
});

test('two-, three-, four- and five-player opening deals have no duplicates', () => {
  try {
    for (let count = 2; count <= 5; count++) {
      Rules.SEATS.forEach((seat, index) => Rules.setPlayerEnabled(seat.id, index < count));
      for (let seed = 1; seed <= 20; seed++) unique(fresh(seed));
    }
  } finally {
    Rules.SEATS.forEach(seat => Rules.setPlayerEnabled(seat.id, true));
  }
});

console.log(passed + ' unique-hand checks passed');
