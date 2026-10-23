/* PHOENIX — Single Player deck.
 *
 * Single Player is the creator's local mode: one human seat, four AI seats
 * played through the manual copy-and-paste relay. A handful of cards only mean
 * something with a living person on the other end — The Mimic's unskippable
 * Rick Astley video, the two website challenges and the two live minigames —
 * so they carry the `humanOnly` flag and are dealt in MULTIPLAYER ONLY.
 *
 * These tests hold that line from both sides:
 *   - the multiplayer deck is exactly what it always was (Mimic included);
 *   - a Single Player game never contains a human-only card, not in the deck,
 *     not in a hand, not in the discard, and not in the AI prompt;
 *   - the relay and the click path refuse one if a corrupted state ever hands
 *     one over.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const Cards = require('../js/cards');
const Rules = require('../js/rules');
const Prompt = require('../js/prompt');
const GameApi = require('../js/game');

/** Every card the flag applies to. Adding one here is a deliberate decision. */
const HUMAN_ONLY = [
  'mimic',               // the punchline is an unskippable video
  'phoenixtube',         // ten minutes of video-watching on a website
  'definitelynotamazon', // a five-minute live shopping challenge
  'musicalchairs',       // a table-wide reaction game
  'memorymayhem'         // a table-wide memory test
];

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

/** A game with a known seat order. `singlePlayer` mirrors the real menu. */
function game(options) {
  return Rules.createGame(Object.assign({
    seed: 42, fixedOrder: true, rotateStart: false, rounds: 10
  }, options || {}));
}

/** Every card in play: draw pile, discard and every hand. */
function allCards(state) {
  const held = state.players.reduce(function (ids, player) {
    return ids.concat(state.hands[player.id]);
  }, []);
  return state.deck.concat(state.discard, held);
}

/** The copies of the flagged cards that the multiplayer deck carries. */
const FLAGGED_COPIES = HUMAN_ONLY.reduce(function (n, id) {
  return n + Rules.DECK_COMPOSITION[id];
}, 0);

/* ===================================================================== */
/* The flag, and the catalogue                                           */
/* ===================================================================== */

suite('The humanOnly flag');

test('the five human-only cards are flagged, and nothing else is', function () {
  HUMAN_ONLY.forEach(function (id) {
    const card = Cards.byId(id);
    assert(card, id + ' is in the catalogue');
    equal(card.humanOnly, true, id + ' carries the humanOnly flag');
  });
  const flagged = Cards.CARDS.filter(function (c) { return c.humanOnly; })
    .map(function (c) { return c.id; }).sort();
  equal(flagged.join(','), HUMAN_ONLY.slice().sort().join(','),
    'exactly those five cards carry the flag');
});

test('the flag does not touch the multiplayer card list', function () {
  HUMAN_ONLY.forEach(function (id) {
    assert(Cards.deckIds().indexOf(id) !== -1, id + ' is still a multiplayer deck card');
    assert(Cards.deckCards().some(function (c) { return c.id === id; }),
      id + ' is still listed by deckCards()');
    assert(Rules.DECK_COMPOSITION[id] > 0, id + ' still has copies in the composition');
  });
});

test('the multiplayer server never asks for a Single Player deck', function () {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(!/singlePlayer/.test(server),
    'server.js never sets singlePlayer, so every room it makes is a multiplayer deck');
  const client = fs.readFileSync(path.join(ROOT, 'js', 'online-client.js'), 'utf8');
  assert(!/singlePlayer/.test(client),
    'the multiplayer client never sends singlePlayer either');
});

/* ===================================================================== */
/* The two decks                                                         */
/* ===================================================================== */

suite('The two decks');

test('a multiplayer game deals The Mimic and every other human-only card', function () {
  const s = game();
  const pool = allCards(s);
  equal(s.singlePlayer, false, 'the ordinary game is not marked Single Player');
  HUMAN_ONLY.forEach(function (id) {
    const copies = pool.filter(function (c) { return c === id; }).length;
    equal(copies, Rules.DECK_COMPOSITION[id],
      'all ' + Rules.DECK_COMPOSITION[id] + ' copies of ' + id + ' were dealt');
  });
});

test('a Single Player game never deals a human-only card', function () {
  const s = game({ singlePlayer: true });
  const pool = allCards(s);
  equal(s.singlePlayer, true, 'the game knows it is a Single Player match');
  HUMAN_ONLY.forEach(function (id) {
    assert(pool.indexOf(id) === -1, id + ' is not in a Single Player match at all');
  });
});

test('a Single Player deck is smaller by exactly the human-only copies', function () {
  const s = game({ singlePlayer: true });
  equal(Rules.deckSize(s), Rules.deckSize() - FLAGGED_COPIES,
    'deckSize(state) is the Single Player total');
  equal(Rules.deckSize(), Rules.deckSize(null),
    'with no state it is still the full multiplayer total');
  equal(allCards(s).length, Rules.deckSize(s),
    'and the deal is exactly that size - no card was created or lost');
});

test('everything else in the expansion is still dealt in Single Player', function () {
  const pool = allCards(game({ singlePlayer: true }));
  ['bankrobbery', 'pointswap', 'russianroulette', 'hostage', 'president',
    'dehydrated', 'nothing', 'reverseofdoom', 'support', 'dice', 'rps',
    'betrayal', 'speed', 'wheel', 'linkedfate', 'impostor', 'swapper',
    'wheelofmisfortune'].forEach(function (id) {
    assert(pool.indexOf(id) !== -1, id + ' is still dealt in Single Player');
  });
});

test('the owner-only cards stay out of both decks', function () {
  Rules.OWNER_CARD_IDS.forEach(function (id) {
    assert(allCards(game()).indexOf(id) === -1, id + ' is not in a multiplayer game');
    assert(allCards(game({ singlePlayer: true })).indexOf(id) === -1,
      id + ' is not in a Single Player game');
  });
});

/* ===================================================================== */
/* A whole match                                                         */
/* ===================================================================== */

suite('A whole Single Player match');

test('a full Single Player match never sees a human-only card, and stays conserved', function () {
  const s = game({ singlePlayer: true, rounds: 3 });
  const expected = Rules.deckSize(s);
  // A forced choice is only answerable when its moment arrives: an Alvin burn
  // straight away, a Steal a Turn when the table reaches its target.
  function choiceDue() {
    const pending = s.pendingChoice;
    if (!pending) return false;
    if (pending.kind === Rules.PENDING_CHOICE_KINDS.BURN) return true;
    return s.players[s.turnInRound].id === pending.targetId;
  }
  function checkNothingSmuggledIn(when) {
    const pool = allCards(s);
    HUMAN_ONLY.forEach(function (id) {
      assert(pool.indexOf(id) === -1, id + ' never enters the match ' + when);
    });
    equal(pool.length, expected, 'every card is still accounted for ' + when);
  }
  let guard = 0;
  while (!s.over && guard++ < 300) {
    // A forced choice - Steal a Turn, Alvin - has to be answered before the
    // table can move on, in exactly the order a real match takes.
    if (choiceDue()) {
      const pick = Rules.pendingChoiceOptions(s).options[0];
      assert(pick, 'a pending choice always offers at least one card');
      const choice = Rules.resolvePendingChoice(s, pick.cardId, pick.targetId);
      assert(choice.ok, 'a forced choice resolves: ' + (choice.error || ''));
      checkNothingSmuggledIn('through a forced choice');
      continue;
    }
    const seat = s.turnInRound;
    const move = Rules.legalMoves(s, seat)[0];
    if (!move) break;
    assert(HUMAN_ONLY.indexOf(move.cardId) === -1,
      move.cardId + ' is never a legal move in Single Player');
    const result = Rules.playCard(s, seat, move.cardId, move.targetId);
    assert(result.ok, 'a legal move plays: ' + (result.error || ''));
    checkNothingSmuggledIn('mid-game');
  }
  assert(guard > 1, 'the match really was played, turn by turn');
});

test('the same seed deals the same Single Player hands', function () {
  const a = game({ singlePlayer: true, seed: 99 });
  const b = game({ singlePlayer: true, seed: 99 });
  a.players.forEach(function (player) {
    equal(Rules.handOf(a, player.id).join(','), Rules.handOf(b, player.id).join(','),
      player.name + "'s hand replays");
  });
});

/* ===================================================================== */
/* The relay and the click path                                          */
/* ===================================================================== */

suite('The AI relay and the human hand');

test('the AI relay refuses The Mimic in Single Player', function () {
  const g = GameApi.create({ seed: 7, rounds: 5, singlePlayer: true });
  const s = g.state;
  const aiSeat = s.players.findIndex(function (p) { return !p.isHuman; });
  const ai = s.players[aiSeat];
  const victim = s.players.find(function (p) { return p.seat !== aiSeat; });

  // The card was never dealt, so this stands in for a corrupted state.
  s.hands[ai.id].push('mimic');
  s.turnInRound = aiSeat;

  const result = g.submitAiMove('PLAY: The Mimic\nTARGET: ' + victim.name);
  equal(result.ok, false, 'the relay refuses it');
  assert(result.error.indexOf('Single Player') !== -1,
    'the refusal says why: ' + result.error);
  equal(g.log.filter(function (entry) {
    return String(entry.text || '').indexOf('Mimic') !== -1;
  }).length, 0, 'and the table log never records the play');
});

test('the AI relay still plays The Mimic in multiplayer', function () {
  const g = GameApi.create({ seed: 7, rounds: 5 });
  const s = g.state;
  const aiSeat = s.players.findIndex(function (p) { return !p.isHuman; });
  const ai = s.players[aiSeat];
  const victim = s.players.find(function (p) { return p.seat !== aiSeat; });

  s.hands[ai.id].push('mimic');
  s.turnInRound = aiSeat;

  const result = g.submitAiMove('PLAY: The Mimic\nTARGET: ' + victim.name);
  equal(result.ok, true, 'multiplayer plays it: ' + (result.error || ''));
  equal(result.cardId, 'mimic', 'and it is the Mimic that was played');
});

test('the human hand refuses a human-only card in Single Player', function () {
  const g = GameApi.create({ seed: 9, rounds: 5, singlePlayer: true });
  const s = g.state;
  const seat = g.humanSeat();
  const me = s.players[seat];
  const victim = s.players.find(function (p) { return p.seat !== seat; });
  s.hands[me.id].push('phoenixtube');
  s.turnInRound = seat;

  const result = g.playHuman('phoenixtube', victim.id);
  equal(result.ok, false, 'the click is refused');
  assert(result.error.indexOf('Single Player') !== -1,
    'the refusal says why: ' + result.error);
});

test('the AI prompt only teaches the cards the match can produce', function () {
  const single = game({ singlePlayer: true });
  const aiSeat = single.players.findIndex(function (p) { return !p.isHuman; });
  const prompt = Prompt.buildPrompt(single, aiSeat, []);
  HUMAN_ONLY.forEach(function (id) {
    const card = Cards.byId(id);
    assert(prompt.indexOf(card.name) === -1,
      card.name + ' is not taught in a Single Player prompt');
  });
  assert(prompt.indexOf('Knife') !== -1, 'ordinary cards are still taught');

  const multi = game();
  const multiPrompt = Prompt.buildPrompt(multi, aiSeat, []);
  assert(multiPrompt.indexOf('The Mimic') !== -1,
    'the multiplayer prompt still teaches The Mimic');
});

test('deckInfo tells the truth about the Single Player deck', function () {
  const g = GameApi.create({ seed: 11, rounds: 5, singlePlayer: true });
  equal(g.deckInfo().total, Rules.deckSize(g.state),
    'the total is the Single Player total');
  equal(g.deckInfo().draw + g.deckInfo().discard
    + g.state.players.reduce(function (n, p) { return n + Rules.handSize(g.state, p.id); }, 0),
    Rules.deckSize(g.state), 'draw + discard + hands is the whole deck');
});

/* ===================================================================== */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
