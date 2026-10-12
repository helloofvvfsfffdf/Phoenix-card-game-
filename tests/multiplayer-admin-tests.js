/* Real server + WebSocket clients: public/private lobbies, host controls,
 * owner administration, lockdown persistence and a full five-player match.
 * Uses isolated temp state files so it can never touch a live deployment. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-admin-'));
const password = crypto.randomBytes(24).toString('hex');

function probePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function startServer(stateFile) {
  return probePort().then(port => {
    const server = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        PHOENIX_OWNER_PASSWORD: password,
        PHOENIX_MODE_ACCESS_CODE: crypto.randomBytes(16).toString('hex'),
        PHOENIX_STATE_FILE: stateFile,
        // Raised so the suite can hold several rooms open at once; the cap and
        // the per-IP create budget are still exercised by the server itself.
        PHOENIX_MAX_ROOMS: '50',
        PHOENIX_CREATE_LIMIT: '50'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 12000);
      let output = '';
      server.once('error', reject);
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('PHOENIX multiplayer server:')) {
          clearTimeout(timer);
          resolve({ server, port });
        }
      });
      server.once('exit', code => {
        clearTimeout(timer);
        reject(new Error('Server exited early: ' + code));
      });
    });
  });
}

function stopServer(bundle) {
  return new Promise(resolve => {
    const server = bundle.server;
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    server.kill();
    setTimeout(resolve, 4000);
  });
}

function createClient(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const events = [];
  const client = { ws, events, state: null, closed: false };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    events.push(message);
    if (message.type === 'state') client.state = message;
  });
  ws.on('close', () => { client.closed = true; });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

function waitFor(client, type, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const idx = client.events.findIndex(e => e.type === type);
      if (idx >= 0) {
        clearInterval(timer);
        resolve(client.events.splice(idx, 1)[0]);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        const seen = client.events.map(e => e.type).join(',');
        reject(new Error('Timed out waiting for "' + type + '". Saw: ' + seen));
      }
    }, 20);
  });
}

function create(client, name, code) {
  client.ws.send(JSON.stringify({ type: 'create', name, code }));
  return waitFor(client, 'state');
}

function joinRoom(client, name, code) {
  client.ws.send(JSON.stringify({ type: 'join', name, code }));
  return waitFor(client, 'state');
}

async function main() {
  let passed = 0;
  function check(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

  const clients = [];
  function track(client) { clients.push(client); return client; }
  async function connect(port) { return track(await createClient(port)); }

  let bundle = null;
  const stateFile = path.join(tempDir, 'state1.json');
  try {
    bundle = await startServer(stateFile);
    const port = bundle.port;
    console.log('\nPublic/private lobbies, host controls and owner administration');

    const publicHost = await connect(port);
    const publicState = await create(publicHost, 'Alice', '');
    const pubCode = publicState.code;
    check('a public lobby is created without any owner password', () =>
      assert.strictEqual(typeof pubCode, 'string'));

    const visitor = await connect(port);
    const lobby = await waitFor(visitor, 'lobby');
    check('visitors see public lobbies in the shared lobby list', () => {
      const room = lobby.rooms.find(r => r.code === pubCode);
      assert(room, 'public room missing from lobby');
      assert.strictEqual(room.host, 'Alice');
      assert.strictEqual(room.players, 1);
      assert.strictEqual(room.visibility, undefined, 'snapshot carries no private data');
    });

    const privateHost = await connect(port);
    const privateState = await create(privateHost, 'Bob', 'BOBBY');
    const privCode = privateState.code;

    const visitor2 = await connect(port);
    const lobby2 = await waitFor(visitor2, 'lobby');
    check('private lobbies stay invisible to everyone without the invite code', () =>
      assert(!lobby2.rooms.some(r => r.code === privCode), 'private code leaked'));

    const guest = await connect(port);
    await joinRoom(guest, 'Cara', privCode);
    check('a private lobby is joinable with its invite code', () =>
      assert.strictEqual(guest.state.code, privCode));

    const dan = await connect(port);
    await joinRoom(dan, 'Dan', pubCode);
    const eve = await connect(port);
    await joinRoom(eve, 'Eve', pubCode);
    check('the host sees a full player list', () =>
      assert.strictEqual(publicHost.state.players.length, 3));

    const kickedNotice = waitFor(dan, 'kicked');
    publicHost.ws.send(JSON.stringify({ type: 'kick', seat: 1 }));
    const kicked = await kickedNotice;
    check('the host can kick one specific player by seat', () =>
      assert(kicked.message && kicked.message.includes('removed')));

    const hostState = await waitFor(publicHost, 'state');
    check('the kicked player is gone from the roster', () =>
      assert.strictEqual(hostState.players.length, 2));

    const spoofKick = waitFor(eve, 'error');
    eve.ws.send(JSON.stringify({ type: 'kick', seat: 1 }));
    await spoofKick;
    check('a non-host guest cannot kick - server refuses', () => true);

    const spoofClose = waitFor(eve, 'error');
    eve.ws.send(JSON.stringify({ type: 'close_room' }));
    await spoofClose;
    check('a non-host guest cannot close a lobby - server refuses', () => true);

    const closedNotice = waitFor(eve, 'roomClosed');
    publicHost.ws.send(JSON.stringify({ type: 'close_room' }));
    await closedNotice;
    await waitFor(publicHost, 'roomClosed');
    check('the host can close their own lobby and everyone is told', () =>
      assert.strictEqual(eve.closed, true));

    // ---- Owner administration ----
    const admin = await connect(port);
    const badAuth = waitFor(admin, 'error');
    admin.ws.send(JSON.stringify({ type: 'admin_auth', password: 'wrong-password' }));
    await badAuth;
    check('admin auth rejects a wrong owner password', () => true);

    admin.ws.send(JSON.stringify({ type: 'admin_auth', password }));
    const adminState = await waitFor(admin, 'admin_state');
    check('admin auth with the owner password succeeds and flags the connection', () =>
      assert.strictEqual(adminState.admin, true));

    const privateHost2 = await connect(port);
    const p2 = await create(privateHost2, 'Nadia', 'NADIA');
    const p2Code = p2.code;

    const extraHost = await connect(port);
    const extraState = await create(extraHost, 'Omar', '');
    const extraCode = extraState.code;
    const extraGuest = await connect(port);
    await joinRoom(extraGuest, 'Zed', extraCode);

    admin.ws.send(JSON.stringify({ type: 'admin_rooms' }));
    const adminRooms = await waitFor(admin, 'admin_rooms');
    check('the owner dashboard lists public AND private rooms', () => {
      assert(adminRooms.rooms.some(r => r.code === privCode));
      assert(adminRooms.rooms.some(r => r.code === p2Code));
      assert(adminRooms.rooms.some(r => r.code === extraCode));
      assert(!adminRooms.rooms.some(r => r.code === pubCode), 'closed lobby lingers');
      assert.strictEqual(adminRooms.multiplayerOpen, true);
      assert.strictEqual(adminRooms.creationLocked, false);
    });

    const shutRoomNotice = waitFor(privateHost2, 'roomClosed');
    admin.ws.send(JSON.stringify({ type: 'admin_shutdown_room', code: p2Code }));
    await shutRoomNotice;
    const afterShut = await waitFor(admin, 'admin_state');
    check('the owner can shut down one specific lobby while others keep running', () =>
      assert.strictEqual(afterShut.multiplayerOpen, true));

    admin.ws.send(JSON.stringify({ type: 'admin_shutdown_all' }));
    const shutAll = await waitFor(admin, 'admin_state');
    check('global shutdown closes everything and blocks multiplayer', () =>
      assert.strictEqual(shutAll.multiplayerOpen, false));

    const blockedCreate = await connect(port);
    blockedCreate.ws.send(JSON.stringify({ type: 'create', name: 'X', code: '' }));
    const createBlocked = await waitFor(blockedCreate, 'error');
    check('create is refused while multiplayer is shut down', () =>
      assert(createBlocked.message.includes('closed')));

    const blockedJoin = await connect(port);
    blockedJoin.ws.send(JSON.stringify({ type: 'join', name: 'Y', code: extraCode }));
    const joinBlocked = await waitFor(blockedJoin, 'error');
    check('join is refused while multiplayer is shut down', () =>
      assert(joinBlocked.message.includes('closed')));

    admin.ws.send(JSON.stringify({ type: 'admin_reopen' }));
    const reopened = await waitFor(admin, 'admin_state');
    check('the owner can reopen multiplayer', () =>
      assert.strictEqual(reopened.multiplayerOpen, true));

    const keepHost = await connect(port);
    const keepState = await create(keepHost, 'Pia', '');
    const keepCode = keepState.code;

    admin.ws.send(JSON.stringify({ type: 'admin_lock_creation' }));
    const locked = await waitFor(admin, 'admin_state');
    check('the owner can lock lobby creation without closing matches', () =>
      assert.strictEqual(locked.creationLocked, true));

    const lockedCreate = await connect(port);
    lockedCreate.ws.send(JSON.stringify({ type: 'create', name: 'Q', code: '' }));
    const lockedMsg = await waitFor(lockedCreate, 'error');
    check('create is refused while creation is locked', () =>
      assert(lockedMsg.message.includes('locked')));

    const stillJoins = await connect(port);
    await joinRoom(stillJoins, 'Rita', keepCode);
    check('players can still join an existing lobby while creation is locked', () =>
      assert.strictEqual(stillJoins.state.code, keepCode));

    // ---- Persistence across restart (still locked) ----
    await stopServer(bundle);
    bundle = await startServer(stateFile);
    const p2port = bundle.port;
    const afterRestart = await connect(p2port);
    afterRestart.ws.send(JSON.stringify({ type: 'create', name: 'S', code: '' }));
    const stillLocked = await waitFor(afterRestart, 'error');
    check('creationLocked survives a server restart', () =>
      assert(stillLocked.message.includes('locked')));

    const admin2 = await connect(p2port);
    admin2.ws.send(JSON.stringify({ type: 'admin_auth', password }));
    await waitFor(admin2, 'admin_state');
    admin2.ws.send(JSON.stringify({ type: 'admin_unlock_creation' }));
    const unlockedState = await waitFor(admin2, 'admin_state');
    check('the owner can unlock lobby creation', () =>
      assert.strictEqual(unlockedState.creationLocked, false));
    admin2.ws.send(JSON.stringify({ type: 'admin_shutdown_all' }));
    await waitFor(admin2, 'admin_state');
    await stopServer(bundle);
    bundle = await startServer(stateFile);
    const p3port = bundle.port;
    const afterAll = await connect(p3port);
    afterAll.ws.send(JSON.stringify({ type: 'create', name: 'T', code: '' }));
    const closedCreate = await waitFor(afterAll, 'error');
    check('multiplayerOpen=false survives a server restart', () =>
      assert(closedCreate.message.includes('closed')));

    const admin3 = await connect(p3port);
    admin3.ws.send(JSON.stringify({ type: 'admin_auth', password }));
    await waitFor(admin3, 'admin_state');
    admin3.ws.send(JSON.stringify({ type: 'admin_reopen' }));
    await waitFor(admin3, 'admin_state');
    admin3.ws.send(JSON.stringify({ type: 'admin_unlock_creation' }));
    await waitFor(admin3, 'admin_state');

    // ---- Full five-player match ----
    console.log('Full five-player match');
    await stopServer(bundle);
    bundle = await startServer(path.join(tempDir, 'state2.json'));
    const fport = bundle.port;
    const five = [];
    for (let i = 0; i < 5; i++) five.push(await connect(fport));
    const fiveHost = five[0];
    await create(fiveHost, 'First', '');
    for (let i = 1; i < 5; i++) await joinRoom(five[i], 'P' + i, fiveHost.state.code);
    check('a public lobby holds five players', () =>
      assert.strictEqual(fiveHost.state.players.length, 5));

    fiveHost.ws.send(JSON.stringify({ type: 'start', rounds: 6 }));
    const started = await waitFor(fiveHost, 'state').catch(e => e);
    if (started instanceof Error) throw started;
    check('the host starts a five-player match', () =>
      assert(fiveHost.state.phase === 'turnDice'));

    let guard = 0;
    while (['turnDice', 'allyDice'].includes(fiveHost.state.phase)) {
      assert(guard++ < 200, 'dice must complete');
      const seat = fiveHost.state.dice.next;
      five[seat].ws.send(JSON.stringify({ type: 'roll' }));
      await waitFor(fiveHost, 'state');
    }
    check('five players complete the dice phases', () =>
      assert(fiveHost.state.phase === 'draft' || fiveHost.state.phase === 'playing'));

    const allies = ['phoenix', 'tilly', 'louie', 'simba', 'elsie'];
    let drafts = 0;
    while (fiveHost.state.phase === 'draft') {
      assert(drafts++ < 10, 'draft must complete');
      const seat = fiveHost.state.draftTurn;
      five[seat].ws.send(JSON.stringify({ type: 'chooseAlly', ally: allies.shift() }));
      await waitFor(fiveHost, 'state');
    }
    check('all five players draft unique allies', () =>
      assert.strictEqual(new Set(fiveHost.state.players.map(p => p.ally)).size, 5));

    let moves = 0;
    while (!fiveHost.state.over && moves++ < 400) {
      const actor = five.find(c => c.state.acting);
      assert(actor && actor.state.moves.length, 'a legal move is available');
      const option = actor.state.moves.find(m => !(actor.state.mapleBlocked || []).includes(m.cardId));
      assert(option, 'a Maple-permitted move is available');
      actor.ws.send(JSON.stringify({ type: 'move', cardId: option.cardId, targetId: option.targetId }));
      for (const c of five) await waitFor(c, 'state');
    }
    check('a full five-player match plays to completion', () =>
      assert(fiveHost.state.over, 'match did not finish'));

    // ---- Optional invite codes (blank = public, custom = private) ----
    console.log('Optional invite codes');
    const soloHost = await connect(fport);
    const soloState = await create(soloHost, 'Ivy', '');
    const soloVisitor = await connect(fport);
    const soloLobby = await waitFor(soloVisitor, 'lobby');
    check('a blank code creates a public lobby with an auto code, listed for visitors', () => {
      assert.strictEqual(soloState.visibility, 'public');
      assert(/^[A-F0-9]{6}$/.test(soloState.code), 'unexpected auto code: ' + soloState.code);
      assert(soloLobby.rooms.some(r => r.code === soloState.code), 'public lobby not listed');
    });

    const customHost = await connect(fport);
    const customState = await create(customHost, 'Jax', 'LUCKY');
    check('a custom code creates a private lobby under that exact code', () => {
      assert.strictEqual(customState.code, 'LUCKY');
      assert.strictEqual(customState.visibility, 'private');
    });

    const codeVisitor = await connect(fport);
    const codeLobby = await waitFor(codeVisitor, 'lobby');
    check('a custom-code lobby is hidden from the shared lobby browser', () =>
      assert(!codeLobby.rooms.some(r => r.code === 'LUCKY'), 'private code leaked'));

    const customJoiner = await connect(fport);
    await joinRoom(customJoiner, 'Kai', 'LUCKY');
    check('a custom-code lobby is joinable with that code', () =>
      assert.strictEqual(customJoiner.state.code, 'LUCKY'));

    const badCode = await connect(fport);
    badCode.ws.send(JSON.stringify({ type: 'create', name: 'Bad', code: 'A!' }));
    const badMsg = await waitFor(badCode, 'error');
    check('an invalid invite code is refused', () =>
      assert(badMsg.message.includes('3-6'), badMsg.message));

    const dupeCode = await connect(fport);
    dupeCode.ws.send(JSON.stringify({ type: 'create', name: 'Dupe', code: 'LUCKY' }));
    const dupeMsg = await waitFor(dupeCode, 'error');
    check('a duplicate invite code is refused', () =>
      assert(dupeMsg.message.includes('already in use'), dupeMsg.message));

    // ---- Public ally identities (the PUBLIC version) ----
    console.log('Public ally identities');
    const REAL_NAMES = ['PHOENIX', 'TILLY', 'TED', 'LOUIE', 'SIMBA', 'ELSIE', 'MAPLE'];
    const ALLY_IDS = ['phoenix', 'tilly', 'ted', 'louie', 'simba', 'elsie', 'maple'];

    const allyHost = await connect(fport);
    const allyRoom = await create(allyHost, 'Nova', '');
    const allyMap = allyRoom.publicAllies;

    check('every online state carries a full public ally identity map', () => {
      assert(allyMap, 'publicAllies missing from the state');
      assert.strictEqual(Object.keys(allyMap).length, 7, 'expected six allies + maple');
      ALLY_IDS.forEach(id => {
        assert(allyMap[id], 'no public identity for ' + id);
        assert(allyMap[id].name, 'no public name for ' + id);
        assert(allyMap[id].emoji, 'no public emoji for ' + id);
      });
    });

    check('public names and emojis are unique inside one room', () => {
      const names = Object.values(allyMap).map(p => p.name.toUpperCase());
      const emojis = Object.values(allyMap).map(p => p.emoji);
      assert.strictEqual(new Set(names).size, names.length, 'duplicate public name');
      assert.strictEqual(new Set(emojis).size, emojis.length, 'duplicate public emoji');
    });

    check('the public state never leaks catalogue names or portrait paths', () => {
      const serialised = JSON.stringify(allyRoom);
      assert(!serialised.includes('assets/allies'), 'portrait path leaked into the state');
      Object.values(allyMap).forEach(p => {
        assert(REAL_NAMES.indexOf(p.name.toUpperCase()) === -1, 'real name leaked: ' + p.name);
      });
    });

    const allyGuest = await connect(fport);
    await joinRoom(allyGuest, 'Pax', allyRoom.code);
    check('every player in a room sees the exact same public identities', () =>
      assert.deepStrictEqual(allyGuest.state.publicAllies, allyMap));

    const otherHost = await connect(fport);
    const otherRoom = await create(otherHost, 'Quill', '');
    check('a different match gets a different set of animal names', () =>
      assert.notDeepStrictEqual(otherRoom.publicAllies, allyMap));

    // A fresh two-player draft, to prove the shared log reads publicly.
    const logHost = await connect(fport);
    const logState = await create(logHost, 'Rune', '');
    const logGuest = await connect(fport);
    await joinRoom(logGuest, 'Sage', logState.code);
    logHost.ws.send(JSON.stringify({ type: 'start', rounds: 3 }));
    await waitFor(logHost, 'state');
    let dg = 0;
    while (['turnDice', 'allyDice'].includes(logHost.state.phase)) {
      assert(dg++ < 80, 'dice must finish');
      const seat = logHost.state.dice.next;
      [logHost, logGuest][seat].ws.send(JSON.stringify({ type: 'roll' }));
      await waitFor(logHost, 'state');
    }
    const picks = ['phoenix', 'tilly'];
    let dp = 0;
    while (logHost.state.phase === 'draft') {
      assert(dp++ < 5, 'draft must finish');
      const seat = logHost.state.draftTurn;
      [logHost, logGuest][seat].ws.send(JSON.stringify({ type: 'chooseAlly', ally: picks.shift() }));
      await waitFor(logHost, 'state');
    }
    check('the draft log names allies by their public name, never the catalogue name', () => {
      const lines = logHost.state.log.filter(l => /chose/.test(l));
      assert.strictEqual(lines.length, 2, 'expected two draft lines, saw ' + lines.length);
      lines.forEach(line => {
        const isPublic = Object.values(logHost.state.publicAllies)
          .some(p => line.indexOf(p.name) !== -1);
        assert(isPublic, 'draft line is not public: ' + line);
        REAL_NAMES.forEach(n =>
          assert(line.indexOf(n + '.') === -1, 'real name in draft line: ' + line));
      });
    });

    console.log('ALL ' + passed + ' MULTIPLAYER/ADMIN TESTS PASSED (' + moves + ' moves)');
  } finally {
    clients.forEach(c => c.ws.terminate());
    if (bundle) await stopServer(bundle);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });