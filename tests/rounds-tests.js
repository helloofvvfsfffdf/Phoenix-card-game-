/* PHOENIX — the host's round count.
 *
 * The host picks how many rounds the match runs for. The number they pick must
 * reach the server, and the server must hold it to 5..100 whatever was asked
 * for - because a match that silently runs for a different length than the one
 * the host announced is a broken promise, not a rounding error.
 *
 * A real local server, real WebSockets, no browser and no mock: the whole point
 * is that the number survives the trip from the host's screen to the table.
 */
'use strict';

const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('PASS ' + name); })
    .catch(err => { failed++; console.error('FAIL ' + name + ': ' + err.message); });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || 'values differ') + ': expected ' + expected + ', got ' + actual);
  }
}

/** A running local server with an open lobby, and a way to play a match out. */
async function startServer() {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));

  const stateFile = path.join(os.tmpdir(), 'phoenix-rounds-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(stateFile, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));

  const server = spawn(process.execPath, ['tests/helpers/plain-server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PHOENIX_OWNER_PASSWORD: crypto.randomBytes(24).toString('hex'),
      PHOENIX_MODE_ACCESS_CODE: 'unused-access-code-1234567890',
      PHOENIX_STATE_FILE: stateFile,
      PHOENIX_BIND_HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(Error('server startup timeout')), 10000);
    server.stdout.on('data', d => {
      out += d;
      if (out.includes('PHOENIX multiplayer server:')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', d => { out += d; });
  });

  const states = new Map();
  const sockets = [];
  const make = () => {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'state') states.set(ws, m); });
    sockets.push(ws);
    return ws;
  };

  return {
    port,
    server,
    states,
    make,
    async open(ws) { await new Promise(r => ws.once('open', r)); },
    close() {
      sockets.forEach(ws => { try { ws.close(); } catch (e) { /* going away */ } });
      server.kill();
      try { fs.unlinkSync(stateFile); } catch (e) { /* already gone */ }
    }
  };
}

/** Creates a lobby, joins it with a second player, and starts the match. */
async function playToStart(states, host, guest, rounds) {
  host.send(JSON.stringify({ type: 'create', code: '' }));
  await wait(250);
  const code = states.get(host).code;
  guest.send(JSON.stringify({ type: 'join', code }));
  await wait(250);
  host.send(JSON.stringify({ type: 'start', rounds: rounds }));
  await wait(250);
}

/** Rolls the dice and drafts allies, so the match actually begins. */
async function playOutSetup(states, host, guest) {
  const bySeat = () => {
    const map = {};
    [host, guest].forEach(ws => { const s = states.get(ws); if (s) map[s.seat] = ws; });
    return map;
  };
  const allies = ['phoenix', 'tilly', 'louie', 'simba', 'elsie'];
  for (let i = 0; i < 30; i++) {
    const s = states.get(host);
    if (!s) break;
    if (s.phase === 'turnDice' || s.phase === 'allyDice') {
      const ws = bySeat()[s.dice.next];
      if (!ws) break;
      ws.send(JSON.stringify({ type: 'roll' }));
      await wait(120);
    } else if (s.phase === 'draft') {
      const ws = bySeat()[s.draftTurn];
      if (!ws) break;
      ws.send(JSON.stringify({ type: 'chooseAlly', ally: allies.shift() }));
      await wait(120);
    } else break;
  }
  await wait(300);
}

async function main() {
  // 1) A custom round count reaches the table.
  await test('the host\'s chosen round count is the round count the match runs for', async () => {
    const s = await startServer();
    try {
      const host = s.make();
      const guest = s.make();
      await s.open(host); await s.open(guest);
      await playToStart(s.states, host, guest, 25);
      await playOutSetup(s.states, host, guest);
      const state = s.states.get(host);
      equal(state.phase, 'playing', 'the match started');
      equal(state.rounds, 25, 'the match runs for the rounds the host asked for');
    } finally { s.close(); }
  });

  // 2) The server holds the count to 5..100.
  await test('the server clamps the round count to 5..100', async () => {
    const s = await startServer();
    try {
      const host = s.make();
      const guest = s.make();
      await s.open(host); await s.open(guest);

      // Below the floor.
      await playToStart(s.states, host, guest, 3);
      await playOutSetup(s.states, host, guest);
      equal(s.states.get(host).rounds, 5, 'three rounds is raised to the minimum of five');
    } finally { s.close(); }
  });

  await test('the server clamps the round count to the ceiling of 100', async () => {
    const s = await startServer();
    try {
      const host = s.make();
      const guest = s.make();
      await s.open(host); await s.open(guest);
      await playToStart(s.states, host, guest, 250);
      await playOutSetup(s.states, host, guest);
      equal(s.states.get(host).rounds, 100, 'two hundred and fifty rounds is cut to one hundred');
    } finally { s.close(); }
  });

  await test('exactly one hundred rounds is honoured', async () => {
    const s = await startServer();
    try {
      const host = s.make();
      const guest = s.make();
      await s.open(host); await s.open(guest);
      await playToStart(s.states, host, guest, 100);
      await playOutSetup(s.states, host, guest);
      equal(s.states.get(host).rounds, 100, 'one hundred rounds is exactly the ceiling, and is kept');
    } finally { s.close(); }
  });

  // 3) The client reads the custom box, not the select.
  await test('the browser reads the custom box only when Custom is chosen', async () => {
    const fsx = require('fs');
    const source = fsx.readFileSync(path.join(__dirname, '../js/online-client.js'), 'utf8');
    // The two controls are read separately: a select holding the word "custom"
    // is not a number, and treating it as one is what made every custom match
    // quietly become a ten-round match.
    assert(source.indexOf("select.value === 'custom'") !== -1,
      'the client branches on the literal "custom" value rather than on NaN');
    assert(source.indexOf('parseInt(custom.value, 10)') !== -1,
      'the custom box is read as an integer');
    assert(source.indexOf('Math.min(100, Math.max(5, rounds))') !== -1,
      'the client applies the same 5..100 bounds the server does');
  });

  // 4) The markup gives the number box its own label, so it is not swallowed.
  await test('the custom number box is not nested inside the select\'s label', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const row = html.match(/<span class="online-rounds-row">[\s\S]*?<\/span>/);
    assert(row, 'the rounds control exists');
    assert(row[0].indexOf('<label for="online-rounds">') !== -1,
      'the label points at the select explicitly');
    assert(row[0].indexOf('id="online-rounds-custom"') !== -1,
      'the custom number box is present');
    // A <label> implicitly targets its first labelable descendant, so a number
    // box inside the select's label never received the typed value.
    assert(!/<label[^>]*>(?:(?!<\/label>).)*<input[^>]*id="online-rounds-custom"/.test(html),
      'the number box is not inside the select\'s label');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error(err); process.exit(1); });
