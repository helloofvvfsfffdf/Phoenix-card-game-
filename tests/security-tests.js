/* Phoenix - account security, email verification and ban enforcement
 * ---------------------------------------------------------------------------
 * A REAL `node server.js` talking to a local stand-in for Supabase that
 * enforces what the real database enforces - the unique index on a verified
 * address, the check constraints on a restriction row, the audit log - so
 * mistakes surface HERE rather than in production.
 *
 * Nothing reaches the live project and nothing is emailed. Supabase's own
 * email OTP endpoints are stood for locally, which is the point: the server
 * still calls signInWithOtp / verifyOtp through the real supabase-js client,
 * so the flow under test is the flow that runs on Render.
 *
 * What this proves over real HTTP and real WebSockets:
 *
 *   email      a new player cannot create a room until a code arrives
 *   migration  an EXISTING player keeps their account, id, name and badges
 *   codes      wrong, expired and REUSED codes are all refused
 *   bans       temporary, permanent, and a permanent ban lifted in one click
 *   network    a banned address blocks a NEW account and a SECOND device
 *   family     an innocent on the same network is affected, and is told so
 *   cookies    clearing cookies and signing back in changes nothing
 *   owner      an unauthorised account cannot search, issue, lift or read
 *   mid-match  a player banned mid-game is removed and refused every action
 *   regression multiplayer, badges, announcements and wins still work
 *
 *     node tests/security-tests.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { openState } = require('./helpers/legacy-account-fixture');

const ROOT = path.join(__dirname, '..');
const Moderation = require(path.join(ROOT, 'js', 'moderation.js'));

let passed = 0;
const failures = [];
let serverLog = null;

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
  console.log('\nSecurity tests: ' + passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => {
    console.log('\n  FAILED: ' + f.name);
    console.log('  ' + (f.err && f.err.stack || f.err));
  });
  if (failures.length && serverLog) {
    // The server's own voice. Half of a failing assertion is only readable
    // next to the [PHOENIX ...] line that explains it.
    const lines = String(serverLog()).trim().split('\n');
    console.log('\n  ---- server output (last ' + Math.min(40, lines.length) + ' lines) ----');
    lines.slice(-40).forEach(l => console.log('  | ' + l));
  }
  // The spawned server and the fake provider leave open handles behind, so the
  // summary decides when this process is over rather than waiting.
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
/* 1. PURE RULES - addresses, privacy and owner authorisation               */
/* ======================================================================== */

function unitSuite() {
  console.log('\n\u001b[1mAddresses, privacy and owner authorisation\u001b[0m');

  test('IPv4, IPv4-in-IPv6 and IPv6 each normalise to a matchable key', () => {
    assert.deepStrictEqual(Moderation.normalizeIp('203.0.113.9'),
      { text: '203.0.113.9', key: '203.0.113.9', family: 4 });
    // How Node reports an ordinary IPv4 peer on a dual-stack socket. Left
    // alone this would never match a ban written as 203.0.113.9.
    assert.deepStrictEqual(Moderation.normalizeIp('::ffff:203.0.113.9'),
      { text: '203.0.113.9', key: '203.0.113.9', family: 4 });
    assert.deepStrictEqual(Moderation.normalizeIp('127.0.0.1:44321'),
      { text: '127.0.0.1', key: '127.0.0.1', family: 4 });
    // IPv6 is matched at /64, the smallest block a home is routed: an exact
    // address would be defeated by privacy extensions within seconds.
    assert.deepStrictEqual(Moderation.normalizeIp('2001:db8:abcd:12:aa::1'),
      { text: '2001:db8:abcd:12:aa:0:0:1', key: '2001:db8:abcd:12::/64', family: 6 });
  });

  test('a malformed address is discarded, never half-trusted', () => {
    assert.strictEqual(Moderation.normalizeIp('not-an-address'), null);
    assert.strictEqual(Moderation.normalizeIp('999.1.1.1'), null);
    assert.strictEqual(Moderation.normalizeIp(''), null);
    assert.strictEqual(Moderation.normalizeIp(null), null);
    assert.strictEqual(Moderation.normalizeIp('1::2::3'), null);
  });

  test('only a private socket means a proxy is genuinely in front', () => {
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('127.0.0.1')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('10.1.2.3')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('172.16.0.1')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('192.168.1.7')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('::1')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('fe80::1')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('fd12::1')), true);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('8.8.8.8')), false);
    assert.strictEqual(Moderation.isPrivate(Moderation.normalizeIp('2001:db8::1')), false);
  });

  test('an address a CLIENT sent is ignored unless a proxy is actually there', () => {
    const forged = { 'x-forwarded-for': '198.51.100.7' };

    // A public socket: this server faces the internet directly, so nothing in
    // a header is believed. The forged value is discarded outright.
    const direct = { socket: { remoteAddress: '198.51.100.99' }, headers: forged };
    assert.strictEqual(Moderation.trustedIp(direct).text, '198.51.100.99');

    // A private socket: something we trust IS in front, so the header counts -
    // but only the LAST hop, which is the one that proxy appended. Anything a
    // client typed itself sits further left and is never read.
    const behind = { socket: { remoteAddress: '10.0.0.2' },
                     headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.50' } };
    assert.strictEqual(Moderation.trustedIp(behind).text, '203.0.113.50');
  });

  test('a restriction is live only while it is neither revoked nor expired', () => {
    const now = Date.now();
    assert.strictEqual(Moderation.isLive({ expires_at: null, revoked_at: null }, now), true,
      'a permanent ban is live');
    assert.strictEqual(Moderation.isLive(
      { expires_at: new Date(now + 60000).toISOString(), revoked_at: null }, now), true,
      'a future expiry is live');
    assert.strictEqual(Moderation.isLive(
      { expires_at: new Date(now - 60000).toISOString(), revoked_at: null }, now), false,
      'an expiry has passed');
    assert.strictEqual(Moderation.isLive(
      { expires_at: null, revoked_at: new Date().toISOString() }, now), false,
      'a revoked ban is not live, permanent or not');
  });

  test('the player screen leaks no address and no other player', () => {
    const view = Moderation.publicView({
      kind: 'ip', account_id: null, account_name: 'somebody-else',
      ip: '203.0.113.9', reason: 'shared abuse', expires_at: null,
      created_at: '2026-01-01T00:00:00Z'
    }, '11111111-1111-4111-8111-111111111111');

    assert.strictEqual(view.headline, Moderation.BAN_HEADLINE);
    assert.strictEqual(view.scope, 'network');
    assert.strictEqual(view.personal, false,
      'a network ban is flagged as possibly not personal');
    assert.ok(/other people on the same network/.test(view.notice),
      'and it warns that others may be caught too');
    const serialised = JSON.stringify(view);
    assert.ok(!/203\.0\.113\.9/.test(serialised), 'the address is never sent to the player');
    assert.ok(!/somebody-else/.test(serialised), 'nor is anybody else');
  });

  test('an account ban says so plainly and a device ban admits its limits', () => {
    const accountView = Moderation.publicView({
      kind: 'account', account_id: 'a', reason: 'cheating',
      expires_at: '2026-06-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z'
    }, 'a');
    assert.strictEqual(accountView.personal, true);
    assert.strictEqual(accountView.permanent, false);
    assert.ok(accountView.expiresAt, 'a temporary ban shows its expiry');
    assert.strictEqual(accountView.notice, null);

    const deviceView = Moderation.publicView({
      kind: 'device', account_id: null, reason: 'x', expires_at: null, created_at: 'x'
    }, 'a');
    assert.ok(/NOT permanent/.test(deviceView.notice),
      'a device restriction is never described as permanent');
  });

  test('moderation refuses everyone who is not the owner, before reading input', () => {
    assert.strictEqual(Moderation.requireOwner(null).status, 401);
    const player = Moderation.requireOwner({ id: 'x', username: 'josh', role: 'player' });
    assert.strictEqual(player.status, 403);
    assert.ok(/owner/i.test(player.message));
    assert.strictEqual(
      Moderation.requireOwner({ id: 'x', username: 'josh', role: 'owner' }), null);
  });

  test('the dashboard copy never overstates what a device ban can do', () => {
    assert.ok(/cookie/i.test(Moderation.DEVICE_NOTICE));
    assert.ok(/NOT permanent/i.test(Moderation.DEVICE_NOTICE));
    assert.ok(/fingerprint/i.test(Moderation.DEVICE_NOTICE));
    assert.ok(/family members/i.test(Moderation.IP_WARNING),
      'the IP warning names the people it may catch');
  });
}

/* ======================================================================== */
/* 2. FULL STACK                                                            */
/* ======================================================================== */

/**
 * A stand-in for Supabase that ENFORCES the same things the real schema does:
 * one verified address per account, the check constraints on a restriction
 * row, the primary keys on the ledger and the device tables - plus
 * Supabase's own email OTP endpoints, so the flow under test is the real one.
 */
function startFakeSupabase() {
  const uuid = () => crypto.randomUUID();
  const nowIso = () => new Date().toISOString();

  const state = {
    accounts: [], sessions: [], email_verifications: [],
    moderation_bans: [], devices: [], device_accounts: [],
    account_ips: [], signup_attempts: [], moderation_log: [],
    badges: [{ key: 'champion', name: 'MATCH WINNER', rarity: 'common',
               description: 'Won a match of PHOENIX.', sort_order: 3,
               icon: 'assets/phoenix-badge.jpg' }],
    account_badges: [], account_featured_badges: [], announcements: [], match_wins: [],
    hideModerationTables: false
  };

  const otp = { codes: {}, last: null };

  function json(res, status, body) {
    const text = body === undefined || body === null ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json',
                             'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  }
  function readBody(req) {
    return new Promise(resolve => {
      let b = '';
      req.on('data', c => { if (b.length < 262144) b += c; });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
    });
  }
  function wantsRows(req) {
    return String(req.headers.prefer || '').includes('return=representation');
  }

  function parseFilters(url) {
    const out = [];
    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
      const dot = value.indexOf('.');
      if (dot > 0) out.push({ col: key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      else out.push({ col: key, op: 'eq', val: value });
    }
    return out;
  }
  function matches(row, flts) {
    return flts.every(f => {
      const v = row[f.col];
      if (f.op === 'eq') return String(v) === String(f.val);
      if (f.op === 'is') {
        return f.val === 'null' ? (v === null || v === undefined) : String(v) === f.val;
      }
      if (f.op === 'neq') return String(v) !== String(f.val);
      if (f.op === 'gt') return Number(v) > Number(f.val);
      if (f.op === 'gte') return String(v) >= String(f.val);
      if (f.op === 'ilike') {
        const pat = String(f.val).replace(/\*/g, '.*').replace(/%/g, '.*');
        return new RegExp('^' + pat + '$', 'i').test(String(v || ''));
      }
      throw new Error('fake supabase: unsupported filter ' + f.op);
    });
  }

  /** Same index, same constraint, same error code as the real migration. */
  function constraintViolation(table, row, ignore) {
    const others = state[table].filter(r => r !== row && r !== ignore);
    if (table === 'accounts') {
      if (!/^[A-Za-z0-9_]{3,22}$/.test(String(row.username || ''))) {
        return { code: '23514', message: 'new row for relation "accounts" violates check constraint "accounts_username_shape"' };
      }
      if (row.role !== 'player' && row.role !== 'owner') {
        return { code: '23514', message: 'violates check constraint "accounts_role"' };
      }
      if (others.some(a => String(a.username).toLowerCase() === String(row.username).toLowerCase())) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "accounts_username_lower"' };
      }
      // accounts_one_verified_email: only a PROVEN address is exclusive.
      if (row.email && row.email_verified_at &&
          others.some(a => a.email && a.email_verified_at &&
            String(a.email).toLowerCase() === String(row.email).toLowerCase())) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "accounts_one_verified_email"' };
      }
    }
    if (table === 'email_verifications') {
      if (others.some(r => String(r.account_id) === String(row.account_id))) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "email_verifications_pkey"' };
      }
    }
    if (table === 'moderation_bans') {
      const kind = row.kind;
      const okKind = kind === 'account' ? !!row.account_id
                    : kind === 'ip' ? !!row.ip
                    : kind === 'device' ? !!row.device_id : false;
      if (!okKind) {
        return { code: '23514', message: 'violates check constraint "moderation_bans_target"' };
      }
    }
    if (table === 'account_ips') {
      if (others.some(r => String(r.account_id) === String(row.account_id) &&
                           String(r.ip) === String(row.ip))) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "account_ips_pkey"' };
      }
    }
    if (table === 'device_accounts') {
      if (others.some(r => r.device_id === row.device_id &&
                           String(r.account_id) === String(row.account_id))) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "device_accounts_pkey"' };
      }
    }
    if (table === 'devices') {
      if (others.some(r => r.device_id === row.device_id)) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "devices_pkey"' };
      }
    }
    return null;
  }

  const rpc = {
    record_sighting(args) {
      if (args.p_account_id && args.p_ip) {
        const existing = state.account_ips.find(r =>
          String(r.account_id) === String(args.p_account_id) &&
          String(r.ip) === String(args.p_ip));
        if (existing) {
          existing.last_seen = nowIso();
          existing.ip_key = args.p_ip_key;
          existing.times_seen++;
        } else {
          state.account_ips.push({ account_id: args.p_account_id, ip: args.p_ip,
            ip_key: args.p_ip_key, first_seen: nowIso(), last_seen: nowIso(), times_seen: 1 });
        }
      }
      if (args.p_account_id && args.p_device_id) {
        const dev = state.devices.find(d => d.device_id === args.p_device_id);
        if (dev) {
          dev.last_seen = nowIso();
          dev.times_seen++;
          dev.account_id = dev.account_id || args.p_account_id;
        } else {
          state.devices.push({ device_id: args.p_device_id, account_id: args.p_account_id,
            account_name: args.p_account_name, first_seen: nowIso(), last_seen: nowIso(),
            times_seen: 1, last_ip: args.p_ip || null });
        }
        const link = state.device_accounts.find(d =>
          d.device_id === args.p_device_id &&
          String(d.account_id) === String(args.p_account_id));
        if (link) link.last_seen = nowIso();
        else state.device_accounts.push({ device_id: args.p_device_id,
          account_id: args.p_account_id, account_name: args.p_account_name,
          first_seen: nowIso(), last_seen: nowIso() });
      }
      return null;
    },
    record_signup_attempt(args) {
      state.signup_attempts.push({ ip_key: args.p_ip_key, username: args.p_username,
        ok: !!args.p_ok, at: nowIso() });
      return null;
    },
    recent_signup_count(args) {
      const cutoff = Date.now() - (Number(args.p_minutes) || 60) * 60000;
      return state.signup_attempts.filter(r =>
        r.ip_key === args.p_ip_key && new Date(r.at).getTime() > cutoff).length;
    },
    last_seen_ip(args) {
      const rows = state.account_ips
        .filter(r => String(r.account_id) === String(args.p_account_id))
        .sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
      return rows.length ? rows[0].ip : null;
    },
    last_seen_device(args) {
      const rows = state.device_accounts
        .filter(r => String(r.account_id) === String(args.p_account_id))
        .sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
      return rows.length ? rows[0].device_id : null;
    },
    revoke_moderation_ban(args) {
      const row = state.moderation_bans.find(b => b.id === args.p_ban_id && !b.revoked_at);
      if (!row) return false;
      row.revoked_at = nowIso();
      row.revoked_by = args.p_actor_id || null;
      row.revoked_by_name = args.p_actor_name || null;
      return true;
    },
    purge_expired_moderation_ips() { return 0; },
    purge_finished_email_verifications() { return 0; },
    claim_owner() { return { ok: false, reason: 'already-claimed' }; }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    /* ---- DEV CONVENIENCE: read back the code this stand-in "emailed" ----
     *
     * There is no mailbox behind a fake, so tests/preview.js uses this to see
     * the six digits a real player would find in their inbox. It is part of
     * the STAND-IN database only: nothing in the game ever calls it, and the
     * real server never talks to this file outside a test run.
     */
    if (p === '/__dev/last_otp' && req.method === 'GET') {
      return json(res, 200, otp.last || {});
    }

    /* ---- Supabase's own email OTP endpoints ---------------------------- */
    if (p === '/auth/v1/otp' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '');
      const code = String(Math.floor(100000 + Math.random() * 900000));
      otp.codes[email] = code;
      otp.last = { email, code };
      return json(res, 200, {});
    }
    if (p === '/auth/v1/verify' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '');
      const token = String(body.token || '');
      if (!otp.codes[email]) {
        return json(res, 400, { code: 'otp_expired', error_code: 'otp_expired',
                                msg: 'Email link is invalid or has expired' });
      }
      if (otp.codes[email] !== token) {
        return json(res, 400, { code: 'otp_expired', error_code: 'otp_expired',
                                msg: 'OTP has expired or is invalid' });
      }
      delete otp.codes[email];          // single use, exactly like the real one
      return json(res, 200, {
        access_token: 'fake-access', token_type: 'bearer', expires_in: 3600,
        refresh_token: 'fake-refresh',
        user: { id: uuid(), aud: 'authenticated', role: 'authenticated',
                email, created_at: nowIso() }
      });
    }

    if (p === '/rest/v1/') return json(res, 200, []);

    /* ---- rpc ----------------------------------------------------------- */
    if (p.indexOf('/rest/v1/rpc/') === 0) {
      const name = p.slice('/rest/v1/rpc/'.length);
      const body = req.method === 'GET' ? {} : await readBody(req);
      if (!rpc[name]) return json(res, 404, { code: 'PGRST202', message: 'function not found' });
      try { return json(res, 200, rpc[name](body)); }
      catch (err) { return json(res, 400, { code: 'XX000', message: String(err.message) }); }
    }

    /* ---- tables -------------------------------------------------------- */
    if (p.indexOf('/rest/v1/') !== 0) return json(res, 404, { message: 'not found' });
    const table = p.slice('/rest/v1/'.length);
    if (!state[table]) return json(res, 404, { message: 'unknown table ' + table });
    if (state.hideModerationTables && [
      'email_verifications', 'account_ips', 'devices', 'device_accounts',
      'moderation_bans', 'moderation_log', 'signup_attempts'
    ].includes(table)) {
      return json(res, 409, { code: 'PGRST205',
        message: 'Could not find the table(s) public.' + table + ' in the schema cache' });
    }

    const flts = parseFilters(url);

    if (req.method === 'GET') {
      let rows = state[table].filter(r => matches(r, flts));
      const order = url.searchParams.get('order');
      if (order) {
        const parts = order.split('.');
        const col = parts[0];
        const dir = parts[1];
        rows = rows.slice().sort((a, b) => {
          const x = a[col] === null || a[col] === undefined ? '' : String(a[col]);
          const y = b[col] === null || b[col] === undefined ? '' : String(b[col]);
          return dir === 'desc' ? y.localeCompare(x) : x.localeCompare(y);
        });
      }
      const limit = url.searchParams.get('limit');
      if (limit) rows = rows.slice(0, Number(limit));
      // .single() sends Accept: application/vnd.pgrst.object+json and wants one
      // object back (or PGRST116). .maybeSingle() in this postgrest-js does NOT
      // override Accept at all - it fetches the LIST and enforces cardinality
      // client-side - so every other GET must answer with an array, even when
      // zero or one row matched. Answering with a bare object here silently
      // breaks every lookup in the game.
      if (String(req.headers.accept || '').includes('vnd.pgrst.object')) {
        if (rows.length === 1) return json(res, 200, rows[0]);
        return json(res, 406, { code: 'PGRST116', details: 'Results contain ' + rows.length + ' rows',
          hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
      }
      return json(res, 200, rows);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const incoming = Array.isArray(body) ? body : [body];
      // supabase-js upsert() is a POST carrying `Prefer: resolution=merge-duplicates`
      // plus `?on_conflict=...`, NOT a PUT. Treating it as a plain insert makes
      // every ledger upsert a duplicate-key failure on the second send.
      const isUpsert = String(req.headers.prefer || '').includes('resolution=merge-duplicates');
      const conflictCols = String(url.searchParams.get('on_conflict') || '')
        .split(',').map(c => c.trim()).filter(Boolean);
      const added = [];
      for (const item of incoming) {
        const row = Object.assign({}, item);
        // Every real table carries `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
        // Omitting it here left `id` undefined in INSERT RETURNING, so every
        // session was written against an undefined account and NOBODY could
        // ever sign in. Default it for every table, exactly as Postgres does.
        if (row.id === undefined) row.id = uuid();
        if (row.created_at === undefined) row.created_at = nowIso();
        // moderation_log carries `at timestamptz DEFAULT now()`, not created_at.
        if (table === 'moderation_log' && row.at === undefined) row.at = nowIso();

        if (isUpsert && conflictCols.length) {
          const at = state[table].findIndex(r =>
            conflictCols.every(c => String(r[c]) === String(row[c])));
          if (at >= 0) {
            Object.assign(state[table][at], row);
            added.push(state[table][at]);
            continue;
          }
        }
        const bad = constraintViolation(table, row);
        if (bad) return json(res, 409, bad);
        state[table].push(row);
        added.push(row);
      }
      return json(res, 201, wantsRows(req) ? added : {});
    }

    if (req.method === 'PUT') {
      // Upsert, keyed on the columns named by on_conflict.
      const body = await readBody(req);
      const cols = String(url.searchParams.get('on_conflict') || '')
        .split(',').map(c => c.trim()).filter(Boolean);
      for (const item of (Array.isArray(body) ? body : [body])) {
        const at = cols.length
          ? state[table].findIndex(r => cols.every(c => String(r[c]) === String(item[c])))
          : -1;
        if (at >= 0) Object.assign(state[table][at], item);
        else {
          const row = Object.assign({}, item);
          const bad = constraintViolation(table, row);
          if (bad) return json(res, 409, bad);
          state[table].push(row);
        }
      }
      return json(res, 200, wantsRows(req) ? state[table] : {});
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const targeted = state[table].filter(r => matches(r, flts));
      for (const row of targeted) {
        const merged = Object.assign({}, row, body);
        const bad = constraintViolation(table, merged, row);
        if (bad) return json(res, 409, bad);
        Object.assign(row, body);
      }
      return json(res, 200, wantsRows(req) ? targeted : {});
    }

    if (req.method === 'DELETE') {
      const targeted = state[table].filter(r => matches(r, flts));
      for (const row of targeted) {
        const at = state[table].indexOf(row);
        if (at >= 0) state[table].splice(at, 1);
      }
      return json(res, 200, wantsRows(req) ? targeted : {});
    }

    return json(res, 405, { message: 'method not allowed' });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server, state, otp,
        url: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

/**
 * Start server.js against a Supabase-shaped URL.
 *
 * `extraEnv` is merged LAST, so a preview harness can pin a known owner
 * password. The defaults are otherwise deliberately unfriendly: a random
 * owner password and mode-access code mean no test can accidentally depend
 * on a value somebody might reuse elsewhere.
 */
function startServer(supabaseUrl, extraEnv) {
  return freePort().then(port => {
    const server = spawn(process.execPath, ['tests/helpers/plain-server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(port),
        PHOENIX_BIND_HOST: '127.0.0.1',
        PHOENIX_STATE_FILE: openState('phoenix-security-'),
        PHOENIX_OWNER_PASSWORD: crypto.randomBytes(24).toString('hex'),
        PHOENIX_MODE_ACCESS_CODE: crypto.randomBytes(16).toString('hex'),
        PHOENIX_MAX_ROOMS: '50',
        PHOENIX_CREATE_LIMIT: '200',
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          'eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fakesignature'
      }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 15000);
      let output = '';
      server.once('error', reject);
      server.stderr.on('data', d => { output += d; });
      server.stdout.on('data', data => {
        output += data;
        if (output.includes('PHOENIX multiplayer server:')) {
          clearTimeout(timer);
          resolve({ server, port, output: () => output });
        }
      });
      server.once('exit', code => {
        clearTimeout(timer);
        reject(new Error('server exited early: ' + code + '\n' + output));
      });
    });
  });
}

function stopServer(bundle) {
  return new Promise(resolve => {
    if (!bundle || bundle.server.exitCode !== null) return resolve();
    bundle.server.once('exit', resolve);
    bundle.server.kill();
    setTimeout(resolve, 4000);
  });
}

/* ---- a browser: a cookie jar over plain HTTP ---------------------------- */

/**
 * Put another browser on the same DEVICE token, as a shared household computer
 * would. This is the only way to observe a device restriction doing anything:
 * the account it was issued against is already restricted, so its own browser
 * is always told the more personal reason first.
 */
function houseDevice(browser, deviceId) {
  if (deviceId) browser.jar.phoenix_device = deviceId;
}

function makeBrowser() {
  const jar = {};
  function header() {
    const parts = Object.keys(jar).map(k => k + '=' + jar[k]);
    return parts.length ? parts.join('; ') : undefined;
  }
  function absorb(res) {
    const set = res.headers['set-cookie'] || [];
    for (const raw of set) {
      const pair = raw.split(';')[0];
      const at = pair.indexOf('=');
      if (at > 0) {
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (value === '') delete jar[name];
        else jar[name] = value;
      }
    }
  }
  function call(port, method, route, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const headers = Object.assign({ Accept: 'application/json' }, extraHeaders || {});
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const cookie = header();
      if (cookie) headers.Cookie = cookie;
      const req = http.request({ host: '127.0.0.1', port, method, path: route, headers },
        res => {
          let text = '';
          res.on('data', c => { if (text.length < 1048576) text += c; });
          res.on('end', () => {
            absorb(res);
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
            resolve({ res, data, status: res.statusCode });
          });
        });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  return {
    jar,
    get: (port, route, headers) => call(port, 'GET', route, null, headers),
    post: (port, route, body, headers) => call(port, 'POST', route, body, headers),
    /** Throw every cookie away, exactly like clearing site data. */
    clearCookies() { for (const k of Object.keys(jar)) delete jar[k]; },
    /** Open a socket carrying this browser's cookies. */
    connect(port, extraHeaders) {
      const cookie = header();
      // `ws` reads custom headers from options.headers. Passing { Cookie } at
      // the TOP level is silently ignored - the upgrade then arrives without a
      // session, and the server correctly refuses every player with
      // "Please sign in to play". This one line was the difference between a
      // game nobody could enter and one everybody could.
      const ws = new WebSocket('ws://127.0.0.1:' + port, {
        headers: Object.assign({}, extraHeaders || {}, cookie ? { Cookie: cookie } : {})
      });
      const events = [];
      const client = { ws, events, state: null, banned: null, closed: false };
      ws.on('message', raw => {
        const m = JSON.parse(raw.toString());
        events.push(m);
        if (m.type === 'state') client.state = m;
        if (m.type === 'banned') client.banned = m;
      });
      ws.on('close', () => { client.closed = true; });
      return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(client));
        ws.once('error', reject);
      });
    }
  };
}

function waitFor(client, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + (timeoutMs || 12000);
    const timer = setInterval(() => {
      const idx = client.events.findIndex(e => e.type === type);
      if (idx >= 0) {
        clearInterval(timer);
        resolve(client.events.splice(idx, 1)[0]);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('timed out waiting for "' + type + '". Saw: ' +
          client.events.map(e => e.type).join(',')));
      }
    }, 20);
  });
}

function register(browser, port, username, password, email, headers) {
  return browser.post(port, '/api/register',
    { username, password, email }, headers);
}
function signIn(browser, port, username, password, headers) {
  return browser.post(port, '/api/login', { username, password }, headers);
}
function verifyLast(browser, port) {
  return browser.post(port, '/api/account/email/verify', { code: fakeFor.otp.last.code });
}
// Set once the fake provider is up, so helpers stay terse.
let fakeFor = null;
function settle(ms) { return new Promise(r => setTimeout(r, ms || 200)); }

/* ======================================================================== */
/* 3. THE RUN                                                               */
/* ======================================================================== */

async function main() {
  console.log('\n\u001b[1mPHOENIX account security, email verification and bans\u001b[0m');

  unitSuite();

  const fake = await startFakeSupabase();
  fakeFor = fake;
  let bundle = null;
  try {
    bundle = await startServer(fake.url);
    serverLog = bundle.output;
    const port = bundle.port;
    console.log('\n\u001b[1mFull stack: a real server, real sockets, a real database stand-in\u001b[0m');

    const findId = name => {
      const row = fake.state.accounts.find(a => a.username === name);
      assert.ok(row, 'no account called ' + name);
      return row.id;
    };

    /* ---- the owner -------------------------------------------------- */
    const owner = makeBrowser();
    const ownerReg = await register(owner, port, 'phoenixowner', 'password-1234',
      'owner@example.com', { 'X-Forwarded-For': '203.0.113.10' });
    assert.strictEqual(ownerReg.data.ok, true, JSON.stringify(ownerReg.data));
    await verifyLast(owner, port);
    // Standing in for the secure server-side claim.
    fake.state.accounts.find(a => a.username === 'phoenixowner').role = 'owner';

    /* ============ 1. NEW ACCOUNT: mandatory verified email ============ */
    await test('a new account is created with an UNPROVEN address', async () => {
      const browser = makeBrowser();
      const res = await register(browser, port, 'alice', 'password-1234',
        'alice@example.com', { 'X-Forwarded-For': '198.51.100.21' });
      assert.strictEqual(res.data.ok, true, JSON.stringify(res.data));
      const row = fake.state.accounts.find(a => a.username === 'alice');
      assert.ok(row, 'the account exists');
      assert.strictEqual(row.email, 'alice@example.com');
      assert.strictEqual(row.email_verified_at, null, 'and it is NOT verified yet');
      assert.ok(res.data.verification && res.data.verification.required,
        'the response says verification is required');
      assert.ok(res.data.verification.emailSent, 'and that a code was sent');
    });

    await test('registration REFUSES to continue without an address', async () => {
      const browser = makeBrowser();
      const res = await browser.post(port, '/api/register',
        { username: 'noemail', password: 'password-1234' });
      assert.strictEqual(res.status, 400);
      assert.ok(/email/i.test(res.data.message), res.data.message);
      assert.strictEqual(fake.state.accounts.some(a => a.username === 'noemail'), false,
        'no account was created');
    });

    await test('an unverified player is refused a room, over the real socket', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'bob', 'password-1234', 'bob@example.com',
        { 'X-Forwarded-For': '198.51.100.22' });
      const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.22' });
      ws.ws.send(JSON.stringify({ type: 'create', name: 'Bob', code: 'ABC1' }));
      const err = await waitFor(ws, 'error');
      assert.ok(/verified email/i.test(err.message), err.message);
      assert.strictEqual(fake.state.moderation_bans.length, 0,
        'this is a verification gate, not a punishment');
      ws.ws.close();
    });

    await test('a wrong code is refused and counts against the limit', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'carol', 'password-1234', 'carol@example.com',
        { 'X-Forwarded-For': '198.51.100.23' });
      const wrong = await browser.post(port, '/api/account/email/verify', { code: '000000' });
      assert.strictEqual(wrong.data.ok, false);
      assert.strictEqual(wrong.data.attemptsLeft, 4, 'five wrong attempts are allowed');
      const ledger = fake.state.email_verifications.find(v => v.email === 'carol@example.com');
      assert.strictEqual(ledger.attempts, 1, 'the attempt was recorded server-side');
    });

    await test('an expired code cannot be used', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'dave', 'password-1234', 'dave@example.com',
        { 'X-Forwarded-For': '198.51.100.24' });
      const ledger = fake.state.email_verifications.find(v => v.email === 'dave@example.com');
      ledger.expires_at = new Date(Date.now() - 60000).toISOString();
      const res = await verifyLast(browser, port);
      assert.strictEqual(res.data.ok, false);
      assert.ok(/expired/i.test(res.data.message), res.data.message);
      const account = fake.state.accounts.find(a => a.username === 'dave');
      assert.strictEqual(account.email_verified_at, null, 'still unverified');
    });

    await test('a REUSED code cannot be used a second time', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'gina', 'password-1234', 'gina@example.com',
        { 'X-Forwarded-For': '198.51.100.33' });
      const code = fake.otp.last.code;
      const first = await browser.post(port, '/api/account/email/verify', { code });
      assert.strictEqual(first.data.ok, true, JSON.stringify(first.data));
      assert.strictEqual(
        fake.state.email_verifications.some(v => v.email === 'gina@example.com'),
        false, 'the ledger row is deleted the moment it is spent');

      // The single-use property that matters: the SAME code, replayed by a
      // DIFFERENT signed-in account, proves nothing. Supabase has consumed it
      // and PHOENIX has no ledger row left to check it against.
      const other = makeBrowser();
      await register(other, port, 'replayer', 'password-1234', 'replayer@example.com',
        { 'X-Forwarded-For': '198.51.100.34' });
      const replay = await other.post(port, '/api/account/email/verify', { code });
      assert.strictEqual(replay.data.ok, false, 'the code is single use');
      // The wording depends on whether this account has a code of its own
      // pending ("not correct") or none at all ("no longer valid"). Both are
      // refusals; what matters is that nothing was proven.
      assert.ok(/no longer valid|request a new code|not correct/i.test(replay.data.message),
        replay.data.message);
      const replayer = fake.state.accounts.find(a => a.username === 'replayer');
      assert.strictEqual(replayer.email_verified_at, null, 'and they stay unverified');

      // Re-submitting it on the ORIGINAL account is a no-op, not a re-verification.
      const again = await browser.post(port, '/api/account/email/verify', { code });
      assert.strictEqual(again.data.ok, true);
      assert.strictEqual(again.data.alreadyVerified, true, 'nothing is proven twice');
    });

    await test('the right code verifies, and the ledger is emptied', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'erin', 'password-1234', 'erin@example.com',
        { 'X-Forwarded-For': '198.51.100.25' });
      const res = await verifyLast(browser, port);
      assert.strictEqual(res.data.ok, true, JSON.stringify(res.data));
      const account = fake.state.accounts.find(a => a.username === 'erin');
      assert.ok(account.email_verified_at, 'the address is now proven');
      assert.strictEqual(
        fake.state.email_verifications.some(v => v.email === 'erin@example.com'),
        false, 'the single-use ledger row is gone');
    });

    await test('a VERIFIED player can now create a room', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'frank', 'password-1234', 'frank@example.com',
        { 'X-Forwarded-For': '198.51.100.26' });
      await verifyLast(browser, port);
      const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.26' });
      ws.ws.send(JSON.stringify({ type: 'create', name: 'Frank', code: 'FRNK1' }));
      const state = await waitFor(ws, 'state');
      assert.strictEqual(state.code, 'FRNK1');
      ws.ws.close();
    });

    /* ============ 2. EXISTING ACCOUNT: migration in place ============ */
    await test('an EXISTING player keeps everything and is only asked for an address',
      async () => {
        // Standing in for an account made before this feature existed.
        // A real bcrypt hash: a placeholder string makes compare() throw, and
        // the login would fail for reasons that have nothing to do with the
        // feature under test.
        const veteranId = crypto.randomUUID();
        fake.state.accounts.push({
          id: veteranId, username: 'veteran', role: 'player',
          password_hash: require('bcryptjs').hashSync('password-1234', 10), email: null,
          email_verified_at: null, created_at: '2025-01-01T00:00:00Z'
        });
        fake.state.account_badges.push({ account_id: veteranId, badge_key: 'champion' });
        fake.state.match_wins.push({ match_id: 'old-match', account_id: veteranId,
                                     created_at: '2025-02-01T00:00:00Z' });

        const browser = makeBrowser();
        const login = await signIn(browser, port, 'veteran', 'password-1234',
          { 'X-Forwarded-For': '198.51.100.31' });
        assert.strictEqual(login.data.ok, true, JSON.stringify(login.data));
        assert.strictEqual(login.data.account.username, 'veteran', 'same username');
        assert.strictEqual(login.data.account.id, veteranId, 'same account id');
        assert.ok(login.data.verification && login.data.verification.required,
          'and they are told to add an address');

        const beforeSessions = fake.state.sessions.length;
        const me = await browser.get(port, '/api/me');
        assert.strictEqual(me.data.account.id, veteranId, 'still signed in');
        assert.strictEqual(me.data.verification.required, true);

        const badgesBefore = fake.state.account_badges.length;
        const winsBefore = fake.state.match_wins.length;

        const ask = await browser.post(port, '/api/account/email/request',
          { email: 'veteran@example.com' });
        assert.strictEqual(ask.data.ok, true, JSON.stringify(ask.data));
        const prove = await verifyLast(browser, port);
        assert.strictEqual(prove.data.ok, true, JSON.stringify(prove.data));

        const after = fake.state.accounts.find(a => a.id === veteranId);
        assert.strictEqual(after.username, 'veteran', 'the account was NOT recreated');
        assert.strictEqual(after.email, 'veteran@example.com');
        assert.ok(after.email_verified_at);
        assert.strictEqual(fake.state.account_badges.length, badgesBefore, 'badges untouched');
        assert.strictEqual(fake.state.match_wins.length, winsBefore, 'wins untouched');
        assert.strictEqual(fake.state.sessions.length, beforeSessions,
          'the session survived verification');
      });

    // The case a real player hits: an account whose session was opened BEFORE
    // this feature existed. It has to keep that session and be asked for an
    // address - never signed out, never made to start again.
    await test('a session from BEFORE the update survives and is only asked to verify',
      async () => {
        const id = crypto.randomUUID();
        fake.state.accounts.push({
          id, username: 'oldsession', role: 'player',
          password_hash: require('bcryptjs').hashSync('password-1234', 10),
          email: null, email_verified_at: null,
          created_at: '2025-01-01T00:00:00Z'
        });

        const browser = makeBrowser();
        const login = await signIn(browser, port, 'oldsession', 'password-1234',
          { 'X-Forwarded-For': '198.51.100.41' });
        assert.strictEqual(login.data.ok, true, JSON.stringify(login.data));

        // Age the session so it is indistinguishable from one opened months ago.
        const session = fake.state.sessions[fake.state.sessions.length - 1];
        const tokenHash = session.token_hash;
        session.created_at = '2025-01-01T00:00:00Z';

        // Still signed in: the update did not invalidate what they already had.
        const me = await browser.get(port, '/api/me');
        assert.strictEqual(me.data.account.id, id, 'still signed in on the old session');
        assert.strictEqual(me.data.verification.required, true, 'and still owes an address');

        // Playing is refused - but they are refused, NOT kicked out.
        const sock = await browser.connect(port);
        sock.ws.send(JSON.stringify({ type: 'create' }));
        const refusal = await waitFor(sock, 'error');
        assert.strictEqual(refusal.code, 'email-required',
          'the page is told WHICH screen to open, not just given a sentence');
        assert.strictEqual(sock.closed, false, 'the socket stays open - not signed out');

        // They add the address on the same session, with no re-login.
        const ask = await browser.post(port, '/api/account/email/request',
          { email: 'oldsession@example.com' });
        assert.strictEqual(ask.data.ok, true, JSON.stringify(ask.data));
        const prove = await verifyLast(browser, port);
        assert.strictEqual(prove.data.ok, true, JSON.stringify(prove.data));

        // The very same session row is still the one in use.
        const still = fake.state.sessions.filter(s => s.token_hash === tokenHash);
        assert.strictEqual(still.length, 1, 'the pre-update session was NOT replaced');
        assert.strictEqual(
          fake.state.sessions.filter(s => s.account_id === id).length, 1,
          'and no second session was minted to replace it');

        // The prompt is gone, and the socket they already had open can play -
        // no 15-second wait for a cache to notice.
        const after = await browser.get(port, '/api/me');
        assert.strictEqual(after.data.verification.required, false, 'the prompt is gone');
        sock.ws.send(JSON.stringify({ type: 'create' }));
        const created = await waitFor(sock, 'state');
        assert.ok(created.code,
          'and the match they asked for is theirs at last');
      });

    // The owner asked for this to apply to everybody, themselves included.
    await test('the OWNER is not exempt - no verified address, no multiplayer',
      async () => {
        const account = fake.state.accounts.find(a => a.username === 'phoenixowner');
        const savedEmail = account.email;
        const savedVerified = account.email_verified_at;
        account.email = null;
        account.email_verified_at = null;

        try {
          const browser = makeBrowser();
          const login = await signIn(browser, port, 'phoenixowner', 'password-1234',
            { 'X-Forwarded-For': '203.0.113.11' });
          assert.strictEqual(login.data.ok, true, JSON.stringify(login.data));

          const me = await browser.get(port, '/api/me');
          assert.strictEqual(me.data.account.role, 'owner', 'this really is the owner');
          assert.strictEqual(me.data.verification.required, true,
            'and the owner owes an address like anybody else');

          const sock = await browser.connect(port);
          sock.ws.send(JSON.stringify({ type: 'create' }));
          const refusal = await waitFor(sock, 'error');
          assert.strictEqual(refusal.code, 'email-required',
            'the owner is refused multiplayer too');
          assert.ok(/verified email/i.test(refusal.message),
            'with the same notice every player gets');
          assert.strictEqual(sock.closed, false,
            'and is NOT kicked out - the dashboard is still theirs to use');
        } finally {
          account.email = savedEmail;
          account.email_verified_at = savedVerified;
        }
      });

    await test('an already-verified player is never asked again', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'erin', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.25' });
      const me = await browser.get(port, '/api/me');
      assert.strictEqual(me.data.verification.required, false,
        'the mandatory screen is skipped');
      assert.strictEqual(me.data.verification.verified, true);
    });

    await test('the same verified address cannot be claimed by a second account', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'harriet', 'password-1234', 'harriet@example.com',
        { 'X-Forwarded-For': '198.51.100.32' });

      // Her own registration started a 60-second resend cooldown, and the
      // server is right to refuse a second code inside it. Let it lapse so the
      // test exercises the address rule rather than the rate limit.
      const mine = fake.state.email_verifications.find(v => v.account_id === findId('harriet'));
      mine.resend_after = new Date(Date.now() - 1000).toISOString();

      const ask = await browser.post(port, '/api/account/email/request',
        { email: 'erin@example.com' });
      assert.strictEqual(ask.data.ok, true,
        'a code is sent to any address - sending is never the proof');
      const prove = await verifyLast(browser, port);
      assert.strictEqual(prove.data.ok, false, 'but verification is refused');
      assert.ok(/already verified/i.test(prove.data.message), prove.data.message);
      const harriet = fake.state.accounts.find(a => a.username === 'harriet');
      assert.strictEqual(harriet.email_verified_at, null,
        'and her account stays unverified');
    });

    /* ============ 3. BANS ============ */
    await test('the owner issues a PERMANENT ban and the player is out immediately',
      async () => {
        const browser = makeBrowser();
        await register(browser, port, 'hank', 'password-1234', 'hank@example.com',
          { 'X-Forwarded-For': '198.51.100.41' });
        await verifyLast(browser, port);

        const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.41' });
        ws.ws.send(JSON.stringify({ type: 'create', name: 'Hank', code: 'HANK1' }));
        await waitFor(ws, 'state');

        const issued = await owner.post(port, '/api/moderation/restrictions', {
          accountId: findId('hank'), reason: 'Repeated cheating', permanent: true
        });
        assert.strictEqual(issued.data.ok, true, JSON.stringify(issued.data));
        assert.strictEqual(issued.data.created.length, 1, 'one account restriction');

        const banned = await waitFor(ws, 'banned', 8000);
        assert.strictEqual(banned.ban.headline, Moderation.BAN_HEADLINE);
        assert.strictEqual(banned.ban.permanent, true, 'and it says so');
        assert.strictEqual(banned.ban.personal, true);
        assert.ok(!JSON.stringify(banned.ban).includes('198.51.100.41'),
          'the address is not leaked to the player');
      });

    await test('a banned player cannot clear cookies or sign back in', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'hank', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.41' });
      browser.clearCookies();                 // as if clearing site data
      await signIn(browser, port, 'hank', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.41' });

      const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.41' });
      await waitFor(ws, 'banned', 8000);
      ws.events.length = 0;
      ws.ws.send(JSON.stringify({ type: 'join', name: 'Hank', code: 'HANK1' }));
      const second = await waitFor(ws, 'banned', 8000);
      assert.strictEqual(second.ban.permanent, true);
      ws.ws.close();

      // A brand new account is a different story: it is not restricted on its
      // own. That is what makes the ACCOUNT the right thing to ban.
      const fresh = makeBrowser();
      const reg = await register(fresh, port, 'hank2', 'password-1234',
        'hank2@example.com', { 'X-Forwarded-For': '198.51.100.99' });
      assert.strictEqual(reg.data.ok, true, 'a new account may exist');
    });

    await test('a TEMPORARY ban expires on its own', async () => {
      const browser = makeBrowser();
      await register(browser, port, 'iris', 'password-1234', 'iris@example.com',
        { 'X-Forwarded-For': '198.51.100.42' });
      await verifyLast(browser, port);

      const issued = await owner.post(port, '/api/moderation/restrictions', {
        accountId: findId('iris'), reason: 'Temporarily disruptive', duration: 3600
      });
      assert.strictEqual(issued.data.ok, true, JSON.stringify(issued.data));
      const row = fake.state.moderation_bans.find(b => b.account_name === 'iris');
      assert.ok(row.expires_at, 'a temporary ban has an expiry');
      assert.strictEqual(row.expires_at === null, false,
        'permanent is expressed by a NULL expiry, not a flag');

      let ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.42' });
      await waitFor(ws, 'banned', 8000);
      ws.ws.close();

      row.expires_at = new Date(Date.now() - 1000).toISOString();   // time passes
      ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.42' });
      ws.ws.send(JSON.stringify({ type: 'create', name: 'Iris', code: 'IRIS1' }));
      const state = await waitFor(ws, 'state', 8000);
      assert.strictEqual(state.code, 'IRIS1', 'play resumes by itself');
      ws.ws.close();
    });

    await test('a PERMANENT ban can always be lifted, and nothing is deleted', async () => {
      const hankBan = fake.state.moderation_bans.find(b => b.account_name === 'hank');
      assert.ok(hankBan, 'hank is banned');
      const rowsBefore = fake.state.moderation_bans.length;
      const accountsBefore = fake.state.accounts.length;

      const res = await owner.post(port, '/api/moderation/restrictions/revoke',
        { id: hankBan.id });
      assert.strictEqual(res.data.ok, true, JSON.stringify(res.data));
      assert.ok(res.data.restriction.revokedAt, 'it is stamped, not removed');

      const row = fake.state.moderation_bans.find(b => b.id === hankBan.id);
      assert.ok(row, 'the row is still there as history');
      assert.ok(row.revoked_at, 'with its revocation time');
      assert.strictEqual(fake.state.moderation_bans.length, rowsBefore,
        'nothing was deleted');
      assert.strictEqual(fake.state.accounts.length, accountsBefore,
        'and no player account was touched');
    });

    await test('a lifted player is let straight back in', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'hank', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.41' });
      const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.41' });
      ws.ws.send(JSON.stringify({ type: 'create', name: 'Hank', code: 'HANK2' }));
      const state = await waitFor(ws, 'state', 8000);
      assert.strictEqual(state.code, 'HANK2');
      ws.ws.close();
    });

    /* ============ 4. NETWORK AND DEVICE ============ */
    await test('an optional network ban blocks a NEW account and a SECOND device',
      async () => {
        const browser = makeBrowser();
        await register(browser, port, 'jack', 'password-1234', 'jack@example.com',
          { 'X-Forwarded-For': '203.0.113.77' });
        await verifyLast(browser, port);
        // Give the server something to have observed.
        const probe = await browser.connect(port, { 'X-Forwarded-For': '203.0.113.77' });
        await settle(200);
        probe.ws.close();

        const issued = await owner.post(port, '/api/moderation/restrictions', {
          accountId: findId('jack'), reason: 'Network abuse', permanent: true, ip: true
        });
        assert.strictEqual(issued.data.ok, true, JSON.stringify(issued.data));
        assert.strictEqual(issued.data.created.length, 2, 'an account row AND a network row');
        assert.ok(issued.data.created.some(c => c.kind === 'ip'));

        // A brand new account from that address is refused.
        const fresh = makeBrowser();
        await register(fresh, port, 'jackfriend', 'password-1234',
          'jackfriend@example.com', { 'X-Forwarded-For': '203.0.113.77' });
        const wsA = await fresh.connect(port, { 'X-Forwarded-For': '203.0.113.77' });
        const banA = await waitFor(wsA, 'banned', 8000);
        assert.strictEqual(banA.ban.scope, 'network');
        assert.strictEqual(banA.ban.personal, false, 'they were not personally banned');
        assert.ok(/other people on the same network/i.test(banA.ban.notice),
          'and the screen says exactly that');
        wsA.ws.close();

        // A different device on the same network is caught too - the "innocent
        // family member" case, which is why the warning exists.
        const other = makeBrowser();
        await register(other, port, 'jackhousemate', 'password-1234',
          'jackhousemate@example.com', { 'X-Forwarded-For': '203.0.113.77' });
        const wsB = await other.connect(port, { 'X-Forwarded-For': '203.0.113.77' });
        await waitFor(wsB, 'banned', 8000);
        wsB.ws.close();
      });

    await test('the network ban lifts WITHOUT lifting the account ban', async () => {
      const ipBan = fake.state.moderation_bans
        .find(b => b.kind === 'ip' && b.account_name === 'jack');
      assert.ok(ipBan, 'there is a network restriction on record');

      const res = await owner.post(port, '/api/moderation/restrictions/revoke',
        { id: ipBan.id });
      assert.strictEqual(res.data.ok, true, JSON.stringify(res.data));

      // The network is open again. A brand-new account still owes us a verified
      // address, so prove it first - otherwise this asserts the email gate.
      const browser = makeBrowser();
      await register(browser, port, 'jacknew', 'password-1234', 'jacknew@example.com',
        { 'X-Forwarded-For': '203.0.113.77' });
      await verifyLast(browser, port);
      const ws = await browser.connect(port, { 'X-Forwarded-For': '203.0.113.77' });
      ws.events.length = 0;
      ws.ws.send(JSON.stringify({ type: 'create', name: 'JackNew', code: 'JACK9' }));
      const state = await waitFor(ws, 'state', 8000);
      assert.strictEqual(state.code, 'JACK9', 'the network is playable again');
      ws.ws.close();

      // ...and the account restriction is untouched.
      const stillBanned = fake.state.moderation_bans
        .filter(b => b.kind === 'account' && b.account_name === 'jack' && !b.revoked_at);
      assert.strictEqual(stillBanned.length, 1, 'the account restriction stands');
    });

    await test('a device restriction says plainly that it is not a hardware ban',
      async () => {
        const browser = makeBrowser();
        await register(browser, port, 'lena', 'password-1234', 'lena@example.com',
          { 'X-Forwarded-For': '203.0.113.80' });
        await verifyLast(browser, port);
        // /api/me is what issues the phoenix_device cookie, exactly as the real
        // client does on page load. Without it this browser has no device token
        // at all, and there is nothing to restrict.
        await browser.get(port, '/api/me', { 'X-Forwarded-For': '203.0.113.80' });
        const probe = await browser.connect(port, { 'X-Forwarded-For': '203.0.113.80' });
        await settle(200);
        probe.ws.close();

        const issued = await owner.post(port, '/api/moderation/restrictions', {
          accountId: findId('lena'), reason: 'Test device', permanent: true, device: true
        });
        assert.strictEqual(issued.data.ok, true, JSON.stringify(issued.data));
        assert.strictEqual(issued.data.created.length, 2, 'account + device rows');

        // Lena's OWN browser is told the most personal reason first: her account
        // is restricted. That ordering is deliberate - "you are banned" is more
        // useful to her than "this browser is".
        const ws = await browser.connect(port, { 'X-Forwarded-For': '203.0.113.80' });
        const own = await waitFor(ws, 'banned', 8000);
        assert.strictEqual(own.ban.scope, 'account');
        ws.ws.close();

        // The property a device restriction actually has: it follows the BROWSER
        // across accounts. A different signed-in account presenting the SAME
        // device token is refused, and told plainly that this is a browser
        // restriction - not hardware, and resettable by clearing site data.
        const housemate = makeBrowser();
        houseDevice(housemate, browser.jar.phoenix_device);
        await register(housemate, port, 'lenasibling', 'password-1234',
          'lenasibling@example.com', { 'X-Forwarded-For': '203.0.113.80' });
        const wsB = await housemate.connect(port, { 'X-Forwarded-For': '203.0.113.80' });
        const banned = await waitFor(wsB, 'banned', 8000);
        assert.strictEqual(banned.ban.scope, 'device');
        assert.strictEqual(banned.ban.personal, false,
          'they were not personally banned - the browser was');
        assert.ok(/NOT permanent/i.test(banned.ban.notice),
          'the limitation is stated rather than hidden');
        wsB.ws.close();

        // Clearing the cookie sidesteps it - which is exactly what the notice
        // says, and exactly why this is never sold as a permanent ban.
        const sidestep = makeBrowser();
        await register(sidestep, port, 'lenanew', 'password-1234', 'lenanew@example.com',
          { 'X-Forwarded-For': '203.0.113.81' });
        await verifyLast(sidestep, port);
        const ws2 = await sidestep.connect(port, { 'X-Forwarded-For': '203.0.113.81' });
        ws2.ws.send(JSON.stringify({ type: 'create', name: 'LenaNew', code: 'LENA9' }));
        const state = await waitFor(ws2, 'state', 8000);
        assert.strictEqual(state.code, 'LENA9',
          'a fresh token is a fresh device - stated honestly, not hidden');
        ws2.ws.close();
      });

    /* ============ 5. MID-MATCH ============ */
    await test('a player banned MID-MATCH is removed and refused every action',
      async () => {
        const one = makeBrowser();
        const two = makeBrowser();
        await register(one, port, 'mike', 'password-1234', 'mike@example.com',
          { 'X-Forwarded-For': '198.51.100.51' });
        await verifyLast(one, port);
        await register(two, port, 'nina', 'password-1234', 'nina@example.com',
          { 'X-Forwarded-For': '198.51.100.52' });
        await verifyLast(two, port);

        const a = await one.connect(port, { 'X-Forwarded-For': '198.51.100.51' });
        a.ws.send(JSON.stringify({ type: 'create', name: 'Mike', code: 'MTCH1' }));
        await waitFor(a, 'state');

        const b = await two.connect(port, { 'X-Forwarded-For': '198.51.100.52' });
        b.ws.send(JSON.stringify({ type: 'join', name: 'Nina', code: 'MTCH1' }));
        const joined = await waitFor(b, 'state');
        assert.ok(joined.players.length >= 2, 'both are in the room');

        await owner.post(port, '/api/moderation/restrictions', {
          accountId: findId('nina'), reason: 'Mid-match', permanent: true
        });

        const banned = await waitFor(b, 'banned', 8000);
        assert.strictEqual(banned.ban.permanent, true);

        // Every later action is refused, whatever it is.
        b.events.length = 0;
        b.ws.send(JSON.stringify({ type: 'move', cardId: 'bonus', targetId: null }));
        const refused = await waitFor(b, 'banned', 8000);
        assert.ok(refused.ban, 'game actions are refused too');

        await settle(600);
        a.events.length = 0;
        a.ws.send(JSON.stringify({ type: 'move', cardId: 'bonus', targetId: null }));
        assert.ok(!a.events.some(e => e.type === 'banned'),
          'the other player is unaffected');
        a.ws.close();
      });

    /* ============ 6. UNAUTHORISED MODERATION ============ */
    await test('an ordinary player can touch none of the moderation API', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'alice', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.21' });

      const search = await browser.get(port, '/api/moderation/accounts?q=a');
      assert.strictEqual(search.status, 403);
      assert.ok(/owner/i.test(search.data.message));

      assert.strictEqual((await browser.get(port, '/api/moderation/restrictions')).status, 403);
      assert.strictEqual((await browser.get(port, '/api/moderation/log')).status, 403);

      const issue = await browser.post(port, '/api/moderation/restrictions',
        { accountId: findId('bob'), reason: 'because I can', permanent: true });
      assert.strictEqual(issue.status, 403);

      const denials = fake.state.moderation_log.filter(e => e.action === 'access.denied');
      assert.ok(denials.length >= 4, 'the attempts were audited: ' + denials.length);
    });

    await test('a signed-out visitor gets 401 and nothing else', async () => {
      const nobody = makeBrowser();
      const res = await nobody.get(port, '/api/moderation/restrictions');
      assert.strictEqual(res.status, 401);
    });

    await test('a restriction id that does not exist is a clean 404', async () => {
      const res = await owner.post(port, '/api/moderation/restrictions/revoke',
        { id: crypto.randomUUID() });
      assert.strictEqual(res.status, 404);
      const junk = await owner.post(port, '/api/moderation/restrictions/revoke',
        { id: 'not-a-uuid' });
      assert.strictEqual(junk.status, 400);
    });

    /* ============ 7. THE OWNER IS NEVER LOCKED OUT ============ */
    await test('the owner is exempt from every restriction, including their network',
      async () => {
        const issued = await owner.post(port, '/api/moderation/restrictions', {
          accountId: findId('phoenixowner'), reason: 'Self-inflicted', permanent: true,
          ip: true, device: true
        });
        assert.strictEqual(issued.data.ok, true, JSON.stringify(issued.data));

        const ws = await owner.connect(port, { 'X-Forwarded-For': '203.0.113.10' });
        ws.ws.send(JSON.stringify({ type: 'create', name: 'Owner' }));
        const state = await waitFor(ws, 'state', 8000);
        // An OWNER create takes the owner-room path, which mints its own code
        // and never appears in the public lobby - so assert on the room they
        // actually got rather than one they asked for.
        assert.ok(/^[A-Z0-9]{3,6}$/.test(state.code),
          'locking the owner out of their own game would be unrecoverable');
        assert.strictEqual(ws.banned, null);
        ws.ws.close();

        // Clean up after the test.
        fake.state.moderation_bans
          .filter(b => b.account_name === 'phoenixowner')
          .forEach(b => { b.revoked_at = new Date().toISOString(); });
      });

    /* ============ 8. THE AUDIT TRAIL ============ */
    await test('every decision lands in the audit log with an actor', async () => {
      const res = await owner.get(port, '/api/moderation/log?limit=200');
      assert.strictEqual(res.data.ok, true, JSON.stringify(res.data));
      const actions = res.data.entries.map(e => e.action);
      assert.ok(actions.includes('restriction.issued'), 'issuing is recorded');
      assert.ok(actions.includes('restriction.lifted'), 'and so is lifting');
      assert.ok(actions.includes('email.verified'), 'and email verification');
      assert.ok(res.data.entries.every(e => e.at), 'each with a timestamp');
      assert.ok(res.data.entries.every(e => e.actor_name),
        'each naming whoever made the decision');
      // Moderation decisions belong to the owner. Self-service events - a player
      // proving their own address - are correctly attributed to that player.
      const moderation = res.data.entries.filter(e =>
        e.action === 'restriction.issued' || e.action === 'restriction.lifted');
      assert.ok(moderation.length > 0);
      assert.ok(moderation.every(e => e.actor_name === 'phoenixowner'),
        'restrictions are always attributed to the owner');
      const proven = res.data.entries.filter(e => e.action === 'email.verified');
      assert.ok(proven.length > 0);
      // A player proving an address acts on their own account, so the actor and
      // the subject are the same person. (The owner verifies their own address
      // too, which is why this asserts self-attribution rather than
      // "never the owner".)
      assert.ok(proven.every(e => e.actor_name && e.actor_name === e.subject_name),
        'and a player proving their address is attributed to themselves');
    });

    await test('the owner can search accounts by name AND by account id', async () => {
      const byName = await owner.get(port, '/api/moderation/accounts?q=ir');
      assert.strictEqual(byName.data.ok, true, JSON.stringify(byName.data));
      assert.ok(byName.data.accounts.some(a => a.username === 'iris'), 'partial name');

      const byId = await owner.get(port, '/api/moderation/accounts?q=' + findId('iris'));
      assert.strictEqual(byId.data.ok, true);
      const hit = byId.data.accounts.find(a => a.id === findId('iris'));
      assert.ok(hit, 'exact id');
      assert.strictEqual(hit.username, 'iris');
    });

    await test('restrictions can be read by state: active, expired and revoked', async () => {
      const active = await owner.get(port, '/api/moderation/restrictions?status=active');
      assert.strictEqual(active.data.ok, true, JSON.stringify(active.data));
      assert.ok(active.data.restrictions.length > 0);

      const revoked = await owner.get(port, '/api/moderation/restrictions?status=revoked');
      assert.strictEqual(revoked.data.ok, true);
      assert.ok(revoked.data.restrictions.length > 0, 'lifted ones are still listed');
      assert.ok(revoked.data.restrictions.every(r => r.revokedAt));
    });

    /* ============ 9. REGRESSION ============ */
    await test('multiplayer still works for everyone else', async () => {
      const one = makeBrowser();
      const two = makeBrowser();
      await register(one, port, 'pat', 'password-1234', 'pat@example.com',
        { 'X-Forwarded-For': '198.51.100.61' });
      await verifyLast(one, port);
      await register(two, port, 'quinn', 'password-1234', 'quinn@example.com',
        { 'X-Forwarded-For': '198.51.100.62' });
      await verifyLast(two, port);

      const a = await one.connect(port, { 'X-Forwarded-For': '198.51.100.61' });
      a.ws.send(JSON.stringify({ type: 'create', name: 'Pat', code: 'GAME9' }));
      await waitFor(a, 'state');
      const b = await two.connect(port, { 'X-Forwarded-For': '198.51.100.62' });
      b.ws.send(JSON.stringify({ type: 'join', name: 'Quinn', code: 'GAME9' }));
      const state = await waitFor(b, 'state');
      assert.ok(state.players.length >= 2, 'two players in one room');
      a.ws.close(); b.ws.close();
    });

    await test('badges, announcements and the leaderboard still answer', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'alice', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.21' });
      for (const route of ['/api/badges', '/api/announcements', '/api/leaderboard']) {
        const res = await browser.get(port, route);
        assert.ok(res.status === 200 || res.status === 503,
          route + ' answers (' + res.status + ')');
      }
    });

    await test('with the migrations missing the whole system degrades, never 500s',
      async () => {
        fake.state.hideModerationTables = true;
        try {
          const browser = makeBrowser();
          const me = await browser.get(port, '/api/me');
          assert.ok(me.status === 200 || me.status === 401,
            'the account screen still answers: ' + me.status);

          const issue = await owner.post(port, '/api/moderation/restrictions', {
            accountId: findId('iris'), reason: 'nope', permanent: true
          });
          assert.strictEqual(issue.status, 503,
            'moderation says it is unavailable: ' + issue.status);

          // And play carries on, because a missing migration is not a ban.
          const player = makeBrowser();
          await signIn(player, port, 'pat', 'password-1234',
            { 'X-Forwarded-For': '198.51.100.61' });
          const ws = await player.connect(port, { 'X-Forwarded-For': '198.51.100.61' });
          ws.ws.send(JSON.stringify({ type: 'create', name: 'Pat', code: 'DGRD1' }));
          const state = await waitFor(ws, 'state', 8000);
          assert.strictEqual(state.code, 'DGRD1', 'games still open');
          ws.ws.close();
        } finally {
          fake.state.hideModerationTables = false;
        }
      });

    await test('a player cannot claim owner powers over the socket', async () => {
      const browser = makeBrowser();
      await signIn(browser, port, 'pat', 'password-1234',
        { 'X-Forwarded-For': '198.51.100.61' });
      const ws = await browser.connect(port, { 'X-Forwarded-For': '198.51.100.61' });
      ws.ws.send(JSON.stringify({ type: 'admin_rooms' }));
      ws.ws.send(JSON.stringify({ type: 'admin_auth', password: 'guessed' }));
      const state = await settle(400).then(() => ws.events.map(e => e.type));
      assert.ok(!state.includes('admin_state') || state.length === 0,
        'no admin state is handed to a player');
      ws.ws.close();
    });

  } finally {
    await stopServer(bundle);
    await fake.close();
  }

  finish();
}

// Only run the suite when this file is the entry point, so a preview harness
// can reuse the fake database below without triggering a full test run.
if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startFakeSupabase, makeBrowser, startServer, stopServer };
