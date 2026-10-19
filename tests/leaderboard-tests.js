/* Phoenix - wins and leaderboard tests
 * ---------------------------------------------------------------------------
 * Two halves, neither of which touches the live Supabase project or any remote
 * host.
 *
 *   1. PURE RULES  - js/wins.js rank(), the ordering that decides who is on the
 *      board and in what order. The owner being off it is proved here directly,
 *      with an owner account handed straight in.
 *
 *   2. FULL STACK  - a real `node server.js` talking to a local stand-in for
 *      Supabase's PostgREST endpoint that ENFORCES what the real database
 *      enforces (see sql/leaderboard.sql). Two signed-in players then play a
 *      COMPLETE match over real WebSockets, and this proves over HTTP that:
 *          - the winner of a finished match gains exactly one win
 *          - the loser gains none and is not listed
 *          - the OWNER is never ranked, even after winning a match, and even
 *            if a win row somehow exists for them
 *          - a win is counted once however many times it is reported
 *          - totals aggregate correctly across matches
 *          - the payload carries only a rank, a username and a number
 *          - with the migration not deployed, the API degrades instead of 500ing
 *
 *     node tests/leaderboard-tests.js
 */
'use strict';
const legacyFixture = require('./helpers/legacy-account-fixture');

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const Wins = require(path.join(ROOT, 'js', 'wins.js'));

let passed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  \u2713 ' + name); })
    .catch(err => {
      failures.push({ name, err });
      console.log('  \u2717 ' + name + '\n      ' + err.message);
    });
}

function finish() {
  console.log('\nLeaderboard tests: ' + passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => {
    console.log('\n  FAILED: ' + f.name);
    console.log('  ' + (f.err && f.err.stack || f.err));
  });
  // The fake PostgREST server and the spawned app leave open handles behind,
  // so the summary decides when this process is over rather than waiting.
  process.exit(failures.length ? 1 : 0);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

/* ======================================================================== */
/* 1. PURE RULES                                                            */
/* ======================================================================== */

function runRules() {
  const ALICE = { id: 'a', username: 'alice', role: 'player' };
  const BOB = { id: 'b', username: 'bob', role: 'player' };
  const SOVEREIGN = { id: 'o', username: 'sovereign', role: 'owner' };
  const win = (id) => ({ account_id: id });

  return test('players are ranked by wins, most first', () => {
    const table = Wins.rank(
      [ALICE, BOB],
      [win('a'), win('a'), win('a'), win('b')]
    );
    assert.deepStrictEqual(table, [
      { rank: 1, username: 'alice', wins: 3 },
      { rank: 2, username: 'bob', wins: 1 }
    ]);
  })
    .then(() => test('equal scores are broken by username, so the order is stable', () => {
      const first = Wins.rank([BOB, ALICE], [win('b'), win('a')]);
      const second = Wins.rank([ALICE, BOB], [win('a'), win('b')]);
      assert.deepStrictEqual(first, second);
      assert.strictEqual(first[0].username, 'alice');
      assert.strictEqual(first[0].rank, 1);
      assert.strictEqual(first[1].username, 'bob');
      assert.strictEqual(first[1].rank, 2);
    }))
    .then(() => test('THE OWNER IS NEVER RANKED, whatever the score', () => {
      const table = Wins.rank(
        [SOVEREIGN, ALICE],
        [win('o'), win('o'), win('o'), win('a')]
      );
      assert.deepStrictEqual(table,
        [{ rank: 1, username: 'alice', wins: 1 }],
        'the owner holds every win on this board and is still not on it');
      assert.strictEqual(table.some(p => p.username === 'sovereign'), false);
    }))
    .then(() => test('a player with no wins has not climbed onto the board', () => {
      assert.deepStrictEqual(Wins.rank([ALICE, BOB], [win('a')]),
        [{ rank: 1, username: 'alice', wins: 1 }]);
      assert.deepStrictEqual(Wins.rank([ALICE, BOB], []), [],
        'an empty board is an empty board, not a list of everyone registered');
    }))
    .then(() => test('ranks run 1..n with no gaps', () => {
      const table = Wins.rank(
        [ALICE, BOB, { id: 'c', username: 'carol', role: 'player' }],
        [win('a'), win('b'), win('c')]
      );
      assert.deepStrictEqual(table.map(p => p.rank), [1, 2, 3]);
    }))
    .then(() => test('garbage input ranks to an empty board rather than throwing', () => {
      assert.deepStrictEqual(Wins.rank(undefined, undefined), []);
      assert.deepStrictEqual(Wins.rank([], []), []);
      assert.deepStrictEqual(Wins.rank([null, undefined], [null]), []);
    }));
}

/* ======================================================================== */
/* 2. FULL STACK                                                            */
/* ======================================================================== */

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

/**
 * A local stand-in for PostgREST.
 *
 * It holds accounts, sessions and match wins, and it enforces what the real
 * database enforces so mistakes surface HERE rather than in production: the
 * primary key on (match_id, account_id), and the foreign key to accounts.
 */
function startFakeSupabase() {
  const state = { accounts: [], sessions: [], wins: [], hideTable: false,
    // Just enough of the badge tables to let js/wins.js hand over MATCH WINNER
    // the way it would against the real database: the catalogue row it needs,
    // and account_badges with its own key and foreign key enforced.
    badges: [{ key: 'champion', name: 'MATCH WINNER', rarity: 'common',
               description: 'Won a match of PHOENIX.', sort_order: 3,
               icon: 'assets/phoenix-badge.jpg' }],
    grants: [] };

  function filters(url) {
    const out = [];
    for (const [key, value] of url.searchParams) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
      const dot = value.indexOf('.');
      if (dot > 0) out.push({ col: key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      else out.push({ col: key, op: 'eq', val: value });
    }
    return out;
  }
  function matches(row, flts) {
    return flts.every(f => {
      if (f.op === 'eq') return String(row[f.col]) === String(f.val);
      if (f.op === 'gte') return String(row[f.col]) >= String(f.val);
      return String(row[f.col]) === String(f.val);
    });
  }
  function readBody(req) {
    return new Promise(resolve => {
      let b = '';
      req.on('data', c => { if (b.length < 65536) b += c; });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
    });
  }
  function wantsRows(req) {
    return String(req.headers.prefer || '').includes('return=representation');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (legacyFixture.rejectMissingEmailColumns(req, url, res)) return;

    /* ---- accounts / sessions (so real signed-in sockets can happen) -- */
    if (p === '/rest/v1/accounts') {
      if (req.method === 'GET') {
        return json(res, 200, state.accounts.filter(r => matches(r, filters(url))));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (state.accounts.some(a => a.username.toLowerCase() === String(body.username).toLowerCase())) {
          return json(res, 409, { code: '23505',
            message: 'duplicate key value violates unique constraint "accounts_username_lower"' });
        }
        if (state.accounts.some(a => a.role === 'owner') && body.role === 'owner') {
          return json(res, 409, { code: '23505', message: 'An owner account already exists.' });
        }
        const row = { id: crypto.randomUUID(), username: String(body.username),
                      password_hash: String(body.password_hash || ''),
                      role: body.role || 'player', created_at: new Date().toISOString() };
        state.accounts.push(row);
        return json(res, 201, wantsRows(req) ? [row] : {});
      }
    }
    if (p === '/rest/v1/sessions') {
      if (req.method === 'GET') {
        return json(res, 200, state.sessions.filter(r => matches(r, filters(url))));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        state.sessions.push({ token_hash: String(body.token_hash),
                              account_id: String(body.account_id),
                              created_at: new Date().toISOString(),
                              expires_at: String(body.expires_at) });
        return json(res, 201, {});
      }
    }

    /* ---- match_wins ------------------------------------------------- */
    if (p === '/rest/v1/match_wins') {
      if (state.hideTable) {
        return json(res, 409, {
          code: 'PGRST205',
          message: 'Could not find the table(s) public.match_wins in the schema cache',
          details: null, hint: null
        });
      }

      if (req.method === 'GET') {
        return json(res, 200, state.wins.filter(r => matches(r, filters(url))));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const matchId = String(body.match_id || '');
        const accountId = String(body.account_id || '');

        // public.match_wins_account_id_fkey
        if (!state.accounts.some(a => a.id === accountId)) {
          return json(res, 409, { code: '23503',
            message: 'insert or update on table "match_wins" violates foreign key constraint' });
        }
        // public.match_wins_pkey - a match counts once, however many times it
        // is reported. This is the whole idempotency guarantee.
        if (state.wins.some(w => w.match_id === matchId && w.account_id === accountId)) {
          return json(res, 409, { code: '23505',
            message: 'duplicate key value violates unique constraint "match_wins_pkey"' });
        }

        state.wins.push({ match_id: matchId, account_id: accountId,
                          created_at: new Date().toISOString() });
        return json(res, 201, wantsRows(req) ? [state.wins[state.wins.length - 1]] : {});
      }
    }

    /* ---- the badge tables wins.js writes to --------------------------- */
    // A win hands over MATCH WINNER, so the badge tables have to be here too -
    // otherwise every match would end with a foreign key error in the log.
    if (p === '/rest/v1/badges' && req.method === 'GET') {
      return json(res, 200, state.badges);
    }
    if (p === '/rest/v1/account_badges' && req.method === 'POST') {
      const body = await readBody(req);
      // public.account_badges_badge_key_fkey
      if (!state.badges.some(b => b.key === body.badge_key)) {
        return json(res, 409, { code: '23503',
          message: 'insert or update on table "account_badges" violates foreign key constraint' });
      }
      // public.account_badges_pkey - a grant is naturally idempotent, so the
      // same match reported twice cannot hand the badge out twice either.
      if (state.grants.some(g => g.account_id === body.account_id &&
                                 g.badge_key === body.badge_key)) {
        return json(res, 409, { code: '23505',
          message: 'duplicate key value violates unique constraint "account_badges_pkey"' });
      }
      state.grants.push({ account_id: body.account_id, badge_key: body.badge_key });
      return json(res, 201, wantsRows(req) ? [state.grants[state.grants.length - 1]] : {});
    }

    /* ---- test-only helpers ----------------------------------------- */
    if (p === '/__promote' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      if (acct) acct.role = 'owner';
      return json(res, 200, { ok: !!acct });
    }
    // Write a win row directly, to stand in for matches already played.
    if (p === '/__seed' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      state.wins.push({ match_id: String(body.matchId || crypto.randomUUID()),
                        account_id: acct ? acct.id : 'nobody',
                        created_at: new Date().toISOString() });
      return json(res, 200, { ok: true });
    }
    if (p === '/__dump' && req.method === 'GET') {
      return json(res, 200, {
        accounts: state.accounts.map(a => ({ id: a.id, username: a.username, role: a.role })),
        wins: state.wins,
        grants: state.grants
      });
    }
    if (p === '/__hide-wins' && req.method === 'POST') {
      const body = await readBody(req);
      state.hideTable = !!body.value;
      return json(res, 200, { ok: true });
    }

    json(res, 404, { message: 'Not found: ' + req.method + ' ' + p });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

function startApp(appPort, supaPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/helpers/plain-server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(appPort),
        // Pointed at the LOCAL stand-in, never at the real Supabase.
        SUPABASE_URL: 'http://127.0.0.1:' + supaPort,
        SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64') + '.sig',
        PHOENIX_OWNER_PASSWORD: 'unused-owner-password-0123456789abcdef',
        PHOENIX_MODE_ACCESS_CODE: 'unused-access-code-1234567890',
        PHOENIX_BIND_HOST: '127.0.0.1',
        // Decisive natural-match retries retain completed/tied rooms until the
        // normal grace cleanup. This suite tests wins, not room-limit policy.
        PHOENIX_MAX_ROOMS: '50',
        PHOENIX_CREATE_LIMIT: '200',
        PHOENIX_STATE_FILE: legacyFixture.openState('phoenix-board-')
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('server startup timeout\n' + output)), 15000);
    child.once('error', reject);
    child.stdout.on('data', d => {
      output += d;
      if (output.includes('PHOENIX multiplayer server:')) {
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    });
    child.stderr.on('data', d => { output += d; });
  });
}

function call(port, method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {},
        cookie ? { Cookie: cookie } : {}
      )
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed,
                  setCookie: res.headers['set-cookie'] || [] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A signed-in WebSocket. The cookie is what makes ws.account exist at all. */
function connect(port, cookie) {
  const ws = new WebSocket('ws://127.0.0.1:' + port, {
    headers: cookie ? { Cookie: cookie } : {}
  });
  const client = { ws, state: null, seq: 0, errors: [] };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'error') client.errors.push(message.message);
    if (message.type === 'state') {
      client.state = message;
      client.seq++;
    }
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 8000);
    ws.once('open', () => { clearTimeout(timer); resolve(client); });
    ws.once('error', err => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Send an action and wait until EVERY seat has been given the new state.
 *
 * Waiting on a sequence number rather than on the next message in a queue,
 * because a broadcast reaches every seat and there is no way to tell which
 * arrival belongs to which send.
 */
function act(client, message, seats) {
  const marks = seats.map(c => c.seq);
  const errors = client.errors.length;
  client.ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const timer = setInterval(() => {
      if (client.errors.length > errors) {
        clearInterval(timer);
        reject(new Error(JSON.stringify(message) + ': ' + client.errors.at(-1)));
        return;
      }
      if (seats.every((c, i) => c.seq > marks[i])) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('timed out waiting for a state from every seat'));
      }
    }, 10);
  });
}

/**
 * Play a COMPLETE match between two signed-in players, over real WebSockets,
 * and return the winner's username.
 *
 * The moves are the first legal one each time, exactly as the multiplayer
 * admin suite plays its five-player match: the point here is that a match
 * finishes and the server counts it, not how it was won.
 */
async function playMatch(port, seats, rounds) {
  const host = seats[0];

  // A socket only receives `state` once it is a member of the room, so the
  // wait list grows as the room fills rather than starting with everyone.
  const members = [host];

  await act(host, { type: 'create', name: '', code: '' }, members);
  const code = host.state.code;
  members.push(seats[1]);
  await act(seats[1], { type: 'join', name: '', code }, members);
  await act(host, { type: 'start', rounds: rounds || 6 }, members);

  let guard = 0;
  while (['turnDice', 'allyDice'].includes(host.state.phase)) {
    assert(guard++ < 200, 'the dice phases must finish');
    await act(seats[host.state.dice.next], { type: 'roll' }, members);
  }

  guard = 0;
  while (host.state.phase === 'draft') {
    assert(guard++ < 10, 'the draft must finish');
    const seat = host.state.draftTurn;
    await act(seats[seat],
      { type: 'chooseAlly', ally: host.state.availableAllies[0] }, members);
  }

  let moves = 0;
  while (!host.state.over && moves++ < 400) {
    const actor = require('./helpers/acting-client')(members);
    assert(actor && actor.state.moves.length, 'a legal move is available');
    const option = actor.state.moves
      .find(m => !(actor.state.mapleBlocked || []).includes(m.cardId));
    assert(option, 'a Maple-permitted move is available');
    await act(actor,
      { type: 'move', cardId: option.cardId, targetId: option.targetId }, members);
  }

  assert(host.state.over, 'the match must finish for anything to be counted');

  const winner = host.state.players.find(p => p.id === host.state.winner);
  assert(winner, 'the snapshot names a winner');

  seats.forEach(c => c.ws.close());
  return host.state.players.filter(p => p.points === winner.points).length === 1 ? winner.name : null;
}

async function playDecisiveMatch(port, cookies, rounds) {
  // Natural deals can tie. A tie is not a win for the first-ranked seat.
  for (let attempt = 0; attempt < 8; attempt++) {
    const seats = await Promise.all(cookies.map(cookie => connect(port, cookie)));
    const winner = await playMatch(port, seats, rounds);
    if (winner) return winner;
  }
  throw new Error('Eight natural matches tied; no decisive leaderboard fixture was produced');
}

function runStack() {
  const fakeState = { port: null, api: null };
  let appPort;

  return startFakeSupabase()
    .then(fake => {
      fakeState.port = fake.port;
      fakeState.close = () => new Promise(r => fake.server.close(() => r()));
      fakeState.api = (p, body) => call(fake.port, 'POST', p, body);
      fakeState.dump = () => call(fake.port, 'GET', '/__dump');
      return freePort();
    })
    .then(port => {
      appPort = port;
      return startApp(port, fakeState.port);
    })
    .then(async app => {
      function signIn(username, password) {
        return call(appPort, 'POST', '/api/register', { username, password }).then(res => {
          const raw = res.setCookie.find(c => /^phoenix_session=/.test(c)) || '';
          return { cookie: raw.split(';')[0], res };
        });
      }

      const session = {};
      await test('an empty board is an empty board, and needs no session', async () => {
        const r = await call(appPort, 'GET', '/api/leaderboard');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.ok, true);
        assert.strictEqual(r.body.available, true);
        assert.deepStrictEqual(r.body.players, []);
      });

      await test('two players and an owner sign in', async () => {
        session.alice = (await signIn('alice', 'correct-horse-battery')).cookie;
        session.bob = (await signIn('bob', 'another-good-passphrase')).cookie;
        session.owner = (await signIn('sovereign', 'yet-another-passphrase')).cookie;
        assert.ok(session.alice && session.bob && session.owner, 'all three got sessions');
        await fakeState.api('/__promote', { username: 'sovereign' });
      });

      let winnerName = null;
      let winnerAccount = null;
      async function waitForDump(predicate) {
        const deadline = Date.now() + 8000;
        let dump;
        do {
          dump = await fakeState.dump();
          if (predicate(dump.body)) return dump;
          await new Promise(resolve => setTimeout(resolve, 20));
        } while (Date.now() < deadline);
        throw new Error('The asynchronous win/badge ledger did not settle: ' + JSON.stringify(dump.body.wins));
      }

      await test('a COMPLETE match between two signed-in players counts once', async () => {
        winnerName = await playDecisiveMatch(appPort, [session.alice, session.bob], 6);
        assert.ok(winnerName, 'someone won');

        const dump = await waitForDump(body => body.wins.length >= 1);
        assert.strictEqual(dump.body.wins.length, 1,
          'the finished match produced exactly ONE win row, however many times ' +
          'the server broadcast after it ended');
        winnerAccount = dump.body.accounts.find(a => a.username === winnerName);
        assert.ok(winnerAccount, 'the winner has an account');
        assert.strictEqual(dump.body.wins[0].account_id, winnerAccount.id,
          'the win belongs to the player who actually won');
      });

      await test('the winner is handed MATCH WINNER, and the loser is not', async () => {
        const dump = await waitForDump(body => body.grants.some(b => b.account_id === winnerAccount.id && b.badge_key === 'champion'));
        const other = dump.body.accounts.find(
          a => a.username !== winnerName && a.role === 'player');

        assert.deepStrictEqual(
          dump.body.grants.filter(g => g.badge_key === 'champion')
            .map(g => g.account_id).sort(),
          [winnerAccount.id],
          'exactly ONE holder: the player who actually won. The server ' +
          'broadcast several times after the match ended, so recordWin ran ' +
          'several times too - and the badge still landed only once');
        assert.strictEqual(
          dump.body.grants.some(g => g.account_id === other.id && g.badge_key === 'champion'),
          false, 'losing does not earn it');
        assert.strictEqual(
          dump.body.grants.some(g => g.badge_key === 'phoenix'),
          false, 'and a win can never hand out THE PHOENIX');
      });

      await test('the winner is on the board with one win, and the loser is not', async () => {
        const r = await call(appPort, 'GET', '/api/leaderboard');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.players,
          [{ rank: 1, username: winnerName, wins: 1 }]);
      });

      await test('THE OWNER IS NEVER ON THE BOARD, even after winning a match', async () => {
        // Either of them may take it, and the rule has to hold both ways.
        const matchTwoWinner = await playDecisiveMatch(appPort, [session.owner, session.alice], 6);
        await waitForDump(body => body.wins.length >= 1 + (matchTwoWinner === 'sovereign' ? 0 : 1));

        const r = await call(appPort, 'GET', '/api/leaderboard');
        const names = r.body.players.map(p => p.username);
        assert.strictEqual(names.includes('sovereign'), false,
          'the owner played, won, and is still not ranked');

        // Whoever took the first match is a player, and is still up there.
        assert.ok(names.includes(winnerName), 'the players who did win stay ranked');

        const dump = await fakeState.dump();
        const owner = dump.body.accounts.find(a => a.username === 'sovereign');
        assert.strictEqual(
          dump.body.wins.filter(w => w.account_id === owner.id).length, 0,
          'and no win row was ever written for an owner account');
        assert.strictEqual(dump.body.wins.length,
          1 + (matchTwoWinner === 'sovereign' ? 0 : 1),
          matchTwoWinner === 'sovereign'
            ? 'the owner won this match and NOTHING was written'
            : 'the player won this match and it was counted');
      });

      await test('a win row that somehow exists for the owner is still not shown', async () => {
        // Belt and braces: force a win row for the owner past the write path,
        // and prove the READ side keeps them off the board anyway.
        await fakeState.api('/__seed', { username: 'sovereign' });
        await fakeState.api('/__seed', { username: 'sovereign' });

        const r = await call(appPort, 'GET', '/api/leaderboard');
        assert.strictEqual(r.body.players.some(p => p.username === 'sovereign'), false,
          'even holding more wins than anyone, the owner is not on the board');
      });

      await test('totals add up across matches, and ranks follow the order', async () => {
        // Whoever took the second match may also have taken the first, so the
        // expectation is measured rather than guessed.
        const before = (await fakeState.dump()).body.wins
          .filter(w => w.account_id === winnerAccount.id).length;
        assert.ok(before >= 1, 'the winner already holds at least one win');

        await fakeState.api('/__seed', { username: winnerName, matchId: 'older-match-1' });
        await fakeState.api('/__seed', { username: winnerName, matchId: 'older-match-2' });

        const r = await call(appPort, 'GET', '/api/leaderboard');
        const row = r.body.players.find(p => p.username === winnerName);
        assert.strictEqual(row.wins, before + 2,
          'every match this player won is counted, however many');
        assert.strictEqual(row.rank, 1);
        const dump = await fakeState.dump();
        const expectedNames = dump.body.accounts.filter(a => a.role !== 'owner' &&
          dump.body.wins.some(w => w.account_id === a.id)).map(a => a.username).sort();
        assert.deepStrictEqual(r.body.players.map(p => p.username).sort(), expectedNames,
          'every player who actually won is ranked; owners and players with no wins are absent');
        assert.strictEqual(dump.body.wins
          .filter(w => w.account_id === winnerAccount.id).length, before + 2,
          'the rows are still in the table, one per match');
      });

      await test('the board carries a rank, a username and a number - nothing else', async () => {
        const r = await call(appPort, 'GET', '/api/leaderboard');
        assert.deepStrictEqual(Object.keys(r.body.players[0]).sort(),
          ['rank', 'username', 'wins']);
        const text = JSON.stringify(r.body);
        assert.strictEqual(text.includes('account_id'), false, 'no account row travels');
        assert.strictEqual(text.includes('"role"'), false, 'and no role either');
        assert.strictEqual(text.includes('service_role'), false);
        assert.strictEqual(text.includes('password'), false);
      });

      await test('with the migration not deployed the API degrades, never 500s', async () => {
        await fakeState.api('/__hide-wins', { value: true });
        const r = await call(appPort, 'GET', '/api/leaderboard');
        assert.notStrictEqual(r.status, 500);
        assert.strictEqual(r.body.available, false,
          'unavailable, not an error the visitor has to understand');
        await fakeState.api('/__hide-wins', { value: false });
      });

      await test('the server logged no win errors during the run', () => {
        assert.strictEqual(/\[PHOENIX wins\]/.test(app.output()), false,
          'unexpected win error in the server log:\n' + app.output().split('\n')
            .filter(l => l.includes('[PHOENIX wins]')).join('\n'));
      });

      app.child.kill();
      await fakeState.close();
    });
}

runRules()
  .then(runStack)
  .then(finish)
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
