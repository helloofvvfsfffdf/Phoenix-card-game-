/* Real five-client regression check for the observed Speed failure.
 * No live deployment, accounts or database are involved. Uses fixture hands,
 * so this checks interaction flow rather than a complete match or deck. */
'use strict';
const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

async function main() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['tests/interactive-local-server.js', 'speed', String(port)], {
    cwd: path.join(__dirname, '..'), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const clients = [];
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 10000);
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('PHOENIX multiplayer server:')) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', data => { output += data; });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
    });
    function wait(predicate) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const timer = setInterval(() => {
          const error = clients.flatMap(c => c.errors)[0];
          if (error || Date.now() > deadline) {
            clearInterval(timer); reject(new Error(error || 'Snapshot predicate timed out'));
          } else if (predicate()) { clearInterval(timer); resolve(); }
        }, 10);
      });
    }
    async function connect() {
      const ws = new WebSocket('ws://127.0.0.1:' + port);
      const client = { ws, state: null, revision: 0, errors: [], history: [] };
      clients.push(client);
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'state') {
          client.state = msg; client.revision++;
          client.history.push(msg.pendingInteraction ? msg.pendingInteraction.phase : msg.phase);
        }
        if (msg.type === 'error') client.errors.push(msg.message);
      });
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      return client;
    }
    async function action(client, data) {
      const before = clients.map(c => c.revision);
      client.ws.send(JSON.stringify(data));
      await wait(() => clients.every((c, i) => c.revision > before[i]));
    }
    const host = await connect();
    await action(host, { type: 'create', name: 'Repro host', code: '' });
    for (let i = 1; i < 5; i++) {
      const guest = await connect();
      await action(guest, { type: 'join', name: 'Repro ' + i, code: host.state.code });
    }
    await action(host, { type: 'start', rounds: 5 });
    let guard = 0;
    while (['turnDice', 'allyDice'].includes(host.state.phase)) {
      assert(++guard < 100, 'dice must terminate');
      await action(clients[host.state.dice.next], { type: 'roll' });
    }
    while (host.state.phase === 'draft') {
      await action(clients[host.state.draftTurn], { type: 'chooseAlly', ally: host.state.availableAllies[0] });
    }
    const actor = require('./helpers/acting-client')(clients);
    const move = actor.state.moves.find(m => m.cardId === 'speed');
    assert(move, 'fixture must offer Speed');
    await action(actor, { type: 'move', ...move });
    const pi = host.state.pendingInteraction;
    console.log('Initial Speed phase:', pi.phase);
    for (const id of pi.participants) {
      const client = clients.find(c => c.state.players[c.state.seat].id === id);
      await action(client, { type: 'interact', decision: 'ready' });
    }
    console.log('Phase after Ready:', host.state.pendingInteraction && host.state.pendingInteraction.phase);
    console.log('Scores without a reaction:', host.state.players.map(p => p.points));
    console.log('Latest log:', host.state.log.slice(-2));
    assert(host.state.pendingInteraction, 'Speed resolved after Ready without any reaction');
    assert.strictEqual(host.state.pendingInteraction.phase, 'countdown');
    assert(host.state.players.every(p => p.points === 0), 'Ready must not award points');
    console.log('PASS: readiness starts a countdown without fabricating a reaction.');
    assert(!('goTime' in host.state.pendingInteraction.roundData), 'random GO deadline stays private');
    await wait(() => clients.every(c => c.state.pendingInteraction && c.state.pendingInteraction.phase === 'react'));
    const reactors = pi.participants.map(id => clients.find(c => c.state.players[c.state.seat].id === id));
    await new Promise(resolve => setTimeout(resolve, 80));
    await action(reactors[0], { type: 'interact', decision: 'react' });
    assert(host.state.pendingInteraction, 'one reaction cannot end the challenge');
    await new Promise(resolve => setTimeout(resolve, 120));
    await action(reactors[1], { type: 'interact', decision: 'react' });
    assert.strictEqual(host.state.pendingInteraction, null);
    assert.strictEqual(host.state.players.find(p => p.id === pi.participants[0]).points, 15000);
    assert.strictEqual(host.state.players.reduce((sum, p) => sum + p.points, 0), 15000);
    console.log('PASS: server GO, two real presses, one 15,000-point award and turn advancement.');

    const nextActor = require('./helpers/acting-client')(clients);
    const nextMove = nextActor.state.moves.find(m => m.cardId === 'speed');
    await action(nextActor, { type: 'move', ...nextMove });
    const nextPi = host.state.pendingInteraction;
    const nextReactors = nextPi.participants.map(id => clients.find(c => c.state.players[c.state.seat].id === id));
    for (const client of nextReactors) await action(client, { type: 'interact', decision: 'ready' });
    for (const client of nextReactors) await action(client, { type: 'interact', decision: 'false_start' });
    assert.strictEqual(host.state.pendingInteraction, null);
    assert.strictEqual(host.state.players.reduce((sum, p) => sum + p.points, 0), 15000);
    console.log('PASS: two false starts award no points and do not leave a pending interaction.');
  } finally {
    clients.forEach(c => c.ws.terminate());
    server.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
