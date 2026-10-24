/* PHOENIX — Democracy Mode. */
'use strict';
function getState(room) { return { mode: 'democracy', modifiers: ['bonus-point','swap-hand','restrict-card'], pendingVote: false, voteEnd: null }; }
function onRoundComplete(room, completedRound) {
  if (completedRound > 0 && completedRound % 3 === 0) return { mode: 'democracy', voteReady: true, round: completedRound };
  return null;
}
function onTurn(room, turn) { return null; }
module.exports = { modeName: 'democracy', onRoundComplete, onTurn, getState, EVENTS: [] };
