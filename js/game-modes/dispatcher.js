/* PHOENIX — Game mode dispatcher (isolated hooks, no rules engine change). */
'use strict';
const modes = {
  'total-chaos': require('./total-chaos'),
  'king-of-phoenix': require('./king-of-phoenix'),
  'sudden-death': require('./sudden-death'),
  'card-roulette': require('./card-roulette'),
  'democracy': require('./democracy-mode')
};

function getMode(name) { return modes[name] || null; }
function listModes() { return Object.keys(modes); }

function applyHook(room, hookName, ...args) {
  if (!room || !room.gameMode) return null;
  const mode = getMode(room.gameMode);
  if (!mode) return null;
  if (typeof mode[hookName] === 'function') return mode[hookName](room, ...args);
  return null;
}

module.exports = { getMode, listModes, applyHook };
