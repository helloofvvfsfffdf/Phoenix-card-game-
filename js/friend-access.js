/* PHOENIX - a friend of the owner's sign-up.
 *
 * Some of the owner's friends cannot get through the email process: no
 * address, no mailbox, no code, no play. This is the way in for them, and it
 * is deliberately NOT a way for anybody else:
 *
 *   1. The friend types a username and a password and asks for permission.
 *      The request goes to the OWNER, not to a queue nobody reads.
 *   2. The owner sees it in their dashboard and accepts or declines.
 *   3. Accepted: the account is made with no email address at all, and it
 *      plays exactly as an account with a verified address does.
 *      Declined: the friend is told so, in as many words.
 *   4. Two minutes and no answer: the request times out and the friend is
 *      told that too.
 *
 * The password is hashed the moment the request is made and is never kept
 * in the clear, never logged and never sent back out. The request itself
 * lives in this process's memory for two minutes and is then swept away.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Auth = require('./auth');

/** Two minutes. The player is told exactly this long, and it is exactly this long.
 *  The environment can shorten it, which is what the tests use. */
const REQUEST_TTL_MS = Number(process.env.PHOENIX_FRIEND_REQUEST_MS) || 2 * 60 * 1000;

/** How many requests may be waiting at once, so a flood cannot fill the memory. */
const MAX_PENDING = 25;

const BCRYPT_ROUNDS = 10;

/** id -> request. In memory, deliberately: a request that outlives the server
 *  would be a request nobody is waiting for any more. */
const requests = new Map();

/** Mark the requests that ran out of time, and forget the ones nobody is
 *  waiting for. Every ten seconds, quietly. */
function sweep() {
  const now = Date.now();
  for (const [id, request] of requests) {
    if (request.state === 'pending' && now > request.expiresAt) {
      request.state = 'expired';
    }
    // A minute after it expired, the whole thing goes: the password hash and
    // the username with it.
    if (now > request.expiresAt + 60 * 1000) requests.delete(id);
  }
}

const sweeper = setInterval(sweep, 10 * 1000);
if (sweeper && typeof sweeper.unref === 'function') sweeper.unref();

/** What the owner is allowed to see about a request. */
function publicView(request) {
  return {
    id: request.id,
    username: request.username,
    askedAt: request.createdAt,
    expiresAt: request.expiresAt,
    state: request.state
  };
}

function pendingCount() {
  let count = 0;
  for (const request of requests.values()) {
    if (request.state === 'pending') count++;
  }
  return count;
}

/**
 * A friend asks for an account.
 *
 * Everything is checked before the owner is troubled with it: the name has
 * to be well formed and free, the password has to be long enough, and there
 * must not already be a request waiting for the same name.
 */
async function create(raw) {
  const input = raw || {};
  const username = String(input.username || '').trim();
  const password = String(input.password || '');

  if (!/^[A-Za-z0-9_]{3,22}$/.test(username)) {
    return { ok: false, message: 'Username must be 3-22 letters, digits or underscore.' };
  }
  if (Auth.nameHasBannedWord(username)) {
    return { ok: false, message: 'That name is not allowed. Pick another one.' };
  }
  if (password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }
  if (!Auth.isConfigured()) {
    return { ok: false, message: 'Accounts are not available on this server.' };
  }

  // The name must be FREE, so the owner is never asked to approve a request
  // that could not be accepted anyway.
  const lookup = await Auth.client()
    .from('accounts').select('id').eq('username', username).maybeSingle();
  if (lookup.error) {
    console.error('[PHOENIX friend] the name could not be checked -> ' +
      Auth.describeError(lookup.error));
    return { ok: false, message: 'The server cannot check that name right now. Try again shortly.' };
  }
  if (lookup.data) {
    return { ok: false, message: 'That username is already taken.' };
  }

  // One request per name at a time.
  for (const request of requests.values()) {
    if (request.state === 'pending' &&
        request.username.toLowerCase() === username.toLowerCase()) {
      return { ok: false, message: 'There is already a request waiting for that name.' };
    }
  }
  if (pendingCount() >= MAX_PENDING) {
    return { ok: false, message: 'There are too many requests waiting. Try again in a minute.' };
  }

  const now = Date.now();
  const request = {
    id: crypto.randomBytes(16).toString('hex'),
    username,
    // The password is hashed at once and never kept in the clear.
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    state: 'pending',
    token: null,
    account: null
  };
  requests.set(request.id, request);

  return {
    ok: true,
    id: request.id,
    expiresAt: request.expiresAt,
    expiresInSeconds: Math.round(REQUEST_TTL_MS / 1000),
    request: publicView(request)
  };
}

/** Every request still waiting for an answer. */
function list() {
  const out = [];
  for (const request of requests.values()) {
    if (request.state === 'pending') out.push(publicView(request));
  }
  out.sort(function (a, b) { return a.askedAt - b.askedAt; });
  return out;
}

/**
 * The owner answers.
 *
 * 'accept' makes the account - with no email address, and with the owner's
 * acceptance standing in for the proof an address would have given.
 * 'decline' ends it, and the friend is told so.
 */
async function respond(id, decision) {
  const request = requests.get(String(id || '').trim());
  if (!request) return { ok: false, message: 'That request is no longer here.' };
  if (request.state !== 'pending') {
    return { ok: false, message: 'That request has already been answered.' };
  }
  if (decision !== 'accept' && decision !== 'decline') {
    return { ok: false, message: 'That is not a decision.' };
  }

  if (decision === 'decline') {
    request.state = 'declined';
    request.passwordHash = null;
    return { ok: true, state: 'declined', username: request.username };
  }

  const created = await Auth.registerApproved(request.username, request.passwordHash);
  if (!created.ok) {
    request.state = 'failed';
    request.passwordHash = null;
    return { ok: false, message: created.message || 'The account could not be made.' };
  }
  request.state = 'approved';
  request.token = created.token;
  request.account = created.account;
  request.passwordHash = null;
  return { ok: true, state: 'approved', username: request.username };
}

/**
 * Where the request has got to, for the friend who is waiting.
 *
 * On approval the session token comes back once, and only once: the browser
 * turns it into a cookie and it is never sent out again.
 */
function status(id) {
  const request = requests.get(String(id || '').trim());
  if (!request) return { ok: true, state: 'expired' };
  if (request.state === 'pending' && Date.now() > request.expiresAt) {
    request.state = 'expired';
    request.passwordHash = null;
  }
  if (request.state === 'approved') {
    const out = { ok: true, state: 'approved', account: request.account || null, token: request.token };
    // The token is handed over once. After that the request is history.
    request.token = null;
    return out;
  }
  return { ok: true, state: request.state };
}

/** Forget a request outright. Used when a browser goes away. */
function forget(id) {
  const request = requests.get(String(id || '').trim());
  if (!request) return false;
  requests.delete(request.id);
  return true;
}

module.exports = {
  REQUEST_TTL_MS,
  create,
  list,
  respond,
  status,
  forget,
  publicView,
  pendingCount
};
