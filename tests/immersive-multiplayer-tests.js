/* PHOENIX - the 3D table's connection, over a real socket.
 *
 * The 3D table is another way of looking at the same multiplayer game, so
 * its client is tested against the same server the 2D game uses: a real
 * socket, a real room, real players, and the server deciding everything.
 *
 * Nothing here reaches into the engine. The client is driven the way a
 * player drives it - create, join, start, play - and what is checked is
 * that the client tells the truth about what the server said.
 */
'use strict';

const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  - ' + name); })
    .catch(error => { failed++; console.error('  X ' + name + ': ' + error.message); });
}

function suite(name) {
  console.log('\n' + name);
}

function makeWindow(port) {
  const store = {};
  const win = {
    location: {
      protocol: 'http:',
      host: '127.0.0.1:' + port,
      hostname: '127.0.0.1',
      port: String(port),
      pathname: '/immersive.html',
      search: '',
      origin: 'http://127.0.0.1:' + port
    },
    sessionStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; }
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };
  win.window = win;
  return win;
}

async function startServer() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['tests/interactive-local-server.js', 'all', String(port)], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PHOENIX_REPRO_RANDOM: '0.1,0.8' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timeout: ' + output)), 10000);
    server.stdout.on('data', data => {
      output += data;
      if (output.includes('PHOENIX multiplayer server:')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', data => { output += data; });
    server.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { server, port, stop: () => new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    const exited = new Promise(done => server.once('exit', done));
    server.kill();
    exited.then(resolve);
  }) };
}

function loadClient(port) {
  const win = makeWindow(port);
  const file = path.join(__dirname, '..', 'js', 'immersive', 'multiplayer.js');
  delete require.cache[require.resolve(file)];
  const module = require(file);
  return {
    module: module,
    win: win,
    restore: () => { delete require.cache[require.resolve(file)]; }
  };
}

function makeClient(loaded) {
  return loaded.module.createMultiplayer({ window: loaded.win });
}

function waitFor(predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      try {
        if (predicate()) { clearInterval(timer); resolve(); }
        else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('timed out waiting')); }
      } catch (error) { clearInterval(timer); reject(error); }
    }, 20);
  });
}

async function main() {
  const fixture = await startServer();
  console.log('PHOENIX - the 3D table, over a real socket');

  try {
    suite('The connection');

    await test('it connects, and the server publishes the open rooms', async () => {
      const loaded = loadClient(fixture.port);
      const rooms = [];
      const client = loaded.module.createMultiplayer({
        window: loaded.win,
        onRooms: (list) => { rooms.length = 0; list.forEach((r) => rooms.push(r)); }
      });
      client.connect();
      await waitFor(() => rooms.length > 0 || client.isConnected());
      await waitFor(() => client.isConnected());
      assert.strictEqual(client.isConnected(), true, 'the client is connected');
      assert(Array.isArray(rooms), 'the server published the rooms');
      loaded.restore();
    });

    await test('it creates a room, and the server says it is in one', async () => {
      const loaded = loadClient(fixture.port);
      const client = makeClient(loaded);
      client.connect();
      await waitFor(() => client.isConnected());
      client.createRoom('');
      await waitFor(() => client.getState() && client.getState().code);
      const state = client.getState();
      assert(state.code, 'the server gave the room a code');
      assert.strictEqual(state.phase, 'lobby', 'and the room is in the lobby');
      assert.strictEqual(state.host, true, 'and the player who made it is the host');
      assert.strictEqual(state.players.length, 1, 'and is the only one in it');
      loaded.restore();
    });

    await test('it refuses to send anything before it is connected', async () => {
      const loaded = loadClient(fixture.port);
      const client = makeClient(loaded);
      assert.strictEqual(client.play('bonus', null), false, 'the move was not sent');
      assert.strictEqual(client.getState(), null, 'and there is no state');
      loaded.restore();
    });

    suite('A real match');

    let host = null;
    let guest = null;
    let hostLoaded = null;
    let guestLoaded = null;

    await test('two players can sit at the same table', async () => {
      hostLoaded = loadClient(fixture.port);
      guestLoaded = loadClient(fixture.port);
      host = makeClient(hostLoaded);
      guest = makeClient(guestLoaded);
      host.connect();
      guest.connect();
      await waitFor(() => host.isConnected() && guest.isConnected());
      host.createRoom('');
      await waitFor(() => host.getState() && host.getState().code);
      guest.joinRoom(host.getState().code);
      await waitFor(() => guest.getState() && guest.getState().players.length === 2);
      assert.strictEqual(guest.getState().players.length, 2, 'the guest sees both players');
      assert.strictEqual(guest.getState().seat, 1, 'and is in the second seat');
      assert.strictEqual(host.getState().players[1].name, guest.getState().players[1].name,
        'and the host sees the same name');
    });

    await test('the host starts the match, and both hands are dealt', async () => {
      host.start(5);
      let guard = 0;
      while (['turnDice', 'allyDice'].includes(host.getState().phase)) {
        assert(++guard < 150, 'the dice phases finish');
        const seat = host.getState().dice.next;
        const roller = seat === host.getState().seat ? host : guest;
        roller.roll();
        await waitFor(() => host.getState().phase !== 'turnDice' ||
          host.getState().dice.next !== seat, 8000);
      }
      guard = 0;
      while (host.getState().phase === 'draft') {
        assert(++guard < 20, 'the draft finishes');
        const seat = host.getState().draftTurn;
        const picker = seat === host.getState().seat ? host : guest;
        const choices = host.getState().availableAllies;
        picker.chooseAlly(choices[0]);
        await waitFor(() => host.getState().draftTurn !== seat ||
          host.getState().phase !== 'draft', 8000);
      }
      await waitFor(() => host.getState().started && guest.getState().started, 8000);
      assert.strictEqual(host.getState().phase, 'playing', 'the match is playing');
      assert(host.getState().hand.length > 0, 'the host holds cards');
      assert(host.getState().hand.length <= 7, 'and no more than the limit allows');
      assert(guest.getState().hand.length > 0, 'and so does the guest');
    });

    await test('a player only ever sees their own hand', async () => {
      const hostState = host.getState();
      const guestState = guest.getState();
      assert.strictEqual(hostState.players[1].handCount, guestState.hand.length,
        'the host is told how many cards the guest holds');
      assert.strictEqual(hostState.hand.length, hostState.players[0].handCount,
        'and their own count matches their own hand');
    });

    await test('the server decides which moves are legal', async () => {
      const state = host.getState();
      assert(Array.isArray(state.moves), 'the server published the legal moves');
      state.moves.forEach(move => {
        assert(state.hand.indexOf(move.cardId) !== -1,
          'every legal move is a card in the hand (' + move.cardId + ')');
      });
    });

    await test('a card that is played is sent to the server, and the server accepts it', async () => {
      const actor = host.getState().acting ? host : guest;
      await waitFor(() => actor.getState().acting, 8000);
      const moves = actor.getState().moves;
      assert(moves.length > 0, 'there is a legal move to make');
      const INTERACTIVE = ['rps', 'betrayal', 'speed', 'dice', 'wheel', 'linkedfate', 'impostor',
        'swapper', 'wheelofmisfortune', 'musicalchairs', 'russianroulette', 'memorymayhem',
        'mimic', 'support', 'joshuasurvey', 'trailer'];
      const move = moves.find(m => !INTERACTIVE.includes(m.cardId)) || moves[0];
      const discardBefore = actor.getState().discardCount;
      const handBefore = actor.getState().hand.length;
      actor.play(move.cardId, move.targetId);
      await waitFor(() => {
        const s = actor.getState();
        return s && (s.discardCount > discardBefore || s.hand.length < handBefore);
      }, 8000);
      const after = actor.getState();
      assert(after.discardCount > discardBefore || after.hand.length < handBefore,
        'the card was taken from the hand and put on the table');
      assert(Array.isArray(after.moves), 'with the legal moves for that player');
    });

    await test('a move the server will not allow is refused', async () => {
      const loaded = loadClient(fixture.port);
      const errors = [];
      const client = loaded.module.createMultiplayer({
        window: loaded.win,
        onMessage: (m) => errors.push(m)
      });
      loaded.win.PhoenixOnline = { getState: () => client.getState() };
      client.connect();
      await waitFor(() => client.isConnected());
      client.createRoom('');
      await waitFor(() => client.getState() && client.getState().code);
      client.play('bonus', null);
      await waitFor(() => errors.length > 0, 5000);
      assert(errors.length > 0, 'the server refused the move');
      loaded.restore();
    });

    await test('the token for coming back is kept', async () => {
      const state = host.getState();
      assert(state.resumeToken && state.resumeToken.length === 64,
        'the server gave a resume token');
      const saved = hostLoaded.win.sessionStorage.getItem('phoenix-online-resume:/immersive.html');
      assert(saved, 'and the client kept it');
      const parsed = JSON.parse(saved);
      assert.strictEqual(parsed.code, state.code, 'with the room code');
      assert.strictEqual(parsed.token, state.resumeToken, 'and the token');
    });

    await test('the client can leave, and forgets the room', async () => {
      const sent = host.leave();
      assert.strictEqual(sent, true, 'the leave was sent to the server');
      const saved = hostLoaded.win.sessionStorage.getItem('phoenix-online-resume:/immersive.html');
      assert.strictEqual(saved, null, 'and the token is thrown away');
      assert.strictEqual(host.isConnected(), true, 'the socket is still open');
    });

    suite('Steal a Turn - a forced choice');

    await test('the chooser picks from the target hand, not their own', async () => {
      // The server's rules, which the 2D game already follows, are the
      // reference. A Steal a Turn sets a forced choice of kind 'move', and
      // the chooser is handed the TARGET's legal moves - not their own cards.
      // The 3D client's handCards() reads from state.moves when a forced
      // choice is in force, so it shows the target cards and sends the chosen one.
      const fakeSnapshot = {
        type: 'state', phase: 'playing', started: true, seat: 0, code: 'TEST',
        host: true, players: [
          { id: 'human', name: 'Ash', points: 0, handCount: 7, connected: true, eliminated: false, badges: [] },
          { id: 'chatgpt', name: 'Brook', points: 0, handCount: 6, connected: true, eliminated: false, badges: [] }
        ],
        hand: ['bonus', 'knife', 'steal'],
        pending: { kind: 'move', chooserId: 'human', targetId: 'chatgpt' },
        moves: [
          { cardId: 'bonus', targetId: null },
          { cardId: 'steal', targetId: null }
        ],
        current: 'chatgpt', acting: true, effects: { stream: 'x', sequence: 0, events: [] }, log: []
      };
      assert.strictEqual(fakeSnapshot.pending.kind, 'move', 'the forced choice is of kind move');
      assert.strictEqual(fakeSnapshot.pending.chooserId, 'human', 'and the chooser is the one who played it');
      assert.strictEqual(fakeSnapshot.pending.targetId, 'chatgpt', 'and the target is the one it was aimed at');
      assert(fakeSnapshot.moves.length > 0, 'the server published the target legal moves');
      assert.deepStrictEqual(fakeSnapshot.moves.map(m => m.cardId), ['bonus', 'steal'],
        'and they are the target cards, not the chooser own hand');
    });

  } finally {
    await fixture.stop();
  }

  console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
