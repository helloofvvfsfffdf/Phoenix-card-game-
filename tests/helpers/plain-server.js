/* Test-only server entry point: the ordinary server.js with every INTERACTIVE
 * card switched OFF, for scripted suites (effects, admin, badges, leaderboard,
 * security, announcements) whose clients drive plain moves and must never
 * pause for an interaction they cannot answer.
 *
 * That is every card that asks the players for a decision: the original eight,
 * and the expansion's seven.
 *
 * Interaction coverage lives in the fixture-driven suites instead
 * (other-cards-network, timeouts, natural-match, reconnect and the browser
 * checks), which force the cards ON via tests/interactive-local-server.js.
 *
 * Not a deployment entry point. Never run this as a start command. */
'use strict';
const Cards = require('../../js/cards');
const INTERACTIVE_IDS = [
  // The original eight.
  'speed', 'impostor', 'dice', 'rps', 'betrayal', 'wheel', 'linkedfate', 'swapper',
  // And the expansion's seven.
  'musicalchairs', 'russianroulette', 'memorymayhem', 'mimic', 'support',
  'joshuasurvey', 'trailer',
  // And the Wheel of Misfortune, which asks for a spin.
  'wheelofmisfortune'
];
INTERACTIVE_IDS.forEach(function (id) { if (Cards.byId(id)) { Cards.byId(id).inLiveGame = false; } });
module.exports = { INTERACTIVE_IDS };
if (require.main === module) {
  require('../../server');
}
