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

function startServer(stateFile, openForTests = true) {
  // Tests explicitly open only their own isolated instance. Production defaults closed.
  if (openForTests && !fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify({ multiplayerOpen: true, creationLocked: false }));
  }
  return probePort().then(port => {
    const server = spawn(process.execPath, ['tests/helpers/plain-server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        PHOENIX_OWNER_PASSWORD: password,
        PHOENIX_MODE_ACCESS_CODE: crypto.randomBytes(16).toString('hex'),
        PHOENIX_STATE_FILE: stateFile,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
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
  const client = { ws, events, state: null, closed: false, duplicateHands: 0 };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    events.push(message);
    if (message.type === 'state') {
      client.state = message;
      if (new Set(message.hand).size !== message.hand.length) client.duplicateHands++;
    }
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

/** Poll until this client's latest snapshot matches a predicate. */
function waitForState(client, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (client.state && predicate(client.state)) {
        clearInterval(timer);
        resolve(client.state);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        const last = client.state && { phase: client.state.phase, players: client.state.players.length };
        reject(new Error('state condition not met; last=' + JSON.stringify(last)));
      }
    }, 25);
  });
}

/** The very next lobby snapshot a fresh visitor sees on connect. */
function freshLobby(port) {
  return createClient(port).then(client => waitFor(client, 'lobby').then(lobby => ({ client, lobby })));
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
    // A server with NO stored state at all comes up OPEN.
    //
    // A hosted instance that has been idle throws its disk away when it
    // wakes up, so the first player to arrive after that must be able to
    // play rather than being told multiplayer is closed. The owner's own
    // switch still closes it, and a stored choice survives the restart -
    // both of which are checked further down.
    bundle = await startServer(path.join(tempDir, 'fresh-open.json'), false);
    const freshVisitor = await connect(bundle.port);
    const freshState = await create(freshVisitor, 'First player', '');
    check('a fresh server comes up with multiplayer open', () =>
      assert.strictEqual(typeof freshState.code, 'string'));
    freshVisitor.ws.close();
    await stopServer(bundle);
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
    const interactiveChoices = {
      rps: ['rock', 'paper', 'scissors'],
      betrayal: ['share', 'steal'],
      speed: ['ready'],
      dice: ['roll'],
      wheel: ['spin'],
      linkedfate: ['ack'],
      swapper: ['ack'],
      impostor: ['clue:test', 'vote:dummy']
    };
    while (!fiveHost.state.over && moves++ < 400) {
      // An interactive card (RPS, Betrayal, Speed, Dice, Wheel, Linked Fate, Impostor, Swapper)
      // pauses the game until every participant submits a decision - answer those first.
      const pi = fiveHost.state.pendingInteraction;
      if (pi) {
        const choices = interactiveChoices[pi.type] || ['ack'];
        for (const c of five) {
          const mine = c.state.players[c.state.seat].id;
          if (!pi.participants.includes(mine) || pi.submitted.includes(mine)) continue;
          c.ws.send(JSON.stringify({ type: 'interact', decision: choices[moves % choices.length] }));
          break;
        }
        for (const c of five) await waitFor(c, 'state');
        continue;
      }

      const actor = require('./helpers/acting-client')(five);
      assert(actor && actor.state.moves.length, 'a legal move is available');
      const option = actor.state.moves.find(m =>
        !(actor.state.mapleBlocked || []).includes(m.cardId)
      );
      assert(option, 'a Maple-permitted move is available');
      actor.ws.send(JSON.stringify({ type: 'move', cardId: option.cardId, targetId: option.targetId }));
      for (const c of five) await waitFor(c, 'state');
    }
    check('a full five-player match plays to completion', () =>
      assert(fiveHost.state.over, 'match did not finish'));
    check('every hand snapshot throughout the five-player match has unique card types', () =>
      assert(five.every(client => client.duplicateHands === 0)));

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

    // ---- Leaving a lobby (regression: going back to the menu left it open) ----
    console.log('Leaving lobbies');
    const leaveHost = await connect(fport);
    const leaveState = await create(leaveHost, 'Uma', '');
    leaveHost.ws.send(JSON.stringify({ type: 'leave' }));
    await new Promise(r => setTimeout(r, 250));
    const leaveSeen = await freshLobby(fport);
    track(leaveSeen.client);
    check('an explicit leave deletes an empty public lobby from the browser', () =>
      assert(!leaveSeen.lobby.rooms.some(r => r.code === leaveState.code), 'lobby lingered after leave'));

    // The connection is free again the moment it has left.
    leaveHost.ws.send(JSON.stringify({ type: 'create', name: 'Uma again', code: '' }));
    const leaveRecreate = await waitFor(leaveHost, 'state');
    check('a player who left can create a new lobby on the same connection', () =>
      assert(leaveRecreate.code && leaveRecreate.code !== leaveState.code, 'leave did not clear membership'));

    const shrinkHost = await connect(fport);
    const shrinkState = await create(shrinkHost, 'Vic', '');
    const shrinkGuest = await connect(fport);
    await joinRoom(shrinkGuest, 'Wes', shrinkState.code);
    shrinkGuest.ws.send(JSON.stringify({ type: 'leave' }));
    const shrinkUpdate = await waitForState(shrinkHost, s => s.players.length === 1);
    check('a guest leaving a lobby removes their seat but keeps the room', () =>
      assert.strictEqual(shrinkUpdate.phase, 'lobby'));
    const shrinkSeen = await freshLobby(fport);
    track(shrinkSeen.client);
    check('a lobby with a remaining player stays listed', () =>
      assert(shrinkSeen.lobby.rooms.some(r => r.code === shrinkState.code)));

    // A started match is not a lobby anymore, so it leaves the browser...
    const startLeaveHost = await connect(fport);
    const startLeaveState = await create(startLeaveHost, 'Ana', '');
    const startLeaveGuest = await connect(fport);
    await joinRoom(startLeaveGuest, 'Ben', startLeaveState.code);
    startLeaveHost.ws.send(JSON.stringify({ type: 'start', rounds: 5 }));
    await waitForState(startLeaveHost, s => s.phase !== 'lobby');
    const startedSeen = await freshLobby(fport);
    track(startedSeen.client);
    check('a started match is no longer advertised as an open lobby', () =>
      assert(!startedSeen.lobby.rooms.some(r => r.code === startLeaveState.code), 'started match still listed'));

    // ...but it is kept (the abandon grace window), so a deliberate leave does
    // not wipe a match other players are still sitting in.
    startLeaveHost.ws.send(JSON.stringify({ type: 'leave' }));
    await new Promise(r => setTimeout(r, 250));
    const leaveAdmin = await connect(fport);
    leaveAdmin.ws.send(JSON.stringify({ type: 'admin_auth', password }));
    await waitFor(leaveAdmin, 'admin_state');
    leaveAdmin.ws.send(JSON.stringify({ type: 'admin_rooms' }));
    const leaveRooms = await waitFor(leaveAdmin, 'admin_rooms');
    check('leaving a started match keeps it for the abandon grace window', () =>
      assert(leaveRooms.rooms.some(r => r.code === startLeaveState.code), 'started match was deleted on leave'));

    // A dropped socket must still clear a lobby: leave is the fast path, close
    // stays the backstop.
    const dropHost = await connect(fport);
    const dropState = await create(dropHost, 'Zed', '');
    dropHost.ws.terminate();
    await new Promise(r => setTimeout(r, 400));
    const dropSeen = await freshLobby(fport);
    track(dropSeen.client);
    check('a dropped socket still clears its public lobby (close backstop)', () =>
      assert(!dropSeen.lobby.rooms.some(r => r.code === dropState.code), 'lobby survived a dropped socket'));

    // ---- Owner & Friends (the original private mode, restored) ----
    console.log('Owner & Friends');
    const wrongOwner = await connect(fport);
    wrongOwner.ws.send(JSON.stringify({
      type: 'create', name: 'Wrong', code: '', ownerPassword: 'not-the-password'
    }));
    const wrongMsg = await waitFor(wrongOwner, 'error');
    check('an Owner & Friends create is refused without the owner password', () =>
      assert(wrongMsg.message.toLowerCase().includes('password'), wrongMsg.message));

    const ownerHost = await connect(fport);
    ownerHost.ws.send(JSON.stringify({
      type: 'create', name: 'Odin', code: '', ownerPassword: password
    }));
    const ownerRoom = await waitFor(ownerHost, 'state');
    check('the owner password opens a private owner room', () => {
      assert(ownerRoom.code, 'no room code');
      assert.strictEqual(ownerRoom.visibility, 'private');
      assert.strictEqual(ownerRoom.mode, 'owner');
    });
    check('an owner room is never sent public ally identities', () =>
      assert.strictEqual(ownerRoom.publicAllies, undefined, 'publicAllies leaked into an owner room'));

    const ownerSeen = await freshLobby(fport);
    track(ownerSeen.client);
    check('an owner room is hidden from the public lobby browser', () =>
      assert(!ownerSeen.lobby.rooms.some(r => r.code === ownerRoom.code), 'owner room listed publicly'));

    const ownerGuest = await connect(fport);
    await joinRoom(ownerGuest, 'Aska', ownerRoom.code);
    check('a friend joins an owner room by invite code and sees real allies', () => {
      assert.strictEqual(ownerGuest.state.code, ownerRoom.code);
      assert.strictEqual(ownerGuest.state.mode, 'owner');
      assert.strictEqual(ownerGuest.state.publicAllies, undefined, 'joiner saw public identities');
      // The draftable allies are the real catalogue ids (Ted needs 3+ players,
      // so with two friends it is the other five); never a public stand-in.
      const ids = ownerGuest.state.availableAllies;
      assert(ids.length >= 5, 'expected the real ally catalogue');
      ids.forEach(id => assert(ALLY_IDS.includes(id), 'non-catalogue ally id ' + id));
    });

    // Start, roll and draft in the owner room: the shared log must read with the
    // REAL ally names, never the randomised animal names.
    ownerHost.ws.send(JSON.stringify({ type: 'start', rounds: 3 }));
    await waitFor(ownerHost, 'state');
    let og = 0;
    while (['turnDice', 'allyDice'].includes(ownerHost.state.phase)) {
      assert(og++ < 80, 'owner dice must finish');
      const seat = ownerHost.state.dice.next;
      [ownerHost, ownerGuest][seat].ws.send(JSON.stringify({ type: 'roll' }));
      await waitFor(ownerHost, 'state');
    }
    const ownerPicks = ['phoenix', 'tilly'];
    let op = 0;
    while (ownerHost.state.phase === 'draft') {
      assert(op++ < 5, 'owner draft must finish');
      const seat = ownerHost.state.draftTurn;
      [ownerHost, ownerGuest][seat].ws.send(JSON.stringify({ type: 'chooseAlly', ally: ownerPicks.shift() }));
      await waitFor(ownerHost, 'state');
    }
    check('an owner room log names allies by their real names, never animals', () => {
      const lines = ownerHost.state.log.filter(l => /chose/.test(l));
      assert.strictEqual(lines.length, 2, 'expected two draft lines, saw ' + lines.length);
      lines.forEach(line => {
        const real = REAL_NAMES.some(n => line.toUpperCase().includes(n));
        assert(real, 'owner draft line has no real name: ' + line);
      });
    });
    check('an owner room has no public identities even mid-draft', () =>
      assert.strictEqual(ownerHost.state.publicAllies, undefined));

    console.log('ALL ' + passed + ' MULTIPLAYER/ADMIN TESTS PASSED (' + moves + ' moves)');
  } finally {
    clients.forEach(c => c.ws.terminate());
    if (bundle) await stopServer(bundle);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
