/* Real local matches with unmodified deals, real allies and no fixed Math.random.
 * Does not prove browser UX, WAN latency, reconnection or Phoenix award usage. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const match = require('./helpers/interaction-match');
async function run(players, allyOffset) {
  const m = await match({ players, allyOffset, naturalDeal: true, random: [] });
  const cards = new Set(), allies = new Set();
  let actions = 0;
  try {
    const initialSupply = m.state().deckCount + m.state().discardCount + m.state().destroyedCount + m.state().players.reduce((n, p) => n + p.handCount, 0);
    function validate() {
      for (const client of m.clients) {
        const s = client.state;
        assert.strictEqual(new Set(s.hand).size, s.hand.length, 'hands remain unique');
        assert(s.players.every(p => Number.isFinite(p.points) && p.points >= 0));
        s.players.forEach(p => { if (p.ally) allies.add(p.ally); });
        const supply = s.deckCount + s.discardCount + s.destroyedCount + s.players.reduce((n, p) => n + p.handCount, 0);
        assert.strictEqual(supply, initialSupply, 'physical card supply is conserved');
      }
    }
    while (!m.state().over) {
      assert(++actions < 1000, 'match terminates within the action budget');
      validate();
      const pi = m.state().pendingInteraction;
      if (pi) {
        const todo = pi.participants.filter(id => !(pi.submitted || []).includes(id));
        if (pi.type === 'speed') {
          if (pi.phase === 'ready') for (const id of todo) await m.decide(id, 'ready');
          else if (pi.phase === 'countdown') await m.wait(() => m.state().pendingInteraction?.phase === 'react', 7000);
          else for (const id of todo) { if (!m.state().pendingInteraction) break; await m.decide(id, 'react'); }
        } else if (pi.type === 'wheel') await m.decide(pi.actorId, 'spin');
        else for (const id of todo) {
          const index = pi.participants.indexOf(id);
          const decision = pi.type === 'rps' ? ['rock', 'scissors'][index] : pi.type === 'dice' ? 'roll'
            : pi.type === 'betrayal' ? 'share' : pi.type === 'impostor'
              ? pi.phase === 'vote' ? 'vote:' + pi.participants.find(other => other !== id) : 'clue:natural match' : 'ack';
          await m.decide(id, decision);
        }
      } else {
        const actor = m.clients.find(c => c.state.acting);
        assert(actor && actor.state.moves.length, 'server offers an actionable move');
        const moves = actor.state.moves;
        const move = moves.find(move => !cards.has(move.cardId)) || moves[actions % moves.length];
        if (m.state().pending?.kind !== 'burn') cards.add(move.cardId);
        await m.action(actor, { type: 'move', ...move });
      }
    }
    validate();
    assert(m.clients.every(c => c.state.over && c.state.winner === m.state().winner));
    const winner = m.state().players.find(p => p.id === m.state().winner);
    assert(winner && winner.points === Math.max(...m.state().players.map(p => p.points)), 'winner must have the highest final score');
    assert(!m.output().includes('interaction resolution failed'));
    console.log('PASS ' + players + '-player natural-deal match, ' + actions + ' actions, ' + cards.size + ' card types');
    return { players, passed: true, actions, cards: [...cards], allies: [...allies] };
  } finally { await m.close(); }
}
(async () => {
  const results = [];
  for (const players of [2, 3, 4, 5]) {
    try { results.push(await run(players, players - 2)); }
    catch (error) { console.error('FAIL ' + players + '-player natural match: ' + error.message); results.push({ players, passed: false, error: error.message }); }
  }
  const report = { scope: 'Four real local 20-round matches, natural deals, real allies, no controlled RNG; all eight cards enabled only in disposable child processes. No all-22 coverage or browser/reconnect claims.', passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
