/* PHOENIX — Card Roulette mode. */
'use strict';
function getState(room) { return { mode: 'card-roulette', rotatedType: null, rotatedRound: null }; }
function onRoundComplete(room, completedRound) {
  if (completedRound > 0 && completedRound % 2 === 0) {
    return { mode: 'card-roulette', rotated: true, round: completedRound };
  }
  return null;
}
function onTurn(room, turn) { return null; }
module.exports = { modeName: 'card-roulette', onRoundComplete, onTurn, getState, EVENTS: [] };
