/* Real socket tests for the seven cards other than Speed. Failures are retained,
 * not skipped or converted into passes. Fixture RNG/hands are deterministic;
 * these are interaction checks, not complete random-deal matches. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const match = require('./helpers/interaction-match');
const Cards = require('../js/cards');
const cases = [];
function test(card, name, run, options = {}) { cases.push({ card, name, run, options }); }
function points(m, id) { return m.state().players.find(p => p.id === id).points; }
function complete(m, before) {
  assert.strictEqual(m.state().pendingInteraction, null, 'interaction must finish');
  assert(m.state().current !== before.current || m.state().round > before.round,
    'turn or round must advance (a two-player elimination can return to the same survivor)');
  for (const client of m.clients) {
    assert.strictEqual(client.state.pendingInteraction, null, 'all clients receive completion');
    assert.strictEqual(new Set(client.state.hand).size, client.state.hand.length, 'no duplicate cards');
  }
}
async function ack(m, pi) { for (const id of pi.participants) await m.decide(id, 'ack'); }
async function resolveCard(m, pi) {
  if (pi.type === 'speed') {
    for (const id of pi.participants) await m.decide(id, 'ready');
    await m.wait(() => m.state().pendingInteraction.phase === 'react', 7000);
    for (const id of pi.participants) await m.decide(id, 'react');
  } else if (pi.type === 'wheel') await m.decide(pi.actorId, 'spin');
  else if (pi.type === 'impostor') {
    for (const id of pi.participants) await m.decide(id, 'clue:test');
    for (const id of pi.participants) await m.decide(id, 'vote:' + pi.participants.find(other => other !== id));
  } else for (let i = 0; i < pi.participants.length; i++) await m.decide(pi.participants[i],
    pi.type === 'rps' ? ['rock', 'scissors'][i] : pi.type === 'betrayal' ? 'share' : pi.type === 'dice' ? 'roll' : 'ack');
}
async function wheel(m) {
  const played = await m.play('wheel');
  await m.decide(played.pi.actorId, 'spin');
  return played;
}
async function impostorVotes(m, catchImpostor) {
  const played = await m.play('impostor');
  const counts = {};
  for (const client of m.clients) {
    const word = client.state.pendingInteraction.roundData.myWord;
    assert(word, 'each participant receives a private word');
    counts[word] = (counts[word] || 0) + 1;
    const view = JSON.stringify(client.state.pendingInteraction);
    for (const secret of ['impostorId', 'wordPair', 'playerWords', 'votes']) assert(!view.includes('"' + secret + '"'), secret + ' leaked');
  }
  const impostor = m.clients.find(c => counts[c.state.pendingInteraction.roundData.myWord] === 1);
  assert(impostor, 'one player must have the minority word');
  const impostorId = impostor.state.players[impostor.state.seat].id;
  for (const id of played.pi.participants) await m.decide(id, 'clue:test-' + id);
  assert.strictEqual(m.state().pendingInteraction.phase, 'vote');
  assert.deepStrictEqual(m.state().pendingInteraction.submitted, [], 'clues must not count as votes');
  const innocent = played.pi.participants.find(id => id !== impostorId);
  const target = catchImpostor ? impostorId : innocent;
  for (const id of played.pi.participants) {
    const vote = id === target ? played.pi.participants.find(other => other !== id) : target;
    await m.decide(id, 'vote:' + vote);
    if (m.state().pendingInteraction) assert(!JSON.stringify(m.state().pendingInteraction.roundData).includes('votes'), 'secret ballot values leaked');
  }
  complete(m, played.before);
  for (const player of m.state().players) {
    assert.strictEqual(player.points, catchImpostor ? player.id === impostorId ? 0 : 10000
      : player.id === impostorId ? 30000 : 0, 'Impostor scoring for ' + player.id);
  }
}

test('rps', 'rock beats scissors, loser sits out, scores unchanged, all clients advance', async m => {
  const played = await m.play('rps', m.state().players.at(-1).id);
  await m.decide(played.pi.participants[0], 'rock');
  assert(m.state().pendingInteraction, 'one secret choice must not resolve the card');
  assert(!JSON.stringify(m.state().pendingInteraction).includes('rock'), 'choice is secret');
  await m.decide(played.pi.participants[1], 'scissors');
  complete(m, played.before);
  assert(m.state().players.find(p => p.id === played.pi.participants[1]).eliminated, 'loser is eliminated');
  assert(m.state().players.every(p => p.points === 0));
});
test('rps', 'a tie repeats instead of consuming the card and ending the turn', async m => {
  const { pi } = await m.play('rps');
  for (const id of pi.participants) await m.decide(id, 'rock');
  assert(m.state().pendingInteraction && m.state().pendingInteraction.type === 'rps', 'tie ended the minigame instead of repeating');
});
test('rps', 'outsider and duplicate submissions are rejected', async m => {
  const { pi } = await m.play('rps');
  await m.rejected(m.clients.find(c => !pi.participants.includes(c.state.players[c.state.seat].id)), { type: 'interact', decision: 'paper' });
  await m.decide(pi.participants[0], 'rock');
  await m.rejected(m.byId(pi.participants[0]), { type: 'interact', decision: 'scissors' });
});

for (const [choices, expected] of [
  [['share', 'share'], [10000, 10000]], [['steal', 'share'], [20000, 0]],
  [['share', 'steal'], [0, 20000]], [['steal', 'steal'], [0, 0]]
]) test('betrayal', choices.join('/') + ' gives exactly ' + expected.join('/') + ' points', async m => {
  const played = await m.play('betrayal');
  await m.decide(played.pi.participants[0], choices[0]);
  assert(!JSON.stringify(m.state().pendingInteraction).includes('"' + choices[0] + '"'), 'choice leaked');
  await m.decide(played.pi.participants[1], choices[1]);
  complete(m, played.before);
  played.pi.participants.forEach((id, i) => assert.strictEqual(points(m, id), expected[i]));
  assert.strictEqual(points(m, played.pi.actorId), 0, 'caster receives no dilemma reward');
});
test('betrayal', 'the selected opponent is actually included in the dilemma', async m => {
  const target = m.state().players.at(-1).id;
  const { pi } = await m.play('betrayal', target);
  assert(pi.participants.includes(target), 'server ignored the selected target');
});

test('dice', 'server roll 1 versus 5 awards exactly 20,000 to the higher roller', async m => {
  const played = await m.play('dice');
  for (const id of played.pi.participants) await m.decide(id, 'roll');
  complete(m, played.before);
  assert.strictEqual(points(m, played.pi.participants[0]), 0);
  assert.strictEqual(points(m, played.pi.participants[1]), 20000);
});
test('dice', 'tied dice reroll rather than ending without a winner', async m => {
  const { pi } = await m.play('dice');
  for (const id of pi.participants) await m.decide(id, 'roll');
  assert(m.state().pendingInteraction && m.state().pendingInteraction.type === 'dice', 'tie ended Dice instead of rerolling');
}, { random: [0.4] });
test('dice', 'confirmed numeric rolls reach every client for the dice animation', async m => {
  const { pi } = await m.play('dice');
  const start = m.clients.map(c => c.frames.length);
  for (const id of pi.participants) await m.decide(id, 'roll');
  function hasRolls(value) {
    if (!value || typeof value !== 'object') return false;
    if (pi.participants.every(id => Number.isInteger(value[id]) && value[id] >= 1 && value[id] <= 6)) return true;
    return Object.values(value).some(hasRolls);
  }
    m.clients.forEach((c, i) => assert(c.frames.slice(start[i]).some(hasRolls), 'client received no authoritative roll values'));
});

test('wheel', 'one spin by the caster completes the card without hidden acknowledgments', async m => {
  const played = await m.play('wheel');
  await m.decide(played.pi.actorId, 'spin');
  complete(m, played.before);
});
test('wheel', 'non-casters cannot spin the wheel', async m => {
  const { pi } = await m.play('wheel');
  await m.rejected(m.byId(pi.participants.find(id => id !== pi.actorId)), { type: 'interact', decision: 'spin' });
});
const outcomes = ['reshuffle', 'reset_self', 'reset_others', 'eliminate_self_3', 'reverse', 'gain_10k', 'lose_20k', 'others_gain_20k', 'no_evil_permanent'];
outcomes.forEach((outcome, index) => test('wheel', outcome + ' effect through caster-only spin', async m => {
  const played = await wheel(m);
  const actorId = played.pi.actorId;
  assert.strictEqual(m.state().pendingInteraction, null);
  if (outcome === 'reshuffle') assert.strictEqual(m.state().discardCount, 0, 'reshuffle did not recycle even the played card');
  if (outcome === 'reset_self') assert.strictEqual(points(m, actorId), 0);
  if (outcome === 'reset_others') m.state().players.filter(p => p.id !== actorId).forEach(p => assert.strictEqual(p.points, 0));
  if (outcome === 'eliminate_self_3') assert(m.state().players.find(p => p.id === actorId).eliminated);
  if (outcome === 'reverse') assert.strictEqual(m.state().current, played.before.players.at(-1).id, 'actual turn order did not reverse');
  if (outcome === 'gain_10k') assert.strictEqual(points(m, actorId), 15000);
  if (outcome === 'lose_20k') assert.strictEqual(points(m, actorId), 0);
  if (outcome === 'others_gain_20k') m.state().players.filter(p => p.id !== actorId).forEach(p => assert.strictEqual(p.points, 25000));
  if (outcome === 'no_evil_permanent') {
    assert(m.state().players.find(p => p.id === actorId).noEvilPermanent);
    for (let guard = 0; m.state().current !== actorId && guard < 10; guard++) await m.play('bonus');
    const actor = m.byId(actorId);
    assert(actor.state.acting);
    assert(actor.state.moves.every(move => !Cards.isEvil(move.cardId)), 'evil moves remain legal after the permanent ban');
  }
}, { random: [(index + 0.1) / 9], points: 5000 }));

test('linkedfate', 'a normal 10,000-point gain shares exactly 5,000 with the partner', async m => {
  const played = await m.play('linkedfate');
  await ack(m, played.pi);
  complete(m, played.before);
  assert.strictEqual(m.state().current, played.pi.targetId, 'linked target takes the next fixture turn');
  await m.play('bonus');
  assert.strictEqual(points(m, played.pi.targetId), 10000);
  assert.strictEqual(points(m, played.pi.actorId), 5000);
});
test('linkedfate', 'an interactive 20,000-point dice reward also shares 10,000', async m => {
  const linked = await m.play('linkedfate'); await ack(m, linked.pi);
  const dice = await m.play('dice');
  for (const id of dice.pi.participants) await m.decide(id, 'roll');
  assert.strictEqual(points(m, linked.pi.targetId), 20000);
  assert.strictEqual(points(m, linked.pi.actorId), 10000, 'interactive prize bypassed Linked Fate');
}, { random: [0.8, 0.1] });

test('swapper', 'the actual drafted ally identities swap in every player snapshot', async m => {
  const played = await m.play('swapper');
  const before = Object.fromEntries(played.before.players.map(p => [p.id, p.ally]));
  await ack(m, played.pi); complete(m, played.before);
  for (const client of m.clients) {
    assert.strictEqual(client.state.players.find(p => p.id === played.pi.actorId).ally, before[played.pi.targetId], 'caster kept their original ally');
    assert.strictEqual(client.state.players.find(p => p.id === played.pi.targetId).ally, before[played.pi.actorId], 'target kept their original ally');
  }
});

test('impostor', 'private words, clues, secret votes and caught-impostor 10,000-point scoring', m => impostorVotes(m, true));
test('impostor', 'an escaping impostor gains exactly 30,000, nobody else scores', m => impostorVotes(m, false));
test('impostor', 'three real players cannot start a four-player-minimum card', async m => {
  const actor = require('./helpers/acting-client')(m.clients);
  if (!actor.state.moves.some(move => move.cardId === 'impostor')) return;
  await m.rejected(actor, { type: 'move', cardId: 'impostor', targetId: null });
  assert.strictEqual(m.state().pendingInteraction, null);
}, { players: 3 });
test('impostor', 'a vote is refused when it names a nonexistent participant', async m => {
  const { pi } = await m.play('impostor');
  for (const id of pi.participants) await m.decide(id, 'clue:test');
  await m.rejected(m.byId(pi.participants[0]), { type: 'interact', decision: 'vote:not-a-player' });
});
test('impostor', 'the initial clue phase refuses arbitrary non-clue decisions', async m => {
  const { pi } = await m.play('impostor');
  await m.rejected(m.byId(pi.participants[0]), { type: 'interact', decision: 'not-a-clue' });
});

test('rps', 'a tied round accepts fresh secret choices and then resolves exactly once', async m => {
  const played = await m.play('rps');
  for (const id of played.pi.participants) await m.decide(id, 'paper');
  assert.deepStrictEqual(m.state().pendingInteraction.submitted, []);
  await m.decide(played.pi.participants[0], 'paper');
  await m.decide(played.pi.participants[1], 'rock');
  complete(m, played.before);
  assert(m.state().players.find(p => p.id === played.pi.participants[1]).eliminated);
  await m.rejected(m.byId(played.pi.actorId), { type: 'interact', decision: 'paper' });
});
test('dice', 'a tied roll retries, publishes real values and pays only the later winner', async m => {
  const played = await m.play('dice');
  for (const id of played.pi.participants) await m.decide(id, 'roll');
  assert.deepStrictEqual(m.state().pendingInteraction.submitted, []);
  assert(m.state().players.every(p => p.points === 0));
  for (const id of played.pi.participants) await m.decide(id, 'roll');
  complete(m, played.before);
  assert.strictEqual(points(m, played.pi.participants[1]), 20000);
  assert.deepStrictEqual(m.state().lastInteractionResult.roundData.rolls,
    { [played.pi.participants[0]]: 1, [played.pi.participants[1]]: 5 });
}, { random: [0.4, 0.4, 0.1, 0.8] });
test('impostor', 'blank, oversized, self and duplicate submissions are rejected without advancing', async m => {
  const { pi } = await m.play('impostor');
  const voter = m.byId(pi.actorId);
  for (const decision of ['clue: ', 'clue:' + 'a'.repeat(36)]) await m.rejected(voter, { type: 'interact', decision });
  for (const id of pi.participants) await m.decide(id, 'clue:Mixed Case');
  assert.strictEqual(m.state().pendingInteraction.roundData.clues[pi.actorId], 'clue:Mixed Case');
  await m.rejected(voter, { type: 'interact', decision: 'vote:' + pi.actorId });
  await m.decide(pi.actorId, 'vote:' + pi.participants.find(id => id !== pi.actorId));
  await m.rejected(voter, { type: 'interact', decision: 'vote:' + pi.participants.find(id => id !== pi.actorId) });
});
test('linkedfate', 'a wheel prize shares once without recursive bonus gains', async m => {
  const linked = await m.play('linkedfate'); await ack(m, linked.pi);
  const played = await m.play('wheel'); await m.decide(played.pi.actorId, 'spin');
  assert.strictEqual(points(m, linked.pi.targetId), 10000);
  assert.strictEqual(points(m, linked.pi.actorId), 5000);
}, { random: [5.1 / 9] });
test('linkedfate', 'last-turn shared gains determine the real winner before standings freeze', async m => {
  const partner = m.state().players[0].id;
  await m.play('bonus');
  assert(m.state().over);
  assert.strictEqual(points(m, partner), 20000);
  assert(m.clients.every(c => c.state.winner === partner), 'standings froze before the final shared bonus');
}, { finalLinked: true });

for (const players of [2, 3, 4, 5]) {
  for (const card of ['rps', 'betrayal', 'dice', 'wheel', 'linkedfate', 'swapper', 'impostor']) {
    if ((card === 'betrayal' && players < 3) || (card === 'impostor' && players < 4)) continue;
    test(card, players + '-player interaction completes with no phantom participants', async m => {
      const played = await m.play(card);
      assert(played.pi.participants.every(id => m.state().players.some(p => p.id === id)), 'disabled seat joined interaction');
      if (card === 'impostor') {
        for (const id of played.pi.participants) await m.decide(id, 'clue:test');
        for (const id of played.pi.participants) await m.decide(id, 'vote:' + played.pi.participants.find(other => other !== id));
      } else if (card === 'wheel') await m.decide(played.pi.actorId, 'spin');
      else for (let i = 0; i < played.pi.participants.length; i++) await m.decide(played.pi.participants[i],
        card === 'rps' ? ['rock', 'scissors'][i] : card === 'betrayal' ? 'share' : card === 'dice' ? 'roll' : 'ack');
      complete(m, played.before);
      assert(m.clients.every(c => c.state.lastInteractionResult.type === card));
      assert.strictEqual(m.state().players.length, players);
    }, { players });
  }
}

for (const card of ['rps', 'betrayal', 'speed', 'dice', 'wheel', 'linkedfate', 'swapper', 'impostor']) {
  test(card, 'Steal a Turn starts real interaction for the card owner, not a simulated result', async m => {
    const stolen = await m.play('stealturn');
    const ownerId = m.state().current;
    assert(m.state().pending?.kind === 'move');
    const played = await m.play(card);
    assert(played.pi && played.pi.type === card, 'stolen card silently used the simulated local resolver');
    assert.strictEqual(played.pi.actorId, ownerId);
    assert.notStrictEqual(played.pi.actorId, stolen.before.current);
    assert.strictEqual(m.state().pending, null, 'forced choice consumed once');
    await resolveCard(m, played.pi);
    complete(m, played.before);
  });
  test(card, 'a cursed interactive card resolves first and then eliminates its owner', async m => {
    const played = await m.play(card);
    assert(!m.state().players.find(p => p.id === played.pi.actorId).eliminated, 'curse must wait for resolution');
    await resolveCard(m, played.pi);
    complete(m, played.before);
    assert(m.state().players.find(p => p.id === played.pi.actorId).eliminated, 'interactive play bypassed Curse');
    assert(m.state().lastInteractionResult.events.some(e => e.type === 'curse'));
  }, { cursedCard: card });
}

async function main() {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const item = cases[next++];
      let fixture;
      try {
        fixture = await match(item.options);
        await item.run(fixture);
        results.push({ card: item.card, name: item.name, passed: true });
        console.log('PASS [' + item.card + '] ' + item.name);
      } catch (error) {
        results.push({ card: item.card, name: item.name, passed: false, error: error.message });
        console.error('FAIL [' + item.card + '] ' + item.name + ': ' + error.message);
      } finally { if (fixture) await fixture.close(); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const passed = results.filter(result => result.passed).length;
  const report = { scope: 'Seven new cards, deterministic fixture hands/RNG, real local server and five WebSockets unless stated. No browser, full-match, timeout or reconnect claims.', passed, failed: results.length - passed, results };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
