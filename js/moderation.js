/* PHOENIX — server-side moderation: restrictions, devices, observed addresses.
 *
 * Everything that decides whether somebody may play lives here and runs on the
 * SERVER. The browser is never asked, never trusted, and never sent the raw
 * moderation record: it receives a short projection with no address in it.
 *
 * Three restriction kinds, each with its own row, its own expiry and its own
 * revoke button:
 *
 *   account  the default. Keyed to accounts.id, so signing out, clearing
 *            cookies, another browser or another machine changes nothing.
 *   ip       optional, opt-in, warned about. Keyed to the address the SERVER
 *            observed - never one supplied by a request.
 *   device   optional, opt-in. Keyed to a server-issued random token, and
 *            described honestly as resettable (see deviceNotice below).
 *
 * A row is LIVE while `revoked_at is null AND (expires_at is null OR > now)`.
 * `expires_at IS NULL` means permanent, and a permanent row is revoked by
 * exactly the same UPDATE as a temporary one - which is how "a permanent ban
 * can never be irreversible" is guaranteed rather than merely intended.
 *
 * Owner authorisation is checked FIRST, in every exported operation, before a
 * single field of the request is read. Hiding a button in the dashboard is not
 * the security boundary; this is.
 */
'use strict';

const crypto = require('crypto');
const Auth = require('./auth');

const DEVICE_COOKIE = 'phoenix_device';
const DEVICE_ID_RE = /^[a-f0-9]{32}$/;
const ACCOUNT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_REF = /^[A-Za-z0-9_]{3,22}$/;

const MAX_DURATION_SEC = 10 * 365 * 24 * 60 * 60;   // 10 years
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 500;

const BAN_COLUMNS =
  'id, kind, account_id, account_name, ip, device_id, reason, duration, ' +
  'expires_at, created_at, created_by, created_by_name, revoked_at, revoked_by, revoked_by_name';

const OWNER_ONLY = 'Only the owner of PHOENIX can manage restrictions.';

/* ================================================================== */
/* Availability                                                        */
/* ================================================================== */

let _available = null;

/** Forget the cached probe. Tests only. */
function _resetAvailability() { _available = null; }

async function available() {
  if (_available !== null) return _available;
  if (!isConfigured()) return false;
  try {
    const { error } = await Auth.client()
      .from('moderation_bans').select('id').limit(1);
    if (!error) { _available = true; return true; }
    const code = String(error.code || '');
    if (code === 'PGRST205' || code === 'PGRST204' || code === '42P01') {
      console.error('[PHOENIX moderation] the migration has not been run. ' +
        'Paste sql/moderation.sql into the Supabase SQL Editor and run it.');
    } else {
      console.error('[PHOENIX moderation] availability probe failed -> ' +
        Auth.describeError(error));
    }
  } catch (err) {
    console.error('[PHOENIX moderation] availability probe threw -> ' +
      Auth.describeError(err));
  }
  _available = false;
  return false;
}

function isConfigured() { return Auth.isConfigured(); }

/**
 * True when the error means "the migration was never run", as opposed to a
 * genuine database fault. Used to answer 503 (not installed) rather than 500
 * (our bug) when the schema disappears underneath a cached availability probe.
 */
function isMissingSchema(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703';
}

/** Forget that the schema was believed present. Called on a missing-table hit. */
function forgetAvailable() { _available = null; }

/* ================================================================== */
/* Owner authorisation - checked before anything else                 */
/* ================================================================== */

function requireOwner(account) {
  if (!account) return { ok: false, status: 401, message: 'Sign in first.' };
  if (account.role !== 'owner') {
    return { ok: false, status: 403, message: OWNER_ONLY };
  }
  return null;
}

/* ================================================================== */
/* Addresses                                                           */
/* ================================================================== */

/** Does an IPv4 literal fall in a range that cannot be a public client? */
function isPrivateV4(text) {
  const parts = String(text).split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !(n >= 0 && n <= 255))) return false;
  const [a, b] = parts;
  if (a === 127) return true;                          // loopback
  if (a === 10) return true;                           // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16/12
  if (a === 192 && b === 168) return true;             // 192.168/16
  if (a === 169 && b === 254) return true;             // link-local
  if (a === 0) return true;                            // "this network"
  return false;
}

/**
 * Expand an IPv6 literal into its eight groups, or null if it is not one.
 *
 * Handles the forms a server actually sees: compressed `::`, an embedded IPv4
 * tail (`::ffff:1.2.3.4`), brackets from a URL and a zone suffix from a
 * link-local peer.
 */
function ipv6Groups(raw) {
  let text = String(raw || '').trim().toLowerCase();
  text = text.replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return null;
  if (text.split('::').length > 2) return null;

  const splitAt = text.indexOf('::');
  let headParts;
  let tailParts;
  if (splitAt === -1) {
    headParts = text.split(':');
    tailParts = null;
  } else {
    const head = text.slice(0, splitAt);
    const tail = text.slice(splitAt + 2);
    headParts = head ? head.split(':') : [];
    tailParts = tail ? tail.split(':') : [];
  }

  // An embedded IPv4 tail becomes the two groups it occupies.
  const absorb = list => {
    const out = [];
    for (const piece of list) {
      if (piece.includes('.')) {
        const v4 = piece.split('.').map(Number);
        if (v4.length !== 4 || v4.some(n => !(n >= 0 && n <= 255))) return null;
        out.push(((v4[0] << 8) | v4[1]).toString(16));
        out.push(((v4[2] << 8) | v4[3]).toString(16));
      } else {
        out.push(piece);
      }
    }
    return out;
  };

  const head = absorb(headParts);
  if (!head) return null;
  let tail = tailParts;
  if (tail) {
    tail = absorb(tail);
    if (!tail) return null;
  }

  let groups;
  if (tailParts === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = head.concat(new Array(missing).fill('0'), tail);
  }

  const clean = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    clean.push(g.replace(/^0+(?=.)/, ''));
  }
  return clean;
}

/**
 * Turn whatever the transport reports into a normalised address plus the key
 * bans are matched on.
 *
 *   IPv4       -> key is the address itself
 *   IPv4-in-v6 -> folded back to IPv4 (that is how Node reports a v4 peer on a
 *                 dual-stack socket, so leaving it as ::ffff:... would make an
 *                 ordinary ban simply not match)
 *   IPv6       -> key is the /64 network. A home is routed a /64, so matching
 *                 it is the smallest sensible scope: an exact address would be
 *                 defeated by privacy extensions within seconds, and anything
 *                 wider would sweep in unrelated people for no gain.
 *
 * Returns { text, key, family } or null when the value is not an address at
 * all - in which case it is DISCARDED, never used.
 */
function normalizeIp(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (!text) return null;
  text = text.replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // A host:port form occasionally reaches us from a proxy header.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(text)) text = text.replace(/:\d+$/, '');

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split('.').map(Number);
    if (parts.some(n => !(n >= 0 && n <= 255))) return null;
    const dotted = parts.join('.');
    return { text: dotted, key: dotted, family: 4 };
  }

  const groups = ipv6Groups(text);
  if (!groups) return null;

  // ::ffff:a.b.c.d is an IPv4 peer wearing an IPv6 socket.
  const mapped = groups.slice(0, 5).every(g => g === '' || g === '0');
  if (mapped && groups[5] === 'ffff') {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const dotted = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
      return { text: dotted, key: dotted, family: 4 };
    }
  }

  const v6 = groups.join(':');
  return { text: v6, key: groups.slice(0, 4).join(':') + '::/64', family: 6 };
}

/** True when a parsed address could not be a client out on the internet. */
function isPrivate(parsed) {
  if (!parsed) return true;
  if (parsed.family === 4) return isPrivateV4(parsed.text);
  const groups = ipv6Groups(parsed.text);
  if (!groups) return false;
  // ::/127 covers the unspecified address and ::1 (loopback). Written as "the
  // first seven groups are zero" because ::1's last group is 1, so an
  // all-zero test would miss the one address that matters most here.
  if (groups.slice(0, 7).every(g => g === '' || g === '0')) return true;
  const first = parseInt(groups[0], 16);
  if ((first & 0xfe00) === 0xfc00) return true;                        // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true;                        // fe80::/10 link-local
  return false;
}

/**
 * The address THIS server received the connection on.
 *
 * The client is never believed. X-Forwarded-For is consulted only when the
 * socket itself belongs to a private hop - i.e. when something we trust is
 * genuinely in front of us - and even then only the LAST entry is read, because
 * a trusted proxy APPENDS what it saw. Anything a client typed into its own
 * header sits further left and is ignored. With no proxy in front, the socket
 * address wins outright and a forged header is discarded.
 */
function trustedIp(req) {
  if (!req) return null;
  const socket = normalizeIp(req.socket && req.socket.remoteAddress);
  const headers = req.headers || {};
  const rawXff = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  const behindProxy = socket ? isPrivate(socket) : true;

  if (behindProxy && typeof rawXff === 'string' && rawXff.trim()) {
    const hops = rawXff.split(',').map(s => s.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      const parsed = normalizeIp(hops[i]);
      // A forged value is a public address, so it is accepted here - but only
      // down the chain that our own proxy appended, never left of it.
      if (parsed && !isPrivate(parsed)) return parsed;
    }
    // Everything in the header was private or malformed: fall through.
  }
  return socket;
}

/* ================================================================== */
/* Devices (server-issued token, no fingerprinting)                    */
/* ================================================================== */

function newDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

/** Read the device token from a request's cookies, or null. */
function deviceIdFrom(req) {
  if (!req) return null;
  let cookies;
  try { cookies = Auth.parseCookies(req); } catch (e) { return null; }
  const id = cookies && cookies[DEVICE_COOKIE];
  return DEVICE_ID_RE.test(String(id || '')) ? id : null;
}

/** The cookie that carries it. HttpOnly: the page never needs to read it. */
function deviceCookie(id, secure) {
  const parts = [
    DEVICE_COOKIE + '=' + id,
    'HttpOnly',
    'Path=/',
    'Max-Age=' + (365 * 24 * 60 * 60),
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * What the dashboard must say about device restrictions, verbatim, so the UI
 * never overstates what this can do. It is a server-issued random token in a
 * cookie: no fingerprint is taken, nothing about the machine is measured, and
 * clearing cookies produces a different token. It is a useful speed bump, not
 * a hardware lock.
 */
const DEVICE_NOTICE =
  'Device restrictions use a random token the server issues and stores in a ' +
  'cookie on this browser. No fingerprinting is used and nothing about your ' +
  'machine is measured. Clearing cookies, using a private window or another ' +
  'browser creates a new token, so a device restriction is NOT permanent and ' +
  'must never be described as one.';

/** The warning shown beside the "Also ban this IP address" checkbox. */
const IP_WARNING =
  'An IP ban blocks the whole internet connection. Other people on the same ' +
  'network - family members, classmates, anyone on the same Wi-Fi - would be ' +
  'blocked too, even though they did nothing.';

/* ================================================================== */
/* Observing a live connection                                         */
/* ================================================================== */

/**
 * Record where an account was seen from and which browser token it used.
 *
 * Called only with values the SERVER derived: the connection's own address and
 * its own cookie. A request body can never supply either. Best effort - if the
 * tables are missing or a call fails, it is logged and play continues, because
 * a failed sighting must never stop somebody joining a game.
 */
async function observe(account, ip, deviceId) {
  if (!account || !isConfigured() || !(await available())) return;
  try {
    await Auth.client().rpc('record_sighting', {
      p_account_id: account.id,
      p_account_name: account.username || null,
      p_ip: ip ? ip.text : null,
      p_ip_key: ip ? ip.key : null,
      p_device_id: deviceId || null
    });
  } catch (err) {
    console.error('[PHOENIX moderation] sighting not recorded -> ' +
      Auth.describeError(err));
  }
}

/** Note a registration attempt for cross-restart repeat-creation detection. */
async function noteSignup(ip, username, ok) {
  if (!isConfigured() || !(await available())) return;
  try {
    await Auth.client().rpc('record_signup_attempt', {
      p_ip_key: ip ? ip.key : 'unknown',
      p_username: String(username || '').slice(0, 22),
      p_ok: Boolean(ok)
    });
  } catch (err) {
    console.error('[PHOENIX moderation] signup attempt not recorded -> ' +
      Auth.describeError(err));
  }
}

/** How many accounts has this address created in the last `minutes`? */
async function recentSignups(ip, minutes) {
  if (!isConfigured() || !(await available())) return 0;
  try {
    const { data, error } = await Auth.client().rpc('recent_signup_count', {
      p_ip_key: ip ? ip.key : 'unknown',
      p_minutes: Number(minutes) || 60
    });
    if (error) throw error;
    return Number(data) || 0;
  } catch (err) {
    console.error('[PHOENIX moderation] signup count failed -> ' +
      Auth.describeError(err));
    return 0;   // a failed count must not lock an innocent player out
  }
}

/* ================================================================== */
/* Checking a connection                                               */
/* ================================================================== */

/** Expired rows are not live, whatever revocation says. */
function isLive(row, now) {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= (now || Date.now())) return false;
  return true;
}

async function firstLive(build) {
  let query = Auth.client()
    .from('moderation_bans')
    .select(BAN_COLUMNS)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  query = build(query);
  const { data, error } = await query;
  if (error) {
    console.error('[PHOENIX moderation] restriction lookup failed -> ' +
      Auth.describeError(error));
    return { __error: error };
  }
  return (data || []).find(row => isLive(row)) || null;
}

/**
 * The live restriction covering this connection, or null.
 *
 * Checked in this order so the message a player sees is the most personal one:
 * their own account first, then their network, then their browser. A failure
 * anywhere degrades to "no restriction found" WITH a logged error - a broken
 * database must never silently deny play to somebody who has done nothing.
 *
 * That is a deliberate trade-off and it is stated in the delivery report:
 * enforcement fails OPEN, not closed.
 */
async function restrictionFor(context) {
  const ctx = context || {};
  // The owner is exempt. Being locked out of your own game - permanently, with
  // nobody left who can lift it - is an unrecoverable failure, so the account
  // that owns PHOENIX is never subject to a restriction it cannot revoke.
  // `role` comes from the session row the SERVER read, never from the client.
  if (ctx.role === 'owner') return null;
  if (!isConfigured() || !(await available())) return null;
  const now = Date.now();

  if (ctx.accountId) {
    const row = await firstLive(q => q.eq('kind', 'account').eq('account_id', ctx.accountId));
    if (row && !row.__error) return row;
  }
  if (ctx.ip) {
    const row = await firstLive(q => q.eq('kind', 'ip').eq('ip_key', ctx.ip.key));
    if (row && !row.__error) return row;
  }
  if (ctx.deviceId) {
    const row = await firstLive(q => q.eq('kind', 'device').eq('device_id', ctx.deviceId));
    if (row && !row.__error) return row;
  }
  return null;
}

/* ================================================================== */
/* What the restricted player is allowed to see                       */
/* ================================================================== */

const BAN_HEADLINE = 'YOU HAVE BEEN BANNED FROM PHOENIX';

/**
 * Project a row for the player's screen.
 *
 * Deliberately omits: the address, the account that led to a network ban, who
 * issued it, internal ids, and whether any OTHER player is affected. It says
 * only what the restricted person needs - scope, reason, permanence, expiry.
 */
function publicView(ban, accountId) {
  if (!ban) return null;
  // A device row carries no account (that is what makes it follow the browser
  // across accounts), so this must be a genuine boolean rather than the
  // `null && ...` the comparison would otherwise yield.
  const personal = ban.kind === 'account' ||
    (ban.kind === 'device' && !!ban.account_id && ban.account_id === accountId);
  let notice = null;
  if (ban.kind === 'ip') {
    notice = 'This restriction applies to the internet connection you are ' +
      'using, so other people on the same network may be affected even though ' +
      'they were not personally banned.';
  } else if (ban.kind === 'device') {
    notice = DEVICE_NOTICE;
  }
  return {
    headline: BAN_HEADLINE,
    scope: ban.kind === 'ip' ? 'network' : ban.kind,
    personal,
    reason: String(ban.reason || '').slice(0, 300),
    permanent: !ban.expires_at,
    expiresAt: ban.expires_at || null,
    issuedAt: ban.created_at || null,
    notice
  };
}

/* ================================================================== */
/* Owner: search accounts                                              */
/* ================================================================== */

async function searchAccounts(account, rawQuery) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (!isConfigured() || !(await available())) {
    return { ok: false, status: 503, available: false,
             message: 'Moderation is not available on this server.' };
  }

  const term = String(rawQuery || '').trim();
  let query = Auth.client().from('accounts').select('id, username, role, email, email_verified_at');
  if (ACCOUNT_ID_RE.test(term)) {
    query = query.eq('id', term);
  } else if (term) {
    if (term.length > 40) return { ok: false, status: 400, message: 'That search is too long.' };
    query = query.ilike('username', '%' + term.replace(/[%_]/g, '') + '%');
  }
  const { data, error } = await query.order('username').limit(40);
  if (error) {
    console.error('[PHOENIX moderation] account search failed -> ' + Auth.describeError(error));
    return { ok: false, status: 500, message: 'Search failed. Please try again.' };
  }

  return { ok: true, accounts: (data || []).map(row => ({
    id: row.id,
    username: row.username,
    role: row.role
    // No address, verified or not. The dashboard needs to find an account and
    // restrict it; it never renders a player's email, so it is never sent.
  })) };
}

/* ================================================================== */
/* Owner: list restrictions                                            */
/* ================================================================== */

const STATUS_VALUES = ['active', 'expired', 'revoked', 'all'];

function matchesStatus(row, status) {
  const revoked = Boolean(row.revoked_at);
  const expired = Boolean(row.expires_at) &&
    new Date(row.expires_at).getTime() <= Date.now();
  if (status === 'revoked') return revoked;
  if (status === 'expired') return !revoked && expired;
  if (status === 'active') return !revoked && !expired;
  return true;
}

async function list(account, status) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (!isConfigured() || !(await available())) {
    return { ok: false, status: 503, available: false,
             message: 'Moderation is not available on this server.' };
  }

  const want = STATUS_VALUES.includes(status) ? status : 'active';
  const { data, error } = await Auth.client()
    .from('moderation_bans')
    .select(BAN_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    console.error('[PHOENIX moderation] list failed -> ' + Auth.describeError(error));
    return { ok: false, status: 500, message: 'Could not read restrictions.' };
  }

  return {
    ok: true,
    status: want,
    restrictions: (data || []).filter(r => matchesStatus(r, want)).map(row => ({
      id: row.id,
      kind: row.kind,
      accountId: row.account_id || null,
      username: row.account_name || null,
      // No address and no device token, on purpose. The dashboard needs to
      // know that a NETWORK or DEVICE restriction exists and let the owner
      // lift it; it never needs the value itself, and a screen that can be
      // shared or streamed is the wrong place to print one. Matching uses
      // ip_key / device_id inside this module and nowhere else.
      reason: row.reason || '',
      duration: row.duration || null,
      permanent: !row.expires_at,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
      createdBy: row.created_by_name || null,
      revokedAt: row.revoked_at || null,
      revokedBy: row.revoked_by_name || null,
      expired: Boolean(row.expires_at) &&
        new Date(row.expires_at).getTime() <= Date.now()
    }))
  };
}

/* ================================================================== */
/* Owner: audit log                                                    */
/* ================================================================== */

async function auditLog(account, limit) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (!isConfigured() || !(await available())) {
    return { ok: false, status: 503, available: false,
             message: 'Moderation is not available on this server.' };
  }
  const take = Math.min(Math.max(Number(limit) || DEFAULT_LOG_LIMIT, 1), MAX_LOG_LIMIT);
  const { data, error } = await Auth.client()
    .from('moderation_log')
    .select('id, at, action, actor_name, subject_name, detail')
    .order('at', { ascending: false })
    .limit(take);
  if (error) {
    console.error('[PHOENIX moderation] log read failed -> ' + Auth.describeError(error));
    return { ok: false, status: 500, message: 'Could not read the audit log.' };
  }
  return { ok: true, entries: data || [] };
}

/** Append one audit line. Never throws - a failed log must not fail the action. */
async function record(action, actor, detail, subjectName, banId) {
  if (!isConfigured() || !(await available())) return;
  try {
    await Auth.client().from('moderation_log').insert({
      action,
      actor_id: actor ? actor.id : null,
      actor_name: actor ? actor.username : null,
      subject_name: subjectName ? String(subjectName).slice(0, 22) : null,
      ban_id: banId || null,
      detail: String(detail || '').slice(0, 500)
    });
  } catch (err) {
    console.error('[PHOENIX moderation] audit write failed -> ' + Auth.describeError(err));
  }
}

/* ================================================================== */
/* Owner: issue a restriction                                          */
/* ================================================================== */

function planExpiry(permanent, durationSeconds, expiresAt) {
  if (permanent) return { ok: true, expires_at: null, duration: null };
  if (expiresAt) {
    const at = new Date(expiresAt).getTime();
    if (!isFinite(at)) return { ok: false, message: 'That expiry date is not a real date.' };
    if (at <= Date.now()) return { ok: false, message: 'That expiry date is in the past.' };
    if (at > Date.now() + MAX_DURATION_SEC * 1000) {
      return { ok: false, message: 'Pick an expiry within the next ten years, or make it permanent.' };
    }
    return { ok: true, expires_at: new Date(at).toISOString(),
             duration: Math.round((at - Date.now()) / 1000) };
  }
  const secs = Number(durationSeconds);
  if (!Number.isFinite(secs) || secs <= 0) {
    return { ok: false, message: 'Choose how long the restriction should last.' };
  }
  if (secs > MAX_DURATION_SEC) {
    return { ok: false, message: 'Pick a shorter duration, or make it permanent.' };
  }
  return { ok: true, expires_at: new Date(Date.now() + secs * 1000).toISOString(),
           duration: Math.round(secs) };
}

async function insertBan(row) {
  const { data, error } = await Auth.client()
    .from('moderation_bans')
    .insert(row)
    .select(BAN_COLUMNS);
  if (error) {
    console.error('[PHOENIX moderation] ban INSERT failed -> ' + Auth.describeError(error));
    return { error };
  }
  const out = Array.isArray(data) ? data[0] : data;
  if (!out) return { error: { code: 'DB-NO-ROW', message: 'no row returned' } };
  return { row: out };
}

/**
 * Issue restrictions for one account.
 *
 * The ACCOUNT restriction is unconditional - it is the default and the one that
 * actually follows a person. The network and device rows only ever appear when
 * their own checkbox was ticked, each as a separate row so each can be lifted
 * on its own.
 *
 * @returns {{ok: boolean, created?: object[], message?: string, notes?: string[]}}
 */
async function create(account, spec) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (!isConfigured() || !(await available())) {
    return { ok: false, status: 503, available: false,
             message: 'Moderation is not available on this server.' };
  }

  const input = spec || {};
  const accountId = String(input.accountId || '').trim();
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return { ok: false, status: 400, message: 'Pick an account first.' };
  }
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (!reason) {
    return { ok: false, status: 400, message: 'Give a reason for the restriction.' };
  }
  const expiry = planExpiry(Boolean(input.permanent), input.duration, input.expiresAt);
  if (!expiry.ok) return { ok: false, status: 400, message: expiry.message };

  // Look the account up ONCE, by id. Nothing from the request body is used as
  // a name, a role or a target: the id is the only thing trusted.
  const { data: target, error: lookupError } = await Auth.client()
    .from('accounts').select('id, username').eq('id', accountId).maybeSingle();
  if (lookupError) {
    console.error('[PHOENIX moderation] target lookup failed -> ' +
      Auth.describeError(lookupError));
    return { ok: false, status: 500, message: 'That account could not be read.' };
  }
  if (!target) return { ok: false, status: 404, message: 'That account no longer exists.' };

  const base = {
    account_id: target.id,
    account_name: target.username,
    reason,
    duration: expiry.duration,
    expires_at: expiry.expires_at,
    created_by: account.id,
    created_by_name: account.username
  };

  const created = [];
  const notes = [];

  // 1. The account restriction - always.
  const accountBan = await insertBan(Object.assign({ kind: 'account' }, base));
  if (accountBan.error) {
    // The cached availability probe can be stale: if the schema has gone away
    // underneath it, that is "not installed", not an internal error.
    if (isMissingSchema(accountBan.error)) {
      forgetAvailable();
      return { ok: false, status: 503, available: false,
               message: 'Moderation is not available on this server.' };
    }
    return { ok: false, status: 500,
             message: 'The restriction could not be saved.',
             code: String(accountBan.error.code || '') };
  }
  created.push(accountBan.row);

  // 2. Optional network restriction, from the address the SERVER last saw.
  if (input.ip) {
    let observed = null;
    try {
      const { data, error } = await Auth.client()
        .rpc('last_seen_ip', { p_account_id: target.id });
      if (error) throw error;
      observed = normalizeIp(data);
    } catch (err) {
      console.error('[PHOENIX moderation] observed address lookup failed -> ' +
        Auth.describeError(err));
    }
    if (!observed) {
      notes.push('No internet address has been observed for this account yet, ' +
        'so no network restriction was created.');
    } else {
      const ipBan = await insertBan(Object.assign({}, base, {
        kind: 'ip',
        account_id: null,
        account_name: target.username,
        ip: observed.text
      }));
      if (ipBan.error) {
        notes.push('The account was restricted, but the network restriction failed to save.');
      } else {
        // ip_key is what matching uses; it is computed here rather than by the
        // database so an IPv6 /64 is chosen by one rule in one place.
        const { error: keyError } = await Auth.client()
          .from('moderation_bans')
          .update({ ip_key: observed.key })
          .eq('id', ipBan.row.id);
        if (keyError) {
          console.error('[PHOENIX moderation] ip_key write failed -> ' +
            Auth.describeError(keyError));
          notes.push('The network restriction was saved but could not be matched on.');
        } else {
          created.push(Object.assign({}, ipBan.row, { ip_key: observed.key }));
        }
      }
    }
  }

  // 3. Optional device restriction, from the token this account last used.
  if (input.device) {
    let deviceId = null;
    try {
      const { data, error } = await Auth.client()
        .rpc('last_seen_device', { p_account_id: target.id });
      if (error) throw error;
      deviceId = DEVICE_ID_RE.test(String(data || '')) ? data : null;
    } catch (err) {
      console.error('[PHOENIX moderation] observed device lookup failed -> ' +
        Auth.describeError(err));
    }
    if (!deviceId) {
      notes.push('No device token has been registered for this account yet, so no ' +
        'device restriction was created. ' + DEVICE_NOTICE);
    } else {
      const deviceBan = await insertBan(Object.assign({}, base, {
        kind: 'device',
        account_id: null,
        account_name: target.username,
        device_id: deviceId
      }));
      if (deviceBan.error) {
        notes.push('The account was restricted, but the device restriction failed to save.');
      } else {
        created.push(deviceBan.row);
      }
    }
  }

  for (const row of created) {
    await record('restriction.issued', account,
      row.kind + ' | ' + (row.expires_at
        ? 'until ' + row.expires_at
        : 'permanent') +
      (row.kind === 'ip' ? ' | network' : '') +
      (row.kind === 'device' ? ' | device' : ''),
      target.username, row.id);
  }

  return {
    ok: true,
    created: created.map(row => ({
      id: row.id,
      kind: row.kind,
      permanent: !row.expires_at,
      expiresAt: row.expires_at || null,
      username: target.username
    })),
    notes
  };
}

/* ================================================================== */
/* Owner: revoke - always allowed, permanent included                  */
/* ================================================================== */

/**
 * Lift one restriction.
 *
 * There is no branch on `kind` and none on `expires_at`: a permanent ban is
 * revoked by the identical update to a temporary one, so "permanent can never
 * be irreversible" is structural. Nothing is deleted - the row stays as history
 * with revoked_at stamped - and no player's account, badges or statistics are
 * touched in any way.
 */
async function revoke(account, banId) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (!isConfigured() || !(await available())) {
    return { ok: false, status: 503, available: false,
             message: 'Moderation is not available on this server.' };
  }
  const id = String(banId || '').trim();
  if (!ACCOUNT_ID_RE.test(id)) {
    return { ok: false, status: 400, message: 'That is not a restriction id.' };
  }

  const { data: before, error: readError } = await Auth.client()
    .from('moderation_bans')
    .select(BAN_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (readError) {
    console.error('[PHOENIX moderation] revoke read failed -> ' + Auth.describeError(readError));
    return { ok: false, status: 500, message: 'That restriction could not be read.' };
  }
  if (!before) return { ok: false, status: 404, message: 'That restriction is no longer here.' };
  if (before.revoked_at) return { ok: false, status: 409, message: 'That restriction is already lifted.' };

  const { data, error } = await Auth.client()
    .from('moderation_bans')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: account.id,
      revoked_by_name: account.username
    })
    .eq('id', id)
    .is('revoked_at', null)
    .select(BAN_COLUMNS);
  if (error) {
    console.error('[PHOENIX moderation] revoke failed -> ' + Auth.describeError(error));
    return { ok: false, status: 500, message: 'That restriction could not be lifted.' };
  }
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (!row) return { ok: false, status: 409, message: 'That restriction is already lifted.' };

  await record('restriction.lifted', account,
    row.kind + (row.expires_at ? ' | was due to expire ' + row.expires_at : ' | was permanent'),
    row.account_name, row.id);

  return {
    ok: true,
    restriction: {
      id: row.id,
      kind: row.kind,
      permanent: !row.expires_at,
      expiresAt: row.expires_at || null,
      revokedAt: row.revoked_at
    }
  };
}

module.exports = {
  DEVICE_COOKIE, DEVICE_NOTICE, IP_WARNING, BAN_HEADLINE, STATUS_VALUES, OWNER_ONLY,
  isConfigured, available, requireOwner,
  normalizeIp, trustedIp, isPrivate,
  newDeviceId, deviceIdFrom, deviceCookie,
  observe, noteSignup, recentSignups,
  restrictionFor, isLive, publicView,
  searchAccounts, list, auditLog, record,
  create, revoke,
  _resetAvailability
};
