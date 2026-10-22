/* Pure coverage for the 38 card achievement catalogue and server evaluator. */
'use strict';
const assert = require('assert');
const Achievements = require('../js/achievements');
const Catalogue = require('../js/achievement-catalog');

const players = [
  { id: 'a', points: 100000 }, { id: 'b', points: 1000 },
  { id: 'c', points: 0 }, { id: 'd', points: 0 }
];
const room = { state: { players }, members: [] };
const result = { events: [{ type: 'result', text: 'success' }] };
function has(key, cardId, facts) {
  const awards = Achievements.checkCardAchievements(room, { type: cardId, actorId: 'a', participants: ['a', 'b'], roundData: {} }, result,
    Object.assign({ cardId, actorId: 'a', successful: true }, facts || {}));
  assert(awards.some(a => a.badgeKey === key), key + ' was not detected');
}

assert.strictEqual(Catalogue.length, 38);
const rarities = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'impossible', 'divine']);
Catalogue.forEach(a => assert(rarities.has(a.rarity), a.key + ' has an invalid rarity'));

has('pocket-money', 'bonus', { gain: 10000 });
has('highway-robbery', 'steal', { amount: 50000 });
has('master-thief', 'bankrobbery', { amount: 25000 });
has('tables-turned', 'pointswap', { scoreGap: 50000 });
has('partners-in-crime-card', 'linkedfate', { bonus: 20000, receiverId: 'b' });
has('sharp-decision', 'knife', { eliminated: true });
has('undead-nightmare', 'zombie', { eliminated: true });
has('hunter-hunted', 'reverseofdoom', { reflected: true, reflectedCard: 'knife' });
has('untouchable', 'ghost', { blocked: true, targetId: 'b' });
has('guilty-as-charged', 'judge', { leadingEvilEliminated: true });
has('not-today', 'reverseofdoom', { reflectedCard: 'phoenix' });
has('lucky-escape', 'russianroulette', { survived: true, survivorId: 'a' });
has('my-turn-again', 'skipall', { skippedEveryone: true });
has('puppet-master', 'stealturn', { forcedCard: 'bonus' });
has('master-of-disguise-card', 'impostor', { disguisedBlame: true, playerId: 'a' });
has('cursed-fortune', 'bonus', { curseTriggered: true });
has('card-destroyer', 'alvin', { destroyedOpponentCard: true });
has('no-more-secrets', 'reveal', { revealedOpponentHand: true });
has('identity-crisis-card', 'swapper', { swappedAllies: true });
has('high-roller', 'dice', { winnerId: 'a' });
has('mind-reader-card', 'rps', { winnerId: 'a' });
has('trust-issues', 'betrayal', { targetId: 'b', choices: { a: 'steal', b: 'share' } });
has('lightning-reflexes-card', 'speed', { winnerId: 'a', falseStart: false });
has('among-us', 'impostor', { impostorId: 'a', winnerId: 'a' });
has('take-a-seat', 'musicalchairs', { winnerId: 'a' });
has('photographic-memory', 'memorymayhem', { perfectPlayerId: 'a' });
has('peoples-choice', 'joshuasurvey', { winnerId: 'a' });
has('fortune-favours-me', 'wheel', { outcome: 'gain_10k' });
has('disaster-magnet', 'wheelofmisfortune', { negative: true, survived: true });
has('rise-of-the-phoenix', 'phoenix');
has('mr-president', 'president', { completedRounds: 5 });
has('negotiator', 'hostage', { rescued: true, policeId: 'a' });
has('youve-been-mimicked', 'mimic', { disguisedCardPlayed: true, targetId: 'a' });
has('free-advertising', 'trailer');
has('biggest-fan', 'enjoyingthetrailer');
has('stay-hydrated', 'dehydrated');
has('complaint-rejected', 'support', { rejected: true });
has('absolutely-nothing', 'nothing');

console.log('38 card achievement evaluator checks passed');
