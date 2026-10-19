/* Actual elapsed server timeouts, not shortened/fake timers. Checks recovery
 * only: clearing a timeout does NOT verify the minigame's scoring or visuals. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const match = require('./helpers/interaction-match');
const cases = ['rps', 'betrayal', 'dice', 'wheel', 'linkedfate', 'swapper', 'impostor'].map(card => ({ card, mode: 'idle' })).concat([
  { card: 'rps', mode: 'tie', random: [0.4] },
  { card: 'dice', mode: 'tie', random: [0.4] },
  { card: 'impostor', mode: 'partial ballot' }
]);

async function main() {
  const results = await Promise.all(cases.map(async ({ card, mode, random }) => {
    let fixture;
    try {
      fixture = await match({ random });
      const played = await fixture.play(card);
      assert(played.pi, 'pending interaction was created');
      let impostorId;
      if (mode === 'tie') {
        for (const id of played.pi.participants) await fixture.decide(id, card === 'rps' ? 'paper' : 'roll');
        assert(fixture.state().pendingInteraction, 'tie must wait for a retry');
      }
      if (mode === 'partial ballot') {
        const counts = {};
        fixture.clients.forEach(c => { const word = c.state.pendingInteraction.roundData.myWord; counts[word] = (counts[word] || 0) + 1; });
        const impostor = fixture.clients.find(c => counts[c.state.pendingInteraction.roundData.myWord] === 1);
        impostorId = impostor.state.players[impostor.state.seat].id;
        for (const id of played.pi.participants) await fixture.decide(id, 'clue:test');
        await fixture.decide(played.pi.participants.find(id => id !== impostorId), 'vote:' + impostorId);
      }
      const expected = card === 'impostor' ? (mode === 'idle' ? 120000 : 60000) : card === 'wheel' ? 60000 : 30000;
      assert.strictEqual(played.pi.timeoutMs, card === 'impostor' ? 60000 : expected);
      console.log('WAIT [' + card + '/' + mode + '] real ' + expected / 1000 + '-second timeout');
      if (card === 'impostor' && mode === 'idle') {
        await fixture.wait(() => fixture.clients.every(c => c.state.pendingInteraction?.phase === 'vote'), 65000);
        assert(Date.now() - played.pi.createdAt >= 59900, 'clue phase ended before its real deadline');
        assert(fixture.state().pendingInteraction.deadlineAt >= Date.now() + 55000, 'voting did not get a fresh deadline');
        assert.strictEqual(Object.keys(fixture.state().pendingInteraction.roundData.clues).length, played.pi.participants.length);
        assert(fixture.state().players.every(p => p.points === 0), 'missing clues fabricated a prize');
      }
      await fixture.wait(() => fixture.clients.every(c => c.state.pendingInteraction === null), expected + 6000);
      const elapsedMs = Date.now() - played.pi.createdAt;
      assert(elapsedMs >= expected - 100, 'test did not observe the actual server timer');
      assert.notStrictEqual(fixture.state().current, played.before.current, 'timeout must advance the turn');
      assert(!fixture.output().includes('interaction resolution failed'), 'timeout hid a resolver exception');
      assert(fixture.clients.every(c => c.errors.length === 0));
      if (mode === 'tie' || (card === 'impostor' && mode === 'idle')) {
        assert(fixture.state().players.every(p => p.points === 0), 'an unfinished round must not fabricate a prize');
      }
      if (mode === 'partial ballot') {
        assert(fixture.state().players.every(p => p.points === (p.id === impostorId ? 0 : 10000)), 'valid partial ballots must count at the deadline');
      }
      console.log('PASS [' + card + '/' + mode + '] recovery after ' + elapsedMs + 'ms');
      return { card, mode, passed: true, elapsedMs, timeoutMs: expected };
    } catch (error) {
      console.error('FAIL [' + card + '] idle recovery: ' + error.message);
      return { card, mode, passed: false, error: error.message };
    } finally { if (fixture) await fixture.close(); }
  }));
  const report = { scope: 'Real elapsed local server deadlines: seven idle, two tied retries and one partial Impostor ballot; five WebSockets. Limited tie/Impostor timeout scoring assertions. Not visual/disconnect/reconnect verification.', passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
