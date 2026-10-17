/* PHOENIX — mandatory verified emails (server side).
 *
 * Uses Supabase's own email OTP flow (`signInWithOtp` / `verifyOtp` on the
 * server-side supabase-js client), so PHOENIX never generates, stores, logs or
 * transmits a six-digit code itself: Supabase mints it, Supabase mails it and
 * Supabase says whether the player typed the right one.
 *
 * What PHOENIX keeps is only the BOOKKEEPING Supabase does not: which address
 * this account is trying to prove, when the code stops being accepted, when the
 * next one may be asked for, and how many wrong codes have been tried.
 *
 *   - Codes: six digits, single use, 10 minute expiry.
 *   - Resend cooldown: 60 seconds. Hourly ceiling: 6 sends.
 *   - Wrong attempts: 5 per code, then a fresh code must be requested.
 *
 * Every route that uses this runs behind an authenticated session: a player can
 * only ever ask for, or verify, a code against THEIR OWN account.
 *
 * Two properties matter more than the rest:
 *
 *   1. verification state is stored in Postgres, not the browser, so clearing
 *      cookies or switching device does not un-verify anything;
 *   2. an account whose email is already verified is NEVER asked again - the
 *      mandatory screen is skipped for it.
 *
 * If sql/email-verification.sql has not been run, `available()` answers false,
 * the gates answer "not required yet" rather than throwing, and the server logs
 * the exact file to run. Nothing here can produce a 500.
 */
'use strict';

const Auth = require('./auth');

const CODE_TTL_SEC = 10 * 60;       // when a code stops being accepted
const RESEND_COOLDOWN_SEC = 60;     // gap before another code may be asked for
const MAX_ATTEMPTS = 5;             // wrong codes tried against one code
const MAX_SENDS_PER_HOUR = 6;       // codes per address per rolling hour
const CODE_LENGTH = 8;

// Deliberately permissive: the OTP, not a regular expression, is what proves
// ownership. Only shape enough to stop obvious junk reaching Supabase.
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>.]+(\.[^\s@,;<>.]+)+$/;
const USERNAME_REF = /^[A-Za-z0-9_]{3,22}$/;

/* ------------------------------------------------------------------ */
/* Availability (graceful degradation)                                 */
/* ------------------------------------------------------------------ */

let _available = null;   // null = not probed yet, false = migration missing

/** Forget the cached probe result. Tests only. */
function _resetAvailability() {
  _available = null;
  if (typeof Auth._resetEmailProbe === 'function') Auth._resetEmailProbe();
}

/**
 * Does sql/email-verification.sql exist in this database?
 *
 * Probed once and cached - in Auth, shared with registration, so one process
 * asks exactly one question about the schema. A missing column (42703) or a
 * missing table (PGRST205 / 42P01) means the migration has not been run; any
 * other failure is reported as a real problem in the log but still answers
 * "not available", because a broken database must degrade to a locked door
 * rather than a crash.
 */
async function available() {
  if (_available !== null) return _available;
  if (!isConfigured()) return false;
  _available = await Auth.schemaHasEmail();
  if (!_available) {
    console.error('[PHOENIX email] verified email is not installed yet. ' +
      'Paste sql/email-verification.sql into the Supabase SQL Editor and run ' +
      'it. Until then the gameplay gate stays open, exactly as before.');
  }
  return _available;
}

function isConfigured() { return Auth.isConfigured(); }

/* ------------------------------------------------------------------ */
/* The Supabase OTP transport                                          */
/* ------------------------------------------------------------------ */

let _otp = null;

/**
 * The OTP implementation. Defaults to supabase-js `auth` on the server-side
 * client; tests inject a fake through _setOtp so no mail is ever sent.
 */
function otp() {
  if (_otp) return _otp;
  const client = Auth.freshClient();
  if (!client || !client.auth || typeof client.auth.signInWithOtp !== 'function') {
    throw new Error('Supabase Auth (email OTP) is not available on this client.');
  }
  _otp = client.auth;
  return _otp;
}

/** Swap the OTP implementation. Tests only. */
function _setOtp(impl) { _otp = impl; }

/** Shape a supabase-js error into one safe line for the server log. */
function describeOtpError(error) {
  if (!error) return 'none';
  const parts = [];
  if (error.code) parts.push('code=' + Auth.redact(error.code));
  if (error.status) parts.push('http=' + Auth.redact(String(error.status)));
  if (error.message) parts.push('message=' + Auth.redact(error.message));
  return parts.join(' | ') || Auth.redact(JSON.stringify(error));
}

/**
 * Map a Supabase OTP failure onto copy a player can act on.
 *
 * Nothing internal is ever handed to the browser. The known, actionable cases
 * get real advice; everything else becomes one honest sentence.
 */
function friendlyOtpError(error) {
  const status = error && (error.status || (error.__status));
  const message = String((error && error.message) || '').toLowerCase();

  if (status === 429 || /rate limit|too many requests|email rate/.test(message)) {
    return 'Too many codes requested. Wait a minute and try again.';
  }
  if (/email not confirmed|signup disabled|signups not allowed/.test(message)) {
    return 'Email sign-up is turned off on this Supabase project. Enable it in ' +
      'Authentication -> Providers -> Email, then try again.';
  }
  if (/smtp|mailer|failed to send|deliver/.test(message)) {
    return 'The verification email could not be sent. Please try again shortly.';
  }
  if (status === 403 || status === 401) {
    return 'Email verification is not configured on this server.';
  }
  return 'A verification code could not be sent right now. Please try again.';
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function normalizeEmail(raw) {
  return String(raw === undefined || raw === null ? '' : raw).trim();
}

function normalizeCode(raw) {
  return String(raw === undefined || raw === null ? '' : raw).replace(/[\s-]/g, '');
}

function isEmail(raw) {
  const email = normalizeEmail(raw);
  return email.length >= 5 && email.length <= 254 && EMAIL_RE.test(email);
}

function isCode(raw) {
  return /^\d{6,10}$/.test(normalizeCode(raw));
}

/** Seconds until `iso`, never negative. */
function secondsUntil(iso) {
  const at = new Date(iso).getTime();
  if (!isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Read this account's verification ledger row, or null. */
async function ledger(accountId) {
  const { data, error } = await Auth.client()
    .from('email_verifications')
    .select('email, requested_at, expires_at, resend_after, attempts, sent_count, window_started, requested_ip')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[PHOENIX email] ledger lookup failed -> ' + Auth.describeError(error));
    return { __error: error };
  }
  return data || null;
}

/** Replace this account's ledger row in one upsert. */
async function writeLedger(accountId, row) {
  const { error } = await Auth.client()
    .from('email_verifications')
    .upsert(Object.assign({ account_id: accountId }, row), { onConflict: 'account_id' });
  if (error) {
    console.error('[PHOENIX email] ledger write failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

/** Drop this account's ledger row (after a successful verification). */
async function clearLedger(accountId) {
  const { error } = await Auth.client()
    .from('email_verifications')
    .delete()
    .eq('account_id', accountId);
  if (error) {
    console.error('[PHOENIX email] ledger delete failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Record the address on the account, UNVERIFIED, and stamp when it was asked
 * for. Written before the code is sent so the ledger and the account can never
 * disagree about which address is in play.
 */
async function setAddress(accountId, email) {
  const { error } = await Auth.client()
    .from('accounts')
    .update({
      email,
      email_verified_at: null,
      email_requested_at: new Date().toISOString()
    })
    .eq('id', accountId);
  if (error) {
    console.error('[PHOENIX email] address write failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Mark the address proven. This is the single write that opens the gameplay
 * gate, so it happens only after Supabase has said the code was correct.
 */
async function markVerified(accountId, email) {
  const { error } = await Auth.client()
    .from('accounts')
    .update({ email, email_verified_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) {
    console.error('[PHOENIX email] verify write failed -> ' + Auth.describeError(error));
    return { ok: false, error };
  }
  return { ok: true };
}

/** A short code for the browser so a failure can be matched to a log line. */
function refFor(error) {
  const code = String((error && error.code) || '');
  if (code === '23505') return 'DB-DUPLICATE';
  if (code === '42703' || code === 'PGRST205' || code === '42P01') return 'DB-TABLE-MISSING';
  if (code === '42501') return 'DB-PERMISSION';
  if (code === 'PGRST202' || code === '42883') return 'DB-FUNCTION-MISSING';
  if (error && error.__network) return 'DB-UNREACHABLE';
  if (code) return 'DB-ERROR';
  return null;
}

/* ------------------------------------------------------------------ */
/* Public: what should the client show?                                */
/* ------------------------------------------------------------------ */

/**
 * Everything the browser needs to decide between "carry on" and the mandatory
 * account-update screen. Never throws: a missing migration or an unreachable
 * database both degrade to `required: false` (gate open) with the reason
 * logged, because a database hiccup must not lock every player out of a game
 * they were already allowed into.
 */
async function status(account) {
  if (!account || !isConfigured()) {
    return { available: false, required: false, verified: false };
  }
  if (!(await available())) {
    return { available: false, required: false, verified: false, reason: 'not-installed' };
  }

  // Already proven - never ask again, whatever else is in the ledger.
  if (account.emailVerified) {
    return {
      available: true, required: false, verified: true,
      email: account.email || null, awaitingCode: false
    };
  }

  const row = await ledger(account.id);
  if (row && row.__error) {
    // Degraded but honest: say verification is required without inventing a
    // countdown the server could not read.
    return { available: true, required: true, verified: false, email: account.email || null,
             awaitingCode: false };
  }

  const awaiting = Boolean(row);
  return {
    available: true,
    required: true,
    verified: false,
    email: (row && row.email) || account.email || null,
    awaitingCode: awaiting,
    resendInSeconds: awaiting ? secondsUntil(row.resend_after) : 0,
    expiresInSeconds: awaiting ? secondsUntil(row.expires_at) : 0,
    attemptsLeft: awaiting ? Math.max(0, MAX_ATTEMPTS - row.attempts) : MAX_ATTEMPTS
  };
}

/* ------------------------------------------------------------------ */
/* Public: ask for a code                                              */
/* ------------------------------------------------------------------ */

/**
 * Send a six-digit code to `email` for `account`.
 *
 * Order matters: cooldown and hourly ceiling are checked BEFORE Supabase is
 * asked, so a player hammering resend burns their own budget rather than
 * Supabase's; the address is written before the send so the ledger and the
 * account always agree; and a failed send never opens a window (no ledger row
 * is written, so nothing can be verified).
 *
 * @returns {{ok: boolean, message?: string, code?: string,
 *            resendAfter?: number, expiresInSeconds?: number,
 *            alreadyVerified?: boolean}}
 */
async function sendCode(account, email, ip) {
  if (!account) return { ok: false, message: 'Sign in first.', code: 'AUTH-REQUIRED' };
  if (!isConfigured()) return { ok: false, message: 'Accounts are not available on this server.' };
  if (!(await available())) {
    return { ok: false, message: 'Email verification is not installed on this server yet.',
             code: 'DB-TABLE-MISSING' };
  }

  const target = normalizeEmail(email);
  if (!isEmail(target)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  // Already proven against THIS address: say so instead of mailing again.
  if (account.emailVerified && String(account.email || '').toLowerCase() === target.toLowerCase()) {
    return { ok: true, alreadyVerified: true };
  }

  const existing = await ledger(account.id);
  if (existing && existing.__error) {
    return { ok: false, message: 'Verification is temporarily unavailable. Try again shortly.',
             code: refFor(existing.__error) };
  }

  // Rate limits, evaluated before any mail is sent.
  if (existing) {
    const cooldown = secondsUntil(existing.resend_after);
    if (cooldown > 0) {
      return { ok: false, message: 'Please wait ' + cooldown +
               ' second' + (cooldown === 1 ? '' : 's') + ' before requesting another code.',
               code: 'RESEND-COOLDOWN', retryInSeconds: cooldown };
    }
    const windowOpen = new Date(existing.window_started).getTime();
    const hourPassed = !isFinite(windowOpen) || (Date.now() - windowOpen) > 60 * 60 * 1000;
    if (!hourPassed && Number(existing.sent_count) >= MAX_SENDS_PER_HOUR) {
      return { ok: false, message: 'That email has reached its hourly limit for codes. ' +
               'Please try again later.', code: 'SEND-LIMIT' };
    }
  }

  // The address goes on the account first, UNVERIFIED. If the send below then
  // fails, nothing has been proven and the player simply asks again.
  const wrote = await setAddress(account.id, target);
  if (wrote.error) {
    return { ok: false, message: 'That email address could not be saved.', code: refFor(wrote.error) };
  }

  try {
    const { error } = await otp().signInWithOtp({
      email: target,
      options: { shouldCreateUser: true }
    });
    if (error) {
      console.error('[PHOENIX email] signInWithOtp failed -> ' + describeOtpError(error));
      return { ok: false, message: friendlyOtpError(error), code: 'OTP-SEND-FAILED' };
    }
  } catch (err) {
    console.error('[PHOENIX email] signInWithOtp threw -> ' + Auth.describeError(err));
    return { ok: false, message: 'A verification code could not be sent right now. ' +
             'Please try again shortly.', code: 'OTP-SEND-FAILED' };
  }

  const now = Date.now();
  const windowOpen = existing && isFinite(new Date(existing.window_started).getTime())
    ? new Date(existing.window_started).getTime() : 0;
  const freshWindow = !windowOpen || (now - windowOpen) > 60 * 60 * 1000;

  const saved = await writeLedger(account.id, {
    email: target,
    requested_at: new Date(now).toISOString(),
    expires_at: new Date(now + CODE_TTL_SEC * 1000).toISOString(),
    resend_after: new Date(now + RESEND_COOLDOWN_SEC * 1000).toISOString(),
    attempts: 0,
    sent_count: freshWindow ? 1 : Number(existing.sent_count) + 1,
    window_started: freshWindow ? new Date(now).toISOString() : existing.window_started,
    requested_ip: ip ? ip.text : null
  });
  if (!saved.ok) {
    // The code is already on its way but there is nowhere to check it against,
    // so tell the player plainly rather than letting them type into a void.
    console.error('[PHOENIX email] the code was sent but its ledger row could not be written.');
    return { ok: false, message: 'Verification is temporarily unavailable. Try again shortly.',
             code: refFor(saved.error) };
  }

  return {
    ok: true,
    message: 'We sent a six-digit code to ' + target + '.',
    resendAfter: RESEND_COOLDOWN_SEC,
    expiresInSeconds: CODE_TTL_SEC
  };
}

/* ------------------------------------------------------------------ */
/* Public: check a code                                                */
/* ------------------------------------------------------------------ */

/**
 * Verify a six-digit code against `account`.
 *
 * Single use is enforced twice: Supabase consumes the code, and PHOENIX
 * deletes the ledger row on success - so replaying a used code finds no ledger
 * at all and is refused as "request a new one".
 *
 * @returns {{ok: boolean, message?: string, code?: string, attemptsLeft?: number}}
 */
async function verifyCode(account, rawCode) {
  if (!account) return { ok: false, message: 'Sign in first.', code: 'AUTH-REQUIRED' };
  if (!isConfigured()) return { ok: false, message: 'Accounts are not available on this server.' };
  if (!(await available())) {
    return { ok: false, message: 'Email verification is not installed on this server yet.',
             code: 'DB-TABLE-MISSING' };
  }

  const code = normalizeCode(rawCode);
  if (!isCode(code)) {
    return { ok: false, message: 'Enter the verification code from the email.' };
  }

  // Already proven: verification is over, and no code is accepted again.
  if (account.emailVerified) {
    return { ok: true, alreadyVerified: true };
  }

  const row = await ledger(account.id);
  if (row && row.__error) {
    return { ok: false, message: 'Verification is temporarily unavailable. Try again shortly.',
             code: refFor(row.__error) };
  }
  if (!row) {
    // No ledger row means: never asked, already used, or cleared. All three
    // are answered the same way - ask for a fresh code.
    return { ok: false, message: 'That code is no longer valid. Request a new code.',
             code: 'CODE-REQUEST' };
  }
  if (secondsUntil(row.expires_at) <= 0) {
    return { ok: false, message: 'That code has expired. Request a new code.',
             code: 'CODE-EXPIRED' };
  }
  const attempts = Number(row.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) {
    return { ok: false, message: 'Too many incorrect attempts. Request a new code.',
             code: 'CODE-LOCKED' };
  }

  // Ask Supabase. This is the only authority on whether the code was right.
  let otpError = null;
  let verifyResult = null;
  try {
    verifyResult = await otp().verifyOtp({ email: row.email, token: code, type: 'email' });
    otpError = verifyResult && verifyResult.error ? verifyResult.error : null;
  } catch (err) {
    console.error('[PHOENIX email] verifyOtp threw -> ' + Auth.describeError(err));
    otpError = { message: 'transport' };
  }

  // verifyOtp sets a user session on the shared Supabase client. If we leave
  // it there, every subsequent database write runs as that authenticated user
  // instead of the service role and fails with 42501. Clear it now, before
  // any privileged write, so the client is back to service-role state.
  try { await Auth.client().auth.signOut({ scope: 'local' }); } catch (e) { /* best effort */ }

  if (otpError) {
    console.error('[PHOENIX email] verifyOtp failed -> ' + describeOtpError(otpError));
    const used = attempts + 1;
    await writeLedger(account.id, {
      email: row.email,
      requested_at: row.requested_at,
      expires_at: row.expires_at,
      resend_after: row.resend_after,
      attempts: used,
      sent_count: row.sent_count,
      window_started: row.window_started,
      requested_ip: row.requested_ip
    });
    if (used >= MAX_ATTEMPTS) {
      return { ok: false, message: 'Too many incorrect attempts. Request a new code.',
               code: 'CODE-LOCKED', attemptsLeft: 0 };
    }
    return { ok: false, message: 'That code is not correct.', code: 'CODE-WRONG',
             attemptsLeft: MAX_ATTEMPTS - used };
  }

  // Supabase accepted the code: prove ownership on the PHOENIX account.
  const marked = await markVerified(account.id, row.email);
  if (marked.error) {
    const dup = String(marked.error.code) === '23505';
    return {
      ok: false,
      message: dup
        ? 'That email address is already verified on another PHOENIX account.'
        : 'Your email could not be saved. Please try again.',
      code: dup ? 'DB-DUPLICATE' : refFor(marked.error)
    };
  }

  await clearLedger(account.id);
  return { ok: true, message: 'Email verified. Welcome to PHOENIX.' };
}

/* ------------------------------------------------------------------ */
/* Public: the gameplay gate                                           */
/* ------------------------------------------------------------------ */

/** The copy shown while an account still owes us a verified address. */
const REQUIRED_NOTICE =
  'New update: Every PHOENIX account now requires a verified email. ' +
  'Please add and verify your email to continue playing.';

/**
 * Server-side gate. Returns null when play may proceed, or the reason it may
 * not. Failures OPEN the door: a database outage must never lock out players
 * who were already allowed in, and every case where verification genuinely
 * does not apply (no Supabase, migration not run, already verified) is a null.
 *
 * This is checked in the same places bans are checked - on create, join, start
 * and every game action - so editing the page, poking localStorage or calling
 * the socket directly changes nothing.
 */
async function refusalFor(account) {
  if (!account) return 'Please sign in to play.';
  if (!isConfigured()) return null;
  if (!(await available())) return null;
  if (account.emailVerified) return null;
  return REQUIRED_NOTICE;
}

module.exports = {
  // tunables, so tests can shorten them
  CODE_TTL_SEC, RESEND_COOLDOWN_SEC, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, CODE_LENGTH,
  REQUIRED_NOTICE,
  isConfigured, available, isEmail, isCode, normalizeEmail, normalizeCode, secondsUntil,
  status, sendCode, verifyCode, refusalFor,
  _setOtp, _resetAvailability
};
