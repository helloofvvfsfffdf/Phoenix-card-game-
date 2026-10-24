/* PHOENIX — Total Chaos mode (server-authoritative events). */
'use strict';
const crypto = require('crypto');

const EVENTS = [
  { id: 'swap-hands', name: 'HAND SWAP', desc: 'All players swap hands.', effect: 'swapHands' },
  { id: 'double-score', name: 'DOUBLE SCORE', desc: 'The current leader doubles their score.', effect: 'doubleLeader' },
  { id: 'category-lock', name: 'CATEGORY LOCK', desc: 'Only cards of the current leader\'s favorite category can be played for one round.', effect: 'restrictCategory' },
  { id: 'random-bonus', name: 'RANDOM BONUS', desc: 'A random non-leader gains 5 points.', effect: 'randomBonus' }
];

function triggerEvent(room) {
  if (!room || !room.players || room.players.length < 2) return null;
  const event = EVENTS[crypto.randomInt(0, EVENTS.length)];
  return { mode: 'total-chaos', event: event.id, eventName: event.name, eventDesc: event.desc, appliedRound: (room.currentRound || 0), timestamp: Date.now() };
}

function onRoundComplete(room, completedRound) {
  // Every 3 complete rounds
  if (completedRound > 0 && completedRound % 3 === 0) {
    return triggerEvent(room);
  }
  return null;
}

function getState(room) {
  return { mode: 'total-chaos', activeEvents: (room.activeEvents || []), roundTrigger: 3 };
}

function applyEffect(room, effectId) {
  // Placeholder for safe server-side application (isolated from rules engine)
  return { applied: effectId };
}

module.exports = { modeName: 'total-chaos', onRoundComplete, onTurn: () => null, triggerEvent, applyEffect, getState, EVENTS };
