/* Real server + three WebSocket clients, with temporary random credentials. */
'use strict';
const assert = require('assert');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const Effects = require('../js/effects');

async function main() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const password = crypto.randomBytes(24).toString('hex');
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), PHOENIX_OWNER_PASSWORD: password,
      PHOENIX_MODE_ACCESS_CODE: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const clients = [];
  let passed = 0;
  function check(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
  function next(client, type) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.ws.off('message', handler); reject(new Error('Timed out waiting for ' + type)); }, 5000);
      function handler(raw) {
        const message = JSON.parse(raw.toString());
        if (message.type !== type && message.type !== 'error') return;
        clearTimeout(timer); client.ws.off('message', handler);
        if (message.type === 'error' && type !== 'error') reject(new Error(message.message));
        else resolve(message);
      }
      client.ws.on('message', handler);
    });
  }
  async function connect() {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const client = { ws, state: null, cursor: Effects.cursor(), endings: Effects.endCursor(), results: [], animations: [] };
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'state') {
        client.state = message;
        client.animations.push(...client.cursor.consume(message.effects));
        const result = client.endings.consume(message); if (result) client.results.push(result);
      }
    });
    clients.push(client);
    return client;
  }
  async function action(client, data) {
    const waits = clients.map(c => next(c, 'state'));
    client.ws.send(JSON.stringify(data));
    return Promise.all(waits);
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
      let output = '';
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('PHOENIX multiplayer server:')) { clearTimeout(timer); resolve(); }
      });
      server.once('error', reject);
      server.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
    });
    console.log('\nLive multiplayer effects');
    const host = await connect();
    await action(host, { type: 'create', name: 'Host', visibility: 'public' });
    const code = host.state.code;
    const guest = await connect(); await action(guest, { type: 'join', name: 'Guest', code });
    const third = await connect(); await action(third, { type: 'join', name: 'Third', code });
    check('lobby baseline has no speculative animations', () => clients.forEach(c => assert.strictEqual(c.animations.length, 0)));
    await action(host, { type: 'start', rounds: 5 });
    let guard = 0;
    while (host.state.phase === 'turnDice' || host.state.phase === 'allyDice') {
      assert(guard++ < 150, 'dice must complete');
      await action(clients[host.state.dice.next], { type: 'roll' });
    }
    const allies = ['ted', 'phoenix', 'elsie'];
    while (host.state.phase === 'draft') {
      await action(clients[host.state.draftTurn], { type: 'chooseAlly', ally: allies.shift() });
    }
    check('dice and draft complete without altered gameplay', () => assert.strictEqual(host.state.phase, 'playing'));
    const before = host.state.effects.sequence;
    const acting = clients.find(c => c.state.acting);
    const rejection = next(acting, 'error');
    acting.ws.send(JSON.stringify({ type: 'move', cardId: 'not-a-card', targetId: null }));
    await rejection;
    check('illegal moves emit no public cinematic', () => assert.strictEqual(host.state.effects.sequence, before));
    let moves = 0;
    while (!host.state.over && moves++ < 150) {
      const actor = clients.find(c => c.state.acting);
      assert(actor && actor.state.moves.length, 'an authoritative legal move is available');
      // The server now filters a pending action against the correct player:
      // burn choices are exempt; stolen moves use the target's restriction.
      const move = actor.state.moves.find(option => !(actor.state.mapleBlocked || []).includes(option.cardId));
      assert(move, 'a Maple-permitted authoritative option is available');
      await action(actor, { type: 'move', cardId: move.cardId, targetId: move.targetId });
      for (const c of clients) {
        assert.deepStrictEqual(c.state.effects, host.state.effects, 'all players receive the same public journal');
        for (const event of c.state.effects.events) {
          assert.deepStrictEqual(Object.keys(event).sort(), ['actor', 'id', 'key', 'outcome', 'target']);
          assert(Effects.DEFINITIONS[event.key]);
        }
      }
    }
    check('complete three-player match remains playable', () => assert(host.state.over));
    check('public event channel contains only whitelisted presentation data', () => assert(host.state.effects.sequence > 0));
    check('all players observe identical authoritative animations', () => {
      clients.forEach(c => assert.deepStrictEqual(c.animations, host.animations));
    });
    check('repeated snapshots and reconnect baselines do not replay effects', () => {
      assert.strictEqual(host.cursor.consume(host.state.effects).length, 0);
      assert.strictEqual(Effects.cursor().consume(host.state.effects).length, 0);
    });
    check('only the authoritative winner celebrates; other seats get defeat or a confirmed draw', () => {
      clients.forEach(c => assert.deepStrictEqual(c.results, [Effects.matchResult(c.state)]));
      assert.strictEqual(clients.filter(c => c.results[0] === 'victory').length, host.state.winner === null ? 0 : 1);
    });
    check('finished repeats and reconnect baselines never replay a victory fanfare', () => {
      clients.forEach(c => {
        assert.strictEqual(c.endings.consume(c.state), null);
        assert.strictEqual(Effects.endCursor().consume(c.state), null);
        c.endings.reset(); assert.strictEqual(c.endings.consume(c.state), null);
      });
    });
    console.log('ALL ' + passed + ' LIVE MULTIPLAYER TESTS PASSED (' + moves + ' actions)');
  } finally {
    clients.forEach(c => c.ws.terminate());
    server.kill();
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
