/* Server-owned Speed state machine. Browser-supplied reaction times are never used. */
'use strict';
const crypto = require('crypto');

function submit(pi, playerId, decision, now, roundTripMs) {
  pi.decisions.ready = pi.decisions.ready || {};
  pi.decisions.react = pi.decisions.react || {};
  pi.reactions = pi.reactions || {};
  if (pi.phase === 'ready') {
    if (decision !== 'ready') return { error: 'Press Ready first.' };
    if (pi.decisions.ready[playerId]) return { error: 'You are already ready.' };
    pi.decisions.ready[playerId] = 'ready';
    if (!pi.participants.every(id => pi.decisions.ready[id])) return {};
    pi.phase = 'countdown';
    pi.decisions.countdown = pi.decisions.react;
    // The random GO deadline is private. Clients wait for the server's react phase.
    return { countdownMs: 3000 + crypto.randomInt(1000, 3001) };
  }
  if (pi.phase !== 'countdown' && pi.phase !== 'react') return { error: 'Speed is not accepting reactions.' };
  if (!['react', 'false_start'].includes(decision)) return { error: 'Invalid reaction.' };
  if (pi.decisions.react[playerId]) return { error: 'You have already reacted.' };
  const falseStart = pi.phase === 'countdown' || decision === 'false_start';
  // GO travels to the browser and the press travels back. Subtract a measured
  // round trip, bounded to 250ms; never accept a client-reported time or offset.
  const compensation = Math.min(250, Math.max(0, Number(roundTripMs) || 0));
  pi.reactions[playerId] = falseStart ? 'false_start' : Math.max(0, now - pi.goTime - compensation);
  pi.decisions.react[playerId] = falseStart ? 'false_start' : 'react';
  return { done: pi.participants.every(id => pi.decisions.react[id]) };
}

function resolve(state, pi) {
  const reactions = pi.reactions || {};
  const times = pi.participants.map(id => typeof reactions[id] === 'number' && Number.isFinite(reactions[id])
    ? reactions[id] : Infinity);
  const players = pi.participants.map(id => state.players.find(player => player.id === id));
  let text;
  if (times[0] === times[1]) {
    text = Number.isFinite(times[0]) ? 'Speed Challenge - tied reaction times. No points awarded.'
      : 'Speed Challenge - neither player completed a valid reaction. No points awarded.';
  } else {
    const winner = times[0] < times[1] ? 0 : 1;
    players[winner].points += 15000;
    const describe = (player, index) => player.name + ': ' + (Number.isFinite(times[index])
      ? Math.round(times[index]) + 'ms' : reactions[player.id] === 'false_start' ? 'false start' : 'timed out');
    text = 'Speed Challenge - ' + players.map(describe).join(', ') + '. ' + players[winner].name + ' wins 15,000.';
  }
  return { events: [{ type: 'result', cardId: 'speed', text }], advanceTurn: true };
}

module.exports = { submit, resolve };
