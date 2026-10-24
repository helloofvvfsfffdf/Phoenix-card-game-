/* PHOENIX — Single Player minigames: Rock Paper Scissors and Betrayal.
 *
 * In multiplayer these two cards are decided by the server's own timed
 * interactions. In Single Player there is no server and no live table - every
 * opponent is an AI played through the copy-and-paste relay - so the outcome
 * cannot be a roll: it is what the players CHOOSE.
 *
 * These tests hold that line:
 *   - in Single Player the card opens a challenge and stops the turn, and the
 *     two answers come from the players themselves: the human's from the
 *     choice buttons, an AI's from a one-word relay reply;
 *   - neither answer reaches the log before both are in, so nobody can see the
 *     other's throw and answer accordingly;
 *   - a tie throws again, and the held turn only moves on once the challenge
 *     has settled;
 *   - multiplayer is untouched: no Single Player flag, no challenge, the card
 *     resolves at once exactly as it always did.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Rules = require('../js/rules');
const Prompt = require('../js/prompt');
const GameApi = require('../js/game');

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

function ok(condition, message) {
  if (!condition) throw new Error(message || 'expected truthy value');
}

/** The one human seat, whoever they are called this seed. */
function humanOf(s) {
  return s.players.find(function (p) { return p.isHuman; });
}

function aisOf(s) {
  return s.players.filter(function (p) { return !p.isHuman; });
}

function logText(g) {
  return g.log.map(function (entry) { return entry.text || ''; }).join('\n');
}

function resultLine(g, cardId) {
  const pattern = cardId === 'rps' ? /Rock Paper Scissors - / : /Betrayal - /;
  return g.log.filter(function (entry) { return pattern.test(entry.text || ''); }).pop();
}

/* ===================================================================== */
/* Rock Paper Scissors: the challenge, not a roll                        */
/* ===================================================================== */

suite('Rock Paper Scissors in Single Player');

test('playing it opens a challenge instead of resolving', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;

  const played = g.playHuman('rps', ai.id);
  ok(played.ok, 'the card plays: ' + (played.error || ''));

  const pending = s.pendingChoice;
  ok(pending, 'a choice is pending');
  equal(pending.kind, Rules.PENDING_CHOICE_KINDS.MINIGAME, 'of the minigame kind');
  equal(pending.game, 'rps', 'for Rock Paper Scissors');
  equal(pending.chooserId, human.id, 'the challenger throws first');
  equal(s.turnInRound, human.seat, 'the turn is held, not advanced');
  equal(Rules.legalMoves(s, human.seat).length, 0,
    'no cards are offered while the challenge is open');
});

test('nobody may play another card until it settles', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  // The human's own hand, from the human's own path.
  const refused = g.playHuman('zombie', ai.id);
  ok(!refused.ok, 'the hand refuses');
  ok(/settle first/.test(refused.error), 'and says why: ' + refused.error);

  // And somebody else's card, on somebody else's turn, straight through the
  // engine - a challenge belongs to no turn at all, so the turn check passes
  // and the challenge is what stops it.
  const other = aisOf(s)[1];
  s.turnInRound = other.seat;
  const engineRefused = Rules.playCard(s, other.seat, 'zombie', human.id);
  ok(!engineRefused.ok, 'the engine refuses too');
  ok(/settle first/.test(engineRefused.error),
    'with the same reason: ' + engineRefused.error);

  // The relay cannot smuggle a card in either.
  const relayRefused = g.submitAiMove('PLAY: Zombie\nTARGET: ' + human.name);
  ok(!relayRefused.ok, 'the relay refuses');
  ok(/settle first/.test(relayRefused.error),
    'with the same reason: ' + relayRefused.error);
});

test('the human throws with a button, and the throw stays secret', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  equal(g.isHumanChoosing(), true, 'it is the human\'s throw to make');
  equal(g.isChoiceDue(), true, 'due immediately, not on anybody\'s turn');
  const options = g.choiceOptions();
  equal(options.length, 3, 'three throws are offered');
  equal(options.map(function (o) { return o.name; }).join(','), 'Rock,Paper,Scissors',
    'named Rock, Paper and Scissors');
  equal(options[0].pickId, 'rock', 'each carrying the pick the buttons send');
  equal(options[0].cardId, null, 'and no card at all');

  const thrown = g.playForcedChoice('rock');
  ok(thrown.ok, 'the click is taken: ' + (thrown.error || ''));
  equal(thrown.waiting, true, 'the challenge waits for the other throw');
  equal(thrown.nextChooser, ai.name, 'and it is now the AI\'s throw to make');
  equal(s.pendingChoice.chooserId, ai.id, 'the pending chooser has moved');

  ok(!/\bthrew /.test(logText(g)),
    'the throw never reaches the log while the other is still owed');
  ok(/plays Rock Paper Scissors/.test(logText(g)), 'the card play itself is logged');
});

test('the relay prompt asks the AI for one word', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);
  g.playForcedChoice('scissors');

  equal(g.isAiChoosing(), true, 'the relay panel takes over');
  equal(g.isChoiceDue(), true, 'and the answer is due now');
  const prompt = g.choicePromptForCurrent();
  ok(/ROCK PAPER SCISSORS/.test(prompt), 'the prompt names the challenge');
  ok(prompt.indexOf(human.name) !== -1, 'and says who challenged');
  ok(/challenged YOU/.test(prompt), 'from the thrower\'s point of view');
  ok(/exactly ONE word/.test(prompt), 'and how to answer');
  ok(/rock or paper or scissors/.test(prompt), 'listing every throw');
  ok(/Rock beats Scissors/.test(prompt), 'with the rules of the game');
  ok(/eliminated for one round/.test(prompt), 'and what is at stake');
  ok(/Reply now with your choice/.test(prompt), 'with a closing instruction');
  ok(/=== RECENT PLAY ===/.test(prompt), 'carrying the recent play for context');
});

test('a one-word reply settles it, and both throws come out together', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);
  g.playForcedChoice('rock');

  const answered = g.submitForcedChoice('I will go with paper, obviously.');
  ok(answered.ok, 'the relay accepts a word reply: ' + (answered.error || ''));
  equal(answered.waiting, false, 'and the challenge is settled by it');

  const line = resultLine(g, 'rps');
  ok(line, 'the result is logged');
  ok(/threw Rock/.test(line.text) && /threw Paper/.test(line.text),
    'revealing both throws at once: ' + line.text);
  ok(/wins/.test(line.text), 'naming a winner: ' + line.text);
  ok(/eliminated for 1 round/.test(line.text), 'and costing the loser a round');
  equal(s.pendingChoice, null, 'the challenge is cleared');
  ok(s.turnInRound !== human.seat, 'the held turn finally moved on');
});

test('an AI that played the card throws first, through the relay', function () {
  const g = GameApi.create({ seed: 7, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[ai.id].push('rps');
  s.turnInRound = ai.seat;

  const played = g.submitAiMove('PLAY: Rock Paper Scissors\nTARGET: ' + human.name);
  ok(played.ok, 'the relay plays it at the human: ' + (played.error || ''));
  equal(s.pendingChoice.chooserId, ai.id, 'the AI throws first');
  equal(g.isAiChoosing(), true, 'so the relay asks for its throw');
  const prompt = g.choicePromptForCurrent();
  ok(/YOU challenged/.test(prompt), 'and the prompt reads as their own challenge');
  ok(prompt.indexOf(human.name) !== -1, 'naming the player they challenged');
  ok(!/\bthrew /.test(logText(g)), 'nothing has been thrown in public yet');

  const aiThrow = g.submitForcedChoice('scissors');
  ok(aiThrow.ok && aiThrow.waiting, 'the AI throw is taken');
  equal(g.isHumanChoosing(), true, 'and now the human throws');
  const options = g.choiceOptions();
  equal(options.map(function (o) { return o.name; }).join(','), 'Rock,Paper,Scissors',
    'the buttons offer the three throws');
  ok(g.playForcedChoice('paper').ok, 'the human\'s click is taken');

  const line = resultLine(g, 'rps');
  ok(line && /threw Scissors/.test(line.text) && /threw Paper/.test(line.text),
    'both throws revealed at once: ' + (line && line.text));
  ok(line && /wins/.test(line.text), 'with a winner: ' + (line && line.text));
});

test('a tie wipes both throws and they go again', function () {
  const g = GameApi.create({ seed: 11, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  g.playForcedChoice('rock');
  const tie = g.submitForcedChoice('rock');
  ok(tie.ok && tie.waiting, 'the tie keeps the challenge open');
  ok(/tie/i.test(logText(g)), 'and says so at the table');
  equal(s.pendingChoice.index, 0, 'back to the first thrower');
  equal(s.pendingChoice.chooserId, human.id, 'which is the challenger');
  ok(s.turnInRound === human.seat, 'and the turn is still held');

  // The second round settles it.
  g.playForcedChoice('paper');
  ok(g.submitForcedChoice('rock').ok, 'the rematch settles');
  equal(s.pendingChoice, null, 'and clears the challenge');
  const lines = g.log.filter(function (e) { return /Rock Paper Scissors - /.test(e.text || ''); });
  ok(lines.length >= 3, 'the tie and the settled throw are both logged');
  ok(/both threw Rock/.test(lines[1].text), 'the tie line: ' + lines[1].text);
});

test('an invalid throw is refused without disturbing the challenge', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  const refused = g.submitForcedChoice('I refuse to answer');
  ok(!refused.ok, 'a reply with no throw in it is refused');
  ok(/one word/.test(refused.error), 'and says what is wanted: ' + refused.error);
  equal(s.pendingChoice.chooserId, human.id, 'the challenge is untouched');
  equal(s.pendingChoice.index, 0, 'and still on the first thrower');

  const badClick = g.playForcedChoice('banana');
  ok(!badClick.ok, 'a button that does not exist is refused too');
  equal(s.pendingChoice.chooserId, human.id, 'and the challenge is untouched');
  equal(Rules.legalMoves(s, human.seat).length, 0, 'no cards slipped in either');
});

/* ===================================================================== */
/* Betrayal: two opponents, one answer each                              */
/* ===================================================================== */

suite('Betrayal in Single Player');

test('it opens a challenge for the two opponents to answer', function () {
  const g = GameApi.create({ seed: 3, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('betrayal');
  s.turnInRound = human.seat;

  const played = g.playHuman('betrayal', ai.id);
  ok(played.ok, 'the card plays: ' + (played.error || ''));
  equal(s.pendingChoice.game, 'betrayal', 'for Betrayal');
  equal(s.pendingChoice.order.length, 2, 'two opponents must answer');
  equal(s.pendingChoice.order[0], ai.id, 'the chosen opponent answers first');
  ok(s.pendingChoice.order[1] !== ai.id && s.pendingChoice.order[1] !== human.id,
    'and the second is somebody else entirely - the challenger sits it out');
  equal(s.turnInRound, human.seat, 'the turn is held');

  const options = g.choiceOptions();
  equal(options.map(function (o) { return o.name; }).join(','), 'Share,Steal',
    'Share or Steal are offered');
  equal(g.isAiChoosing(), true, 'the first answer belongs to the AI');
});

test('answers stay secret until both are in, then the outcome applies', function () {
  // An AI plays Betrayal at the human: the chosen opponent - the human - is
  // asked first, through the buttons, and the AI answers second through the
  // relay. Neither answer may reach the log before both are in.
  const g = GameApi.create({ seed: 3, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[ai.id].push('betrayal');
  s.turnInRound = ai.seat;

  const played = g.submitAiMove('PLAY: Betrayal\nTARGET: ' + human.name);
  ok(played.ok, 'the relay plays it: ' + (played.error || ''));
  equal(s.pendingChoice.order[0], human.id, 'the human is asked first');
  equal(g.isHumanChoosing(), true, 'through the buttons');
  const options = g.choiceOptions();
  equal(options.map(function (o) { return o.name; }).join(','), 'Share,Steal',
    'offering Share or Steal');

  ok(g.playForcedChoice('steal').ok, 'the human clicks Steal');
  ok(!/chose (Share|Steal)/.test(logText(g)),
    'their answer reaches no log while the other is still owed');
  equal(g.isAiChoosing(), true, 'and now the AI owes the answer');
  const prompt = g.choicePromptForCurrent();
  ok(/share or steal/.test(prompt), 'through a prompt offering both answers');
  ok(prompt.indexOf(human.name) !== -1, 'naming who else is in it');

  ok(g.submitForcedChoice('I would never steal. Share.').ok, 'the AI answers');
  const line = resultLine(g, 'betrayal');
  ok(line, 'the outcome is logged');
  ok(/chose Steal/.test(line.text) && /chose Share/.test(line.text),
    'revealing both answers together: ' + line.text);
  ok(/gains 20,000/.test(line.text), 'and applying the steal: ' + line.text);
  equal(s.pendingChoice, null, 'the challenge is cleared');
  ok(s.turnInRound !== ai.seat, 'the held turn moved on');
});

test('every one of the four outcomes is applied from the answers', function () {
  const outcomes = [
    { a: 'share', b: 'share', expect: /Both gain 10,000/ },
    { a: 'steal', b: 'share', expect: /gains 20,000/ },
    { a: 'share', b: 'steal', expect: /gains 20,000/ },
    { a: 'steal', b: 'steal', expect: /Nobody gains anything/ }
  ];
  outcomes.forEach(function (outcome, index) {
    const g = GameApi.create({ seed: 100 + index, rounds: 5, singlePlayer: true });
    const s = g.state;
    const human = humanOf(s);
    const ai = aisOf(s)[0];
    s.hands[human.id].push('betrayal');
    s.turnInRound = human.seat;
    g.playHuman('betrayal', ai.id);

    // Whoever owes the next answer gets it, through their own channel: the
    // human clicks, an AI replies through the relay.
    function answer(pick) {
      return s.pendingChoice.chooserId === human.id
        ? g.playForcedChoice(pick)
        : g.submitForcedChoice(pick);
    }
    answer(outcome.a);
    answer(outcome.b);

    const line = resultLine(g, 'betrayal');
    ok(line, 'outcome logged for ' + outcome.a + '/' + outcome.b);
    ok(outcome.expect.test(line.text),
      outcome.a + ' vs ' + outcome.b + ' -> ' + line.text);
    equal(s.pendingChoice, null, 'and the challenge cleared');
  });
});

test('the relay prompt explains Betrayal in full', function () {
  const g = GameApi.create({ seed: 3, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[ai.id].push('betrayal');
  s.turnInRound = ai.seat;
  g.submitAiMove('PLAY: Betrayal\nTARGET: ' + human.name);

  const prompt = g.choicePromptForCurrent();
  ok(/BETRAYAL/.test(prompt), 'the prompt names the challenge');
  ok(prompt.indexOf(ai.name) !== -1, 'saying who played it');
  ok(/each choose in secret/.test(prompt), 'and that the answers are secret');
  ok(/both gain 10,000/.test(prompt), 'with the Share/Share outcome');
  ok(/stealer takes 20,000/.test(prompt), 'the steal against a share');
  ok(/nobody gains anything/.test(prompt), 'and steal against steal');
  ok(/exactly ONE word/.test(prompt), 'how to answer');
  ok(/share or steal/.test(prompt), 'listing the two answers');
});

/* ===================================================================== */
/* The reply parser                                                      */
/* ===================================================================== */

suite('Reading the pick out of a reply');

test('the last throw named in the reply is the throw', function () {
  equal(Rules.minigamePickFrom('PLAY: ROCK', 'rps'), 'rock', 'a bare word');
  equal(Rules.minigamePickFrom('Hmm... paper.', 'rps'), 'paper', 'with commentary');
  equal(Rules.minigamePickFrom('rock then scissors', 'rps'), 'scissors',
    'the last one written wins');
  equal(Rules.minigamePickFrom('SCISSORS', 'rps'), 'scissors', 'any case');
  equal(Rules.minigamePickFrom('I refuse to answer', 'rps'), null,
    'no throw in the reply at all');
  equal(Rules.minigamePickFrom('', 'rps'), null, 'an empty reply');
  equal(Rules.minigamePickFrom(null, 'rps'), null, 'no reply at all');
});

test('Betrayal reads the last answer written, not the last one listed', function () {
  equal(Rules.minigamePickFrom('Share', 'betrayal'), 'share', 'a bare word');
  // "steal" appears earlier in the sentence but Share is what comes last -
  // and Share is the answer, because position in the REPLY decides it.
  equal(Rules.minigamePickFrom('I would never steal. Share.', 'betrayal'), 'share',
    'the later answer wins even when the other word comes first');
  equal(Rules.minigamePickFrom('Share? Never. Steal.', 'betrayal'), 'steal',
    'and the other way round');
  equal(Rules.minigamePickFrom('no idea', 'betrayal'), null, 'no answer at all');
  equal(Rules.minigamePickFrom('rock', 'betrayal'), null,
    'a throw is not an answer to Betrayal');
  equal(Rules.minigamePickFrom('share', 'rps'), null,
    'and Share is not a throw');
  equal(Rules.minigamePickFrom('rock', 'nonsense'), null, 'an unknown game');
});

/* ===================================================================== */
/* Multiplayer is untouched                                              */
/* ===================================================================== */

suite('Multiplayer still rolls both sides');

test('without the Single Player flag RPS resolves at once', function () {
  const g = GameApi.create({ seed: 5, rounds: 5 });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;

  const played = g.playHuman('rps', ai.id);
  ok(played.ok, 'the card plays: ' + (played.error || ''));
  equal(s.pendingChoice, null, 'and no challenge is opened');
  const line = resultLine(g, 'rps');
  ok(line, 'it resolves immediately');
  ok(/chose /.test(line.text), 'with the rolled throws: ' + line.text);
  ok(s.turnInRound !== human.seat, 'and the turn moved on in the same breath');
});

test('without the Single Player flag Betrayal resolves at once', function () {
  const g = GameApi.create({ seed: 6, rounds: 5 });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('betrayal');
  s.turnInRound = human.seat;

  const played = g.playHuman('betrayal', ai.id);
  ok(played.ok, 'the card plays: ' + (played.error || ''));
  equal(s.pendingChoice, null, 'and no challenge is opened');
  const line = resultLine(g, 'betrayal');
  ok(line, 'it resolves immediately');
  ok(/chose /.test(line.text), 'with the rolled answers: ' + line.text);
});

test('the multiplayer engine has no Single Player flag to trip on', function () {
  const source = require('fs').readFileSync(
    path.join(ROOT, 'server.js'), 'utf8');
  ok(source.indexOf('singlePlayer') === -1,
    'server.js never sets state.singlePlayer');
  const state = GameApi.create({ rounds: 3 }).state;
  equal(state.singlePlayer, false, 'a plain game is not Single Player');
});

test('resolvePendingChoice refuses to answer a challenge with a card', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  const refused = Rules.resolvePendingChoice(s, 'zombie', null);
  ok(!refused.ok, 'the card path will not answer a challenge');
  ok(/resolveMinigameChoice/.test(refused.error),
    'and points at the right one: ' + refused.error);
  equal(s.pendingChoice.chooserId, human.id, 'leaving the challenge in place');
});

test('the challenge answers through resolveMinigameChoice alone', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);

  const info = Rules.minigameInfo(s);
  ok(info, 'the challenge describes itself');
  equal(info.kind, Rules.PENDING_CHOICE_KINDS.MINIGAME, 'as a minigame');
  equal(info.game, 'rps', 'for Rock Paper Scissors');
  equal(info.label, 'Rock Paper Scissors', 'with a label the UI can show');
  equal(info.chooserName, human.name, 'naming who answers now');
  equal(info.options.length, 3, 'and offering three throws');
  equal(info.participants.length, 2, 'with both players in it');
  equal(info.actorName, human.name, 'and who started it');

  const pick = Rules.resolveMinigameChoice(s, 'rock');
  ok(pick.ok && pick.waiting, 'the first answer is taken');
  equal(Rules.minigameInfo(s).chooserName, ai.name, 'and hands the question on');
  equal(Rules.resolveMinigameChoice(s, 'lizard').ok, false,
    'an answer that is not one of the choices is refused');
});

test('the prompt for a challenge is built for a challenge', function () {
  const g = GameApi.create({ seed: 42, rounds: 5, singlePlayer: true });
  const s = g.state;
  const human = humanOf(s);
  const ai = aisOf(s)[0];
  s.hands[human.id].push('rps');
  s.turnInRound = human.seat;
  g.playHuman('rps', ai.id);
  g.playForcedChoice('paper');

  const info = Rules.minigameInfo(s);
  const prompt = Prompt.buildChoicePrompt(s, info, g.log);
  ok(prompt.indexOf('You are playing PHOENIX as ' + ai.name) !== -1,
    'the prompt opens as the thrower');
  ok(/ROCK PAPER SCISSORS/.test(prompt), 'and is about the challenge');
  ok(/exactly ONE word/.test(prompt), 'with the answer format');
  ok(!/^\s*PLAY:/m.test(prompt), 'and NOT the card answer format');
  ok(!/^\s*TARGET:/m.test(prompt), 'no target line either');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
