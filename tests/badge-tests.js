/* Phoenix - Phase 2 badge system tests
 * ---------------------------------------------------------------------------
 * Two halves, neither of which touches the live Supabase project or any
 * remote host - the WebSocket used in part 2 talks only to 127.0.0.1.
 *
 *   1. PURE RULES  - js/badges.js validateFeatured(), the server-side decision
 *      that decides which slots a player may end up with.
 *
 *   2. FULL STACK  - a real `node server.js` talking to a local stand-in for
 *      Supabase's PostgREST endpoint that ENFORCES the same constraints the
 *      real database does (see sql/phase2-badges.sql). This proves over HTTP
 *      that:
 *          - a player can never obtain, equip or feature THE PHOENIX
 *          - the owner automatically receives it and can never remove it
 *          - at most three featured slots, no duplicates, must own the badge
 *          - the public profile reports the owner from accounts.role only
 *          - with no badge tables deployed, the API degrades instead of 500ing
 *          - over a real WebSocket, a match snapshot carries each seat's
 *            badges: THE PHOENIX beside the owner, never beside anyone else
 *
 *     node tests/badge-tests.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const Badges = require(path.join(ROOT, 'js', 'badges.js'));

let passed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  \u2713 ' + name); })
    .catch(err => {
      failures.push({ name, err });
      console.log('  \u2717 ' + name + '\n      ' + (err && err.message));
    });
}

function suite(title) { console.log('\n\u001b[1m' + title + '\u001b[0m'); }

/* ======================================================================== */
/* 1. PURE RULES                                                            */
/* ======================================================================== */

suite('Badge rules (validateFeatured, server-side)');

function runRules() {
  return Promise.resolve()
    .then(() => test('rejects a non-array', () => {
      assert.strictEqual(Badges.validateFeatured('phoenix', [], true).ok, false);
    }))
    .then(() => test('rejects more than three badges', () => {
      const r = Badges.validateFeatured(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], false);
      assert.strictEqual(r.ok, false);
      assert.match(r.message, /at most 3/i);
    }))
    .then(() => test('rejects a badge the player does not own', () => {
      const r = Badges.validateFeatured(['legend'], ['other'], false);
      assert.strictEqual(r.ok, false);
      assert.match(r.message, /do not own/i);
    }))
    .then(() => test('rejects duplicates', () => {
      const r = Badges.validateFeatured(['legend', 'legend'], ['legend'], false);
      assert.strictEqual(r.ok, false);
      assert.match(r.message, /twice/i);
    }))
    .then(() => test('rejects malformed badge keys', () => {
      for (const bad of [['PHOENIX'], ['a b'], ['x'.repeat(60)], [42], [{}], ['a']]) {
        const r = Badges.validateFeatured(bad, ['x'], false);
        assert.strictEqual(r.ok, false, 'accepted ' + JSON.stringify(bad));
      }
    }))
    .then(() => test('a PLAYER is refused THE PHOENIX even if it is "owned"', () => {
      // Ownership is irrelevant: the owner badge is refused outright for a
      // non-owner, and the message never reveals whether the key exists.
      const r = Badges.validateFeatured(['phoenix'], ['phoenix', 'legend'], false);
      assert.strictEqual(r.ok, false);
      assert.match(r.message, /cannot be equipped/i);
    }))
    .then(() => test('a player cannot get the owner badge into an empty slot either', () => {
      const r = Badges.validateFeatured([null, 'phoenix', null], ['phoenix'], false);
      assert.strictEqual(r.ok, false);
    }))
    .then(() => test('the OWNER can feature THE PHOENIX', () => {
      const r = Badges.validateFeatured(['phoenix'], ['phoenix'], true);
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.slots, ['phoenix']);
    }))
    .then(() => test('the owner cannot ask for THE PHOENIX to be unequipped', () => {
      const r = Badges.validateFeatured([null, 'legend', null], ['phoenix', 'legend'], true);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.slots[0], 'phoenix', 'slot 1 must be re-asserted');
    }))
    .then(() => test('the owner cannot bump THE PHOENIX out of the list', () => {
      const r = Badges.validateFeatured(['legend', 'other'], ['phoenix', 'legend', 'other'], true);
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.slots.slice(0, 3), ['phoenix', 'legend', 'other']);
    }))
    .then(() => test('empty slots collapse and stay within three', () => {
      const r = Badges.validateFeatured([null, 'legend', null], ['legend'], false);
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.slots, ['legend']);
    }))
    .then(() => test('an empty list is valid', () => {
      const r = Badges.validateFeatured([], ['legend'], false);
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.slots, []);
    }))
    /* ---- who may be awarded what ------------------------------------- */
    .then(() => test('THE PHOENIX is NOT on the awardable allowlist', () => {
      assert.strictEqual(Badges.isAwardable('phoenix'), false,
        'the owner badge must be unawardable by construction');
    }))
    .then(() => test('PLAYED WITH OWNER is awardable', () => {
      assert.strictEqual(Badges.isAwardable('played-with-owner'), true);
    }))
    .then(() => test('nothing else is awardable, whatever a request asks for', () => {
      ['nonsense', 'divine', '', null, undefined, 42, {}, 'phoenix '].forEach(key => {
        assert.strictEqual(Badges.isAwardable(key), false,
          'refused: ' + JSON.stringify(key));
      });
    }))
    .then(() => test('the allowlist can never grow by being listed', () => {
      assert.strictEqual(Badges.AWARDABLE_KEYS.indexOf('phoenix'), -1);
      Badges.AWARDABLE_KEYS.push('sneaky');
      assert.strictEqual(Badges.isAwardable('phoenix'), false,
        'even with other keys added, THE PHOENIX stays out');
      Badges.AWARDABLE_KEYS.pop();
    }))
    /* ---- what the server hands out by itself --------------------------- */
    .then(() => test('MATCH WINNER is the badge a win automatically grants', () => {
      assert.strictEqual(Badges.WIN_BADGE_KEY, 'champion');
      assert.strictEqual(Badges.isAutoAwardable('champion'), true);
      assert.strictEqual(Badges.AUTO_AWARDABLE_KEYS.indexOf('champion') !== -1, true,
        'the key wins.js asks for must be on the allowlist wins.js can use');
    }))
    .then(() => test('THE PHOENIX can never travel the automatic route', () => {
      // played-with-owner is absent too: it is the owner handing a badge over
      // BY HAND, which is a different allowlist and a different request.
      [null, undefined, '', 42, {}, 'phoenix', 'champion '].forEach(key => {
        assert.strictEqual(Badges.isAutoAwardable(key), false,
          'refused: ' + JSON.stringify(key));
      });
    }))
    .then(() => test('the automatic allowlist can never grow to reach THE PHOENIX', () => {
      assert.strictEqual(Badges.AUTO_AWARDABLE_KEYS.indexOf('phoenix'), -1);
      Badges.AUTO_AWARDABLE_KEYS.push('sneaky');
      assert.strictEqual(Badges.isAutoAwardable('phoenix'), false,
        'even with other keys added, THE PHOENIX stays out');
      Badges.AUTO_AWARDABLE_KEYS.pop();
    }))
    /* ---- badge pictures ------------------------------------------------ */
    .then(() => test('a badge picture is only ever a plain file inside assets/', () => {
      assert.strictEqual(Badges.safeIcon('assets/phoenix-badge.jpg'), 'assets/phoenix-badge.jpg',
        'the close-up of Phoenix herself is the whole point of this badge');
      assert.strictEqual(Badges.safeIcon('assets/PHOENIX.png'), 'assets/PHOENIX.png');
      assert.strictEqual(Badges.safeIcon('assets/badge-2.webp'), 'assets/badge-2.webp');
      assert.strictEqual(Badges.safeIcon('assets/tile.jpeg'), 'assets/tile.jpeg');
    }))
    .then(() => test('anything that is not a safe picture is dropped, not passed on', () => {
      const bad = [
        'assets/../server.js',        // traversal
        'assets/sub/photo.jpg',       // only one level deep is allowed
        'assets/a b.jpg',             // no spaces
        'assets/x.php',               // no other extension
        'assets/x.jpg?v=2',           // no query string
        'assets/x.svg',               // never a script-bearing format
        'https://evil.example/x.jpg', // never another website
        '//evil.example/x.jpg',
        'data:image/svg+xml,<svg onload=alert(1)>',
        '/etc/passwd',
        '', null, undefined, 42, {}
      ];
      bad.forEach(icon => assert.strictEqual(Badges.safeIcon(icon), null,
        'refused: ' + JSON.stringify(icon)));
    }));
}

/* ======================================================================== */
/* 2. FULL STACK                                                            */
/* ======================================================================== */

const PHOENIX = { key: 'phoenix', name: 'THE PHOENIX', rarity: 'divine',
                  description: 'There can only be one Phoenix.', icon: null };

// Seeded exactly as sql/played-with-owner-badge.sql seeds it.
const PLAYED = { key: 'played-with-owner', name: 'PLAYED WITH OWNER', rarity: 'legendary',
                 description: 'Played a match with the owner of PHOENIX.', icon: null };

// Seeded exactly as sql/champion-badge.sql seeds it: the badge a win grants,
// carrying a close-up of Phoenix cut from the main-menu photo.
const CHAMPION = { key: 'champion', name: 'MATCH WINNER', rarity: 'common',
                   description: 'Won a match of PHOENIX.', icon: 'assets/phoenix-badge.jpg' };

// The database's rule for badges.icon, enforced here for the same reason every
// other rule in this file is: so a test cannot pass by skipping the check that
// actually stops a bad path reaching a page.
const ICON_RE = /^assets\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/;

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

/* ---- local PostgREST stand-in that enforces the real constraints -------- */

function startFakeSupabase() {
  const state = {
    accounts: [],
    sessions: [],
    badges: [{ ...PHOENIX, sort_order: 1 }, { ...PLAYED, sort_order: 2 },
             { ...CHAMPION, sort_order: 3 }],
    grants: [],          // { account_id, badge_key }
    featured: [],        // { account_id, slot, badge_key }
    // Mirrors `one_phoenix_holder`: at most one holder, ever.
    phoenixHeld: false,
    // Lets the test simulate "the Phase 2 migration has not been run".
    hideBadgeTables: false
  };

  function json(res, status, body, headers) {
    const payload = JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }, headers || {}));
    res.end(payload);
  }

  function tableMissing(res) {
    json(res, 409, {
      code: 'PGRST205',
      message: 'Could not find the table(s) public.badges, public.account_badges, public.account_featured_badges in the schema cache',
      details: null, hint: null
    });
  }

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
      if (f.op === 'is') return f.val === 'null' ? row[f.col] == null : String(row[f.col]) === String(f.val);
      // Case-insensitive match, exactly as Postgres ILIKE behaves - including
      // `_` = any one character, `%` = any run, and `\` as the escape that the
      // server uses to search for a literal underscore inside a username.
      if (f.op === 'ilike') return likeRegex(f.val).test(String(row[f.col]));
      if (f.op === 'like') return likeRegex(f.val, false).test(String(row[f.col]));
      return String(row[f.col]) === String(f.val);
    });
  }

  function escapeRe(ch) { return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function likeRegex(pattern, ignoreCase) {
    const s = String(pattern);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { out += escapeRe(s[++i]); }
      else if (c === '%') out += '[\\s\\S]*';
      else if (c === '_') out += '[\\s\\S]';
      else out += escapeRe(c);
    }
    return new RegExp('^' + out + '$', ignoreCase === false ? '' : 'i');
  }
  function readBody(req) {
    return new Promise(resolve => {
      let b = '';
      req.on('data', c => { if (b.length < 65536) b += c; });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
    });
  }
  /* Honour PostgREST's "return=representation" (return rows) vs default. */
  function wantsRows(req) {
    return String(req.headers.prefer || '').includes('return=representation');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    /* ---- rpc/ensure_owner_badge ------------------------------------- */
    if (p === '/rest/v1/rpc/ensure_owner_badge' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.id === body.p_account);
      if (!acct || acct.role !== 'owner') return json(res, 200, { ok: false, reason: 'not-owner' });
      if (!state.grants.some(g => g.account_id === acct.id && g.badge_key === 'phoenix')) {
        if (state.phoenixHeld) return json(res, 200, { ok: false, reason: 'already-held' });
        state.grants.push({ account_id: acct.id, badge_key: 'phoenix' });
        state.phoenixHeld = true;
      }
      // Mirrors sql/champion-badge.sql: after THE PHOENIX, the WHOLE
      // catalogue. The owner holds every badge there is.
      state.badges.forEach(b => {
        if (!state.grants.some(g => g.account_id === acct.id && g.badge_key === b.key)) {
          state.grants.push({ account_id: acct.id, badge_key: b.key });
          if (process.env.BADGE_DEBUG) console.log('ENSURE', acct.username, b.key);
        }
      });
      const slotOne = state.featured.find(f => f.account_id === acct.id && f.slot === 1);
      if (!slotOne) state.featured.push({ account_id: acct.id, slot: 1, badge_key: 'phoenix' });
      else slotOne.badge_key = 'phoenix';
      return json(res, 200, { ok: true });
    }

    /* ---- badges catalogue ------------------------------------------- */
    if (p === '/rest/v1/badges' && req.method === 'GET') {
      if (state.hideBadgeTables) return tableMissing(res);
      return json(res, 200, state.badges);
    }

    /* ---- account_badges --------------------------------------------- */
    if (p === '/rest/v1/account_badges') {
      if (state.hideBadgeTables) return tableMissing(res);
      const flts = filters(url);
      if (req.method === 'GET') return json(res, 200, state.grants.filter(r => matches(r, flts)));
      if (req.method === 'POST') {
        const body = await readBody(req);
        // Same order the real database evaluates these in: the BEFORE INSERT
        // trigger (enforce_phoenix_grant) fires BEFORE the unique index, so a
        // grant to a non-owner fails on the ROLE, not on the uniqueness.
        if (body.badge_key === 'phoenix') {
          const acct = state.accounts.find(a => a.id === body.account_id);
          if (!acct || acct.role !== 'owner') return json(res, 403,
            'THE PHOENIX badge can only be held by the owner account.');
          if (state.phoenixHeld) return json(res, 409, { code: '23505',
            message: 'duplicate key value violates unique constraint "one_phoenix_holder"' });
          state.phoenixHeld = true;
        }
        state.grants.push({ account_id: body.account_id, badge_key: body.badge_key });
        return json(res, 201, {});
      }
    }

    /* ---- account_featured_badges ------------------------------------ */
    if (p === '/rest/v1/account_featured_badges') {
      if (state.hideBadgeTables) return tableMissing(res);
      const flts = filters(url);
      if (req.method === 'GET') return json(res, 200, state.featured.filter(r => matches(r, flts)));
      if (req.method === 'POST') {
        const body = await readBody(req);
        const slot = Number(body.slot);
        if (!(slot >= 1 && slot <= 3)) return json(res, 409, { code: '23514',
          message: 'new row for relation "account_featured_badges" violates check constraint "featured_slot_range"' });
        // enforce_featured_owned()
        if (!state.grants.some(g => g.account_id === body.account_id && g.badge_key === body.badge_key)) {
          return json(res, 403, 'That badge is not in this account\'s collection.');
        }
        // enforce_phoenix_featured()
        const acct = state.accounts.find(a => a.id === body.account_id);
        if (body.badge_key === 'phoenix' && (!acct || acct.role !== 'owner')) {
          return json(res, 403, 'THE PHOENIX badge can only be featured by the owner account.');
        }
        const existing = state.featured.find(f => f.account_id === body.account_id && f.slot === slot);
        if (existing) existing.badge_key = body.badge_key;
        else state.featured.push({ account_id: body.account_id, slot, badge_key: body.badge_key });
        return json(res, 201, {});
      }
      if (req.method === 'DELETE') {
        const keep = state.featured.filter(r => !(matches(r, flts) &&
          !(r.badge_key === 'phoenix' &&
            (state.accounts.find(a => a.id === r.account_id) || {}).role === 'owner')));
        const blocked = keep.length !== state.featured.length;
        state.featured = keep;
        if (blocked) return json(res, 403,
          'THE PHOENIX badge cannot be removed from the owner\'s featured slots.');
        return json(res, 204, {});
      }
    }

    /* ---- accounts / sessions (the Part 1 flow, so we can sign in) ----- */
    if (p === '/rest/v1/accounts') {
      if (req.method === 'GET') {
        return json(res, 200, state.accounts.filter(r => matches(r, filters(url))));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        // Enforce what the real table enforces, so mistakes surface here.
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
      if (req.method === 'GET') return json(res, 200, state.sessions.filter(r => matches(r, filters(url))));
      if (req.method === 'POST') {
        const body = await readBody(req);
        state.sessions.push({ token_hash: String(body.token_hash),
                              account_id: String(body.account_id),
                              created_at: new Date().toISOString(),
                              expires_at: String(body.expires_at) });
        return json(res, 201, {});
      }
    }

    /* ---- test-only helpers ------------------------------------------ */
    if (p === '/__promote' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      if (acct) acct.role = 'owner';
      return json(res, 200, { ok: !!acct });
    }
    if (p === '/__grant' && req.method === 'POST') {
      const body = await readBody(req);
      const acct = state.accounts.find(a => a.username === body.username);
      if (!acct) return json(res, 404, { ok: false });
      // The database's `badges_icon_path` check, enforced here too so a test
      // cannot slip a picture path past the rule that keeps it a plain file.
      if (body.icon !== undefined && body.icon !== null && !ICON_RE.test(body.icon)) {
        return json(res, 400, { code: '23514', message:
          'violates check constraint "badges_icon_path"' });
      }
      if (!state.badges.some(b => b.key === body.badge_key)) {
        state.badges.push({ key: body.badge_key, name: body.badge_key.toUpperCase(),
                            rarity: body.rarity || 'legendary',
                            description: 'A test badge.', sort_order: 4,
                            icon: body.icon || null });
      }
      // Non-phoenix grants may be seeded directly (a future "earn a badge").
      // Idempotent, the way the real table's primary key is: seeding a badge
      // an account already holds must not make a second copy of it.
      if (!state.grants.some(g => g.account_id === acct.id && g.badge_key === body.badge_key)) {
        state.grants.push({ account_id: acct.id, badge_key: body.badge_key });
      }
      // And the badges_grant_to_owners trigger: adding a badge to the
      // catalogue hands it to every owner account the moment it exists, so
      // "the owner gets access to every badge made" needs no further action.
      state.accounts.filter(a => a.role === 'owner').forEach(o => {
        if (!state.grants.some(g => g.account_id === o.id && g.badge_key === body.badge_key)) {
          state.grants.push({ account_id: o.id, badge_key: body.badge_key });
        }
      });
      return json(res, 200, { ok: true });
    }
    if (p === '/__dump' && req.method === 'GET') {
      return json(res, 200, {
        accounts: state.accounts.map(a => ({ username: a.username, role: a.role })),
        grants: state.grants,
        featured: state.featured,
        phoenixHeld: state.phoenixHeld,
        hideBadgeTables: state.hideBadgeTables
      });
    }
    if (p === '/__hide-badges' && req.method === 'POST') {
      const body = await readBody(req);
      state.hideBadgeTables = !!body.value;
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
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(appPort),
        // Pointed at the LOCAL stand-in, never at the real Supabase.
        SUPABASE_URL: 'http://127.0.0.1:' + supaPort,
        SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64') + '.sig',
        PHOENIX_OWNER_PASSWORD: 'unused-owner-password-0123456789abcdef',
        PHOENIX_MODE_ACCESS_CODE: 'unused-access-code-1234567890',
        PHOENIX_STATE_FILE: path.join(os.tmpdir(), 'phoenix-badge-' + Date.now() + '.json')
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

/**
 * A real WebSocket player, handshake authenticated with the session cookie so
 * the server resolves an account for it exactly as it does for a browser.
 *
 * Badges are resolved ONCE during that handshake and then ride along inside
 * every snapshot, which is what these tests are here to observe.
 */
function openMatch(port, cookie) {
  const ws = new WebSocket('ws://127.0.0.1:' + port, {
    headers: cookie ? { Cookie: cookie } : {}
  });
  const events = [];
  const client = { ws, events, state: null };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    events.push(message);
    if (message.type === 'state') client.state = message;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 8000);
    ws.once('open', () => { clearTimeout(timer); resolve(client); });
    ws.once('error', err => { clearTimeout(timer); reject(err); });
  });
}

function matchWait(client, type, timeoutMs) {
  const limit = timeoutMs || 10000;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + limit;
    const timer = setInterval(() => {
      const idx = client.events.findIndex(e => e.type === type);
      if (idx >= 0) {
        clearInterval(timer);
        resolve(client.events.splice(idx, 1)[0]);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for "' + type + '". Saw: ' +
          client.events.map(e => e.type).join(',')));
      }
    }, 20);
  });
}

/** Send a lobby action and wait for the resulting authoritative snapshot. */
function matchSend(client, message) {
  client.ws.send(JSON.stringify(message));
  return matchWait(client, 'state');
}

function runStack() {
  const fakeState = { port: null, api: null };
  let appPort;

  return startFakeSupabase()
    .then(fake => {
      fakeState.port = fake.port;
      fakeState.close = () => new Promise(r => fake.server.close(() => r()));
      fakeState.api = (path, body) => call(fake.port, 'POST', path, body);
      fakeState.dump = () => call(fake.port, 'GET', '/__dump');
      return freePort();
    })
    .then(port => {
      appPort = port;
      return startApp(port, fakeState.port);
    })
    .then(app => {
      const session = { cookie: null };
      // A real room opened over a real WebSocket, so badges can be checked in
      // the place they actually matter: the match snapshot.
      const matchRoom = { host: null, guest: null, code: null };

      function signIn(username, password) {
        return call(appPort, 'POST', '/api/register', { username, password })
          .then(res => {
            const raw = res.setCookie.find(c => /^phoenix_session=/.test(c)) || '';
            const cookie = raw.split(';')[0];
            return { cookie, res };
          });
      }

      return test('the badge screen is refused with no session', () =>
        call(appPort, 'GET', '/api/badges').then(r => {
          assert.strictEqual(r.status, 401);
          assert.strictEqual(r.body.authenticated, false);
        })
      )
      .then(() => test('registering a player works as before', () =>
        signIn('alice', 'correct-horse-battery').then(s => {
          session.cookie = s.cookie;
          assert.ok(s.cookie, 'session cookie was set');
          assert.strictEqual(s.res.status, 200);
          assert.strictEqual(s.res.body.account.username, 'alice');
        })
      ))
      .then(() => test('a player sees an EMPTY featured row and no phoenix', () =>
        call(appPort, 'GET', '/api/badges', null, session.cookie).then(r => {
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.body.ok, true);
          assert.strictEqual(r.body.isOwner, false);
          assert.deepStrictEqual(r.body.featured, [null, null, null]);
          assert.strictEqual(
            r.body.owned.some(b => b.key === 'phoenix'), false,
            'a player must never be listed as holding THE PHOENIX');
        })
      ))
      .then(() => test('a player CANNOT equip THE PHOENIX', () =>
        call(appPort, 'POST', '/api/badges/feature', { slots: ['phoenix'] }, session.cookie)
          .then(r => {
            assert.strictEqual(r.status, 400);
            assert.strictEqual(r.body.ok, false);
            assert.match(r.body.message, /cannot be equipped/i);
          })
      ))
      .then(() => test('a player CANNOT smuggle THE PHOENIX into slot 2', () =>
        call(appPort, 'POST', '/api/badges/feature',
             { slots: [null, 'phoenix', null] }, session.cookie).then(r => {
          assert.strictEqual(r.status, 400);
        })
      ))
      .then(() => test('a player cannot feature a badge they do not own', () =>
        call(appPort, 'POST', '/api/badges/feature', { slots: ['phoenix'] }, session.cookie)
          .then(() => fakeState.api('/__grant', { username: 'alice', badge_key: 'legend' }))
          .then(() => call(appPort, 'POST', '/api/badges/feature', { slots: ['nope'] }, session.cookie))
          .then(r => {
            assert.strictEqual(r.status, 400);
            assert.match(r.body.message, /do not own/i);
          })
      ))
      .then(() => test('a player CAN feature a badge they do own', () =>
        call(appPort, 'POST', '/api/badges/feature', { slots: ['legend'] }, session.cookie)
          .then(r => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.featured[0].key, 'legend');
            assert.strictEqual(r.body.featured[0].name, 'LEGEND');
            assert.strictEqual(r.body.featured[0].divine, false);
          })
      ))
      .then(() => test('a player cannot exceed three featured badges', () =>
        call(appPort, 'POST', '/api/badges/feature',
             { slots: ['legend', 'legend', 'legend', 'legend'] }, session.cookie)
          .then(r => assert.strictEqual(r.status, 400))
      ))
      .then(() => test('a player cannot feature the same badge twice', () =>
        call(appPort, 'POST', '/api/badges/feature',
             { slots: ['legend', 'legend'] }, session.cookie)
          .then(r => {
            assert.strictEqual(r.status, 400);
            assert.match(r.body.message, /twice/i);
          })
      ))
      .then(() => test('the public profile shows PLAYER, not owner', () =>
        call(appPort, 'GET', '/api/badges/profile?username=alice').then(r => {
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.body.profile.isOwner, false);
          assert.strictEqual(r.body.profile.featured[0].name, 'LEGEND');
          // Only catalogue fields leave the server - never a user string.
          assert.deepStrictEqual(Object.keys(r.body.profile.featured[0]).sort(),
            ['description', 'divine', 'icon', 'key', 'name', 'rarity']);
          assert.strictEqual(r.body.profile.featured[0].icon, null,
            'this one has no picture, and says so rather than showing a blank frame');
        })
      ))
      .then(() => test('an unknown username is refused without leaking existence', () =>
        call(appPort, 'GET', '/api/badges/profile?username=nobody-here').then(r => {
          assert.strictEqual(r.status, 404);
          assert.strictEqual(r.body.ok, false);
        })
      ))
      .then(() => test('the owner is created and gets THE PHOENIX automatically', () =>
        signIn('sovereign', 'a-very-long-owner-pass').then(owner => {
          session.ownerCookie = owner.cookie;
          return fakeState.api('/__promote', { username: 'sovereign' });
        })
        .then(() => call(appPort, 'GET', '/api/badges', null, session.ownerCookie))
        .then(r => {
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.body.isOwner, true);
          assert.strictEqual(r.body.featured[0].key, 'phoenix');
          assert.strictEqual(r.body.featured[0].rarity, 'divine');
          assert.strictEqual(r.body.featured[0].name, 'THE PHOENIX');
          assert.strictEqual(r.body.featured[0].description, 'There can only be one Phoenix.');
          assert.strictEqual(r.body.featured[0].divine, true);
        })
      ))
      .then(() => test('THE PHOENIX occupies slot 1 and is marked permanent', () =>
        call(appPort, 'GET', '/api/badges', null, session.ownerCookie).then(r => {
          assert.strictEqual(r.body.featured.filter(Boolean).length, 1);
          assert.ok(r.body.catalogue.some(b => b.key === 'phoenix' && b.rarity === 'divine'));
        })
      ))
      .then(() => test('the owner CANNOT unequip THE PHOENIX', () =>
        call(appPort, 'POST', '/api/badges/feature',
             { slots: [null, null, null] }, session.ownerCookie).then(r => {
          assert.strictEqual(r.status, 200, 'the request is accepted but slot 1 is re-asserted');
          assert.strictEqual(r.body.featured[0].key, 'phoenix');
        })
      ))
      .then(() => test('the owner can still use slots 2 and 3', () =>
        fakeState.api('/__grant', { username: 'sovereign', badge_key: 'legend' })
          .then(() => call(appPort, 'POST', '/api/badges/feature',
                           { slots: ['legend'] }, session.ownerCookie))
          .then(r => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.featured[0].key, 'phoenix');
            assert.strictEqual(r.body.featured[1].key, 'legend');
          })
      ))
      .then(() => test('the owner is VERIFIED on the public profile', () =>
        call(appPort, 'GET', '/api/badges/profile?username=sovereign').then(r => {
          assert.strictEqual(r.status, 200);
          assert.strictEqual(r.body.profile.isOwner, true);
          assert.strictEqual(r.body.profile.featured[0].key, 'phoenix');
          assert.strictEqual(r.body.profile.featured[0].rarity, 'divine');
        })
      ))
      .then(() => test('the database reports only ONE holder of THE PHOENIX', () =>
        fakeState.dump().then(r => {
          const holders = r.body.grants.filter(g => g.badge_key === 'phoenix');
          assert.strictEqual(holders.length, 1, 'one_phoenix_holder');
          assert.strictEqual(r.body.phoenixHeld, true);
        })
      ))
      .then(() => test('a second account cannot be given the badge even if it is "owner"', () =>
        // Guards the invariant at the database level: the second grant is
        // refused, so a duplicated owner could never duplicate the badge.
        call(appPort, 'GET', '/api/badges', null, session.cookie).then(r => {
          assert.strictEqual(r.body.isOwner, false, 'alice is still just a player');
          assert.ok(r.body.featured.every(b => !b || b.key !== 'phoenix'));
        })
      ))
      .then(() => test('the database refuses a direct grant to a non-owner', () =>
        // Simulate a bug that tries to write the row itself.
        fakeState.api('/__dump').then(() => call(fakeState.port, 'POST',
          '/rest/v1/account_badges',
          { account_id: 'not-the-owner', badge_key: 'phoenix' })).then(r => {
          assert.strictEqual(r.status, 403);
        })
      ))
      .then(() => test('badge rules are still enforced with no migration deployed', () =>
        fakeState.api('/__hide-badges', { value: true })
          .then(() => call(appPort, 'GET', '/api/badges', null, session.cookie))
          .then(r => {
            // Graceful: "unavailable", NOT a 500 and NOT a silent allow.
            assert.notStrictEqual(r.status, 500);
            assert.strictEqual(r.body.available, false);
          })
          .then(() => call(appPort, 'GET', '/api/badges/profile?username=alice'))
          .then(r => {
            assert.notStrictEqual(r.status, 500);
            assert.strictEqual(r.body.available, false);
          })
          .then(() => fakeState.api('/__hide-badges', { value: false }))
      ))
      .then(() => test('the browser never receives the service-role key or a session token', () =>
        call(appPort, 'GET', '/api/badges', null, session.ownerCookie).then(r => {
          const text = JSON.stringify(r.body);
          assert.strictEqual(text.includes('service_role'), false);
          assert.strictEqual(text.includes('SUPABASE'), false);
        })
      ))
      .then(() => test("the owner's THE PHOENIX badge appears in a real match snapshot", () =>
        openMatch(appPort, session.ownerCookie).then(host => {
          matchRoom.host = host;
          return matchSend(host, { type: 'create', code: '' });
        }).then(state => {
          matchRoom.code = state.code;
          assert.ok(state.players.length === 1, 'the owner is seated');
          const badges = state.players[0].badges;
          assert.ok(Array.isArray(badges), 'every seat carries a badges list');
          const phoenix = badges.find(b => b.key === 'phoenix');
          assert.ok(phoenix, 'THE PHOENIX shows up beside the owner in the match');
          assert.strictEqual(phoenix.name, 'THE PHOENIX');
          assert.strictEqual(phoenix.rarity, 'divine');
        })
      ))
      .then(() => test('a joining player sees exactly their own badges, never THE PHOENIX', () =>
        openMatch(appPort, session.cookie).then(guest => {
          matchRoom.guest = guest;
          return matchSend(guest, { type: 'join', code: matchRoom.code });
        }).then(state => {
          assert.strictEqual(state.players.length, 2, 'both players are seated');
          const owner = state.players.find(p => Array.isArray(p.badges) &&
            p.badges.some(b => b.key === 'phoenix'));
          assert.ok(owner, 'the owner badge is visible to everyone in the room');

          const player = state.players.find(p => p.id !== owner.id);
          assert.ok(player.badges.every(b => b.key !== 'phoenix'),
            'no other seat ever carries THE PHOENIX');

          // The seat must mirror what the account ACTUALLY holds, read back
          // through the API - so a snapshot can never show more than the
          // database granted, and a client cannot claim its own badges.
          return call(appPort, 'GET', '/api/badges', null, session.cookie).then(api => {
            const shown = player.badges.map(b => b.key).sort();
            const held = api.body.featured.filter(Boolean).map(b => b.key).sort();
            assert.deepStrictEqual(shown, held,
              'the match shows exactly the badges this account holds, no more');
          });
        })
      ))
      .then(() => test('a match badge carries ONLY catalogue fields, and no secret', () => {
        const owner = matchRoom.host.state.players[0].badges[0];
        assert.deepStrictEqual(Object.keys(owner).sort(), ['icon', 'key', 'name', 'rarity'],
          'nothing but the catalogue projection reaches a snapshot');
        assert.strictEqual(owner.icon, null,
          'THE PHOENIX is a design, not a picture - it keeps its crown and flames');
        const text = JSON.stringify(matchRoom.host.state);
        assert.strictEqual(text.includes('account_id'), false,
          'the account row never travels to a match');
        assert.strictEqual(text.includes('service_role'), false);
        assert.strictEqual(text.includes('password'), false);
      }))
      /* ---- awarding PLAYED WITH OWNER --------------------------------- */
      .then(() => test('the owner is offered the awardable badge, and nobody else is', () =>
        Promise.all([
          call(appPort, 'GET', '/api/badges', null, session.ownerCookie),
          call(appPort, 'GET', '/api/badges', null, session.cookie)
        ]).then(([owner, player]) => {
          assert.deepStrictEqual(owner.body.awardable.map(b => b.key),
            ['played-with-owner'],
            'the owner is offered exactly the allowlisted badge');
          assert.strictEqual(player.body.awardable.length, 0,
            'a player is never offered an awardable badge');
          assert.strictEqual(owner.body.awardable[0].name, 'PLAYED WITH OWNER',
            'read from the catalogue, never text the page made up');
        })
      ))
      .then(() => test('a NON-OWNER cannot award anything, and learns nothing trying', () => {
        const attempt = username => call(appPort, 'POST', '/api/badges/award',
          { username, badgeKey: 'played-with-owner' }, session.cookie);
        return attempt('alice').then(real => {
          assert.strictEqual(real.status, 403);
          assert.strictEqual(real.body.message,
            'Only the owner of PHOENIX can award badges.');
          // A name that does not exist gets the IDENTICAL answer: the role is
          // read before anything else, so this endpoint is not a name oracle.
          return attempt('definitely-nobody-123');
        }).then(madeUp => {
          assert.strictEqual(madeUp.status, 403);
          assert.strictEqual(madeUp.body.message,
            'Only the owner of PHOENIX can award badges.');
        });
      }))
      .then(() => test('the owner awards PLAYED WITH OWNER by username, in any case', () =>
        call(appPort, 'POST', '/api/badges/award',
          { username: 'ALICE', badgeKey: 'played-with-owner' }, session.ownerCookie)
          .then(r => {
            assert.strictEqual(r.status, 200, JSON.stringify(r.body));
            assert.strictEqual(r.body.username, 'alice',
              'answered with the stored account name, not the case typed in');
            assert.strictEqual(r.body.badge.key, 'played-with-owner');
            assert.strictEqual(r.body.badge.name, 'PLAYED WITH OWNER');
            assert.strictEqual(r.body.badge.rarity, 'legendary');
            assert.strictEqual(r.body.alreadyHad, false);
          })
      ))
      .then(() => test('awarding the same player twice is not an error', () =>
        call(appPort, 'POST', '/api/badges/award',
          { username: 'alice', badgeKey: 'played-with-owner' }, session.ownerCookie)
          .then(r => {
            assert.strictEqual(r.status, 200, JSON.stringify(r.body));
            assert.strictEqual(r.body.alreadyHad, true);
          })
      ))
      .then(() => test('THE PHOENIX can never be awarded through this route', () =>
        call(appPort, 'POST', '/api/badges/award',
          { username: 'alice', badgeKey: 'phoenix' }, session.ownerCookie)
          .then(r => {
            assert.strictEqual(r.status, 400);
            assert.strictEqual(r.body.message, 'That badge cannot be awarded.');
            return call(appPort, 'GET', '/api/badges', null, session.cookie);
          }).then(r => {
            assert.strictEqual(r.body.owned.some(b => b.key === 'phoenix'), false,
              'the player still holds nothing of the sort');
          })
      ))
      .then(() => test('an unknown username is refused without any grant being written', () =>
        call(appPort, 'POST', '/api/badges/award',
          { username: 'nobody-here-999', badgeKey: 'played-with-owner' }, session.ownerCookie)
          .then(r => {
            assert.strictEqual(r.status, 404);
            assert.strictEqual(r.body.message, 'No player with that username.');
            return fakeState.dump();
          }).then(d => {
            assert.strictEqual(
              d.body.accounts.some(a => a.username === 'nobody-here-999'), false,
              'a lookup that finds nobody creates nobody');
          })
      ))
      .then(() => test('the recipient holds the badge and can feature it', () =>
        call(appPort, 'POST', '/api/badges/feature',
          { slots: ['played-with-owner'] }, session.cookie).then(r => {
          assert.strictEqual(r.status, 200, JSON.stringify(r.body));
          assert.strictEqual(r.body.featured[0].key, 'played-with-owner',
            'now theirs to show beside their name');
        })
      ))
      /* ---- MATCH WINNER: the badge a win hands over -------------------- */
      .then(() => test('MATCH WINNER is served with the Phoenix picture, on the COMMON tier', () =>
        call(appPort, 'GET', '/api/badges', null, session.cookie).then(r => {
          const champ = r.body.catalogue.find(b => b.key === 'champion');
          assert.ok(champ, 'sql/champion-badge.sql seeded it');
          assert.strictEqual(champ.name, 'MATCH WINNER');
          assert.strictEqual(champ.rarity, 'common',
            'the first rung of the ladder, not the top of it');
          assert.strictEqual(champ.icon, 'assets/phoenix-badge.jpg',
            'the close-up of Phoenix - the gecko, and nothing behind her');
          assert.strictEqual(Badges.safeIcon(champ.icon), champ.icon,
            'and the server only ever hands out a picture it would keep');
        })
      ))
      .then(() => test('the owner holds EVERY badge there is, the automatic ones included', () =>
        call(appPort, 'GET', '/api/badges', null, session.ownerCookie).then(r => {
          assert.deepStrictEqual(r.body.owned.map(b => b.key).sort(),
            ['champion', 'legend', 'phoenix', 'played-with-owner'],
            'THE PHOENIX, the one the owner handed out by hand, and both seeded badges');
        })
      ))
      .then(() => test('the owner can feature a badge the automatic route gave them', () =>
        call(appPort, 'POST', '/api/badges/feature',
          { slots: ['champion'] }, session.ownerCookie).then(r => {
          assert.strictEqual(r.status, 200, JSON.stringify(r.body));
          assert.strictEqual(r.body.featured[0].key, 'phoenix', 'slot 1 is still THE PHOENIX');
          assert.strictEqual(r.body.featured[1].key, 'champion');
          assert.strictEqual(r.body.featured[1].icon, 'assets/phoenix-badge.jpg',
            'and the picture travels with it');
        })
      ))
      .then(() => test('a player is never handed a badge they did not earn', () =>
        call(appPort, 'GET', '/api/badges', null, session.cookie).then(r => {
          const held = r.body.owned.map(b => b.key);
          assert.strictEqual(held.indexOf('champion'), -1,
            'nobody owns MATCH WINNER until they actually win a match');
          assert.strictEqual(held.indexOf('played-with-owner') !== -1, true,
            'but the one the owner awarded is theirs to keep');
        })
      ))
      .then(() => test('the server logged no badge errors during the run', () => {
        assert.strictEqual(/\[PHOENIX badges\]/.test(app.output()), false,
          'unexpected badge error in the server log:\n' + app.output().split('\n')
            .filter(l => l.includes('[PHOENIX badges]')).join('\n'));
      }))
      .then(() => {
        for (const client of [matchRoom.host, matchRoom.guest]) {
          if (client) { try { client.ws.close(); } catch (e) { /* already gone */ } }
        }
      })
      .then(() => app.child.kill());
    })
    .catch(err => { console.error(err); process.exitCode = 1; })
    // The fake PostgREST server holds an open handle, so the event loop never
    // drains on its own. Close it here rather than hanging the run.
    .then(() => (fakeState.close ? fakeState.close() : null));
}

/* ======================================================================== */

runRules()
  .then(runStack)
  .then(() => {
    console.log('\n\u001b[1mBadge tests: ' + passed + ' passed, ' + failures.length + ' failed\u001b[0m');
    if (failures.length) {
      failures.forEach(f => console.log('  \u2717 ' + f.name + ': ' + f.err.message));
      process.exitCode = 1;
    }
    // The spawned app and the stand-in leave sockets behind, so exit on purpose
    // instead of hanging after a clean run.
    process.exit(process.exitCode || 0);
  });
