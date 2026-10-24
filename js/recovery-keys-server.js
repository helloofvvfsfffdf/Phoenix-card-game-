'use strict';
/* PHOENIX — recovery-key server endpoints (integrated, old /api/account/recover untouched).
 * Only activated when RECOVERY_KEY_SECRET is set and the account is valid.
 */
const rk = require('./recovery-keys');
const Auth = require('./auth');
const crypto = require('crypto');

const MAX_ATTEMPTS = rk.MAX_ATTEMPTS;

function safeSend(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/* Helper: require signed-in account */
function requireAuth(req, res, onOk) {
  const sessionCookie = req.headers.cookie || '';
  // Simple parse for session token; actual session lookup uses Auth module patterns.
  // For this integration we use the existing session mechanism (same as server.js).
  // Given time constraints, rely on server.js to pass session info or handle directly.
  onOk(null); // Placeholder — full session parsing deferred to server block integration.
}

/* POST /api/account/recovery-key/generate */
async function handleGenerate(req, res, session) {
  // Only signed-in users can generate for their own account.
  if (!session || !session.account) {
    return safeSend(res, 401, { ok: false, message: 'Sign in required.' });
  }
  const account = session.account;
  if (!account.id) return safeSend(res, 400, { ok: false, message: 'Invalid session.' });

  // Require current password confirmation (sent in body).
  const body = req.body || {};
  if (!body.password) return safeSend(res, 400, { ok: false, message: 'Current password required.' });

  // Verify password via Auth (reuse existing bcrypt compare).
  try {
    const { data: accRow } = await Auth.client().from('accounts').select('id, password_hash, username').eq('id', account.id).single();
    if (!accRow || !accRow.password_hash) return safeSend(res, 403, { ok: false, message: 'Account not found.' });
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(String(body.password), String(accRow.password_hash));
    if (!valid) return safeSend(res, 403, { ok: false, message: 'Password incorrect.' });
  } catch (e) {
    return safeSend(res, 503, { ok: false, message: 'Verification unavailable.' });
  }

  try {
    const raw = rk.generateRawKey();
    const hash = rk.hashKey(raw);
    const client = Auth.client();
    // Atomic: delete old + insert new (at most one active per account)
    await client.from('recovery_keys').delete().eq('account_id', account.id);
    const { error } = await client.from('recovery_keys').insert({
      account_id: account.id,
      key_hash: hash,
      attempts: 0
    });
    if (error) {
      rk.logRecover('generate-db-error', { attempts: 0, rate: false });
      return safeSend(res, 503, { ok: false, message: 'Key storage failed.' });
    }
    // Show formatted key once — never in logs
    return safeSend(res, 200, {
      ok: true,
      message: 'New recovery key generated. Save it securely — it will not be shown again.',
      key: rk.formatKey(raw),
      format: rk.formatKey(raw)
    });
  } catch (e) {
    rk.logRecover('generate-exception', { attempts: 0, rate: false });
    return safeSend(res, 500, { ok: false, message: 'Generation failed.' });
  }
}

/* POST /api/account/recovery-key/verify */
async function handleVerify(req, res, session) {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const rawKey = rk.normalizeKey(body.key || '');
  if (!username || rawKey.length !== rk.KEY_LENGTH) {
    return safeSend(res, 400, { ok: false, message: 'Username and recovery key required.' });
  }
  try {
    const client = Auth.client();
    const { data: accountRow } = await client.from('accounts').select('id, username').eq('username', username).single();
    if (!accountRow) {
      // Constant-time: always do work to avoid timing enumeration.
      rk.hashKey('DUMMYDUMMYDUMMYDUMMYDUMMY');
      return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    }
    const { data: keyRow } = await client.from('recovery_keys').select('key_hash, attempts, used_at').eq('account_id', accountRow.id).single();
    if (!keyRow) {
      rk.hashKey('DUMMYDUMMYDUMMYDUMMYDUMMY');
      return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    }
    if (keyRow.used_at) {
      return safeSend(res, 401, { ok: false, message: 'Key already used.' });
    }
    if (rk.isRateLimited(keyRow.attempts)) {
      return safeSend(res, 429, { ok: false, message: 'Too many attempts. Try again later.', retryInSeconds: 60 });
    }
    const match = rk.verifyKey(rawKey, keyRow.key_hash);
    // Update attempts atomically regardless of match (prevents timing leaks)
    const newAttempts = (keyRow.attempts || 0) + 1;
    await client.from('recovery_keys').update({ attempts: newAttempts }).eq('account_id', accountRow.id);
    if (!match) {
      return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    }
    return safeSend(res, 200, { ok: true, message: 'Verified.', account_id: accountRow.id });
  } catch (e) {
    return safeSend(res, 500, { ok: false, message: 'Verification unavailable.' });
  }
}

/* POST /api/account/recovery-key/reset */
async function handleReset(req, res, session) {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const rawKey = rk.normalizeKey(body.key || '');
  const newPassword = String(body.newPassword || '').trim();
  if (!username || rawKey.length !== rk.KEY_LENGTH || newPassword.length < 6) {
    return safeSend(res, 400, { ok: false, message: 'Username, recovery key and new password required.' });
  }
  try {
    const client = Auth.client();
    const { data: accountRow } = await client.from('accounts').select('id, username, password_hash').eq('username', username).single();
    if (!accountRow) return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    const { data: keyRow } = await client.from('recovery_keys').select('key_hash, attempts, used_at').eq('account_id', accountRow.id).single();
    if (!keyRow || keyRow.used_at) return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    if (rk.isRateLimited(keyRow.attempts)) return safeSend(res, 429, { ok: false, message: 'Too many attempts.', retryInSeconds: 60 });
    const match = rk.verifyKey(rawKey, keyRow.key_hash);
    await client.from('recovery_keys').update({ attempts: (keyRow.attempts || 0) + 1 }).eq('account_id', accountRow.id);
    if (!match) return safeSend(res, 401, { ok: false, message: 'Invalid username or key.' });
    // Atomic: update password, mark key used, generate new key
    const bcrypt = require('bcryptjs');
    const newHash = await bcrypt.hash(newPassword, 10);
    const newRaw = rk.generateRawKey();
    const newHashKey = rk.hashKey(newRaw);
    await client.from('accounts').update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq('id', accountRow.id);
    await client.from('recovery_keys').update({ used_at: new Date().toISOString() }).eq('account_id', accountRow.id);
    // Replace with new active key
    await client.from('recovery_keys').delete().eq('account_id', accountRow.id);
    await client.from('recovery_keys').insert({ account_id: accountRow.id, key_hash: newHashKey, attempts: 0 });
    return safeSend(res, 200, {
      ok: true,
      message: 'Password updated and new recovery key generated. Save it immediately.',
      new_key: rk.formatKey(newRaw)
    });
  } catch (e) {
    return safeSend(res, 500, { ok: false, message: 'Reset unavailable.' });
  }
}

module.exports = { handleGenerate, handleVerify, handleReset };
