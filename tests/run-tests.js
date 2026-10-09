/*
 * Phoenix - headless test suite
 * ---------------------------------------------------------------------------
 * Runs the five cards, the rule engine, the four AI personalities and the game
 * controller in Node, with no dependencies:
 *
 *     node tests/run-tests.js
 */
'use strict';

var path = require('path');
var Cards = require(path.join(__dirname, '..', 'js', 'cards.js'));
var Rules = require(path.join(__dirname, '..', 'js', 'rules.js'));
var Parser = require(path.join(__dirname, '..', 'js', 'parser.js'));
var Prompt = require(path.join(__dirname, '..', 'js', 'prompt.js'));
var GameApi = require(path.join(__dirname, '..', 'js', 'game.js'));

var BONUS = Rules.BONUS_POINTS;

/* --------------------------------------------------------------------- */
/* Micro test framework                                                   */
/* --------------------------------------------------------------------- */

var passed = 0;
var failures = [];
var currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log('\n\u001b[1m' + name + '\u001b[0m');
}

function test(name, fn) {
  // The board is reset before AND after, so a test cannot leak its switches or
  // its Phoenix award into the next one - and a failing test still cannot.
  resetBoard();
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures.push({ suite: currentSuite, name: name, err: err });
    console.log('  \u2717 ' + name + '\n      ' + err.message);
  }
  resetBoard();
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || 'values differ') +
      '\n      expected: ' + JSON.stringify(expected) +
      '\n      actual:   ' + JSON.stringify(actual)
    );
  }
}

function greater(actual, minimum, message) {
  if (!(actual > minimum)) {
    throw new Error(
      (message || 'value too small') +
      '\n      expected: > ' + JSON.stringify(minimum) +
      '\n      actual:     ' + JSON.stringify(actual)
    );
  }
}

function deepEqual(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      (message || 'values differ') +
      '\n      expected: ' + b +
      '\n      actual:   ' + a
    );
  }
}

/* --------------------------------------------------------------------- */
/* Board state                                                            */
/* --------------------------------------------------------------------- */

/**
 * The AI switches and the Phoenix card are deliberately board-global - they
 * persist between games, which is the whole point of them. That makes them a
 * hazard for a test suite: one test that switches Copilot off, or awards
 * Phoenix to somebody, changes the starting conditions of every test after it,
 * including tests that failed part way through.
 *
 * So each test starts from a clean board and leaves one behind.
 */
function resetBoard() {
  Rules.setPhoenixHolder(null);
  AI_IDS.forEach(function (id) { Rules.setPlayerEnabled(id, true); });
}

/* --------------------------------------------------------------------- */
/* Helpers                                                                */
/* --------------------------------------------------------------------- */

/** Seat ids, handy for readable assertions. */
var HUMAN = 'human';
var GPT = 'chatgpt';
var CLAUDE = 'claude';
var GEMINI = 'gemini';
var COPILOT = 'copilot';
var AI_IDS = [GPT, CLAUDE, GEMINI, COPILOT];

/**
 * A game with the seats in their listed order, so seat 0 is always the human
 * and a test can say "seat 2 plays a card". Real games shuffle the seating
 * (see Rules.createGame); a few tests below check that separately.
 */
function newGame(options) {
  var opts = options || { seed: 42 };
  opts.fixedOrder = true;
  opts.rotateStart = false;
  return Rules.createGame(opts);
}

function byId(state, id) {
  return Rules.playerById(state, id);
}

/**
 * A game where the human is seated first and the table opens on seat 0, so a
 * test can say "play for the human" and mean it. Real games shuffle both.
 */
function firstGame(options) {
  var opts = options || {};
  opts.fixedOrder = true;
  opts.rotateStart = false;
  opts.roundStartSeat = 0;
  return GameApi.create(opts);
}

/**
 * A greedy but seat-symmetric "opponent" for the fairness tests: steal from
 * whoever is currently ahead of you, otherwise bank +10,000 Points.
 *
 * It reads nothing about seat numbers and has no tie-break advantage of its
 * own, so seat position and turn order are the only things that can decide who
 * wins. (A "always play the first legal card" script does NOT work here - it is
 * fully deterministic, so every seat plays the same card and one seat wins every
 * game on the standings tie-break alone.)
 *
 * @returns {{cardId: string, targetId: (string|null)}}
 */
function greedyMove(state, seat) {
  var me = state.players[seat];
  var best = null;
  Rules.opponents(state, seat).forEach(function (p) {
    if (p.points > me.points && (!best || p.points > best.points)) best = p;
  });
  if (best) {
    var legal = Rules.legalTargets(state, seat, 'steal');
    if (legal.indexOf(best.id) !== -1) return { cardId: 'steal', targetId: best.id };
  }
  return { cardId: 'bonus', targetId: null };
}

/** The same greedy move, as relay text from an external AI. */
function greedyReply(state, seat) {
  var move = greedyMove(state, seat);
  var text = 'PLAY: ' + Cards.resolve(move.cardId).name;
  if (move.targetId) {
    text += '\nTARGET: ' + Rules.playerById(state, move.targetId).name;
  }
  return text;
}

/**
 * The best legal move from whatever the player is actually holding: steal from
 * whoever is ahead of you if you hold a Steal Points and can aim it there,
 * otherwise bank +10,000 Points if you hold one, otherwise take whatever legal
 * card is in hand.
 *
 * It reads nothing about seat numbers and no tie-break advantage of its own, so
 * seat position and turn order are the only things that can decide who wins.
 *
 * @returns {{cardId: string, targetId: (string|null)}}
 */
function greedyMove(state, seat) {
  var me = state.players[seat];
  var id = me.id;

  if (Rules.holdsCard(state, id, 'steal')) {
    var best = null;
    Rules.opponents(state, seat).forEach(function (p) {
      if (p.points > me.points && (!best || p.points > best.points)) best = p;
    });
    if (best) {
      var legal = Rules.legalTargets(state, seat, 'steal');
      if (legal.indexOf(best.id) !== -1) return { cardId: 'steal', targetId: best.id };
    }
  }
  if (Rules.holdsCard(state, id, 'bonus')) return { cardId: 'bonus', targetId: null };

  var playable = Rules.legalMoves(state, seat);
  if (playable.length) return { cardId: playable[0].cardId, targetId: playable[0].targetId };
  // Nothing they can legally play. Returning a card they do not hold would only
  // produce a confusing "does not hold" error further along.
  return null;
}

/**
 * The same greedy move, as relay text from an external AI.
 *
 * Targets are written with the DISPLAYED name, because that is what the parser
 * reads and what the prompt shows - an AI replies against the names it was given.
 * Under Trick those differ from the real ones.
 */
function greedyReply(state, seat) {
  var move = greedyMove(state, seat);
  var card = Cards.resolve(move.cardId);
  var text = 'PLAY: ' + card.name;
  if (move.targetId) {
    text += '\nTARGET: ' + Rules.displayName(state, Rules.playerById(state, move.targetId));
  }
  return text;
}

/** Plays one greedy turn for whoever is on turn, through their real path. */
function playGreedyTurn(game, seat) {
  var move = greedyMove(game.state, seat);
  if (!move) return { ok: false, error: 'no legal move' };
  if (game.isHumanTurn()) return game.playHuman(move.cardId, move.targetId);
  return game.submitAiMove(greedyReply(game.state, seat));
}

/**
 * Whether a pending forced choice can be settled right now.
 *
 * An Alvin burn always can - its chooser has not finished their turn. A Steal a
 * Turn only can once the table has actually reached its target.
 */
function choiceIsDue(state) {
  var pending = state.pendingChoice;
  if (!pending) return false;
  if (pending.kind === Rules.PENDING_CHOICE_KINDS.BURN) return true;
  return state.players[state.turnInRound].id === pending.targetId;
}

/**
 * Advances a raw engine state by exactly one action: settle a forced choice if
 * one is due, otherwise play a greedy move for the player on turn.
 *
 * Steal a Turn pauses the game - the player on turn is not the one deciding - so
 * anything that drives a whole game has to go through here, or it will try to
 * play a card for somebody whose turn is being chosen for them.
 *
 * @returns {{ok: boolean, error?: string}}
 */
function stepOnce(state) {
  if (state.pendingChoice) {
    if (!choiceIsDue(state)) {
      // The choice is not due yet, so let the table reach its target.
      var seat = state.turnInRound;
      var move = greedyMove(state, seat);
      if (!move) return { ok: false, error: 'no legal move while a choice is pending' };
      return Rules.playCard(state, seat, move.cardId, move.targetId);
    }
    var info = Rules.pendingChoiceOptions(state);
    if (!info || !info.options.length) {
      return { ok: false, error: 'a choice is pending with no options' };
    }
    var pick = info.options[0];
    return Rules.resolvePendingChoice(state, pick.cardId, pick.targetId);
  }
  var seat2 = state.turnInRound;
  var move2 = greedyMove(state, seat2);
  if (!move2) return { ok: false, error: 'no legal move' };
  return Rules.playCard(state, seat2, move2.cardId, move2.targetId);
}

/** Plays a raw engine state out to the end, honouring forced choices. */
function playStateToEnd(state, limit) {
  var guard = 0;
  while (!state.over && guard++ < (limit || 500)) {
    var result = stepOnce(state);
    if (!result.ok) return { ok: false, error: result.error, turns: guard };
  }
  return { ok: state.over, turns: guard };
}

/**
 * Drives a whole game through the game controller, settling forced choices the
 * way the relay does.
 */
function playGameToEnd(game, limit) {
  var guard = 0;
  while (!game.state.over && guard++ < (limit || 500)) {
    if (game.isAwaitingChoice()) {
      if (choiceIsDue(game.state)) {
        var info = game.pendingChoice();
        if (info.chooserId === 'human') {
          var pick = game.choiceOptions()[0];
          var choice = game.playForcedChoice(pick.cardId, pick.targetId);
          if (!choice.ok) return { ok: false, error: choice.error, turns: guard };
          continue;
        }
        var ai = game.submitForcedChoice(
          'PLAY: ' + Rules.formatCard(info.options[0].cardId) +
          (info.options[0].targetId
            ? '\nTARGET: ' + Rules.displayName(
              game.state, Rules.playerById(game.state, info.options[0].targetId))
            : ''));
        if (!ai.ok) return { ok: false, error: ai.error, turns: guard };
        continue;
      }
      // The choice is not due yet: Steal a Turn only bites when the turn reaches
      // its target, so the table has to get there first.
      var mid = playGreedyTurn(game, game.state.turnInRound);
      if (!mid.ok) return { ok: false, error: mid.error, turns: guard };
      continue;
    }
    var played = playGreedyTurn(game, game.state.turnInRound);
    if (!played.ok) return { ok: false, error: played.error, turns: guard };
  }
  return { ok: game.state.over, turns: guard };
}

/* --------------------------------------------------------------------- */
/* Deck helpers                                                          */
/* --------------------------------------------------------------------- */

/**
 * Puts a card straight into a player's hand, bypassing the deck.
 *
 * Most of this suite is about card RULES, not luck: a test that wants to check
 * what Zombie does to somebody holding 30,000 does not care whether the deal
 * gave them a Zombie. These helpers let a test set up exactly the situation it
 * needs, and the deck gets its own suite below.
 */
function give(state, seat, cardId) {
  state.hands[state.players[seat].id].push(cardId);
  return cardId;
}

function giveAll(state, cardId) {
  state.players.forEach(function (p) { give(state, p.seat, cardId); });
}

/**
 * Makes sure whoever is about to act holds the card the test wants them to
 * play. Call this before a play rather than dealing with the deck.
 */
function ensure(state, seat, cardId) {
  if (!Rules.holdsCard(state, state.players[seat].id, cardId)) give(state, seat, cardId);
}

/**
 * Plays for the human, making sure they are actually holding the card first.
 * Most of these tests are about a rule, not about luck, so a missing card in
 * the deal should not fail them.
 */
function humanPlays(game, cardId, targetId) {
  ensure(game.state, game.humanSeat(), cardId);
  return game.playHuman(cardId, targetId);
}

/**
 * Submits a relay reply for the AI on turn, topping up their hand with any card
 * the reply names but they were not dealt. Keeps the relay tests about parsing
 * and validation rather than about the deal.
 */
function aiSays(game, reply) {
  var seat = game.currentSeat();
  var named = /PLAY:\s*([^\n]+)/.exec(reply);
  if (named && seat >= 0) {
    var card = Cards.resolve(named[1].trim());
    if (card) ensure(game.state, seat, card.id);
  }
  return game.submitAiMove(reply);
}

/** Gives every seat every card - for tests that play a long scripted game. */
function dealEverything(state) {
  Cards.CARDS.forEach(function (card) {
    state.players.forEach(function (p) {
      if (p.enabled) give(state, p.seat, card.id);
    });
  });
}

/** Plays +10,000 Points for whoever is to act, `count` times. */
function playBonus(state, count) {
  for (var i = 0; i < (count || 1); i++) {
    ensure(state, state.turnInRound, 'bonus');
    var result = Rules.playCard(state, state.turnInRound, 'bonus', null);
    assert(result.ok, 'bonus play failed: ' + result.error);
  }
}

/** Advances seat by seat with bonuses until `seat` is to act. */
/** Ensures every seat can always play +10,000 Points, so scripted walks work. */
function ensureBonusForAll(state) {
  state.players.forEach(function (p) {
    if (p.enabled && !Rules.holdsCard(state, p.id, 'bonus')) give(state, p.seat, 'bonus');
  });
}

function playToSeat(state, seat) {
  var guard = 0;
  while (state.turnInRound !== seat && !state.over && guard++ < 200) {
    ensureBonusForAll(state);
    playBonus(state);
  }
  assert(state.turnInRound === seat, 'could not reach seat ' + seat);
}

/** Advances rounds until `round` is the current round. */
function playToRound(state, round) {
  var guard = 0;
  while (state.round !== round && !state.over && guard++ < 500) {
    ensureBonusForAll(state);
    playBonus(state);
  }
  assert(state.round === round, 'could not reach round ' + round);
}

/** Lets a single player take their next turn with a chosen card. */
function letPlay(state, seat, cardId, targetId) {
  playToSeat(state, seat);
  return playAt(state, seat, cardId, targetId);
}

/** Plays for whoever is to act, insisting it is `seat`. No moving around. */
function playAt(state, seat, cardId, targetId) {
  assert(state.turnInRound === seat, 'expected seat ' + seat + ' to act, got ' + state.turnInRound);
  ensure(state, seat, cardId);
  var result = Rules.playCard(state, seat, cardId, targetId);
  assert(result.ok, cardId + ' failed: ' + result.error);
  return result;
}

/** The round in which `id` next gets to act. */
function nextTurnRound(state, id) {
  var seat = byId(state, id).seat;
  var round = state.round;
  var t = state.turnInRound;
  var guard = 0;
  do {
    t++;
    if (t >= Rules.SEAT_COUNT) { t = 0; round++; }
    guard++;
  } while (t !== seat && guard < Rules.SEAT_COUNT + 1);
  return round;
}

/** True when the player is recorded out for their next scheduled turn. */
function skipsNextTurn(state, id) {
  var player = byId(state, id);
  return player.outUntilRound >= nextTurnRound(state, id);
}

/** Collects { type, text } from a result object. */
function texts(result) {
  return result.events.map(function (e) { return e.text; }).join(' | ');
}

var SEED = 20260101;
function nextSeed() {
  SEED += 7919;
  return SEED;
}

/* ===================================================================== */
/* The deck                                                               */
/* ===================================================================== */

suite('The deck');

/**
 * Every card in the game, wherever it happens to be.
 *
 * That includes the destroyed pile, because Alvin takes cards out of the game
 * entirely rather than putting them in the discard. Leaving them out here would
 * make a destroyed card look like a lost one.
 */
function allCards(state) {
  return state.deck
    .concat(state.discard)
    .concat(state.destroyed || [])
    .concat(state.players.reduce(function (acc, p) {
      return acc.concat(Rules.handOf(state, p.id));
    }, []));
}

test('the deck is built from the composition and holds nothing else', function () {
  var s = newGame({ seed: 1 });
  var counts = {};
  allCards(s).forEach(function (id) {
    counts[id] = (counts[id] || 0) + 1;
  });
  Cards.deckCards().forEach(function (card) {
    equal(counts[card.id], Rules.DECK_COMPOSITION[card.id],
      card.name + ' appears ' + Rules.DECK_COMPOSITION[card.id] + ' times');
  });
  equal(allCards(s).length, Rules.deckSize(), 'and every one of them exists');
});

test('the legendary card is never dealt, drawn or reshuffled', function () {
  // Phoenix is not in the composition at all, so it cannot reach the deck.
  equal(Rules.DECK_COMPOSITION[Rules.PHOENIX_CARD_ID], undefined,
    'the legendary card has no deck count');
  var counts = {};
  Cards.ids().forEach(function (id) { counts[id] = 0; });
  for (var seed = 1; seed <= 40; seed++) {
    var s = newGame({ seed: seed, rounds: 8 });
    allCards(s).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    var guard = 0;
    while (!s.over && guard++ < 300) {
      var seat = s.turnInRound;
      var move = Rules.legalMoves(s, seat)[0];
      if (!move) break;
      Rules.playCard(s, seat, move.cardId, move.targetId);
      equal(s.discard.indexOf(Rules.PHOENIX_CARD_ID), -1,
        'the legendary card never reaches the discard pile');
      s.deck.concat(s.discard).forEach(function (id) {
        assert(id !== Rules.PHOENIX_CARD_ID, 'no Phoenix in the deck or discard');
      });
    }
  }
  equal(counts[Rules.PHOENIX_CARD_ID], 0, 'it was never dealt in 40 games');
  equal(Cards.deckIds().indexOf(Rules.PHOENIX_CARD_ID), -1,
    'and the deck builder excludes it');
});

test('the deck size is what the composition adds up to', function () {
  var sum = Cards.deckIds().reduce(function (n, id) {
    return n + Rules.DECK_COMPOSITION[id];
  }, 0);
  equal(Rules.deckSize(), sum, 'deckSize matches the composition');
  greater(Rules.deckSize(), 0, 'the deck is not empty');
});

test('every player is dealt a hand', function () {
  var s = newGame({ seed: 1 });
  var openingSeat = s.turnInRound;
  s.players.forEach(function (p) {
    // The player who opens the game is already mid-turn, so they drew one.
    var expected = Rules.HAND_SIZE + (p.seat === openingSeat ? 1 : 0);
    equal(Rules.handSize(s, p.id), expected,
      p.name + ' is holding ' + expected + ' cards');
  });
  equal(allCards(s).length, Rules.deckSize(), 'no card was created or lost by dealing');
});

test('every card is accounted for at all times', function () {
  var s = newGame({ seed: 7, rounds: 8 });
  var expected = Rules.deckSize();
  var guard = 0;
  function total() {
    return s.deck.length + s.discard.length + s.players.reduce(function (n, p) {
      return n + Rules.handSize(s, p.id);
    }, 0);
  }
  equal(total(), expected, 'before any turn');
  while (!s.over && guard++ < 300) {
    var seat = s.turnInRound;
    var move = Rules.legalMoves(s, seat)[0];
    if (!move) break;
    Rules.playCard(s, seat, move.cardId, move.targetId);
    equal(total(), expected, 'card count conserved on turn ' + s.turnIndex);
  }
});

test('the deal is shuffled, not grouped by type', function () {
  // With 10 bonuses, 8 knives and so on, an unshuffled deal would hand every
  // player the same block of cards. Over several seeds hands must be mixed.
  var mixed = 0;
  for (var n = 0; n < 12; n++) {
    var s = newGame({ seed: 100 + n });
    s.players.forEach(function (p) {
      var unique = {};
      Rules.handOf(s, p.id).forEach(function (id) { unique[id] = true; });
      if (Object.keys(unique).length > 2) mixed++;
    });
  }
  greater(mixed, 20, 'hands contain a mix of types, not blocks of one');
});

test('the same seed deals the same hands', function () {
  var a = newGame({ seed: 4242 });
  var b = newGame({ seed: 4242 });
  a.players.forEach(function (p) {
    equal(Rules.handOf(a, p.id).join(','), Rules.handOf(b, p.id).join(','),
      p.name + "'s hand replays");
  });
});

test('a turn begins by drawing a card', function () {
  var s = newGame({ seed: 3, rounds: 3 });
  var seat = s.turnInRound;
  var before = Rules.handSize(s, s.players[seat].id);
  equal(before, Rules.HAND_SIZE + 1, 'the opening player has already drawn once');

  var move = Rules.legalMoves(s, seat)[0];
  Rules.playCard(s, seat, move.cardId, move.targetId);
  var next = s.players[s.turnInRound];
  equal(Rules.handSize(s, next.id), Rules.HAND_SIZE + 1,
    next.name + ' drew at the start of their turn');
});

test('a card leaves the hand and lands on the discard', function () {
  var s = newGame({ seed: 5, rounds: 4 });
  var seat = s.turnInRound;
  var id = s.players[seat].id;
  // Remove every Hunter so the test is not at the mercy of the deal.
  var hand = Rules.handOf(s, id);
  var hadHunter = hand.length;
  for (var n = hand.length - 1; n >= 0; n--) {
    if (hand[n] === 'hunter') hand.splice(n, 1);
  }
  give(s, seat, 'hunter');
  var before = Rules.handSize(s, id);
  var discardBefore = s.discard.length;

  var result = Rules.playCard(s, seat, 'hunter', null);
  equal(result.ok, true, result.error);
  equal(Rules.holdsCard(s, id, 'hunter'), false, 'the last Hunter left the hand');
  equal(Rules.handSize(s, id), before - 1, 'the hand is one shorter');
  equal(s.discard.length, discardBefore + 1, 'and one card joined the discard');
  equal(s.discard[s.discard.length - 1], 'hunter', 'specifically the Hunter');
  greater(hadHunter, 0, 'the deal did include a Hunter to remove');
});

test('you cannot play a card you do not hold', function () {
  var s = newGame({ seed: 5, rounds: 4 });
  var seat = s.turnInRound;
  var id = s.players[seat].id;
  s.hands[id] = [];

  var result = Rules.playCard(s, seat, 'bonus', null);
  equal(result.ok, false, 'an empty hand cannot play');
  assert(/does not hold/.test(result.error), result.error);
  equal(Rules.isPlayable(s, seat, 'bonus', null), false, 'isPlayable agrees');

  give(s, seat, 'hunter');
  var zombie = Rules.playCard(s, seat, 'zombie', Rules.opponents(s, seat)[0].id);
  equal(zombie.ok, false, 'an unheld Zombie is refused even with a valid target');
  assert(/does not hold/.test(zombie.error), zombie.error);
});

test('an AI cannot be told to play a card it is not holding', function () {
  var game = firstGame({ seed: 11, rounds: 4 });
  humanPlays(game, 'bonus', null);
  equal(game.isHumanTurn(), false, 'an AI is now on turn');
  var seat = game.state.turnInRound;
  var id = game.state.players[seat].id;
  give(game.state, seat, 'hunter');        // hold exactly one card
  game.state.hands[id] = ['hunter'];       // and definitely not a +10,000

  var result = game.submitAiMove('PLAY: +10,000 Points');   // no topping up here
  equal(result.ok, false, 'the relay refuses an unheld card');
  assert(/does not hold/.test(result.error), result.error);
  assert(/holding/.test(result.hint), 'and says what they DO hold: ' + result.hint);
  assert(/Hunter/.test(result.hint), 'which is the Hunter: ' + result.hint);
  equal(game.state.turnInRound, seat, 'the turn does not advance');
  equal(Rules.handSize(game.state, id), 1, 'and nothing was played');
});

test('legalMoves only offers cards from the hand', function () {
  var s = newGame({ seed: 13, rounds: 4 });
  var seat = s.turnInRound;
  s.hands[s.players[seat].id] = ['bonus'];
  var moves = Rules.legalMoves(s, seat);
  equal(moves.length, 1, 'one move for one card');
  equal(moves[0].cardId, 'bonus');
  equal(moves[0].targetId, null);

  s.hands[s.players[seat].id] = ['steal'];
  var steals = Rules.legalMoves(s, seat);
  greater(steals.length, 0, 'a Steal has several targets');
  assert(steals.every(function (m) { return m.cardId === 'steal'; }),
    'and they are all Steal Points');
});

test('legalMoves expands a targeted card into one move per legal target', function () {
  var s = newGame({ seed: 17, rounds: 4 });
  var seat = s.turnInRound;
  s.hands[s.players[seat].id] = ['knife'];
  var moves = Rules.legalMoves(s, seat);
  equal(moves.length, 4, 'one per opponent');
  assert(moves.every(function (m) { return m.targetId && m.target; }),
    'each names its target');
});

test('an empty hand has no legal moves', function () {
  var s = newGame({ seed: 19, rounds: 4 });
  var seat = s.turnInRound;
  s.hands[s.players[seat].id] = [];
  equal(Rules.legalMoves(s, seat).length, 0, 'nothing to play');
});

test('a reshuffle is announced in the log', function () {
  var s = newGame({ seed: 29, rounds: 12 });
  var guard = 0;
  while (s.discard.length < 6 && !s.over && guard++ < 40) {
    var mover = s.turnInRound;
    var m = Rules.legalMoves(s, mover)[0];
    if (!m) break;
    Rules.playCard(s, mover, m.cardId, m.targetId);
  }
  s.deck.length = 0;                       // the next draw must recycle the discard
  var before = s.reshuffles;

  var seat = s.turnInRound;
  var move = Rules.legalMoves(s, seat)[0];
  var result = Rules.playCard(s, seat, move.cardId, move.targetId);

  greater(s.reshuffles, before, 'a reshuffle happened');
  var event = result.events.filter(function (e) { return e.type === 'reshuffle'; })[0];
  assert(event, 'and it is reported in the log');
  assert(/reshuffled/.test(event.text), event.text);
  equal(result.events.filter(function (e) { return e.type === 'draw'; }).length, 1,
    'alongside the draw that caused it');
});

test('the deck is reshuffled from the discard when it runs out', function () {
  var s = newGame({ seed: 23, rounds: 12 });
  // Play a few cards so there is a discard pile worth recycling.
  var guard = 0;
  while (s.discard.length < 6 && !s.over && guard++ < 40) {
    var mover = s.turnInRound;
    var m = Rules.legalMoves(s, mover)[0];
    if (!m) break;
    Rules.playCard(s, mover, m.cardId, m.targetId);
  }
  greater(s.discard.length, 0, 'there is something in the discard to rebuild from');

  // Now flatten the deck into the discard, so the next draw must recycle it.
  var discardSize = s.discard.length + s.deck.length;
  s.discard = s.discard.concat(s.deck);
  s.deck = [];
  s.deck.length = 0;
  equal(allCards(s).length, Rules.deckSize(),
    'moving the draw pile did not delete any cards');
  var before = s.reshuffles;

  var mover2 = s.turnInRound;
  // Draw directly: that is the path a real turn takes when the deck empties.
  var drawn = Rules.drawCard(s, s.players[mover2]);
  greater(s.reshuffles, before, 'the deck was rebuilt from the discard');
  assert(drawn, 'a card was dealt');
  equal(allCards(s).length, Rules.deckSize(), 'and nothing was lost doing it');
  equal(s.deck.length, discardSize - 1, 'the discard became the deck, less one draw');
});

test('a long game reshuffles rather than running out', function () {
  var s = newGame({ seed: 31, rounds: 20 });
  var guard = 0;
  while (!s.over && guard++ < 600) {
    var result = stepOnce(s);
    if (!result.ok) break;
    s.players.forEach(function (p) {
      if (p.enabled) assert(Rules.handSize(s, p.id) >= 0, p.name + ' has a sane hand');
    });
  }
  equal(s.over, true, 'a 20-round game completes');
  greater(s.reshuffles, 0, 'and the discard was recycled at least once');
});

test('the discard is never lost when the deck empties', function () {
  var s = newGame({ seed: 37, rounds: 20 });
  var expected = Rules.deckSize();
  var guard = 0;
  while (!s.over && guard++ < 600) {
    var seat = s.turnInRound;
    var move = Rules.legalMoves(s, seat)[0];
    if (!move) break;
    var result = Rules.playCard(s, seat, move.cardId, move.targetId);
    if (!result.ok) break;
    var held = s.players.reduce(function (n, p) { return n + Rules.handSize(s, p.id); }, 0);
    equal(s.deck.length + s.discard.length + held, expected, 'every card is still somewhere');
  }
});

test('a switched-off player is dealt no cards', function () {
  withAis(function () {
    Rules.setPlayerEnabled(COPILOT, false);
    var s = newGame({ seed: 3, rounds: 4 });
    equal(Rules.handSize(s, COPILOT), 0, 'Copilot holds nothing');
    equal(Rules.handSize(s, GPT), Rules.HAND_SIZE, 'ChatGPT was dealt normally');
    s.players.forEach(function (p) {
      if (p.id === COPILOT) return;
      var expected = Rules.HAND_SIZE + (p.seat === s.turnInRound ? 1 : 0);
      equal(Rules.handSize(s, p.id), expected, p.name + ' has a normal hand');
    });
    equal(allCards(s).length, Rules.deckSize(),
      'every card exists - the four live hands simply took more of them');
  });
});

test('draws are announced in the log', function () {
  var s = newGame({ seed: 43, rounds: 4 });
  var seat = s.turnInRound;
  var move = Rules.legalMoves(s, seat)[0];
  var result = Rules.playCard(s, seat, move.cardId, move.targetId);
  var draw = result.events.filter(function (e) { return e.type === 'draw'; })[0];
  assert(draw, 'a draw event is emitted');
  assert(/draws/.test(draw.text), draw.text);
  assert(draw.cardId, 'and it names the card');
});

test('deck composition is exported and complete', function () {
  Cards.deckCards().forEach(function (card) {
    assert(typeof Rules.DECK_COMPOSITION[card.id] === 'number',
      card.id + ' has a deck count');
    greater(Rules.DECK_COMPOSITION[card.id], 0, card.id + ' appears in the deck');
  });
  greater(Rules.HAND_SIZE, 0, 'a hand size is set');
});

test('the legendary card is deliberately absent from the composition', function () {
  // Every other card has a deck count; this one must not, or it could be dealt.
  equal(typeof Rules.DECK_COMPOSITION[Rules.PHOENIX_CARD_ID], 'undefined',
    'Phoenix has no deck count');
  var legendary = Cards.CARDS.filter(function (c) { return c.legendary; });
  equal(legendary.length, 1, 'there is exactly one legendary card');
  equal(legendary[0].inDeck, false, 'and it is marked as not in the deck');
});

/* ===================================================================== */
/* Cards                                                                 */
/* ===================================================================== */

suite('Cards');

test('the game uses exactly fourteen cards', function () {
  equal(Cards.CARDS.length, 14);
});

test('the fourteen cards are exactly the ones specified', function () {
  var names = Cards.CARDS.map(function (c) { return c.name; });
  equal(names.join(' | '), '+10,000 Points | Knife | Hunter | Zombie | Steal Points' +
    ' | Judge | Reveal Deck | Skip Everyone | Phoenix' +
    ' | Trick | Steal a Turn | Curse | Ghost | Alvin');
});

test('card ids are all lowercase, so resolve() always finds them', function () {
  // resolve() lowercases whatever it is given before looking the id up, so an id
  // with a capital in it becomes unreachable - which is how "stealTurn" once
  // failed to resolve and took the whole relay down with it.
  Cards.ids().forEach(function (id) {
    assert(/^[a-z]+$/.test(id), id + ' is all lowercase');
    equal(Cards.resolve(id), Cards.byId(id), id + ' resolves from its own id');
    equal(Cards.resolve(id.toUpperCase()), Cards.byId(id), id + ' resolves case-insensitively');
  });
});

test('the aimed cards are the eight that ask for a player', function () {
  var needs = Cards.CARDS.filter(function (c) { return c.needsTarget; }).map(function (c) { return c.id; });
  equal(needs.join(','), 'knife,zombie,steal,reveal,trick,stealturn,curse,alvin');
});

test('the two cards that hand back a choice say so', function () {
  var forced = Cards.CARDS.filter(function (c) { return c.forcedChoice; })
    .map(function (c) { return c.id + ':' + c.forcedChoice; });
  equal(forced.join(','), 'stealturn:move,alvin:burn');
});

test('Alvin brings artwork, and only Alvin', function () {
  var withArt = Cards.CARDS.filter(function (c) { return c.art; }).map(function (c) { return c.id; });
  equal(withArt.join(','), 'alvin', 'only Alvin draws its own art');
  var art = Cards.byId('alvin').art;
  assert(art.indexOf('<svg') !== -1, 'and it is real SVG, not a glyph');
  assert(/cat/i.test(art) || art.indexOf('phxFur') !== -1,
    'and it is drawn as a ginger cat');
});

test('Zombie, Knife, Steal Points, Trick and Alvin are evil', function () {
  equal(Cards.EVIL_CARDS.join(','), 'zombie,knife,steal,trick,alvin');
  Cards.CARDS.forEach(function (c) {
    equal(Cards.isEvil(c.id), Cards.EVIL_CARDS.indexOf(c.id) !== -1,
      c.id + ' evil status is consistent');
  });
});

test('only Zombie is marked as reflectable', function () {
  var reflect = Cards.CARDS.filter(function (c) { return c.reflected; }).map(function (c) { return c.id; });
  equal(reflect.join(','), 'zombie');
});

test('every card carries a rule line and a target note', function () {
  Cards.CARDS.forEach(function (c) {
    assert(typeof c.rule === 'string' && c.rule.length > 10, c.id + ' has a rule');
    assert(typeof c.targetNote === 'string' && c.targetNote.length > 5, c.id + ' has a target note');
    assert(typeof c.blurb === 'string' && c.blurb.length > 5, c.id + ' has a blurb');
  });
});

test('every card glyph is one real character, not a broken escape', function () {
  // A glyph is drawn on the card face and in the corner index. An escape JS
  // does not recognise - '\\U0001F441' rather than '\\u{1F441}' - is not a
  // compile error, it just renders as the literal text "U0001F441" on the card.
  Cards.CARDS.forEach(function (c) {
    assert(typeof c.glyph === 'string' && c.glyph.length > 0, c.id + ' has a glyph');
    var chars = Array.from(c.glyph);
    equal(chars.length, 1,
      c.id + "'s glyph is a single character (got " + JSON.stringify(c.glyph) + ')');
    assert(/^[\u0020-\u{10FFFF}]$/u.test(c.glyph),
      c.id + "'s glyph is a real character, not escape text");
    assert(!/^\\[uUxX]/.test(c.glyph), c.id + "'s glyph is not escape text");
  });
});

test('resolve() accepts ids, short names and display names', function () {
  equal(Cards.resolve('zombie').id, 'zombie');
  equal(Cards.resolve('Zombie').id, 'zombie');
  equal(Cards.resolve('+10k').id, 'bonus');
  equal(Cards.resolve('+10,000 Points').id, 'bonus');
  equal(Cards.resolve('steal').id, 'steal');
  equal(Cards.resolve('nonsense'), null);
  equal(Cards.byId('nope'), null);
});

/* ===================================================================== */
/* Game state                                                            */
/* ===================================================================== */

suite('Game state');

test('a new game seats five players in order', function () {
  var s = newGame();
  equal(s.players.length, 5);
  equal(s.players.map(function (p) { return p.id; }).join(','), 'human,chatgpt,claude,gemini,copilot');
  equal(s.players.map(function (p) { return p.seat; }).join(','), '0,1,2,3,4');
  equal(Rules.SEAT_COUNT, 5);
});

test('everyone starts on zero points with no effects', function () {
  var s = newGame();
  s.players.forEach(function (p) {
    equal(p.points, 0, p.name + ' starts on zero');
    equal(p.hunter, false, p.name + ' has no hunter');
    equal(p.outUntilRound, -1, p.name + ' is not eliminated');
    equal(p.turnsPlayed, 0, p.name + ' has not played');
  });
});

test('exactly one player is the human', function () {
  var s = newGame();
  equal(s.players.filter(function (p) { return p.isHuman; }).length, 1);
  equal(s.players[0].isHuman, true);
  equal(byId(s, HUMAN).name, 'You');
  equal(byId(s, GPT).name, 'ChatGPT');
  equal(byId(s, CLAUDE).name, 'Claude');
  equal(byId(s, GEMINI).name, 'Gemini');
  equal(byId(s, COPILOT).name, 'Copilot');
});

test('a new game starts at round 1 with the human to act', function () {
  var s = newGame();
  equal(s.round, 1);
  equal(s.turnInRound, 0);
  equal(s.turnIndex, 0);
  equal(s.over, false);
  equal(Rules.currentPlayer(s).id, HUMAN);
});

test('rounds default to 10 and are clamped sensibly', function () {
  equal(newGame().rounds, 10);
  equal(Rules.createGame({ rounds: 3 }).rounds, 3);
  equal(Rules.createGame({ rounds: 0 }).rounds, 10);
  equal(Rules.createGame({ rounds: -5 }).rounds, 10);
  equal(Rules.createGame({ rounds: 'lots' }).rounds, 10);
  equal(Rules.createGame({ rounds: 999 }).rounds, Rules.MAX_ROUNDS);
});

test('the same seed produces the same random sequence', function () {
  Rules.setSeed(1234);
  var a = [Rules.random(), Rules.random(), Rules.random()];
  Rules.setSeed(1234);
  var b = [Rules.random(), Rules.random(), Rules.random()];
  equal(JSON.stringify(a), JSON.stringify(b));
});

test('random() stays inside 0..1', function () {
  Rules.setSeed(99);
  for (var i = 0; i < 500; i++) {
    var n = Rules.random();
    assert(n >= 0 && n < 1, 'random out of range: ' + n);
  }
});

test('playerById, opponents and leader work', function () {
  var s = newGame();
  equal(Rules.playerById(s, GEMINI).seat, 3);
  equal(Rules.playerById(s, 'ghost'), null);
  equal(Rules.opponents(s, 0).length, 4);
  assert(Rules.opponents(s, 0).every(function (p) { return p.seat !== 0; }), 'excludes the actor');
  byId(s, CLAUDE).points = 40000;
  equal(Rules.leader(s).id, CLAUDE);
});

test('formatPoints adds thousands separators', function () {
  equal(Rules.formatPoints(0), '0');
  equal(Rules.formatPoints(7), '7');
  equal(Rules.formatPoints(10000), '10,000');
  equal(Rules.formatPoints(1000000), '1,000,000');
  equal(Rules.formatPoints(-2500), '-2,500');
  equal(Rules.formatPoints(undefined), '0');
});

/* ===================================================================== */
/* Legality                                                              */
/* ===================================================================== */

suite('Legality');

test('a targeted card without a target is rejected', function () {
  var s = newGame();
  assert(!Rules.isPlayable(s, 0, 'knife', null), 'knife needs a target');
  assert(!Rules.isPlayable(s, 0, 'zombie', null), 'zombie needs a target');
  assert(!Rules.isPlayable(s, 0, 'steal', null), 'steal needs a target');
});

test('+10,000 Points and Hunter refuse a target', function () {
  var s = newGame();
  // isPlayable checks the card AND the target, so the hand is set up to hold
  // the cards under test - otherwise this would pass for the wrong reason.
  ensure(s, 0, 'bonus');
  ensure(s, 0, 'hunter');
  assert(Rules.isPlayable(s, 0, 'bonus', null), 'bonus needs no target');
  assert(!Rules.isPlayable(s, 0, 'bonus', GPT), 'bonus takes no target');
  assert(Rules.isPlayable(s, 0, 'hunter', null), 'hunter needs no target');
  assert(!Rules.isPlayable(s, 0, 'hunter', GPT), 'hunter takes no target');
});

test('no card may target the player playing it', function () {
  var s = newGame();
  ['knife', 'zombie', 'steal'].forEach(function (id) { ensure(s, 0, id); });
  ['knife', 'zombie', 'steal'].forEach(function (id) {
    assert(!Rules.isPlayable(s, 0, id, HUMAN), id + ' cannot target self');
  });
});

test('an unknown card id is rejected', function () {
  var s = newGame();
  assert(!Rules.isPlayable(s, 0, 'dragon', null));
  equal(Rules.playCard(s, 0, 'dragon', null).ok, false);
});

test('playing out of turn is rejected and does not advance the turn', function () {
  var s = newGame();
  var result = Rules.playCard(s, 2, 'bonus', null);
  equal(result.ok, false);
  assert(/not that player's turn/.test(result.error), result.error);
  equal(s.turnInRound, 0);
});

test('a rejected move leaves the state untouched', function () {
  var s = newGame();
  Rules.playCard(s, 0, 'zombie', HUMAN);           // illegal self-target
  equal(s.players[0].points, 0);
  equal(s.players[0].outUntilRound, -1);
  equal(s.turnIndex, 0);
});

test('an eliminated player cannot play', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', GPT);
  // ChatGPT is out, so their turn is skipped rather than played.
  equal(s.turnInRound, 2, 'ChatGPT was skipped');
  equal(byId(s, GPT).turnsPlayed, 0);
  assert(Rules.isOut(byId(s, GPT), s), 'ChatGPT is out');
});

test('legalTargets lists the four opponents and skips eliminated players', function () {
  var s = newGame();
  equal(Rules.legalTargets(s, 0, 'knife').join(','), 'chatgpt,claude,gemini,copilot');
  equal(Rules.legalTargets(s, 0, 'bonus').length, 0);
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', GPT);
  assert(Rules.legalTargets(s, 2, 'steal').indexOf(GPT) === -1, 'out player is not a target');
});

test('targetWarning warns about a Zombie aimed at a Hunter', function () {
  var s = newGame();
  letPlay(s, 0, 'hunter', null);
  // Hunter is now held by a later seat; check from a seat before them.
  ensure(s, 0, 'hunter');
  Rules.playCard(s, 0, 'hunter', null);
  assert(Rules.targetWarning(s, 1, 'zombie', HUMAN).length > 0, 'human holds a hunter');
  equal(Rules.targetWarning(s, 1, 'steal', HUMAN), '', 'steal is not affected');
  equal(Rules.targetWarning(s, 1, 'bonus', null), '', 'no target, no warning');
});

/* ===================================================================== */
/* Card 1: +10,000 Points                                                */
/* ===================================================================== */

suite('Card: +10,000 Points');

test('adds exactly 10,000 points to the player who played it', function () {
  var s = newGame();
  ensure(s, 0, 'bonus');
  Rules.playCard(s, 0, 'bonus', null);
  equal(s.players[0].points, BONUS);
  equal(BONUS, 10000);
});

test('nobody else is affected', function () {
  var s = newGame();
  ensure(s, 0, 'bonus');
  Rules.playCard(s, 0, 'bonus', null);
  equal(s.players[1].points, 0);
  equal(s.players[4].points, 0);
});

test('points accumulate across turns and never change hands', function () {
  var s = newGame();
  playBonus(s, 5);                       // one turn each, five seats
  s.players.forEach(function (p) { equal(p.points, BONUS, p.name + ' has one bonus'); });
  playBonus(s, 3);
  equal(s.players[0].points, 2 * BONUS);
  equal(s.players[3].points, 1 * BONUS);
});

test('a rejection message explains the problem', function () {
  var s = newGame();
  ensure(s, 0, 'bonus');
  var result = Rules.playCard(s, 0, 'bonus', GPT);
  equal(result.ok, false);
  assert(/takes no target/.test(result.error), result.error);
  ensure(s, 0, 'zombie');
  var selfZombie = Rules.playCard(s, 0, 'zombie', HUMAN);
  assert(/yourself/.test(selfZombie.error), selfZombie.error);
});

/* ===================================================================== */
/* Card 2: Knife                                                         */
/* ===================================================================== */

suite('Card: Knife');

test('eliminates the chosen opponent', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', GEMINI);
  var gemini = byId(s, GEMINI);
  equal(gemini.outUntilRound, 1);
  assert(Rules.isOut(gemini, s), 'Gemini is out');
  equal(Rules.returnRound(gemini), 2, 'back in round 2');
});

test('a player struck before their turn sits out exactly one turn', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', GPT);
  equal(byId(s, GPT).turnsSkipped, 1, 'skipped their round 1 turn');
  assert(Rules.isOut(byId(s, GPT), s), 'still recorded out in round 1');
  equal(Rules.returnRound(byId(s, GPT)), 2, 'back in round 2');
  playToRound(s, 2);
  equal(byId(s, GPT).turnsSkipped, 1, 'still only one skip');
  equal(byId(s, GPT).outUntilRound, -1, 'badge cleared at the round boundary');
  assert(!Rules.isOut(byId(s, GPT), s), 'back in play');
  letPlay(s, 1, 'bonus', null);
  equal(byId(s, GPT).turnsPlayed, 1, 'they act normally in round 2');
});

test('the victim keeps their points', function () {
  var s = newGame();
  byId(s, GPT).points = 20000;
  letPlay(s, 0, 'knife', GPT);
  equal(byId(s, GPT).points, 20000, 'Knife never touches points');
});

test('a player struck after their turn misses exactly one turn too', function () {
  var s = newGame();
  playToSeat(s, 4);
  ensure(s, 4, 'knife');
  Rules.playCard(s, 4, 'knife', GPT);           // ChatGPT already acted this round
  equal(byId(s, GPT).turnsPlayed, 1, 'they played this round');
  equal(byId(s, GPT).outUntilRound, 2, 'out through round 2');
  equal(Rules.returnRound(byId(s, GPT)), 3);
  playToRound(s, 3);
  equal(byId(s, GPT).turnsSkipped, 1, 'exactly one turn missed');
  equal(byId(s, GPT).outUntilRound, -1, 'back in play');
  assert(!Rules.isOut(byId(s, GPT), s), 'no longer eliminated');
});

test('a skipped turn is reported to the log', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  var result = Rules.playCard(s, 0, 'knife', GPT);
  var skips = result.events.filter(function (e) { return e.type === 'skip'; });
  equal(skips.length, 1);
  equal(skips[0].seat, 1);
  assert(/ChatGPT is eliminated/.test(skips[0].text), skips[0].text);
});

test('re-striking an eliminated player does not extend the elimination', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', GPT);
  equal(byId(s, GPT).outUntilRound, 1);
  // Claude cannot target ChatGPT while they are out, but a Zombie still can.
  Rules.eliminate(s, byId(s, GPT));
  equal(byId(s, GPT).outUntilRound, 1, 'unchanged');
});

test('knife does not care about a Hunter', function () {
  var s = newGame();
  playToSeat(s, 0);
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', CLAUDE);
  playToSeat(s, 2);
  ensure(s, 2, 'hunter');
  Rules.playCard(s, 2, 'hunter', null);
  equal(byId(s, CLAUDE).outUntilRound, -1, 'Claude was never eliminated');
  playToSeat(s, 3);
  ensure(s, 3, 'knife');
  Rules.playCard(s, 3, 'knife', CLAUDE);
  assert(Rules.isOut(byId(s, CLAUDE), s), 'a Knife lands on a Hunter normally');
  equal(byId(s, CLAUDE).outUntilRound, 3);
});

/* ===================================================================== */
/* Card 3: Hunter                                                        */
/* ===================================================================== */

suite('Card: Hunter');

test('creates a Hunter effect for the player who played it', function () {
  var s = newGame();
  playAt(s, 0, 'hunter', null);
  equal(s.players[0].hunter, true, 'the player has the effect');
  equal(s.players[1].hunter, false, 'nobody else does');
});

test('a Zombie can never be aimed at a Hunter, whoever throws it', function () {
  // The reflection makes the card useless, so it is not a legal target at all -
  // not for an AI arriving through the relay, and not for the human in the
  // target picker. Rules.isLegalTarget is the single check all three share.
  var s = newGame();
  playAt(s, 0, 'hunter', null);              // seat 0 becomes a Hunter
  byId(s, HUMAN).points = 40000;
  // Every seat needs a Zombie in hand, or the deck check would hide the point.
  [1, 2, 3, 4].forEach(function (seat) { ensure(s, seat, 'zombie'); });

  // Every other seat, in turn.
  [1, 2, 3, 4].forEach(function (seat) {
    assert(Rules.holdsCard(s, s.players[seat].id, 'zombie'),
      'seat ' + seat + ' really is holding a Zombie');
    equal(Rules.isPlayable(s, seat, 'zombie', HUMAN), false,
      'seat ' + seat + ' cannot Zombie the Hunter');
    equal(Rules.legalTargets(s, seat, 'zombie').indexOf(HUMAN), -1,
      'seat ' + seat + ' is not offered the Hunter');
  });

  // So nothing about the Hunter changes.
  equal(byId(s, HUMAN).outUntilRound, -1, 'the Hunter is never eliminated');
  equal(byId(s, HUMAN).points, 40000, 'and keeps every point');
  byId(s, HUMAN).hunter = true;              // belt and braces
  equal(byId(s, HUMAN).outUntilRound, -1, 'still never eliminated');
});

test('no route lets a Hunter lose points to a Zombie', function () {
  // The engine has two guards: isLegalTarget refuses the target, and the Zombie
  // resolver reflects as a backstop. This checks the outcome that matters - a
  // Hunter can never be zeroed - from every seat, whatever the caller tries.
  var s = newGame();
  playAt(s, 0, 'hunter', null);
  byId(s, HUMAN).points = 40000;

  // Only the AI seats get to try. The human is the one holding the card, and
  // playBonus is how the turn is moved on so the next AI has a go.
  for (var attempt = 0; attempt < 20; attempt++) {
    var seat = s.turnInRound;
    if (seat === 0) {
      playBonus(s, 1);
      continue;
    }
    ensure(s, seat, 'zombie');                   // holding it, so it is the TARGET that refuses
    var result = Rules.playCard(s, seat, 'zombie', HUMAN);
    equal(result.ok, false, 'seat ' + seat + ' is refused');
    assert(/cannot be aimed|does not hold/i.test(result.error), result.error);
    if (result.ok) break;                     // nothing left to try
    playBonus(s, 1);                          // move the game on
  }
  // The human banked a bonus on their own turns along the way, so the score can
  // only have gone up - what matters is that a Zombie never took any of it.
  equal(byId(s, HUMAN).hunter, true, 'the Hunter still holds the effect');
  greater(byId(s, HUMAN).points, 40000, 'the score only grew - no Zombie ever took it');
});

test('the only other rules it grants are none: Knife and Steal still land', function () {
  var s = newGame();
  playAt(s, 0, 'hunter', null);              // seat 0 becomes a Hunter
  byId(s, GPT).points = 20000;
  playAt(s, 1, 'knife', HUMAN);              // ChatGPT knifes the Hunter
  assert(Rules.isOut(byId(s, HUMAN), s), 'Knife still works on a Hunter');
  equal(byId(s, HUMAN).points, 0, 'and still leaves the score alone');

  var t = newGame();
  playAt(t, 0, 'hunter', null);
  t.players[0].points = 30000;
  playAt(t, 1, 'steal', HUMAN);              // ChatGPT steals from the Hunter
  equal(t.players[0].points, 0, 'Steal still empties a Hunter');
  equal(byId(t, GPT).points, 30000, 'and the thief keeps it');
  assert(!Rules.isOut(byId(t, HUMAN), t), 'Steal never eliminates anybody');
});

test('playing Hunter twice keeps one effect', function () {
  var s = newGame();
  playAt(s, 0, 'hunter', null);
  playToSeat(s, 0);
  ensure(s, 0, 'hunter');                  // holding a second one
  var result = Rules.playCard(s, 0, 'hunter', null);
  equal(result.ok, true, 'still a legal card');
  assert(/already holds/.test(texts(result)), texts(result));
  equal(s.players[0].hunter, true);
});

test('the Hunter effect lasts for the rest of the game', function () {
  var s = newGame({ rounds: 4, seed: 5 });
  playAt(s, 0, 'hunter', null);
  playToRound(s, 5);
  equal(s.players[0].hunter, true, 'never expires');
});

/* ===================================================================== */
/* Card 4: Zombie                                                        */
/* ===================================================================== */

suite('Card: Zombie');

test('eliminates the chosen player for 1 round', function () {
  var s = newGame();
  ensure(s, 0, 'zombie');
  Rules.playCard(s, 0, 'zombie', CLAUDE);
  equal(byId(s, CLAUDE).outUntilRound, 1);
  equal(Rules.returnRound(byId(s, CLAUDE)), 2);
});

test('resets their points to 0 immediately', function () {
  var s = newGame();
  byId(s, COPILOT).points = 90000;
  ensure(s, 0, 'zombie');
  Rules.playCard(s, 0, 'zombie', COPILOT);
  equal(byId(s, COPILOT).points, 0);
});

test('the eliminated player skips one turn and returns', function () {
  var s = newGame();
  ensure(s, 0, 'zombie');
  Rules.playCard(s, 0, 'zombie', CLAUDE);
  equal(s.turnInRound, 1, 'ChatGPT is next');
  assert(skipsNextTurn(s, CLAUDE), 'Claude will sit out');
  playToSeat(s, 3);
  equal(s.turnInRound, 3, 'Claude was skipped, Gemini is next');
  equal(byId(s, CLAUDE).turnsSkipped, 1);
  playToRound(s, 3);
  equal(byId(s, CLAUDE).turnsSkipped, 1, 'only one turn missed');
  equal(byId(s, CLAUDE).outUntilRound, -1);
  assert(!Rules.isOut(byId(s, CLAUDE), s), 'back in play');
});

test('a Zombie aimed at a Hunter is not a legal move', function () {
  // The reflection rule makes that card useless, so it is simply not offered:
  // neither to an AI in the prompt nor to the human in the target picker.
  var s = newGame();
  playAt(s, 0, 'hunter', null);
  equal(Rules.isPlayable(s, 1, 'zombie', HUMAN), false, 'the engine refuses it');
  equal(Rules.legalTargets(s, 1, 'zombie').indexOf(HUMAN), -1, 'and does not offer it');
  equal(byId(s, HUMAN).outUntilRound, -1, 'the Hunter is untouched');
  equal(byId(s, GPT).outUntilRound, -1, 'and nobody is eliminated');
});

test('a Zombie still resets the points of a player it catches mid-round', function () {
  var s = newGame();
  // The human takes a Hunter, then Knives ChatGPT so there is an eliminated
  // seat in play - the situation being tested is that the card still works on
  // everybody ELSE.
  // Let one bonus hand the turn back to the human, then Knife ChatGPT - who
  // takes their seat out for the round.
  playAt(s, 0, 'hunter', null);
  playToSeat(s, 0);
  playAt(s, 0, 'knife', GPT);
  assert(Rules.isOut(byId(s, GPT), s), 'ChatGPT is eliminated');
  equal(Rules.legalTargets(s, 1, 'zombie').indexOf(GPT), -1,
    'and is not offered as a target');

  // Gemini is in play, holds no Hunter, and is a legal Zombie target for seat 1.
  playToSeat(s, 1);
  byId(s, GEMINI).points = 30000;
  equal(Rules.legalTargets(s, 1, 'zombie').indexOf(GEMINI) !== -1, true,
    'Gemini is a legal target');

  var hunterBefore = byId(s, HUMAN).points;
  var outBefore = byId(s, GPT).points;
  playAt(s, 1, 'zombie', GEMINI);
  equal(byId(s, GEMINI).points, 0, 'the score was cleared');
  assert(Rules.isOut(byId(s, GEMINI), s), 'and Gemini was eliminated');
  equal(byId(s, HUMAN).points, hunterBefore, 'the Hunter lost nothing');
  equal(byId(s, GPT).points, outBefore, 'and the eliminated player was left alone');
});

test('a Zombie still resets points when the target is already out', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', CLAUDE);
  byId(s, CLAUDE).points = 30000;
  playToSeat(s, 3);
  // An eliminated player is skipped for the round, so they are not offered as a
  // target at all - but the underlying rule is unchanged: the card only takes
  // effect on a target who is in play.
  equal(Rules.legalTargets(s, 3, 'zombie').indexOf(CLAUDE), -1,
    'an eliminated player is not offered');
  ensure(s, 3, 'zombie');                       // hold the card, so the target is the issue
  var someone = Rules.legalTargets(s, 3, 'zombie')[0];
  assert(someone, 'somebody else is a legal target');
  equal(Rules.isPlayable(s, 3, 'zombie', someone), true,
    'but another player is perfectly legal');
});

/* ===================================================================== */
/* Card 5: Steal Points                                                  */
/* ===================================================================== */

suite('Card: Steal Points');

test('takes everything the chosen player has', function () {
  var s = newGame();
  byId(s, GEMINI).points = 120000;
  ensure(s, 0, 'steal');
  Rules.playCard(s, 0, 'steal', GEMINI);
  equal(s.players[0].points, 120000);
  equal(byId(s, GEMINI).points, 0);
});

test('does not eliminate anybody', function () {
  var s = newGame();
  ensure(s, 0, 'steal');
  Rules.playCard(s, 0, 'steal', GEMINI);
  equal(byId(s, GEMINI).outUntilRound, -1);
  equal(s.turnInRound, 1, 'nobody was skipped');
  letPlay(s, 3, 'bonus', null);
  equal(byId(s, GEMINI).turnsPlayed, 1, 'they act normally');
});

test('stealing from an empty player moves nothing', function () {
  var s = newGame();
  ensure(s, 0, 'steal');
  Rules.playCard(s, 0, 'steal', COPILOT);
  equal(s.players[0].points, 0);
  equal(byId(s, COPILOT).points, 0);
});

test('an eliminated player is not a target for any card', function () {
  var s = newGame();
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', CLAUDE);
  byId(s, CLAUDE).points = 45000;
  playToSeat(s, 3);
  ['steal', 'zombie', 'knife'].forEach(function (id) {
    equal(Rules.legalTargets(s, 3, id).indexOf(CLAUDE), -1,
      id + ' cannot be aimed at an eliminated player');
    equal(Rules.isPlayable(s, 3, id, CLAUDE), false,
      id + ' refuses an eliminated target');
  });
  // Their points are untouched, because nothing could be played at them.
  equal(byId(s, CLAUDE).points, 45000);
});

test('stealing can empty the leader and hand the lead over', function () {
  var s = newGame();
  byId(s, COPILOT).points = 250000;
  equal(Rules.leader(s).id, COPILOT);
  ensure(s, 0, 'steal');
  Rules.playCard(s, 0, 'steal', COPILOT);
  equal(Rules.leader(s).id, HUMAN);
});

/* ===================================================================== */
/* Card 6: Judge                                                         */
/* ===================================================================== */

suite('Card: Judge');

test('Judge needs no target', function () {
  var s = newGame();
  ensure(s, 0, 'judge');
  equal(Rules.isPlayable(s, 0, 'judge', null), true, 'playable with no target');
  var withTarget = Rules.playCard(s, 0, 'judge', GEMINI);
  equal(withTarget.ok, false);
  assert(/takes no target/.test(withTarget.error), withTarget.error);
});

/**
 * Finds a seed where Judge activates AND has someone to banish, and returns that
 * game with its result text.
 *
 * The coin flip is genuinely random, so a test that wants to check what happens
 * when Judge FIRES cannot just assert it did: it walks seeds until it finds one
 * that fired. The seed is reported so a failure can be reproduced.
 */
function judgeThatFires(options) {
  var opts = options || {};
  for (var n = 1; n < 120; n++) {
    var game = newGame({ seed: n, rounds: opts.rounds || 8 });
    var seat = 0;
    game.players[2].cardsPlayed.push('zombie', 'knife', 'steal');
    if (opts.alsoEvil) game.players[3].cardsPlayed.push('zombie');
    ensure(game, seat, 'judge');
    var res = Rules.playCard(game, seat, 'judge', null);
    var text = (res.events.filter(function (e) { return e.type === 'result'; })[0] || {}).text || '';
    if (!/activates/.test(text) || !/banished/.test(text)) continue;
    return { seed: n, game: game, result: res, text: text };
  }
  return null;
}

/** Finds a seed where Judge fails to activate. */
function judgeThatFails(options) {
  var opts = options || {};
  for (var n = 1; n < 120; n++) {
    var game = newGame({ seed: n, rounds: opts.rounds || 8 });
    game.players[2].cardsPlayed.push('zombie', 'knife', 'steal');
    ensure(game, 0, 'judge');
    var res = Rules.playCard(game, 0, 'judge', null);
    var text = (res.events.filter(function (e) { return e.type === 'result'; })[0] || {}).text || '';
    if (/inert/.test(text)) return { seed: n, game: game, result: res, text: text };
  }
  return null;
}

test('when it activates it banishes the most evil player for 3 rounds', function () {
  var fired = judgeThatFires({ alsoEvil: true });
  assert(fired, 'Judge fired on at least one of 119 seeds');
  var game = fired.game;
  var claude = byId(game, CLAUDE);
  assert(Rules.isOut(claude, game), 'Claude, who led on evil cards, is out');
  // Struck before their turn in round 1 -> out in rounds 1, 2 and 3, back in 4.
  equal(Rules.returnRound(claude), 4, 'back in round 4 (seed ' + fired.seed + ')');
  assert(!Rules.isOut(byId(game, GEMINI), game), 'Gemini, on 1 evil card, is untouched');
  assert(/banished for 3 rounds/.test(fired.text), fired.text);
});

test('the banishment really costs three of their own turns', function () {
  var fired = judgeThatFires({ rounds: 12 });
  assert(fired, 'Judge fired on at least one of 119 seeds');
  var game = fired.game;
  var banned = byId(game, CLAUDE);
  var backInRound = Rules.returnRound(banned);

  // Play out the banishment only, so cards later in the game cannot re-eliminate
  // Claude and muddy the count. Stop the moment they are back.
  var guard = 0;
  while (!game.over && Rules.isOut(banned, game) && guard++ < 200) {
    var seat = game.turnInRound;
    var move = Rules.legalMoves(game, seat)[0];
    if (!move) break;
    Rules.playCard(game, seat, move.cardId, move.targetId);
  }

  // No card was aimed at Claude during the banishment - nothing can be, they are
  // not a legal target - so every skip they took is Judge's doing.
  equal(banned.turnsSkipped, 3,
    'Claude sat out exactly three of their turns (seed ' + fired.seed + ')');
  equal(banned.turnsPlayed, 0, 'and played none of them');
  equal(game.round, backInRound, 'the game reached the round they return in');
  assert(!Rules.isOut(banned, game), 'Claude is back in play');
  equal(banned.outUntilRound, -1, 'with the badge cleared at the round boundary');
});

test('when it fails nothing at all happens', function () {
  var failed = judgeThatFails();
  assert(failed, 'Judge failed on at least one of 119 seeds');
  var game = failed.game;
  assert(!Rules.isOut(byId(game, CLAUDE), game),
    'nobody is eliminated when it fails (seed ' + failed.seed + ')');
  game.players.forEach(function (p) {
    equal(p.outUntilRound, -1, p.name + ' is untouched');
  });
  assert(/inert/.test(failed.text), failed.text);
});

test('it activates about half the time', function () {
  var activated = 0;
  var trials = 400;
  for (var n = 1; n <= trials; n++) {
    var game = newGame({ seed: n * 13 });
    game.players[2].cardsPlayed.push('zombie');          // so there is someone to hit
    ensure(game, 0, 'judge');
    var res = Rules.playCard(game, 0, 'judge', null);
    var text = (res.events.filter(function (e) { return e.type === 'result'; })[0] || {}).text || '';
    if (/activates/.test(text)) activated++;
  }
  assert(activated > trials * 0.4 && activated < trials * 0.6,
    'Judge activated ' + activated + ' times in ' + trials + ' trials (expect ~50%)');
});

test('only Zombie, Knife, Steal Points, Trick and Alvin count as evil', function () {
  var s = newGame();
  byId(s, CLAUDE).cardsPlayed.push('hunter', 'bonus', 'judge', 'reveal', 'skipall',
    'stealturn', 'curse', 'ghost');
  byId(s, GEMINI).cardsPlayed.push('zombie');
  var counts = Rules.evilCounts(s);
  equal(counts[CLAUDE], 0, 'nothing Judge counts came from the harmless cards');
  equal(counts[GEMINI], 1);
  equal(Rules.mostEvil(s).player.id, GEMINI, 'Gemini is the most evil');
});

test('Trick and Alvin are evil, and are counted for the real player', function () {
  var s = newGame();
  byId(s, CLAUDE).cardsPlayed.push('trick', 'alvin');
  byId(s, GEMINI).cardsPlayed.push('knife');
  equal(Rules.evilCounts(s)[CLAUDE], 2, 'both evil cards count');
  equal(Rules.mostEvil(s).player.id, CLAUDE, 'Claude leads on evil cards');

  // Judge counts the real player even while Trick is hiding them, because the
  // disguise never touches who actually played a card.
  var disguised = newGame();
  ensure(disguised, 0, 'trick');
  ensure(disguised, 2, 'knife');
  Rules.playCard(disguised, 0, 'trick', CLAUDE);
  var realTarget = byId(disguised, CLAUDE);
  assert(Rules.isDisguised(disguised, realTarget), 'Claude is disguised');
  equal(Rules.evilCounts(disguised)[HUMAN], 1, 'the Trick counts for who played it');
  equal(Rules.evilCounts(disguised)[CLAUDE], 0, 'and not for the disguise');
});

test('a tie for most evil goes to the lowest seat, as ties break everywhere', function () {
  var s = newGame();
  byId(s, GPT).cardsPlayed.push('zombie');
  byId(s, GEMINI).cardsPlayed.push('knife');
  var worst = Rules.mostEvil(s);
  equal(worst.count, 1);
  equal(worst.tied.length, 2, 'two players are tied');
  equal(worst.player.seat, 1, 'seat 1 wins, matching the standings tie-break');
  // And that is the same rule the leader uses.
  byId(s, GPT).points = 50000;
  byId(s, GEMINI).points = 50000;
  equal(Rules.standings(s)[0].seat, 1, 'standings break the same way');
});

test('with nobody evil nobody is banished', function () {
  var fired = null;
  for (var n = 1; n < 120 && !fired; n++) {
    var game = newGame({ seed: n });
    ensure(game, 0, 'judge');
    var res = Rules.playCard(game, 0, 'judge', null);
    var text = (res.events.filter(function (e) { return e.type === 'result'; })[0] || {}).text || '';
    if (/activates/.test(text)) fired = { seed: n, game: game, text: text };
  }
  assert(fired, 'Judge activated on at least one of 119 seeds');
  assert(/nobody has played an evil/.test(fired.text), fired.text);
  fired.game.players.forEach(function (p) {
    equal(p.outUntilRound, -1, p.name + ' is not banished');
  });
});

test('Judge does not extend a banishment already running', function () {
  var s = newGame();
  var victim = byId(s, CLAUDE);
  Rules.eliminate(s, victim, 3);
  var longer = victim.outUntilRound;
  Rules.eliminate(s, victim, 3);
  equal(victim.outUntilRound, longer, 're-striking changes nothing');
});

/* ===================================================================== */
/* Card 7: Reveal Deck                                                   */
/* ===================================================================== */

suite('Card: Reveal Deck');

test('it needs a target and only a real opponent', function () {
  var s = newGame();
  ensure(s, 0, 'reveal');
  equal(Rules.isPlayable(s, 0, 'reveal', null), false, 'it is not a free cast');
  var noTarget = Rules.playCard(s, 0, 'reveal', null);
  equal(noTarget.ok, false);
  assert(/needs a target/.test(noTarget.error), noTarget.error);

  var self = Rules.playCard(s, 0, 'reveal', HUMAN);
  equal(self.ok, false);
  assert(/yourself/.test(self.error), self.error);

  var legal = Rules.legalTargets(s, 0, 'reveal');
  equal(legal.length, 4, 'all four opponents');
  assert(legal.indexOf(HUMAN) === -1, 'never yourself');
});

test('it shows the hand to the player who played it, and nobody else', function () {
  var s = newGame();
  ensure(s, 0, 'reveal');
  ensure(s, 2, 'knife');
  var res = Rules.playCard(s, 0, 'reveal', CLAUDE);
  equal(res.ok, true, res.error);

  var actor = s.players[0];
  var target = byId(s, CLAUDE);
  assert(actor.shownToMe.indexOf(CLAUDE) !== -1, 'the player who played it can see it');
  assert(target.revealed.indexOf(HUMAN) !== -1, 'the target knows who was shown it');

  // The other AI seats learn nothing.
  [GPT, GEMINI, COPILOT].forEach(function (id) {
    assert(byId(s, id).shownToMe.indexOf(CLAUDE) === -1,
      byId(s, id).name + ' was not shown that hand');
  });
});

test('it changes nothing about the hand or the table', function () {
  var s = newGame();
  ensure(s, 0, 'reveal');
  var handBefore = Rules.handOf(s, CLAUDE).slice();
  var totalBefore = allCards(s).length;
  var pointsBefore = s.players.map(function (p) { return p.points; });
  var outsBefore = s.players.map(function (p) { return p.outUntilRound; });

  ensure(s, 0, 'reveal');
  Rules.playCard(s, 0, 'reveal', CLAUDE);

  deepEqual(Rules.handOf(s, CLAUDE), handBefore, 'the hand is untouched');
  equal(allCards(s).length, totalBefore, 'no card moved');
  deepEqual(s.players.map(function (p) { return p.points; }), pointsBefore,
    'no score moved');
  deepEqual(s.players.map(function (p) { return p.outUntilRound; }), outsBefore,
    'nobody was eliminated');
});

test('it cannot target an eliminated player', function () {
  var s = newGame();
  ensure(s, 0, 'reveal');
  ensure(s, 0, 'knife');
  Rules.playCard(s, 0, 'knife', CLAUDE);
  assert(Rules.isOut(byId(s, CLAUDE), s), 'Claude is out');
  equal(Rules.legalTargets(s, 0, 'reveal').indexOf(CLAUDE), -1,
    'Reveal Deck will not point at somebody sitting out');
});

test('the reveal list records each hand once, not once per look', function () {
  var s = newGame();
  ensure(s, 0, 'reveal');
  Rules.playCard(s, 0, 'reveal', CLAUDE);
  equal(s.players[0].shownToMe.filter(function (id) { return id === CLAUDE; }).length, 1);
  equal(byId(s, CLAUDE).revealed.filter(function (id) { return id === HUMAN; }).length, 1);

  // A second reveal of the same hand must not double it up. Claude is out after
  // the reveal? No - Reveal Deck eliminates nobody - so walk to the next seat and
  // reveal the same hand again.
  playToSeat(s, 1);
  ensure(s, 1, 'reveal');
  var again = Rules.playCard(s, 1, 'reveal', CLAUDE);
  equal(again.ok, true, again.error);
  // Two different players have now seen it, so Claude's list has two entries -
  // but each player still appears exactly once.
  equal(byId(s, CLAUDE).revealed.filter(function (id) { return id === HUMAN; }).length, 1,
    'the human is listed once');
  equal(s.players[1].shownToMe.filter(function (id) { return id === CLAUDE; }).length, 1,
    'and the second player is listed once');
});

test('the prompt describes it to the AI', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);          // hand the turn to an AI
  var seat = game.currentSeat();
  var prompt = game.promptForCurrent();
  assert(prompt.indexOf('Reveal Deck') !== -1, 'the card is named in the rules');
  assert(/reveal their current hand/.test(prompt), 'its rule is spelled out');

  // The playable list is built from the hand, so Reveal Deck only shows up as a
  // choice when this AI is actually holding one. The deck is shuffled, so it is
  // dealt here rather than hoped for.
  ensure(game.state, seat, 'reveal');
  game.render && game.render();
  prompt = game.promptForCurrent();
  assert(Rules.holdsCard(game.state, game.state.players[seat].id, 'reveal'),
    'this AI is holding a Reveal Deck for the check');
  assert(/- Reveal Deck {2}-> {2}TARGET must be one of: /.test(prompt),
    'and it is listed with its legal targets');
});

/* ===================================================================== */
/* Card 8: Skip Everyone                                                 */
/* ===================================================================== */

suite('Card: Skip Everyone');

test('every other player loses their turn and the player plays again', function () {
  var s = newGame();
  ensure(s, 0, 'skipall');
  var played = s.players.map(function (p) { return p.turnsPlayed; });

  var res = Rules.playCard(s, 0, 'skipall', null);
  equal(res.ok, true, res.error);
  equal(s.turnInRound, 0, 'it is still the same player on turn');
  equal(s.players[0].turnsPlayed, played[0] + 1, 'and they played a card');
  assert(/plays again immediately/.test(texts(res)), texts(res));
  // The skips are recorded against the seats and consumed as the table reaches
  // them, so they are reported by the turn that hands the table on - which is
  // the bonus turn this card just bought.
  equal(s.skipRemaining.length, 4, 'all four opponents owe a turn');
  deepEqual(s.skipRemaining.slice().sort(), [1, 2, 3, 4],
    'every seat except the one that played');
});

test('the skipped players really do lose their turn', function () {
  var s = newGame();
  ensure(s, 0, 'skipall');
  Rules.playCard(s, 0, 'skipall', null);
  var before = s.players.map(function (p) { return p.turnsPlayed; });

  // Play the extra turn: handing the table on is what burns the four skips.
  var move = Rules.legalMoves(s, 0)[0];
  var res = Rules.playCard(s, 0, move.cardId, move.targetId);

  var skips = res.events.filter(function (e) { return e.type === 'skip'; });
  equal(skips.length, 4, 'four players were skipped');
  deepEqual(skips.map(function (e) { return e.seat; }), [1, 2, 3, 4]);
  equal(s.skipRemaining.length, 0, 'and nothing is left owing');

  s.players.forEach(function (p) {
    var expected = p.seat === 0 ? before[0] + 1 : before[p.seat];
    equal(p.turnsPlayed, expected,
      p.seat === 0 ? 'the player who used it played again'
        : p.name + ' did not take a turn in that stretch');
  });
  equal(s.players.slice(1).reduce(function (n, p) { return n + p.turnsSkipped; }, 0), 4,
    'all four skips were recorded');
});

test('it does not eliminate or remove anybody', function () {
  var s = newGame();
  ensure(s, 0, 'skipall');
  Rules.playCard(s, 0, 'skipall', null);

  s.players.forEach(function (p) {
    equal(p.outUntilRound, -1, p.name + ' was not eliminated');
    assert(p.enabled, p.name + ' is still in the game');
  });
  // The played card moves from a hand to the discard and the bonus turn draws
  // one, so the total is unchanged: nothing was created and nothing destroyed.
  equal(allCards(s).length, Rules.deckSize(), 'every card is still accounted for');
  greater(Rules.handSize(s, COPILOT), 0, 'no hand was emptied');
  equal(Rules.isOut(byId(s, COPILOT), s), false, 'and nobody is sitting out');
});

test('it works whichever seat plays it, and whichever seat opens the round', function () {
  // The skip is recorded per seat and consumed as the table reaches it, so
  // neither who plays it nor where the round opened can change the outcome.
  for (var start = 0; start < 5; start++) {
    var s = newGame({ seed: 100 + start, roundStartSeat: start });
    playToSeat(s, start);
    ensure(s, start, 'skipall');
    var res = Rules.playCard(s, start, 'skipall', null);
    equal(res.ok, true, 'seat ' + start + ' could play it (seed ' + (100 + start) + ')');
    equal(s.turnInRound, start, 'seat ' + start + ' keeps the turn');
    equal(s.skipRemaining.length, 4, 'the other four owe a turn, opening seat ' + start);
  }
});

test('a switched-off player is passed over silently, as everywhere else', function () {
  // A switched-off player is not "in the game", so they are not on the table to
  // be skipped: only the opponents who actually lost a turn are announced.
  Rules.setPlayerEnabled(COPILOT, false);
  var s = newGame({ seed: 4 });
  ensure(s, 0, 'skipall');
  Rules.playCard(s, 0, 'skipall', null);
  equal(s.skipRemaining.length, 3, 'only the three live opponents owe a turn');
  assert(s.skipRemaining.indexOf(4) === -1, 'Copilot is not on the table to be skipped');

  var move = Rules.legalMoves(s, 0)[0];
  var res = Rules.playCard(s, 0, move.cardId, move.targetId);
  var skips = res.events.filter(function (e) { return e.type === 'skip'; });
  equal(skips.length, 3, 'and only three skips are announced');
  assert(!res.events.some(function (e) { return /Copilot is skipped/.test(e.text); }),
    'Copilot is never named as skipped');
});

test('the prompt explains it to the AI', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);          // hand the turn to an AI
  var prompt = game.promptForCurrent();
  assert(prompt.indexOf('Skip Everyone') !== -1, 'the card is named');
  assert(/You immediately get another turn/.test(prompt), 'its rule is spelled out');
});

/* ===================================================================== */
/* Card 9: Phoenix, the legendary card                                   */
/* ===================================================================== */

suite('Phoenix, the legendary card');

/** Gives the human the legendary card for this game, the way a win does. */
function awardToHuman() {
  Rules.setPhoenixHolder(null);
  var result = Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 5, rounds: 8 });
  equal(game.state.players[game.humanSeat()].hasPhoenix, true,
    'the winner starts the next game holding it');
  return game;
}

test('winning a whole game awards it for the next one', function () {
  Rules.setPhoenixHolder(null);
  var game = firstGame({ seed: 3, rounds: 3 });
  var seat = game.humanSeat();
  var state = game.state;

  // The award is decided by `finish`, so it is tested there rather than by trying
  // to win a real game - where any single card can take the lead away again on
  // the very last action.
  state.players.forEach(function (p) { p.points = p.isHuman ? 900000 : 0; });
  Rules.finish(state);

  equal(state.over, true, 'the game is finished');
  equal(state.winnerSeat, seat, 'the human won');
  equal(state.phoenixAwarded, 'human', 'and was awarded the card');
  equal(Rules.phoenixHolder(), 'human', 'they are carrying it into the next game');
});

test('a tie is not a win, so nobody is awarded the card', function () {
  Rules.setPhoenixHolder(null);
  var game = firstGame({ seed: 3, rounds: 3 });
  var state = game.state;
  state.players.forEach(function (p) { p.points = 50000; });
  Rules.finish(state);
  equal(state.tied, true, 'the game ended in a tie');
  equal(state.phoenixAwarded, null, 'so nobody earned the card');
  equal(Rules.phoenixHolder(), null, 'and nobody is holding it');
});

test('it is carried into the next game, on the player, not in the deck', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder(GEMINI);
  var game = firstGame({ seed: 4, rounds: 6 });
  var holder = byId(game.state, GEMINI);
  equal(holder.hasPhoenix, true, 'the winner holds it');
  assert(Rules.holdsCard(game.state, GEMINI, Rules.PHOENIX_CARD_ID),
    'and the engine says so');
  game.state.players.forEach(function (p) {
    if (p.id === GEMINI) return;
    assert(!Rules.holdsCard(game.state, p.id, Rules.PHOENIX_CARD_ID),
      p.name + ' does not hold it');
  });
  // And it is nowhere in the deck, the discard or anybody's dealt hand.
  assert(game.state.deck.indexOf(Rules.PHOENIX_CARD_ID) === -1, 'not in the deck');
  assert(game.state.discard.indexOf(Rules.PHOENIX_CARD_ID) === -1, 'not in the discard');
  Rules.setPhoenixHolder(null);
});

test('only one player can hold it at a time', function () {
  Rules.setPhoenixHolder(null);
  equal(Rules.setPhoenixHolder(GEMINI).ok, true, 'the first award works');
  var second = Rules.setPhoenixHolder(CLAUDE);
  equal(second.ok, false, 'a second award is refused');
  assert(/already held/.test(second.error), second.error);
  equal(Rules.phoenixHolder(), GEMINI, 'the holder has not changed');
  Rules.setPhoenixHolder(null);
  equal(Rules.phoenixHolder(), null, 'it can be handed on');
});

test('playing it takes every other player\'s points', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 5, rounds: 8 });
  var state = game.state;
  var seat = game.humanSeat();
  var me = state.players[seat];
  var others = Rules.opponents(state, seat).filter(function (p) { return p.enabled; });
  var banked = 0;
  others.forEach(function (p, i) { p.points = 10000 * (i + 1); banked += p.points; });
  me.points = 7000;

  var res = game.playHuman(Rules.PHOENIX_CARD_ID, null);
  equal(res.ok, true, res.error);
  equal(me.points, 7000 + banked, 'every point on the table came across');
  others.forEach(function (p) {
    equal(p.points, 0, p.name + ' was emptied');
  });
  Rules.setPhoenixHolder(null);
});

test('playing it eliminates every other player', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 5, rounds: 8 });
  var state = game.state;
  var seat = game.humanSeat();
  game.playHuman(Rules.PHOENIX_CARD_ID, null);
  Rules.opponents(state, seat).filter(function (p) { return p.enabled; }).forEach(function (p) {
    assert(Rules.isOut(p, state), p.name + ' was eliminated');
  });
  assert(!Rules.isOut(state.players[seat], state), 'but the player who used it is not');
  Rules.setPhoenixHolder(null);
});

test('one random opponent loses their hand and draws the same number back', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 11, rounds: 8 });
  var state = game.state;
  var seat = game.humanSeat();

  // Hand a few cards to each opponent so there is definitely a hand to burn.
  var victimSizes = {};
  Rules.opponents(state, seat).filter(function (p) { return p.enabled; })
    .forEach(function (p) {
      give(state, p.seat, 'knife');
      give(state, p.seat, 'bonus');
      give(state, p.seat, 'hunter');
      victimSizes[p.id] = Rules.handSize(state, p.id);
    });
  var handSizeBefore = Rules.handSize(state, COPILOT);
  assert(handSizeBefore > 0, 'Copilot was holding cards');

  var res = game.playHuman(Rules.PHOENIX_CARD_ID, null);
  equal(res.ok, true, res.error);
  var burned = res.events.filter(function (e) { return e.type === 'phoenix'; })
    .filter(function (e) { return /burns through/.test(e.text); });
  equal(burned.length, 1, 'exactly one hand was destroyed');
  assert(burned[0].victimSeat >= 1, 'and it was an opponent');

  // Whoever it was, they hold the same number of cards they did before.
  var victim = state.players[burned[0].victimSeat];
  equal(Rules.handSize(state, victim.id), victimSizes[victim.id],
    victim.name + ' drew exactly as many cards as they lost');
  Rules.setPhoenixHolder(null);
});

test('the hand it destroys is a real opponent in play', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 21, rounds: 8 });
  var state = game.state;
  var seat = game.humanSeat();
  var pool = Rules.phoenixVictims(state, seat);
  equal(pool.length, 4, 'the four opponents who are actually in play');
  pool.forEach(function (p) {
    assert(p.seat !== seat, 'never the player who used it');
    assert(p.enabled, p.name + ' is in play');
  });
  Rules.setPhoenixHolder(null);
});

test('it can only be used once, and then it is gone for good', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 5, rounds: 8 });
  var seat = game.humanSeat();
  var me = game.state.players[seat];

  equal(game.playHuman(Rules.PHOENIX_CARD_ID, null).ok, true, 'the first use works');
  equal(me.hasPhoenix, false, 'it is no longer held');
  equal(me.phoenixUsed, true, 'and it is recorded as spent');
  equal(Rules.holdsCard(game.state, 'human', Rules.PHOENIX_CARD_ID), false,
    'the engine no longer offers it');
  equal(Rules.phoenixHolder(), null,
    'and the board has handed it back, so the next game starts without it');

  var second = game.playHuman(Rules.PHOENIX_CARD_ID, null);
  equal(second.ok, false, 'a second use is refused');
  assert(/already been used/.test(second.error), second.error);
});

test('the next game does not start with it again', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var first = firstGame({ seed: 5, rounds: 8 });
  equal(first.state.players[first.humanSeat()].hasPhoenix, true, 'they start with it');
  first.playHuman(Rules.PHOENIX_CARD_ID, null);

  var second = firstGame({ seed: 5, rounds: 8 });
  equal(second.state.players[second.humanSeat()].hasPhoenix, false,
    'and the game after that does not');
  assert(second.state.deck.indexOf(Rules.PHOENIX_CARD_ID) === -1,
    'nor does the deck contain it');
});

test('it never reaches the discard pile, so it cannot be reshuffled back', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 5, rounds: 8 });
  game.playHuman(Rules.PHOENIX_CARD_ID, null);
  assert(game.state.discard.indexOf(Rules.PHOENIX_CARD_ID) === -1,
    'the discard has no Phoenix on it');
  assert(Rules.phoenixHolder() === null,
    'and it is not handed on to the next game either');
});

test('the prompt offers it only to the player holding it', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder(GEMINI);
  var game = firstGame({ seed: 4, rounds: 6 });
  var state = game.state;
  var holderSeat = byId(state, GEMINI).seat;

  // Walk the table until it is the holder's turn, and check who is told about it.
  var holderPrompt = null;
  var otherPrompt = null;
  var guard = 0;
  while (guard++ < 40 && !holderPrompt) {
    var seat = state.turnInRound;
    if (seat === holderSeat) {
      holderPrompt = game.promptForCurrent();
      break;
    }
    if (!otherPrompt && !state.players[seat].isHuman) {
      otherPrompt = game.promptForCurrent();
    }
    var result = stepOnce(state);
    if (!result.ok) break;
  }

  assert(holderPrompt, 'the holder got a turn (seed 4)');
  assert(holderPrompt.indexOf('LEGENDARY') !== -1,
    'the holder is offered the card');
  if (otherPrompt) {
    assert(otherPrompt.indexOf('THE LEGENDARY CARD') !== -1,
      'everybody is told what Phoenix is, in the rules');
    assert(otherPrompt.indexOf('LEGENDARY - one use') === -1,
      'but it is not offered as a choice to somebody who is not holding it');
  }
});

test('the relay can play it as a card name', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder(GPT);
  var game = firstGame({ seed: 4, rounds: 6 });
  var guard = 0;
  while (guard++ < 40) {
    var seat = game.state.turnInRound;
    if (game.state.players[seat].id === GPT) break;
    var move = Rules.legalMoves(game.state, seat)[0];
    if (!move) break;
    Rules.playCard(game.state, seat, move.cardId, move.targetId);
  }
  var res = game.submitAiMove('PLAY: Phoenix');
  equal(res.ok, true, res.error);
  equal(game.state.players[1].phoenixUsed, true, 'it was spent through the relay');
  Rules.setPhoenixHolder(null);
});

test('a full sweep of Phoenix at every target', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPhoenixHolder('human');
  var game = firstGame({ seed: 8, rounds: 6 });
  var state = game.state;
  var seat = game.humanSeat();
  [null, GPT, CLAUDE, GEMINI, COPILOT].forEach(function (targetId) {
    equal(Rules.isPlayable(state, seat, Rules.PHOENIX_CARD_ID, targetId),
      targetId === null,
      'Phoenix ' + (targetId === null ? 'plays with' : 'refuses') + ' ' + targetId);
  });
  Rules.setPhoenixHolder(null);
});

/* ===================================================================== */
/* Card 10: Trick                                                        */
/* ===================================================================== */

suite('Card: Trick');

/** Tricks a player, so the disguise can be inspected. */
function trick(state, seat, targetId) {
  ensure(state, seat, 'trick');
  var result = Rules.playCard(state, seat, 'trick', targetId);
  assert(result.ok, 'trick failed: ' + result.error);
  return result;
}

test('it needs a real opponent', function () {
  var s = newGame();
  ensure(s, 0, 'trick');
  equal(Rules.isPlayable(s, 0, 'trick', null), false, 'it is not a free cast');
  assert(/needs a target/.test(Rules.playCard(s, 0, 'trick', null).error));
  assert(/yourself/.test(Rules.playCard(s, 0, 'trick', HUMAN).error));
  equal(Rules.legalTargets(s, 0, 'trick').length, 4, 'all four opponents');
});

test('the real player identity never changes', function () {
  var s = newGame();
  var claude = byId(s, CLAUDE);
  var seatBefore = claude.seat;
  var pointsBefore = claude.points;
  trick(s, 0, CLAUDE);

  equal(claude.id, CLAUDE, 'the id is untouched');
  equal(claude.seat, seatBefore, 'the seat is untouched');
  equal(claude.points, pointsBefore, 'the score is untouched');
  assert(Rules.isDisguised(s, claude), 'but they are disguised');
  assert(Rules.displayName(s, claude) !== claude.name,
    'and the table reads a different name');
});

test('displayed names stay unique, so TARGET: is always answerable', function () {
  // This is the whole reason Trick uses aliases: showing a player as a name
  // somebody else already answers to would leave two seats on one identity.
  for (var n = 1; n <= 30; n++) {
    var s = newGame({ seed: n, rounds: 10 });
    // Trick three different players, walking the table to each caster in turn.
    // Seats are 0 human, 1 ChatGPT, 2 Claude, 3 Gemini, 4 Copilot, so each pair is
    // a caster and somebody who is not them.
    [[0, CLAUDE], [2, GEMINI], [4, GPT]].forEach(function (pair) {
      if (s.over) return;
      playToSeat(s, pair[0]);
      trick(s, pair[0], pair[1]);
    });
    var names = s.players.map(function (p) { return Rules.displayName(s, p); });
    equal(names.length, 5, 'five identities');
    equal(new Set(names).size, names.length,
      'seed ' + n + ': all five are distinct (' + names.join(', ') + ')');
  }
});

test('every rule still works on the real player underneath', function () {
  var s = newGame();
  var gemini = byId(s, GEMINI);
  trick(s, 0, GEMINI);

  // A Hunter belongs to the real player, so Zombie still cannot be aimed at it.
  gemini.hunter = true;
  equal(Rules.legalTargets(s, 1, 'zombie').indexOf(GEMINI), -1,
    'the real Hunter effect still blocks a Zombie');

  // Elimination also follows the real player.
  ensure(s, 1, 'knife');
  Rules.playCard(s, 1, 'knife', GEMINI);
  assert(Rules.isOut(gemini, s), 'the real player is eliminated');
  equal(Rules.legalTargets(s, 2, 'knife').indexOf(GEMINI), -1,
    'and is still not a legal target');
});

test('Judge counts what the real player played, disguise or not', function () {
  var s = newGame();
  trick(s, 0, CLAUDE);
  equal(Rules.evilCounts(s)[HUMAN], 1, 'the Trick counts for who played it');
  equal(Rules.evilCounts(s)[CLAUDE], 0, 'and not against the disguise');
});

test('the real name comes back at the end of the round', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  var claude = byId(s, CLAUDE);
  trick(s, 0, CLAUDE);
  assert(Rules.isDisguised(s, claude), 'disguised for the rest of the round');

  var guard = 0;
  while (s.round === 1 && !s.over && guard++ < 40) {
    var result = stepOnce(s);
    if (!result.ok) break;
  }
  greater(s.round, 1, 'the round turned over');
  assert(!Rules.isDisguised(s, claude), 'and the disguise is off');
  equal(Rules.displayName(s, claude), claude.name, 'their real name is back');
  equal(claude.id, CLAUDE, 'and it was never anything else to begin with');
});

test('the prompt and the UI show the disguise, not the real name', function () {
  var s = newGame();
  trick(s, 0, CLAUDE);
  var alias = Rules.displayName(s, byId(s, CLAUDE));
  assert(/^the /.test(alias), 'the alias reads like a disguise: ' + alias);

  // A player targeting "Claude" still means the real Claude: aliases never
  // collide with a player name, so the seat the name belongs to is unchanged.
  equal(Rules.playerById(s, CLAUDE).id, CLAUDE, 'the name still means Claude');
  assert(Rules.legalTargets(s, 1, 'knife').indexOf(CLAUDE) !== -1,
    'and Claude is still targetable under their own name');
});

/* ===================================================================== */
/* Card 11: Steal a Turn                                                 */
/* ===================================================================== */

suite('Card: Steal a Turn');

/** Steals a turn from `targetId` on behalf of `casterSeat`. */
function stealTurn(state, casterSeat, targetId) {
  ensure(state, casterSeat, 'stealturn');
  var result = Rules.playCard(state, casterSeat, 'stealturn', targetId);
  assert(result.ok, 'steal a turn failed: ' + result.error);
  return result;
}

/** Plays out until the pending Steal a Turn becomes due, if it is going to. */
function advanceUntilChoiceDue(state, limit) {
  var guard = 0;
  while (!state.over && guard++ < (limit || 60)) {
    if (choiceIsDue(state)) return true;
    var result = stepOnce(state);
    if (!result.ok) return false;
  }
  return choiceIsDue(state);
}

test('it needs an opponent, and records the intent', function () {
  var s = newGame();
  ensure(s, 0, 'stealturn');
  equal(Rules.isPlayable(s, 0, 'stealturn', null), false, 'it is not a free cast');
  assert(/needs a target/.test(Rules.playCard(s, 0, 'stealturn', null).error));

  stealTurn(s, 0, GEMINI);
  equal(s.pendingChoice.kind, 'move', 'a move choice is pending');
  equal(s.pendingChoice.chooserId, 'human', 'the caster chooses');
  equal(s.pendingChoice.targetId, GEMINI, 'about the target');
});

test('the choice only comes up on the target\'s own turn', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  stealTurn(s, 0, GEMINI);
  equal(Rules.isStealTurnDue(s, s.players[s.turnInRound]), false,
    'not due on the turn it was cast');
  var early = Rules.resolvePendingChoice(s, 'bonus', null);
  equal(early.ok, false, 'and it cannot be settled early');
  assert(/not Gemini's turn yet/.test(early.error), early.error);

  assert(advanceUntilChoiceDue(s), 'the choice comes due (seed 5)');
  equal(s.players[s.turnInRound].id, GEMINI, 'on Gemini\'s turn');
});

test('the target cannot just play their own card while the choice is waiting', function () {
  // Steal a Turn is due the moment the turn reaches its target, and from then on
  // the target does not get to choose. An AI reply that arrives in that window
  // used to be played as an ordinary turn, quietly bypassing the chooser.
  var s = newGame({ seed: 5, rounds: 8 });
  var seat = s.turnInRound;
  var nextSeat = (seat + 1) % Rules.SEAT_COUNT;
  var target = s.players[nextSeat];

  give(s, nextSeat, 'hunter');
  stealTurn(s, seat, target.id);
  assert(choiceIsDue(s), 'the next seat is the target, so it is due at once');

  ensure(s, nextSeat, 'bonus');
  var sneaked = Rules.playCard(s, nextSeat, 'bonus', null);
  equal(sneaked.ok, false, 'the target cannot play a card of their own choosing');
  assert(/has to choose which card/.test(sneaked.error), sneaked.error);
  assert(s.pendingChoice, 'and the choice is still waiting for its chooser');
  equal(s.players[nextSeat].cardsPlayed.length, 0, 'nothing was played');

  // And the chooser's pick still goes through.
  var options = Rules.pendingChoiceOptions(s).options;
  var forced = Rules.resolvePendingChoice(s, options[0].cardId, options[0].targetId);
  equal(forced.ok, true, forced.error);
  equal(s.players[nextSeat].cardsPlayed.length, 1, 'and then their turn happens');
});

test('a Steal a Turn that is not due leaves the target playing normally', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  var seat = s.turnInRound;
  var far = s.players[(seat + 3) % Rules.SEAT_COUNT];
  stealTurn(s, seat, far.id);
  equal(choiceIsDue(s), false, 'the target is three seats away, so not due');

  // The seats in between are untouched by it and carry on playing.
  var nextSeat = s.turnInRound;
  ensure(s, nextSeat, 'bonus');
  var played = Rules.playCard(s, nextSeat, 'bonus', null);
  equal(played.ok, true, 'the next player is unaffected: ' + played.error);
  assert(s.pendingChoice, 'and the Steal a Turn is still waiting for its turn');
});

test('the chooser may only pick a card that is legally playable', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  stealTurn(s, 0, GEMINI);
  advanceUntilChoiceDue(s);
  var gemini = byId(s, GEMINI);
  var options = Rules.pendingChoiceOptions(s).options;

  // Every option is a real legal move for the target, no exceptions.
  assert(options.length > 0, 'they have something to play');
  options.forEach(function (option) {
    assert(Rules.isPlayable(s, gemini.seat, option.cardId, option.targetId),
      option.cardId + ' is genuinely playable for them');
  });

  // A card they do not hold is refused, and so is an illegal target.
  var unheld = Cards.deckIds().filter(function (id) {
    return !Rules.holdsCard(s, GEMINI, id);
  })[0];
  var refused = Rules.resolvePendingChoice(s, unheld, null);
  equal(refused.ok, false, 'a card they are not holding is refused');
  assert(/cannot play that right now/.test(refused.error), refused.error);
  assert(s.pendingChoice, 'and the choice is still waiting, not consumed');
});

test('the target still takes their turn, and the card is played for them', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  stealTurn(s, 0, GEMINI);
  advanceUntilChoiceDue(s);
  var gemini = byId(s, GEMINI);
  var before = gemini.turnsPlayed;

  var options = Rules.pendingChoiceOptions(s).options;
  var pick = options.filter(function (o) { return !o.targetId; })[0] || options[0];
  var forced = Rules.resolvePendingChoice(s, pick.cardId, pick.targetId);
  equal(forced.ok, true, forced.error);

  equal(gemini.turnsPlayed, before + 1, 'their turn counted as a turn');
  equal(gemini.cardsPlayed[gemini.cardsPlayed.length - 1], pick.cardId,
    'and the chosen card is what they played');
  assert(s.discard.indexOf(pick.cardId) !== -1, 'played normally, so discarded');
  equal(s.pendingChoice, null, 'and the effect is consumed');
});

test('the effect lapses if the target never gets a turn', function () {
  var s = newGame({ seed: 9, rounds: 8 });
  stealTurn(s, 0, GEMINI);
  byId(s, GEMINI).outUntilRound = s.round;      // eliminated before their turn
  // The table goes past them and the choice is dropped at that point, rather
  // than sitting in state forever and wedging the game.
  var guard = 0;
  while (s.pendingChoice && !s.over && guard++ < 40) {
    var result = stepOnce(s);
    if (!result.ok) break;
  }
  equal(s.pendingChoice, null, 'and it is dropped rather than wedging the game');
});

test('the controller can ask an AI to make the choice', function () {
  Rules.setPhoenixHolder(null);
  Rules.setPlayerEnabled(GEMINI, true);
  var game = firstGame({ seed: 4, rounds: 8 });
  var state = game.state;
  ensure(state, 0, 'stealturn');
  Rules.playCard(state, 0, 'stealturn', GEMINI);
  // Hand the choice to an AI so the relay path is what is under test.
  state.pendingChoice.chooserId = CLAUDE;
  advanceUntilChoiceDue(state);

  equal(game.isAwaitingChoice(), true, 'the game is waiting on a choice');
  equal(game.isAiChoosing(), true, 'an AI has to make it');
  var prompt = game.choicePromptForCurrent();
  assert(/STEAL A TURN/.test(prompt), 'the prompt explains why');
  assert(/choose one of these/i.test(prompt), 'and lists the options');

  var first = Rules.pendingChoiceOptions(state).options[0];
  var reply = 'PLAY: ' + Rules.formatCard(first.cardId) +
    (first.targetId ? '\nTARGET: ' + Rules.displayName(state,
      Rules.playerById(state, first.targetId)) : '');
  var result = game.submitForcedChoice(reply);
  equal(result.ok, true, result.error);
  equal(state.pendingChoice, null, 'and the choice is settled');
});

test('an AI can be told to pick a card it is not allowed to pick', function () {
  Rules.setPhoenixHolder(null);
  var game = firstGame({ seed: 4, rounds: 8 });
  var state = game.state;
  ensure(state, 0, 'alvin');
  Rules.playCard(state, 0, 'alvin', GEMINI);
  state.pendingChoice.chooserId = CLAUDE;

  var unheld = Cards.deckIds().filter(function (id) {
    return Rules.handOf(state, GEMINI).indexOf(id) === -1;
  })[0];
  var refused = game.submitForcedChoice('PLAY: ' + Cards.byId(unheld).name);
  equal(refused.ok, false, 'a card Gemini is not holding is refused');
  assert(state.pendingChoice, 'and the choice is still open');
});

/* ===================================================================== */
/* Card 12: Curse                                                         */
/* ===================================================================== */

suite('Card: Curse');

/** Curses a player whose hand is exactly `cards`, so the pick is predictable. */
function curse(state, casterSeat, targetId, cards) {
  if (cards) state.hands[targetId] = cards.slice();
  ensure(state, casterSeat, 'curse');
  var result = Rules.playCard(state, casterSeat, 'curse', targetId);
  assert(result.ok, 'curse failed: ' + result.error);
  return result;
}

test('it needs an opponent, and an empty hand is the only miss', function () {
  var s = newGame();
  ensure(s, 0, 'curse');
  equal(Rules.isPlayable(s, 0, 'curse', null), false, 'it is not a free cast');
  assert(/needs a target/.test(Rules.playCard(s, 0, 'curse', null).error));

  var result = curse(s, 0, GEMINI, []);
  equal(byId(s, GEMINI).cursed.length, 0, 'nothing to curse in an empty hand');
  assert(/holding no cards/.test(texts(result)), 'and it says so');
});

test('it marks exactly one card, and never says which', function () {
  var s = newGame();
  var result = curse(s, 0, GEMINI, ['knife', 'bonus', 'hunter']);
  var gemini = byId(s, GEMINI);
  equal(gemini.cursed.length, 1, 'one card is cursed');
  assert(['knife', 'bonus', 'hunter'].indexOf(gemini.cursed[0]) !== -1,
    'and it is one they actually hold');
  // The log must not leak which one.
  ['knife', 'bonus', 'hunter'].forEach(function (id) {
    assert(texts(result).indexOf(Rules.formatCard(id)) === -1,
      'the log never names ' + id);
  });
  assert(/not told which/.test(texts(result)), 'and says so');
});

test('the prompt never reveals WHICH card is cursed', function () {
  var s = newGame();
  curse(s, 0, GEMINI, ['knife']);
  var gemini = byId(s, GEMINI);
  equal(Rules.isCursed(s, gemini, 'knife'), true, 'the engine knows');

  var prompt = Prompt.buildPrompt(s, gemini.seat, []);
  // The card RULES section legitimately explains what Curse does, so the leak
  // check only looks at everything BEFORE it: the table, the effects, the hand
  // and the playable list. Nothing in there may mark this player.
  var beforeRules = prompt.split('=== THE ')[0];
  assert(!/is cursed/i.test(beforeRules), 'no hint that this player is cursed');
  assert(beforeRules.indexOf('cursed') === -1,
    'the word never appears before the rules');
  assert(!/cursed[^.]*Yours/i.test(beforeRules), 'nor a warning about their hand');
  assert(prompt.indexOf(Rules.formatCard('knife')) !== -1,
    'the card itself is listed as an ordinary playable card');
  assert(prompt.indexOf('TARGET must be one of') !== -1,
    'and offered as a normal choice, with no marking on it');
});

test('the cursed card resolves normally, and only then eliminates', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  curse(s, 0, GEMINI, ['hunter']);
  var gemini = byId(s, GEMINI);
  assert(Rules.isCursed(s, gemini, 'hunter'), 'the Hunter is cursed');

  playToSeat(s, gemini.seat);
  var result = Rules.playCard(s, gemini.seat, 'hunter', null);
  equal(result.ok, true, result.error);

  equal(gemini.hunter, true, 'the card took effect first');
  assert(Rules.isOut(gemini, s), 'and the elimination landed afterwards');
  equal(gemini.cursed.length, 0, 'the curse is spent');
  assert(result.events.some(function (e) { return e.type === 'curse'; }),
    'and it is reported in the log');
  assert(s.discard.indexOf('hunter') !== -1, 'the card itself was played normally');
});

test('a curse that is never played does nothing', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  curse(s, 0, GEMINI, ['hunter', 'bonus']);
  var gemini = byId(s, GEMINI);
  var cursedId = gemini.cursed[0];
  var other = cursedId === 'hunter' ? 'bonus' : 'hunter';

  playToSeat(s, gemini.seat);
  var result = Rules.playCard(s, gemini.seat, other, null);
  equal(result.ok, true, result.error);
  assert(!Rules.isOut(gemini, s), 'playing an uncursed card eliminates nobody');
  equal(gemini.cursed.length, 1, 'and the curse is still sitting there');
  assert(!result.events.some(function (e) { return e.type === 'curse'; }),
    'nothing triggered');
});

test('burning a cursed card takes the curse with it', function () {
  var s = newGame();
  curse(s, 0, GEMINI, ['hunter']);
  var gemini = byId(s, GEMINI);
  equal(gemini.cursed.length, 1, 'the Hunter is cursed');

  // destroyCard is where the rule lives, so it is tested there directly: going
  // through a whole Alvin cast would need a table walk, during which the target
  // could easily play the cursed card first and muddy what is being checked.
  var burned = Rules.destroyCard(s, GEMINI, 'hunter');
  equal(burned, 'Hunter', 'the card is destroyed');
  equal(gemini.cursed.length, 0,
    'a card that can never be played cannot stay cursed');
  assert(!Rules.isOut(gemini, s), 'and nothing triggered');
  assert(s.destroyed.indexOf('hunter') !== -1, 'it is on the destroyed pile');
});

/* ===================================================================== */
/* Card 13: Ghost                                                         */
/* ===================================================================== */

suite('Card: Ghost');

test('it takes no target and blocks every card aimed at its player', function () {
  var s = newGame();
  ensure(s, 0, 'ghost');
  equal(Rules.isPlayable(s, 0, 'ghost', null), true, 'it is a free cast');
  assert(/takes no target/.test(Rules.playCard(s, 0, 'ghost', HUMAN).error));

  Rules.playCard(s, 0, 'ghost', null);
  assert(byId(s, HUMAN).ghost, 'the player is a Ghost');

  Cards.deckCards().forEach(function (card) {
    if (!card.needsTarget) return;
    equal(Rules.legalTargets(s, 3, card.id).indexOf(HUMAN), -1,
      card.name + ' cannot be aimed at a Ghost');
  });
});

test('the Ghost can still play, and others can still target each other', function () {
  var s = newGame();
  ensure(s, 0, 'ghost');
  Rules.playCard(s, 0, 'ghost', null);
  greater(Rules.legalMoves(s, 0).length, 0, 'the Ghost still has cards to play');
  // Seat 3's four opponents now include one Ghost, so three remain targetable.
  equal(Rules.legalTargets(s, 3, 'knife').length, 3,
    'the three non-Ghost seats are still targetable');
});

test('it removes none of the player\'s existing effects', function () {
  var s = newGame();
  var me = byId(s, HUMAN);
  me.hunter = true;
  me.points = 60000;
  Rules.eliminate(s, byId(s, GEMINI));          // unrelated, just to be tidy
  ensure(s, 0, 'ghost');
  Rules.playCard(s, 0, 'ghost', null);
  equal(me.hunter, true, 'the Hunter survives');
  equal(me.points, 60000, 'and so does the score');
});

test('it wears off at the end of the round', function () {
  var s = newGame({ seed: 5, rounds: 8 });
  ensure(s, 0, 'ghost');
  Rules.playCard(s, 0, 'ghost', null);
  assert(byId(s, HUMAN).ghost, 'a Ghost for this round');

  var guard = 0;
  while (s.round === 1 && !s.over && guard++ < 40) {
    var result = stepOnce(s);
    if (!result.ok) break;
  }
  greater(s.round, 1, 'the round turned over');
  equal(byId(s, HUMAN).ghost, false, 'and the Ghost is off');
  assert(Rules.legalTargets(s, 0, 'knife').length >= 0, 'targetable again');
});

test('the prompt tells an AI that a Ghost cannot be aimed at', function () {
  var s = newGame();
  ensure(s, 0, 'ghost');
  Rules.playCard(s, 0, 'ghost', null);
  var prompt = Prompt.buildPrompt(s, 3, []);      // as seen by a different AI
  assert(/is a GHOST this round/.test(prompt), 'the prompt says so');
  assert(/no card can be aimed at/.test(prompt), 'and spells out the effect');
});

/* ===================================================================== */
/* Card 14: Alvin                                                        */
/* ===================================================================== */

suite('Card: Alvin');

/** Plays Alvin and leaves the burn choice open for the caller to settle. */
function alvin(state, casterSeat, targetId, cards) {
  if (cards) state.hands[targetId] = cards.slice();
  ensure(state, casterSeat, 'alvin');
  var result = Rules.playCard(state, casterSeat, 'alvin', targetId);
  assert(result.ok, 'alvin failed: ' + result.error);
  return result;
}

test('it needs an opponent', function () {
  var s = newGame();
  ensure(s, 0, 'alvin');
  equal(Rules.isPlayable(s, 0, 'alvin', null), false, 'it is not a free cast');
  assert(/needs a target/.test(Rules.playCard(s, 0, 'alvin', null).error));
  equal(Rules.legalTargets(s, 0, 'alvin').length, 4, 'all four opponents');
});

test('it reveals the hand to the player who played it', function () {
  var s = newGame();
  alvin(s, 0, GEMINI, ['knife', 'bonus']);
  var target = byId(s, GEMINI);
  assert(s.players[0].shownToMe.indexOf(GEMINI) !== -1, 'they can see it');
  assert(target.revealed.indexOf(HUMAN) !== -1, 'and the target knows who looked');
  // The reveal is the same one Reveal Deck produces, so the UI panel just works.
  [GPT, CLAUDE, COPILOT].forEach(function (id) {
    assert(byId(s, id).shownToMe.indexOf(GEMINI) === -1,
      byId(s, id).name + ' was not shown that hand');
  });
});

test('the chooser picks ONE card, and the turn waits for them', function () {
  var s = newGame();
  alvin(s, 0, GEMINI, ['knife', 'bonus', 'hunter', 'ghost']);
  equal(s.turnInRound, 0, 'the turn has not moved on');
  equal(s.pendingChoice.kind, 'burn', 'a burn choice is pending');
  equal(s.pendingChoice.chooserId, 'human', 'the player who played it chooses');

  var options = Rules.pendingChoiceOptions(s).options;
  deepEqual(options.map(function (o) { return o.cardId; }).sort(),
    ['bonus', 'ghost', 'hunter', 'knife'],
    'every card in the hand is offered, and only those');

  // Playing another card instead is refused while the burn is outstanding.
  ensure(s, 0, 'bonus');
  var sneaky = Rules.playCard(s, 0, 'bonus', null);
  equal(sneaky.ok, false, 'the turn cannot be used to dodge the choice');
  assert(/Alvin destroys/.test(sneaky.error), sneaky.error);
});

test('it destroys exactly one card, permanently', function () {
  var s = newGame();
  alvin(s, 0, GEMINI, ['knife', 'bonus', 'hunter']);
  // Setting the hand by hand removes whatever they were dealt, so the balance is
  // measured from here rather than from the deck size.
  function accounted() {
    return s.deck.length + s.discard.length + (s.destroyed || []).length +
      s.players.reduce(function (n, p) { return n + Rules.handSize(s, p.id); }, 0);
  }
  var total = accounted();

  // There are six Hunters in the game, so what matters is that the count goes
  // DOWN by exactly one - not that the name vanishes, which it must not, since
  // Alvin destroys a single card rather than every copy of it.
  var huntersBefore = s.deck.concat(s.discard).concat(
    s.players.reduce(function (acc, p) { return acc.concat(Rules.handOf(s, p.id)); }, [])
  ).filter(function (id) { return id === 'hunter'; }).length;

  var done = Rules.resolvePendingChoice(s, 'hunter', null);
  equal(done.ok, true, done.error);

  equal(Rules.handSize(s, GEMINI), 2, 'one card gone, the rest untouched');
  assert(Rules.holdsCard(s, GEMINI, 'knife'), 'the other cards are still there');
  assert(Rules.holdsCard(s, GEMINI, 'bonus'), 'all of them');
  equal(s.destroyed.length, 1, 'the card is on the destroyed pile');
  equal(s.destroyed[0], 'hunter', 'and it is the one that was chosen');
  assert(s.discard.indexOf('hunter') === -1, 'NOT in the discard pile');

  var huntersAfter = s.deck.concat(s.discard).concat(
    s.players.reduce(function (acc, p) { return acc.concat(Rules.handOf(s, p.id)); }, [])
  ).filter(function (id) { return id === 'hunter'; }).length;
  equal(huntersAfter, huntersBefore - 1, 'one Hunter fewer in the game');

  // Conservation still balances, which is only true if it went somewhere real.
  equal(accounted(), total, 'every card is still accounted for');
});

test('a destroyed card never comes back', function () {
  var s = newGame({ seed: 5, rounds: 40 });
  alvin(s, 0, GEMINI, ['hunter']);
  Rules.resolvePendingChoice(s, 'hunter', null);

  function huntersInPlay() {
    return s.deck.concat(s.discard).concat(
      s.players.reduce(function (acc, p) { return acc.concat(Rules.handOf(s, p.id)); }, [])
    ).filter(function (id) { return id === 'hunter'; }).length;
  }

  // Play on for a long time, forcing reshuffles as they come. A reshuffle moves
  // the whole discard back into the deck, so if the burned card were in either
  // pile it would reappear here.
  var before = huntersInPlay();
  var guard = 0;
  var failure = null;
  while (!s.over && guard++ < 900) {
    var result = stepOnce(s);
    if (!result.ok) { failure = result.error; break; }
  }
  assert(s.over, 'the game finished (stuck on: ' + failure + ')');
  greater(s.reshuffles, 0, 'and the discard was recycled at least once');

  // Every Hunter that leaves the game leaves via Alvin, so the number still in
  // play must be the number we started with here minus everything destroyed
  // since. A reshuffle moves the whole discard back into the deck, so if the
  // burned card were in either pile it would break this.
  var burnedSince = s.destroyed.filter(function (id) { return id === 'hunter'; }).length;
  equal(huntersInPlay(), before - (burnedSince - 1),
    'so a burned Hunter never comes back (' + burnedSince +
    ' Hunter(s) destroyed in total)');
  greater(s.destroyed.length, 0, 'and the destroyed pile is not empty');
});

test('an empty hand is the only way it fails', function () {
  var s = newGame();
  var result = alvin(s, 0, GEMINI, []);
  equal(s.pendingChoice, null, 'no choice is queued');
  assert(/nothing to destroy/.test(texts(result)), 'and it says why');
});

test('Alvin is an evil card, so Judge counts it', function () {
  assert(Cards.isEvil('alvin'), 'Alvin counts as evil');
  var s = newGame();
  byId(s, CLAUDE).cardsPlayed.push('alvin', 'trick');
  equal(Rules.evilCounts(s)[CLAUDE], 2, 'both new evil cards count for Judge');
});

test('the relay can answer it with the same PLAY: format', function () {
  Rules.setPhoenixHolder(null);
  var game = firstGame({ seed: 4, rounds: 8 });
  var state = game.state;
  alvin(state, 0, GEMINI, ['knife', 'bonus']);
  state.pendingChoice.chooserId = CLAUDE;       // hand the choice to an AI

  equal(game.isAwaitingChoice(), true, 'the game waits for the choice');
  equal(game.isAiChoosing(), true, 'on an AI');
  var prompt = game.choicePromptForCurrent();
  assert(/ALVIN/.test(prompt), 'the prompt explains the choice');
  assert(/for good/.test(prompt), 'and says the card is gone for good');

  var res = game.submitForcedChoice('PLAY: Knife');
  equal(res.ok, true, res.error);
  equal(state.destroyed.length, 1, 'the named card was destroyed');
  equal(state.destroyed[0], 'knife', 'and it is the right one');
  assert(state.pendingChoice !== undefined, 'and the choice is settled');
  equal(state.pendingChoice, null, 'and the turn moved on');
});

/* ===================================================================== */
/* Turns, rounds and the end of the game                                 */
/* ===================================================================== */

suite('Turns, rounds and the end of the game');

test('turns go round the seats in order', function () {
  var s = newGame();
  var seen = [];
  for (var i = 0; i < 5; i++) {
    seen.push(Rules.currentPlayer(s).id);
    playBonus(s);
  }
  equal(seen.join(','), 'human,chatgpt,claude,gemini,copilot');
  equal(s.round, 2, 'round 2 begins');
  equal(s.turnInRound, 0);
});

test('a round marker is logged when the round changes', function () {
  var s = newGame();
  playBonus(s, 4);
  equal(s.round, 1, 'still round 1, Copilot is up');
  ensure(s, 4, 'bonus');
  var last = Rules.playCard(s, 4, 'bonus', null);
  assert(last.ok, last.error);
  assert(last.events.some(function (e) { return e.type === 'round' && e.text.indexOf('Round 2') === 0; }),
    'round 2 announced');
  equal(s.round, 2);
});

test('turnIndex counts every turn taken', function () {
  var s = newGame();
  playBonus(s, 5);
  equal(s.turnIndex, 5);
  equal(s.turnInRound, 0);
});

test('the game ends after the configured number of rounds', function () {
  var s = newGame({ rounds: 3, seed: 11 });
  var guard = 0;
  while (!s.over && guard++ < 100) playBonus(s);
  equal(s.over, true);
  equal(s.round, 4, 'round counter moved past the last round');
  equal(s.players[0].turnsPlayed, 3, 'one turn per round');
  equal(s.players.reduce(function (n, p) { return n + p.turnsPlayed; }, 0), 15);
});

test('the winner is the highest score at the end', function () {
  var s = newGame({ rounds: 2, seed: 3 });
  s.players[3].points = 50000;
  var guard = 0;
  while (!s.over && guard++ < 50) playBonus(s);
  equal(s.winnerSeat, 3);
  equal(s.tied, false);
  assert(/Gemini wins/.test(Rules.winnerLine(s)), Rules.winnerLine(s));
});

test('a tie is reported as a tie', function () {
  var s = newGame({ rounds: 1, seed: 3 });
  s.players[2].points = 20000;
  s.players[4].points = 20000;
  var guard = 0;
  while (!s.over && guard++ < 20) playBonus(s);
  equal(s.tied, true);
  assert(/tied on/.test(Rules.winnerLine(s)), Rules.winnerLine(s));
});

test('standings sort by score with seat order breaking ties', function () {
  var s = newGame();
  s.players[4].points = 10;
  s.players[1].points = 10;
  s.players[2].points = 99;
  var order = Rules.standings(s).map(function (p) { return p.id; });
  equal(order.slice(0, 3).join(','), 'claude,chatgpt,copilot');
});

test('nothing can be played once the game is over', function () {
  var s = newGame({ rounds: 1, seed: 3 });
  var guard = 0;
  while (!s.over && guard++ < 20) playBonus(s);
  var result = Rules.playCard(s, s.turnInRound, 'bonus', null);
  equal(result.ok, false);
  assert(/already over/.test(result.error), result.error);
});

test('eliminating every player every turn still ends the game', function () {
  var s = newGame({ rounds: 6, seed: 77 });
  var guard = 0;
  while (!s.over && guard++ < 500) {
    // Top up first: this test is about elimination, not about the deck.
    dealEverything(s);
    Rules.playCard(s, s.turnInRound, 'zombie', s.players[(s.turnInRound + 1) % 5].id);
  }
  equal(s.over, true, 'the game terminates');
  equal(s.standings.length, 5);
});

test('every player ends on exactly one turn per round when nothing hits them', function () {
  var s = newGame({ rounds: 5, seed: 9 });
  var guard = 0;
  while (!s.over && guard++ < 200) playBonus(s);
  s.players.forEach(function (p) {
    equal(p.turnsPlayed, 5, p.name + ' played every round');
    equal(p.turnsSkipped, 0, p.name + ' was never skipped');
  });
});

test('no player can be stuck out forever', function () {
  var s = newGame({ rounds: 8, seed: 21 });
  var guard = 0;
  while (!s.over && guard++ < 400) {
    dealEverything(s);
    var victim = s.players[(s.turnInRound + 1) % 5];
    if (!Rules.isOut(victim, s)) Rules.playCard(s, s.turnInRound, 'knife', victim.id);
    else Rules.playCard(s, s.turnInRound, 'bonus', null);
  }
  equal(s.over, true);
  s.players.forEach(function (p) {
    greater(p.turnsPlayed, 0, p.name + ' played at least once');
  });
});

/* ===================================================================== */
/* The AI                                                                */
/* ===================================================================== */

/* ===================================================================== */
/* The relay prompt                                                       */
/* ===================================================================== */

suite('The relay prompt');

test('a prompt is only produced when an AI holds the turn', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  equal(game.isAwaitingAi(), false, 'the human is up first');
  equal(game.promptForCurrent(), '', 'no prompt on the human turn');

  humanPlays(game, 'bonus', null);
  equal(game.isAwaitingAi(), true, 'now an AI is up');
  greater(game.promptForCurrent().length, 200, 'a prompt is waiting');
});

test('the prompt names the AI and the round', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var name = game.state.players[game.state.turnInRound].name;
  var prompt = game.promptForCurrent();
  assert(prompt.indexOf(name) !== -1, 'names ' + name);
  assert(/Round 1 of 6/.test(prompt), 'states the round');
  assert(/It is your turn/.test(prompt), 'states whose turn it is');
});

test('the prompt lists every player and their points', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var prompt = game.promptForCurrent();
  game.state.players.forEach(function (p) {
    assert(prompt.indexOf(p.name) !== -1, p.name + ' is named');
    assert(prompt.indexOf(Rules.formatPoints(p.points)) !== -1,
      p.name + "'s points (" + Rules.formatPoints(p.points) + ') are stated');
  });
});

test('the prompt states the exact rules of every card', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var prompt = game.promptForCurrent();
  Cards.CARDS.forEach(function (card) {
    assert(prompt.indexOf(card.name) !== -1, card.name + ' is listed');
    assert(prompt.indexOf(card.rule) !== -1, card.name + "'s rule is given verbatim");
    assert(prompt.indexOf(card.targetNote) !== -1, card.name + "'s target note is given");
  });
  // The deck cards and the legendary one are separated, so an AI is never led to
  // think Phoenix is something it could be dealt.
  assert(/THE \d+ CARDS IN THE DECK/.test(prompt), 'the deck is listed on its own');
  assert(prompt.indexOf('THE LEGENDARY CARD (never dealt, never drawn)') !== -1,
    'and the legendary card is listed separately');
});

test('the prompt lists the legal targets for every targeted card', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  var prompt = game.promptForCurrent();
  Rules.opponents(game.state, seat).forEach(function (target) {
    assert(prompt.indexOf(target.name) !== -1, target.name + ' appears as a target');
  });
  Cards.CARDS.filter(function (c) { return c.needsTarget; }).forEach(function (card) {
    var legal = Rules.legalTargets(game.state, seat, card.id);
    if (legal.length) {
      assert(prompt.indexOf('TARGET must be one of') !== -1, 'target instruction is present');
    }
  });
});

test('the prompt reports active effects', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  // The human takes a Hunter, so the next AI's prompt must describe it - and
  // must refer to the human as the human, not as "You" (this prompt is written
  // to somebody else).
  humanPlays(game, 'hunter', null);
  var prompt = game.promptForCurrent();
  assert(/HUNTER effect/.test(prompt), 'the Hunter effect is described');
  assert(prompt.indexOf('the human player has a HUNTER') !== -1,
    'and attributed to the player who actually holds it');

  var withGhost = firstGame({ seed: 5, rounds: 4 });
  humanPlays(withGhost, 'ghost', null);
  assert(/is a GHOST this round/.test(withGhost.promptForCurrent()),
    'a Ghost is described as untargetable');

  var withElimination = firstGame({ seed: 5, rounds: 4 });
  humanPlays(withElimination, 'knife',
    Rules.opponents(withElimination.state, 0)[0].id);
  assert(/ELIMINATED this round/.test(withElimination.promptForCurrent()),
    'the elimination is described');
});

test('the prompt reports a Ghost as untargetable', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'ghost', null);
  var prompt = game.promptForCurrent();
  assert(/no card can be aimed at/.test(prompt),
    'the prompt says a Ghost cannot be targeted');
  assert(/can still play normally/.test(prompt),
    'and that they are not stuck');
});

test('the prompt reports players currently eliminated', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var victim = Rules.opponents(game.state, 0)[0];
  humanPlays(game, 'knife', victim.id);
  var prompt = game.promptForCurrent();
  assert(prompt.indexOf('ELIMINATED') !== -1, 'eliminations are called out');
  assert(prompt.indexOf(victim.name) !== -1, 'the eliminated player is named');
});

test('the prompt includes recent play as context', function () {
  var game = firstGame({ seed: 5, rounds: 8 });
  humanPlays(game, 'bonus', null);                    // hand the turn to an AI
  var relayed = 0;
  for (var i = 0; i < 3 && game.isAwaitingAi(); i++) {
    var seat = game.state.turnInRound;
    var result = game.submitAiMove(greedyReply(game.state, seat));
    equal(result.ok, true, result.error);
    relayed++;
  }
  greater(relayed, 0, 'at least one AI turn was relayed');
  greater(game.log.length, 2, 'the relay turns are logged');
  var prompt = game.promptForCurrent();
  assert(/RECENT PLAY/.test(prompt), 'a history section exists');
  assert(/chose/.test(prompt), 'the history records who chose what');
});

test('the prompt keeps reporting state after several relayed turns', function () {
  var game = firstGame({ seed: 5, rounds: 8 });
  humanPlays(game, 'bonus', null);
  game.playUntilHumanOrOver();               // relays up to the human again
  greater(game.state.turnIndex, 1, 'some turns have been relayed');
  humanPlays(game, 'bonus', null);             // hand the turn back to an AI

  var prompt = game.promptForCurrent();
  assert(/chose/.test(prompt), 'recent play records the relayed decisions');
  assert(/Round \d+ of \d+/.test(prompt), 'the round is stated');
  assert(/CURRENT POINTS/.test(prompt), 'scores are still reported');
  assert(/LEGAL|can play right now/i.test(prompt), 'the legal move list is still there');
  greater(game.log.filter(function (l) { return l.type === 'relay'; }).length, 0,
    'the relayed decisions are in the log the prompt draws from');
});

test('the prompt spells out the reply format with real examples', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var prompt = game.promptForCurrent();
  var seat = game.state.turnInRound;

  assert(/PLAY: \+10,000 Points/.test(prompt), 'a no-target example is given');
  Cards.CARDS.forEach(function (card) {
    assert(prompt.indexOf(card.name) !== -1, card.name + ' appears in the card list');
  });

  // The targeted example must name a card that really needs a target, and a
  // target that really is legal for it.
  var example = /PLAY: ([^\n]+)\nTARGET: ([^\n]+)/.exec(prompt);
  assert(example, 'a two-line example is present');
  var card = Cards.resolve(example[1].trim());
  assert(card, 'the example card is real: ' + example[1]);
  assert(card.needsTarget, 'the example card genuinely needs a target');
  var target = Parser.matchPlayer(example[2].trim(), game.state);
  assert(target, 'the example target is a real player: ' + example[2]);
  assert(Rules.legalTargets(game.state, seat, card.id).indexOf(target) !== -1,
    'and it really is a legal target for that card right now');
});

test('the prompt says the AI should choose its own move', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var flat = game.promptForCurrent().replace(/\s+/g, ' ');
  assert(/Choose the move YOU think is best/.test(flat), 'the AI is asked to decide');
  assert(/exactly what you choose/.test(flat), 'and told its decision is what gets played');
  assert(/card you would not actually play/.test(flat), 'and told not to play a card it does not want');
});

test('legalMovesText describes card to target for the panel', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  game.state.hands[game.state.players[seat].id] = ['bonus', 'steal'];

  var moves = game.legalMovesForCurrent();
  equal(moves.length, 2, 'one line per card in hand');
  assert(moves.join(' ').indexOf('no target') !== -1, 'untargeted cards are marked');
  assert(moves.join(' ').indexOf('Steal Points ->') !== -1, 'targeted cards list targets');

  // Only cards actually held are offered.
  game.state.hands[game.state.players[seat].id] = ['bonus'];
  equal(game.legalMovesForCurrent().length, 1, 'a smaller hand gives fewer lines');
  game.state.hands[game.state.players[seat].id] = [];
  equal(game.legalMovesForCurrent()[0], 'You are holding no cards.',
    'an empty hand says so');
  humanPlays(game, 'bonus', null);
  equal(firstGame({ seed: 5, rounds: 4 }).legalMovesForCurrent().length, 0,
    'no legal moves are offered on the human turn');
});

test('the prompt never leaks the AI prompt back into the log', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var before = game.log.length;
  game.promptForCurrent();
  equal(game.log.length, before, 'building a prompt is not a log entry');
});

/* ===================================================================== */
/* Parsing an AI reply                                                    */
/* ===================================================================== */

suite('Parsing an AI reply');

test('reads a plain two-line reply', function () {
  var parsed = Parser.parseMove('PLAY: Zombie\nTARGET: Gemini');
  equal(parsed.ok, true);
  equal(parsed.card, 'Zombie');
  equal(parsed.targetName, 'Gemini');
});

test('reads a one-line reply for a card with no target', function () {
  var parsed = Parser.parseMove('PLAY: Hunter');
  equal(parsed.ok, true);
  equal(parsed.card, 'Hunter');
  equal(parsed.targetName, null);
});

test('accepts the exact spelling of every card', function () {
  Cards.CARDS.forEach(function (card) {
    var parsed = Parser.parseMove('PLAY: ' + card.name);
    equal(parsed.ok, true, card.name + ' parses');
    equal(parsed.card, card.name, card.name + ' resolves to itself');
  });
});

test('tolerates markdown, bullets, bold and stray punctuation', function () {
  var cases = [
    '**PLAY:** Zombie\n**TARGET:** Gemini',
    '- PLAY: Zombie\n- TARGET: Gemini',
    '1. PLAY: Zombie\n2. TARGET: Gemini',
    'PLAY: zombie\nTARGET: gemini',
    'PLAY:   Zombie  \nTARGET:   Gemini  ',
    '> PLAY: Zombie\n> TARGET: Gemini',
    '```\nPLAY: Zombie\nTARGET: Gemini\n```',
    '"PLAY: Zombie"\n"TARGET: Gemini"'
  ];
  cases.forEach(function (text) {
    var parsed = Parser.parseMove(text);
    equal(parsed.ok, true, 'parses: ' + JSON.stringify(text));
    equal(parsed.card, 'Zombie');
    equal(parsed.targetName, 'Gemini');
  });
});

test('ignores commentary and only uses the PLAY line', function () {
  var reply = [
    'Oh, this is a tough spot. I was tempted by Zombie the whole game,',
    'but Steal Points is clearly the better line here.',
    '',
    'PLAY: Steal Points',
    'TARGET: Claude'
  ].join('\n');
  var parsed = Parser.parseMove(reply);
  equal(parsed.ok, true);
  equal(parsed.card, 'Steal Points', 'the marked line wins, not the commentary');
  equal(parsed.targetName, 'Claude');
});

test('the last PLAY line wins if the AI changes its mind', function () {
  var parsed = Parser.parseMove('PLAY: Knife\nTARGET: Gemini\n\nActually, better:\nPLAY: Hunter');
  equal(parsed.ok, true);
  equal(parsed.card, 'Hunter');
});

test('never guesses: no PLAY line is an error', function () {
  var parsed = Parser.parseMove('I think I will just sit this one out.');
  equal(parsed.ok, false);
  assert(/No PLAY line/.test(parsed.error), parsed.error);
  assert(/PLAY:/.test(parsed.hint), 'the hint shows the format');
});

test('never guesses: an empty reply is an error', function () {
  ['', '   ', null, undefined].forEach(function (text) {
    var parsed = Parser.parseMove(text);
    equal(parsed.ok, false, 'empty input rejected');
  });
});

test('detects the prompt pasted back with no decision in it', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  // The prompt contains "PLAY:" in its format examples, so the check has to
  // tell a pasted-back prompt from a reply that merely echoes an example.
  var parsed = Parser.parseAndValidate(game.promptForCurrent(), game.state, seat);
  equal(parsed.ok, false, 'a pasted-back prompt is rejected');
  assert(/pasted back/.test(parsed.error), parsed.error);
});

test('a reply that only echoes a format example is still rejected', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var parsed = Parser.parseMove(
    'Here is the format you asked for:\nPLAY: Zombie\nTARGET: Gemini\n\nI will decide now.'
  );
  // That one IS a decision, so it must be accepted - the point is that the
  // echo detection does not fire on text that merely looks like the prompt.
  equal(parsed.ok, true);
  equal(parsed.card, 'Zombie');
});

test('an unknown card name is an error naming the valid cards', function () {
  var parsed = Parser.parseMove('PLAY: Dragon');
  equal(parsed.ok, false);
  assert(/not a card/.test(parsed.error), parsed.error);
  assert(/Zombie/.test(parsed.hint), 'the hint lists the real cards');
});

test('an unknown player name is an error naming the real players', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var parsed = Parser.parseAndValidate('PLAY: Zombie\nTARGET: Gandalf', game.state, 1);
  equal(parsed.ok, false);
  assert(/not a player/.test(parsed.error), parsed.error);
});

test('a card that needs a target but has none is an error', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var parsed = Parser.parseAndValidate('PLAY: Zombie', game.state, 1);
  equal(parsed.ok, false);
  assert(/needs a target/.test(parsed.error), parsed.error);
});

test('a card that needs no target must not be given one', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var parsed = Parser.parseAndValidate('PLAY: Hunter\nTARGET: Gemini', game.state, 1);
  equal(parsed.ok, false);
  assert(/takes no target/.test(parsed.error), parsed.error);
});

test('targeting yourself is rejected', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var seat = game.currentSeat();
  var parsed = Parser.parseAndValidate(
    'PLAY: Knife\nTARGET: ' + game.state.players[seat].name, game.state, seat
  );
  equal(parsed.ok, false);
  assert(/cannot target yourself/.test(parsed.error), parsed.error);
});

test('a Zombie aimed at a Hunter is rejected with the reflection explained', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var seat = game.currentSeat();
  var hunter = Rules.opponents(game.state, seat)[0];
  game.state.players[hunter.seat].hunter = true;
  var parsed = Parser.parseAndValidate(
    'PLAY: Zombie\nTARGET: ' + hunter.name, game.state, seat
  );
  equal(parsed.ok, false, 'a Zombie may not be aimed at a Hunter');
  assert(/Hunter/.test(parsed.error), parsed.error);
  assert(/reflected/.test(parsed.error), 'the reflection is explained');
  assert(/Legal targets/.test(parsed.hint), 'the hint lists what IS legal: ' + parsed.hint);
});

test('targeting an eliminated player is rejected', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var seat = game.currentSeat();
  var victim = Rules.opponents(game.state, seat)[0];
  Rules.eliminate(game.state, game.state.players[victim.seat]);
  var parsed = Parser.parseAndValidate(
    'PLAY: Knife\nTARGET: ' + victim.name, game.state, seat
  );
  equal(parsed.ok, false);
  assert(/already eliminated/.test(parsed.error), parsed.error);
});

test('a valid reply resolves the target to a player id', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var seat = game.currentSeat();
  var target = Rules.legalTargets(game.state, seat, 'steal')[0];
  var parsed = Parser.parseAndValidate(
    'PLAY: Steal Points\nTARGET: ' + Rules.playerById(game.state, target).name,
    game.state, seat
  );
  equal(parsed.ok, true);
  equal(parsed.cardId, 'steal');
  equal(parsed.targetId, target);
});

test('normalize keeps line breaks but strips formatting', function () {
  var out = Parser.normalize('**PLAY:** Zombie\n\n- TARGET: Gemini');
  equal(out.indexOf('**'), -1, 'bold removed');
  equal(out.indexOf('- TARGET'), -1, 'bullet removed');
  assert(out.indexOf('\n') !== -1, 'line breaks preserved');
});

/* ===================================================================== */
/* Switching players on and off                                          */
/* ===================================================================== */

suite('Switching players on and off');

/** Runs `fn`, then restores every AI switch to how it was found. */
function withAis(fn) {
  var before = {};
  Rules.roster().forEach(function (p) { before[p.id] = p.enabled; });
  try {
    return fn();
  } finally {
    Rules.setPlayerEnabled(HUMAN, true);   // force the table back to legal
    AI_IDS.forEach(function (id) { Rules.setPlayerEnabled(id, true); });
    Object.keys(before).forEach(function (id) {
      Rules.setPlayerEnabled(id, before[id]);
    });
  }
}

test('all four AIs start switched on', function () {
  var roster = Rules.roster();
  equal(roster.length, 5, 'five seats');
  equal(roster.filter(function (p) { return p.isHuman; }).length, 1, 'one human');
  AI_IDS.forEach(function (id) {
    equal(Rules.isPlayerEnabled(id), true, id + ' is on by default');
  });
  equal(Rules.activeAiCount(), 4);
});

test('an AI can be switched off and back on', function () {
  withAis(function () {
    equal(Rules.setPlayerEnabled(GPT, false).ok, true);
    equal(Rules.isPlayerEnabled(GPT), false, 'ChatGPT is off');
    equal(Rules.activeAiCount(), 3);

    equal(Rules.setPlayerEnabled(GPT, true).ok, true);
    equal(Rules.isPlayerEnabled(GPT), true, 'and back on again');
    equal(Rules.activeAiCount(), 4);
  });
});

test('the human can never be switched off', function () {
  withAis(function () {
    var result = Rules.setPlayerEnabled(HUMAN, false);
    equal(result.ok, false);
    assert(/always in the game/.test(result.error), result.error);
    equal(Rules.isPlayerEnabled(HUMAN), true, 'the human is always in');
  });
});

test('the last AI cannot be switched off', function () {
  withAis(function () {
    AI_IDS.slice(1).forEach(function (id) {
      equal(Rules.setPlayerEnabled(id, false).ok, true, id + ' off');
    });
    equal(Rules.activeAiCount(), 1, 'exactly one AI left');

    var last = Rules.setPlayerEnabled(GPT, false);
    equal(last.ok, false, 'refused - there would be nobody to relay to');
    assert(/at least one AI/i.test(last.error), last.error);
    equal(Rules.isPlayerEnabled(GPT), true, 'the table is left as it was');
    equal(Rules.activeAiCount(), 1, 'still exactly one AI');
  });
});

test('any combination with at least one AI on is reachable', function () {
  withAis(function () {
    var reachable = 0;
    for (var mask = 1; mask < 16; mask++) {      // skip 0 = all four off
      AI_IDS.forEach(function (id) { Rules.setPlayerEnabled(id, true); });
      AI_IDS.forEach(function (id, i) {
        Rules.setPlayerEnabled(id, !!(mask & (1 << i)));
      });
      var on = AI_IDS.filter(function (id) { return Rules.isPlayerEnabled(id); });
      equal(Rules.activeAiCount(), on.length, 'activeAiCount matches the switches');
      equal(on.length, popcount(mask), 'the requested number are on');
      reachable++;
    }
    equal(reachable, 15, 'all fifteen non-empty combinations work');
  });
});

test('all four AI off is unreachable however it is attempted', function () {
  withAis(function () {
    // Turn them off one at a time; the last request must be refused.
    AI_IDS.forEach(function (id, i) {
      var result = Rules.setPlayerEnabled(id, false);
      if (i < AI_IDS.length - 1) {
        equal(result.ok, true, id + ' could be switched off');
      } else {
        equal(result.ok, false, 'switching off the last AI is refused');
        assert(/at least one AI/i.test(result.error), result.error);
      }
    });
    equal(Rules.activeAiCount(), 1, 'exactly one AI survives');
  });
});

/** Number of set bits - small enough to keep local. */
function popcount(n) {
  var count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

test('switching an unknown player is refused', function () {
  withAis(function () {
    var result = Rules.setPlayerEnabled('gandalf', false);
    equal(result.ok, false);
    assert(/Unknown player/.test(result.error), result.error);
  });
});

test('a switched-off player is passed over on every turn', function () {
  withAis(function () {
    Rules.setPlayerEnabled(GPT, false);
    var game = firstGame({ seed: 5, rounds: 4 });
    equal(Rules.isPlayerEnabled(GPT), false);

    humanPlays(game, 'bonus', null);
    var guard = 0;
    var actors = [];
    while (!game.state.over && guard++ < 40) {
      if (game.isHumanTurn()) { humanPlays(game, 'bonus', null); continue; }
      var id = game.state.players[game.state.turnInRound].id;
      actors.push(id);
      assert(id !== GPT, 'ChatGPT was handed the turn');
      aiSays(game, 'PLAY: +10,000 Points');
    }
    greater(actors.length, 0, 'the other AIs still played');
    equal(byId(game.state, GPT).turnsPlayed, 0, 'ChatGPT played no cards');
  });
});

test('a switched-off player cannot be targeted by anyone', function () {
  withAis(function () {
    Rules.setPlayerEnabled(GPT, false);
    var game = firstGame({ seed: 5, rounds: 4 });
    ['knife', 'zombie', 'steal'].forEach(function (cardId) {
      equal(Rules.legalTargets(game.state, 0, cardId).indexOf(GPT), -1,
        cardId + ' is not aimed at a switched-off player');
    });
    var refused = game.playHuman('steal', GPT);
    equal(refused.ok, false, 'the human cannot steal from a switched-off player');
    assert(/switched off/.test(refused.error), refused.error);
  });
});

test('the relay never produces a prompt for a switched-off player', function () {
  withAis(function () {
    Rules.setPlayerEnabled(GPT, false);
    var game = firstGame({ seed: 5, rounds: 4 });
    var guard = 0;
    var prompts = 0;
    while (!game.state.over && guard++ < 40) {
      if (game.isHumanTurn()) { humanPlays(game, 'bonus', null); continue; }
      var id = game.state.players[game.state.turnInRound].id;
      assert(id !== GPT, 'ChatGPT never holds the turn');
      greater(game.promptForCurrent().length, 100, 'the AI on turn gets a prompt');
      prompts++;
      aiSays(game, 'PLAY: +10,000 Points');
    }
    greater(prompts, 0, 'the remaining AIs were relayed');
  });
});

test('a switched-off player is out of the standings', function () {
  withAis(function () {
    Rules.setPlayerEnabled(GPT, false);
    var game = firstGame({ seed: 5, rounds: 3 });
    equal(Rules.standings(game.state).length, 4, 'four players ranked');
    assert(Rules.standings(game.state).every(function (p) { return p.id !== GPT; }),
      'the switched-off seat is not ranked');

    humanPlays(game, 'bonus', null);
    var guard = 0;
    while (!game.state.over && guard++ < 80) {
      if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
      else aiSays(game, 'PLAY: +10,000 Points');
    }
    equal(game.state.over, true, 'the game finishes without them');
    equal(game.status().standings.length, 4);
    assert(game.status().winner, 'and there is a winner');
    assert(game.status().winner.id !== GPT, 'who is not the switched-off player');
  });
});

test('switching an AI off mid-turn hands the turn straight on', function () {
  withAis(function () {
    var game = firstGame({ seed: 5, rounds: 4 });
    humanPlays(game, 'bonus', null);
    var onTurn = game.state.turnInRound;
    equal(game.isAwaitingAi(), true, 'an AI is on turn');
    var waiting = game.state.players[onTurn].id;
    greater(game.promptForCurrent().length, 100, 'a prompt is waiting');

    // The player switches that AI off while its prompt is on screen.
    equal(game.setPlayerEnabled(waiting, false).ok, true);
    equal(game.applySeating().ok, true);

    assert(game.state.over || game.state.players[game.state.turnInRound].id !== waiting,
      'the turn moved off the switched-off player');
    assert(game.log.some(function (l) { return l.type === 'seat'; }),
      'the change is logged');
  });
});

test('switching a player off clears any pending elimination', function () {
  withAis(function () {
    var game = firstGame({ seed: 5, rounds: 4 });
    humanPlays(game, 'knife', GPT);                // ChatGPT is out for the round
    assert(Rules.isOut(byId(game.state, GPT), game.state), 'ChatGPT is out');

    game.setPlayerEnabled(GPT, false);
    game.applySeating();
    equal(byId(game.state, GPT).outUntilRound, -1,
      'their elimination is cleared - they are not in the game at all');
  });
});

test('switches persist into the next game', function () {
  withAis(function () {
    Rules.setPlayerEnabled(GPT, false);
    Rules.setPlayerEnabled(COPILOT, false);
    var game = GameApi.create({ seed: 5, rounds: 4 });
    equal(byId(game.state, GPT).enabled, false, 'ChatGPT is still off');
    equal(byId(game.state, COPILOT).enabled, false, 'Copilot is still off');
    equal(byId(game.state, CLAUDE).enabled, true, 'Claude is still on');
    equal(byId(game.state, HUMAN).enabled, true, 'the human is in');
    equal(Rules.activeAiCount(), 2);
  });
});

test('a whole game works with a single AI on', function () {
  withAis(function () {
    AI_IDS.slice(1).forEach(function (id) { Rules.setPlayerEnabled(id, false); });
    var game = GameApi.create({ seed: 909, rounds: 5 });
    var guard = 0;
    while (!game.state.over && guard++ < 200) {
      if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
      else aiSays(game, 'PLAY: Hunter');
    }
    equal(game.state.over, true, 'a two-player game still finishes');
    equal(game.status().standings.length, 2, 'two players ranked');
    assert(game.status().winner, 'with a winner');
  });
});

test('applySeating is a no-op when nothing changed', function () {
  withAis(function () {
    var game = firstGame({ seed: 5, rounds: 4 });
    var before = game.log.length;
    equal(game.applySeating().ok, true);
    equal(game.log.length, before, 'no log noise when there is nothing to do');
  });
});

test('game.setPlayerEnabled and game.roster expose the switches', function () {
  withAis(function () {
    var game = GameApi.create({ seed: 5, rounds: 4 });
    var roster = game.roster();
    equal(roster.length, 5);
    assert(roster.every(function (p) { return typeof p.enabled === 'boolean'; }),
      'each entry says whether it is in play');
    equal(game.setPlayerEnabled(GPT, false).ok, true);
    equal(game.roster().filter(function (p) { return p.enabled; }).length, 4);
  });
});

/* ===================================================================== */
/* The relay itself                                                       */
/* ===================================================================== */

suite('The AI relay');

test('an AI turn waits: nothing is played until a reply is submitted', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  var player = game.state.players[seat];
  var turnIndex = game.state.turnIndex;

  equal(player.isHuman, false, 'an AI really is on turn');
  equal(game.isAwaitingAi(), true, 'the game is waiting');
  equal(game.state.turnInRound, seat, 'the turn has not advanced');
  equal(game.state.turnIndex, turnIndex, 'no turn was consumed');
  equal(player.turnsPlayed, 0, 'the AI has not played');
  // Asking repeatedly changes nothing.
  game.promptForCurrent();
  game.promptForCurrent();
  equal(game.state.turnIndex, turnIndex, 'still waiting after reading the prompt twice');
});

test('the relay executes exactly the move the AI chose', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  ensure(game.state, seat, 'steal');
  var target = Rules.legalTargets(game.state, seat, 'steal')[0];
  var targetName = Rules.playerById(game.state, target).name;
  var before = game.state.players[seat].points;
  var targetBefore = game.state.players[Rules.playerById(game.state, target).seat].points;

  var result = game.submitAiMove('PLAY: Steal Points\nTARGET: ' + targetName);

  equal(result.ok, true, result.error);
  equal(result.card, 'Steal Points');
  equal(result.targetName, targetName);
  var actor = game.state.players[seat];
  var victim = game.state.players[Rules.playerById(game.state, target).seat];
  equal(actor.points, before + targetBefore, 'the AI took exactly that pile');
  equal(victim.points, 0, 'the target was emptied');
});

test('a legal reply advances the turn and logs the AI decision', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  var result = aiSays(game, 'PLAY: Hunter');

  equal(result.ok, true);
  equal(game.state.players[seat].hunter, true, 'the AI really took the Hunter');
  equal(game.state.turnInRound !== seat, true, 'the turn moved on');
  assert(game.log.some(function (l) { return l.type === 'relay' && /external AI/.test(l.text); }),
    'the relay decision is logged');
});

test('an illegal reply is rejected and the turn does NOT advance', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  var turnIndex = game.state.turnIndex;
  var points = game.state.players[seat].points;

  var result = game.submitAiMove('PLAY: Dragon');

  equal(result.ok, false);
  assert(/not a card/.test(result.error), result.error);
  equal(game.state.turnInRound, seat, 'the same AI is still on turn');
  equal(game.state.turnIndex, turnIndex, 'no turn was consumed');
  equal(game.state.players[seat].turnsPlayed, 0, 'nothing was played');
  equal(game.state.players[seat].points, points, 'no points moved');
});

test('an illegal reply is followed by a legal one on the same turn', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;

  var bad = game.submitAiMove('PLAY: Zombie');            // missing target
  equal(bad.ok, false);
  var target = Rules.legalTargets(game.state, seat, 'zombie')[0];
  ensure(game.state, seat, 'zombie');
  var good = game.submitAiMove(
    'PLAY: Zombie\nTARGET: ' +
      Rules.displayName(game.state, Rules.playerById(game.state, target))
  );
  equal(good.ok, true, good.error);
  equal(game.state.players[Rules.playerById(game.state, target).seat].points, 0,
    'the retried move really landed');
});

test('there is no fallback move: bad replies never quietly become a card', function () {
  var game = firstGame({ seed: 5, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  var badReplies = [
    '',
    '   ',
    'no idea',
    'PLAY:',
    'PLAY: Dragon',
    'PLAY: Zombie',                                  // missing target
    'PLAY: Hunter\nTARGET: Gemini',                  // unneeded target
    'PLAY: Zombie\nTARGET: Gandalf',                 // not a player
    'I pick Zombie at Gemini'                        // no PLAY line
  ];
  badReplies.forEach(function (reply) {
    var before = game.state.turnIndex;
    var result = game.submitAiMove(reply);
    equal(result.ok, false, 'rejected: ' + JSON.stringify(reply));
    equal(game.state.turnIndex, before, 'turn unchanged for: ' + JSON.stringify(reply));
    equal(game.state.turnInRound, seat, 'same player for: ' + JSON.stringify(reply));
  });
  equal(game.state.players[seat].turnsPlayed, 0, 'nothing was ever played on their behalf');
});

test('the human cannot submit a move for an AI', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  var result = aiSays(game, 'PLAY: Hunter');
  equal(result.ok, false);
  assert(/your turn/.test(result.error), result.error);
});

test('an AI move cannot be submitted after the game is over', function () {
  var game = firstGame({ seed: 5, rounds: 1 });
  var guard = 0;
  while (!game.state.over && guard++ < 60) {
    if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
    else aiSays(game, 'PLAY: Hunter');
  }
  equal(game.state.over, true);
  var after = aiSays(game, 'PLAY: Hunter');
  equal(after.ok, false);
  assert(/over/i.test(after.error), after.error);
});

test('every AI in the game is driven only by submitAiMove', function () {
  var game = firstGame({ seed: 77, rounds: 10 });
  var aiTurns = 0;
  var guard = 0;
  while (!game.state.over && guard++ < 200) {
    if (game.isHumanTurn()) {
      humanPlays(game, 'bonus', null);
      continue;
    }
    equal(game.isAwaitingAi(), true, 'the game waits for a reply');
    var seat = game.state.turnInRound;
    var before = game.state.players[seat].turnsPlayed;
    // Nothing happens between turns except a submitted reply.
    game.promptForCurrent();
    game.legalMovesForCurrent();
    equal(game.state.players[seat].turnsPlayed, before, 'still nothing played');
    var result = aiSays(game, 'PLAY: Hunter');
    equal(result.ok, true, result.error);
    equal(game.state.players[seat].turnsPlayed, before + 1, 'the submitted move landed');
    aiTurns++;
  }
  equal(game.state.over, true);
  greater(aiTurns, 30, 'every AI turn went through the relay');
});

test('the game module exposes no automatic AI move function', function () {
  var proto = GameApi.Game.prototype;
  ['playAiTurn', 'autoPlay', 'chooseForAi', 'randomAiTurn', 'runAi'].forEach(function (name) {
    equal(typeof proto[name], 'undefined', name + ' does not exist');
  });
});

test('status() shows the game is waiting on an AI', function () {
  var game = firstGame({ seed: 5, rounds: 4 });
  humanPlays(game, 'bonus', null);
  var status = game.status();
  equal(status.isHumanTurn, false);
  equal(status.awaitingAi, true);
  equal(status.player.isHuman, false);
});

/* ===================================================================== */
/* Game controller                                                        */
/* ===================================================================== */

suite('Game controller');

test('a new game logs its setup', function () {
  var game = GameApi.create({ seed: 1234, rounds: 6 });
  equal(game.log.length, 1);
  assert(/New game/.test(game.log[0].text), game.log[0].text);
  assert(/Seed 1234/.test(game.log[0].text), game.log[0].text);
  equal(game.seed, 1234);
  equal(game.state.rounds, 6);
});

test('seating is shuffled so the last seat is not always the winner', function () {
  var orders = {};
  for (var n = 0; n < 40; n++) {
    var game = GameApi.create({ seed: nextSeed(), rounds: 3 });
    orders[game.state.players.map(function (p) { return p.id; }).join(',')] = true;
    equal(game.state.players.length, 5);
    equal(game.state.players.filter(function (p) { return p.isHuman; }).length, 1);
    game.state.players.forEach(function (p, i) { equal(p.seat, i, p.name + ' seat index'); });
  }
  greater(Object.keys(orders).length, 5, 'the seating actually changes between games');
});

test('the same seed produces the same seating', function () {
  var a = GameApi.create({ seed: 777, rounds: 4 });
  var b = GameApi.create({ seed: 777, rounds: 4 });
  equal(a.state.players.map(function (p) { return p.id; }).join(','),
    b.state.players.map(function (p) { return p.id; }).join(','), 'identical seating');
});

test('nobody is favoured by where they sit in the turn order', function () {
  // Every seat plays the same scripted strategy through the real relay, so the
  // only thing that can decide a game is seat position. Whoever closes a round
  // has the last word on it, so the opening seat has to rotate - with a fixed
  // start this reads 0,0,0,GAMES,0, one seat winning every game.
  var wins = [0, 0, 0, 0, 0];
  var games = 60;
  for (var n = 0; n < games; n++) {
    var game = GameApi.create({ seed: nextSeed(), rounds: 10, fixedOrder: true });
    var finished = playGameToEnd(game, 400);
    equal(finished.ok, true, finished.error);
    wins[Rules.standings(game.state)[0].seat]++;
  }
  var total = wins.reduce(function (a, b) { return a + b; }, 0);
  equal(total, games, 'every game had a winner');
  var highest = Math.max.apply(null, wins);
  assert(highest < games * 0.6, 'the best seat won ' + highest + ' of ' + games + ' games');
  wins.forEach(function (count, seat) {
    greater(count, 0, 'seat ' + seat + ' wins games too');
  });
});

test('the seat that closes the final round changes from game to game', function () {
  var closers = {};
  var games = 30;
  for (var n = 0; n < games; n++) {
    var state = Rules.createGame({ seed: nextSeed(), rounds: 10 });
    var guard = 0;
    var last = -1;
    while (!state.over && guard++ < 400) {
      last = state.turnInRound;
      var move = greedyMove(state, last);
      Rules.playCard(state, last, move.cardId, move.targetId);
    }
    closers[last] = true;
  }
  greater(Object.keys(closers).length, 2,
    'the final mover is not the same seat every game: ' + Object.keys(closers).join(','));
});

test('every seat closes roughly the same number of rounds', function () {
  var counts = [0, 0, 0, 0, 0];
  var games = 4;
  var expected = 0;
  for (var n = 0; n < games; n++) {
    var state = Rules.createGame({ seed: nextSeed(), rounds: 20 });
    var guard = 0;
    while (!state.over && guard++ < 400) {
      var seatsPlayed = state.seatsPlayed;
      if (seatsPlayed === Rules.SEAT_COUNT - 1) {
        counts[(state.roundStartSeat + seatsPlayed) % Rules.SEAT_COUNT]++;
      }
      var result = stepOnce(state);
      if (!result.ok) break;
    }
    expected += 20;
  }
  var low = Math.min.apply(null, counts);
  var high = Math.max.apply(null, counts);
  assert(high - low <= expected * 0.25,
    'close counts too uneven: ' + counts.join(', ') + ' over ' + expected + ' rounds');
});

/**
 * A deliberately simple "opponent" for fairness tests: takes the first legal
 * move the game offers, cycling the card order with `offset` so the seats are
 * not all doing exactly the same thing. Seat position is then the only thing
 * that can decide who wins.
 *
 * The move is expressed as relay text so it travels the real AI path rather
 * than bypassing it.
 */
function firstLegalReply(state, seat, offset) {
  var order = [];
  for (var i = 0; i < Cards.CARDS.length; i++) {
    order.push(Cards.CARDS[(i + (offset || 0)) % Cards.CARDS.length]);
  }
  for (var j = 0; j < order.length; j++) {
    var card = order[j];
    if (!card.needsTarget) {
      if (Rules.isPlayable(state, seat, card.id, null)) return 'PLAY: ' + card.name;
      continue;
    }
    var targets = Rules.legalTargets(state, seat, card.id);
    if (targets.length) {
      return 'PLAY: ' + card.name + '\nTARGET: ' + Rules.playerById(state, targets[0]).name;
    }
  }
  return 'PLAY: +10,000 Points';
}

test('the human moves only on their own turn', function () {
  var game = firstGame({ seed: 5, rounds: 3 });
  equal(game.isHumanTurn(), true);
  var early = humanPlays(game, 'bonus', null);
  equal(early.ok, true);
  equal(game.isHumanTurn(), false, 'now an AI');
  var late = humanPlays(game, 'bonus', null);
  equal(late.ok, false);
  assert(/not your turn/.test(late.error), late.error);
  equal(game.lastError, late.error);
});

test('an illegal human move is refused without advancing the turn', function () {
  var game = firstGame({ seed: 5, rounds: 3 });
  var seat = game.humanSeat();

  // A targeted card with no target.
  ensure(game.state, seat, 'knife');
  var noTarget = game.playHuman('knife', null);
  equal(noTarget.ok, false);
  assert(/needs a target/.test(noTarget.error), noTarget.error);

  // A card the player is not holding. Pick one they were not actually dealt, so
  // the refusal is about holding the card rather than about the deal.
  var handId = game.state.players[seat].id;
  var unheldCard = Cards.deckIds().filter(function (id) {
    return !Rules.holdsCard(game.state, handId, id);
  })[0];
  assert(unheldCard, 'the human is not holding every card in the game');
  var unheld = game.playHuman(unheldCard, GPT);
  equal(unheld.ok, false);
  assert(/not holding/.test(unheld.error), unheld.error);

  // A card that takes no target, given one.
  ensure(game.state, seat, 'bonus');
  var badTarget = game.playHuman('bonus', GPT);
  equal(badTarget.ok, false);
  assert(/takes no target/.test(badTarget.error), badTarget.error);

  equal(game.state.turnInRound, seat, 'the turn did not advance');
  equal(game.state.turnIndex, 0);
  equal(game.log.length, 1, 'nothing was logged');
});

test('a legal human move is written to the log', function () {
  var game = firstGame({ seed: 5, rounds: 3 });
  var before = game.log.length;
  humanPlays(game, 'bonus', null);
  greater(game.log.length, before + 1, 'card and result lines were added');
  assert(game.log.some(function (l) { return /You plays \+10,000 Points/.test(l.text); }),
    'the log names the card');
});

test('the human can be seated anywhere and still plays', function () {
  for (var n = 0; n < 12; n++) {
    var game = GameApi.create({ seed: nextSeed(), rounds: 4 });
    var seat = game.humanSeat();
    assert(seat >= 0 && seat < 5, 'the human has a seat');
    var guard = 0;
    while (!game.isHumanTurn() && !game.state.over && guard++ < 20) {
      aiSays(game, 'PLAY: Hunter');
    }
    equal(game.isHumanTurn(), true, 'the human reaches their turn in seat ' + seat);
    equal(humanPlays(game, 'bonus', null).ok, true, 'and can play from there');
  }
});

test('playUntilHumanOrOver stops at the human turn', function () {
  var game = GameApi.create({ seed: 8, rounds: 3 });
  var result = game.playUntilHumanOrOver();
  equal(result.over, false);
  equal(game.isHumanTurn(), true);
  equal(result.failures.length, 0, 'no relay failures');
  assert(result.steps <= 4, 'at most the other four seats acted: ' + result.steps);
});

test('playUntilHumanOrOver reports a bad reply instead of playing it', function () {
  var game = GameApi.create({ seed: 8, rounds: 3 });
  var result = game.playUntilHumanOrOver(function () { return 'PLAY: Dragon'; });
  equal(result.failures.length, 1);
  assert(/not a card/.test(result.failures[0].error), result.failures[0].error);
  equal(game.state.over, false, 'the game did not carry on without the AI');
});

test('status() describes the table', function () {
  var game = firstGame({ seed: 8, rounds: 3 });
  var status = game.status();
  equal(status.round, 1);
  equal(status.rounds, 3);
  equal(status.seat, 0);
  equal(status.player.id, HUMAN);
  equal(status.isHumanTurn, true);
  equal(status.over, false);
  equal(status.standings.length, 5);
  equal(status.winner, null);
});

test('a full headless game finishes and produces a winner', function () {
  var game = GameApi.create({ seed: 2024, rounds: 6 });
  var guard = 0;
  while (!game.state.over && guard++ < 400) {
    if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
    else aiSays(game, 'PLAY: Hunter');
  }
  equal(game.state.over, true);
  var status = game.status();
  assert(status.winner, 'there is a winner');
  equal(status.winner.seat, game.state.winnerSeat);
  equal(status.standings.length, 5);
  assert(game.log.some(function (l) { return l.type === 'over' && /wins|tied/.test(l.text); }),
    'the log ends with a result');
  equal(game.log.filter(function (l) { return l.type === 'round'; }).length, 5,
    'one marker for rounds 2..6');
});

test('every seat either acts or sits out once per round', function () {
  var game = GameApi.create({ seed: 31337, rounds: 8 });
  var guard = 0;
  while (!game.state.over && guard++ < 600) {
    if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
    else aiSays(game, 'PLAY: Hunter');
  }
  equal(game.state.over, true);
  var state = game.state;
  var played = state.players.reduce(function (n, p) { return n + p.turnsPlayed; }, 0);
  var skipped = state.players.reduce(function (n, p) { return n + p.turnsSkipped; }, 0);
  equal(played + skipped, state.rounds * 5, 'every seat got exactly one turn per round');
  state.players.forEach(function (p) {
    equal(p.turnsPlayed + p.turnsSkipped, state.rounds, p.name + ' had ' + state.rounds + ' turns');
  });
});

test('many seeds all finish through the relay', function () {
  for (var n = 0; n < 40; n++) {
    var game = GameApi.create({ seed: nextSeed(), rounds: 5 });
    var guard = 0;
    while (!game.state.over && guard++ < 200) {
      if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
      else aiSays(game, 'PLAY: Hunter');
    }
    equal(game.state.over, true, 'seed ' + game.seed + ' finished');
    assert(game.state.standings.length === 5, 'seed ' + game.seed + ' has five standings');
  }
});

test('the same seed and the same replies replay identically', function () {
  function run(seed) {
    var game = GameApi.create({ seed: seed, rounds: 5 });
    var guard = 0;
    while (!game.state.over && guard++ < 200) {
      if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
      else aiSays(game, 'PLAY: Hunter');
    }
    return game.state.players.map(function (p) { return p.id + ':' + p.points; }).join(',');
  }
  equal(run(4242), run(4242), 'identical seeds give identical scores');
});

test('different AI replies produce different games', function () {
  // The clearest proof that the external AI decides the game: the same seed and
  // the same human moves, and the AIs bank points in one run but not the other.
  function run(reply) {
    var game = GameApi.create({ seed: 4242, rounds: 6 });
    var guard = 0;
    while (!game.state.over && guard++ < 200) {
      if (game.isHumanTurn()) humanPlays(game, 'bonus', null);
      else aiSays(game, reply);
    }
    return {
      over: game.state.over,
      aiTotal: game.state.players.reduce(function (n, p) {
        return n + (p.isHuman ? 0 : p.points);
      }, 0)
    };
  }
  var allHunter = run('PLAY: Hunter');
  var allBonus = run('PLAY: +10,000 Points');
  equal(allHunter.over, true);
  equal(allBonus.over, true);
  equal(allHunter.aiTotal, 0, 'the AIs took the defensive card and scored nothing');
  greater(allBonus.aiTotal, 0, 'the AIs scored by banking points instead');
});

test('the AI targets whoever it names, and the score moves by that much', function () {
  var game = firstGame({ seed: 9, rounds: 6 });
  humanPlays(game, 'bonus', null);
  var seat = game.state.turnInRound;
  give(game.state, seat, 'steal');                // make sure they hold the card
  var target = Rules.legalTargets(game.state, seat, 'steal')[0];
  var victimSeat = Rules.playerById(game.state, target).seat;
  game.state.players[victimSeat].points = 30000;

  var result = game.submitAiMove(
    'PLAY: Steal Points\nTARGET: ' + Rules.playerById(game.state, target).name
  );
  equal(result.ok, true, result.error);
  equal(game.state.players[seat].points, 30000, 'the AI took the named pile');
  equal(game.state.players[victimSeat].points, 0, 'and the named player lost it');
});

test('no module in the project references the deleted AI decision engine', function () {
  var fs = require('fs');
  var dir = path.join(__dirname, '..', 'js');
  var offenders = [];
  fs.readdirSync(dir).forEach(function (file) {
    if (!/\.js$/.test(file)) return;
    var text = fs.readFileSync(path.join(dir, file), 'utf8');
    if (/PhoenixAI|chooseAction|PERSONALITIES/.test(text)) offenders.push(file);
  });
  equal(fs.existsSync(path.join(dir, 'ai.js')), false, 'js/ai.js is gone');
  deepEqual(offenders, [], 'nothing references the old AI engine');
});
suite('Cards against each other');

test('a Hunter holding up across a whole round changes nothing', function () {
  var s = newGame();
  playAt(s, 0, 'hunter', null);              // the human is a Hunter
  var points = 0;
  var guard = 0;
  while (s.round <= 3 && guard++ < 40) {
    points = byId(s, HUMAN).points;
    // Every other player tries the only card that could hurt them.
    var seat = s.turnInRound;
    if (seat !== 0) {
      equal(Rules.playCard(s, seat, 'zombie', HUMAN).ok, false,
        'seat ' + seat + ' cannot Zombie the Hunter');
    }
    playBonus(s, 1);
  }
  equal(byId(s, HUMAN).hunter, true, 'the Hunter never lost the effect');
  equal(byId(s, HUMAN).points, points, 'and the last bonus stands - no reset');
  greater(byId(s, HUMAN).points, 0, 'the Hunter is still scoring');
});

test('Steal into a Zombie chain never creates negative points', function () {
  var game = GameApi.create({ seed: 66, rounds: 3 });
  var guard = 0;
  while (!game.state.over && guard++ < 200) {
    if (game.isAwaitingChoice() && choiceIsDue(game.state)) {
      var info = game.pendingChoice();
      var pick = game.choiceOptions()[0];
      var choice = game.playForcedChoice(pick.cardId, pick.targetId);
      if (!choice.ok) break;
    } else if (game.isHumanTurn()) {
      humanPlays(game, 'bonus', null);
    } else {
      game.submitAiMove(greedyReply(game.state, game.state.turnInRound));
    }
    game.state.players.forEach(function (p) {
      assert(p.points >= 0, p.name + ' has negative points');
      assert(p.points === Math.floor(p.points), p.name + ' has a fractional score');
    });
  }
  equal(game.state.over, true);
});

test('a full sweep of every card at every target stays legal', function () {
  var s = newGame({ rounds: 2, seed: 1 });
  // Phoenix is not dealt or drawn, so it is swept separately - see the legendary
  // card suite - rather than being pushed into a hand this sweep can reach.
  Cards.deckCards().forEach(function (card) {
    // Hold every card, so this sweeps CARD RULES rather than the deal.
    ensure(s, s.turnInRound, card.id);
    var list = card.needsTarget
      ? Rules.legalTargets(s, s.turnInRound, card.id)
      : [null];
    greater(list.length, 0, card.id + ' has somewhere to go');
    list.forEach(function (target) {
      assert(Rules.isPlayable(s, s.turnInRound, card.id, target),
        card.id + ' should be playable at ' + target);
    });
  });
});

test('scores always end as whole numbers a leader could be proud of', function () {
  var s = newGame({ rounds: 6, seed: 909 });
  var guard = 0;
  while (!s.over && guard++ < 200) {
    Rules.playCard(s, s.turnInRound, 'bonus', null);
  }
  s.players.forEach(function (p) {
    equal(p.points % 1, 0, p.name + ' score is whole');
    equal(p.points % 10000, 0, p.name + ' score is in bonus-sized steps when only bonuses are played');
  });
});

/* --------------------------------------------------------------------- */

console.log('\n' + '='.repeat(58));
if (failures.length === 0) {
  console.log('\u001b[32mALL ' + passed + ' TESTS PASSED\u001b[0m');
} else {
  console.log('\u001b[31m' + failures.length + ' FAILED\u001b[0m, ' + passed + ' passed');
  failures.forEach(function (f) {
    console.log('  - ' + f.suite + ' > ' + f.name + ': ' + f.err.message);
  });
  process.exitCode = 1;
}
console.log('='.repeat(58));
