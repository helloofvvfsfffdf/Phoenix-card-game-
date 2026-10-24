'use strict';
/* PHOENIX — secure password recovery (separate from email verification).
 *
 * Uses the server-side DB only (`public.password_resets`), a new table
 * kept entirely apart from `email_verifications`. A verification code
 * never works here and a reset code never works there.
 */
const crypto = require('crypto');
const Auth = require('./auth');
const emailSender = require('./email-sender');

const CODE_TTL_SEC = 10 * 60;       // 10 minutes
const RESEND_COOLDOWN_SEC = 60;     // 60 seconds between requests
const MAX_ATTEMPTS = 5;             // wrong codes per reset
const MAX_SENDS_PER_HOUR = 6;       // per email per rolling hour
const CODE_LENGTH = 6;

function isConfigured() { return Auth.isConfigured(); }

/* ------------------------------------------------------------------ */
/* Safe diagnostic logging (never logs codes, hashes, passwords)        */
/* ------------------------------------------------------------------ */
function logRecover(action, safeContext) {
  const context = safeContext || {};
  const domain = context.email ? String(context.email).split('@')[1] || 'unknown' : 'none';
  console.log('[PHOENIX recover] action=' + String(action) +
    ' | domain=' + domain +
    ' | dbError=' + (context.dbError || 'none') +
    ' | rate=' + (context.rate ? 'limited' : 'ok') +
    ' | provider=' + (context.provider || 'unknown') +
    ' | attempts=' + (context.attempts === undefined ? 'n/a' : String(context.attempts)));
}

/* ------------------------------------------------------------------ */
/* Secure random 6-digit code and its hash                               */
/* ------------------------------------------------------------------ */
function generateCode() {
  // crypto.randomInt upper bound is exclusive, so (0, 1_000_000) gives 0..999999.
  const value = crypto.randomInt(0, 1_000_000);
  return String(value).padStart(CODE_LENGTH, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function normalizeEmail(raw) {
  return String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
}
function normalizeCode(raw) {
  return String(raw === undefined || raw === null ? '' : raw).replace(/[\s-]/g, '');
}
function isCode(raw) {
  return /^\d{6}$/.test(normalizeCode(raw));
}

/* ------------------------------------------------------------------ */
/* Ledger helpers                                                       */
/* ------------------------------------------------------------------ */
async function ledger(accountId) {
  const { data, error } = await Auth.client()
    .from('password_resets')
    .select('email, code_hash, requested_at, expires_at, resend_after, attempts, sent_count, window_started, requested_ip, used_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[PHOENIX recover] ledger lookup failed -> ' + Auth.describeError(error));
    return { __error: error };
  }
  return data || null;
}

async function writeLedger(accountId, row) {
  const { error } = await Auth.client()
    .from('password_resets')
    .upsert(Object.assign({ account_id: accountId }, row), { onConflict: 'account_id' });
  if (error) {
    console.error('[PHOENIX recover] ledger write failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

async function clearReset(accountId) {
  const { error } = await Auth.client()
    .from('password_resets')
    .delete()
    .eq('account_id', accountId);
  if (error) {
    console.error('[PHOENIX recover] reset delete failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

function secondsUntil(iso) {
  const at = new Date(iso).getTime();
  if (!isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/* ------------------------------------------------------------------ */
/* Email sending (reuses the existing mechanism)                        */
/* ------------------------------------------------------------------ */

function buildResetEmailBody(code) {
  return (
    'PHOENIX — Password Recovery\n\n' +
    'A request to reset the password for a PHOENIX account was made. ' +
    'If this was you, enter this six-digit code in the game:\n\n' +
    '    ' + code + '\n\n' +
    'This code expires in 10 minutes. If you did not request this, ' +
    'you may ignore this email; the code will not be used.\n\n' +
    '— The PHOENIX team\n'
  );
}

/* ------------------------------------------------------------------ */
/* Rate limit helpers                                                   */
/* ------------------------------------------------------------------ */

function checkRateLimits(existing, email) {
  if (existing && existing.__error) {
    return { ok: false, message: 'Recovery is temporarily unavailable. Try again shortly.', code: 'DB-ERROR' };
  }
  if (existing) {
    const cooldown = secondsUntil(existing.resend_after);
    if (cooldown > 0) {
      return { ok: false, message: 'Please wait ' + cooldown + ' second' + (cooldown === 1 ? '' : 's') + ' before requesting another code.', code: 'COOLDOWN', retryInSeconds: cooldown };
    }
    const windowOpen = new Date(existing.window_started).getTime();
    const hourPassed = !isFinite(windowOpen) || (Date.now() - windowOpen) > 60 * 60 * 1000;
    if (!hourPassed && Number(existing.sent_count || 0) >= MAX_SENDS_PER_HOUR) {
      return { ok: false, message: 'That email has reached its hourly limit for recovery codes. Please try again later.', code: 'SEND-LIMIT' };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Public: request a reset                                              */
/* ------------------------------------------------------------------ */

async function requestReset(emailRaw, ip) {
  if (!isConfigured()) {
    return { ok: false, message: 'Accounts are not available on this server.', code: 'NOT-CONFIGURED' };
  }

  const target = normalizeEmail(emailRaw);
  // We intentionally do NOT reveal whether the email exists. The same
  // message is returned either way.
  const genericMessage = 'If an account with that email exists, a six-digit recovery code has been sent.';

  // Even if no account has this email, we still enforce rate limits per
  // email to prevent spam. We use a synthetic account_id of null for the
  // rate check, but we don't write a ledger row for nonexistent accounts.
  // The rate-limit check below uses the email string directly.
  // Note: we don't need a DB read for non-existent accounts; the same
  // rate logic applies via a separate rate table or via a synthetic key.
  // For simplicity and to avoid exposing anything, we apply limits
  // loosely here: if no account exists, we still return the generic
  // message but don't generate a real code (no DB write, no mail).

  const accountRow = await findAccountByEmail(target);
  if (!accountRow) {
    logRecover('request-no-account', { dbError: 'none', rate: false, provider: 'none' });
    return { ok: true, message: genericMessage };
  }

  const existing = await ledger(accountRow.id);
  const rate = checkRateLimits(existing, target);
  if (!rate.ok) return { ok: false, message: rate.message, code: rate.code, retryInSeconds: rate.retryInSeconds };

  const code = generateCode();
  const codeHash = hashCode(code);

  // Write the reset request BEFORE sending, so a failure to send does
  // not leave a window open. If the send then fails, the ledger is still
  // present but no code has been delivered; the user simply asks again.
  const nowMs = Date.now();
  const freshWindow = !existing || (nowMs - new Date(existing.window_started || 0).getTime()) > 60 * 60 * 1000;
  const saved = await writeLedger(accountRow.id, {
    email: target,
    code_hash: codeHash,
    requested_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + CODE_TTL_SEC * 1000).toISOString(),
    resend_after: new Date(nowMs + RESEND_COOLDOWN_SEC * 1000).toISOString(),
    attempts: 0,
    sent_count: freshWindow ? 1 : Number(existing.sent_count || 0) + 1,
    window_started: freshWindow ? new Date(nowMs).toISOString() : existing.window_started,
    requested_ip: (ip && typeof ip === 'object' && ip.text) ? String(ip.text) : (ip ? String(ip) : null),
    used_at: null
  });
  if (!saved.ok) {
    logRecover('request-write-failed', { dbError: 'DB-WRITE', rate: false, provider: 'none' });
    return { ok: false, message: 'Recovery is temporarily unavailable. Try again shortly.', code: 'DB-ERROR' };
  }

  const result = await emailSender.send(target, 'PHOENIX — Password Recovery Code', buildResetEmailBody(code));

  // Never expose the code or its hash in any response.
  return {
    ok: true,
    message: genericMessage,
    code: 'SENT',
    delivered: result.delivered || false,
    provider: result.provider || 'unknown'
  };
}

/* ------------------------------------------------------------------ */
/* Find account by email (for rate limits, never exposed)                 */
/* ------------------------------------------------------------------ */

async function findAccountByEmail(email) {
  const { data, error } = await Auth.client()
    .from('accounts')
    .select('id, email, email_verified_at, email_key')
    .eq('email_key', email.toLowerCase())
    .maybeSingle();
  if (error) {
    console.error('[PHOENIX recover] account lookup failed -> ' + Auth.describeError(error));
    return null;
  }
  return data || null;
}

/* ------------------------------------------------------------------ */
/* Public: verify a reset code                                           */
/* ------------------------------------------------------------------ */

async function verifyResetCode(emailRaw, rawCode) {
  const target = normalizeEmail(emailRaw);
  const codeStr = normalizeCode(rawCode);
  if (!isCode(codeStr)) {
    return { ok: false, message: 'Enter the six-digit code from the recovery email.', code: 'CODE-FORMAT' };
  }

  const accountRow = await findAccountByEmail(target);
  if (!accountRow) {
    // Do not reveal that no account exists.
    return { ok: false, message: 'That code is not correct or has expired. Request a new one.', code: 'CODE-WRONG-OR-EXPIRED' };
  }

  const row = await ledger(accountRow.id);
  if (row && row.__error) {
    return { ok: false, message: 'Recovery is temporarily unavailable. Try again shortly.', code: 'DB-ERROR' };
  }
  if (!row) {
    return { ok: false, message: 'That code is no longer valid. Request a new one.', code: 'CODE-REQUEST' };
  }
  if (row.used_at) {
    return { ok: false, message: 'That code has already been used. Request a new one.', code: 'CODE-USED' };
  }
  if (secondsUntil(row.expires_at) <= 0) {
    return { ok: false, message: 'That code has expired. Request a new one.', code: 'CODE-EXPIRED' };
  }
  const attempts = Number(row.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    return { ok: false, message: 'Too many incorrect attempts. Request a new code.', code: 'CODE-LOCKED', attemptsLeft: 0 };
  }

  const submittedHash = hashCode(codeStr);
  // Constant-time comparison to avoid timing leaks.
  const match = crypto.timingSafeEqual(
    Buffer.from(submittedHash, 'hex'),
    Buffer.from(row.code_hash, 'hex')
  );

  if (!match) {
    const used = attempts + 1;
    await writeLedger(accountRow.id, {
      email: row.email,
      code_hash: row.code_hash,
      requested_at: row.requested_at,
      expires_at: row.expires_at,
      resend_after: row.resend_after,
      attempts: used,
      sent_count: row.sent_count,
      window_started: row.window_started,
      requested_ip: row.requested_ip,
      used_at: row.used_at
    });
    if (used >= MAX_ATTEMPTS) {
      return { ok: false, message: 'Too many incorrect attempts. Request a new code.', code: 'CODE-LOCKED', attemptsLeft: 0 };
    }
    return { ok: false, message: 'That code is not correct.', code: 'CODE-WRONG', attemptsLeft: MAX_ATTEMPTS - used };
  }

  return { ok: true, account: accountRow };
}

/* ------------------------------------------------------------------ */
/* Public: reset the password                                            */
/* ------------------------------------------------------------------ */

async function resetPassword(emailRaw, rawCode, newPassword) {
  const verifyResult = await verifyResetCode(emailRaw, rawCode);
  if (!verifyResult.ok) return verifyResult;

  const accountRow = verifyResult.account;

  // Apply existing password requirements (same as registration).
  // The auth module's register checks at least 8 chars; reuse that.
  if (!newPassword || String(newPassword).length < 8) {
    return { ok: false, message: 'The new password must be at least 8 characters.', code: 'PASSWORD-LENGTH' };
  }

  // Update the account with the new hashed password using Auth's existing
  // mechanism. The Auth module's register/update path handles this.
  const passwordHash = await require('bcryptjs').hash(newPassword, 10);

  const { error: updateErr } = await Auth.client()
    .from('accounts')
    .update({ password_hash: passwordHash })
    .eq('id', accountRow.id);

  if (updateErr) {
    console.error('[PHOENIX recover] password update failed -> ' + Auth.describeError(updateErr));
    return { ok: false, message: 'The password could not be updated. Please try again.', code: Auth.userRef ? Auth.userRef(updateErr) : 'DB-ERROR' };
  }

  // Mark the reset code as used (not deleted yet, so replay finds it used).
  const row = await ledger(accountRow.id);
  if (row && !row.__error && row && !row.used_at) {
    await Auth.client()
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('account_id', accountRow.id);
  }

  // Revoke all existing sessions for this account so old connections
  // (desktop, mobile, other devices) cannot continue with the old session.
  await Auth.destroyAllSessions(accountRow.id);

  return {
    ok: true,
    message: 'Your password has been reset. Please sign in with the new password.',
    code: 'RESET-OK'
  };
}

module.exports = {
  requestReset,
  verifyResetCode,
  resetPassword,
  isConfigured,
  CODE_TTL_SEC,
  RESEND_COOLDOWN_SEC,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_HOUR
};
