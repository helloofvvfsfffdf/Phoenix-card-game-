'use strict';
const assert = require('assert');
const Rules = require('../js/rules');
let passed = 0;
// Reverse at every possible seat, including disabled seats in 2–4 player games.
for (const count of [2, 3, 4, 5]) for (let reverseAfter = 0; reverseAfter < count; reverseAfter++) {
  const state = Rules.createGame({ rounds: 4, fixedOrder: true, rotateStart: false, seed: 123 });
  state.players.forEach((p, i) => { p.enabled = i < count; });
  state.turnInRound = 0;
  state.roundStartSeat = 0;
  state.seatsPlayed = 0;
  state.roundVisited = [];
  const firstRound = [];
  while (state.round === 1 && !state.over) {
    assert(firstRound.length < count + 1, 'round must terminate');
    firstRound.push(state.turnInRound);
    if (firstRound.length - 1 === reverseAfter) state.turnDirection = -1;
    Rules.advanceTurn(state);
  }
  assert.strictEqual(firstRound.length, count, 'each enabled player gets one turn');
  assert.strictEqual(new Set(firstRound).size, count, 'no double turn after reversing');
  assert.strictEqual(state.round, 2);
  const secondRound = [];
  while (state.round === 2) {
    assert(secondRound.length < count + 1);
    secondRound.push(state.turnInRound);
    Rules.advanceTurn(state);
  }
  assert.strictEqual(new Set(secondRound).size, count);
  assert.strictEqual(secondRound[1], count - 1, 'direction persists into the next round');
  passed++;
}
console.log(passed + ' reverse-turn round checks passed');
