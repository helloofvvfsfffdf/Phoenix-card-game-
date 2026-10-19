/* Phone-testing launcher. A disposable, account-free copy of the local
 * playground bound to the LAN so a real phone on the same Wi-Fi can open it.
 * OPT-IN only: it exposes an unauthenticated, database-less test server to
 * your private network. Never deploy it, never run it on a public network,
 * and stop it when you are done. The regular fixtures
 * (interactive-local-server.js / start-local-play.js) keep their hard
 * loopback bind; this file is deliberately separate from them. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Cards = require('../js/cards');
const Rules = require('../js/rules');
// Refuse to inherit any credentials. Auth sees Supabase as unconfigured.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.PHOENIX_OWNER_SETUP_KEY;
// Do not inherit deterministic regression scenarios into a manual playground.
for (const key of ['PHOENIX_REPRO_RANDOM', 'PHOENIX_REPRO_POINTS', 'PHOENIX_REPRO_CURSED_CARD', 'PHOENIX_REPRO_FINAL_LINK', 'PHOENIX_REPRO_NATURAL_DEAL']) delete process.env[key];
const port = process.env.PHOENIX_LAN_PORT || '4321';
const tempRoot = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
const temp = fs.mkdtempSync(path.join(tempRoot, 'phoenix-lan-play-'));
process.env.PHOENIX_STATE_FILE = path.join(temp, 'state.json');
process.env.PHOENIX_OWNER_PASSWORD = crypto.randomBytes(32).toString('hex');
process.env.PHOENIX_MODE_ACCESS_CODE = crypto.randomBytes(24).toString('hex');
process.env.PORT = port;
process.env.PHOENIX_BIND_HOST = '0.0.0.0';
process.env.PHOENIX_MAX_ROOMS = '50';
process.env.PHOENIX_CREATE_LIMIT = '50';
fs.writeFileSync(process.env.PHOENIX_STATE_FILE, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));
// All eight interactive cards enabled so the phone can exercise them.
['speed', 'impostor', 'dice', 'rps', 'betrayal', 'wheel', 'linkedfate', 'swapper']
  .forEach(cardId => { Cards.byId(cardId).inLiveGame = true; });
// A deterministic hand makes the new cards immediately playable.
const createGame = Rules.createGame;
Rules.createGame = function (options) {
  const state = createGame(options);
  state.players.forEach(player => { state.hands[player.id] = Cards.deckIds().slice(); });
  return state;
};
require('../js/maple').apply = function () { return null; };
const { networkInterfaces } = require('os');
const lan = Object.values(networkInterfaces()).flat()
  .find(i => i && i.family === 'IPv4' && !i.internal);
console.log('LAN TEST ONLY: all eight cards enabled, database disabled, state=' + temp);
console.log('Open on this PC:  http://127.0.0.1:' + port + '/tests/local-play.html');
if (lan) console.log('Open on your phone (same Wi-Fi):  http://' + lan.address + ':' + port + '/');
console.log('Stop with Ctrl+C; close the page to stop its music. Never deploy this entry point.');
require('../server');
