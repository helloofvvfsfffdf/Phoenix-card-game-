/* PHOENIX — Sudden Death mode. */
'use strict';
function getState(room) { return { mode: 'sudden-death', timerSeconds: 30, rounds: 10, eventTimer: true }; }
function onTurn(room, turn) { return null; }
function onRoundComplete(room, completedRound) { return null; }
module.exports = { modeName: 'sudden-death', onRoundComplete, onTurn, getState, EVENTS: [] };
