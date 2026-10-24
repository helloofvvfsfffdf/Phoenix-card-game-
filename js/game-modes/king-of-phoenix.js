/* PHOENIX — King of PHOENIX mode. */
'use strict';
function onRoundComplete(room, completedRound) {
  // Recalculate highest score; apply crown bonus.
  return { mode: 'king-of-phoenix', crownBonusApplied: true, round: completedRound };
}
function getState(room) { return { mode: 'king-of-phoenix', crownHolder: null, crownBonus: 2 }; }
module.exports = { modeName: 'king-of-phoenix', onRoundComplete, onTurn: () => null, getState, EVENTS: [] };
