/* PHOENIX - HARDCORE.
 *
 * A hardcore match is the same game with one rule changed: every card plays
 * TWICE. These checks are against the real engine and the real server, never
 * against a copy of them.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Rules = require('../js/rules');
const Cards = require('../js/cards');

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

/** A game with a known seat order. */
function game(options) {
  return Rules.createGame(Object.assign({
    seed: 42, fixedOrder: true, rotateStart: false, rounds: 10
  }, options || {}));
}

/**
 * Play a card through the real engine, with that card in the player's hand.
 *
 * `targetSeat` picks who it is aimed at, so a card's effect on a TARGET can
 * be measured rather than guessed.
 */
function playCard(state, cardId, targetSeat) {
  const seat = state.turnInRound;
  const id = state.players[seat].id;
  state.hands[id] = [cardId];
  const moves = Rules.legalMoves(state, seat).filter(function (m) { return m.cardId === cardId; });
  const move = targetSeat === undefined ? moves[0] : moves.filter(function (m) {
    return m.targetId === state.players[targetSeat].id;
  })[0];
  assert(move, cardId + ' is a legal move');
  const result = Rules.playCard(state, seat, move.cardId, move.targetId);
  assert(result.ok, cardId + ' is played: ' + (result.error || ''));
  return result;
}

/** The result lines a card produced. */
function results(result) {
  return result.events.filter(function (e) { return e.type === 'result'; });
}

/* ===================================================================== */
/* The flag                                                              */
/* ===================================================================== */

suite('HARDCORE');

test('a hardcore game says so, and an ordinary one does not', function () {
  equal(game().hardcore, false, 'an ordinary match is not hardcore');
  equal(game({ hardcore: true }).hardcore, true, 'a hardcore match is');
});

test('the new owner-only card is a card, and it is the owner\'s alone', function () {
  const card = Cards.byId('enjoyingthetrailer');
  assert(card, 'the card exists');
  equal(card.name, 'Enjoying the Trailer');
  equal(card.ownerOnly, true, 'it is owner only');
  equal(card.needsTarget, true, 'it picks an opponent');
  equal(card.inDeck, false, 'and it is never dealt into an ordinary deck');
  assert(Rules.isOwnerOnlyCard('enjoyingthetrailer'), 'the engine agrees');
  assert(Rules.isOwnerOnlyCard('trailer'), 'like the trailer beside it');
  assert(!Rules.isOwnerOnlyCard('knife'), 'and unlike an ordinary card');
});

/* ===================================================================== */
/* Every card plays twice                                               */
/* ===================================================================== */

test('a card plays twice, and both effects land', function () {
  const state = game({ hardcore: true });
  const before = state.players[state.turnInRound].points;
  const result = playCard(state, 'bonus');
  const lines = results(result);
  equal(lines.length, 2, 'there are two results');
  equal(state.players[0].points - before, 20000, 'and the points land twice');
});

test('an ORDINARY match is unchanged: one play, one effect', function () {
  const state = game();
  const before = state.players[state.turnInRound].points;
  const result = playCard(state, 'bonus');
  equal(results(result).length, 1, 'there is one result');
  equal(state.players[0].points - before, 10000, 'and the points land once');
});

test('a card aimed at somebody lands on them twice', function () {
  const state = game({ hardcore: true });
  const target = state.players[1];
  target.points = 50000;
  const before = target.points;
  const result = playCard(state, 'steal', 1);
  equal(results(result).length, 2, 'the card plays twice');
  assert(target.points < before, 'and the target feels it');
});

test('the eliminations STACK: a knife twice is two rounds out', function () {
  const state = game({ hardcore: true });
  const target = state.players[1];
  playCard(state, 'knife', 1);
  // The target is out, and out for longer than one round.
  assert(Rules.isOut(target, state), 'the target is out');
  equal(target.outUntilRound, 2, 'and out for TWO rounds, not one');
});

test('in an ORDINARY match a knife is one round out', function () {
  const state = game();
  const target = state.players[1];
  playCard(state, 'knife', 1);
  assert(Rules.isOut(target, state), 'the target is out');
  equal(target.outUntilRound, 1, 'for exactly the one round');
});

test('the PHOENIX card is never played twice', function () {
  const state = game({ hardcore: true });
  const actor = state.players[state.turnInRound];
  actor.hasPhoenix = true;
  state.hands[actor.id] = ['phoenix'];
  const result = Rules.playCard(state, state.turnInRound, 'phoenix', null);
  assert(result.ok, result.error);
  equal(results(result).length, 1, 'the Phoenix is spent once, for good');
});

test('Customer Support is never played twice', function () {
  const state = game({ hardcore: true });
  const result = playCard(state, 'support', 1);
  equal(results(result).length, 1, 'one complaint is one complaint');
});

test('the MIMIC is never played twice - it is handed over', function () {
  const state = game({ hardcore: true });
  const result = playCard(state, 'mimic', 1);
  equal(results(result).length, 1, 'there is only ever one Mimic');
});

/* ===================================================================== */
/* The card list                                                         */
/* ===================================================================== */

test('every card in the game has a resolver, so it can be played', function () {
  Cards.CARDS.forEach(function (card) {
    const state = game({ hardcore: true });
    const seat = state.turnInRound;
    const id = state.players[seat].id;
    state.hands[id] = [card.id];
    if (card.id === 'phoenix') state.players[seat].hasPhoenix = true;
    const move = Rules.legalMoves(state, seat).filter(function (m) { return m.cardId === card.id; })[0];
    if (!move) return;   // a card that cannot be played here is not an error
    const result = Rules.playCard(state, seat, move.cardId, move.targetId);
    assert(result.ok, card.id + ' is played: ' + (result.error || ''));
  });
});

/* ===================================================================== */

console.log('\n' + passed + ' hardcore checks passed, ' + failed + ' failed');
if (failed) process.exit(1);
