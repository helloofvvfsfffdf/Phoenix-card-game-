/* Phoenix - announcements tests
 * ---------------------------------------------------------------------------
 * Two halves, neither of which touches the live Supabase project or any remote
 * host.
 *
 *   1. PURE RULES  - js/announcements.js cleanBody(), the sanitising that
 *      decides whether a post is a post at all.
 *
 *   2. FULL STACK  - a real `node server.js` talking to a local stand-in for
 *      Supabase's PostgREST endpoint that ENFORCES what the real database
 *      enforces (see sql/announcements.sql). This proves over HTTP that:
 *          - anyone may READ the announcements, nobody needs a session to
 *          - ONLY the owner may post, and a player gets the same refusal
 *            whatever they send
 *          - an empty or over-long post is refused
 *          - the newest post is the one the menu shows, and posts older than
 *            the window are never returned
 *          - the payload carries only an id for the post, its words and a date
 *            - never an account id, a username, the service-role key or a
 *            password
 *          - the database itself refuses a non-owner insert
 *          - taking a post down needs a session, and the owner's role: a player
 *            is refused whether or not the id is a real one, an id that is not
 *            an announcement's is refused, and an id that names nothing is
 *            reported as such rather than passing for a success
 *          - with the migration not deployed, the API degrades instead of 500ing
 *
 *     node tests/announcement-tests.js
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

const ROOT = path.join(__dirname, '..');
const Announcements = require(path.join(ROOT, 'js', 'announcements.js'));

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
  console.log('\nAnnouncement tests: ' + passed + ' passed, ' + failures.length + ' failed');
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
  return test('a post is trimmed and its runs of whitespace collapsed', () => {
    assert.strictEqual(Announcements.cleanBody('  Hello   there \n\n  '), 'Hello there');
    assert.strictEqual(Announcements.cleanBody('\n\tPhoenix rises  \r\n'), 'Phoenix rises');
  })
    .then(() => test('a post of nothing but spaces is not a post', () => {
      assert.strictEqual(Announcements.cleanBody('     '), '');
      assert.strictEqual(Announcements.cleanBody('\n\n\t'), '');
      assert.strictEqual(Announcements.cleanBody(''), '');
    }))
    .then(() => test('anything that is not text is not a post', () => {
      [undefined, null, 42, {}, [], true].forEach(value => {
        assert.strictEqual(Announcements.cleanBody(value), '',
          'refused: ' + JSON.stringify(value));
      });
    }))
    .then(() => test('the archive window is 30 days and posts are capped at 400', () => {
      assert.strictEqual(Announcements.WINDOW_DAYS, 30);
      assert.strictEqual(Announcements.MAX_LENGTH, 400);
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

function tableMissing(res) {
  json(res, 409, {
    code: 'PGRST205',
    message: 'Could not find the table(s) public.announcements in the schema cache',
    details: null, hint: null
  });
}

/**
 * A local stand-in for PostgREST.
 *
 * It holds accounts, sessions and announcements, and it enforces the two
 * things the real database enforces so mistakes surface HERE rather than in
 * production: the body length check, and the trigger that only lets the owner
 * account write an announcement.
 */
function startFakeSupabase() {
  const state = {
    accounts: [],
    sessions: [],
    announcements: [],
    // Lets a test simulate "the migration has not been run".
    hideTable: false
  };

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
      // ISO timestamps compare correctly as plain strings.
      if (f.op === 'gte') return String(row[f.col]) >= String(f.val);
      if (f.op === 'lte') return String(row[f.col]) <= String(f.val);
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

    /* ---- accounts / sessions (so a real sign-in can happen) --------- */
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

    /* ---- announcements --------------------------------------------- */
    if (p === '/rest/v1/announcements') {
      if (state.hideTable) return tableMissing(res);

      if (req.method === 'GET') {
        return json(res, 200, state.announcements.filter(r => matches(r, filters(url))));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);

        // announcements_body_length
        const length = String(body.body || '').length;
        if (!(length >= 1 && length <= 400)) {
          return json(res, 409, { code: '23514',
            message: 'new row for relation "announcements" violates check constraint "announcements_body_length"' });
        }

        // announcement_author_only - the BEFORE INSERT trigger. The role is
        // read from accounts, exactly as the real one does it.
        const acct = state.accounts.find(a => a.id === body.account_id);
        if (!acct || acct.role !== 'owner') {
          return json(res, 403, 'announcements may only be written by the owner');
        }

        const row = { id: crypto.randomUUID(), account_id: String(body.account_id),
                      body: String(body.body), created_at: new Date().toISOString() };
        state.announcements.push(row);
        return json(res, 201, wantsRows(req) ? [row] : {});
      }
      if (req.method === 'DELETE') {
        // PostgREST removes by filter and answers with the rows it removed
        // when representation is asked for - which is how the app learns
        // whether that id named anything, rather than hoping it did. The id
        // arrives in PostgREST's own `eq.` form, exactly as filters() reads it
        // for every other operation.
        const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
        const at = state.announcements.findIndex(r => r.id === id);
        if (at < 0) return json(res, 200, wantsRows(req) ? [] : {});
        const row = state.announcements.splice(at, 1)[0];
        return json(res, 200, wantsRows(req) ? [row] : {});
      }
    }

    /* ---- test-only helpers ----------------------------------------- */
    if (p === '/__promote' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      if (acct) acct.role = 'owner';
      return json(res, 200, { ok: !!acct });
    }
    // Backdate a post, to prove the 30-day window is a rule and not a hope.
    if (p === '/__seed' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      state.announcements.push({
        id: crypto.randomUUID(),
        account_id: acct ? acct.id : 'nobody',
        body: String(body.body),
        created_at: new Date(Date.now() - Number(body.daysAgo || 0) * 864e5).toISOString()
      });
      return json(res, 200, { ok: true });
    }
    if (p === '/__dump' && req.method === 'GET') {
      return json(res, 200, {
        accounts: state.accounts.map(a => ({ id: a.id, username: a.username, role: a.role })),
        announcements: state.announcements,
        hideTable: state.hideTable
      });
    }
    if (p === '/__hide-announcements' && req.method === 'POST') {
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
        PHOENIX_STATE_FILE: legacyFixture.openState('phoenix-announce-')
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
    .then(app => {
      const session = { cookie: null, ownerCookie: null, owner: null };

      function signIn(username, password) {
        return call(appPort, 'POST', '/api/register', { username, password }).then(res => {
          const raw = res.setCookie.find(c => /^phoenix_session=/.test(c)) || '';
          return { cookie: raw.split(';')[0], res };
        });
      }

      /** The id the archive gives to a named post, so a test can point at one. */
      function idOf(body) {
        return call(appPort, 'GET', '/api/announcements').then(r => {
          const row = r.body.announcements.find(a => a.body === body);
          assert.ok(row, 'the post "' + body + '" is still in the archive');
          return row.id;
        });
      }

      return test('reading announcements needs no session at all', () =>
        call(appPort, 'GET', '/api/announcements').then(r => {
          assert.strictEqual(r.status, 200, JSON.stringify(r.body));
          assert.strictEqual(r.body.ok, true);
          assert.strictEqual(r.body.available, true);
          assert.deepStrictEqual(r.body.announcements, [],
            'nothing has been posted yet');
          assert.strictEqual(r.body.windowDays, 30);
        })
      )
        .then(() => test('posting requires a session', () =>
          call(appPort, 'POST', '/api/announcements', { body: 'Hello' }).then(r => {
            assert.strictEqual(r.status, 401);
            assert.strictEqual(r.body.ok, false);
          })
        ))
        .then(() => test('a player can sign in, and stays a player', () =>
          signIn('alice', 'correct-horse-battery').then(s => {
            session.cookie = s.cookie;
            assert.ok(s.cookie, 'session cookie was set');
            return fakeState.dump();
          }).then(d => {
            assert.strictEqual(d.body.accounts.find(a => a.username === 'alice').role, 'player');
          })
        ))
        .then(() => test('a NON-OWNER cannot post an announcement', () =>
          call(appPort, 'POST', '/api/announcements',
            { body: 'I am definitely the owner' }, session.cookie).then(r => {
              assert.strictEqual(r.status, 403);
              assert.strictEqual(r.body.message,
                'Only the owner of PHOENIX can post announcements.');
              return fakeState.dump();
            }).then(d => {
              assert.deepStrictEqual(d.body.announcements, [],
                'and nothing was written');
            })
        ))
        .then(() => test('the owner signs in without any owner password', () =>
          signIn('sovereign', 'another-good-passphrase').then(s => {
            session.ownerCookie = s.cookie;
            return fakeState.api('/__promote', { username: 'sovereign' });
          }).then(r => {
            assert.strictEqual(r.body.ok, true);
            return fakeState.dump();
          }).then(d => {
            // There is no owner password on this route at all: the role comes
            // from accounts.role, read through the session cookie.
            session.owner = d.body.accounts.find(a => a.username === 'sovereign');
            assert.strictEqual(session.owner.role, 'owner');
          })
        ))
        .then(() => test('an owner post is accepted and answers with words and a date', () =>
          call(appPort, 'POST', '/api/announcements',
            { body: '  Season   two begins  tonight.  ' }, session.ownerCookie).then(r => {
              assert.strictEqual(r.status, 200, JSON.stringify(r.body));
              assert.strictEqual(r.body.ok, true);
              assert.strictEqual(r.body.announcement.body, 'Season two begins tonight.',
                'whitespace is tidied server-side');
              assert.ok(!isNaN(Date.parse(r.body.announcement.createdAt)),
                'the server stamps the time');
              assert.deepStrictEqual(Object.keys(r.body.announcement).sort(),
                ['body', 'createdAt'],
                'nothing but the words and the date ever leaves the server');
            })
        ))
        .then(() => test('the newest post is the one the menu would show', () =>
          call(appPort, 'GET', '/api/announcements').then(r => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.announcements.length, 1);
            assert.strictEqual(r.body.announcements[0].body, 'Season two begins tonight.');
          })
        ))
        .then(() => test('a second post moves to the front, oldest behind it', () =>
          call(appPort, 'POST', '/api/announcements',
            { body: 'Maintenance at 3am.' }, session.ownerCookie).then(() =>
              call(appPort, 'GET', '/api/announcements')
            ).then(r => {
              assert.deepStrictEqual(r.body.announcements.map(a => a.body),
                ['Maintenance at 3am.', 'Season two begins tonight.'],
                'newest first, every time');
            })
        ))
        .then(() => test('an empty or whitespace-only post is refused', () =>
          call(appPort, 'POST', '/api/announcements', { body: '   ' }, session.ownerCookie)
            .then(r => {
              assert.strictEqual(r.status, 400);
              assert.strictEqual(r.body.message, 'Write something first.');
              return call(appPort, 'POST', '/api/announcements', {}, session.ownerCookie);
            })
            .then(r => {
              assert.strictEqual(r.status, 400, 'a missing body is not a post either');
            })
        ))
        .then(() => test('a post over the limit is refused', () =>
          call(appPort, 'POST', '/api/announcements',
            { body: 'x'.repeat(401) }, session.ownerCookie).then(r => {
              assert.strictEqual(r.status, 400);
              assert.strictEqual(r.body.message, 'Announcements are limited to 400 characters.');
            })
        ))
        .then(() => test('a post 400 characters long is still accepted', () =>
          call(appPort, 'POST', '/api/announcements',
            { body: 'x'.repeat(400) }, session.ownerCookie).then(r => {
              assert.strictEqual(r.status, 200, JSON.stringify(r.body));
            })
        ))
        .then(() => test('the archive shows the last 30 days and nothing older', () =>
          Promise.all([
            fakeState.api('/__seed', { username: 'sovereign', body: 'From 29 days ago', daysAgo: 29 }),
            fakeState.api('/__seed', { username: 'sovereign', body: 'From 60 days ago', daysAgo: 60 })
          ]).then(() => call(appPort, 'GET', '/api/announcements')).then(r => {
            const bodies = r.body.announcements.map(a => a.body);
            assert.ok(bodies.includes('From 29 days ago'), 'still inside the window');
            assert.strictEqual(bodies.includes('From 60 days ago'), false,
              'the window is a rule, not a hope');
            assert.strictEqual(r.body.windowDays, 30);
          })
        ))
        .then(() => test('the payload carries no account, no username and no secret', () =>
          fakeState.dump().then(d => {
            const ownerId = session.owner.id;
            return call(appPort, 'GET', '/api/announcements').then(r => {
              const text = JSON.stringify(r.body);
              assert.strictEqual(text.includes(ownerId), false, 'no account row travels');
              assert.strictEqual(text.includes('sovereign'), false, 'no author is named');
              assert.strictEqual(text.includes('account_id'), false);
              assert.strictEqual(text.includes('service_role'), false);
              assert.strictEqual(text.includes('password'), false);
            });
          })
        ))
        .then(() => test('the database itself refuses a non-owner insert', () =>
          fakeState.dump().then(d => {
            const alice = d.body.accounts.find(a => a.username === 'alice');
            // Straight at PostgREST, bypassing the app entirely - the trigger
            // is what stands between a bug and a non-owner post.
            return call(fakeState.port, 'POST', '/rest/v1/announcements',
              { account_id: alice.id, body: 'Written behind the server\'s back' })
              .then(r => {
                assert.strictEqual(r.status, 403);
                return fakeState.dump();
              });
          }).then(d => {
            assert.strictEqual(
              d.body.announcements.some(a => /behind the server/.test(a.body)), false);
          })
        ))
        .then(() => test('the archive names each post with an id and adds nothing else', () =>
          call(appPort, 'GET', '/api/announcements').then(r => {
            const one = r.body.announcements[0];
            assert.ok(Announcements.isAnnouncementId(one.id),
              'an id in the shape an announcement id has');
            assert.deepStrictEqual(Object.keys(one).sort(), ['body', 'createdAt', 'id'],
              'the id names the post, and brings no account, role or author with it');
          })
        ))
        .then(() => test('taking a post down needs a session, exactly like posting', () =>
          idOf('Maintenance at 3am.')
            .then(id => call(appPort, 'DELETE', '/api/announcements?id=' + id))
            .then(r => {
              assert.strictEqual(r.status, 401);
              assert.strictEqual(r.body.ok, false);
              return fakeState.dump();
            })
            .then(d => {
              assert.ok(d.body.announcements.some(a => a.body === 'Maintenance at 3am.'),
                'and nothing was removed');
            })
        ))
        .then(() => test('a player cannot take a post down', () =>
          idOf('Maintenance at 3am.')
            .then(id => call(appPort, 'DELETE', '/api/announcements?id=' + id,
                             null, session.cookie))
            .then(r => {
              assert.strictEqual(r.status, 403);
              assert.strictEqual(r.body.message,
                'Only the owner of PHOENIX can delete announcements.');
              return fakeState.dump();
            })
            .then(d => {
              // The role is read before the id is, so a player gets the same
              // answer whether the id is a real one or a guess.
              assert.ok(d.body.announcements.some(a => a.body === 'Maintenance at 3am.'),
                'and the post is untouched');
            })
        ))
        .then(() => test('an id that is not an announcement id is refused', () =>
          call(appPort, 'DELETE', '/api/announcements?id=42', null, session.ownerCookie)
            .then(r => {
              assert.strictEqual(r.status, 400);
              assert.strictEqual(r.body.message, 'That is not an announcement.');
              return fakeState.dump();
            })
            .then(d => {
              assert.ok(d.body.announcements.some(a => a.body === 'Maintenance at 3am.'),
                'nothing went near the database');
            })
        ))
        .then(() => test('an id that names nothing is reported, not passed off as a delete', () =>
          call(appPort, 'DELETE', '/api/announcements?id=' + crypto.randomUUID(),
               null, session.ownerCookie).then(r => {
            assert.strictEqual(r.status, 404);
            assert.strictEqual(r.body.ok, false);
            assert.strictEqual(r.body.message, 'That announcement is no longer here.');
          })
        ))
        .then(() => test('the owner takes one announcement down, and only that one', () =>
          idOf('Maintenance at 3am.')
            .then(id => call(appPort, 'DELETE', '/api/announcements?id=' + id,
                             null, session.ownerCookie))
            .then(r => {
              assert.strictEqual(r.status, 200, JSON.stringify(r.body));
              assert.strictEqual(r.body.ok, true);
              return fakeState.dump();
            })
            .then(d => {
              assert.strictEqual(
                d.body.announcements.some(a => a.body === 'Maintenance at 3am.'), false,
                'it is gone from the table');
              assert.ok(d.body.announcements.some(a => a.body === 'Season two begins tonight.'),
                'every other post is still where it was');
              return call(appPort, 'GET', '/api/announcements');
            })
            .then(r => {
              assert.strictEqual(
                r.body.announcements.some(a => a.body === 'Maintenance at 3am.'), false,
                'and gone from the archive the menu reads');
              assert.ok(r.body.announcements.some(a => a.body === 'Season two begins tonight.'));
            })
        ))
        .then(() => test('with the migration not deployed the API degrades, never 500s', () =>
          fakeState.api('/__hide-announcements', { value: true })
            .then(() => call(appPort, 'GET', '/api/announcements'))
            .then(r => {
              assert.notStrictEqual(r.status, 500);
              assert.strictEqual(r.body.available, false,
                'unavailable, not an error the visitor has to understand');
            })
            .then(() => call(appPort, 'POST', '/api/announcements',
              { body: 'Anything' }, session.ownerCookie))
            .then(r => {
              assert.notStrictEqual(r.status, 500);
              assert.strictEqual(r.body.available, false);
            })
            .then(() => call(appPort, 'DELETE',
              '/api/announcements?id=' + crypto.randomUUID(), null, session.ownerCookie))
            .then(r => {
              assert.notStrictEqual(r.status, 500, 'deleting degrades the same way');
              assert.strictEqual(r.body.available, false);
            })
            .then(() => fakeState.api('/__hide-announcements', { value: false }))
        ))
        .then(() => test('the server logged no announcement errors during the run', () => {
          assert.strictEqual(/\[PHOENIX announcements\]/.test(app.output()), false,
            'unexpected announcement error in the server log:\n' + app.output().split('\n')
              .filter(l => l.includes('[PHOENIX announcements]')).join('\n'));
        }))
        .then(() => {
          app.child.kill();
          return fakeState.close();
        });
    });
}

runRules()
  .then(runStack)
  .then(finish)
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
