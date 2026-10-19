/* Real sockets, isolated local servers, no production accounts or state.
 * Delays used below are actual elapsed time, not shortened server timers. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const WebSocket = require('ws');
const match = require('./helpers/interaction-match');
const cases = [];
function test(name, run) { cases.push({ name, run }); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function drop(m, client) {
  const id = client.state.players[client.state.seat].id;
  const closed = new Promise(resolve => client.ws.once('close', resolve));
  client.ws.terminate();
  await closed;
  await m.wait(() => m.clients.filter(c => c.ws.readyState === WebSocket.OPEN).every(c =>
    c.state.paused && !c.state.players.find(p => p.id === id).connected));
}
async function reconnect(m, client, options) {
  const saved = { code: client.state.code, token: client.state.resumeToken };
  const socket = new WebSocket('ws://127.0.0.1:' + m.port, options);
  client.ws = socket;
  socket.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    client.frames.push(msg);
    if (msg.type === 'state') { client.state = msg; client.revision++; }
    if (msg.type === 'error') client.errors.push(msg);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const live = m.clients.filter(c => c.ws.readyState === WebSocket.OPEN);
  const marks = live.map(c => c.revision), errors = client.errors.length;
  socket.send(JSON.stringify({ type: 'resume', ...saved }));
  await m.wait(() => {
    if (client.errors.length > errors) throw new Error(client.errors.at(-1).message);
    return live.every((c, i) => c.revision > marks[i]);
  });
  assert.notStrictEqual(client.state.resumeToken, saved.token, 'resume rotates the bearer token');
  return saved;
}
async function outsider(m, request) {
  const ws = new WebSocket('ws://127.0.0.1:' + m.port);
  const frames = [];
  ws.on('message', raw => frames.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  try {
    ws.send(JSON.stringify(request));
    await m.wait(() => frames.some(f => f.type === 'error'));
    assert(!frames.some(f => f.type === 'state'), 'a rejected resume must not disclose a room snapshot');
    return frames.find(f => f.type === 'error');
  } finally { ws.terminate(); }
}
async function finish(m) {
  let pi = m.state().pendingInteraction;
  if (pi.type === 'speed') {
    for (const id of pi.participants) await m.decide(id, 'ready');
    await m.wait(() => m.state().pendingInteraction?.phase === 'react', 7000);
    await sleep(150); await m.decide(pi.participants[0], 'react');
    await sleep(150); await m.decide(pi.participants[1], 'react');
    return;
  }
  if (pi.type === 'wheel') { await m.decide(pi.actorId, 'spin'); return; }
  for (const id of pi.participants.filter(id => !pi.submitted.includes(id))) {
    const choice = pi.type === 'rps' ? (id === pi.participants[0] ? 'rock' : 'scissors')
      : pi.type === 'betrayal' ? 'share' : pi.type === 'dice' ? 'roll'
      : pi.type === 'impostor' ? 'clue:resume' : 'ack';
    await m.decide(id, choice);
  }
  if (pi.type === 'impostor') {
    pi = m.state().pendingInteraction;
    for (const id of pi.participants.filter(id => !pi.submitted.includes(id))) {
      await m.decide(id, 'vote:' + pi.participants.find(other => other !== id));
    }
  }
}

for (const card of ['rps', 'betrayal', 'dice', 'wheel', 'linkedfate', 'swapper', 'impostor', 'speed']) {
  test(card + ': disconnect pauses, resume restores the right seat and decisions, then completes once', async m => {
    const played = await m.play(card), pi = played.pi;
    const client = m.byId(pi.participants.at(-1));
    const before = client.state;
    if (!['speed', 'wheel'].includes(card)) {
      const id = pi.participants[0];
      await m.decide(id, card === 'rps' ? 'rock' : card === 'betrayal' ? 'share' : card === 'dice' ? 'roll' : card === 'impostor' ? 'clue:original' : 'ack');
    }
    await drop(m, client);
    const observer = m.clients.find(c => c.ws.readyState === WebSocket.OPEN);
    await m.rejected(observer, { type: 'move', cardId: 'bonus', targetId: null });
    const saved = await reconnect(m, client);
    assert(m.clients.every(c => !c.state.paused));
    assert.strictEqual(client.state.seat, before.seat);
    assert.deepStrictEqual(client.state.hand, before.hand);
    if (card === 'impostor') assert.strictEqual(client.state.pendingInteraction.roundData.myWord, before.pendingInteraction.roundData.myWord);
    if (!['speed', 'wheel'].includes(card)) assert(m.state().pendingInteraction.submitted.includes(pi.participants[0]));
    const rejected = await outsider(m, { type: 'resume', ...saved });
    assert.strictEqual(rejected.code, 'resume-invalid', 'old rotated token cannot be replayed');
    await finish(m);
    assert(m.clients.every(c => !c.state.pendingInteraction && !c.state.paused));
    assert(!m.output().includes('interaction resolution failed'));
  });
}
test('forged, missing and live-seat tokens are rejected without exposing another player’s secret', async m => {
  const tokens = m.clients.map(c => c.state.resumeToken);
  assert.strictEqual(new Set(tokens).size, 5);
  for (let i = 0; i < m.clients.length; i++) {
    for (const token of tokens.filter((_, j) => j !== i)) assert(!JSON.stringify(m.clients[i].state).includes(token));
  }
  for (const token of ['', 'f'.repeat(64), 'x'.repeat(1000)]) {
    assert.strictEqual((await outsider(m, { type: 'resume', code: m.state().code, token })).code, 'resume-invalid');
  }
  assert.strictEqual((await outsider(m, { type: 'resume', code: m.state().code, token: tokens[0] })).code, 'resume-busy');
});
test('all five disconnected seats can return; the room stays paused until the last returns', async m => {
  const played = await m.play('dice');
  for (const client of m.clients) await drop(m, client);
  for (let i = 0; i < m.clients.length; i++) {
    await reconnect(m, m.clients[i]);
    assert.strictEqual(m.clients[i].state.paused, i !== m.clients.length - 1);
  }
  await finish(m);
  assert.strictEqual(m.state().pendingInteraction, null);
  assert.notStrictEqual(m.state().current, played.before.current);
});
test('a foreground ping returns fresh state without errors or score/turn changes', async m => {
  const client = m.clients[0], previous = client.state, mark = client.revision;
  client.ws.send(JSON.stringify({ type: 'ping' }));
  await m.wait(() => client.revision > mark);
  assert.strictEqual(client.state.current, previous.current);
  assert.deepStrictEqual(client.state.players, previous.players);
  assert.strictEqual(client.errors.length, 0);
});
test('a stolen-turn chooser reconnects with the same pending choice and may finish it', async m => {
  await m.play('stealturn');
  const pending = m.state().pending;
  assert(pending && pending.kind === 'move');
  const chooser = m.byId(pending.chooserId);
  await drop(m, chooser);
  await reconnect(m, chooser);
  assert.deepStrictEqual(chooser.state.pending, pending);
  assert(chooser.state.acting);
  const move = chooser.state.moves.find(move => move.cardId === 'bonus');
  assert(move, 'a legitimate pending option must remain available');
  await m.action(chooser, { type: 'move', ...move });
  assert(!m.state().pending);
  assert(!m.state().paused);
});
test('Impostor resumes a partially submitted secret ballot without revealing or erasing votes', async m => {
  const played = await m.play('impostor');
  for (const id of played.pi.participants) await m.decide(id, 'clue:kept');
  const voter = played.pi.participants[0], target = played.pi.participants[1];
  await m.decide(voter, 'vote:' + target);
  const before = m.state().pendingInteraction.deadlineAt;
  const client = m.byId(voter);
  await drop(m, client);
  await new Promise(resolve => setTimeout(resolve, 150));
  await reconnect(m, client);
  assert(m.clients.every(c => c.state.pendingInteraction.phase === 'vote'));
  assert(m.state().pendingInteraction.submitted.includes(voter));
  assert(m.state().pendingInteraction.deadlineAt >= before + 100);
  for (const c of m.clients) {
    assert(!('votes' in c.state.pendingInteraction.roundData));
    assert(!('playerWords' in c.state.pendingInteraction.roundData));
    assert(!('impostorId' in c.state.pendingInteraction.roundData));
  }
  for (const id of played.pi.participants.filter(id => id !== voter)) await m.decide(id, 'vote:' + (id === target ? voter : target));
  assert(!m.state().pendingInteraction);
});
test('RPS deadline freezes beyond its original expiry and is rearmed for the remaining real time', async m => {
  const played = await m.play('rps');
  await m.decide(played.pi.participants[0], 'rock');
  await sleep(25000);
  const client = m.byId(played.pi.participants[1]);
  await drop(m, client);
  await sleep(7000);
  const observer = m.clients.find(c => c.ws.readyState === WebSocket.OPEN);
  assert(observer.state.pendingInteraction && observer.state.paused);
  assert(observer.state.players.every(p => p.points === 0));
  const resumedAt = Date.now();
  await reconnect(m, client);
  await m.wait(() => m.clients.every(c => !c.state.pendingInteraction), 7000);
  assert(Date.now() - resumedAt >= 3500, 'remaining time was not preserved');
});
test('Speed interrupted during countdown restarts readiness and cannot emit the old GO', async m => {
  const played = await m.play('speed');
  for (const id of played.pi.participants) await m.decide(id, 'ready');
  assert.strictEqual(m.state().pendingInteraction.phase, 'countdown');
  const client = m.byId(played.pi.participants[1]);
  await drop(m, client);
  await sleep(6500);
  const observer = m.clients.find(c => c.ws.readyState === WebSocket.OPEN);
  assert.strictEqual(observer.state.pendingInteraction.phase, 'ready');
  assert(observer.state.players.every(p => p.points === 0));
  await reconnect(m, client);
  assert.deepStrictEqual(m.state().pendingInteraction.submitted, []);
  await finish(m);
  assert.strictEqual(m.state().players.reduce((sum, p) => sum + p.points, 0), 15000);
});
test('silent socket loss is detected by the real heartbeat and pauses the match', async m => {
  const client = m.clients[1];
  await drop(m, client);
  await reconnect(m, client, { autoPong: false });
  await m.wait(() => m.clients[0].state.paused, 22000);
  assert(!m.clients[0].state.players[client.state.seat].connected);
  await reconnect(m, client);
  assert(m.clients.every(c => !c.state.paused));
});

(async () => {
  let next = 0;
  const results = [];
  async function worker() {
    while (next < cases.length) {
      const item = cases[next++]; let m;
      try { m = await match(); await item.run(m); results.push({ name: item.name, passed: true }); console.log('PASS ' + item.name); }
      catch (error) { results.push({ name: item.name, passed: false, error: error.message }); console.error('FAIL ' + item.name + ': ' + error.message); }
      finally { if (m) await m.close(); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const report = { scope: 'Real local server reconnection, secret-token/seat rules, heartbeat, interaction pause/rearm and elapsed timers. Not real WAN/mobile or authenticated-account proof.', passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
