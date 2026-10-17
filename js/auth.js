/* PHOENIX — Phase 1 server-side authentication.
 * Custom username/password auth on Supabase Postgres (Supabase Auth is NOT used,
 * because it requires an email/phone and the owner forbids fake emails).
 *
 *   - bcryptjs password hashing (never plain text).
 *   - Opaque server-side session tokens, stored only as SHA-256 hashes.
 *   - httpOnly / Secure / SameSite cookies (JS can't read the token).
 *   - Auth validated on the SERVER for every protected action.
 *
 * No secrets are read from the browser. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * and PHOENIX_OWNER_SETUP_KEY come from Render env vars only.
 */
'use strict';

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Reduce SUPABASE_URL to a bare origin.
 *
 * supabase-js appends `/rest/v1` itself (it resolves `new URL('rest/v1',
 * baseUrl)`). If the env var ALREADY carries that path - the classic mistake of
 * pasting the "REST URL" from Project Settings -> Data API instead of the bare
 * project URL - the client goes on to request `/rest/v1/rest/v1/accounts`.
 * The gateway routes that to PostgREST as the path `/rest/v1/accounts`, which
 * PostgREST reads as a three-segment resource and rejects with
 * PGRST125 "Invalid path specified in request URL".
 *
 * A stray trailing slash or surrounding whitespace is already absorbed by
 * supabase-js, so only the path matters. Stripping it here makes the server
 * correct no matter how the value was pasted.
 */
function normalizeSupabaseUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/+$/, '');
}

const RAW_SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_URL = normalizeSupabaseUrl(RAW_SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Absorb the whitespace a dashboard paste often brings. The setup key is only
// ever compared and hashed, never displayed, so a trailing newline is pure
// breakage - and it would silently stop the owner claim matching the hash
// seeded in the database.
const OWNER_SETUP_KEY = String(process.env.PHOENIX_OWNER_SETUP_KEY || '').trim();

const SESSION_COOKIE = 'phoenix_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const BCRYPT_ROUNDS = 10;
// A real bcrypt hash of a throwaway string (NOT a secret, NOT an account).
// Used only when a login names an unknown user, so that path still pays a full
// bcrypt compare and reveals nothing about which usernames exist.
const DUMMY_HASH = '$2b$10$wV6SdWatGgygTcVIDQMC5uEiqV94AK2sb..g5uDbFS2RfhAVoWi6u';

let _supabase = null;

/**
 * Is the account system actually configured on this process?
 *
 * Unit tests and a bare `node server.js` run WITHOUT Supabase. When it is not
 * configured the auth endpoints answer 503 and the multiplayer gate stays
 * open, exactly as before Phase 1 - but on Render (where the env vars exist)
 * this is always true and every game action demands a signed-in session.
 */
function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Do the accounts table carry an email address yet?
 *
 * sql/email-verification.sql adds them. Until it has been run the server keeps
 * working exactly as before rather than logging everybody out: registration
 * simply does not demand an address, and the gameplay gate stays open. Once the
 * migration lands, the same process starts requiring verification on the next
 * request with no redeploy.
 *
 * Probed once and cached - the schema of a table does not change under us.
 */
let _emailColumns = null;

function _resetEmailProbe() { _emailColumns = null; }

async function schemaHasEmail() {
  if (_emailColumns !== null) return _emailColumns;
  if (!isConfigured()) return false;
  // PostgREST reloads its schema cache after a migration or a deploy, and a
  // probe that lands inside that window fails TRANSIENTLY. Caching that one
  // failure would switch the whole email feature off until the next restart,
  // so the probe is retried before a negative result is believed. A column
  // that genuinely does not exist fails every attempt the same way and is
  // still cached as false - the retry only waits out the transient case.
  const ATTEMPTS = 5;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { error } = await client().from('accounts')
        .select('email, email_verified_at').limit(1);
      if (!error) { _emailColumns = true; return true; }
      console.error('[PHOENIX email] schema probe attempt ' + attempt + '/' + ATTEMPTS +
        ' failed -> ' + (error.code || '') + ' ' + (error.message || error));
      _emailColumns = false;
    } catch (err) {
      console.error('[PHOENIX email] schema probe attempt ' + attempt + '/' + ATTEMPTS +
        ' threw -> ' + (err && err.message ? err.message : err));
      _emailColumns = false;
    }
    if (_emailColumns) return true;
    if (attempt < ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return _emailColumns;
}

function client() {
  if (!_supabase) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.');
    }
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _supabase;
}

/** A fresh client that is never shared with auth operations. DB writes use this
 *  so a session set by verifyOtp can never pollute privileged queries. */
function freshClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/* ---------- safe diagnostics ------------------------------------------------
 * Auth failures used to be swallowed into one generic sentence, which made a
 * broken database indistinguishable from a typo'd password. The MESSAGE shown
 * to the player stays generic (internals must never reach a stranger's
 * browser), but the SERVER LOG now records the real cause - with anything that
 * looks like a credential removed first.
 *
 * Never logged: passwords, bcrypt hashes, session tokens, API keys, cookies.
 * Logged: Postgres/PostgREST error codes, table names, constraint names,
 *         network errors, and the KEY TYPE (e.g. "legacy JWT, role=anon")
 *         which is not a secret but tells us which key was pasted.
 */

const SECRET_PATTERNS = [
  /\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}/g,                       // bcrypt hash
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, // JWT
  /\bsb_(?:secret|publishable|legacy)_[A-Za-z0-9_-]{6,}\b/g,    // new-style keys
  /\b[0-9a-f]{32,}\b/gi,                                        // hex tokens/hashes
  /phoenix_session=[^;\s]+/g                                    // raw session cookie
];

/** Strip anything credential-shaped out of a string before it is logged. */
function redact(text) {
  let out = String(text === undefined || text === null ? '' : text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/**
 * Turn any PostgREST / fetch error into one safe, loggable line.
 * PostgREST errors carry {code,message,details,hint}; network errors do not.
 */
function describeError(error) {
  if (!error) return 'none';
  if (typeof error === 'string') return redact(error);
  const parts = [];
  if (error.code) parts.push('code=' + redact(error.code));
  if (error.message) parts.push('message=' + redact(error.message));
  if (error.details) parts.push('details=' + redact(error.details));
  if (error.hint) parts.push('hint=' + redact(error.hint));
  if (error.status) parts.push('http=' + redact(error.status));
  if (!parts.length && error.name) parts.push('name=' + redact(error.name));
  return parts.join(' | ') || redact(JSON.stringify(error));
}

function authLog(level, message) {
  const line = '[PHOENIX auth] ' + message;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Log one failed database operation. `op` must never contain user input. */
function logDbError(op, error) {
  authLog('error', op + ' -> ' + describeError(error));
}

/**
 * A short, non-sensitive reference code the browser may show so a bug report
 * can be matched to a log line. Postgres codes reveal nothing useful to an
 * attacker but make support instant.
 */
function userRef(error) {
  const code = error && error.code ? String(error.code) : '';
  if (code === '42501') return 'DB-PERMISSION';
  if (code === '23514') return 'DB-CONSTRAINT';
  if (code === '23503') return 'DB-FOREIGN-KEY';
  if (code === '23505') return 'DB-DUPLICATE';
  if (code === '23502') return 'DB-NOT-NULL';
  if (code === 'PGRST205' || code === '42P01') return 'DB-TABLE-MISSING';
  if (code === 'PGRST125') return 'DB-BAD-PATH';
  if (code === 'PGRST202' || code === '42883') return 'DB-FUNCTION-MISSING';
  if (code === '401' || code === '403') return 'DB-KEY-REJECTED';
  if (error && error.__network) return 'DB-UNREACHABLE';
  return 'DB-ERROR';
}

/** One-line actionable hint for the operator, printed next to the error. */
function hintFor(error) {
  const code = error && error.code ? String(error.code) : '';
  if (code === '42501') {
    return '42501 = permission denied / row-level security. The value in ' +
      'SUPABASE_SERVICE_ROLE_KEY is almost certainly the ANON (or publishable) ' +
      'key. It must be the service_role / secret key.';
  }
  if (code === '401' || code === '403') {
    return 'The API key was rejected. Check SUPABASE_SERVICE_ROLE_KEY is complete ' +
      'and unmodified (no spaces, no quotes, no line break).';
  }
  if (code === 'PGRST205' || code === '42P01') {
    return 'Table not found. Re-run sql/phase1-accounts.sql in the Supabase SQL Editor.';
  }
  if (code === 'PGRST125') {
    return 'PGRST125 = the request path was invalid. SUPABASE_URL must be the BARE ' +
      'project URL (https://<ref>.supabase.co) with no path - never the REST URL ' +
      'that ends in /rest/v1, because the client adds that itself.';
  }
  if (code === 'PGRST202' || code === '42883') {
    return 'Function not found. Re-run sql/phase1-accounts.sql (creates claim_owner).';
  }
  if (error && error.__network) {
    return 'Supabase could not be reached. Check SUPABASE_URL is the project REST ' +
      'URL and looks like https://<ref>.supabase.co';
  }
  if (code === '23514') {
    return 'A check constraint rejected the row (username/password_hash/role format).';
  }
  return '';
}

/**
 * Describe the API key by TYPE ONLY. The key itself is never printed.
 * A legacy JWT carries its Postgres role in the (unencrypted) payload - that
 * role is exactly what decides whether RLS lets us in, so it is the single
 * most useful thing to know when registration fails.
 */
function describeKey(key) {
  if (!key) return 'MISSING';
  if (key.startsWith('sb_secret_')) return 'new-style secret key (service role)';
  if (key.startsWith('sb_publishable_')) {
    return 'new-style PUBLISHABLE key (acts as anon) -- WRONG for SUPABASE_SERVICE_ROLE_KEY';
  }
  if (key.startsWith('eyJ')) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const role = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role;
      return 'legacy JWT (role claim: ' + (role || 'unreadable') + ')';
    } catch (e) {
      return 'legacy JWT (role claim unreadable)';
    }
  }
  return 'unrecognised format';
}

/**
 * Startup self-check. Runs once, after listen(), so it never delays boot.
 * Answers the four questions that matter without anyone having to guess:
 *   1. is Supabase configured and is the URL valid?
 *   2. which KEY TYPE was pasted (wrong key = the classic cause of this bug)?
 *   3. is Supabase reachable from this server?
 *   4. can we actually read public.accounts (table exists, grants OK)?
 *
 * READ-ONLY - it never writes a row.
 */
async function probe() {
  if (!isConfigured()) {
    authLog('warn', 'probe: NOT CONFIGURED (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ' +
      'missing). Auth endpoints answer 503 and the multiplayer gate stays open.');
    return;
  }

  // Report the SHAPE of the configured value. A URL path is not a secret, so
  // it is shown - and a stray path there is exactly what caused PGRST125,
  // which the previous version of this probe hid by printing only the host.
  try {
    const raw = new URL(RAW_SUPABASE_URL);
    if (raw.protocol !== 'https:' &&
        raw.hostname !== 'localhost' && raw.hostname !== '127.0.0.1') {
      // The classic other mistake: pasting the Postgres connection string
      // (postgresql://postgres:...@...pooler.supabase.co:6543/postgres) here.
      // That carries a DATABASE PASSWORD, so the URL itself is never echoed -
      // only its scheme, which contains no credentials.
      authLog('error', 'probe: SUPABASE_URL has the wrong scheme (' + raw.protocol +
        '). That is a database connection string, not the REST API URL. Use the ' +
        'bare project URL, https://<project-ref>.supabase.co');
      return;
    }
  } catch (e) {
    authLog('error', 'probe: SUPABASE_URL is not a valid URL. It must look like ' +
      'https://<project-ref>.supabase.co');
    return;
  }

  let parsed;
  try {
    parsed = new URL(SUPABASE_URL);
  } catch (e) {
    authLog('error', 'probe: SUPABASE_URL is not usable after normalising. It must ' +
      'look like https://<project-ref>.supabase.co');
    return;
  }
  const base = parsed.origin;
  const rawPath = new URL(RAW_SUPABASE_URL).pathname;

  authLog('log', 'probe: url=' + parsed.protocol + '//' + parsed.host +
    ' | key=' + describeKey(SUPABASE_SERVICE_ROLE_KEY) +
    ' | owner-setup-key=' + (OWNER_SETUP_KEY ? 'set' : 'NOT set'));

  if (rawPath && rawPath !== '/') {
    authLog('warn', 'probe: SUPABASE_URL contained the path "' + rawPath + '". It has ' +
      'been removed automatically: supabase-js appends /rest/v1 itself, and leaving ' +
      'it in place makes the client request /rest/v1/rest/v1/... which PostgREST ' +
      'rejects with PGRST125. The Render env var can still be corrected to the bare ' +
      'project URL, but registration will work either way.');
  }

  // 3) Reachability (a plain GET on the REST root - no data touched).
  try {
    const res = await fetch(base + '/rest/v1/', {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY },
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined
    });
    authLog(res.ok ? 'log' : 'warn', 'probe: REST endpoint HTTP ' + res.status);
  } catch (e) {
    const err = new Error(redact(e && e.message)); err.__network = true;
    logDbError('probe: Supabase REST endpoint unreachable', err);
    authLog('error', 'probe: ' + hintFor(err));
    return;
  }

  // 4) Can we read the accounts table? Proves connectivity + key + schema
  //    cache + SELECT grant in a single round trip.
  try {
    const { data, error } = await client().from('accounts').select('id').limit(1);
    if (error) {
      logDbError('probe: cannot READ public.accounts', error);
      const hint = hintFor(error);
      if (hint) authLog('error', 'probe: ' + hint);
      return;
    }
    authLog('log', 'probe: public.accounts READ OK (' + (data ? data.length : 0) +
      ' row(s)) -- table exists and the key can reach it.');
  } catch (e) {
    logDbError('probe: public.accounts read threw', e);
    return;
  }

  // 5) WRITE permissions - the part a READ cannot prove. RLS silently returns
  //    ZERO ROWS on a blocked SELECT rather than an error, so a rejected write
  //    is indistinguishable from an empty table. This probe deliberately
  //    violates a CHECK constraint (empty username / role), so the row can
  //    never be stored - but it runs the real permission and RLS checks first,
  //    which is precisely what registration needs to pass.
  //
  //    Reaching here at all proves the table exists, and both format checks
  //    live in that same CREATE TABLE, so "23514" is the expected verdict.
  try {
    const { error } = await client().from('accounts')
      .insert({ username: '', password_hash: '', role: '' });
    if (!error) {
      authLog('error', 'probe: write probe UNEXPECTEDLY SUCCEEDED - the format ' +
        'check constraints are missing. Re-run sql/phase1-accounts.sql.');
      await client().from('accounts').delete()
        .eq('password_hash', '').eq('username', '');
    } else if (String(error.code) === '23514') {
      authLog('log', 'probe: public.accounts WRITE OK - permissions and RLS are ' +
        'correct (the probe row was refused by a check constraint, as designed).');
    } else {
      logDbError('probe: cannot WRITE public.accounts', error);
      const hint = hintFor(error);
      if (hint) authLog('error', 'probe: ' + hint);
    }
  } catch (e) {
    logDbError('probe: public.accounts write threw', e);
  }

  authLog('log', 'probe: if a registration still fails, the exact error will be ' +
    'logged here as "register: ..." on the next attempt.');
}

/* ---------- token helpers ---------- */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* ---------- cookies ---------- */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const map = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      let v = pair.slice(idx + 1).trim();
      try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
      map[k] = v;
    }
  });
  return map;
}
function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
}
function sessionCookie(token, maxAgeSec, secure) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}
function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax` + (secure ? '; Secure' : '');
}

/* ---------- session lifecycle ---------- */
async function getSessionAccount(req) {
  if (!isConfigured()) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { data: session, error } = await client()
    .from('sessions')
    .select('account_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    // No session is normal (signed out / expired); a broken QUERY is not.
    logDbError('session lookup failed', error);
    return null;
  }
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await client().from('sessions').delete().eq('token_hash', tokenHash);
    return null;
  }
  const { data: account, error: accountError } = await client()
    .from('accounts')
    .select('id, username, role, email, email_verified_at')
    .eq('id', session.account_id)
    .maybeSingle();

  let accountRow = account;
  let accountError2 = accountError;
  // Before sql/email-verification.sql has been run those two columns do not
  // exist, and PostgREST answers 42703 / PGRST205 rather than returning null.
  // Retry on the original three columns so an existing player stays signed in
  // THROUGH the migration - never logged out, never asked to re-register.
  if (accountError2 && isMissingEmailColumns(accountError2)) {
    const retry = await client()
      .from('accounts')
      .select('id, username, role')
      .eq('id', session.account_id)
      .maybeSingle();
    accountRow = retry.data;
    accountError2 = retry.error;
  }

  if (accountError2) {
    logDbError('account lookup failed', accountError2);
    return null;
  }
  if (!accountRow) return null;
  // Project to the public fields explicitly. The query already asks for them,
  // but re-mapping here means NO consumer can ever receive a password hash or
  // any other column, whatever the database happens to return.
  return {
    id: accountRow.id,
    username: accountRow.username,
    role: accountRow.role,
    email: accountRow.email || null,
    emailVerified: Boolean(accountRow.email_verified_at)
  };
}

/**
 * True when an error means "this column is not there yet", as opposed to a
 * real database problem. 42703 is undefined_column; PGRST205 / PGRST204 are
 * PostgREST's schema-cache misses; 42P01 is a missing table.
 */
function isMissingEmailColumns(error) {
  const code = String((error && error.code) || '');
  return code === '42703' || code === 'PGRST205' || code === 'PGRST204' || code === '42P01';
}

/**
 * Creates a session row. Returns {token, expires} on success, or {error} on
 * failure. It deliberately does NOT throw: a throw here used to escape the
 * async HTTP handler as an unhandled rejection (which kills a Node 18+
 * process), turning a database hiccup into a dead server.
 */
async function createSession(accountId) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_SEC * 1000);
  const { error } = await client().from('sessions').insert({
    token_hash: tokenHash,
    account_id: accountId,
    expires_at: expires.toISOString()
  });
  if (error) return { error };
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return;
  const { error } = await client().from('sessions').delete().eq('token_hash', hashToken(token));
  if (error) logDbError('session delete failed', error); // logout must still succeed
}

/**
 * Address shape, deliberately permissive: Supabase's OTP is what proves
 * ownership of an address, not a regular expression. This only has to be tight
 * enough that obvious junk never reaches the mail provider.
 */
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>.]+(\.[^\s@,;<>.]+)+$/;
function validEmail(raw) {
  const email = String(raw === undefined || raw === null ? '' : raw).trim();
  return email.length >= 5 && email.length <= 254 && EMAIL_RE.test(email);
}

/* ---------- register / login ---------- */
async function register(username, password, email) {
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,22}$/.test(username)) {
    return { ok: false, message: 'Username must be 3-22 letters, digits or underscore.' };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }

  // Mandatory once sql/email-verification.sql has been run; optional before
  // it, so the migration can be applied to a live server without turning every
  // registration red in the meantime.
  const needsEmail = await schemaHasEmail();
  const suppliedEmail = String(email === undefined || email === null ? '' : email).trim();
  if (needsEmail && !validEmail(suppliedEmail)) {
    return { ok: false, message: 'A valid email address is required to play PHOENIX.' };
  }
  const normalizedEmail = validEmail(suppliedEmail) ? suppliedEmail : null;
  // Uniqueness check. The error is inspected too: a SILENT lookup failure
  // used to be treated as "no such user" and hide a broken database.
  const lookup = await client()
    .from('accounts').select('id').eq('username', username).maybeSingle();
  if (lookup.error) {
    logDbError('register: username lookup failed', lookup.error);
    return { ok: false, message: 'Accounts are temporarily unavailable. Try again shortly.',
             code: userRef(lookup.error) };
  }
  if (lookup.data) return { ok: false, message: 'That username is already taken.' };

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // The address goes on UNVERIFIED, from the very first row: a new account is
  // created with an email it has not proven, and only Supabase's OTP can flip
  // that. Never auto-verified, never skipped.
  const payload = { username, password_hash: passwordHash, role: 'player' };
  if (needsEmail && normalizedEmail) {
    payload.email = normalizedEmail;
    payload.email_verified_at = null;
  }

  // `.select()` (array form) rather than `.maybeSingle()`: an INSERT whose
  // RETURNING comes back empty is a real, distinguishable condition here, and
  // it should be reported instead of becoming a null dereference.
  const inserted = await client().from('accounts')
    .insert(payload)
    .select(needsEmail ? 'id, username, role, email, email_verified_at'
                       : 'id, username, role');

  if (inserted.error) {
    logDbError('register: INSERT into public.accounts failed (username=' +
      redact(username) + ')', inserted.error);
    const hint = hintFor(inserted.error);
    if (hint) authLog('error', 'register: ' + hint);
    if (String(inserted.error.message).includes('username_lower') ||
        String(inserted.error.code) === '23505') {
      return { ok: false, message: 'That username is already taken.' };
    }
    // Generic to the browser (no internals leak), specific in the log.
    return { ok: false, message: 'Registration failed. Please try again.',
             code: userRef(inserted.error) };
  }

  const row = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
  if (!row) {
    authLog('error', 'register: INSERT reported success but returned no row. ' +
      'This usually means row-level security filtered the RETURNING clause.');
    return { ok: false, message: 'Registration failed. Please try again.', code: 'DB-NO-ROW' };
  }

  const session = await createSession(row.id);
  if (session.error) {
    // The account EXISTS at this point - say so, instead of leaving the player
    // to register twice and hit "username already taken".
    logDbError('register: session INSERT failed (account created, sign-in failed)',
      session.error);
    return { ok: false,
             message: 'Your account was created, but sign-in failed. Please sign in instead.',
             code: userRef(session.error) };
  }
  return {
    ok: true,
    account: projectAccount(row),
    // The address that still owes a code, so the route knows to mail one.
    email: needsEmail ? normalizedEmail : null,
    token: session.token
  };
}

async function login(username, password) {
  username = String(username || '').trim();
  const withEmail = await schemaHasEmail();
  const lookup = await client()
    .from('accounts')
    .select(withEmail ? 'id, username, password_hash, role, email, email_verified_at'
                      : 'id, username, password_hash, role')
    .eq('username', username).maybeSingle();

  if (lookup.error) {
    // A broken query must NOT be reported as "wrong password" - that sends the
    // player round in circles while the database is down.
    logDbError('login: lookup failed', lookup.error);
    const hint = hintFor(lookup.error);
    if (hint) authLog('error', 'login: ' + hint);
    return { ok: false, message: 'Sign-in is temporarily unavailable. Try again shortly.',
             code: userRef(lookup.error) };
  }
  const account = lookup.data;

  // Always run a bcrypt compare so a missing user and a wrong password take
  // the same code path. The dummy is only ever used when there is no account,
  // and a malformed value must never turn into a 500.
  let ok = false;
  try {
    const hash = account ? account.password_hash : DUMMY_HASH;
    ok = await bcrypt.compare(String(password || ''), hash);
  } catch (e) {
    logDbError('login: bcrypt compare threw', e);
    ok = false;
  }
  if (!account || !ok) return { ok: false, message: 'Incorrect username or password.' };

  const session = await createSession(account.id);
  if (session.error) {
    logDbError('login: session INSERT failed', session.error);
    return { ok: false, message: 'Sign-in is temporarily unavailable. Try again shortly.',
             code: userRef(session.error) };
  }
  return { ok: true, account: projectAccount(account), token: session.token };
}

/**
 * The public shape of an account, and the ONLY shape anything downstream ever
 * sees. Built column by column so a password hash, an internal flag or a
 * column added by a future migration can never leak into a response, a log or
 * a websocket message.
 */
function projectAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    email: row.email || null,
    emailVerified: Boolean(row.email_verified_at)
  };
}

/* ---------- owner claim (atomic, via the DB RPC) ---------- */
async function claimOwner(accountId, setupKey) {
  if (!OWNER_SETUP_KEY) {
    return { ok: false, message: 'Owner claim is not configured on this server.' };
  }
  // Constant-time comparison against the Render env var first: a wrong key is
  // rejected here without touching the database at all.
  const supplied = Buffer.from(String(setupKey || ''));
  const expected = Buffer.from(OWNER_SETUP_KEY);
  const keyOk =
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
  if (!keyOk) return { ok: false, message: 'Invalid setup key.' };

  // The database does the real work in ONE transaction: it re-hashes the key,
  // locks the single claim row, verifies the account and assigns the role.
  const { data, error } = await client().rpc('claim_owner', {
    p_account: accountId,
    p_setup_key: String(setupKey)
  });
  if (error) {
    logDbError('claim-owner: RPC public.claim_owner failed', error);
    const hint = hintFor(error);
    if (hint) authLog('error', 'claim-owner: ' + hint);
    return { ok: false, message: 'Could not claim ownership. Please try again.',
             code: userRef(error) };
  }

  const result = data || {};
  if (result.ok) return { ok: true };
  authLog('warn', 'claim-owner: refused by the database, reason=' +
    redact(result.reason || 'unknown'));

  // Map the SQL function's `reason` codes to friendly copy.
  const reasons = {
    'claim-not-initialised': 'Owner setup has not been prepared on this server yet.',
    'already-claimed': 'Ownership has already been claimed.',
    'invalid-key': 'Invalid setup key.',
    'account-not-found': 'Your account could not be found. Sign in again.',
    'already-owner': 'This account is already the owner.'
  };
  return { ok: false, message: reasons[result.reason] || 'Could not claim ownership.' };
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_SEC,
  isConfigured, probe,
  client, freshClient, hashToken, parseCookies, isSecure,
  getSessionAccount, sessionCookie, clearSessionCookie,
  register, login, destroySession, claimOwner,
  schemaHasEmail, projectAccount, validEmail, _resetEmailProbe,
  describeError, redact
};
