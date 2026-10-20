/* Disposable real-server match harness. Fresh snapshots are tracked by revision,
 * never by a queue search that can accidentally accept an old/missing message. */
'use strict';
const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

module.exports = async function interactionMatch(options = {}) {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['tests/interactive-local-server.js', 'all', String(port)], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PHOENIX_REPRO_RANDOM: (options.random || [0.1, 0.8]).join(','),
      PHOENIX_REPRO_POINTS: String(options.points || 0),
      PHOENIX_REPRO_CURSED_CARD: options.cursedCard || '',
      PHOENIX_REPRO_FINAL_LINK: options.finalLinked ? '1' : '',
      PHOENIX_REPRO_NATURAL_DEAL: options.naturalDeal ? '1' : '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const clients = [];
  let output = '';
  async function close() {
    clients.forEach(client => client.ws.terminate());
    if (server.exitCode !== null) return;
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timeout: ' + output)), 10000);
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('PHOENIX multiplayer server:')) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', data => { output += data; });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error('Fixture exited: ' + code)); });
    });
    function wait(predicate, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
          try {
            if (predicate()) { clearInterval(timer); resolve(); }
            else if (Date.now() > deadline) {
              clearInterval(timer);
              reject(new Error('Fresh snapshot condition timed out; errors=' + clients.flatMap(c => c.errors.map(e => e.message)).join(',')));
            }
          } catch (error) { clearInterval(timer); reject(error); }
        }, 5);
      });
    }
    async function connect() {
      const ws = new WebSocket('ws://127.0.0.1:' + port);
      const client = { ws, state: null, revision: 0, errors: [], frames: [] };
      clients.push(client);
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        client.frames.push(msg);
        if (msg.type === 'state') { client.state = msg; client.revision++; }
        if (msg.type === 'error') client.errors.push(msg);
      });
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      return client;
    }
    async function action(client, data) {
      const before = clients.map(c => c.revision);
      const errors = client.errors.length;
      client.ws.send(JSON.stringify(data));
      await wait(() => {
        if (client.errors.length > errors) throw new Error(client.errors.at(-1).message);
        return clients.every((c, i) => c.revision > before[i]);
      });
    }
    async function rejected(client, data) {
      const before = client.errors.length;
      const revision = client.revision;
      client.ws.send(JSON.stringify(data));
      await wait(() => client.errors.length > before || client.revision > revision, 500);
      assert(client.errors.length > before, 'invalid action was accepted and broadcast instead of rejected: ' + JSON.stringify(data));
      return client.errors.at(-1);
    }
    const host = await connect();
    await action(host, { type: 'create', name: 'Fixture host', code: '', hardcore: !!options.hardcore });
    for (let i = 1; i < (options.players || 5); i++) {
      const guest = await connect();
      await action(guest, { type: 'join', name: 'Fixture ' + i, code: host.state.code });
    }
    await action(host, { type: 'start', rounds: 20 });
    let guard = 0;
    while (['turnDice', 'allyDice'].includes(host.state.phase)) {
      assert(++guard < 150, 'dice phases terminate');
      await action(clients[host.state.dice.next], { type: 'roll' });
    }
    while (host.state.phase === 'draft') {
      const choices = host.state.availableAllies;
      await action(clients[host.state.draftTurn], { type: 'chooseAlly', ally: choices[(options.allyOffset || 0) % choices.length] });
    }
    function byId(id) { return clients.find(c => c.state.players[c.state.seat].id === id); }
    async function play(cardId, targetId) {
      const actor = clients.find(c => c.state.acting);
      assert(actor, 'an actor exists');
      const move = actor.state.moves.find(m => m.cardId === cardId && (targetId === undefined || m.targetId === targetId));
      assert(move, cardId + ' is a legal fixture move');
      const before = host.state;
      await action(actor, { type: 'move', ...move });
      return { actor, before, pi: host.state.pendingInteraction };
    }
    async function decide(id, decision) { await action(byId(id), { type: 'interact', decision }); }
    return { host, clients, port, action, rejected, wait, byId, play, decide, close,
      state: () => host.state, output: () => output };
  } catch (error) { await close(); throw error; }
};
