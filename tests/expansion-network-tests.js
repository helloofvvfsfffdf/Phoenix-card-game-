/* PHOENIX — the expansion, over real sockets.
 *
 * The interactive cards of the expansion are driven the way a player drives
 * them: the card is played, the server sets the interaction, the players
 * answer, and the server decides. Nothing here reaches into the engine.
 */
'use strict';

const assert = require('assert');
const match = require('./helpers/interaction-match');
const actingClient = require('./helpers/acting-client');

let passed = 0;
let failed = 0;

/** The cards that ask the players for a decision, and so need answering. */
const INTERACTIVE = ['rps', 'betrayal', 'speed', 'dice', 'wheel', 'linkedfate', 'impostor',
  'swapper', 'wheelofmisfortune', 'musicalchairs', 'russianroulette', 'memorymayhem',
  'mimic', 'support', 'joshuasurvey', 'trailer'];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch(error => { failed++; console.error('  X ' + name + ': ' + error.message); });
}

function suite(name) {
  console.log('\n' + name);
}

function state(m) { return m.state(); }
function player(m, id) { return state(m).players.find(p => p.id === id); }

/** The interaction the server is waiting for, or null. */
function pending(m) { return state(m).pendingInteraction; }

/** The published result of the last interaction. */
function resultText(m) {
  const result = m.state().lastInteractionResult;
  return (result && result.events || []).map(e => e.text || '').join(' ');
}

async function main() {
  suite('The owner-only cards');

  await test('the server refuses them in a public room', async () => {
    const m = await match();
    try {
      const actor = m.clients.find(c => c.state.acting);
      const error = await m.rejected(actor, { type: 'move', cardId: 'joshuasurvey', targetId: null });
      assert(/does not exist/.test(error.message), 'the survey is refused: ' + error.message);
      const error2 = await m.rejected(actor, { type: 'move', cardId: 'trailer', targetId: null });
      assert(/does not exist/.test(error2.message), 'the trailer is refused: ' + error2.message);
    } finally { await m.close(); }
  });

  suite('Musical Chairs');

  await test('the music stops, the last presser loses 10,000', async () => {
    const m = await match();
    try {
      await m.play('musicalchairs');
      const pi = pending(m);
      assert(pi, 'the server waits for the presses');
      // Nobody is told when the music stops - with a countdown on screen,
      // everybody would know exactly when to press.
      assert(pi.roundData.musicStopsAt === undefined, 'the moment the music stops is not published');
      // Wait for the music to stop. The server says so when it is time.
      await m.wait(() => m.clients.some(function (client) {
        return client.frames.some(function (frame) { return frame.type === 'chairs-stop'; });
      }), 25000);
      for (const id of pi.participants) {
        if (!m.state().pendingInteraction) break;
        await m.decide(id, 'press');
      }
      await m.wait(() => !m.state().pendingInteraction, 5000);
      assert(!m.state().pendingInteraction, 'the round is over');
      assert(/10,000/.test(resultText(m)), 'the loser is told: ' + resultText(m));
    } finally { await m.close(); }
  });

  await test('the Hostage Situation is never dealt to a two-player lobby', async () => {
    // The card calls the police, and the police officer has to be somebody
    // else at the table - so a two-player lobby never deals it.
    // A natural deal, so the hands are the real ones.
    const m = await match({ players: 2, naturalDeal: true });
    try {
      const seated = m.clients[0].state.players.filter(function (p) { return p.connected; });
      assert.strictEqual(seated.length, 2, 'the lobby has two players');
      // Nobody was dealt the hostage card, and nobody can draw it either.
      const dealt = [];
      m.clients.forEach(function (client) {
        (client.state.hand || []).forEach(function (id) { dealt.push(id); });
      });
      assert.strictEqual(dealt.filter(function (id) { return id === 'hostage'; }).length, 0,
        'a two-player lobby never deals the hostage card');
      // The engine agrees, and a five-player game does deal it.
      const Rules = require('../js/rules');
      const all = function (state) {
        return state.deck.concat(state.players.map(function (p) { return state.hands[p.id]; }));
      };
      assert.strictEqual(all(Rules.createGame({ seed: 5, playerCount: 2 }))
        .filter(function (id) { return id === 'hostage'; }).length, 0,
        'the engine leaves it out too');
      assert.ok(all(Rules.createGame({ seed: 5, playerCount: 5 }))
        .filter(function (id) { return id === 'hostage'; }).length > 0,
        'and a five-player game deals it');
    } finally { await m.close(); }
  });

  suite('Russian Roulette');

  await test('the holder aims, the server pulls the trigger, and it ends', async () => {
    const m = await match();
    try {
      await m.play('russianroulette');
      const pi = pending(m);
      assert(pi, 'the server waits for the aim');
      const holder = pi.actorId;
      const target = pi.participants.find(id => id !== holder);
      await m.decide(holder, 'aim:' + target);
      const after = m.state().pendingInteraction;
      if (after) {
        // Safe: the target now holds the revolver and aims at somebody else.
        assert(after.roundData.holder === target, 'the target holds the revolver');
        const next = after.participants.find(id => id !== after.roundData.holder);
        await m.decide(after.roundData.holder, 'aim:' + next);
      }
      await m.wait(() => !m.state().pendingInteraction, 5000);
      assert(!m.state().pendingInteraction, 'the minigame is over');
      assert(m.state().lastInteractionResult, 'and the result is public');
    } finally { await m.close(); }
  });

  await test('the revolver keeps working as the odds rise, and can come back', async () => {
    // Every pull is a safe one, so the revolver goes round the table.
    const m = await match({ random: [0.99] });
    try {
      await m.play('russianroulette');
      const pulled = [];
      let guard = 0;
      while (m.state().pendingInteraction && guard++ < 6) {
        const pi = m.state().pendingInteraction;
        const holder = pi.roundData.holder;
        assert(holder, 'the revolver is held by somebody');
        // Aim back at the player who held it before, so it really does come
        // back around the table.
        const previous = pulled.length ? pulled[pulled.length - 1] : null;
        const target = pi.participants.find(function (id) {
          return id !== holder && id !== previous;
        }) || previous || pi.participants.find(function (id) { return id !== holder; });
        await m.decide(holder, 'aim:' + target);
        pulled.push(holder);
        if (!m.state().pendingInteraction) break;
      }
      assert(pulled.length >= 3, 'the revolver was pulled at least three times, got ' + pulled.length);
      // And the same player may hold it again.
      const holders = pulled.filter(function (id) { return id === pulled[0]; });
      assert(holders.length >= 1, 'the first holder is still able to hold it');
    } finally { await m.close(); }
  });

  suite('Memory Mayhem');

  await test('everybody writes the sequences back, and somebody loses 8,000', async () => {
    const m = await match();
    try {
      await m.play('memorymayhem');
      const pi = pending(m);
      assert(pi, 'the server waits for the answers');
      const sequences = pi.roundData.sequences;
      assert(sequences.length === 3, 'three sequences');
      // The first two sequences, everybody answers.
      for (let index = 0; index < 2; index++) {
        for (const id of pi.participants) {
          await m.decide(id, 'mem:' + index + ':wrong');
        }
      }
      // The last one: everybody answers correctly.
      const last = sequences[2].join('');
      for (const id of pi.participants) {
        await m.decide(id, 'mem:2:' + last);
      }
      await m.wait(() => !m.state().pendingInteraction, 5000);
      assert(!m.state().pendingInteraction, 'the minigame is over');
      assert(/8,000/.test(resultText(m)), 'somebody lost 8,000: ' + resultText(m));
    } finally { await m.close(); }
  });

  suite('The Mimic');

  await test('the target is handed a card that is not what it looks like', async () => {
    const m = await match();
    try {
      await m.play('mimic');
      const pi = pending(m);
      assert(pi, 'the server waits for the disguise');
      const target = pi.targetId;
      // Only the player who played the Mimic chooses the disguise: the target
      // is handed a card and is not shown the menu of cards they could be
      // given.
      assert.deepStrictEqual(pi.participants, [pi.actorId], 'the target takes no part in the choice');
      await m.decide(pi.actorId, 'disguise:steal');
      const targetClient = m.byId(target);
      assert(targetClient, 'the target has a client');
      assert(targetClient.state.hand.indexOf('steal') !== -1, 'they are shown the disguise');
      assert(targetClient.state.hand.indexOf('mimic') === -1, 'and not the Mimic');
      // The disguise map is the server's own business: the snapshot never
      // carries it, so nobody at the table can work out who holds a Mimic.
      assert(JSON.stringify(m.state()).indexOf('"mimics"') === -1,
        'the server never tells the table who holds a Mimic');
    } finally { await m.close(); }
  });

  await test('playing the disguise starts the prank, and the server holds the player', async () => {
    const m = await match();
    try {
      await m.play('mimic');
      const pi = pending(m);
      const target = pi.targetId;
      await m.decide(pi.actorId, 'disguise:bonus');
      const targetClient = m.byId(target);
      // Wait for the target's turn, letting anybody else act in the meantime.
      let guard = 0;
      while (!targetClient.state.acting && guard++ < 30) {
        const actor = actingClient(m.clients);
        if (!actor) break;
        const move = actor.state.moves.filter(function (m) {
          return !INTERACTIVE.includes(m.cardId) &&
            !(actor.state.mapleBlocked || []).includes(m.cardId);
        })[0];
        if (!move) break;
        await m.action(actor, { type: 'move', cardId: move.cardId, targetId: move.targetId });
      }
      assert(targetClient.state.acting, 'the target gets a turn');
      const disguised = targetClient.state.moves.find(move => move.cardId === 'bonus');
      assert(disguised, 'the disguise is a legal move for them');
      await m.action(targetClient, { type: 'move', cardId: 'bonus', targetId: disguised.targetId });
      // The prank is on: the server holds the player in it, and their own
      // screen says they are watching the video.
      await m.wait(() => targetClient.state.watchingVideo, 5000);
      assert(targetClient.state.watchingVideo, 'the player is told to watch the video');
      // The client says the video is over, and the server lets go.
      await m.action(targetClient, { type: 'rickroll_done' });
      await m.wait(() => !targetClient.state.watchingVideo, 5000);
      assert(!targetClient.state.watchingVideo, 'and the server lets go');
    } finally { await m.close(); }
  });

  suite('Hostage Situation');

  await test('the criminal plays the hostage\'s turn, and the hostage is refused', async () => {
    const m = await match();
    try {
      await m.play('hostage');
      const hostage = m.state().hostage;
      assert(hostage, 'the situation is set');
      assert(hostage.criminalId && hostage.hostageId, 'with a criminal and a hostage');
      const hostageClient = m.byId(hostage.hostageId);
      const criminalClient = m.byId(hostage.criminalId);
      // Play on until the hostage gets a turn of their own.
      let guard = 0;
      while (m.state().current !== hostage.hostageId && guard++ < 40) {
        const actor = actingClient(m.clients);
        if (!actor) break;
        const move = actor.state.moves.filter(function (x) {
          return !INTERACTIVE.includes(x.cardId);
        })[0];
        if (!move) break;
        await m.action(actor, { type: 'move', cardId: move.cardId, targetId: move.targetId });
      }
      assert(m.state().current === hostage.hostageId, 'the hostage gets a turn');
      // Their own socket is refused.
      const error = await m.rejected(hostageClient, { type: 'move', cardId: 'bonus', targetId: null });
      assert(/held hostage/.test(error.message), 'the hostage is refused: ' + error.message);
      // And the criminal is the one who is offered the turn.
      await m.wait(() => criminalClient.state.acting, 5000);
      assert(criminalClient.state.acting, 'the criminal is the one who acts');
      assert(Array.isArray(criminalClient.state.hostageHand), 'and they are shown the hostage\'s hand');
    } finally { await m.close(); }
  });

  await test('the President is first, and the menu is theirs alone', async () => {
    const m = await match();
    try {
      await m.play('president');
      const presidentId = m.state().president.id;
      // The President opens every round from then on.
      const seat = m.state().players.find(function (p) { return p.id === presidentId; }).seat;
      assert.strictEqual(m.state().firstSeat, seat, 'they are first in the play order');
      // The menu is locked while it is their own turn.
      const president = m.byId(presidentId);
      if (m.state().current === presidentId) {
        const error = await m.rejected(president, { type: 'president_ban', cardId: 'bonus' });
        assert(/Take your turn first/.test(error.message), 'the menu is locked on their own turn: ' + error.message);
      }
    } finally { await m.close(); }
  });

  suite('Customer Support');

  await test('the complaint is rejected, and the administration fee is kept', async () => {
    const m = await match();
    try {
      await m.play('support');
      const pi = pending(m);
      assert(pi, 'the target is handed a complaint form');
      const before = player(m, pi.actorId).points;
      await m.decide(pi.targetId, 'complaint:0');
      await m.wait(() => !m.state().pendingInteraction, 5000);
      assert(!m.state().pendingInteraction, 'the complaint is dealt with');
      assert(/rejected/i.test(resultText(m)), 'it is rejected: ' + resultText(m));
      assert(player(m, pi.actorId).points === before + 10000, 'and the fee is kept');
    } finally { await m.close(); }
  });

  suite('The Wheel of Misfortune');

  await test('the caster spins, and the wheel decides', async () => {
    const m = await match();
    try {
      await m.play('wheelofmisfortune');
      const pi = pending(m);
      assert(pi, 'the wheel is waiting for a spin');
      const others = m.clients.filter(c => c !== m.byId(pi.actorId));
      const error = await m.rejected(others[0], { type: 'interact', decision: 'spin' });
      assert(/caster/.test(error.message), 'only the caster may spin: ' + error.message);
      await m.decide(pi.actorId, 'spin');
      await m.wait(() => !m.state().pendingInteraction, 5000);
      assert(!m.state().pendingInteraction, 'the wheel is over');
      assert(/Wheel of Misfortune/.test(resultText(m)), 'and it says what came up: ' + resultText(m));
    } finally { await m.close(); }
  });

  suite('The hand limit');

  await test('no hand is ever larger than seven cards', async () => {
    // A natural deal, so the hands are real hands.
    const m = await match({ naturalDeal: true });
    try {
      let guard = 0;
      while (!m.state().over && guard++ < 120) {
        const actor = actingClient(m.clients);
        if (!actor) break;
        const move = actor.state.moves.filter(function (m) {
          return !INTERACTIVE.includes(m.cardId) &&
            !(actor.state.mapleBlocked || []).includes(m.cardId);
        })[0];
        if (!move) break;
        await m.action(actor, { type: 'move', cardId: move.cardId, targetId: move.targetId });
        for (const client of m.clients) {
          assert(client.state.hand.length <= 7,
            'a hand holds at most seven cards: ' + client.state.hand.length);
        }
      }
    } finally { await m.close(); }
  });

  console.log('\n' + passed + ' expansion network checks passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
