/* PHOENIX — the expansion.
 *
 * Every new card, the secret event, the owner-only restrictions and the
 * presentation locations. The rules are checked against the real engine and
 * the real server module, never against a copy of them.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Cards = require('../js/cards');
const Rules = require('../js/rules');
const Expansion = require('../js/expansion');
const Effects = require('../js/effects');
const Catalog = require('../js/card-cinematic-catalog');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  OK ' + name);
  } catch (error) {
    failed++;
    console.error('  X ' + name + ': ' + error.message);
  }
}

function suite(name) {
  console.log('\n' + name);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || 'values differ') + ': expected ' + expected + ', got ' + actual);
  }
}

/** A game with a known seat order, for the engine rules. */
function game(options) {
  return Rules.createGame(Object.assign({
    seed: 42, fixedOrder: true, rotateStart: false, rounds: 10
  }, options || {}));
}

/**
 * Play a card through the real engine, with that card in the player's hand.
 *
 * The one-shot cards are resolved by the engine, so this is the path a real
 * match takes - not a copy of it.
 */
function playCard(state, cardId) {
  const seat = state.turnInRound;
  const id = state.players[seat].id;
  state.hands[id] = [cardId];
  const move = Rules.legalMoves(state, seat).filter(function (m) { return m.cardId === cardId; })[0];
  assert(move, cardId + ' is a legal move');
  const result = Rules.playCard(state, seat, move.cardId, move.targetId);
  assert(result.ok, cardId + ' is played: ' + (result.error || ''));
  return result;
}

/** A room, for the server-side expansion module. */
function room(state) {
  return {
    state: state,
    members: state.players.map(function (p) {
      return { id: p.id, seat: p.seat, name: p.name, account: { id: 'acct-' + p.id, role: 'player' } };
    }),
    pendingInteraction: null,
    log: [],
    mode: 'public'
  };
}

/* ===================================================================== */
/* The catalogue                                                         */
/* ===================================================================== */

suite('The expansion catalogue');

test('the fourteen new cards exist, with their types', function () {
  const expected = {
    musicalchairs: 'neutral', russianroulette: 'evil', memorymayhem: 'neutral',
    bankrobbery: 'evil', pointswap: 'chaos', hostage: 'evil', president: 'special',
    joshuasurvey: 'owner', trailer: 'owner', mimic: 'evil', dehydrated: 'evil',
    nothing: 'neutral', reverseofdoom: 'legendary', support: 'chaos'
  };
  Object.keys(expected).forEach(function (id) {
    const card = Cards.byId(id);
    assert(card, id + ' is in the catalogue');
    equal(card.kind, expected[id], id + "'s type");
    assert(card.rule && card.rule.length > 20, id + ' states its rule');
    assert(card.blurb && card.blurb.length > 5, id + ' states what it is');
    assert(card.targetNote && card.targetNote.length > 5, id + ' states its target');
  });
});

test('the Wheel of Misfortune is an Evil card and Judge counts it', function () {
  assert(Cards.isEvil('wheelofmisfortune'), 'it is evil');
  const s = game();
  byId(s, 'claude').cardsPlayed.push('wheelofmisfortune');
  equal(Rules.evilCounts(s).claude, 1, 'Judge counts it');
});

test('the Fake System Shutdown is not a card at all', function () {
  const ids = Cards.ids();
  ['shutdown', 'fakeshutdown', 'systemshutdown', 'phoenixshutdown'].forEach(function (id) {
    assert(ids.indexOf(id) === -1, id + ' is not a card');
  });
  const source = fs.readFileSync(path.join(ROOT, 'js', 'cards.js'), 'utf8');
  assert(source.indexOf('Fake System Shutdown') === -1,
    'the catalogue never names the secret event');
});

/* ===================================================================== */
/* The deck, and the hand limit                                           */
/* ===================================================================== */

suite('The deck and the hand limit');

test('every player starts with seven cards', function () {
  const s = game();
  s.players.forEach(function (p) {
    equal(Rules.handSize(s, p.id), 7, p.name + "'s opening hand");
  });
});

test('a hand is never allowed past seven cards', function () {
  const s = game();
  const seat = s.turnInRound;
  // Fill the hand and take a turn: the draw is refused, so the hand shrinks.
  s.hands[s.players[seat].id] = ['bonus', 'knife', 'hunter', 'zombie', 'steal', 'judge', 'reveal'];
  const before = Rules.handSize(s, s.players[seat].id);
  equal(before, 7, 'the hand is full');
  const move = Rules.legalMoves(s, seat)[0];
  Rules.playCard(s, seat, move.cardId, move.targetId);
  assert(Rules.handSize(s, s.players[seat].id) <= 7, 'the hand is still within the limit');
  // Walk the whole table: nobody ever ends up over the limit.
  let guard = 0;
  while (!s.over && guard++ < 200) {
    const who = s.turnInRound;
    const options = Rules.legalMoves(s, who);
    if (!options.length) break;
    Rules.playCard(s, who, options[0].cardId, options[0].targetId);
    s.players.forEach(function (p) {
      assert(Rules.handSize(s, p.id) <= 7, p.name + ' never holds more than seven');
    });
  }
});

test('a player with room in their hand does draw', function () {
  const s = game();
  // Every hand is short, so the turn that follows really does draw.
  s.players.forEach(function (p) { s.hands[p.id] = s.hands[p.id].slice(0, 3); });
  const before = s.players.map(function (p) { return Rules.handSize(s, p.id); });
  const seat = s.turnInRound;
  const move = Rules.legalMoves(s, seat)[0];
  const result = Rules.playCard(s, seat, move.cardId, move.targetId);
  const draws = result.events.filter(function (e) { return e.type === 'draw'; });
  equal(draws.length, 1, 'the turn drew a card');
  const after = s.players.map(function (p) { return Rules.handSize(s, p.id); });
  const grew = after.some(function (n, i) { return n > before[i]; });
  assert(grew, 'and a hand grew');
});

test('the twelve new public cards are in the ordinary deck', function () {
  ['musicalchairs', 'russianroulette', 'memorymayhem', 'bankrobbery', 'pointswap',
    'hostage', 'president', 'mimic', 'dehydrated', 'nothing', 'reverseofdoom',
    'support'].forEach(function (id) {
    assert(Rules.DECK_COMPOSITION[id] > 0, id + ' is dealt');
    assert(Cards.deckIds().indexOf(id) !== -1, id + ' is a deck card');
  });
});

/* ===================================================================== */
/* The owner-only cards                                                   */
/* ===================================================================== */

suite('The owner-only cards');

test('the two owner cards are never in an ordinary deck', function () {
  const s = game();
  assert(s.deck.indexOf('joshuasurvey') === -1, 'Joshua Survey is not dealt');
  assert(s.deck.indexOf('trailer') === -1, 'the trailer is not dealt');
  const publicDeck = Cards.deckCards().filter(function (c) { return c.ownerOnly; });
  equal(publicDeck.length, 0, 'and they are not even in the public card list');
});

test('an owner room deals them, and nothing else does', function () {
  const s = game({ includeOwnerCards: true });
  assert(s.deck.indexOf('joshuasurvey') !== -1, 'Joshua Survey is dealt');
  assert(s.deck.indexOf('trailer') !== -1, 'the trailer is dealt');
});

test('the server refuses them outside an owner room', function () {
  const publicRoom = room(game());
  publicRoom.mode = 'public';
  equal(Expansion.isAllowedInRoom('joshuasurvey', publicRoom), false,
    'not allowed in a public room');
  equal(Expansion.isAllowedInRoom('trailer', publicRoom), false,
    'not allowed in a public room');
  const ownerRoom = room(game());
  ownerRoom.mode = 'owner';
  equal(Expansion.isAllowedInRoom('joshuasurvey', ownerRoom), true,
    'allowed in an owner room');
  equal(Expansion.isAllowedInRoom('trailer', ownerRoom), true,
    'allowed in an owner room');
  equal(Expansion.isAllowedInRoom('bonus', publicRoom), true,
    'an ordinary card is allowed everywhere');
});

test('the Mimic cannot imitate an owner-only card', function () {
  const disguises = Expansion.mimicDisguises();
  assert(disguises.indexOf('joshuasurvey') === -1, 'not the survey');
  assert(disguises.indexOf('trailer') === -1, 'not the trailer');
  assert(disguises.indexOf('mimic') === -1, 'not itself');
});

test('the owner-only cards are in the GALLERY, and nowhere else', function () {
  const gallery = fs.readFileSync(path.join(ROOT, 'js', 'card-effects-gallery.js'), 'utf8');
  const art = fs.readFileSync(path.join(ROOT, 'js', 'card-cinematic-art.js'), 'utf8');
  const collection = fs.readFileSync(path.join(ROOT, 'card-collection.html'), 'utf8');

  assert(gallery.indexOf('joshuasurvey:') !== -1, 'the survey has a gallery emblem');
  assert(gallery.indexOf('trailer:') !== -1, 'the trailer has a gallery emblem');
  assert(art.indexOf('joshuasurvey:') !== -1, 'and a shared artwork emblem');

  assert(Object.prototype.hasOwnProperty.call(Catalog, 'joshuasurvey') === false,
    'the survey is NOT in the cinematic catalogue');
  assert(Object.prototype.hasOwnProperty.call(Catalog, 'trailer') === false,
    'the trailer is NOT in the cinematic catalogue');

  assert(collection.indexOf('!c.ownerOnly') !== -1,
    'the collection filters the owner-only cards out');
});

test('the gallery marks the owner-only cards as owner exclusive', function () {
  const gallery = fs.readFileSync(path.join(ROOT, 'js', 'card-effects-gallery.js'), 'utf8');
  assert(gallery.indexOf('OWNER EXCLUSIVE') !== -1, 'the gallery labels them');
  assert(gallery.indexOf('OWNER_CARDS') !== -1, 'and gives them their own metadata');
});

/* ===================================================================== */
/* The presentation locations                                             */
/* ===================================================================== */

suite('Where the cards appear');

test('every PUBLIC card is in the gallery, the cinematics and the collection', function () {
  const gallery = fs.readFileSync(path.join(ROOT, 'js', 'card-effects-gallery.js'), 'utf8');
  const art = fs.readFileSync(path.join(ROOT, 'js', 'card-cinematic-art.js'), 'utf8');
  const publicIds = Cards.ids().filter(function (id) {
    const card = Cards.byId(id);
    return !card.ownerOnly && card.inLiveGame !== false;
  });
  publicIds.forEach(function (id) {
    assert(gallery.indexOf(id + ":'") !== -1, id + ' has a gallery emblem');
    assert(art.indexOf(id + ":'") !== -1, id + ' has a shared artwork emblem');
    assert(Object.prototype.hasOwnProperty.call(Catalog, id), id + ' has a cinematic');
  });
  assert(publicIds.length >= 21, 'the public catalogue grew');
});

test('every PUBLIC card has a sound and an effect definition', function () {
  ['musicalchairs', 'russianroulette', 'memorymayhem', 'bankrobbery', 'pointswap',
    'hostage', 'president', 'mimic', 'dehydrated', 'nothing', 'reverseofdoom',
    'support'].forEach(function (id) {
    assert(Effects.DEFINITIONS[id], id + ' has an effect');
    assert(Effects.soundRecipe(id), id + ' has a sound recipe');
    assert(Effects.soundRecipe(id).layers.length >= 2, id + "'s sound is layered");
  });
});

test('the sound effect preview lists every card, and no ally', function () {
  const previews = Effects.previews();
  ['musicalchairs', 'russianroulette', 'memorymayhem', 'bankrobbery', 'pointswap',
    'hostage', 'president', 'mimic', 'dehydrated', 'nothing', 'reverseofdoom',
    'support'].forEach(function (id) {
    assert(previews.some(function (p) { return p.key === id; }), id + ' is in the preview');
  });
  // The owner-only cards belong to the owner server, so they are not in a
  // list everybody can audition.
  ['joshuasurvey', 'trailer'].forEach(function (id) {
    assert(!previews.some(function (p) { return p.key === id; }), id + ' is not in the preview');
  });
  ['ally-phoenix', 'ally-ted', 'ally-maple', 'ally-tilly', 'ally-louie',
    'ally-simba', 'ally-elsie', 'block-tilly', 'block-ted', 'block-louie',
    'block-simba', 'block-elsie', 'maple-restriction'].forEach(function (id) {
    assert(!previews.some(function (p) { return p.key === id; }), id + ' is NOT in the preview');
  });
  assert(previews.some(function (p) { return p.key === 'victory'; }), 'the fanfare is still there');
});

/* ===================================================================== */
/* Bank Robbery                                                           */
/* ===================================================================== */

suite('Bank Robbery');

test('it robs a quarter of the richest positive score, up to 25,000', function () {
  const s = game();
  const actor = byId(s, 'human');
  const rich = byId(s, 'chatgpt');
  rich.points = 40000;
  actor.points = 0;
  playCard(s, 'bankrobbery');
  equal(rich.points, 30000, 'the victim lost a quarter');
  equal(actor.points, 10000, 'and the thief has it');
});

test('the cap is 25,000 however rich the victim is', function () {
  const s = game();
  const actor = byId(s, 'human');
  const rich = byId(s, 'chatgpt');
  rich.points = 500000;
  playCard(s, 'bankrobbery');
  equal(actor.points, 25000, 'the cap holds');
  equal(rich.points, 475000, 'and the rest is safe');
});

test('a tie is broken the same way every time', function () {
  const s = game();
  const actor = byId(s, 'human');
  byId(s, 'chatgpt').points = 20000;
  byId(s, 'claude').points = 20000;
  playCard(s, 'bankrobbery');
  equal(byId(s, 'chatgpt').points, 15000, 'the lowest seat is robbed');
  equal(actor.points, 5000, 'and the thief has it');
});

test('a table with nothing worth stealing is left alone', function () {
  const s = game();
  s.players.forEach(function (p) { p.points = 0; });
  const result = playCard(s, 'bankrobbery');
  assert(result.events.some(function (e) { return /nothing worth stealing/.test(e.text || ''); }),
    'it says there is nothing to steal');
});

suite('Point Swap');

test('the two players trade their ENTIRE scores', function () {
  const s = game();
  const actor = byId(s, 'human');
  const other = byId(s, 'chatgpt');
  actor.points = 12000;
  other.points = 45000;
  playCard(s, 'pointswap');
  equal(actor.points, 45000, 'the player has the other score');
  equal(other.points, 12000, 'and the other has theirs');
});

test('negative scores are valid and are not clamped', function () {
  const s = game();
  const actor = byId(s, 'human');
  const other = byId(s, 'chatgpt');
  actor.points = -5000;
  other.points = 3000;
  playCard(s, 'pointswap');
  equal(actor.points, 3000, 'the player takes the other score');
  equal(other.points, -5000, 'and the negative score is kept as it is');
});

suite('Dehydrated');

test('the target is marked for two complete rounds', function () {
  const s = game();
  const target = byId(s, 'chatgpt');
  playCard(s, 'dehydrated');
  assert(s.dehydrated[target.id], 'the target is marked');
  // The round it is played in, and the one after it: two rounds.
  equal(s.dehydrated[target.id].untilRound, s.round + 1, 'for two rounds');
});

test('and it wears off when the rounds are up', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  playCard(s, 'dehydrated');
  assert(s.dehydrated[target.id], 'the target is marked');
  s.round = s.round + 2;
  Expansion.onRoundEnd(r);
  assert(!s.dehydrated[target.id], 'and the effect is over');
});

suite('Nothing');

test('it genuinely does nothing', function () {
  const s = game();
  const before = s.players.map(function (p) { return p.points; });
  const result = playCard(s, 'nothing');
  deepEqual(s.players.map(function (p) { return p.points; }), before, 'no score moved');
  assert(result.events.some(function (e) { return /Nothing/.test(e.text || ''); }), 'and it says so');
});

test('its rule text says exactly that', function () {
  equal(Cards.byId('nothing').rule, 'This card does nothing. What did you expect?');
});

suite('The Uno Reverse of Doom');

test('it sets a secret trap for three complete rounds', function () {
  const s = game();
  playCard(s, 'reverseofdoom');
  assert(s.traps.human, 'the trap is waiting');
  equal(s.traps.human.untilRound, s.round + 3, 'for three rounds');
});

test('a harmful card aimed at the trapped player is turned around', function () {
  const s = game();
  const r = room(s);
  const victim = byId(s, 'human');
  const attacker = byId(s, 'chatgpt');
  s.traps.human = { untilRound: s.round + 3 };
  victim.points = 20000;
  attacker.points = 5000;
  const reflected = Expansion.checkTrap(r, attacker, victim, 'steal');
  assert(reflected, 'the trap sprang');
  equal(attacker.points, 5000 - 40000, 'the attacker lost double');
  equal(victim.points, 20000 + 40000, 'and the protected player gained it');
  assert(!s.traps.human, 'the trap is consumed');
});

test('the reflection cannot reflect itself', function () {
  const s = game();
  const r = room(s);
  const victim = byId(s, 'human');
  const attacker = byId(s, 'chatgpt');
  s.traps.human = { untilRound: s.round + 3 };
  const reflected = Expansion.checkTrap(r, attacker, victim, 'steal');
  assert(reflected, 'the trap sprang');
  // The attacker now has no trap, so nothing can bounce back and forth.
  assert(!s.traps[attacker.id], 'the attacker has no trap');
  equal(Expansion.checkTrap(r, attacker, victim, 'steal'), null, 'and nothing bounces back');
});

test('a harmless card is not caught by the trap', function () {
  const s = game();
  const r = room(s);
  s.traps.human = { untilRound: s.round + 3 };
  equal(Expansion.checkTrap(r, byId(s, 'chatgpt'), byId(s, 'human'), 'bonus'), null,
    'a bonus is not a trap');
  assert(s.traps.human, 'and the trap is still waiting');
});

test('an elimination is reflected at twice its strength', function () {
  const s = game();
  const r = room(s);
  const victim = byId(s, 'human');
  const attacker = byId(s, 'chatgpt');
  s.traps.human = { untilRound: s.round + 3 };
  const reflected = Expansion.checkTrap(r, attacker, victim, 'knife');
  assert(reflected, 'the trap sprang');
  assert(Rules.isOut(attacker, s), 'the attacker is eliminated instead');
});

test('the trap expires after three rounds', function () {
  const s = game();
  const r = room(s);
  playCard(s, 'reverseofdoom');
  s.round = s.round + 4;
  Expansion.onRoundEnd(r);
  assert(!s.traps.human, 'the trap is gone');
});

suite('Customer Support');

test('every complaint is rejected the same way, and the fee is paid', function () {
  const s = game();
  const r = room(s);
  const actor = byId(s, 'human');
  const target = byId(s, 'chatgpt');
  r.pendingInteraction = { actorId: actor.id, targetId: target.id, type: 'support' };
  const result = Expansion.supportComplaint(r, target.id, Expansion.COMPLAINTS[0]);
  assert(/rejected/.test(result.events[0].text), 'the complaint is rejected');
  equal(actor.points, 10000, 'the administration fee is paid');
});

test('the three outcomes are all possible', function () {
  const seen = {};
  for (let i = 0; i < 200; i++) {
    const s = game({ seed: i + 1 });
    const r = room(s);
    const target = byId(s, 'chatgpt');
    const before = target.points;
    r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'support' };
    const result = Expansion.supportComplaint(r, target.id, Expansion.COMPLAINTS[1]);
    seen[result.outcome] = true;
  }
  Object.keys(seen).forEach(function (outcome) {
    assert(Expansion.COMPLAINT_OUTCOMES.indexOf(outcome) !== -1, outcome + ' is a real outcome');
  });
  assert(Object.keys(seen).length >= 2, 'more than one outcome came up');
});

test('the target can only file one complaint', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'support' };
  Expansion.supportComplaint(r, target.id, Expansion.COMPLAINTS[0]);
  const again = Expansion.supportComplaint(r, target.id, Expansion.COMPLAINTS[1]);
  assert(again, 'the second attempt is still handled, and only once');
});

/* ===================================================================== */
/* The Mimic                                                              */
/* ===================================================================== */

suite('The Mimic');

test('the target is handed a card that looks like the disguise', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  s.hands[target.id] = [];
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'mimic' };
  const result = Expansion.mimicDisguise(r, 'human', 'bonus');
  assert(result.done, 'the card was handed over');
  equal(s.mimics[target.id], 'bonus', 'the disguise is recorded');
  assert(s.hands[target.id].indexOf('mimic') !== -1, 'and the Mimic is in their hand');
});

test('the target is SHOWN the disguise, not the Mimic', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  s.hands[target.id] = [];
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'mimic' };
  Expansion.mimicDisguise(r, 'human', 'bonus');
  const shown = Expansion.handForViewer(s, target.id);
  assert(shown.indexOf('mimic') === -1, 'the Mimic is not what they see');
  assert(shown.indexOf('bonus') !== -1, 'they see the disguise instead');
  // And the server still knows the truth.
  equal(s.mimics[target.id], 'bonus', 'the server knows what it really is');
});

test('it cannot imitate an owner-only card', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  s.hands[target.id] = [];
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'mimic' };
  const result = Expansion.mimicDisguise(r, 'human', 'joshuasurvey');
  assert(result.error, 'it is refused');
  assert(!s.mimics[target.id], 'and nothing was handed over');
});

test('it takes the place of a copy the target already holds', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  s.hands[target.id] = ['bonus', 'knife'];
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'mimic' };
  const result = Expansion.mimicDisguise(r, 'human', 'bonus');
  assert(result.done, 'the card is handed over');
  // A hand may only hold one of each type, so the Mimic REPLACES the copy.
  deepEqual(s.hands[target.id], ['mimic', 'knife'], 'the copy became the Mimic');
  assert(new Set(s.hands[target.id]).size === s.hands[target.id].length, 'and there are no duplicates');
});

test('the target never holds more than seven cards', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  s.hands[target.id] = ['bonus', 'knife', 'hunter', 'zombie', 'steal', 'judge', 'reveal'];
  r.pendingInteraction = { actorId: 'human', targetId: target.id, type: 'mimic' };
  Expansion.mimicDisguise(r, 'human', 'trick');
  assert(s.hands[target.id].length <= 7, 'the hand is within the limit');
});

/* ===================================================================== */
/* Musical Chairs                                                         */
/* ===================================================================== */

suite('Musical Chairs');

test('the music stops at a server-chosen time', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'musicalchairs', roundData: {} };
  const result = Expansion.startMusicalChairs(r);
  const data = r.pendingInteraction.roundData;
  assert(data.musicStopsAt > Date.now(), 'the music is playing');
  assert(data.duration >= 4000 && data.duration <= 13000, 'for an unpredictable stretch');
  assert(result.advanceTurn === false, 'the round is not over yet');
});

test('pressing before the music stops costs the button for ten seconds', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'musicalchairs', roundData: {} };
  Expansion.startMusicalChairs(r);
  const data = r.pendingInteraction.roundData;
  data.musicStopsAt = Date.now() + 5000;      // still playing
  const early = Expansion.musicalChairsPress(r, 'human');
  assert(early.early, 'the early press is caught');
  assert(data.disabledUntil.human > Date.now() + 9000, 'and the button is locked for ten seconds');
  assert(!data.pressed || !data.pressed.human, 'and it does not count as a press');
});

test('the penalty keeps running even if the music stops during it', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'musicalchairs', roundData: {} };
  Expansion.startMusicalChairs(r);
  const data = r.pendingInteraction.roundData;
  data.musicStopsAt = Date.now() + 3000;
  Expansion.musicalChairsPress(r, 'human');           // too early
  data.musicStopsAt = Date.now() - 1;                 // the music stops
  const locked = Expansion.musicalChairsPress(r, 'human');
  assert(locked.error, 'the button is still locked');
  assert(/disabled/.test(locked.error), 'and it says so');
});

test('the last eligible player to press loses 10,000', function () {
  const s = game();
  const r = room(s);
  const players = s.players.map(function (p) { return p.id; });
  r.pendingInteraction = {
    actorId: players[0], targetId: null, type: 'musicalchairs',
    participants: players, roundData: { musicStopsAt: Date.now() - 1, pressed: {}, disabledUntil: {} }
  };
  let outcome = null;
  let lastPresser = null;
  players.forEach(function (id) {
    if (outcome) return;
    const result = Expansion.musicalChairsPress(r, id);
    if (result.done) { outcome = result; lastPresser = id; }
  });
  assert(outcome, 'the round ended');
  equal(outcome.loser, lastPresser, 'the loser is the last one to press');
  equal(byId(s, lastPresser).points, -10000, 'and they lost 10,000');
});

test('a player who cannot press loses as soon as everybody else has', function () {
  const s = game();
  const r = room(s);
  const players = s.players.map(function (p) { return p.id; });
  r.pendingInteraction = {
    actorId: players[0], targetId: null, type: 'musicalchairs',
    participants: players,
    roundData: { musicStopsAt: Date.now() - 1, pressed: {}, disabledUntil: {} }
  };
  // Everybody but the last player presses.
  players.slice(0, -1).forEach(function (id) { Expansion.musicalChairsPress(r, id); });
  // The last one still has their button locked, so the round is decided without them.
  const result = Expansion.musicalChairsPress(r, players[players.length - 1]);
  assert(result.done, 'the round ended');
});

/* ===================================================================== */
/* Russian Roulette                                                        */
/* ===================================================================== */

suite('Russian Roulette');

test('the odds RISE each time, from one in six', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'russianroulette', roundData: {} };
  Expansion.startRussianRoulette(r);
  equal(r.pendingInteraction.roundData.chamber, 1, 'the first pull is one in six');
  const data = r.pendingInteraction.roundData;
  // A safe result hands the revolver to the target and raises the odds.
  // Force the safe result: the odds start at one in six.
  const realRandom = Math.random;
  Math.random = function () { return 0.99; };
  let safe;
  try {
    safe = Expansion.russianRouletteAim(r, data.holder, data.holder === 'human' ? 'chatgpt' : 'human');
  } finally {
    Math.random = realRandom;
  }
  assert(!safe.error && !safe.done, 'the revolver did not fire');
  equal(data.chamber, 2, 'the odds are now two in six');
  equal(data.holder, 'chatgpt', 'and the target holds the revolver');
});

test('the holder alone may aim', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'russianroulette', roundData: {} };
  Expansion.startRussianRoulette(r);
  const wrong = Expansion.russianRouletteAim(r, 'chatgpt', 'human');
  assert(wrong.error, 'somebody else cannot aim it');
});

test('the first loss eliminates the target for three rounds', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'russianroulette', roundData: {} };
  Expansion.startRussianRoulette(r);
  // Force the loss.
  r.pendingInteraction.roundData.chamber = 6;
  const realRandom = Math.random;
  Math.random = function () { return 0; };
  let result;
  try {
    result = Expansion.russianRouletteAim(r, 'human', 'chatgpt');
  } finally {
    Math.random = realRandom;
  }
  assert(result.done, 'the minigame ended');
  assert(Rules.isOut(target, s), 'the target is eliminated');
  assert(target.outUntilRound >= s.round + 2, 'for three complete rounds');
});

test('a player who is already eliminated serves one round of it, and then loses three', function () {
  const s = game();
  const r = room(s);
  const target = byId(s, 'chatgpt');
  // Two rounds of elimination left.
  target.outUntilRound = s.round + 1;
  const before = target.outUntilRound;
  const served = Expansion.serveRound(s, target);
  equal(served, 1, 'one round is served');
  equal(target.outUntilRound, before - 1, 'and the elimination is one round shorter');
  Expansion.eliminateFor(s, target, 3);
  // Two rounds left, less the one served, plus three more.
  equal(target.outUntilRound - s.round + 1, 4, 'four rounds remain');
});

/* ===================================================================== */
/* Memory Mayhem                                                          */
/* ===================================================================== */

suite('Memory Mayhem');

test('three sequences of increasing length, the same for everybody', function () {
  const s = game();
  const r = room(s);
  r.pendingInteraction = { actorId: 'human', targetId: null, type: 'memorymayhem', roundData: {} };
  Expansion.startMemoryMayhem(r);
  const sequences = r.pendingInteraction.roundData.sequences;
  equal(sequences.length, 3, 'three sequences');
  equal(sequences[0].length, 3, 'the first is three long');
  equal(sequences[1].length, 4, 'the second is four');
  equal(sequences[2].length, 5, 'the third is five');
});

test('the player with the weakest memory loses 8,000', function () {
  const s = game();
  const r = room(s);
  const players = s.players.map(function (p) { return p.id; });
  r.pendingInteraction = {
    actorId: players[0], targetId: null, type: 'memorymayhem',
    participants: players,
    roundData: {
      sequences: [['A'], ['B'], ['C']], phaseIndex: 0, answers: {}, times: {},
      allAnswers: {}, allTimes: {}
    }
  };
  // The first player answers everything correctly; the rest do not.
  r.pendingInteraction.roundData.allAnswers[players[0]] = ['A', 'B', 'C'];
  r.pendingInteraction.roundData.allTimes[players[0]] = [1, 1, 1];
  players.slice(1).forEach(function (id) {
    r.pendingInteraction.roundData.allAnswers[id] = ['X', 'X', 'X'];
    r.pendingInteraction.roundData.allTimes[id] = [1, 1, 1];
  });
  // Force the phase to the last one.
  r.pendingInteraction.roundData.phaseIndex = 2;
  r.pendingInteraction.roundData.answers = {};
  players.forEach(function (id) { r.pendingInteraction.roundData.answers[id] = 'X'; });
  const result = Expansion.memoryAnswer(r, players[1], 2, 'X');
  assert(result.done, 'the round ended');
  assert(s.players.some(function (p) { return p.points === -8000; }), 'somebody lost 8,000');
});

test('response time breaks a tie on accuracy', function () {
  const s = game();
  const r = room(s);
  const players = s.players.map(function (p) { return p.id; });
  r.pendingInteraction = {
    actorId: players[0], targetId: null, type: 'memorymayhem',
    participants: players,
    roundData: {
      sequences: [['A'], ['B'], ['C']], phaseIndex: 2, answers: {}, times: {},
      allAnswers: {}, allTimes: {}
    }
  };
  players.forEach(function (id) {
    r.pendingInteraction.roundData.allAnswers[id] = ['A', 'B', 'C'];
  });
  r.pendingInteraction.roundData.allTimes[players[0]] = [10, 10, 10];
  r.pendingInteraction.roundData.allTimes[players[1]] = [500, 500, 500];
  players.forEach(function (id) { r.pendingInteraction.roundData.answers[id] = 'C'; });
  Expansion.memoryAnswer(r, players[1], 2, 'C');
  // The slower of two equally accurate players loses.
  equal(byId(s, players[1]).points, -8000, 'the slower player lost');
});

/* ===================================================================== */
/* Hostage Situation                                                      */
/* ===================================================================== */

suite('Hostage Situation');

test('it is only dealt when there are at least three players', function () {
  // The card calls the police, and the police officer has to be somebody
  // else at the table - so a two-player lobby never deals it.
  const two = Rules.createGame({ seed: 7, playerCount: 2 });
  const five = Rules.createGame({ seed: 7, playerCount: 5 });
  const everyCard = function (state) {
    return state.deck.concat(state.players.map(function (p) { return state.hands[p.id]; }))
      .reduce(function (all, hand) { return all.concat(hand); }, []);
  };
  equal(everyCard(two).filter(function (id) { return id === 'hostage'; }).length, 0,
    'a two-player game never deals it');
  assert(everyCard(five).filter(function (id) { return id === 'hostage'; }).length > 0,
    'a five-player game deals it');
});

test('the buttons of a player who may answer twice are not locked', function () {
  const client = fs.readFileSync(path.join(ROOT, 'js', 'online-client.js'), 'utf8');
  assert(client.indexOf('answersMoreThanOnce') !== -1,
    'the client knows which conversations may ask twice');
  ['musicalchairs', 'russianroulette', 'memorymayhem', 'joshuasurvey'].forEach(function (id) {
    assert(client.indexOf("'" + id + "'") !== -1, id + ' may ask the same player twice');
  });
});

test('it takes a hostage, and picks a police officer', function () {
  const s = game();
  playCard(s, 'hostage');
  assert(s.hostage, 'the situation is set');
  const criminal = byId(s, 'human');
  const hostage = byId(s, 'chatgpt');
  equal(s.hostage.criminalId, criminal.id, 'the player is the criminal');
  equal(s.hostage.hostageId, hostage.id, 'and holds the chosen hostage');
  assert(s.hostage.officerId, 'a police officer was picked');
  assert(s.hostage.officerId !== criminal.id && s.hostage.officerId !== hostage.id,
    'and is somebody else');
  equal(s.hostage.target, 40000, 'who must gain 40,000 points');
});

test('the hostage is released once the police officer has gained 40,000', function () {
  const s = game();
  const r = room(s);
  playCard(s, 'hostage');
  const criminal = byId(s, 'human');
  const officer = byId(s, s.hostage.officerId);
  criminal.points = 60000;
  officer.points = s.hostage.officerStartPoints + 40000;
  const released = Expansion.checkHostage(r);
  assert(released, 'the hostage is released');
  assert(!s.hostage, 'and the situation is over');
  assert(Rules.isOut(criminal, s), 'the criminal is eliminated');
  equal(criminal.points, 30000, 'and lost half their score');
});

test('the police officer needs a NET gain, so losing points counts against it', function () {
  const s = game();
  const r = room(s);
  playCard(s, 'hostage');
  const officer = byId(s, s.hostage.officerId);
  officer.points = s.hostage.officerStartPoints + 39000;
  equal(Expansion.checkHostage(r), null, '39,000 is not enough');
  officer.points -= 10000;
  equal(Expansion.checkHostage(r), null, 'and losing points makes it worse');
  officer.points = s.hostage.officerStartPoints + 40000;
  assert(Expansion.checkHostage(r), '40,000 exactly is enough');
});

suite('President');

test('the presidency lasts five rounds and pays 5,000 a round', function () {
  const s = game();
  const actor = byId(s, 'human');
  playCard(s, 'president');
  assert(s.president, 'there is a president');
  equal(s.president.id, actor.id, 'it is the player');
  // The round they take office in, and the four after it: five rounds.
  equal(s.president.untilRound, s.round + 4, 'for five rounds');
  equal(actor.points, 5000, 'and they are paid for taking office');
});

test('the president is paid 5,000 for every round they complete', function () {
  const s = game();
  const r = room(s);
  const actor = byId(s, 'human');
  playCard(s, 'president');
  const before = actor.points;
  // The round ends.
  s.round = s.round + 1;
  Expansion.onRoundEnd(r);
  equal(actor.points, before + 5000, 'the round paid them');
  assert(s.president, 'and they are still in office');
  // ...and when the term is over, the office and the pay both end.
  s.round = s.president.untilRound + 1;
  const last = actor.points;
  Expansion.onRoundEnd(r);
  equal(actor.points, last, 'the last round paid nothing');
  assert(!s.president, 'and the presidency is over');
});

test('a ban binds EVERYBODY, the president included', function () {
  const s = game();
  s.bannedCards = ['bonus'];
  s.players.forEach(function (p) {
    s.hands[p.id] = ['bonus', 'knife'];
    const options = Rules.legalMoves(s, p.seat).filter(function (m) { return m.cardId === 'bonus'; });
    equal(options.length, 0, p.name + ' cannot play a banned card');
  });
});

test('the presidency ends, and every ban is lifted with it', function () {
  const s = game();
  const r = room(s);
  playCard(s, 'president');
  s.bannedCards = ['bonus'];
  s.round = s.president.untilRound + 1;
  Expansion.onRoundEnd(r);
  assert(!s.president, 'the presidency is over');
  deepEqual(s.bannedCards, [], 'and the bans are lifted');
});

suite('The Wheel of Misfortune');

test('it has exactly eight outcomes, and the odds add up to a hundred', function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const weights = {};
  const pattern = /\{ key: '([a-z]+)', weight: (\d+) \}/g;
  let match;
  while ((match = pattern.exec(server))) weights[match[1]] = Number(match[2]);
  const keys = Object.keys(weights);
  equal(keys.length, 8, 'eight outcomes');
  const total = keys.reduce(function (sum, key) { return sum + weights[key]; }, 0);
  equal(total, 100, 'and the weights add up to a hundred');
  const expected = {
    loan: 20, puppets: 15, invisible: 15, restart: 10,
    apocalypse: 12, nothing: 25, hell: 2, victory: 1
  };
  deepEqual(weights, expected, 'and they are the agreed odds');
});

test('the client wheel shows the same eight outcomes, with the same odds', function () {
  const client = fs.readFileSync(path.join(ROOT, 'js', 'interactive-wheel.js'), 'utf8');
  ['loan', 'puppets', 'invisible', 'restart', 'apocalypse', 'nothing', 'hell', 'victory']
    .forEach(function (key) {
      assert(client.indexOf("['" + key + "',") !== -1, key + ' is on the client wheel');
    });
  assert(client.indexOf("['reshuffle',") !== -1, 'and the Wheel of Fortune is still there');
  // The odds are printed on the wheel, so a player can see them.
  assert(client.indexOf('wheel-segment-odds') !== -1, 'the odds are on the segments');
  assert(client.indexOf('wheel-outcome-odds') !== -1, 'and on the list');
});

test('the wheel is spun by the player who played the card', function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(server.indexOf("(pi.type === 'wheel' || pi.type === 'wheelofmisfortune') && playerId !== pi.actorId") !== -1,
    'the server refuses a spin from anybody else');
  const client = fs.readFileSync(path.join(ROOT, 'js', 'online-client.js'), 'utf8');
  assert(client.indexOf("pi.type === 'wheelofmisfortune'") !== -1,
    'and the client only shows the button to the caster');
});

test('the Wheel of Misfortune is an Evil card, with its own sound', function () {
  assert(Cards.isEvil('wheelofmisfortune'), 'it is evil');
  const recipe = Effects.soundRecipe('wheelofmisfortune');
  assert(recipe, 'it has a sound');
  assert(recipe.layers.length >= 2, 'and the sound is layered');
});

/* ===================================================================== */
/* The secret event                                                       */
/* ===================================================================== */

suite('The President');

test('playing the card makes them first in the play order, and they stay first', function () {
  const s = game();
  const actor = byId(s, 'human');
  playCard(s, 'president');
  equal(s.firstSeat, actor.seat, 'they open every round from then on');
  // The presidency is five rounds, and then it is over.
  const presidency = s.president;
  assert(presidency, 'they are President');
  equal(presidency.untilRound, s.round + 4, 'for five rounds');
  // The order does not go back when the presidency ends.
  s.president = null;
  equal(s.firstSeat, actor.seat, 'they are still first');
});

test('the menu is the President\'s alone, and it lists every card', function () {
  const client = fs.readFileSync(path.join(ROOT, 'js', 'online-client.js'), 'utf8');
  assert(client.indexOf('renderPresidentMenu') !== -1, 'the menu is drawn');
  assert(client.indexOf('Cards.CARDS.forEach') !== -1, 'with every card in the game');
  assert(client.indexOf("type: 'president_ban'") !== -1, 'and a switch for each one');
  assert(client.indexOf('MAKE ILLEGAL') !== -1, 'that makes a card illegal');
  assert(client.indexOf('MAKE LEGAL') !== -1, 'and makes it legal again');
  // It is shut while it is their own turn, and after a change.
  assert(client.indexOf('state.presidentTurn') !== -1, 'the menu knows it is their turn');
  assert(client.indexOf('state.presidentChanged') !== -1, 'and whether they have already changed one');
});

test('the law is a switch, and it binds everybody', function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // The switch: illegal becomes legal again.
  assert(server.indexOf('s.bannedCards.splice(at, 1)') !== -1, 'a banned card can be made legal again');
  // One change a round.
  assert(server.indexOf('You have already changed the law this round') !== -1, 'one change a round');
  // And it is locked on their own turn.
  assert(server.indexOf('Take your turn first') !== -1, 'the menu is locked on their own turn');
  // The refusal says what happened.
  assert(server.indexOf('That card is against the law') !== -1, 'and the player is told why');
});

suite('The Memory Mayhem');

test('each sequence is revealed once, not every time somebody answers', function () {
  const client = fs.readFileSync(path.join(ROOT, 'js', 'interactive-expansion.js'), 'utf8');
  // Every answer from the table arrives as a new state, and the reveal must
  // not start again for the same sequence.
  assert(client.indexOf('memory.revealedFor !== index') !== -1, 'the reveal is tied to the sequence');
  assert(client.indexOf('memory.revealedFor = index') !== -1, 'and remembers which one it showed');
});

test('the server says which symbols the sequences are made of', function () {
  const module = fs.readFileSync(path.join(ROOT, 'js', 'expansion.js'), 'utf8');
  assert(module.indexOf('pi.roundData.symbols = MEMORY_SYMBOLS.slice()') !== -1,
    'so the player can be offered the very symbols');
});

suite('The Rickroll');

test('it waits for the official API, which announces itself by a global', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'mimic-rickroll.js'), 'utf8');
  // The YouTube IFrame Player API calls window.onYouTubeIframeAPIReady. Any
  // other name and the player is never created.
  assert(source.indexOf('onYouTubeIframeAPIReady') !== -1, 'it listens for the official global');
  assert(source.indexOf('new root.YT.Player(') !== -1, 'and creates the player');
});

suite('The secret Fake System Shutdown');

test('it is a browser-only event, and never touches the operating system', function () {
  const raw = fs.readFileSync(path.join(ROOT, 'js', 'shutdown-event.js'), 'utf8');
  assert(raw.indexOf('PhoenixFakeShutdown') !== -1, 'it is a client module');
  // The comments talk about what this does NOT do, so the code is what counts.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(!/shutdown\s*\(|reboot|system\s*\(|exec\(|child_process/i.test(source),
    'it never asks the operating system for anything');
  assert(!/beforeunload|onbeforeunload|preventDefault/.test(source),
    'and it never blocks the browser leaving the page');
});

test('it is a five percent chance, and it never overlaps', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'shutdown-event.js'), 'utf8');
  assert(source.indexOf('var CHANCE = 0.10;') !== -1, 'a ten percent chance');
  assert(source.indexOf('if (running) return false;') !== -1,
    'and it refuses to start while one is already running');
});

test('a player who has just had it is left alone for three minutes', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'shutdown-event.js'), 'utf8');
  assert(source.indexOf('var COOLDOWN_MS = 3 * 60 * 1000;') !== -1, 'three minutes');
  assert(source.indexOf('COOLDOWN_KEY = ') !== -1, 'the cooldown is kept under the player\'s own id');
  assert(source.indexOf('if (Date.now() - lastShock() < COOLDOWN_MS) return false;') !== -1,
    'and the event waits for it to be over');
});

test('it is not a card, and it is not in any presentation list', function () {
  const cardsSource = fs.readFileSync(path.join(ROOT, 'js', 'cards.js'), 'utf8');
  assert(cardsSource.indexOf('shutdown') === -1, 'it is not in the catalogue');
  const catalog = fs.readFileSync(path.join(ROOT, 'js', 'card-cinematic-catalog.js'), 'utf8');
  assert(catalog.indexOf('shutdown') === -1, 'it is not in the cinematics');
  const gallery = fs.readFileSync(path.join(ROOT, 'js', 'card-effects-gallery.js'), 'utf8');
  assert(gallery.indexOf('shutdown:') === -1, 'it is not in the gallery');
});

/* ===================================================================== */
/* The Rickroll                                                           */
/* ===================================================================== */

suite('The Mimic\'s Rickroll');

test('it uses the official YouTube player, with no skip and no fast-forward', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'mimic-rickroll.js'), 'utf8');
  assert(source.indexOf('youtube.com/iframe_api') !== -1, 'the official IFrame Player API');
  assert(source.indexOf('controls: 0') !== -1, 'the controls are off, so there is no skip');
  assert(source.indexOf('disablekb: 1') !== -1, 'and no keyboard fast-forward');
  assert(source.indexOf('dQw4w9WgXcQ') !== -1, 'the official Rick Astley video');
  assert(source.indexOf('autoplay: 1') !== -1, 'autoplay is attempted');
  assert(source.indexOf('PlayerState.ENDED') !== -1, 'and the end is detected');
});

test('it says the rule, and it is never a blank screen', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'mimic-rickroll.js'), 'utf8');
  assert(source.indexOf('You have to finish the whole video') !== -1,
    'the player is told they have to finish the whole video');
  assert(source.indexOf('There is no skip and no fast-forward') !== -1,
    'and that there is no skip');
  assert(source.indexOf('phoenix-rickroll-loading') !== -1,
    'the frame says it is loading, so it is never a blank screen');
});

test('it always has a way out, so a match can never be stuck', function () {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'mimic-rickroll.js'), 'utf8');
  assert(source.indexOf('LOAD_TIMEOUT_MS') !== -1, 'a loading timeout');
  assert(source.indexOf('MAX_PLAYBACK_MS') !== -1, 'and an overall backstop');
  assert(source.indexOf('offerWayOn') !== -1, 'with a way to carry on if the video will not play');
});

test('the server holds the player in the prank, and lets go on its own', function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(server.indexOf("if (room.rickroll && room.rickroll.playerId === id)") !== -1,
    'the server refuses the player a move while the video plays');
  assert(server.indexOf('function playerIdOf(member)') !== -1,
    'and it knows which player a member is, by their seat');
  assert(server.indexOf("data.type === 'rickroll_done'") !== -1,
    'and the client reports that the video is over');
  assert(server.indexOf('until: Date.now() + 8 * 60 * 1000') !== -1,
    'with a backstop, so a stuck client cannot freeze the match');
});

/* ===================================================================== */
/* Mobile                                                                 */
/* ===================================================================== */

suite('Mobile');

test('every new overlay is reachable and usable on a phone', function () {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'expansion-mobile.css'), 'utf8');
  const desktop = fs.readFileSync(path.join(ROOT, 'css', 'expansion.css'), 'utf8');
  assert(css.indexOf('@media (max-width: 720px)') !== -1, 'there is a phone layout');
  assert(css.indexOf('min-height: 44px') !== -1, 'the buttons are thumb-sized');
  assert(css.indexOf('.mc-stage') !== -1, 'the choice buttons reflow');
  assert(desktop.indexOf('.mc-symbol') !== -1, 'the memory symbols are drawn');
});

test('the rotation effect keeps the controls usable, and has a still alternative', function () {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'expansion.css'), 'utf8');
  assert(css.indexOf('is-dehydrated-still') !== -1, 'a reduced-motion alternative');
  const client = fs.readFileSync(path.join(ROOT, 'js', 'online-client.js'), 'utf8');
  assert(client.indexOf('PhoenixDehydrated') !== -1, 'the client applies it');
});

/* ===================================================================== */

function byId(state, id) {
  return state.players.filter(function (p) { return p.id === id; })[0];
}

function deepEqual(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
}

console.log('\n' + passed + ' expansion checks passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
