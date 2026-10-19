/* LOCAL REPRODUCTION ONLY. Enables one unfinished card in this process, not in
 * the catalogue on disk. No production accounts/database or state are used.
 * Usage: node tests/interactive-local-server.js speed [port]
 * Stop with Ctrl+C. Never deploy this test entry point. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Cards = require('../js/cards');
const Rules = require('../js/rules');
const id = process.argv[2];
const interactiveIds = ['speed', 'impostor', 'dice', 'rps', 'betrayal', 'wheel', 'linkedfate', 'swapper'];
if (id !== 'all' && !interactiveIds.includes(id)) {
  throw new Error('Specify an interactive card ID.');
}
// Refuse to inherit any credentials. Auth sees Supabase as unconfigured.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.PHOENIX_OWNER_SETUP_KEY;
const tempRoot = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
const temp = fs.mkdtempSync(path.join(tempRoot, 'phoenix-interaction-repro-'));
process.env.PHOENIX_STATE_FILE = path.join(temp, 'state.json');
process.env.PHOENIX_OWNER_PASSWORD = crypto.randomBytes(32).toString('hex');
process.env.PHOENIX_MODE_ACCESS_CODE = crypto.randomBytes(24).toString('hex');
process.env.PORT = process.argv[3] || '4318';
process.env.PHOENIX_BIND_HOST = '127.0.0.1';
process.env.PHOENIX_MAX_ROOMS = '50';
process.env.PHOENIX_CREATE_LIMIT = '50';
fs.writeFileSync(process.env.PHOENIX_STATE_FILE, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));
(id === 'all' ? interactiveIds : [id]).forEach(cardId => { Cards.byId(cardId).inLiveGame = true; });
// Optional deterministic interaction randomness, only in this test process.
const randomValues = String(process.argv[4] || process.env.PHOENIX_REPRO_RANDOM || '').split(',').filter(Boolean).map(Number);
if (randomValues.length) {
  if (!randomValues.every(value => Number.isFinite(value) && value >= 0 && value < 1)) throw new Error('Invalid fixture RNG');
  let randomIndex = 0;
  Math.random = () => randomValues[randomIndex++ % randomValues.length];
}
// A deterministic hand makes the card immediately available in a real match.
// This is a test fixture, not a valid conservation-of-cards or full-match test.
const createGame = Rules.createGame;
Rules.createGame = function (options) {
  const state = createGame(options);
  if (!process.env.PHOENIX_REPRO_NATURAL_DEAL) {
    state.players.forEach(player => { state.hands[player.id] = Cards.deckIds().slice(); });
  }
  if (process.env.PHOENIX_REPRO_POINTS) {
    state.players.forEach(player => { player.points = Number(process.env.PHOENIX_REPRO_POINTS); });
  }
  if (process.env.PHOENIX_REPRO_CURSED_CARD) state.players.forEach(player => { player.cursed = [process.env.PHOENIX_REPRO_CURSED_CARD]; });
  if (process.env.PHOENIX_REPRO_FINAL_LINK) {
    state.round = state.rounds;
    state.turnInRound = 4;
    state.seatsPlayed = 4;
    state.players.forEach(player => { player.points = 0; });
    state.players[0].points = 15000;
    state.players[1].points = 18000;
    state.linkedFate = [{ a: state.players[4].id, b: state.players[0].id, roundsLeft: 2 }];
  }
  return state;
};
if (!process.env.PHOENIX_REPRO_NATURAL_DEAL) require('../js/maple').apply = function () { return null; };
console.log('LOCAL ONLY: fixture card=' + id + ', database disabled, state=' + temp);
require('../server');
