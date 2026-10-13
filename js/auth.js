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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_SETUP_KEY = process.env.PHOENIX_OWNER_SETUP_KEY;

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
  if (error || !session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await client().from('sessions').delete().eq('token_hash', tokenHash);
    return null;
  }
  const { data: account } = await client()
    .from('accounts')
    .select('id, username, role')
    .eq('id', session.account_id)
    .maybeSingle();
  if (!account) return null;
  // Project to the three public fields explicitly. The query already asks for
  // them, but re-mapping here means NO consumer can ever receive a password
  // hash or any other column, whatever the database happens to return.
  return { id: account.id, username: account.username, role: account.role };
}

async function createSession(accountId) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_SEC * 1000);
  const { error } = await client().from('sessions').insert({
    token_hash: tokenHash,
    account_id: accountId,
    expires_at: expires.toISOString()
  });
  if (error) throw error;
  return { token, expires };
}

async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    await client().from('sessions').delete().eq('token_hash', hashToken(token));
  }
}

/* ---------- register / login ---------- */
async function register(username, password) {
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,22}$/.test(username)) {
    return { ok: false, message: 'Username must be 3-22 letters, digits or underscore.' };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }
  // Case-insensitive uniqueness check (the DB index enforces it too).
  const { data: existing } = await client()
    .from('accounts').select('id').eq('username', username).maybeSingle();
  if (existing) return { ok: false, message: 'That username is already taken.' };

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { data, error } = await client().from('accounts')
    .insert({ username, password_hash: passwordHash, role: 'player' })
    .select('id, username, role').maybeSingle();
  if (error) {
    if (String(error.message).includes('username_lower') || String(error.code).includes('23505')) {
      return { ok: false, message: 'That username is already taken.' };
    }
    return { ok: false, message: 'Registration failed. Please try again.' };
  }
  const { token } = await createSession(data.id);
  return { ok: true, account: { id: data.id, username: data.username, role: data.role }, token };
}

async function login(username, password) {
  username = String(username || '').trim();
  const { data: account } = await client()
    .from('accounts').select('id, username, password_hash, role')
    .eq('username', username).maybeSingle();

  // Always run a bcrypt compare so a missing user and a wrong password take
  // the same code path. The dummy is only ever used when there is no account,
  // and a malformed value must never turn into a 500.
  let ok = false;
  try {
    const hash = account ? account.password_hash : DUMMY_HASH;
    ok = await bcrypt.compare(String(password || ''), hash);
  } catch (e) {
    ok = false;
  }
  if (!account || !ok) return { ok: false, message: 'Incorrect username or password.' };

  const { token } = await createSession(account.id);
  return { ok: true, account: { id: account.id, username: account.username, role: account.role }, token };
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
  if (error) return { ok: false, message: 'Could not claim ownership. Please try again.' };

  const result = data || {};
  if (result.ok) return { ok: true };

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
  isConfigured,
  client, hashToken, parseCookies, isSecure,
  getSessionAccount, sessionCookie, clearSessionCookie,
  register, login, destroySession, claimOwner
};
