/* Test-only server entry point: the ordinary server.js with the eight
 * interactive cards switched OFF, for scripted suites (effects, admin,
 * badges, leaderboard, security, announcements) whose clients drive plain
 * moves and must never pause for an interaction they cannot answer.
 *
 * Interaction coverage lives in the fixture-driven suites instead
 * (other-cards-network, timeouts, natural-match, reconnect and the browser
 * checks), which force the cards ON via tests/interactive-local-server.js.
 *
 * Not a deployment entry point. Never run this as a start command. */
'use strict';
const Cards = require('../../js/cards');
const INTERACTIVE_IDS = ['speed', 'impostor', 'dice', 'rps', 'betrayal', 'wheel', 'linkedfate', 'swapper'];
INTERACTIVE_IDS.forEach(function (id) { if (Cards.byId(id)) { Cards.byId(id).inLiveGame = false; } });
module.exports = { INTERACTIVE_IDS };
if (require.main === module) {
  require('../../server');
}